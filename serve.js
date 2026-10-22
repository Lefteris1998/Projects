// Serves every project from one place so the links on index.html all work.
// Opening index.html straight from disk (file://) breaks things: Stockfish workers,
// ES modules and Angle Studio's /api calls all need a real http:// origin.
// Usage: node serve.js [--open]   (or double-click start.bat)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const angle = require('./angle-studio/serve.js');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.md': 'text/plain; charset=utf-8',
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = decodeURIComponent(url.pathname);

    if (p.startsWith('/angle-studio/api/')) {
      if (await angle.handleApi(req, res, url, p.slice('/angle-studio'.length)) === false) angle.send(res, 404, 'not found');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return angle.send(res, 405, 'method not allowed');

    let file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) return angle.send(res, 403, 'forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      // "/angle-studio" -> "/angle-studio/" so the page's relative links resolve inside the folder
      if (!p.endsWith('/')) { res.writeHead(301, { Location: p + '/' + url.search }); return res.end(); }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) return angle.send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    angle.send(res, 500, String(e.message || e));
  }
}).listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}/` + (process.argv.find(a => a.startsWith('--page=')) || '').slice(7);
  console.log(`Projects running at http://localhost:${PORT}  (close this window to stop)`);
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
    exec(cmd);
  }
});
