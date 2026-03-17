const os = require('os');
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
require('dotenv').config();

const SERVER_URL = process.env.SERVER_URL;
const AUTH_TOKEN = process.env.AUTH_TOKEN;
const CODEX_CWD = process.env.CODEX_CWD;
const RESULT_MAX_CHARS = Number.parseInt(process.env.RESULT_MAX_CHARS || '50000', 10);
const HEARTBEAT_MS = Number.parseInt(process.env.HEARTBEAT_MS || '5000', 10);
const AGENT_ID = process.env.AGENT_ID || `${os.hostname()}-${process.pid}`;
const AGENT_NAME = process.env.AGENT_NAME || os.hostname();
const AGENT_CAPACITY = Math.max(1, Number.parseInt(process.env.AGENT_CAPACITY || '1', 10));
const AGENT_TAGS = (process.env.AGENT_TAGS || '').split(',').map((t) => t.trim()).filter(Boolean);

if (!SERVER_URL) {
  console.error('Missing SERVER_URL in environment');
  process.exit(1);
}

if (!AUTH_TOKEN) {
  console.error('Missing AUTH_TOKEN in environment');
  process.exit(1);
}

function truncate(text) {
  if (!text || text.length <= RESULT_MAX_CHARS) return text;
  return text.slice(0, RESULT_MAX_CHARS) + `\n... [truncated to ${RESULT_MAX_CHARS} chars]`;
}

// ── codex exec --json runner ─────────────────────────────────────────────
function runCodex(prompt, onChunk) {
  return new Promise((resolve) => {
    const start = Date.now();

    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
    ];
    if (CODEX_CWD) args.push('--cd', CODEX_CWD);
    args.push(prompt);

    const child = spawn('codex', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let lineBuf = '';
    let finalText = '';
    let resolved = false;

    function tryResolve(ok, output, exitCode) {
      if (resolved) return;
      resolved = true;
      // kill the process so it doesn't linger after we're done
      try { child.kill('SIGTERM'); } catch (_) {}
      resolve({ ok, output: output || '(empty)', durationMs: Date.now() - start, exitCode });
    }

    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try { event = JSON.parse(trimmed); } catch (_) { return; }

      if (event.type === 'item.completed') {
        const item = event.item || {};
        if (item.type === 'reasoning' && item.text) {
          onChunk?.({ type: 'reasoning', chunk: item.text });
        } else if (item.type === 'agent_message' && item.text) {
          finalText += (finalText ? '\n' : '') + item.text;
          onChunk?.({ type: 'response', chunk: item.text });
        }
      } else if (event.type === 'turn.completed') {
        // resolve immediately — don't wait for process to exit
        tryResolve(true, finalText, 0);
      }
    }

    child.stdout.on('data', (data) => {
      lineBuf += data.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      lines.forEach(processLine);
    });

    child.stderr.on('data', () => {}); // suppress stderr noise

    child.on('error', (err) => {
      tryResolve(false, `spawn error: ${err.message}`, null);
    });

    child.on('close', (code) => {
      if (lineBuf) processLine(lineBuf);
      tryResolve(code === 0, finalText, code);
    });
  });
}



function execOnce(command, args = [], timeoutMs = 3000) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn(command, args, { shell: false });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch (err) {
        // ignore
      }
      resolve('timeout');
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      output += data.toString();
    });

    child.stderr?.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', () => {
      clearTimeout(timer);
      resolve(output.trim());
    });
  });
}

async function buildAgentInfo() {
  const codexVersion = await execOnce('codex', ['--version']);
  return {
    id: AGENT_ID,
    name: AGENT_NAME,
    capacity: AGENT_CAPACITY,
    tags: AGENT_TAGS,
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    nodeVersion: process.version,
    codexVersion: codexVersion || 'unknown',
    cwd: process.cwd(),
    shell: process.env.SHELL || '',
    user: os.userInfo().username,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    updatedAt: new Date().toISOString()
  };
}

async function runDiagnostics() {
  const uptime = os.uptime();
  const loadavg = os.loadavg();
  const freeMem = os.freemem();
  const totalMem = os.totalmem();
  const codexVersion = await execOnce('codex', ['--version']);

  return {
    ts: new Date().toISOString(),
    uptime,
    loadavg,
    freeMem,
    totalMem,
    codexVersion
  };
}

const socket = io(SERVER_URL, {
  auth: {
    token: AUTH_TOKEN,
    role: 'agent',
    agentId: AGENT_ID,
    name: AGENT_NAME,
    capacity: AGENT_CAPACITY,
    tags: AGENT_TAGS
  },
  transports: ['websocket'],
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

const pendingTasks = [];
let running = 0;
let lastTaskId = null;

socket.on('connect', async () => {
  console.log('Agent connected to server.');
  socket.emit('agent:hello', await buildAgentInfo());
  socket.emit('agent:ready');
});

socket.on('disconnect', (reason) => {
  console.log(`Agent disconnected: ${reason}`);
});

socket.on('task:assign', async (task) => {
  if (!task) return;
  pendingTasks.push(task);
  runNext();
});

socket.on('agent:request-info', async () => {
  socket.emit('agent:info', await buildAgentInfo());
});

socket.on('agent:diagnose', async () => {
  const report = await runDiagnostics();
  socket.emit('agent:diagnose-result', report);
});

setInterval(() => {
  if (!socket.connected) return;
  socket.emit('agent:heartbeat', {
    busyCount: running,
    capacity: AGENT_CAPACITY,
    lastTaskId
  });
}, HEARTBEAT_MS);

async function runNext() {
  while (running < AGENT_CAPACITY && pendingTasks.length > 0) {
    const task = pendingTasks.shift();
    if (!task) return;
    running += 1;
    lastTaskId = task.id;
    const taskText = (task.prompt || task.command || '').slice(0, 160);
    const taskLen = (task.prompt || task.command || '').length;
    console.log(`[agent] task start id=${task.id} len=${taskLen} preview=${taskText}`);

    const result = await runCodex(task.prompt || task.command || '', ({ type, chunk }) => {
      socket.emit('task:stream', { id: task.id, type, chunk });
    });
    console.log(`[agent] task done id=${task.id} ok=${result.ok} exit=${result.exitCode} durationMs=${result.durationMs} outLen=${(result.output || '').length}`);

    socket.emit('task:complete', {
      id: task.id,
      ok: result.ok,
      result: truncate(result.output),
      durationMs: result.durationMs,
      agentId: AGENT_ID
    });

    running -= 1;
    socket.emit('agent:ready');
  }
}

process.on('SIGINT', () => {
  socket.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  socket.close();
  process.exit(0);
});
