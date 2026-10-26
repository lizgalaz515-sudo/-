const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../tests');
let failed = false;
for (const file of fs.readdirSync(directory).filter(file => file.endsWith('.test.cjs')).sort()) {
  const result = spawnSync(process.execPath, [path.join(directory, file)], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
if (failed) process.exitCode = 1;
