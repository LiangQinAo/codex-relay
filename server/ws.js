function registerSocket(io, ctx) {
  const {
    config,
    data,
    agents,
    socketAgentMap,
    saveData,
    log,
    uuidv4,
    queue,
    buildPrompt
  } = ctx;

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.headers['x-auth-token'];
    if (!config.AUTH_TOKEN || token !== config.AUTH_TOKEN) {
      return next(new Error('unauthorized'));
    }
    return next();
  });

  io.on('connection', (socket) => {
    const role = socket.handshake.auth?.role || 'frontend';
    log('ws', 'socket connected', { id: socket.id, role });

    if (role === 'agent') {
      const auth = socket.handshake.auth || {};
      const agentId = auth.agentId || socket.id;
      const capacity = Number.isFinite(auth.capacity) ? auth.capacity : Number.parseInt(auth.capacity || '1', 10);
      const tags = Array.isArray(auth.tags) ? auth.tags : [];
      const name = auth.name || agentId;

      const agent = queue.upsertAgent(agentId, {
        name,
        capacity: capacity > 0 ? capacity : 1,
        tags,
        socket,
        socketId: socket.id,
        status: 'online',
        lastSeenAt: new Date().toISOString()
      });
      socketAgentMap.set(socket.id, agentId);

      data.agent.lastSeenAt = agent.lastSeenAt;
      data.agent.status = 'online';
      saveData();
      queue.emitAgentStatus(io);

      socket.on('agent:hello', (info) => {
        const payload = info || {};
        const agentInfo = {
          ...payload,
          id: payload.id || agentId,
          name: payload.name || agent.name,
          capacity: payload.capacity || agent.capacity,
          tags: payload.tags || agent.tags
        };
        agent.info = agentInfo;
        agent.capacity = Number.isFinite(agentInfo.capacity) ? agentInfo.capacity : agent.capacity;
        agent.tags = Array.isArray(agentInfo.tags) ? agentInfo.tags : agent.tags;
        agent.lastSeenAt = new Date().toISOString();
        data.agent.info = agentInfo;
        data.agent.lastSeenAt = agent.lastSeenAt;
        saveData();
        io.emit('agent:info', { info: agentInfo });
        queue.emitAgentStatus(io);
      });

      socket.on('agent:heartbeat', (payload = {}) => {
        agent.lastSeenAt = new Date().toISOString();
        agent.status = 'online';
        if (Number.isFinite(payload.busyCount)) {
          agent.busyCount = Math.max(0, payload.busyCount);
        }
        if (Number.isFinite(payload.capacity)) {
          agent.capacity = Math.max(1, payload.capacity);
        }
        data.agent.lastSeenAt = agent.lastSeenAt;
        data.agent.status = 'online';
        saveData();
        queue.emitAgentStatus(io);
      });

      socket.on('agent:ready', () => {
        agent.lastSeenAt = new Date().toISOString();
        agent.status = 'online';
        data.agent.lastSeenAt = agent.lastSeenAt;
        data.agent.status = 'online';
        saveData();
        queue.emitAgentStatus(io);
        queue.dispatchTasks(io);
      });

      socket.on('task:complete', (payload) => {
        queue.completeTask(io, payload || {});
        queue.dispatchTasks(io);
      });

      socket.on('task:stream', (payload) => {
        if (!payload?.id || !payload?.chunk) return;
        const task = data.tasks.find((t) => t.id === payload.id);
        if (!task) return;
        io.to(`session:${task.sessionId}`).emit('message:stream', {
          taskId: payload.id,
          sessionId: task.sessionId,
          chunk: payload.chunk,
          type: payload.type || 'response'
        });
      });

      socket.on('agent:info', (info) => {
        const agentInfo = info || {};
        agent.info = agentInfo;
        agent.lastSeenAt = new Date().toISOString();
        data.agent.info = agentInfo;
        data.agent.lastSeenAt = agent.lastSeenAt;
        saveData();
        io.emit('agent:info', { info: agentInfo });
      });

      socket.on('agent:diagnose-result', (payload) => {
        const entry = {
          id: uuidv4(),
          createdAt: new Date().toISOString(),
          payload
        };
        agent.diagnostics = [entry, ...(agent.diagnostics || [])].slice(0, 20);
        data.agent.diagnostics = agent.diagnostics;
        saveData();
        io.emit('agent:diagnostics', { entry });
      });

      socket.on('disconnect', () => {
        log('ws', 'agent disconnected', { id: socket.id, agentId });
        socketAgentMap.delete(socket.id);
        agent.socket = null;
        agent.status = 'offline';
        queue.requeueTasksForAgent(agent.id);
        queue.emitAgentStatus(io);
      });
    } else {
      socket.on('session:subscribe', (sessionId) => {
        if (!sessionId) return;
        socket.join(`session:${sessionId}`);
      });

      socket.on('message:send', (payload, cb) => {
        try {
          const sessionId = payload?.sessionId;
          const content = typeof payload?.content === 'string' ? payload.content.trim() : '';
          const session = data.sessions.find((s) => s.id === sessionId && !s.archived);

          if (!session || !content) {
            cb && cb({ ok: false, error: 'invalid session or content' });
            return;
          }
          if (content.length > config.MAX_MESSAGE_CHARS) {
            cb && cb({ ok: false, error: `content too long (max ${config.MAX_MESSAGE_CHARS} chars)` });
            return;
          }

          const message = {
            id: uuidv4(),
            sessionId: session.id,
            role: 'user',
            content,
            createdAt: new Date().toISOString(),
            taskId: null
          };
          log('chat', 'user message (ws)', {
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

          cb && cb({ ok: true, message, task });
        } catch (err) {
          cb && cb({ ok: false, error: err.message });
        }
      });

      socket.on('agent:request-info', () => {
        const first = Array.from(agents.values()).find((agent) => agent.socket);
        if (first?.socket) {
          first.socket.emit('agent:request-info');
        }
      });

      socket.on('agent:run-diagnostics', () => {
        const first = Array.from(agents.values()).find((agent) => agent.socket);
        if (first?.socket) {
          first.socket.emit('agent:diagnose');
        }
      });

      socket.on('disconnect', () => {
        log('ws', 'frontend disconnected', { id: socket.id });
      });
    }
  });
}

module.exports = { registerSocket };
