const { estimateMessageTokens, getKeepStartIndexByTokens } = require('./utils');

function createQueueManager({
  data,
  taskQueue,
  agents,
  socketAgentMap,
  config,
  saveData,
  log,
  uuidv4,
  buildSummaryPrompt,
  getSummaryChunk,
  buildPrompt,
  createPromptMetrics
}) {
  let agentPickIndex = 0;
  const taskWaiters = new Map();
  const runningSessions = new Set();

  function getSessionKey(task) {
    return task && task.sessionId ? task.sessionId : null;
  }

  function isSessionLocked(task) {
    const key = getSessionKey(task);
    return key ? runningSessions.has(key) : false;
  }

  function lockSession(task) {
    const key = getSessionKey(task);
    if (key) runningSessions.add(key);
  }

  function releaseSession(task) {
    const key = getSessionKey(task);
    if (key) runningSessions.delete(key);
  }

  function ensureTaskMetrics(task) {
    if (!task) return {};
    if (!task.metrics || typeof task.metrics !== 'object') {
      task.metrics = {};
    }
    if (!task.metrics.prompt || typeof task.metrics.prompt !== 'object') {
      task.metrics.prompt = {};
    }
    return task.metrics;
  }

  function upsertAgent(agentId, updates = {}) {
    const existing = agents.get(agentId) || {
      id: agentId,
      name: agentId,
      status: 'online',
      lastSeenAt: new Date().toISOString(),
      capacity: 1,
      busyCount: 0,
      tags: [],
      info: null,
      diagnostics: []
    };
    Object.assign(existing, updates);
    agents.set(agentId, existing);
    return existing;
  }

  function getAvailableAgents() {
    return Array.from(agents.values()).filter((agent) => (
      agent.status === 'online'
      && agent.socket
      && agent.capacity > 0
      && agent.busyCount < agent.capacity
    ));
  }

  function pickAgent() {
    const available = getAvailableAgents();
    if (!available.length) return null;
    const agent = available[agentPickIndex % available.length];
    agentPickIndex = (agentPickIndex + 1) % available.length;
    return agent;
  }

  function recomputePrimaryAgent() {
    let primary = null;
    agents.forEach((agent) => {
      if (!primary) {
        primary = agent;
        return;
      }
      const t1 = new Date(agent.lastSeenAt || 0).getTime();
      const t2 = new Date(primary.lastSeenAt || 0).getTime();
      if (t1 > t2) primary = agent;
    });

    if (primary) {
      data.agent.lastSeenAt = primary.lastSeenAt;
      data.agent.status = primary.status;
      data.agent.info = primary.info || data.agent.info;
      data.agent.diagnostics = primary.diagnostics || data.agent.diagnostics;
    } else {
      data.agent.status = 'offline';
    }
  }

  function requeueTasksForAgent(agentId) {
    let requeued = 0;
    data.tasks.forEach((task) => {
      if (task.status === 'claimed' && task.assignedAgentId === agentId) {
        task.status = 'queued';
        task.assignedAt = null;
        task.startedAt = null;
        task.ok = null;
        task.assignedAgentId = null;
        releaseSession(task);
        taskQueue.push(task.id);
        requeued += 1;
      }
    });
    if (requeued > 0) {
      log('warn', 'requeued tasks for offline agent', { agentId, count: requeued });
      saveData();
    }
    return requeued;
  }

  function pruneTasksIfNeeded() {
    if (!Number.isFinite(config.MAX_TASK_HISTORY) || config.MAX_TASK_HISTORY <= 0) return;
    if (data.tasks.length <= config.MAX_TASK_HISTORY) return;

    const active = [];
    const completed = [];

    data.tasks.forEach((task) => {
      if (task.status === 'completed') {
        completed.push(task);
      } else {
        active.push(task);
      }
    });

    completed.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const maxCompleted = Math.max(0, config.MAX_TASK_HISTORY - active.length);
    const trimmedCompleted = completed.slice(Math.max(0, completed.length - maxCompleted));

    data.tasks = [...active, ...trimmedCompleted];
    rebuildQueue();
    saveData();
  }

  function ensureDefaultSession() {
    if (data.sessions.length > 0) return;
    const session = {
      id: uuidv4(),
      title: '默认会话',
      systemPrompt: config.DEFAULT_SYSTEM_PROMPT,
      summary: '',
      summaryAnchor: 0,
      summaryUpdatedAt: null,
      summaryPending: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false
    };
    data.sessions.push(session);
    saveData();
  }

  function rebuildQueue() {
    taskQueue.length = 0;
    data.tasks
      .filter((task) => task.status === 'queued')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .forEach((task) => taskQueue.push(task.id));
  }

  function scheduleSummaryIfNeeded(sessionId, io) {
    const session = data.sessions.find((s) => s.id === sessionId);
    if (!session) return;

    const messages = data.messages.filter((m) => m.sessionId === sessionId);
    const totalTokens = messages.reduce((sum, m) => sum + estimateMessageTokens(m), 0);
    if (totalTokens <= config.MAX_HISTORY_TOKENS) {
      if (session.summary) {
        session.summary = '';
        session.summaryAnchor = 0;
        session.summaryUpdatedAt = new Date().toISOString();
        session.summaryPending = false;
        saveData();
        io.to(`session:${session.id}`).emit('summary:update', {
          sessionId: session.id,
          summary: session.summary,
          updatedAt: session.summaryUpdatedAt
        });
      }
      return;
    }

    const anchor = session.summaryAnchor || 0;
    const targetAnchor = getKeepStartIndexByTokens(messages, config.MAX_HISTORY_TOKENS);
    if (targetAnchor <= anchor) return;
    if (session.summaryPending) return;

    const chunk = getSummaryChunk(messages, anchor, targetAnchor, config);
    if (!chunk.length) return;

    const actualTargetAnchor = anchor + chunk.length;

    const task = {
      id: uuidv4(),
      sessionId: session.id,
      type: 'summary',
      prompt: buildSummaryPrompt(session, chunk, config),
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      ok: null,
      summaryTargetAnchor: actualTargetAnchor
    };
    task.metrics = {
      prompt: createPromptMetrics({
        prompt: task.prompt,
        historyMessageCount: chunk.length,
        hasSummary: Boolean(session.summary),
        newMessageChars: 0,
        promptType: 'summary'
      })
    };

    session.summaryPending = true;
    data.tasks.push(task);
    taskQueue.push(task.id);
    saveData();
    io.emit('queue:update', { queueLength: taskQueue.length });
    dispatchTasks(io);
  }

  function emitAgentStatus(io) {
    const now = Date.now();
    let onlineAgents = 0;
    agents.forEach((agent) => {
      const lastSeenAt = agent.lastSeenAt ? new Date(agent.lastSeenAt).getTime() : 0;
      if (lastSeenAt && now - lastSeenAt < config.AGENT_OFFLINE_MS) {
        agent.status = 'online';
        onlineAgents += 1;
      } else {
        agent.status = 'offline';
      }
    });
    recomputePrimaryAgent();
    saveData();
    io.emit('agent:status', {
      status: onlineAgents > 0 ? 'online' : 'offline',
      lastSeenAt: data.agent.lastSeenAt,
      queueLength: taskQueue.length,
      onlineAgents,
      totalAgents: agents.size
    });
  }

  function broadcastMessage(io, message) {
    io.to(`session:${message.sessionId}`).emit('message:new', message);
  }

  function broadcastTaskStatus(io, task) {
    io.to(`session:${task.sessionId}`).emit('task:status', {
      id: task.id,
      status: task.status,
      startedAt: task.startedAt,
      completedAt: task.completedAt,
      ok: task.ok
    });
  }

  function enqueueTask(io, task) {
    data.tasks.push(task);
    taskQueue.push(task.id);
    saveData();
    log('task', 'task queued', {
      taskId: task.id,
      sessionId: task.sessionId,
      type: task.type,
      queueLength: taskQueue.length
    });
    io.emit('queue:update', { queueLength: taskQueue.length });
    dispatchTasks(io);
  }

  function takeNextRunnableTask() {
    for (let i = 0; i < taskQueue.length; i += 1) {
      const taskId = taskQueue[i];
      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) {
        taskQueue.splice(i, 1);
        i -= 1;
        continue;
      }
      if (isSessionLocked(task)) continue;
      taskQueue.splice(i, 1);
      return task;
    }
    return null;
  }

  function claimTask(io, task, agent) {
    task.status = 'claimed';
    task.assignedAt = new Date().toISOString();
    task.startedAt = new Date().toISOString();
    ensureTaskMetrics(task);
    if (agent) {
      task.assignedAgentId = agent.id;
      agent.busyCount += 1;
      agent.lastSeenAt = new Date().toISOString();
    }
    lockSession(task);
    saveData();
    log('task', 'task claimed', {
      taskId: task.id,
      sessionId: task.sessionId,
      type: task.type,
      assignedAgentId: task.assignedAgentId,
      queueWaitMs: task.createdAt ? Date.now() - new Date(task.createdAt).getTime() : null
    });
    broadcastTaskStatus(io, task);
    io.emit('queue:update', { queueLength: taskQueue.length });
    return task;
  }

  function claimNextTask(io, agent) {
    const task = takeNextRunnableTask();
    if (!task) return null;
    return claimTask(io, task, agent);
  }

  function dispatchTasks(io) {
    let assigned = true;
    while (assigned) {
      assigned = false;
      const agent = pickAgent();
      if (!agent) return;
      const task = claimNextTask(io, agent);
      if (!task) return;
      agent.socket.emit('task:assign', task);
      assigned = true;
    }
  }

  function completeTask(io, payload) {
    const taskId = typeof payload.id === 'string' ? payload.id : null;
    const ok = typeof payload.ok === 'boolean' ? payload.ok : true;
    const durationMs = Number.isFinite(payload.durationMs) ? payload.durationMs : 0;
    const resultText = typeof payload.result === 'string' ? payload.result : '';
    const payloadMetrics = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : {};

    const task = data.tasks.find((t) => t.id === taskId);
    if (task) {
      const existingMetrics = ensureTaskMetrics(task);
      const mergedPromptMetrics = {
        ...existingMetrics.prompt,
        ...(payloadMetrics.prompt && typeof payloadMetrics.prompt === 'object' ? payloadMetrics.prompt : {})
      };
      const mergedMetrics = {
        ...existingMetrics,
        ...payloadMetrics,
        prompt: mergedPromptMetrics
      };
      if (!Number.isFinite(mergedMetrics.queueWaitMs) && task.createdAt && task.assignedAt) {
        mergedMetrics.queueWaitMs = Math.max(0, new Date(task.assignedAt).getTime() - new Date(task.createdAt).getTime());
      }
      if (!Number.isFinite(mergedMetrics.endToEndMs) && task.createdAt) {
        mergedMetrics.endToEndMs = Math.max(0, Date.now() - new Date(task.createdAt).getTime());
      }
      if (!Number.isFinite(mergedMetrics.promptChars) && Number.isFinite(mergedPromptMetrics.promptChars)) {
        mergedMetrics.promptChars = mergedPromptMetrics.promptChars;
      }
      if (!Number.isFinite(mergedMetrics.resultChars)) {
        mergedMetrics.resultChars = resultText.length;
      }
      if (!Number.isFinite(mergedMetrics.totalMs) && durationMs > 0) {
        mergedMetrics.totalMs = durationMs;
      }
      task.metrics = mergedMetrics;
      task.status = 'completed';
      task.ok = ok;
      task.completedAt = new Date().toISOString();
      if (task.assignedAgentId) {
        const agent = agents.get(task.assignedAgentId);
        if (agent && agent.busyCount > 0) {
          agent.busyCount -= 1;
        }
        task.assignedAgentId = null;
      }
      releaseSession(task);
    }

    if (task && task.type === 'summary') {
      const session = data.sessions.find((s) => s.id === task.sessionId);
      if (session) {
        if (ok && resultText) {
          session.summary = resultText;
          session.summaryUpdatedAt = new Date().toISOString();
          session.summaryAnchor = task.summaryTargetAnchor || session.summaryAnchor || 0;
        }
        session.summaryPending = false;
        session.updatedAt = new Date().toISOString();
        saveData();
        if (ok && resultText) {
          io.to(`session:${session.id}`).emit('summary:update', {
            sessionId: session.id,
            summary: session.summary,
            updatedAt: session.summaryUpdatedAt
          });
        }
      }

      data.lastResult = {
        id: taskId,
        ok,
        result: resultText || '[empty result]',
        createdAt: new Date().toISOString(),
        durationMs
      };

      saveData();
      log('task', 'task completed', {
        taskId,
        sessionId: task?.sessionId,
        type: task?.type,
        ok,
        durationMs,
        runMs: task?.startedAt ? Date.now() - new Date(task.startedAt).getTime() : null,
        totalMs: task?.createdAt ? Date.now() - new Date(task.createdAt).getTime() : null
      });
      io.emit('queue:update', { queueLength: taskQueue.length });
      const waiter = taskWaiters.get(taskId);
      if (waiter) {
        clearTimeout(waiter.timer);
        taskWaiters.delete(taskId);
        waiter.resolve({
          ok,
          result: resultText || '[empty result]',
          task
        });
      }
      return;
    }

    if (task) {
      const assistantMessage = {
        id: uuidv4(),
        sessionId: task.sessionId,
        role: 'assistant',
        content: resultText || '[empty result]',
        createdAt: new Date().toISOString(),
        taskId: taskId,
        durationMs
      };
      data.messages.push(assistantMessage);
      scheduleSummaryIfNeeded(task.sessionId, io);
      broadcastMessage(io, assistantMessage);
      broadcastTaskStatus(io, task);
    }

    data.lastResult = {
      id: taskId,
      ok,
      result: resultText || '[empty result]',
      createdAt: new Date().toISOString(),
      durationMs
    };

    saveData();
    log('task', 'task completed', {
      taskId,
      sessionId: task?.sessionId,
      type: task?.type,
      ok,
      durationMs,
      runMs: task?.startedAt ? Date.now() - new Date(task.startedAt).getTime() : null,
      totalMs: task?.createdAt ? Date.now() - new Date(task.createdAt).getTime() : null
    });
    io.emit('queue:update', { queueLength: taskQueue.length });
    pruneTasksIfNeeded();

    const waiter = taskWaiters.get(taskId);
    if (waiter) {
      clearTimeout(waiter.timer);
      taskWaiters.delete(taskId);
      waiter.resolve({
        ok,
        result: resultText || '[empty result]',
        task
      });
    }
  }

  function waitForTask(taskId, timeoutMs = 120000) {
    return new Promise((resolve) => {
      if (!taskId) {
        resolve({ ok: false, error: 'missing task id' });
        return;
      }
      const timer = setTimeout(() => {
        taskWaiters.delete(taskId);
        resolve({ ok: false, error: 'timeout' });
      }, timeoutMs);
      taskWaiters.set(taskId, { resolve, timer });
    });
  }

  return {
    upsertAgent,
    getAvailableAgents,
    pickAgent,
    recomputePrimaryAgent,
    requeueTasksForAgent,
    releaseSession,
    pruneTasksIfNeeded,
    ensureDefaultSession,
    rebuildQueue,
    scheduleSummaryIfNeeded,
    emitAgentStatus,
    broadcastMessage,
    broadcastTaskStatus,
    enqueueTask,
    claimNextTask,
    dispatchTasks,
    completeTask,
    waitForTask
  };
}

module.exports = { createQueueManager };
