// Small web server for trying the app on this PC: node tools/serve.mjs   then open http://localhost:5190
import http from 'http'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const root = fileURLToPath(new URL('../docs/', import.meta.url)), port = +process.env.PORT || 5190;
const T = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.gz': 'application/gzip', '.wasm': 'application/wasm', '.jpg': 'image/jpeg' };
http.createServer((q, r) => {
  // testing only: lets a test page hand its files over for checking
  if (q.method === 'POST' && q.url.startsWith('/_test/') && fs.existsSync(path.join(root, '_test'))) {
    const f = path.join(root, '_test', path.basename(decodeURIComponent(q.url))), out = fs.createWriteStream(f);
    q.pipe(out); out.on('finish', () => r.end('ok')); return;
  }
  let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const testDir = process.env.TEST_DIR || process.argv[2];
  const extra = testDir && p.startsWith('/test/') ? path.join(testDir, p.slice(6)) : null;
  const f = extra || path.join(root, p);
  if (!extra && !f.startsWith(root)) { r.writeHead(403); return r.end(); }
  fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end('not found'); } r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-cache' }); r.end(b); });
}).listen(port, "127.0.0.1", () => console.log('http://localhost:' + port));
