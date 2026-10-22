// Tiny static server so the app runs on http://localhost instead of file://.
// Chrome only remembers microphone permission for real origins — on file:// it asks every time.
// Usage: node serve.js   (or double-click start.bat)

const http = require('http');
const fs   = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.ogg':  'audio/ogg',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.json': 'application/json',
};

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(ROOT, urlPath));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); } // no ../ escapes

  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Blindfold Chess running at http://localhost:${PORT}  (Ctrl+C to stop)`);
});
