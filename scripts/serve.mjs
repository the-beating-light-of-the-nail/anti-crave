// Tiny zero-dependency preview server for dist/.
// API calls return a local-mode response so the frontend exercises its fallback.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'dist');
const PORT = Number(process.env.PORT) || 8788;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.ico': 'image/x-icon',
};

function fileFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const clean = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  let file = join(ROOT, clean);
  if (clean === '/' || clean.endsWith('/')) file = join(file, 'index.html');
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file) && !extname(file) && existsSync(`${file}/index.html`)) {
    file = `${file}/index.html`;
  }
  if (!existsSync(file) && !extname(file) && existsSync(`${file}.html`)) {
    file = `${file}.html`;
  }
  return file;
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: true, mode: 'local' }));
    return;
  }

  const file = fileFor(req.url);
  if (!existsSync(file) || !statSync(file).isFile()) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end('<h1>404</h1><p>Run <code>npm run build</code> first.</p>');
    return;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', MIME[extname(file)] || 'application/octet-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  createReadStream(file).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Anti-Crave preview: http://localhost:${PORT}`);
  console.log(`  http://localhost:${PORT}/zh  /ko  /ja`);
});
