const fs = require('fs');

function loadData(dataFile) {
  if (!fs.existsSync(dataFile)) {
    return {
      sessions: [],
      messages: [],
      tasks: [],
      lastResult: {
        id: null,
        ok: true,
        result: '等待指令...',
        createdAt: new Date().toISOString(),
        durationMs: 0
      },
      agent: {
        lastSeenAt: null,
        status: 'offline',
        info: null,
        diagnostics: []
      }
    };
  }

  try {
    const raw = fs.readFileSync(dataFile, 'utf-8');
    const parsed = JSON.parse(raw);
    parsed.agent = parsed.agent || { lastSeenAt: null, status: 'offline', info: null, diagnostics: [] };
    parsed.sessions = (parsed.sessions || []).map((session) => ({
      summary: '',
      summaryAnchor: 0,
      summaryUpdatedAt: null,
      summaryPending: false,
      ...session
    }));
    parsed.messages = parsed.messages || [];
    parsed.tasks = (parsed.tasks || []).map((task) => ({
      type: task.type || 'chat',
      assignedAgentId: task.assignedAgentId || null,
      metrics: task.metrics && typeof task.metrics === 'object' ? task.metrics : {},
      ...task
    }));
    return parsed;
  } catch (err) {
    return {
      sessions: [],
      messages: [],
      tasks: [],
      lastResult: {
        id: null,
        ok: false,
        result: '数据文件损坏，已重置。',
        createdAt: new Date().toISOString(),
        durationMs: 0
      },
      agent: {
        lastSeenAt: null,
        status: 'offline',
        info: null,
        diagnostics: []
      }
    };
  }
}

function createSaver(data, dataFile) {
  let saveTimer = null;
  let pendingSave = false;

  function flushData() {
    fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
  }

  function saveData() {
    pendingSave = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (pendingSave) {
        pendingSave = false;
        flushData();
      }
    }, 200);
  }

  return { saveData, flushData };
}

module.exports = { loadData, createSaver };
