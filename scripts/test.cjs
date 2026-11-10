const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scope = process.argv[2] || 'all';
if (!['all', 'unit', 'integration'].includes(scope)) throw new Error('Unknown test scope');
const root = path.resolve(__dirname, '../tests');
const groups = scope === 'all' ? ['unit', 'integration'] : [scope];
const files = groups.flatMap(group => fs.readdirSync(path.join(root, group))
  .filter(file => file.endsWith('.test.cjs')).sort().map(file => path.join(root, group, file)));
if (!files.length) throw new Error('No tests found');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;
