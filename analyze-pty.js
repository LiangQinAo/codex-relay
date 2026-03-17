const fs = require('fs');
const raw = fs.readFileSync('/tmp/codex-pty-raw.txt', 'utf8');
const lines = raw.split('\n');

// Track column positions across chunks to detect response growth
let responses = [];
for (const line of lines) {
  const m = line.match(/\[(\d+:\d+:\d+\.\d+)\] chunk#(\d+) len=(\d+)/);
  if (!m) continue;
  const content = line.replace(/.*?\| "/, '').replace(/"$/, '');
  
  // Decode the content (the log stores unicode escapes as literal \u)
  const decoded = content
    .replace(/\\u001b/g, '\x1b')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
  
  // Strip all ANSI escape sequences to get just text
  const stripped = decoded.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[^[\x1b]./g, '')
    .replace(/[\x00-\x1f]/g, ' ')
    .trim();
  
  if (/[\u4e00-\u9fa5]/.test(stripped)) {
    const chinese = stripped.match(/[\u4e00-\u9fa5\u3000-\u303f\uff00-\uffef•\s]+/g) || [];
    console.log(`[${m[1]}] chunk#${m[2]} len=${m[3]}`);
    chinese.forEach(c => {
      const clean = c.trim();
      if (clean.length > 1) console.log('  -> ' + clean);
    });
  }
}

// Also show the complete last few chunks
console.log('\n=== LAST 10 CHUNKS RAW ===');
const last10 = lines.filter(l => /chunk#5[89][0-9]/.test(l) || /chunk#[56][0-9][0-9]/.test(l)).slice(-10);
last10.forEach(line => {
  const m = line.match(/\[(\d+:\d+:\d+\.\d+)\] chunk#(\d+) len=(\d+)/);
  if (!m) return;
  const content = line.replace(/.*?\| "/, '').replace(/"$/, '');
  const decoded = content
    .replace(/\\u001b/g, '\x1b')
    .replace(/\\n/g, '\n')  
    .replace(/\\r/g, '\r');
  const stripped = decoded.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b./g, '')
    .replace(/[\x00-\x08\x0e-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 120);
  console.log(`[${m[1]}] #${m[2]}: ${stripped}`);
});
