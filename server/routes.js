const path = require('path');
const multer = require('multer');

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

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, config.UPLOAD_DIR),
      filename: (req, file, cb) => {
        const ext = path.extname(file.originalname || '');
        cb(null, `${Date.now()}-${uuidv4()}${ext}`);
      }
    }),
    limits: {
      fileSize: config.MAX_UPLOAD_MB * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
      if (!file.mimetype || !file.mimetype.startsWith('image/')) {
        cb(new Error('only image uploads are allowed'));
        return;
      }
      cb(null, true);
    }
  });

  function parseIndicators(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {
        return [];
      }
    }
    return [];
  }

  function buildMedicalPrompt({ imageUrl, indicators }) {
    const indicatorLines = (indicators || [])
      .map((i) => `- ID: ${i.id}, 名称: ${i.name}`)
      .join('\n');
    const listText = indicatorLines || '(无)';

    return [
      '请分析这张医疗化验单图片，提取以下信息：',
      '1. 检查日期 (YYYY-MM-DD格式)',
      '2. 所有的化验指标数据。',
      '',
      '【极其重要 - 核心指标】：请务必优先且准确地提取以下四个核心指标（只要化验单上有）：',
      '- 白细胞 (WBC)',
      '- 血红蛋白 (HGB)',
      '- 中性粒细胞计数 (NEUT#)',
      '- 血小板 (PLT)',
      '',
      '【极其重要 - 全面提取】：除了上述核心指标，请务必逐行扫描表格，提取出表格中的每一项化验指标！不要遗漏任何一行数据。',
      '',
      '注意：',
      '1. 请仅提取表格中的实际化验指标！忽略页眉、页脚、医院名称、联系方式、备注说明等无关文本。',
      '2. 提取指标名称时，请去除名称前后的特殊符号（如☆、*等）和英文缩写（如(UA)、(TC)等），只保留纯中文名称。',
      '',
      '我已经有一些预设的指标，列表如下：',
      listText,
      '',
      '对于图片中提取到的每一个指标：',
      "- 如果它能对应上预设列表中的某个指标，请提供该指标的 'matchedId'。",
      "- 如果它是预设列表中没有的新指标，请不要提供 'matchedId'，但必须提供它的 'name' (名称), 'unit' (单位), 以及参考范围的 'minNormal' 和 'maxNormal' (如果有的话)。名称和单位必须简短（不超过20个字符）。",
      "- 必须提供提取到的数值 'value'。",
      '',
      '图片URL：',
      imageUrl,
      '',
      '【输出要求】',
      '仅输出 JSON，不要 Markdown，不要额外解释或代码块。',
      '输出格式如下：',
      '{',
      '  "checkDate": "YYYY-MM-DD" 或 null,',
      '  "items": [',
      '    {',
      '      "name": "指标名",',
      '      "matchedId": "预设ID(若有)",',
      '      "value": "数值",',
      '      "unit": "单位",',
      '      "minNormal": "参考下限(可为空)",',
      '      "maxNormal": "参考上限(可为空)"',
      '    }',
      '  ]',
      '}'
    ].join('\n');
  }

  function extractJson(text) {
    if (!text) return null;
    const startObj = text.indexOf('{');
    const startArr = text.indexOf('[');
    let start = -1;
    if (startObj === -1) start = startArr;
    else if (startArr === -1) start = startObj;
    else start = Math.min(startObj, startArr);
    if (start === -1) return null;

    const openChar = text[start];
    const closeChar = openChar === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        if (inString) escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === openChar) depth += 1;
      if (ch === closeChar) {
        depth -= 1;
        if (depth === 0) {
          const slice = text.slice(start, i + 1);
          try {
            return JSON.parse(slice);
          } catch (_) {
            return null;
          }
        }
      }
    }
    return null;
  }

  app.get('/health', (req, res) => {
    res.json({ ok: true, queueLength: taskQueue.length, hasToken: Boolean(config.AUTH_TOKEN) });
  });

  app.post('/upload', requireToken, (req, res) => {
    upload.single('file')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'file is required' });
      }
      const pathUrl = `/uploads/${req.file.filename}`;
      const host = req.get('host');
      const protocol = req.protocol || 'http';
      const payload = {
        url: host ? `${protocol}://${host}${pathUrl}` : pathUrl,
        path: pathUrl,
        name: req.file.originalname,
        size: req.file.size,
        mime: req.file.mimetype
      };
      log('upload', 'image uploaded', payload);
      return res.json(payload);
    });
  });

  app.post('/vision/medical', requireToken, async (req, res) => {
    const handle = async () => {
      const indicators = parseIndicators(req.body?.indicators);
      const timeoutMs = Math.min(
        Math.max(Number.parseInt(req.body?.timeoutMs || '120000', 10), 1000),
        300000
      );

      let imageUrl = typeof req.body?.imageUrl === 'string' ? req.body.imageUrl.trim() : '';
      if (!imageUrl && req.file?.filename) {
        const pathUrl = `/uploads/${req.file.filename}`;
        const host = req.get('host');
        const protocol = req.protocol || 'http';
        imageUrl = host ? `${protocol}://${host}${pathUrl}` : pathUrl;
      }
      if (imageUrl && imageUrl.startsWith('/uploads/')) {
        const host = req.get('host');
        const protocol = req.protocol || 'http';
        if (host) imageUrl = `${protocol}://${host}${imageUrl}`;
      }

      if (!imageUrl) {
        return res.status(400).json({ ok: false, error: 'imageUrl or file is required' });
      }

      const apiSession = data.sessions.find((s) => s.title === 'API Session' && s.archived)
        || (() => {
          const session = {
            id: uuidv4(),
            title: 'API Session',
            systemPrompt: config.DEFAULT_SYSTEM_PROMPT,
            summary: '',
            summaryAnchor: 0,
            summaryUpdatedAt: null,
            summaryPending: false,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            archived: true
          };
          data.sessions.unshift(session);
          saveData();
          return session;
        })();

      const message = {
        id: uuidv4(),
        sessionId: apiSession.id,
        role: 'user',
        content: `[vision/medical] ${imageUrl}`,
        createdAt: new Date().toISOString(),
        taskId: null
      };

      const prompt = buildMedicalPrompt({ imageUrl, indicators });

      const task = {
        id: uuidv4(),
        sessionId: apiSession.id,
        userMessageId: message.id,
        type: 'vision-medical',
        command: '',
        prompt,
        status: 'queued',
        createdAt: new Date().toISOString(),
        startedAt: null,
        completedAt: null,
        ok: null
      };

      message.taskId = task.id;
      data.messages.push(message);
      queue.enqueueTask(io, task);
      apiSession.updatedAt = new Date().toISOString();
      saveData();

      const result = await queue.waitForTask(task.id, timeoutMs);
      if (!result || result.ok === false && result.error) {
        return res.status(504).json({ ok: false, error: result?.error || 'timeout', taskId: task.id });
      }

      const parsed = extractJson(result.result || '');
      if (!parsed) {
        return res.status(502).json({
          ok: false,
          error: 'invalid json response',
          taskId: task.id,
          raw: result.result || ''
        });
      }

      return res.json({
        ok: result.ok,
        taskId: task.id,
        data: parsed,
        raw: result.result || ''
      });
    };

    if (req.is('multipart/form-data')) {
      return upload.single('file')(req, res, (err) => {
        if (err) {
          return res.status(400).json({ ok: false, error: err.message });
        }
        return handle();
      });
    }
    return handle();
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

  app.get('/sessions/:id/task-status', requireToken, (req, res) => {
    const session = getSessionOr404(data, req, res);
    if (!session) return;

    const tasks = data.tasks
      .filter((task) => task.sessionId === session.id && task.type === 'chat');
    const active = tasks
      .filter((task) => task.status !== 'completed')
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({ task: active[0] || null });
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
