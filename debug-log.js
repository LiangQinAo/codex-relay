// Simple debug script - check what the log file contains 
const fs = require('fs');
const raw = fs.readFileSync('/tmp/codex-pty-raw.txt', 'utf8');

console.log('File length:', raw.length);
console.log('Line count:', raw.split('\n').length);

// Show first 3 lines
const lines = raw.split('\n');
lines.slice(0, 3).forEach((l, i) => {
  console.log(`Line ${i}: ${JSON.stringify(l.substring(0,200))}`);
});

// Show lines that contain Chinese (non-ASCII > 0x4e00)
const chineseLines = lines.filter(l => /[\u4e00-\u9fa5]/.test(l));
console.log(`\nLines with Chinese: ${chineseLines.length}`);
chineseLines.forEach(l => {
  console.log('  -> ' + JSON.stringify(l.substring(0, 200)));
});
