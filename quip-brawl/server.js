'use strict';
// Quip Brawl server: one lobby for everyone, gravity-flip races between phones. Each phone runs its own runner on the
// shared track (world.js) and reports where it is; the server keeps the lobby, starts races, relays positions and calls
// the winner. Plain Node, no npm packages: the WebSocket handshake and framing are done by hand below.
// The root Projects server (../serve.js) mounts it, or run it alone: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const World = require('./world.js');

const ROOT = __dirname;
const LAN_PORT = Number(process.env.PORT || process.env.GAME_PORT) || 8081;
const SHARED = Object.fromEntries(['pixel-logo.js', 'cursor.js'].map(f => [`/haunt-filter/${f}`, path.join(__dirname, '..', 'haunt-filter', f)]));
const MIN_PLAYERS = 2, MAX_PLAYERS = 8, MAX_NAME = 12;
const WAIT_MS = 10000;       // once two are ready, the race starts this long after, ready or not
const ALL_READY_MS = 3000;   // ...or this soon if everyone is ready
const COUNTDOWN_MS = 3600, RESULTS_MS = 6000, GRACE_MS = 20000, STALE_MS = 4000;
const COLORS = ['#ff5d8f', '#ffb627', '#3ddc97', '#4cc9f0', '#b388ff', '#ff7b3a', '#f72585', '#9ef01a'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const players = new Map();   // id -> { id, token, name, color, wins, ready, conn, left }
// phase: 'lobby' -> 'race' -> 'results' -> 'lobby'. race: { seed, startAt, runners: Map id -> runner state, alive }
const game = { phase: 'lobby', launchAt: 0, race: null, timer: null };

const token = () => crypto.randomBytes(12).toString('hex');
const online = () => [...players.values()].filter(p => p.conn);

// ===== Lobby =====

function lobbyMsg() {
  return {
    t: 'lobby', phase: game.phase, launchAt: game.launchAt, min: MIN_PLAYERS, max: MAX_PLAYERS,
    players: [...players.values()].map(p => ({ id: p.id, name: p.name, color: p.color, wins: p.wins, ready: p.ready, online: !!p.conn })),
  };
}

function raceMsg() {
  const r = game.race;
  return { t: 'race', seed: r.seed, startAt: r.startAt, runners: [...r.runners.keys()], out: [...r.runners].filter(([, x]) => !x.alive).map(([id]) => id) };
}

// Starts counting down once two are ready; everyone being ready cuts the wait short
function updateLaunch() {
  if (game.phase !== 'lobby') return;
  const here = online(), ready = here.filter(p => p.ready);
  if (ready.length < MIN_PLAYERS) game.launchAt = 0;
  else {
    const soon = Date.now() + (ready.length === here.length ? ALL_READY_MS : WAIT_MS);
    game.launchAt = game.launchAt ? Math.min(game.launchAt, soon) : soon;
  }
  clearTimeout(game.timer);
  if (game.launchAt) game.timer = setTimeout(startRace, game.launchAt - Date.now());
}

function startRace() {
  const runners = online().filter(p => p.ready).slice(0, MAX_PLAYERS);
  game.launchAt = 0;
  if (runners.length < MIN_PLAYERS) return broadcast(lobbyMsg());
  game.phase = 'race';
  game.race = {
    seed: crypto.randomInt(2 ** 31), startAt: Date.now() + COUNTDOWN_MS, alive: runners.length,
    runners: new Map(runners.map(p => [p.id, { x: World.START_X, y: World.START_Y, g: 1, rt: 0, st: 0, alive: true, place: 0, last: 0 }])),
  };
  broadcast(lobbyMsg());
  broadcast(raceMsg());
}

function knockOut(id) {
  const race = game.race, r = race && race.runners.get(id);
  if (game.phase !== 'race' || !r || !r.alive) return;
  r.alive = false;
  r.place = race.alive--;
  broadcast({ t: 'out', id, place: r.place });
  if (race.alive <= 1) endRace();
}

function endRace() {
  const race = game.race;
  const last = [...race.runners].find(([, r]) => r.alive);
  if (last) last[1].place = 1;
  const winner = last ? last[0] : [...race.runners].find(([, r]) => r.place === 1)?.[0];
  if (players.has(winner)) players.get(winner).wins++;
  game.phase = 'results';
  const places = [...race.runners].sort((a, b) => a[1].place - b[1].place).map(([id]) => id);
  broadcast({ t: 'end', winner, places });
  broadcast(lobbyMsg());
  clearTimeout(game.timer);
  game.timer = setTimeout(() => {
    game.phase = 'lobby';
    game.race = null;
    updateLaunch();
    broadcast(lobbyMsg());
  }, RESULTS_MS);
}

// Relay positions ~15 times a second, and knock out anyone whose phone went quiet or who is clearly behind the pursuer
setInterval(() => {
  if (game.phase !== 'race') return;
  const race = game.race, now = Date.now(), t = (now - race.startAt) / 1000;
  if (t < 0) return;
  for (const [id, r] of race.runners) {
    if (!r.alive) continue;
    if (now - Math.max(r.last, race.startAt) > STALE_MS || r.x < World.pursuerX(t - 2)) knockOut(id);
  }
  if (game.phase !== 'race') return;
  const p = [];
  for (const [id, r] of race.runners) if (r.alive) p.push([id, r.x, r.y, r.g, r.rt, r.st]);
  broadcast({ t: 'snap', p });
}, 66).unref();

// Players who closed the page get a short grace period to come back (a refresh, a dropped connection) before they go
setInterval(() => {
  let gone = false;
  for (const [id, p] of players) if (!p.conn && Date.now() - p.left > GRACE_MS) { players.delete(id); gone = true; }
  if (gone) { updateLaunch(); broadcast(lobbyMsg()); }
}, 5000).unref();

const cleanName = n => String(n || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);

function onMessage(conn, m) {
  if (m.t === 'ping') return send(conn, { t: 'pong', c: m.c, s: Date.now() });

  if (m.t === 'hello') {
    let p = [...players.values()].find(x => x.token === m.token && m.token);
    const name = cleanName(m.name);
    if (!p) {
      if (!name) return send(conn, { t: 'error', msg: 'Pick a name first.' });
      if (players.size >= MAX_PLAYERS) return send(conn, { t: 'error', msg: `Lobby is full (${MAX_PLAYERS} max). Try again in a bit.` });
      if ([...players.values()].some(x => x.name.toLowerCase() === name.toLowerCase())) return send(conn, { t: 'error', msg: 'Someone already has that name.' });
      const used = new Set([...players.values()].map(x => x.color));
      p = { id: token(), token: token(), name, color: COLORS.find(c => !used.has(c)), wins: 0, ready: false, conn: null, left: 0 };
      players.set(p.id, p);
    }
    if (p.conn && p.conn !== conn) p.conn.sock.destroy();
    p.conn = conn;
    conn.player = p;
    send(conn, { t: 'welcome', id: p.id, token: p.token, name: p.name });
    updateLaunch();
    broadcast(lobbyMsg());
    if (game.race) send(conn, raceMsg());
    return;
  }

  const p = conn.player;
  if (!p) return;
  switch (m.t) {
    case 'ready':
      p.ready = !!m.on;
      updateLaunch();
      broadcast(lobbyMsg());
      break;
    case 'pos': {
      const r = game.phase === 'race' && game.race.runners.get(p.id);
      if (!r || !r.alive) break;
      Object.assign(r, { x: +m.x || 0, y: +m.y || 0, g: m.g < 0 ? -1 : 1, rt: +m.rt || 0, st: m.st ? 1 : 0, last: Date.now() });
      break;
    }
    case 'dead':
      knockOut(p.id);
      break;
    case 'leave':
      players.delete(p.id);
      conn.player = null;
      knockOut(p.id);
      updateLaunch();
      broadcast(lobbyMsg());
      break;
  }
}

function onClose(conn) {
  const p = conn.player;
  if (!p || p.conn !== conn) return;
  p.conn = null;
  p.left = Date.now();
  p.ready = false;
  knockOut(p.id);
  updateLaunch();
  broadcast(lobbyMsg());
}

// ===== WebSocket (RFC 6455, just the parts browsers use: text frames, ping, close) =====

const conns = new Set();

function frame(data, op = 1) {
  const len = data.length;
  let head;
  if (len < 126) head = Buffer.from([0x80 | op, len]);
  else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([head, data]);
}

function send(conn, msg) {
  if (!conn.sock.destroyed) conn.sock.write(frame(Buffer.from(JSON.stringify(msg))));
}

function broadcast(msg) {
  const f = frame(Buffer.from(JSON.stringify(msg)));
  for (const c of conns) if (c.player && !c.sock.destroyed) c.sock.write(f);
}

// Accepts WebSocket connections on any path ending in /ws (/ws on its own, /quip-brawl/ws inside the Projects hub)
function handleUpgrade(req, sock) {
  const key = req.headers['sec-websocket-key'];
  if (!req.url.split('?')[0].endsWith('/ws') || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) return sock.destroy();
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  sock.setNoDelay(true);
  const conn = { sock, player: null };
  conns.add(conn);
  let buf = Buffer.alloc(0);
  sock.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 15, masked = buf[1] & 0x80;
      let len = buf[1] & 127, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > 65536) return sock.destroy();
      const start = off + (masked ? 4 : 0);
      if (buf.length < start + len) return;
      const data = Buffer.from(buf.subarray(start, start + len));
      if (masked) for (let i = 0; i < len; i++) data[i] ^= buf[off + (i & 3)];
      buf = buf.subarray(start + len);
      if (op === 8) return sock.end(frame(Buffer.alloc(0), 8));
      if (op === 9) sock.write(frame(data, 10));
      else if (op === 1) {
        let m;
        try { m = JSON.parse(data.toString()); } catch { continue; }
        if (m && typeof m === 'object') onMessage(conn, m);
      }
    }
  });
  sock.on('close', () => { conns.delete(conn); onClose(conn); });
  sock.on('error', () => {});
}

// ===== Static files =====

function sendText(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

// "/" is the game; the logo and cursor scripts are shared with the other projects and live in the Haunt Filter folder
function handleRequest(req, res) {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendText(res, 405, 'method not allowed');
    const shared = SHARED[p];
    const file = shared || path.normalize(path.join(ROOT, p === '/' ? 'index.html' : p));
    if (!shared && !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return sendText(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    sendText(res, 500, String(e.message || e));
  }
}

function lanUrls() {
  const ips = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
  }
  // Home Wi-Fi addresses first; VPN/virtual adapters tend to use other ranges
  ips.sort((a, b) => b.startsWith('192.168.') - a.startsWith('192.168.'));
  return ips.map(ip => `http://${ip}:${LAN_PORT}/`);
}

// Listens on all network interfaces so phones on the same Wi-Fi can reach it
function listenLan(cb) {
  const server = http.createServer(handleRequest);
  server.on('upgrade', handleUpgrade);
  server.on('error', e => console.error(`Quip Brawl: couldn't open port ${LAN_PORT} for phones (${e.code}).`));
  server.listen(LAN_PORT, '0.0.0.0', () => cb && cb(lanUrls()));
  return server;
}

module.exports = { handleUpgrade, listenLan, LAN_PORT };

if (require.main === module) {
  listenLan(urls => console.log(`Quip Brawl: open ${urls[0] || `http://localhost:${LAN_PORT}/`} on every phone`));
}
