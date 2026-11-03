const fs = require('fs');
const path = require('path');

let logFile = null;

function init(dir) {
  fs.mkdirSync(dir, { recursive: true });
  logFile = path.join(dir, 'launcher.log');
  try {
    if (fs.statSync(logFile).size > 5 * 1024 * 1024) fs.renameSync(logFile, logFile + '.old');
  } catch {}
}

function write(level, args) {
  const line = `[${new Date().toISOString()}] ${level} ${args
    .map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')}\n`;
  process.stdout.write(line);
  if (logFile) {
    try { fs.appendFileSync(logFile, line); } catch {}
  }
}

module.exports = {
  init,
  get file() { return logFile; },
  info: (...a) => write('INFO ', a),
  warn: (...a) => write('WARN ', a),
  error: (...a) => write('ERROR', a),
};
