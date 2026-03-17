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
  buildPrompt
}) {
  let agentPickIndex = 0;

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
        task.startedAt = null;
        task.ok = null;
        task.assignedAgentId = null;
        taskQueue.push(task.id);
        requeued += 1;
      }
    });
    if (requeued > 0) {
      log('warn', 'requeued tasks for offline agent', { agentId, count: requeued });
      saveData();
    }
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

  function dispatchTasks(io) {
    let assigned = true;
    while (assigned) {
      assigned = false;
      const agent = pickAgent();
      if (!agent) return;
      const taskId = taskQueue.shift();
      if (!taskId) return;

      const task = data.tasks.find((t) => t.id === taskId);
      if (!task) continue;

      task.status = 'claimed';
      task.startedAt = new Date().toISOString();
      task.assignedAgentId = agent.id;
      agent.busyCount += 1;
      agent.lastSeenAt = new Date().toISOString();
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
      agent.socket.emit('task:assign', task);
      assigned = true;
    }
  }

  function completeTask(io, payload) {
    const taskId = typeof payload.id === 'string' ? payload.id : null;
    const ok = typeof payload.ok === 'boolean' ? payload.ok : true;
    const durationMs = Number.isFinite(payload.durationMs) ? payload.durationMs : 0;
    const resultText = typeof payload.result === 'string' ? payload.result : '';

    const task = data.tasks.find((t) => t.id === taskId);
    if (task) {
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
  }

  return {
    upsertAgent,
    getAvailableAgents,
    pickAgent,
    recomputePrimaryAgent,
    requeueTasksForAgent,
    pruneTasksIfNeeded,
    ensureDefaultSession,
    rebuildQueue,
    scheduleSummaryIfNeeded,
    emitAgentStatus,
    broadcastMessage,
    broadcastTaskStatus,
    enqueueTask,
    dispatchTasks,
    completeTask
  };
}

module.exports = { createQueueManager };
