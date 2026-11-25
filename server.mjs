// server.mjs — static server for the Receipt Audit Network.
//
// A plain static host is not enough here: the spec requires the public artefacts
// (manifest, network, links, bridge) to be readable across origins, so every response
// carries an explicit CORS header. Everything else is a file read.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname);
const PORT = Number(process.env.PORT || 8090);
const HOST = '0.0.0.0';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.hocon': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  // Public artefacts are meant to be cacheable by peers, but not so long that a fix
  // takes a day to reach them.
  'Access-Control-Max-Age': '600',
  'Timing-Allow-Origin': '*',
};

/** Resolve a URL path to a file inside ROOT, refusing traversal. */
function toFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const full = join(ROOT, clean);
  if (!full.startsWith(ROOT)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...CORS, Allow: 'GET, HEAD, OPTIONS' });
    res.end('Method not allowed');
    return;
  }

  let pathname = url.pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';

  // The runtime asks for the network by name; keep that resolving to the page.
  if (pathname === '/receipt_audit') {
    res.writeHead(302, { ...CORS, Location: '/index.html' });
    res.end();
    return;
  }

  let file = toFile(pathname);
  if (!file) {
    res.writeHead(400, CORS);
    res.end('Bad path');
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) {
      file = join(file, 'index.html');
    }
    const body = await readFile(file);
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      ...CORS,
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff',
      // The site is meant to be embedded and called by peers.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  } catch {
    res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Receipt Audit Network on http://${HOST}:${PORT}/ (CORS: *)`);
});
