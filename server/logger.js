const fs = require('fs');
const path = require('path');

function createLogger(logDir) {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  return function log(level, message, meta = {}) {
    const ts = new Date().toISOString();
    const entry = { ts, level, message, ...meta };
    const line = JSON.stringify(entry);
    const file = path.join(logDir, `${ts.slice(0, 10)}.log`);
    try {
      fs.appendFileSync(file, line + '\n');
    } catch (err) {
      // fallback to console
    }
    console.log(line);
  };
}

module.exports = { createLogger };
