'use strict';
// ---------------------------------------------------------------------------
// Pure rules engine. Every public function takes a state and returns a NEW
// state (or plain data), so the UI can preview, predict and take back freely.
// ---------------------------------------------------------------------------

const SIZE = 8;
const DEG = Math.PI / 180;
const FILES = 'abcdefgh';
const HIT_R = 0.45; // pellet hit radius of a piece, in squares

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const ALL8 = ORTHO.concat(DIAG);
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const SLIDE = { B: DIAG, R: ORTHO, Q: ALL8 };
const KING_MARK = { type: '@' };

const sqName = (x, y) => FILES[x] + (SIZE - y);
const inBoard = (x, y) => x >= 0 && y >= 0 && x < SIZE && y < SIZE;
const cheb = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));
const clone = o => JSON.parse(JSON.stringify(o));
const pieceLetter = t => (t === 'P' ? '' : t);

function grid(s, withKing) {
  const g = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  for (const p of s.pieces) g[p.y][p.x] = p;
  if (withKing) g[s.king.y][s.king.x] = KING_MARK;
  return g;
}

// Squares a white piece of `type` standing on (x,y) attacks.
function attacksFrom(type, x, y, g) {
  const out = [];
  if (type === 'P') {
    for (const dx of [-1, 1]) if (inBoard(x + dx, y + 1)) out.push([x + dx, y + 1]);
  } else if (type === 'N' || type === 'K') {
    for (const [dx, dy] of type === 'N' ? KNIGHT : ALL8) if (inBoard(x + dx, y + dy)) out.push([x + dx, y + dy]);
  } else {
    for (const [dx, dy] of SLIDE[type]) {
      let nx = x + dx, ny = y + dy;
      while (inBoard(nx, ny)) {
        out.push([nx, ny]);
        if (g[ny][nx]) break;
        nx += dx; ny += dy;
      }
    }
  }
  return out;
}

// Count of attackers per square. The black king is lifted off the board so
// lines pass through its square (stepping back along a rook line is not safe).
function attackMap(s) {
  const g = grid(s, false);
  const m = new Uint8Array(SIZE * SIZE);
  for (const p of s.pieces) for (const [x, y] of attacksFrom(p.type, p.x, p.y, g)) m[y * SIZE + x]++;
  return m;
}

function inCheck(s) {
  return attackMap(s)[s.king.y * SIZE + s.king.x] > 0;
}

function attackersOfKing(s) {
  const g = grid(s, false);
  return s.pieces.filter(p => attacksFrom(p.type, p.x, p.y, g).some(([x, y]) => x === s.king.x && y === s.king.y));
}

function kingMoves(s) {
  const m = attackMap(s), g = grid(s, false), out = [];
  for (const [dx, dy] of ALL8) {
    const x = s.king.x + dx, y = s.king.y + dy;
    if (inBoard(x, y) && !g[y][x] && !m[y * SIZE + x]) out.push({ x, y });
  }
  return out;
}

// Moves for the king while borrowing a soul (moves like that piece, once).
function soulMoves(s, type) {
  const m = attackMap(s), g = grid(s, false), out = [];
  const { x: kx, y: ky } = s.king;
  if (type === 'N') {
    for (const [dx, dy] of KNIGHT) {
      const x = kx + dx, y = ky + dy;
      if (inBoard(x, y) && !g[y][x] && !m[y * SIZE + x]) out.push({ x, y });
    }
  } else {
    for (const [dx, dy] of SLIDE[type]) {
      let x = kx + dx, y = ky + dy;
      while (inBoard(x, y) && !g[y][x]) {
        if (!m[y * SIZE + x]) out.push({ x, y });
        x += dx; y += dy;
      }
    }
  }
  return out;
}

function exitDist(ox, oy, dx, dy) {
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (SIZE - ox) / dx);
  if (dx < 0) t = Math.min(t, -ox / dx);
  if (dy > 0) t = Math.min(t, (SIZE - oy) / dy);
  if (dy < 0) t = Math.min(t, -oy / dy);
  return t;
}

// Deterministic spread: pellets are fanned evenly across the cone, so every
// shot can be calculated exactly (no "missed at point-blank" RNG).
function traceShot(s, angle) {
  const st = s.stats, ox = s.king.x + 0.5, oy = s.king.y + 0.5, n = st.pellets;
  const pellets = [], dmg = new Map();
  for (let i = 0; i < n; i++) {
    const a = angle + (n === 1 ? 0 : (i / (n - 1) - 0.5)) * st.spread * DEG;
    const dx = Math.cos(a), dy = Math.sin(a);
    const cand = [];
    for (const p of s.pieces) {
      const cx = p.x + 0.5 - ox, cy = p.y + 0.5 - oy, t = cx * dx + cy * dy;
      if (t <= 0) continue;
      const perp2 = cx * cx + cy * cy - t * t;
      if (perp2 > HIT_R * HIT_R) continue;
      const th = t - Math.sqrt(HIT_R * HIT_R - perp2);
      if (th <= st.range) cand.push({ id: p.id, t: th });
    }
    cand.sort((a, b) => a.t - b.t);
    const hits = cand.slice(0, 1 + st.pierce);
    for (const h of hits) dmg.set(h.id, (dmg.get(h.id) || 0) + st.damage);
    let len = hits.length === 1 + st.pierce ? hits[hits.length - 1].t : st.range;
    len = Math.min(len, exitDist(ox, oy, dx, dy));
    pellets.push({ x1: ox, y1: oy, x2: ox + dx * len, y2: oy + dy * len, hit: hits.length > 0 });
  }
  return { pellets, dmg };
}

function removePiece(s, id) {
  s.pieces = s.pieces.filter(p => p.id !== id);
}

// Mutates s. Returns a 'shot' event describing what happened.
function applyShot(s, angle) {
  const tr = traceShot(s, angle);
  const ev = { type: 'shot', angle, pellets: tr.pellets, hits: [], knock: [] };
  s.loaded--;
  s.shots++;
  for (const [id, d] of tr.dmg) {
    const p = s.pieces.find(q => q.id === id);
    p.hp -= d;
    ev.hits.push({ id, x: p.x, y: p.y, type: p.type, dmg: d, killed: p.hp <= 0 });
  }
  for (const h of ev.hits) {
    if (!h.killed) continue;
    removePiece(s, h.id);
    s.kills++;
    s.captured.push(h.type);
    if (h.type === 'K') s.kingDead = true;
    if (PIECES[h.type].soul && s.souls.length < s.stats.soulSlots) { s.souls.push(h.type); h.soul = true; }
    if (s.stats.scavenger) s.reserve += s.stats.scavenger;
  }
  if (s.stats.knockback) {
    const g = grid(s, true);
    const survivors = ev.hits.filter(h => !h.killed)
      .sort((a, b) => cheb(b.x, b.y, s.king.x, s.king.y) - cheb(a.x, a.y, s.king.x, s.king.y));
    for (const h of survivors) {
      const p = s.pieces.find(q => q.id === h.id);
      const vx = p.x - s.king.x, vy = p.y - s.king.y, d = Math.max(Math.abs(vx), Math.abs(vy));
      const nx = p.x + (Math.abs(vx) * 2 >= d ? Math.sign(vx) : 0);
      const ny = p.y + (Math.abs(vy) * 2 >= d ? Math.sign(vy) : 0);
      if (inBoard(nx, ny) && !g[ny][nx]) {
        g[p.y][p.x] = null; g[ny][nx] = p;
        ev.knock.push({ id: p.id, from: { x: p.x, y: p.y }, to: { x: nx, y: ny } });
        p.x = nx; p.y = ny;
      }
    }
  }
  return ev;
}

function isWon(s) {
  if (s.objective === 'king') return s.kingDead;
  return s.pieces.length === 0 && (!s.reinf || s.reinf.idx >= s.reinf.pool.length);
}

function shotNote(ev) {
  if (!ev.hits.length) return 'Fire: miss';
  return 'Fire ' + ev.hits.map(h => (h.killed ? '×' : '') + pieceLetter(h.type) + sqName(h.x, h.y) + (h.killed ? '' : `(−${h.dmg})`)).join(' ');
}

// The player's action. action: {type:'move', x, y, soulIdx?} | {type:'shoot', angle} | {type:'wait'}
function playerAct(state, action) {
  const s = clone(state);
  const events = [];
  let note;
  if (action.type === 'move') {
    const soulType = action.soulIdx >= 0 ? s.souls[action.soulIdx] : null;
    const legal = soulType ? soulMoves(s, soulType) : kingMoves(s);
    if (!legal.some(m => m.x === action.x && m.y === action.y)) {
      return { ok: false, reason: 'That square is attacked — your king would be captured.' };
    }
    const from = { x: s.king.x, y: s.king.y };
    s.king.x = action.x; s.king.y = action.y;
    if (soulType) s.souls.splice(action.soulIdx, 1);
    const r = Math.max(0, Math.min(s.stats.reloadPerMove, s.reserve, s.stats.capacity - s.loaded));
    s.loaded += r; s.reserve -= r;
    events.push({ type: 'kmove', from, to: { x: action.x, y: action.y }, reload: r, soul: soulType });
    note = 'K' + (soulType ? `(${soulType})` : '') + sqName(action.x, action.y);
    s.lastMove = [from, { x: action.x, y: action.y }];
  } else if (action.type === 'shoot') {
    if (s.loaded <= 0) return { ok: false, reason: 'No shells loaded — move to reload.' };
    const ev = applyShot(s, action.angle);
    if (!s.kingDead && inCheck(s)) {
      return { ok: false, exposes: true, reason: 'Illegal: that shot leaves your king in check!' };
    }
    events.push(ev);
    note = shotNote(ev);
    s.lastMove = null;
  } else if (action.type === 'wait') {
    if (hasLegalAction(s)) return { ok: false, reason: 'You still have a legal move.' };
    const r = Math.min(1, s.reserve, s.stats.capacity - s.loaded);
    s.loaded += r; s.reserve -= r;
    events.push({ type: 'pass' });
    note = 'Wait';
  }
  s.turn++;
  s.log.push({ n: s.turn, you: note, them: [], check: false });
  if (isWon(s)) s.status = 'won';
  else if (s.loaded + s.reserve <= 0) { s.status = 'lost'; s.lostReason = 'Out of shells'; }
  return { ok: true, state: s, events };
}

// ---- enemy AI -------------------------------------------------------------

function pieceMoves(s, p) {
  const g = grid(s, true), out = [];
  if (p.type === 'P') {
    if (inBoard(p.x, p.y + 1) && !g[p.y + 1][p.x]) out.push({ x: p.x, y: p.y + 1 });
    return out;
  }
  for (const [x, y] of attacksFrom(p.type, p.x, p.y, g)) if (!g[y][x]) out.push({ x, y });
  return out;
}

// Deterministic greedy AI: give check, choke the king's escape squares, close
// distance, but don't park point-blank in front of the shotgun for nothing.
function chooseMove(s, p) {
  const moves = pieceMoves(s, p);
  if (!moves.length) return null;
  const { x: kx, y: ky } = s.king;
  const ox = p.x, oy = p.y;
  let best = null, bestScore = -Infinity;
  for (const m of moves) {
    p.x = m.x; p.y = m.y;
    const d = cheb(m.x, m.y, kx, ky);
    let score;
    if (p.type === 'K') {
      // The White King is a coward: keep away, stay near the back.
      score = d * 3 - m.y;
    } else {
      const g = grid(s, false), map = attackMap(s);
      const check = attacksFrom(p.type, m.x, m.y, g).some(([x, y]) => x === kx && y === ky);
      let cover = 0;
      for (const [dx, dy] of ALL8) {
        const x = kx + dx, y = ky + dy;
        if (inBoard(x, y) && !g[y][x] && map[y * SIZE + x]) cover++;
      }
      score = (check ? 30 : 0) + cover * 4 - d * 2 - (d === 1 && !check ? 5 : 0);
    }
    if (score > bestScore) { bestScore = score; best = m; }
  }
  p.x = ox; p.y = oy;
  return best;
}

function addPiece(s, type, x, y) {
  const d = PIECES[type], m = s.mods;
  const hp = d.hp + (m.hp[type] || 0) + (m.hp.all || 0);
  const speed = m.speedSet[type] || d.speed;
  const p = { id: s.nextId++, type, x, y, hp, maxHp: hp, speed, wait: 1 + ((x * 3 + y) % speed) };
  s.pieces.push(p);
  return p;
}

function spawnSquare(s) {
  const r = s.reinf;
  const pref = r.cols[r.idx % r.cols.length];
  const g = grid(s, true);
  for (const row of [0, 1]) {
    const cols = [...Array(SIZE).keys()].sort((a, b) => Math.abs(a - pref) - Math.abs(b - pref));
    for (const x of cols) if (!g[row][x]) return { x, y: row };
  }
  return null;
}

function nextSpawnPreview(s) {
  if (!s.reinf || s.reinf.idx >= s.reinf.pool.length || s.reinf.timer !== 1) return null;
  const sq = spawnSquare(s);
  return sq && { ...sq, type: s.reinf.pool[s.reinf.idx] };
}

function hasLegalAction(s) {
  if (kingMoves(s).length) return true;
  for (const t of new Set(s.souls)) if (soulMoves(s, t).length) return true;
  if (s.loaded > 0) {
    for (let a = 0; a < 360; a += 4) {
      const c = clone(s);
      applyShot(c, a * DEG);
      if (c.kingDead || !inCheck(c)) return true;
    }
  }
  return false;
}

function enemyPhase(state) {
  const s = clone(state);
  const events = [];
  const log = s.log[s.log.length - 1];
  const order = [...s.pieces].sort((a, b) => b.y - a.y || a.x - b.x).map(p => p.id);
  for (const id of order) {
    const p = s.pieces.find(q => q.id === id);
    if (!p) continue;
    p.wait--;
    if (p.wait > 0) continue;
    p.wait = p.speed;
    const mv = chooseMove(s, p);
    if (!mv) continue;
    const from = { x: p.x, y: p.y };
    p.x = mv.x; p.y = mv.y;
    let promo = false;
    if (p.type === 'P' && p.y === SIZE - 1) {
      p.type = 'Q'; p.hp = Math.max(p.hp, 3); p.maxHp = p.hp; p.speed = PIECES.Q.speed; promo = true;
    }
    events.push({ type: 'move', id, from, to: { x: mv.x, y: mv.y }, promo });
    if (log) log.them.push(pieceLetter(promo ? 'P' : p.type) + sqName(mv.x, mv.y) + (promo ? '=Q' : ''));
  }

  if (s.reinf && s.reinf.idx < s.reinf.pool.length) {
    s.reinf.timer--;
    if (s.reinf.timer <= 0) {
      const sq = spawnSquare(s);
      if (sq) {
        const type = s.reinf.pool[s.reinf.idx];
        const p = addPiece(s, type, sq.x, sq.y);
        p.wait = p.speed;
        s.reinf.idx++;
        events.push({ type: 'spawn', id: p.id, x: sq.x, y: sq.y, piece: type });
        if (log) log.them.push('+' + PIECES[type].name + ' ' + sqName(sq.x, sq.y));
      }
      s.reinf.timer = s.reinf.every;
    }
  }

  // Can the player still do anything legal?
  if (inCheck(s) && !hasLegalAction(s)) {
    if (s.shields > 0) {
      s.shields--;
      s.usedShield = true;
      const atk = attackersOfKing(s);
      for (const p of atk) { removePiece(s, p.id); if (p.type === 'K') s.kingDead = true; }
      events.push({ type: 'smite', hits: atk.map(p => ({ id: p.id, x: p.x, y: p.y, type: p.type })) });
      if (log) log.them.push('🛡 Divine Shield');
      if (isWon(s)) s.status = 'won';
      else if (inCheck(s) && !hasLegalAction(s)) { s.status = 'lost'; s.lostReason = 'Checkmate'; }
    } else {
      s.status = 'lost';
      s.lostReason = 'Checkmate';
    }
  }
  s.check = inCheck(s);
  if (log && s.check) log.check = true;
  s.canAct = s.status === 'play' ? hasLegalAction(s) : false;
  return { state: s, events };
}

// ---- level setup ----------------------------------------------------------

function computeStats(blackIds) {
  const st = clone(BASE_STATS);
  for (const id of blackIds) BLACK_CARDS.find(c => c.id === id).apply(st);
  return st;
}

function buildLevel(level, run) {
  const stats = computeStats(run ? run.black : []);
  const mods = { hp: {}, speedSet: {}, extra: [], reserve: 0, ambush: false, drums: false };
  for (const id of run ? run.white : []) WHITE_CARDS.find(c => c.id === id).mods(mods);
  const s = {
    levelId: level.id, objective: level.objective, par: level.par, turn: 0,
    king: { x: 4, y: 7 }, pieces: [], nextId: 1, mods, stats,
    loaded: stats.capacity, reserve: Math.max(0, level.reserve + stats.reserveBonus + mods.reserve),
    shields: stats.shields, souls: stats.startSoul ? [stats.startSoul] : [],
    reinf: null, kills: 0, shots: 0, captured: [], log: [],
    status: 'play', lostReason: '', usedShield: false, kingDead: false, lastMove: null, check: false, canAct: true,
  };
  level.board.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '@') s.king = { x, y };
    else if (PIECES[ch]) addPiece(s, ch, x, y);
  }));

  // Extra pieces from white cards: rows 1-2, central columns first, never giving check.
  const colOrder = [3, 4, 2, 5, 1, 6, 0, 7];
  for (const type of mods.extra) {
    let placed = false;
    for (const y of [1, 2, 0]) {
      for (const x of colOrder) {
        if (placed || s.pieces.some(p => p.x === x && p.y === y) || (s.king.x === x && s.king.y === y)) continue;
        const p = addPiece(s, type, x, y);
        if (inCheck(s)) removePiece(s, p.id); else placed = true;
      }
    }
  }

  let reinf = level.reinforce ? clone(level.reinforce) : null;
  if (mods.drums) {
    if (reinf) reinf.every = Math.max(2, reinf.every - 1);
    else reinf = { every: 6, pool: ['P', 'P', 'P'], cols: [0, 7, 3, 4] };
  }
  if (reinf) s.reinf = { ...reinf, idx: 0, timer: reinf.every };
  if (mods.ambush) for (const p of s.pieces) p.wait = 1;
  return s;
}

if (typeof module !== 'undefined') {
  module.exports = { buildLevel, playerAct, enemyPhase, traceShot, kingMoves, soulMoves, attackMap, inCheck, hasLegalAction, nextSpawnPreview, DEG };
}
