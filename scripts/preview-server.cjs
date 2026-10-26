const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wxml': 'text/plain; charset=utf-8', '.wxss': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://preview.internal').pathname); }
  catch (_) { response.writeHead(400).end('Bad request'); return; }
  if (pathname === '/health') { response.writeHead(200, { 'content-type': types['.json'] }).end(JSON.stringify({ status: 'ok', app: 'lianji-wechat-preview' })); return; }
  if (pathname === '/') pathname = '/preview/index.html';
  const file = path.resolve(root, '.' + pathname);
  if (!/^\/(preview|miniprogram)\//.test(pathname) || pathname.split('/').some(part => part.startsWith('.')) || !file.startsWith(root + path.sep) || !types[path.extname(file)]) {
    response.writeHead(404).end('Not found'); return;
  }
  fs.readFile(file, (error, body) => {
    if (error) { response.writeHead(404).end('Not found'); return; }
    response.writeHead(200, { 'content-type': types[path.extname(file)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    response.end(body);
  });
});
const port = Number(process.env.PORT || 4173);
server.listen(port, '0.0.0.0', () => process.stdout.write(`练记小程序交互预览已启动，端口 ${port}\n`));
for (const signal of ['SIGTERM','SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));
