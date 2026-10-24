// Quip Brawl game server. Rooms, phases and timers all live here; the screens just render what they're sent.
// Phones talk to it over plain HTTP: POSTs for actions, Server-Sent Events for live updates (no npm packages).
// The root Projects server (../serve.js) mounts it, or run it alone: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const PROMPTS = require('./prompts.js');

const ROOT = __dirname;
const LAN_PORT = Number(process.env.PORT || process.env.GAME_PORT) || 8081;
const SHARED = Object.fromEntries(['pixel-logo.js', 'cursor.js'].map(f => [`/haunt-filter/${f}`, path.join(__dirname, '..', 'haunt-filter', f)]));
const ROUNDS = 3;
const ANSWER_MS = 90000, VOTE_MS = 20000, REVEAL_MS = 8000, SCORES_MS = 9000;
const MIN_PLAYERS = 3, MAX_PLAYERS = 8;
const MAX_NAME = 12, MAX_ANSWER = 60;
const COLORS = ['#ff5d8f', '#ffb627', '#3ddc97', '#4cc9f0', '#b388ff', '#ff7b3a', '#f72585', '#9ef01a'];

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
};

const rooms = new Map();

const token = () => crypto.randomBytes(12).toString('hex');
const shuffle = arr => {
  for (let i = arr.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
};

function newCode() {
  const A = 'BCDFGHJKLMNPQRSTVWXZ'; // consonants only, so codes never spell anything
  let code;
  do code = Array.from({ length: 4 }, () => A[crypto.randomInt(A.length)]).join('');
  while (rooms.has(code));
  return code;
}

function createRoom() {
  const room = {
    code: newCode(), hostToken: token(), players: [], phase: 'lobby', round: 0,
    prompts: [], voteIdx: 0, deadline: 0, timer: null, clients: new Set(), used: new Set(), touched: Date.now(),
  };
  rooms.set(room.code, room);
  return room;
}

// ===== Game flow =====

function setTimer(room, ms, fn) {
  clearTimeout(room.timer);
  room.deadline = ms ? Date.now() + ms : 0;
  room.timer = ms ? setTimeout(() => { fn(room); broadcast(room); }, ms) : null;
}

function pickPrompts(room, n) {
  let pool = PROMPTS.filter(t => !room.used.has(t));
  if (pool.length < n) { room.used.clear(); pool = PROMPTS.slice(); }
  const picked = shuffle(pool).slice(0, n);
  picked.forEach(t => room.used.add(t));
  return picked;
}

// Every prompt goes to two players and every player gets two prompts: prompt k -> players k and k+1.
function startRound(room) {
  room.round++;
  const order = shuffle(room.players.map(p => p.id));
  const n = order.length;
  room.prompts = pickPrompts(room, n).map((text, k) => ({
    id: k, text, authors: [order[k], order[(k + 1) % n]], answers: {}, votes: {}, side: [0, 1], result: null,
  }));
  room.phase = 'answer';
  setTimer(room, ANSWER_MS, endAnswers);
}

function endAnswers(room) {
  for (const pr of room.prompts) for (const a of pr.authors) if (pr.answers[a] === undefined) pr.answers[a] = null;
  room.prompts = shuffle(room.prompts.filter(pr => pr.authors.some(a => pr.answers[a])));
  room.voteIdx = 0;
  if (room.prompts.length) startVote(room); else showScores(room);
}

function startVote(room) {
  const pr = room.prompts[room.voteIdx];
  pr.side = shuffle([0, 1]);
  room.phase = 'vote';
  setTimer(room, VOTE_MS, reveal);
}

function voters(room, pr) { return room.players.filter(p => !pr.authors.includes(p.id)); }

function reveal(room) {
  const pr = room.prompts[room.voteIdx];
  const total = Object.keys(pr.votes).length;
  pr.result = pr.authors.map(a => {
    const votes = Object.values(pr.votes).filter(v => v === a).length;
    const sweep = total > 0 && votes === total && voters(room, pr).length > 1;
    const points = (votes * 100 + (sweep ? 250 : 0)) * room.round;
    const player = room.players.find(p => p.id === a);
    if (player) player.score += points;
    return { votes, points, sweep };
  });
  room.phase = 'reveal';
  setTimer(room, REVEAL_MS, r => {
    if (++r.voteIdx < r.prompts.length) startVote(r); else showScores(r);
  });
}

function showScores(room) {
  room.phase = 'scores';
  setTimer(room, SCORES_MS, r => {
    if (r.round < ROUNDS) startRound(r);
    else { r.phase = 'final'; setTimer(r, 0); }
  });
}

function backToLobby(room) {
  room.players = room.players.filter(p => p.conns > 0);
  room.players.forEach(p => { p.score = 0; });
  room.round = 0;
  room.prompts = [];
  room.phase = 'lobby';
  setTimer(room, 0);
}

function checkAllAnswered(room) {
  if (room.prompts.every(pr => pr.authors.every(a => pr.answers[a] !== undefined))) endAnswers(room);
}

function checkAllVoted(room) {
  const pr = room.prompts[room.voteIdx];
  if (voters(room, pr).every(p => pr.votes[p.id] !== undefined)) reveal(room);
}

// ===== Views: what each screen is allowed to see =====

function publicPlayers(room) {
  return room.players.map((p, i) => ({
    id: p.id, name: p.name, score: p.score, color: p.color, connected: p.conns > 0, vip: i === 0,
  }));
}

function remaining(room) { return room.deadline ? Math.max(0, room.deadline - Date.now()) : 0; }

function hostView(room) {
  const v = {
    role: 'host', code: room.code, phase: room.phase, round: room.round, rounds: ROUNDS,
    remaining: remaining(room), players: publicPlayers(room), minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
  };
  if (room.phase === 'answer') {
    v.done = room.players.filter(p => room.prompts.every(pr => !pr.authors.includes(p.id) || pr.answers[p.id] !== undefined)).map(p => p.id);
  }
  if (room.phase === 'vote' || room.phase === 'reveal') {
    const pr = room.prompts[room.voteIdx];
    const shown = room.phase === 'reveal';
    v.prompt = {
      text: pr.text, index: room.voteIdx + 1, total: room.prompts.length,
      options: pr.side.map(i => {
        const author = pr.authors[i];
        const o = { text: pr.answers[author] };
        if (shown) {
          Object.assign(o, pr.result[i], { author, voters: Object.keys(pr.votes).filter(k => pr.votes[k] === author) });
        }
        return o;
      }),
    };
    v.voted = Object.keys(pr.votes);
    v.authors = pr.authors;
  }
  return v;
}

function playerView(room, p) {
  const idx = room.players.indexOf(p);
  const v = {
    role: 'player', code: room.code, phase: room.phase, round: room.round, rounds: ROUNDS, remaining: remaining(room),
    me: { id: p.id, name: p.name, score: p.score, color: p.color, vip: idx === 0 },
    playerCount: room.players.length, minPlayers: MIN_PLAYERS,
  };
  if (room.phase === 'answer') {
    const todo = room.prompts.filter(pr => pr.authors.includes(p.id) && pr.answers[p.id] === undefined);
    v.todo = todo.length ? { id: todo[0].id, text: todo[0].text, left: todo.length } : null;
  }
  if (room.phase === 'vote') {
    const pr = room.prompts[room.voteIdx];
    if (pr.authors.includes(p.id)) v.vote = { mine: true, key: pr.id };
    else {
      const mine = pr.votes[p.id];
      v.vote = {
        key: pr.id, text: pr.text,
        options: pr.side.map(i => pr.answers[pr.authors[i]]),
        voted: mine === undefined ? null : pr.side.findIndex(i => pr.authors[i] === mine),
      };
    }
  }
  if (room.phase === 'scores' || room.phase === 'final') {
    const sorted = room.players.slice().sort((a, b) => b.score - a.score);
    v.rank = sorted.findIndex(x => x.score === p.score) + 1;
  }
  return v;
}

// ===== Transport =====

function push(room, c) {
  const view = c.host ? hostView(room) : playerView(room, c.player);
  c.res.write(`data: ${JSON.stringify(view)}\n\n`);
}

function broadcast(room) {
  room.touched = Date.now();
  for (const c of room.clients) {
    if (c.player && !room.players.includes(c.player)) { c.res.write('event: gone\ndata: {}\n\n'); c.res.end(); room.clients.delete(c); continue; }
    push(room, c);
  }
}

function openStream(req, res, room, who) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const c = { res, ...who };
  room.clients.add(c);
  if (c.player) c.player.conns++;
  broadcast(room);
  req.on('close', () => {
    room.clients.delete(c);
    if (c.player) c.player.conns--;
    broadcast(room);
  });
}

// Keep streams alive through proxies/sleepy phones, and forget rooms nobody has touched in a while.
setInterval(() => {
  for (const [code, room] of rooms) {
    for (const c of room.clients) c.res.write(': ping\n\n');
    if (!room.clients.size && Date.now() - room.touched > 3 * 3600e3) { clearTimeout(room.timer); rooms.delete(code); }
  }
}, 15000).unref();

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' });
  res.end(JSON.stringify(obj));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => { data += c; if (data.length > 10000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); } });
    req.on('error', reject);
  });
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

function findPlayer(room, body) {
  return room.players.find(p => p.id === body.id && p.secret === body.secret);
}

// Handles /api/* requests (p is relative to the game folder). Returns false if p isn't an API route.
async function handleApi(req, res, url, p) {
  if (p === '/api/info' && req.method === 'GET') return json(res, 200, { urls: lanUrls(), port: LAN_PORT });

  if (p === '/api/events' && req.method === 'GET') {
    const q = url.searchParams;
    const room = rooms.get(String(q.get('code') || '').toUpperCase());
    const host = room && q.get('host') === room.hostToken;
    const player = room && !host && findPlayer(room, { id: q.get('id'), secret: q.get('secret') });
    if (!host && !player) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      return res.end('event: gone\ndata: {}\n\n');
    }
    return openStream(req, res, room, host ? { host: true } : { player });
  }

  if (req.method !== 'POST') return false;

  if (p === '/api/create') {
    const room = createRoom();
    return json(res, 200, { code: room.code, hostToken: room.hostToken });
  }

  const body = await readJson(req);
  const room = rooms.get(String(body.code || '').trim().toUpperCase());

  if (p === '/api/join') {
    if (!room) return json(res, 404, { error: "That room doesn't exist. Check the code on the big screen." });
    const back = findPlayer(room, body);
    if (back) return json(res, 200, { id: back.id, secret: back.secret, code: room.code });
    const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
    if (!name) return json(res, 400, { error: 'Pick a name first.' });
    if (room.phase !== 'lobby') return json(res, 409, { error: 'That game has already started. Wait for the next one!' });
    if (room.players.length >= MAX_PLAYERS) return json(res, 409, { error: `Room is full (${MAX_PLAYERS} players max).` });
    if (room.players.some(x => x.name.toLowerCase() === name.toLowerCase())) return json(res, 409, { error: 'Someone already has that name.' });
    const used = new Set(room.players.map(x => x.color));
    const player = { id: token(), secret: token(), name, score: 0, conns: 0, color: COLORS.find(c => !used.has(c)) };
    room.players.push(player);
    broadcast(room);
    return json(res, 200, { id: player.id, secret: player.secret, code: room.code });
  }

  if (p === '/api/action') {
    if (!room) return json(res, 404, { error: 'Room is gone.' });
    const host = body.host && body.host === room.hostToken;
    const player = !host && findPlayer(room, body);
    if (!host && !player) return json(res, 403, { error: 'Not in this room.' });
    const vip = host || room.players[0] === player;
    const fail = msg => json(res, 400, { error: msg });

    switch (body.type) {
      case 'start': {
        if (!vip || room.phase !== 'lobby') return fail('Only the VIP can start.');
        room.players = room.players.filter(x => x.conns > 0);
        if (room.players.length < MIN_PLAYERS) { broadcast(room); return fail(`Need at least ${MIN_PLAYERS} players.`); }
        startRound(room);
        break;
      }
      case 'answer': {
        const pr = room.prompts.find(x => x.id === body.promptId);
        const text = String(body.text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_ANSWER);
        if (room.phase !== 'answer' || !player || !pr || !pr.authors.includes(player.id) || pr.answers[player.id] !== undefined) return fail('Too late for that one.');
        if (!text) return fail('Write something!');
        pr.answers[player.id] = text;
        checkAllAnswered(room);
        break;
      }
      case 'vote': {
        const pr = room.prompts[room.voteIdx];
        if (room.phase !== 'vote' || !player || pr.authors.includes(player.id) || pr.votes[player.id] !== undefined) return fail("Can't vote right now.");
        if (body.side !== 0 && body.side !== 1) return fail('Bad vote.');
        pr.votes[player.id] = pr.authors[pr.side[body.side]];
        checkAllVoted(room);
        break;
      }
      case 'again': {
        if (!vip || room.phase !== 'final') return fail('Only the VIP can restart.');
        backToLobby(room);
        break;
      }
      case 'kick': {
        const target = room.players.find(x => x.id === body.target);
        if (!host || room.phase !== 'lobby' || !target) return fail("Can't remove that player.");
        room.players = room.players.filter(x => x !== target);
        break;
      }
      default: return fail('Unknown action.');
    }
    broadcast(room);
    return json(res, 200, { ok: true });
  }

  return false;
}

function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

// Request handler for the phone-facing port: "/" is the join page, "/host" the big screen.
async function handleRequest(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    if (p.startsWith('/api/')) {
      if (await handleApi(req, res, url, p) === false) send(res, 404, 'not found');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
    const rel = p === '/' ? 'join.html' : p === '/host' ? 'index.html' : p;
    // the logo and cursor scripts are shared with the other projects and live in the Haunt Filter folder
    const shared = SHARED[p];
    const file = shared || path.normalize(path.join(ROOT, rel));
    if (!shared && !file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'not found');
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    send(res, 500, String(e.message || e));
  }
}

// Listens on all network interfaces so phones on the same Wi-Fi can reach it.
function listenLan(cb) {
  const server = http.createServer(handleRequest);
  server.on('error', e => console.error(`Quip Brawl: couldn't open port ${LAN_PORT} for phones (${e.code}).`));
  server.listen(LAN_PORT, '0.0.0.0', () => cb && cb(lanUrls()));
  return server;
}

module.exports = { handleApi, listenLan, LAN_PORT };

if (require.main === module) {
  listenLan(urls => {
    console.log(`Quip Brawl host screen: http://localhost:${LAN_PORT}/host`);
    console.log(`Phones join at: ${urls[0] || `http://localhost:${LAN_PORT}/`}`);
  });
}
