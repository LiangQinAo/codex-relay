#!/usr/bin/env node

const { spawn } = require('child_process');

function buildLongPrompt() {
  return `${'这是历史背景，不需要逐字分析。\n'.repeat(4000)}\n问题：请只输出 OK 两个字符，不要解释。`;
}

function runCodexScenario(name, prompt, options = {}) {
  const stopOnTurnCompleted = Boolean(options.stopOnTurnCompleted);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('codex', ['exec', '--json', '--skip-git-repo-check', prompt], {
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let lineBuf = '';
    let firstEventAt = null;
    let turnCompletedAt = null;
    let processCloseAt = null;
    let stdoutBytes = 0;
    let resolved = false;

    function finish(extra = {}) {
      if (resolved) return;
      resolved = true;
      resolve({
        scenario: name,
        promptChars: prompt.length,
        firstEventMs: firstEventAt ? firstEventAt - startedAt : null,
        turnCompletedMs: turnCompletedAt ? turnCompletedAt - startedAt : null,
        processCloseMs: processCloseAt ? processCloseAt - startedAt : null,
        stdoutBytes,
        stderrChars: stderr.length,
        ...extra
      });
    }

    function processLine(line) {
      const trimmed = line.trim();
      if (!trimmed) return;
      let event;
      try {
        event = JSON.parse(trimmed);
      } catch (_) {
        return;
      }
      if (!firstEventAt) firstEventAt = Date.now();
      if (event.type === 'turn.completed' || event.type === 'response.completed') {
        if (!turnCompletedAt) turnCompletedAt = Date.now();
        if (stopOnTurnCompleted) {
          try { child.kill('SIGTERM'); } catch (_) {}
        }
      }
    }

    child.stdout.on('data', (data) => {
      stdoutBytes += data.length || 0;
      stdout += data.toString();
      lineBuf += data.toString();
      const lines = lineBuf.split('\n');
      lineBuf = lines.pop();
      lines.forEach(processLine);
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      processCloseAt = Date.now();
      if (lineBuf) processLine(lineBuf);
      finish({
        exitCode: code,
        outputPreview: stdout.trim().slice(0, 200),
        stderrPreview: stderr.trim().slice(0, 200)
      });
    });

    child.on('error', (err) => {
      processCloseAt = Date.now();
      finish({
        error: err.message
      });
    });
  });
}

async function main() {
  const shortPrompt = '请只输出 OK 两个字符，不要解释。';
  const longPrompt = buildLongPrompt();
  const scenarios = [
    { name: 'direct-short', prompt: shortPrompt, stopOnTurnCompleted: false },
    { name: 'agent-like-short', prompt: shortPrompt, stopOnTurnCompleted: true },
    { name: 'agent-like-long', prompt: longPrompt, stopOnTurnCompleted: true }
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runCodexScenario(scenario.name, scenario.prompt, scenario));
  }

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    results
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
