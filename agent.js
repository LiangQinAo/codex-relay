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
const CODEX_STALL_MS = Number.parseInt(process.env.CODEX_STALL_MS || '90000', 10);
const CODEX_MAX_MS = Number.parseInt(process.env.CODEX_MAX_MS || '600000', 10);
const CODEX_EARLY_JSON = process.env.CODEX_EARLY_JSON !== '0';
const CODEX_VISION_REASONING = process.env.CODEX_VISION_REASONING || 'low';
const CODEX_NO_MESSAGE_MS = Number.parseInt(process.env.CODEX_NO_MESSAGE_MS || '120000', 10);
const CODEX_PRECHECK = process.env.CODEX_PRECHECK === '1';
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

function readFileSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (_) {
    return '';
  }
}

function extractTomlValue(tomlText, key) {
  if (!tomlText) return '';
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\"([^\"]*)\"`, 'm');
  const match = tomlText.match(re);
  return match ? match[1] : '';
}

function loadCodexProxyConfig() {
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const authPath = path.join(os.homedir(), '.codex', 'auth.json');
  const configText = readFileSafe(configPath);
  const authText = readFileSafe(authPath);

  let apiKey = '';
  try {
    const parsed = JSON.parse(authText);
    apiKey = parsed?.OPENAI_API_KEY || '';
  } catch (_) {
    apiKey = '';
  }

  const provider = extractTomlValue(configText, 'model_provider');
  const model = extractTomlValue(configText, 'model');
  let baseUrl = '';
  if (provider) {
    const sectionStart = configText.indexOf(`[model_providers.${provider}]`);
    if (sectionStart >= 0) {
      const after = configText.slice(sectionStart);
      baseUrl = extractTomlValue(after, 'base_url');
    }
  }

  return { baseUrl, apiKey, model };
}

async function precheckProxyAvailability() {
  const { baseUrl, apiKey, model } = loadCodexProxyConfig();
  if (!baseUrl || !apiKey) return null;
  const url = `${baseUrl.replace(/\\/+$/, '')}/responses`;
  const payload = {
    model: model || 'gpt-5.2-codex',
    input: 'ping',
    max_output_tokens: 1
  };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (_) { parsed = null; }
    if (!res.ok) {
      const err = parsed?.error || {};
      return {
        type: err.type || 'proxy_error',
        message: err.message || `proxy error status ${res.status}`
      };
    }
    if (parsed?.error?.type) {
      return {
        type: parsed.error.type,
        message: parsed.error.message || 'proxy error'
      };
    }
    return null;
  } catch (err) {
    return { type: 'proxy_unreachable', message: err?.message || String(err) };
  }
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
  if (!prompt) return { prompt, imagePaths: [] };

  const isVisionTask = Boolean(task.type && task.type.startsWith('vision'));
  const urls = extractUrls(prompt).filter((url) => {
    if (isVisionTask) return true;
    return isLikelyImageUrl(url);
  });
  if (!urls.length) return { prompt, imagePaths: [] };

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
      updated += '\n\n图片已通过 --image 参数传入，无需访问外部 URL。';
    }
    updated += `\n${localNotes.join('\n')}`;
  }
  return { prompt: updated, imagePaths: localImages };
}

function tryParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

// ── codex exec --json runner ─────────────────────────────────────────────
function runCodex(prompt, options, onChunk) {
  return new Promise((resolve) => {
    const start = Date.now();
    const startIso = new Date(start).toISOString();
    const earlyJson = Boolean(options && options.earlyJson);
    const configOverrides = Array.isArray(options?.configOverrides) ? options.configOverrides : [];
    const imagePaths = Array.isArray(options?.imagePaths) ? options.imagePaths.filter(Boolean) : [];

    const args = [
      'exec',
      '--json',
      '--skip-git-repo-check',
    ];
    configOverrides.forEach((override) => {
      if (override) {
        args.push('-c', override);
      }
    });
    if (imagePaths.length) {
      imagePaths.forEach((imgPath) => {
        args.push('--image', imgPath);
      });
    }
    if (CODEX_CWD) args.push('--cd', CODEX_CWD);
    args.push(prompt);

    const child = spawn('codex', args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let lineBuf = '';
    let finalText = '';
    let resolved = false;
    let firstEventAt = null;
    let turnCompletedAt = null;
    let stdoutBytes = 0;
    let lastEventAt = null;
    let stallTimer = null;
    let maxTimer = null;
    let eventCount = 0;
    let itemCompletedCount = 0;
    let agentMessageCount = 0;
    let reasoningCount = 0;
    let heartbeatTimer = null;
    let noMessageTimer = null;
    let stderrFatal = null;

    function resetStallTimer() {
      if (!Number.isFinite(CODEX_STALL_MS) || CODEX_STALL_MS <= 0) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        const now = Date.now();
        const idleMs = lastEventAt ? now - lastEventAt : now - start;
        const hasOutput = Boolean(finalText && finalText.trim());
        console.log(`[agent][codex] stall_timeout ms=${CODEX_STALL_MS} idleMs=${idleMs} hasOutput=${hasOutput}`);
        if (hasOutput) {
          tryResolve(true, finalText, 0);
        } else {
          tryResolve(false, `stall timeout after ${idleMs}ms (no output)`, 1);
        }
      }, CODEX_STALL_MS);
    }

    function startMaxTimer() {
      if (!Number.isFinite(CODEX_MAX_MS) || CODEX_MAX_MS <= 0) return;
      maxTimer = setTimeout(() => {
        const elapsed = Date.now() - start;
        console.log(`[agent][codex] max_timeout ms=${CODEX_MAX_MS} elapsed=${elapsed}`);
        const hasOutput = Boolean(finalText && finalText.trim());
        if (hasOutput) {
          tryResolve(true, finalText, 0);
        } else {
          tryResolve(false, `max timeout after ${elapsed}ms (no output)`, 1);
        }
      }, CODEX_MAX_MS);
    }

    function startNoMessageTimer() {
      if (!Number.isFinite(CODEX_NO_MESSAGE_MS) || CODEX_NO_MESSAGE_MS <= 0) return;
      noMessageTimer = setTimeout(() => {
        if (agentMessageCount > 0 || finalText.trim()) return;
        const elapsed = Date.now() - start;
        console.log(`[agent][codex] no_message_timeout ms=${CODEX_NO_MESSAGE_MS} elapsed=${elapsed}`);
        tryResolve(false, `no agent message after ${elapsed}ms`, 1);
      }, CODEX_NO_MESSAGE_MS);
    }

    function startHeartbeat() {
      heartbeatTimer = setInterval(() => {
        const now = Date.now();
        const elapsed = now - start;
        const idleMs = lastEventAt ? now - lastEventAt : null;
        console.log(`[agent][codex] heartbeat elapsed=${elapsed} idleMs=${idleMs} events=${eventCount} items=${itemCompletedCount} agentMessages=${agentMessageCount} reasoning=${reasoningCount} stdoutBytes=${stdoutBytes}`);
      }, 30000);
    }

    function tryResolve(ok, output, exitCode) {
      if (resolved) return;
      resolved = true;
      // kill the process so it doesn't linger after we're done
      try { child.kill('SIGTERM'); } catch (_) {}
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      if (maxTimer) {
        clearTimeout(maxTimer);
        maxTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (noMessageTimer) {
        clearTimeout(noMessageTimer);
        noMessageTimer = null;
      }
      const durationMs = Date.now() - start;
      const firstEventMs = firstEventAt ? firstEventAt - start : null;
      const turnCompletedMs = turnCompletedAt ? turnCompletedAt - start : null;
      console.log(`[agent][codex] done start=${startIso} durationMs=${durationMs} firstEventMs=${firstEventMs} turnCompletedMs=${turnCompletedMs} stdoutBytes=${stdoutBytes} exit=${exitCode}`);
      resolve({ ok, output: output || '(empty)', durationMs, exitCode });
    }

    function collectText(text) {
      if (!text) return;
      finalText += (finalText ? '\n' : '') + text;
      onChunk?.({ type: 'response', chunk: text });
      if (earlyJson) {
        const candidate = finalText.trim();
        if (candidate.startsWith('{') && tryParseJson(candidate)) {
          console.log('[agent][codex] early_json_resolve');
          tryResolve(true, finalText, 0);
        }
      }
    }

    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try { event = JSON.parse(trimmed); } catch (_) { return; }

      if (!firstEventAt) {
        firstEventAt = Date.now();
        console.log(`[agent][codex] first_event ms=${firstEventAt - start}`);
      }
      lastEventAt = Date.now();
      resetStallTimer();
      eventCount += 1;

      if (event.type === 'response.output_text.delta' && event.delta) {
        collectText(String(event.delta));
        return;
      }
      if (event.type === 'response.output_text.done' && event.text) {
        collectText(String(event.text));
        return;
      }

      if (event.type === 'item.completed') {
        itemCompletedCount += 1;
        const item = event.item || {};
        if (item.type === 'reasoning' && item.text) {
          reasoningCount += 1;
          onChunk?.({ type: 'reasoning', chunk: item.text });
        } else if (item.type === 'agent_message') {
          agentMessageCount += 1;
          if (item.text) collectText(String(item.text));
          if (Array.isArray(item.content)) {
            item.content.forEach((part) => {
              if (!part) return;
              if (part.type === 'output_text' && part.text) collectText(String(part.text));
              if (part.type === 'text' && part.text) collectText(String(part.text));
            });
          }
        } else if (item.text) {
          // Fallback for other item types that carry text
          collectText(String(item.text));
        }
      } else if (event.type === 'turn.completed') {
        turnCompletedAt = Date.now();
        console.log(`[agent][codex] turn_completed ms=${turnCompletedAt - start}`);
        // resolve immediately — don't wait for process to exit
        tryResolve(true, finalText, 0);
      } else if (event.type === 'response.completed') {
        turnCompletedAt = Date.now();
        console.log(`[agent][codex] response_completed ms=${turnCompletedAt - start}`);
        tryResolve(true, finalText, 0);
      }
    }

    child.stdout.on('data', (data) => {
      stdoutBytes += data.length || 0;
      lineBuf += data.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      lines.forEach(processLine);
    });

    child.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.log(`[agent][codex] stderr ${text.slice(0, 500)}`);
        if (!stderrFatal) {
          const lower = text.toLowerCase();
          if (lower.includes('invalid_token') || lower.includes('authrequired') || lower.includes('context canceled')) {
            stderrFatal = text;
            console.log('[agent][codex] stderr_fatal_detected');
          }
        }
      }
    });

    child.on('error', (err) => {
      console.log(`[agent][codex] spawn_error ${err.message}`);
      tryResolve(false, `spawn error: ${err.message}`, null);
    });

    child.on('close', (code) => {
      if (lineBuf) processLine(lineBuf);
      if (!turnCompletedAt) {
        console.log(`[agent][codex] process_close code=${code}`);
      }
      if (stderrFatal && !finalText.trim()) {
        tryResolve(false, `stderr fatal: ${stderrFatal}`, code);
        return;
      }
      tryResolve(code === 0, finalText, code);
    });

    startMaxTimer();
    startHeartbeat();
    startNoMessageTimer();
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
    const startedAt = Date.now();
    const taskText = (task.prompt || task.command || '').slice(0, 160);
    const taskLen = (task.prompt || task.command || '').length;
    console.log(`[agent] task start id=${task.id} len=${taskLen} preview=${taskText}`);

    const { prompt: preparedPrompt, imagePaths } = await preparePromptForImages(task);
    const isVision = Boolean(task.type && task.type.startsWith('vision'));
    const earlyJson = CODEX_EARLY_JSON && isVision;
    const configOverrides = [];
    if (isVision && CODEX_VISION_REASONING) {
      configOverrides.push(`model_reasoning_effort="${CODEX_VISION_REASONING}"`);
    }
    if (isVision && CODEX_PRECHECK) {
      const precheck = await precheckProxyAvailability();
      if (precheck) {
        console.log(`[agent][precheck] fail type=${precheck.type} message=${precheck.message}`);
        socket.emit('task:complete', {
          id: task.id,
          ok: false,
          result: truncate(JSON.stringify({ error: precheck.type, message: precheck.message })),
          durationMs: Date.now() - startedAt,
          agentId: AGENT_ID
        });
        running -= 1;
        socket.emit('agent:ready');
        continue;
      }
    }
    const result = await runCodex(preparedPrompt || '', { earlyJson, configOverrides, imagePaths }, ({ type, chunk }) => {
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
