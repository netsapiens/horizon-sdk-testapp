// Tamper-test harness for design §3.3's transitive-integrity claim.
//
// Two ORIGINS, deliberately — SRI's crossorigin requirement only bites
// cross-origin, so a same-origin test would prove less than the real setup:
//   http://localhost:4101  the "portal"  (serves the loader page)
//   http://localhost:4102  the "CDN"     (serves the bundle, with CORS)
//
// The portal computes the remoteEntry pin ONCE at startup and caches it. That
// mirrors the API computing a hash at submission time; the bytes on disk can then
// be tampered with afterwards while the pin stays fixed, which is exactly the
// scenario the design defends against.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIST = path.resolve(__dirname, '..', 'dist', 'v1.0.0');
const HOST_PORT = 4101;
const CDN_PORT = 4102;

const sri = (buf) =>
  'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');

// Captured at "verification time" and never recomputed.
const PINNED = sri(fs.readFileSync(path.join(DIST, 'remoteEntry.js')));
console.log('pinned remoteEntry:', PINNED);

const TYPES = {
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.map': 'application/json',
  '.html': 'text/html',
};

// ── CDN: serves the bundle cross-origin with CORS, no caching ──────────────
http
  .createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
    const file = path.join(DIST, rel);
    if (!file.startsWith(DIST) || !fs.existsSync(file)) {
      res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      // Required for SRI on a cross-origin resource: without this the response
      // is opaque and the browser cannot verify it.
      'Access-Control-Allow-Origin': '*',
      // Tampering happens between page loads; a cached chunk would mask it.
      'Cache-Control': 'no-store, must-revalidate',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(CDN_PORT, () => console.log(`cdn    http://localhost:${CDN_PORT}`));

// ── Portal: loader page + the pin endpoint ────────────────────────────────
http
  .createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/pin') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      return res.end(JSON.stringify({ integrity: PINNED }));
    }
    const file = path.join(__dirname, url === '/' ? 'index.html' : url);
    if (!file.startsWith(__dirname) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end('not found');
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'text/plain',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  })
  .listen(HOST_PORT, () => console.log(`portal http://localhost:${HOST_PORT}`));
