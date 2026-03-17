const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const { Server } = require('socket.io');
const { v4: uuidv4 } = require('uuid');

const { config } = require('./server/config');
const { createLogger } = require('./server/logger');
const { loadData, createSaver } = require('./server/storage');
const { buildPrompt } = require('./server/prompt');
const { buildSummaryPrompt, getSummaryChunk } = require('./server/summary');
const { createQueueManager } = require('./server/queue');
const { registerRoutes } = require('./server/routes');
const { registerSocket } = require('./server/ws');

const log = createLogger(config.LOG_DIR);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: `${config.MAX_BODY_MB}mb` }));
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    log('http', `${req.method} ${req.originalUrl} ${res.statusCode}`, {
      durationMs: Date.now() - start,
      ip: req.ip
    });
  });
  next();
});

fs.mkdirSync(config.UPLOAD_DIR, { recursive: true });
app.use('/uploads', express.static(config.UPLOAD_DIR));
app.use(express.static(config.PUBLIC_DIR));

const data = loadData(config.DATA_FILE);
const taskQueue = [];
const agents = new Map();
const socketAgentMap = new Map();
const { saveData, flushData } = createSaver(data, config.DATA_FILE);

const queue = createQueueManager({
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
});

queue.ensureDefaultSession();
queue.rebuildQueue();

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

registerRoutes(app, {
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
});

registerSocket(io, {
  config,
  data,
  agents,
  socketAgentMap,
  saveData,
  log,
  uuidv4,
  queue,
  buildPrompt
});

setInterval(() => {
  const now = Date.now();
  const lastSeenAt = data.agent.lastSeenAt ? new Date(data.agent.lastSeenAt).getTime() : 0;
  if (data.agent.status === 'online' && lastSeenAt && now - lastSeenAt > config.AGENT_OFFLINE_MS) {
    data.agent.status = 'offline';
    saveData();
    queue.emitAgentStatus(io);
  }
}, 5000);

setInterval(() => {
  const now = Date.now();
  let requeued = 0;
  data.tasks.forEach((task) => {
    if (task.status === 'claimed' && task.startedAt) {
      const started = new Date(task.startedAt).getTime();
      if (now - started > config.TASK_TIMEOUT_MS) {
        task.status = 'queued';
        task.startedAt = null;
        task.ok = null;
        if (task.assignedAgentId) {
          const agent = agents.get(task.assignedAgentId);
          if (agent && agent.busyCount > 0) {
            agent.busyCount -= 1;
          }
          task.assignedAgentId = null;
        }
        taskQueue.push(task.id);
        requeued += 1;
      }
    }
  });
  if (requeued > 0) {
    log('warn', 'requeued stuck tasks', { count: requeued });
    saveData();
    io.emit('queue:update', { queueLength: taskQueue.length });
    queue.dispatchTasks(io);
  }
}, 30000);

const API_PREFIXES = [
  '/health',
  '/agent',
  '/sessions',
  '/push-task',
  '/fetch-task',
  '/submit-result',
  '/get-result',
  '/upload'
];

app.get('*', (req, res, next) => {
  if (API_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    return next();
  }
  return res.sendFile(path.join(config.PUBLIC_DIR, 'index.html'));
});

process.on('SIGINT', () => {
  log('info', 'shutdown', { host: os.hostname() });
  flushData();
  process.exit(0);
});

process.on('SIGTERM', () => {
  log('info', 'shutdown', { host: os.hostname() });
  flushData();
  process.exit(0);
});

process.on('uncaughtException', (err) => {
  log('error', 'uncaughtException', { error: err.message, stack: err.stack });
});

process.on('unhandledRejection', (reason) => {
  log('error', 'unhandledRejection', { reason: String(reason) });
});

server.listen(config.PORT, () => {
  log('info', `Relay server running on port ${config.PORT}`);
});
