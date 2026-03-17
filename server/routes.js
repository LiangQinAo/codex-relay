function createAuthMiddleware(config) {
  return function requireToken(req, res, next) {
    if (!config.AUTH_TOKEN) {
      return res.status(500).json({ error: 'AUTH_TOKEN not set on server' });
    }

    const token = req.header('x-auth-token') || req.header('auth-token');
    if (!token || token !== config.AUTH_TOKEN) {
      return res.status(401).json({ error: 'unauthorized' });
    }

    next();
  };
}

function getSessionOr404(data, req, res) {
  const session = data.sessions.find((s) => s.id === req.params.id && !s.archived);
  if (!session) {
    res.status(404).json({ error: 'session not found' });
    return null;
  }
  return session;
}

function registerRoutes(app, ctx) {
  const {
    config,
    data,
    taskQueue,
    agents,
    saveData,
    io,
    uuidv4,
    buildPrompt,
    queue,
    log
  } = ctx;

  const requireToken = createAuthMiddleware(config);

  app.get('/health', (req, res) => {
    res.json({ ok: true, queueLength: taskQueue.length, hasToken: Boolean(config.AUTH_TOKEN) });
  });

  app.get('/agent/status', requireToken, (req, res) => {
    const now = Date.now();
    let onlineAgents = 0;
    agents.forEach((agent) => {
      const lastSeenAt = agent.lastSeenAt ? new Date(agent.lastSeenAt).getTime() : 0;
      if (lastSeenAt && now - lastSeenAt < config.AGENT_OFFLINE_MS) {
        onlineAgents += 1;
      }
    });
    res.json({
      lastSeenAt: data.agent.lastSeenAt,
      status: onlineAgents > 0 ? 'online' : 'offline',
      queueLength: taskQueue.length,
      onlineAgents,
      totalAgents: agents.size
    });
  });

  app.get('/agent/info', requireToken, (req, res) => {
    res.json({ info: data.agent.info, diagnostics: data.agent.diagnostics || [] });
  });

  app.get('/agents', requireToken, (req, res) => {
    const list = Array.from(agents.values()).map((agent) => ({
      id: agent.id,
      name: agent.name,
      status: agent.status,
      lastSeenAt: agent.lastSeenAt,
      capacity: agent.capacity,
      busyCount: agent.busyCount,
      tags: agent.tags || [],
      info: agent.info || null
    }));
    res.json({ agents: list });
  });

  app.post('/agent/heartbeat', requireToken, (req, res) => {
    data.agent.lastSeenAt = new Date().toISOString();
    data.agent.status = 'online';
    saveData();
    res.json({ status: 'ok' });
  });

  app.post('/push-task', requireToken, (req, res) => {
    const command = typeof req.body.command === 'string' ? req.body.command.trim() : '';
    if (!command) {
      return res.status(400).json({ error: 'command is required' });
    }
    if (command.length > config.MAX_MESSAGE_CHARS) {
      return res.status(413).json({ error: `command too long (max ${config.MAX_MESSAGE_CHARS} chars)` });
    }

    const session = data.sessions.find((s) => !s.archived) || data.sessions[0];
    const message = {
      id: uuidv4(),
      sessionId: session.id,
      role: 'user',
      content: command,
      createdAt: new Date().toISOString(),
      taskId: null
    };
    log('chat', 'user message (rest push-task)', {
      sessionId: session.id,
      messageId: message.id,
      length: command.length
    });

    const task = {
      id: uuidv4(),
      sessionId: session.id,
      userMessageId: message.id,
      type: 'chat',
      command,
      prompt: buildPrompt({ sessionId: session.id, newMessage: command, data, config }),
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      ok: null
    };

    message.taskId = task.id;
    data.messages.push(message);
    queue.scheduleSummaryIfNeeded(session.id, io);
    queue.broadcastMessage(io, message);

    queue.enqueueTask(io, task);

    session.updatedAt = new Date().toISOString();
    saveData();

    res.json({ status: 'ok', task });
  });

  app.get('/fetch-task', requireToken, (req, res) => {
    data.agent.lastSeenAt = new Date().toISOString();
    data.agent.status = 'online';
    saveData();
    queue.emitAgentStatus(io);

    const taskId = taskQueue.shift();
    if (!taskId) {
      return res.json({ task: null, queueLength: taskQueue.length });
    }

    const task = data.tasks.find((t) => t.id === taskId);
    if (!task) {
      return res.json({ task: null, queueLength: taskQueue.length });
    }

    task.status = 'claimed';
    task.startedAt = new Date().toISOString();
    saveData();
    queue.broadcastTaskStatus(io, task);

    return res.json({ task, queueLength: taskQueue.length });
  });

  app.get('/sessions', requireToken, (req, res) => {
    const sessions = data.sessions.filter((s) => !s.archived);
    res.json({ sessions });
  });

  app.post('/sessions', requireToken, (req, res) => {
    const title = typeof req.body.title === 'string' && req.body.title.trim()
      ? req.body.title.trim()
      : '新会话';

    const session = {
      id: uuidv4(),
      title,
      systemPrompt: config.DEFAULT_SYSTEM_PROMPT,
      summary: '',
      summaryAnchor: 0,
      summaryUpdatedAt: null,
      summaryPending: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archived: false
    };
    data.sessions.unshift(session);
    saveData();
    res.json({ session });
  });

  app.patch('/sessions/:id', requireToken, (req, res) => {
    const session = getSessionOr404(data, req, res);
    if (!session) return;

    if (typeof req.body.title === 'string') {
      session.title = req.body.title.trim() || session.title;
    }

    if (typeof req.body.systemPrompt === 'string') {
      session.systemPrompt = req.body.systemPrompt.trim() || session.systemPrompt;
    }

    if (typeof req.body.archived === 'boolean') {
      session.archived = req.body.archived;
    }

    session.updatedAt = new Date().toISOString();
    saveData();
    res.json({ session });
  });

  app.delete('/sessions/:id', requireToken, (req, res) => {
    const session = getSessionOr404(data, req, res);
    if (!session) return;

    session.archived = true;
    session.updatedAt = new Date().toISOString();
    saveData();
    res.json({ status: 'ok' });
  });

  app.get('/sessions/:id/messages', requireToken, (req, res) => {
    const session = getSessionOr404(data, req, res);
    if (!session) return;

    const messages = data.messages
      .filter((m) => m.sessionId === session.id)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    res.json({
      messages,
      summary: session.summary || '',
      summaryUpdatedAt: session.summaryUpdatedAt || null
    });
  });

  app.post('/sessions/:id/messages', requireToken, (req, res) => {
    const session = getSessionOr404(data, req, res);
    if (!session) return;

    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!content) {
      return res.status(400).json({ error: 'content is required' });
    }
    if (content.length > config.MAX_MESSAGE_CHARS) {
      return res.status(413).json({ error: `content too long (max ${config.MAX_MESSAGE_CHARS} chars)` });
    }

    const message = {
      id: uuidv4(),
      sessionId: session.id,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
      taskId: null
    };
    log('chat', 'user message (rest)', {
      sessionId: session.id,
      messageId: message.id,
      length: content.length
    });

    const task = {
      id: uuidv4(),
      sessionId: session.id,
      userMessageId: message.id,
      type: 'chat',
      command: content,
      prompt: buildPrompt({ sessionId: session.id, newMessage: content, data, config }),
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      ok: null
    };

    message.taskId = task.id;

    data.messages.push(message);
    queue.scheduleSummaryIfNeeded(session.id, io);
    queue.broadcastMessage(io, message);

    queue.enqueueTask(io, task);

    session.updatedAt = new Date().toISOString();
    saveData();

    res.json({ message, task });
  });

  app.post('/submit-result', requireToken, (req, res) => {
    queue.completeTask(io, req.body || {});
    res.json({ status: 'ok' });
  });

  app.get('/get-result', requireToken, (req, res) => {
    res.json({ lastResult: data.lastResult, queueLength: taskQueue.length });
  });
}

module.exports = { registerRoutes, createAuthMiddleware };
