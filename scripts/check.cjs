const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..');
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(path.join(directory, entry.name)) : [path.join(directory, entry.name)]);
}
(async () => {
  const { parseWxml } = await import(pathToFileURL(path.join(root, 'preview/wxml.mjs')));
  const sources = ['miniprogram','preview','scripts'].flatMap(directory => files(path.join(root, directory)));
  for (const file of sources) {
    if (/\.(cjs|mjs|js)$/.test(file)) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      if (result.status !== 0) process.exit(result.status || 1);
    }
    if (file.endsWith('.json')) JSON.parse(fs.readFileSync(file, 'utf8'));
    if (file.endsWith('.wxml')) parseWxml(fs.readFileSync(file, 'utf8'));
  }
  const config = JSON.parse(fs.readFileSync(path.join(root, 'project.config.json'), 'utf8'));
  if (config.miniprogramRoot !== 'miniprogram/') throw new Error('Invalid WeChat source root');
  const app = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
  for (const page of app.pages) for (const extension of ['js','json','wxml','wxss']) {
    if (!fs.existsSync(path.join(root, 'miniprogram', `${page}.${extension}`))) throw new Error(`Missing page file ${page}.${extension}`);
  }
  console.log(`Source check passed: ${sources.length} files; native page routes, JS, JSON, WXML verified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
