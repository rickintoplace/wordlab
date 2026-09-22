// Statischer Entwicklungsserver ohne Abhängigkeiten: node tools/serve.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../public', import.meta.url));
const port = Number(process.argv[2]) || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  // Wie die Weiterleitung in vercel.json.
  if (url === '/') { res.writeHead(302, { location: '/spoonerize' }).end(); return; }
  // cleanUrls wie bei Vercel: /misheard -> misheard.html
  let name = url.replace(/^\//, '');
  if (!path.extname(name)) name += '.html';
  const file = path.join(root, name);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  });
});

server.on('error', err => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${port} ist belegt — entweder läuft der Server schon ` +
    `(http://localhost:${port}), oder nimm einen anderen:\n  npm run dev -- ${port + 1}`);
  process.exit(1);
});

server.listen(port, () => console.log(`http://localhost:${port}`));
