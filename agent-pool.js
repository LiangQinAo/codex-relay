const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config();

const SERVER_URL = process.env.SERVER_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;

if (!SERVER_URL) {
  console.error('Missing SERVER_URL in environment');
  process.exit(1);
}
if (!AUTH_TOKEN) {
  console.error('Missing AUTH_TOKEN in environment');
  process.exit(1);
}

const AGENT_POOL_MIN = Number.parseInt(process.env.AGENT_POOL_MIN || '1', 10);
const AGENT_POOL_MAX = Number.parseInt(process.env.AGENT_POOL_MAX || '50', 10);
const AGENT_POOL_CHECK_MS = Number.parseInt(process.env.AGENT_POOL_CHECK_MS || '2000', 10);
const AGENT_POOL_IDLE_MS = Number.parseInt(process.env.AGENT_POOL_IDLE_MS || '60000', 10);
const AGENT_POOL_SPAWN_PER_TICK = Number.parseInt(process.env.AGENT_POOL_SPAWN_PER_TICK || '5', 10);
const AGENT_POOL_NAME_PREFIX = process.env.AGENT_POOL_NAME_PREFIX || 'Macmini';
const AGENT_POOL_LOG_DIR = process.env.AGENT_POOL_LOG_DIR || '';

const agents = new Map();
let nextIndex = 1;
let lastNonZeroAt = Date.now();
let tickInFlight = false;

process.stdout.setMaxListeners(0);
process.stderr.setMaxListeners(0);

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function ensureLogDir() {
  if (!AGENT_POOL_LOG_DIR) return null;
  const dir = AGENT_POOL_LOG_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createLogStream(index) {
  const dir = ensureLogDir();
  if (!dir) return null;
  const file = path.join(dir, `agent-${index}.log`);
  const stream = fs.createWriteStream(file, { flags: 'a' });
  stream.setMaxListeners(0);
  return stream;
}

async function fetchStatus() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(`${SERVER_URL}/agent/status`, {
      headers: { 'x-auth-token': AUTH_TOKEN },
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function computeDesired(queueLength, now) {
  if (queueLength > 0) {
    lastNonZeroAt = now;
    return clamp(AGENT_POOL_MIN, AGENT_POOL_MAX, Math.max(AGENT_POOL_MIN, queueLength));
  }

  const idleFor = now - lastNonZeroAt;
  if (idleFor < AGENT_POOL_IDLE_MS) {
    return clamp(AGENT_POOL_MIN, AGENT_POOL_MAX, Math.max(AGENT_POOL_MIN, agents.size));
  }
  return clamp(AGENT_POOL_MIN, AGENT_POOL_MAX, AGENT_POOL_MIN);
}

function spawnAgent() {
  const index = nextIndex++;
  const script = `process.env.AGENT_ID='${AGENT_POOL_NAME_PREFIX}-${index}-' + process.pid;`
    + `process.env.AGENT_NAME='${AGENT_POOL_NAME_PREFIX}-${index}';`
    + "require('./agent.js');";

  const child = spawn('node', ['-e', script], {
    cwd: path.resolve(__dirname),
    env: { ...process.env }
  });

  const logStream = createLogStream(index);
  if (logStream) {
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);
  } else {
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
  }

  const record = {
    id: `${AGENT_POOL_NAME_PREFIX}-${index}`,
    index,
    child,
    startedAt: Date.now(),
    stopping: false
  };
  agents.set(child.pid, record);

  child.on('exit', (code, signal) => {
    agents.delete(child.pid);
    if (logStream) logStream.end();
    console.log(`[agent-pool] agent ${record.id} exited code=${code} signal=${signal}`);
  });

  console.log(`[agent-pool] spawned ${record.id} pid=${child.pid}`);
}

function stopAgent(record) {
  if (!record || record.stopping) return;
  record.stopping = true;
  try {
    record.child.kill('SIGTERM');
  } catch (_) {}

  setTimeout(() => {
    if (record.child.exitCode == null) {
      try { record.child.kill('SIGKILL'); } catch (_) {}
    }
  }, 5000);
}

function scaleTo(desired) {
  const current = agents.size;
  if (desired > current) {
    const toSpawn = Math.min(desired - current, AGENT_POOL_SPAWN_PER_TICK);
    for (let i = 0; i < toSpawn; i += 1) spawnAgent();
  } else if (desired < current) {
    const toStop = current - desired;
    const candidates = Array.from(agents.values())
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, toStop);
    candidates.forEach(stopAgent);
  }
}

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const status = await fetchStatus();
    const queueLength = Number.parseInt(status.queueLength || 0, 10) || 0;
    const desired = computeDesired(queueLength, Date.now());
    scaleTo(desired);
  } catch (err) {
    console.log(`[agent-pool] status check failed: ${err.message || err}`);
  } finally {
    tickInFlight = false;
  }
}

function shutdown() {
  console.log('[agent-pool] shutting down...');
  agents.forEach(stopAgent);
  setTimeout(() => process.exit(0), 6000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log('[agent-pool] started');
setInterval(tick, AGENT_POOL_CHECK_MS);
// run once immediately
void tick();
