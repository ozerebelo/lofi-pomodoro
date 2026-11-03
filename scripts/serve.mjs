// Servidor estático mínimo, sem dependências: `npm start` → http://localhost:5173
//
// É preciso abrir a app por http(s):// e não como ficheiro (file://), porque o
// leitor do YouTube recusa funcionar sem um "Referer" válido (erro 153).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './security-headers.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 5173;
const HOST = process.env.HOST || '127.0.0.1';
// Os mesmos cabeçalhos de segurança da produção (sem HSTS/upgrade, que exigem https).
const SECURITY_HEADERS = securityHeaders({ dev: true });
const BLOCKED = /(^|[\\/])(\.[^\\/]+|node_modules)([\\/]|$)/;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(ROOT, path));
    if ((file !== ROOT && !file.startsWith(ROOT + sep)) || BLOCKED.test(file.slice(ROOT.length))) {
      res.writeHead(403).end('Proibido');
      return;
    }
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  🍅🎧 lofi pomodoro a correr em http://localhost:${PORT}\n`);
});
