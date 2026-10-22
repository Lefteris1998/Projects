// Angle Studio local server.
// Serves the app, lists everything you drop into ./images, and stores
// computed depth maps in ./images/_depth so each image is only processed once.
// Usage: node serve.js [--open]

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 5178;
const ROOT = __dirname;
const IMG = path.join(ROOT, 'images');
const DEPTH = path.join(IMG, '_depth');
fs.mkdirSync(DEPTH, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.avif': 'image/avif', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.wasm': 'application/wasm', '.md': 'text/plain; charset=utf-8',
};
const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'];
const MODEL_EXT = ['.glb', '.gltf'];
const MAX_BODY = 60 * 1024 * 1024;

const send = (res, code, body, type = 'text/plain; charset=utf-8') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
  res.end(body);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function safeName(name) {
  const base = path.basename(String(name || '')).replace(/[^\w.\- ()]/g, '_');
  return base && !base.startsWith('.') ? base : null;
}

function listImages() {
  return fs.readdirSync(IMG, { withFileTypes: true })
    .filter(f => f.isFile())
    .map(f => f.name)
    .filter(n => [...IMAGE_EXT, ...MODEL_EXT].includes(path.extname(n).toLowerCase()))
    .map(name => {
      const stat = fs.statSync(path.join(IMG, name));
      const ext = path.extname(name).toLowerCase();
      const depthFile = path.join(DEPTH, name + '.png');
      const hasDepth = fs.existsSync(depthFile);
      return {
        name,
        kind: MODEL_EXT.includes(ext) ? 'model' : 'image',
        url: 'images/' + encodeURIComponent(name) + '?v=' + Math.round(stat.mtimeMs),
        depthUrl: hasDepth ? 'images/_depth/' + encodeURIComponent(name + '.png') + '?v=' + Math.round(fs.statSync(depthFile).mtimeMs) : null,
        mtime: stat.mtimeMs,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

// Handles /api/* requests. Returns true if the request was an API call.
// Exported so the root Projects server (../serve.js) can mount it under /angle-studio/.
async function handleApi(req, res, url, p) {
    if (p === '/api/images' && req.method === 'GET') {
      return send(res, 200, JSON.stringify(listImages()), 'application/json');
    }

    if (p === '/api/upload' && req.method === 'POST') {
      let name = safeName(url.searchParams.get('name'));
      const ext = name && path.extname(name).toLowerCase();
      if (!name || ![...IMAGE_EXT, ...MODEL_EXT].includes(ext)) return send(res, 400, 'bad name');
      const stem = name.slice(0, -ext.length);
      for (let i = 2; fs.existsSync(path.join(IMG, name)); i++) name = `${stem} (${i})${ext}`;
      fs.writeFileSync(path.join(IMG, name), await readBody(req));
      return send(res, 200, JSON.stringify({ name }), 'application/json');
    }

    if (p === '/api/depth' && req.method === 'POST') {
      const name = safeName(url.searchParams.get('name'));
      if (!name) return send(res, 400, 'bad name');
      fs.writeFileSync(path.join(DEPTH, name + '.png'), await readBody(req));
      return send(res, 200, 'ok');
    }
    return false;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      if (await handleApi(req, res, url, p) === false) send(res, 404, 'not found');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');

    let file = path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
    if (!file.startsWith(ROOT)) return send(res, 403, 'forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, String(e.message || e));
  }
});

module.exports = { handleApi, send };

if (require.main === module) server.listen(PORT, '127.0.0.1', () => {
  const link = `http://localhost:${PORT}`;
  console.log(`Angle Studio running at ${link}`);
  console.log(`Drop images (or .glb models) into: ${IMG}`);
  console.log('Close this window to stop the server.');
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${link}"` : process.platform === 'darwin' ? `open "${link}"` : `xdg-open "${link}"`;
    exec(cmd);
  }
});
