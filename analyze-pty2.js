// Parse the PTY log and extract response text by tracking virtual terminal state
const fs = require('fs');

const raw = fs.readFileSync('/tmp/codex-pty-raw.txt', 'utf8');

// Split into chunks - each chunk may span multiple lines in the file
// Format: [timestamp] chunk#N len=N | "..."
const chunks = [];
const chunkRegex = /\[(\d+:\d+:\d+\.\d+)\] chunk#(\d+) len=(\d+) \| "([\s\S]*?)(?="   \[|"\n?\[|\s*$)/g;

let match;
while ((match = chunkRegex.exec(raw)) !== null) {
  chunks.push({
    time: match[1],
    num: parseInt(match[2]),
    len: parseInt(match[3]),
    data: match[4]
  });
}

console.log(`Parsed ${chunks.length} chunks`);

// For each chunk, decode the content and look for printable text after cursor positioning
// The data has \uXXXX as LITERAL strings (stored by JSON.stringify)
// We need to convert them back

function decodeChunkData(raw) {
  // Replace literal \uXXXX sequences with actual characters
  // But keep actual unicode characters as-is
  let s = raw;
  // Replace \u001b with ESC
  s = s.replace(/\\u001b/g, '\x1b');
  // Replace other escaped unicode
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  // Replace escape sequences \n, \r, \t
  s = s.replace(/\\n/g, '\n');
  s = s.replace(/\\r/g, '\r');
  s = s.replace(/\\t/g, '\t');
  s = s.replace(/\\\\/g, '\\');
  return s;
}

// Virtual terminal: 50 rows x 200 cols
const ROWS = 50;
const COLS = 200;
let screen = Array.from({length: ROWS}, () => new Array(COLS).fill(' '));
let curRow = 0; // 0-indexed
let curCol = 0;

function parseAnsi(data) {
  let i = 0;
  const textAdded = [];
  
  while (i < data.length) {
    const ch = data[i];
    
    if (ch === '\x1b') {
      // ESC sequence
      if (data[i+1] === '[') {
        // CSI sequence
        let j = i + 2;
        // Read params
        while (j < data.length && !data[j].match(/[A-Za-z]/)) j++;
        const cmd = data[j];
        const params = data.slice(i+2, j).split(';').map(p => p === '' ? 0 : parseInt(p));
        
        if (cmd === 'H' || cmd === 'f') {
          // Cursor position: ESC[row;colH
          curRow = Math.max(0, (params[0] || 1) - 1);
          curCol = Math.max(0, (params[1] || 1) - 1);
        } else if (cmd === 'A') {
          curRow = Math.max(0, curRow - (params[0] || 1));
        } else if (cmd === 'B') {
          curRow = Math.min(ROWS-1, curRow + (params[0] || 1));
        } else if (cmd === 'C') {
          curCol = Math.min(COLS-1, curCol + (params[0] || 1));
        } else if (cmd === 'D') {
          curCol = Math.max(0, curCol - (params[0] || 1));
        } else if (cmd === 'K') {
          // Erase in line
          const mode = params[0] || 0;
          if (mode === 0) {
            // Clear from cursor to end of line
            for (let c = curCol; c < COLS; c++) screen[curRow][c] = ' ';
          } else if (mode === 1) {
            for (let c = 0; c <= curCol; c++) screen[curRow][c] = ' ';
          } else if (mode === 2) {
            for (let c = 0; c < COLS; c++) screen[curRow][c] = ' ';
          }
        } else if (cmd === 'J') {
          // Erase in display
          const mode = params[0] || 0;
          if (mode === 0) {
            for (let c = curCol; c < COLS; c++) screen[curRow][c] = ' ';
            for (let r = curRow+1; r < ROWS; r++) screen[r].fill(' ');
          } else if (mode === 2 || mode === 3) {
            for (let r = 0; r < ROWS; r++) screen[r].fill(' ');
          }
        }
        // Skip 'r' (scroll region), 'm' (colors), 'h'/'l' (modes), etc.
        
        i = j + 1;
      } else if (data[i+1] === 'M') {
        // RI: Reverse Index - scroll down (insert line at top of scroll region)
        // Simplified: scroll entire screen down by 1
        screen.unshift(new Array(COLS).fill(' '));
        screen.pop();
        i += 2;
      } else if (data[i+1] === ']') {
        // OSC sequence - find terminator
        let j = i + 2;
        while (j < data.length && !(data[j] === '\x07' || (data[j] === '\x1b' && data[j+1] === '\\'))) j++;
        i = j + (data[j] === '\x1b' ? 2 : 1);
      } else {
        i += 2;
      }
    } else if (ch === '\r') {
      curCol = 0;
      i++;
    } else if (ch === '\n') {
      curRow = Math.min(ROWS-1, curRow + 1);
      i++;
    } else if (ch.charCodeAt(0) >= 32) {
      // Printable character
      if (curRow < ROWS && curCol < COLS) {
        screen[curRow][curCol] = ch;
        // CJK characters take 2 columns
        if (ch.charCodeAt(0) > 0x2E7F) {
          curCol++;
          if (curCol < COLS) screen[curRow][curCol] = '';
        }
        curCol++;
        textAdded.push({row: curRow, col: curCol-1, ch});
      }
      i++;
    } else {
      i++;
    }
  }
  return textAdded;
}

// Track the "response area" - rows 8-16 based on TUI layout
let prevResponseText = '';
const chunkSnapshots = [];

for (const chunk of chunks) {
  const data = decodeChunkData(chunk.data);
  parseAnsi(data);
  
  // Check rows 5-18 for text (skip first few header rows)
  let currentText = '';
  for (let r = 5; r < 18; r++) {
    const rowText = screen[r].join('').trimEnd();
    if (rowText.trim().length > 0) {
      currentText += rowText + '\n';
    }
  }
  
  currentText = currentText.trim();
  
  if (currentText !== prevResponseText && /[\u4e00-\u9fa5]/.test(currentText)) {
    const newPart = currentText.replace(prevResponseText, '').trim();
    if (newPart) {
      chunkSnapshots.push({time: chunk.time, num: chunk.num, new: newPart, total: currentText.substring(0, 100)});
    }
    prevResponseText = currentText;
  }
}

console.log(`\nSnapshots with Chinese text: ${chunkSnapshots.length}`);
chunkSnapshots.slice(0, 20).forEach(s => {
  console.log(`[${s.time}] chunk#${s.num}: "+${s.new.substring(0,50)}" | total: ${s.total.substring(0,80)}...`);
});

// Show final screen state (rows 5-18)
console.log('\n=== FINAL SCREEN (rows 5-18) ===');
for (let r = 5; r < 18; r++) {
  const rowText = screen[r].join('').trimEnd();
  if (rowText.trim().length > 0) {
    console.log(`Row ${String(r).padStart(2)}: [${rowText}]`);
  }
}
