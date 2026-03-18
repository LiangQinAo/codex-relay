const os = require('os');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
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

function isLikelyImageUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return (
    lower.includes('/uploads/')
    || lower.match(/\.(png|jpg|jpeg|webp|gif|bmp|tif|tiff)(\\?|#|$)/)
    || lower.endsWith('/file')
  );
}

function extractUrls(text) {
  if (!text) return [];
  const urls = new Set();
  const re = new RegExp('https?://[^\\s)\\]\">]+', 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    urls.add(match[0]);
  }
  return Array.from(urls);
}

function extFromContentType(ct) {
  if (!ct) return '';
  const mime = ct.split(';')[0].trim().toLowerCase();
  const map = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'image/bmp': '.bmp',
    'image/tiff': '.tiff'
  };
  return map[mime] || '';
}

async function downloadToTemp(url) {
  const baseDir = path.join('/tmp', 'codex-relay', 'images');
  fs.mkdirSync(baseDir, { recursive: true });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = extFromContentType(res.headers.get('content-type'));
    const name = `img-${Date.now()}-${Math.random().toString(16).slice(2)}${ext || '.img'}`;
    const filePath = path.join(baseDir, name);
    fs.writeFileSync(filePath, buf);
    return filePath;
  } finally {
    clearTimeout(timer);
  }
}

async function preparePromptForImages(task) {
  const prompt = task.prompt || task.command || '';
  if (!prompt) return prompt;
  if (!(task.type && task.type.startsWith('vision')) && !prompt.includes('图片')) {
    return prompt;
  }

  const isVisionTask = task.type && task.type.startsWith('vision');
  const urls = extractUrls(prompt).filter((url) => {
    if (isVisionTask) return true;
    return isLikelyImageUrl(url);
  });
  if (!urls.length) return prompt;

  let updated = prompt;
  const localNotes = [];
  const localImages = [];
  for (const url of urls) {
    try {
      const filePath = await downloadToTemp(url);
      console.log(`[agent] downloaded image ${url} -> ${filePath}`);
      localImages.push(filePath);
      if (isVisionTask) {
        updated = updated.split(url).join('');
      } else {
        updated = updated.split(url).join(filePath);
      }
      localNotes.push(`已下载图片到本地路径：${filePath}`);
    } catch (err) {
      console.log(`[agent] image download failed ${url}: ${err.message || err}`);
      localNotes.push(`图片下载失败：${url} (${err.message || err})`);
    }
  }

  if (localNotes.length) {
    if (isVisionTask && localImages.length) {
      const imageMarkdown = localImages.map((p) => `![image](${p})`).join('\n');
      updated += `\n\n以下为本地图片文件，请直接读取分析（不要再访问外部 URL）：\n${imageMarkdown}\n`;
    }
    updated += `\n${localNotes.join('\n')}`;
  }
  return updated;
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

    const preparedPrompt = await preparePromptForImages(task);
    const result = await runCodex(preparedPrompt || '', ({ type, chunk }) => {
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
