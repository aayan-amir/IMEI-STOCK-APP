const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function checkDirectory(directory) {
  let count = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['node_modules', '.git', '.serena', '.vs', 'android', 'certs'].includes(entry.name)) continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) count += checkDirectory(file);
    else if (/\.(js|cjs)$/.test(entry.name) && !entry.name.endsWith('.min.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
      if (result.status !== 0) { process.stderr.write(result.stderr); process.exitCode = 1; }
      count++;
    }
  }
  return count;
}
console.log(`Syntax checked ${checkDirectory(path.resolve(__dirname, '..'))} authored JavaScript files`);
