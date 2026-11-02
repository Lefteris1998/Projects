/* TWINFOLD — simulation core. No DOM access: runs in the browser and in Node (tools/sim.js).
   Maps can be any size >= 40x22; the 640x352 view scrolls over bigger ones (see camTarget). */
(function (root) {
  'use strict';

  const T = 16, VCOLS = 40, VROWS = 22, W = VCOLS * T, H = VROWS * T;
  const PH = {
    g: 1100, jump: 290, run: 100, accG: 1500, accA: 900, fricG: 1700, fricFast: 2400,
    maxFall: 760, coyote: 0.09, buffer: 0.12, cutGrav: 2.4, minExitSide: 110, minExitUp: 230,
    shotCD: 0.22, grabR: 22,
    // volcano
    monRun: 76, monAcc: 700, monJump: 300, monSeeX: 15 * 16, monSeeY: 8 * 16,
    sharkSwim: 72, sharkPatrol: 26, sharkReach: 48, sharkMaxH: 8 * 16, sharkCD: 1.25,
    crumbleT: 0.5, crumbleBack: 3.2, spikeShake: 0.32, spikeRegrow: 3.0, ventH: 7,
    look: 0.45
  };
  const EMPTY = 0, METAL = 1, PANEL = 2, GRATE = 3, ACID = 4, FIZZ = 5, EMIT = 6, RECV = 7, DOOR = 8, CRUMB = 9, VENT = 10;
  const FACE = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };
  const EMIT_DIR = { '>': [1, 0], '<': [-1, 0], '^': [0, -1], 'v': [0, 1] };

  const ix = (s, x, y) => y * s.cols + x;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- level loading ---------- */
  function normalizeMap(rows) {
    const cols = Math.max(VCOLS, ...rows.map(r => r.length));
    const n = Math.max(VROWS, rows.length);
    const out = [];
    for (let y = 0; y < n; y++) {
      let r = rows[y] || '';
      if (r.length < cols) r += '#'.repeat(cols - r.length);
      out.push(r);
    }
    return out;
  }

  function makePortal(c, x, y, n, fixed) {
    const cells = n[1] !== 0 ? [[x, y], [x + 1, y]] : [[x, y], [x, y + 1]];
    const p = { c, cells, n, fixed: !!fixed, born: 0 };
    if (n[1] !== 0) { // floor / ceiling: tangent is x
      p.py = n[1] < 0 ? y * T : (y + 1) * T;
      p.px = (x + 1) * T;
      p.s0 = x * T; p.s1 = (x + 2) * T;
    } else {
      p.px = n[0] < 0 ? x * T : (x + 1) * T;
      p.py = (y + 1) * T;
      p.s0 = y * T; p.s1 = (y + 2) * T;
    }
    return p;
  }

  function load(def) {
    const map = normalizeMap(def.map);
    const cols = map[0].length, rows = map.length;
    const s = {
      def, map, cols, rows, tiles: new Uint8Array(cols * rows), doorAt: {}, recvAt: {},
      emitters: [], receivers: [], buttons: [], doors: [], cubes: [], exit: null,
      portals: [null, null], beams: [], events: [], time: 0, shots: 0,
      won: false, dead: false, endT: 0, shotCD: 0, gun: def.gun == null ? 2 : def.gun,
      exitOpen: true, chan: [true, false, false, false, false],
      crumb: {}, crumbs: [], vents: [], spikes: [], sharks: [], mons: [], flags: [], pickups: [],
      lavaY: Infinity, riseT: -1, theme: def.theme || 'lab'
    };
    let start = { x: 2, y: 19 };
    const btnCells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const ch = map[y][x];
      let t = EMPTY;
      if (ch === '#') t = METAL;
      else if (ch === '=') t = PANEL;
      else if (ch === '%') t = GRATE;
      else if (ch === '~') t = ACID;
      else if (ch === '!') t = FIZZ;
      else if (ch === 'P') start = { x, y };
      else if (ch === 'X') s.exit = { x, y, ch: def.exit || 0 };
      else if (ch === 'o') s.cubes.push(newCube(x, y));
      else if (ch >= '1' && ch <= '4') btnCells.push({ x, y, ch: +ch });
      else if (ch >= '5' && ch <= '8') {
        t = RECV; const r = { x, y, ch: +ch - 4, on: false, onT: 0 };
        s.receivers.push(r); s.recvAt[y * cols + x] = r;
      } else if (ch >= 'a' && ch <= 'd') {
        t = DOOR; const d = { x, y, ch: ch.charCodeAt(0) - 96, open: false, amt: 0 };
        s.doors.push(d); s.doorAt[y * cols + x] = d;
      } else if (EMIT_DIR[ch]) { t = EMIT; s.emitters.push({ x, y, d: EMIT_DIR[ch] }); }
      else if (ch === ':') { t = CRUMB; const c = { x, y, st: 0, t: 0 }; s.crumbs.push(c); s.crumb[y * cols + x] = c; }
      else if (ch === 'V' || ch === 'W') { t = VENT; s.vents.push({ x, y, ph: ch === 'W' ? 0.5 : 0, on: false, warn: false, top: y * T, k: 0 }); }
      else if (ch === 'S') { t = ACID; s.sharks.push(newShark(x, y)); }
      else if (ch === 'M') s.mons.push(newMon(x, y));
      else if (ch === 'Y') s.spikes.push({ kind: 'spike', x: x * T + 4, y: y * T, w: 8, h: 12, hy: y * T, st: 0, t: 0, vy: 0 });
      else if (ch === 'F') s.flags.push({ x, y, on: false, t: 0 });
      else if (ch === 'G') s.pickups.push({ x, y, taken: false });
      s.tiles[y * cols + x] = t;
    }
    // merge horizontally adjacent button cells of the same channel into one plate
    btnCells.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const b of btnCells) {
      const last = s.buttons[s.buttons.length - 1];
      if (last && last.y === b.y && last.ch === b.ch && last.x1 === b.x - 1) last.x1 = b.x;
      else s.buttons.push({ x0: b.x, x1: b.x, y: b.y, ch: b.ch, on: false, amt: 0 });
    }
    s.player = {
      kind: 'player', x: start.x * T + 3, y: (start.y + 1) * T - 18, w: 10, h: 18, vx: 0, vy: 0,
      ground: true, coyote: 0, buf: 0, facing: 1, held: null, inP: null, pcx: 0, pcy: 0,
      aimX: start.x * T + 40, aimY: start.y * T, walk: 0, airT: 0
    };
    s.start = start;
    if (def.rise) { s.lavaY = def.rise.from * T; s.riseT = def.rise.at ? -1 : 0; }
    const vent = def.vent || [3, 1.1];
    s.ventP = vent[0]; s.ventOn = vent[1]; s.ventH = def.ventH || PH.ventH;
    for (const pre of def.pre || []) {
      const p = makePortal(pre.c, pre.x, pre.y, FACE[pre.f], true);
      p.born = -10;
      s.portals[pre.c] = p;
    }
    updateSwitches(s, true);
    traceLasers(s);
    s.events.length = 0;
    return s;
  }

  function newCube(x, y) {
    const c = { kind: 'cube', x: x * T + 2, y: (y + 1) * T - 12, w: 12, h: 12, vx: 0, vy: 0, held: false,
      ground: false, inP: null, pcx: 0, pcy: 0, gone: false, goneT: 0, spawnT: 0 };
    c.hx = c.x; c.hy = c.y;
    return c;
  }
  function newMon(x, y) {
    return { kind: 'mon', x: x * T + 2, y: (y + 1) * T - 14, w: 12, h: 14, vx: 0, vy: 0, ground: false, inP: null,
      pcx: 0, pcy: 0, aggro: false, dead: false, face: -1, walk: 0, blocked: false, deadT: 0, sx: x, sy: y };
  }
  function newShark(x, y) {
    return { kind: 'shark', x: x * T + 2, y: y * T + 4, w: 12, h: 9, vx: 0, vy: 0, mode: 'swim', cd: 0.8, dir: 1,
      dead: false, noPortal: true, x0: 0, x1: 0, face: 1, t: 0 };
  }

  /* ---------- tiles ---------- */
  function tileAt(s, x, y) {
    if (x < 0 || y < 0 || x >= s.cols || y >= s.rows) return METAL;
    return s.tiles[y * s.cols + x];
  }
  function solidTile(s, x, y) {
    const t = tileAt(s, x, y);
    if (t === DOOR) return !s.doorAt[ix(s, x, y)].open;
    if (t === CRUMB) return s.crumb[ix(s, x, y)].st !== 2;
    return t === METAL || t === PANEL || t === GRATE || t === EMIT || t === RECV || t === VENT;
  }
  // blocks shots and beams (grates and fizzlers don't)
  function opaque(s, x, y, t) {
    if (t === DOOR) return !s.doorAt[ix(s, x, y)].open;
    if (t === CRUMB) return s.crumb[ix(s, x, y)].st !== 2;
    return t === METAL || t === PANEL || t === EMIT || t === RECV || t === VENT;
  }
  const linked = s => !!(s.portals[0] && s.portals[1]);
  function covers(p, x, y) {
    return (p.cells[0][0] === x && p.cells[0][1] === y) || (p.cells[1][0] === x && p.cells[1][1] === y);
  }
  function portalOn(s, x, y) {
    for (const p of s.portals) if (p && covers(p, x, y)) return p;
    return null;
  }
  const cxOf = e => e.x + e.w / 2, cyOf = e => e.y + e.h / 2;
  function aligned(e, p) {
    if (p.n[1] !== 0) return e.x >= p.s0 - 0.01 && e.x + e.w <= p.s1 + 0.01;
    return e.y >= p.s0 - 0.01 && e.y + e.h <= p.s1 + 0.01;
  }
  const frontOf = (p, x, y) => (x - p.px) * p.n[0] + (y - p.py) * p.n[1];
  function overlapsPortal(e, p) {
    const ax = Math.min(p.cells[0][0], p.cells[1][0]) * T, ay = Math.min(p.cells[0][1], p.cells[1][1]) * T;
    const bx = (Math.max(p.cells[0][0], p.cells[1][0]) + 1) * T, by = (Math.max(p.cells[0][1], p.cells[1][1]) + 1) * T;
    return e.x < bx && e.x + e.w > ax && e.y < by && e.y + e.h > ay;
  }
  // lava: static pools or anything under the rising surface
  function lavaAt(s, px, py) {
    if (py > s.lavaY) return true;
    return tileAt(s, Math.floor(px / T), Math.floor(py / T)) === ACID;
  }

  function solidFor(s, x, y, e) {
    if (!solidTile(s, x, y)) return false;
    if (e.noPortal || (e.kind === 'cube' && e.held) || !linked(s)) return true;
    const p = portalOn(s, x, y);
    if (!p) return true;
    if (e.inP === p) return false;
    return !(aligned(e, p) && frontOf(p, e.pcx, e.pcy) > 0);
  }

  // move along one axis; returns actual displacement
  function moveAxis(s, e, d, ax) {
    if (!d) return 0;
    if (Math.abs(d) > 6) { // sweep big moves in small steps so nothing tunnels
      let moved = 0; const n = Math.ceil(Math.abs(d) / 6), st = d / n;
      for (let i = 0; i < n; i++) { const m = moveAxis(s, e, st, ax); moved += m; if (Math.abs(m - st) > 1e-6) break; }
      return moved;
    }
    if (ax === 0) {
      const ox = e.x; e.x += d;
      const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.001) / T);
      const cx = d > 0 ? Math.floor((e.x + e.w - 0.001) / T) : Math.floor(e.x / T);
      for (let y = y0; y <= y1; y++) if (solidFor(s, cx, y, e)) {
        e.x = d > 0 ? cx * T - e.w : (cx + 1) * T;
        e.hitX = true; break;
      }
      return e.x - ox;
    }
    const oy = e.y; e.y += d;
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.001) / T);
    const cy = d > 0 ? Math.floor((e.y + e.h - 0.001) / T) : Math.floor(e.y / T);
    for (let x = x0; x <= x1; x++) if (solidFor(s, x, cy, e)) {
      e.y = d > 0 ? cy * T - e.h : (cy + 1) * T;
      e.hitY = true; break;
    }
    return e.y - oy;
  }

  function overlapsSolid(s, e) {
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.001) / T);
    const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.001) / T);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (solidFor(s, x, y, e)) return true;
    return false;
  }

  /* ---------- portals ---------- */
  function preStep(s, e) {
    e.pcx = cxOf(e); e.pcy = cyOf(e);
    e.inP = null;
    if (!linked(s) || (e.kind === 'cube' && e.held)) return;
    for (const p of s.portals) {
      if (overlapsPortal(e, p) && aligned(e, p) && frontOf(p, e.pcx, e.pcy) > 0) { e.inP = p; break; }
    }
  }

  function postStep(s, e) {
    if (e.inP) { // keep inside the mouth while penetrating
      const p = e.inP;
      if (p.n[1] !== 0) e.x = clamp(e.x, p.s0, p.s1 - e.w); else e.y = clamp(e.y, p.s0, p.s1 - e.h);
    }
    if (!linked(s) || (e.kind === 'cube' && e.held)) return false;
    const cx = cxOf(e), cy = cyOf(e);
    for (let i = 0; i < 2; i++) {
      const p = s.portals[i];
      if ((e.inP === p || aligned(e, p)) && frontOf(p, e.pcx, e.pcy) > 0 && frontOf(p, cx, cy) <= 0) {
        teleport(s, e, p, s.portals[1 - i]);
        return true;
      }
    }
    return false;
  }

  function rotFor(p, q) { // rotation mapping -p.n onto q.n
    const ax = -p.n[0], ay = -p.n[1], bx = q.n[0], by = q.n[1];
    return [ax * bx + ay * by, ax * by - ay * bx];
  }

  function teleport(s, e, p, q) {
    const [c, sn] = rotFor(p, q);
    const ox = cxOf(e), oy = cyOf(e);
    const rx = ox - p.px, ry = oy - p.py;
    const nx = q.px + c * rx - sn * ry, ny = q.py + sn * rx + c * ry;
    let vx = c * e.vx - sn * e.vy, vy = sn * e.vx + c * e.vy;
    if (q.n[1] !== 0) {
      e.x = clamp(nx - e.w / 2, q.s0, q.s1 - e.w);
      e.y = q.n[1] < 0 ? q.py - e.h - 0.05 : q.py + 0.05;
    } else {
      e.y = clamp(ny - e.h / 2, q.s0, q.s1 - e.h);
      e.x = q.n[0] < 0 ? q.px - e.w - 0.05 : q.px + 0.05;
    }
    const vn = vx * q.n[0] + vy * q.n[1];
    const min = q.n[1] < 0 ? PH.minExitUp : q.n[1] > 0 ? 0 : PH.minExitSide;
    if (vn < min) { vx += q.n[0] * (min - vn); vy += q.n[1] * (min - vn); }
    e.vx = vx; e.vy = vy; e.inP = null; e.ground = false;
    e.pcx = cxOf(e); e.pcy = cyOf(e);
    s.events.push({ t: 'tp', who: e.kind, x0: ox, y0: oy, x: cxOf(e), y: cyOf(e), c: q.c, from: p.c, speed: Math.hypot(vx, vy) });
    if (e.kind === 'player' && e.held) placeHeld(s, e, e.held, true);
  }

  function ents(s) {
    const a = [];
    if (!s.dead) a.push(s.player);
    for (const c of s.cubes) if (!c.gone) a.push(c);
    for (const m of s.mons) if (!m.dead) a.push(m);
    return a;
  }

  // push entities out of a portal that is about to vanish
  function ejectFrom(s, p) {
    for (const e of ents(s)) {
      if (!overlapsPortal(e, p)) continue;
      if (p.n[1] < 0) { e.y = p.py - e.h - 0.05; if (e.vy > 0) e.vy = 0; }
      else if (p.n[1] > 0) e.y = p.py + 0.05;
      else if (p.n[0] < 0) e.x = p.px - e.w - 0.05;
      else e.x = p.px + 0.05;
      e.inP = null;
    }
  }

  function removePortal(s, i) {
    const p = s.portals[i];
    if (!p) return;
    ejectFrom(s, p);
    s.portals[i] = null;
  }

  function fizzlePortals(s) {
    let any = false;
    for (let i = 0; i < 2; i++) {
      const p = s.portals[i];
      if (p && !p.fixed) { s.events.push({ t: 'close', c: i, x: p.px, y: p.py, n: p.n }); removePortal(s, i); any = true; }
    }
    if (any) s.events.push({ t: 'fizzle' });
  }

  /* DDA raycast. returns {x,y, cell, n, kind:'solid'|'fizz'|'none'} */
  function raycast(s, ox, oy, tx, ty) {
    let dx = tx - ox, dy = ty - oy;
    const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    let cx = Math.floor(ox / T), cy = Math.floor(oy / T);
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = Math.abs(1 / (dx || 1e-9)) * T, tdy = Math.abs(1 / (dy || 1e-9)) * T;
    let tmx = dx > 0 ? ((cx + 1) * T - ox) / (dx * 1) : (ox - cx * T) / (-dx || 1e-9);
    let tmy = dy > 0 ? ((cy + 1) * T - oy) / (dy * 1) : (oy - cy * T) / (-dy || 1e-9);
    if (!dx) tmx = Infinity; if (!dy) tmy = Infinity;
    for (let i = 0; i < 1200; i++) {
      let t, axis;
      if (tmx < tmy) { t = tmx; tmx += tdx; cx += sx; axis = 0; } else { t = tmy; tmy += tdy; cy += sy; axis = 1; }
      const x = ox + dx * t, y = oy + dy * t;
      const tile = tileAt(s, cx, cy);
      if (tile === FIZZ) return { x, y, kind: 'fizz' };
      if (opaque(s, cx, cy, tile) || cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows) {
        return { x, y, cell: [cx, cy], n: axis === 0 ? [-sx, 0] : [0, -sy], kind: 'solid', tile };
      }
    }
    return { x: ox + dx * 4000, y: oy + dy * 4000, kind: 'none' };
  }

  function frontOk(s, x, y) {
    const t = tileAt(s, x, y);
    return t === EMPTY || t === ACID || t === FIZZ;
  }

  // choose the 2-cell placement for a hit; returns portal or null
  function placementFor(s, hit, color) {
    if (hit.kind !== 'solid' || hit.tile !== PANEL) return null;
    const [hx, hy] = hit.cell, n = hit.n;
    const horiz = n[1] !== 0; // floor/ceiling
    const frac = horiz ? (hit.x - hx * T) / T : (hit.y - hy * T) / T;
    const tries = frac < 0.5 ? [-1, 0] : [0, -1];
    const other = s.portals[1 - color];
    for (const o of tries) {
      const x = horiz ? hx + o : hx, y = horiz ? hy : hy + o;
      const p = makePortal(color, x, y, n, false);
      let ok = p.py < s.lavaY - 2;
      for (const [cx, cy] of p.cells) {
        if (!ok) break;
        if (tileAt(s, cx, cy) !== PANEL || !frontOk(s, cx + n[0], cy + n[1])) { ok = false; break; }
        if (other && covers(other, cx, cy)) { ok = false; break; }
      }
      if (ok) return p;
    }
    return null;
  }

  function gunOrigin(s) { const pl = s.player; return [pl.x + pl.w / 2, pl.y + 6]; }

  function aimInfo(s, tx, ty, color) {
    const [ox, oy] = gunOrigin(s);
    const hit = raycast(s, ox, oy, tx, ty);
    const p = placementFor(s, hit, color);
    return { ox, oy, hit, portal: p };
  }

  function shoot(s, color, tx, ty) {
    if (s.dead || s.won || s.gun === 0 || s.shotCD > 0) return false;
    if (s.gun === 1) color = 0;
    if (s.portals[color] && s.portals[color].fixed) color = 1 - color;
    if (s.portals[color] && s.portals[color].fixed) return false;
    s.shotCD = PH.shotCD;
    const a = aimInfo(s, tx, ty, color);
    s.events.push({ t: 'shot', c: color, x0: a.ox, y0: a.oy, x1: a.hit.x, y1: a.hit.y, ok: !!a.portal, fizz: a.hit.kind === 'fizz', n: a.hit.n });
    if (!a.portal) return false;
    const old = s.portals[color];
    if (old) { removePortal(s, color); s.events.push({ t: 'close', c: color, x: old.px, y: old.py, n: old.n }); }
    a.portal.born = s.time;
    s.portals[color] = a.portal;
    s.shots++;
    s.events.push({ t: 'portal', c: color, x: a.portal.px, y: a.portal.py, n: a.portal.n });
    return true;
  }

  /* ---------- camera (shared by the game shell and the verifier) ---------- */
  // sx, sy: cursor position on screen (0..W, 0..H). Bigger maps scroll and lean toward the cursor.
  function camTarget(s, sx, sy) {
    const pl = s.player, mw = s.cols * T, mh = s.rows * T;
    let x = pl.x + pl.w / 2 - W / 2, y = pl.y + pl.h / 2 - H / 2 + 10;
    if (sx != null && s.gun > 0) { x += (sx - W / 2) * PH.look; y += (sy - H / 2) * PH.look; }
    return { x: clamp(x, 0, mw - W), y: clamp(y, 0, mh - H) };
  }

  /* ---------- cubes ---------- */
  function placeHeld(s, pl, c, snap) {
    const tx = pl.x + pl.w / 2 + pl.facing * 11 - c.w / 2, ty = pl.y;
    if (snap) {
      c.x = pl.x + pl.w / 2 - c.w / 2; c.y = pl.y + 2;
      c.pcx = cxOf(c); c.pcy = cyOf(c);
    }
    moveAxis(s, c, tx - c.x, 0);
    moveAxis(s, c, ty - c.y, 1);
    c.vx = pl.vx; c.vy = pl.vy;
  }

  function toggleGrab(s) {
    const pl = s.player;
    if (pl.held) {
      const c = pl.held; c.held = false; pl.held = null;
      c.vx = pl.vx * 0.9 + pl.facing * 25; c.vy = Math.min(pl.vy, 0);
      if (overlapsSolid(s, c)) { c.x = pl.x + pl.w / 2 - c.w / 2; c.y = pl.y + pl.h - c.h; }
      s.events.push({ t: 'drop' });
      return;
    }
    let best = null, bd = PH.grabR;
    for (const c of s.cubes) {
      if (c.gone) continue;
      const d = Math.hypot(cxOf(c) - cxOf(pl), cyOf(c) - cyOf(pl));
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.held = true; pl.held = best; s.events.push({ t: 'grab' }); }
  }

  function destroyCube(s, c, why) {
    if (c.gone) return;
    if (c.held) { c.held = false; s.player.held = null; }
    c.gone = true; c.goneT = 0.9;
    s.events.push({ t: 'cubeGone', x: cxOf(c), y: cyOf(c), why });
  }

  function stepCube(s, c, dt) {
    if (c.gone) {
      c.goneT -= dt;
      if (c.goneT <= 0 && c.hy + c.h < s.lavaY) {
        c.gone = false; c.x = c.hx; c.y = c.hy; c.vx = c.vy = 0; c.spawnT = 0.5;
        s.events.push({ t: 'cubeBack', x: cxOf(c), y: cyOf(c) });
      }
      return;
    }
    c.spawnT = Math.max(0, c.spawnT - dt);
    if (c.held) { c.pcx = cxOf(c); c.pcy = cyOf(c); placeHeld(s, s.player, c, false); if (Math.hypot(cxOf(c) - cxOf(s.player), cyOf(c) - cyOf(s.player)) > 30) toggleGrab(s); return; }
    preStep(s, c);
    c.vy = Math.min(c.vy + PH.g * dt, PH.maxFall);
    if (c.ground) {
      const f = 900 * dt;
      c.vx = Math.abs(c.vx) <= f ? 0 : c.vx - Math.sign(c.vx) * f;
    }
    c.hitX = c.hitY = false;
    moveAxis(s, c, c.vx * dt, 0); if (c.hitX) c.vx = 0;
    const vy = c.vy;
    moveAxis(s, c, c.vy * dt, 1);
    c.ground = false;
    if (c.hitY) { if (vy > 0) { c.ground = true; if (vy > 250) c.vx *= 0.3; if (vy > 200) s.events.push({ t: 'thud', x: cxOf(c), y: c.y + c.h, v: vy }); } c.vy = 0; }
    postStep(s, c);
    if (c.ground) standOn(s, c);
  }

  /* ---------- player ---------- */
  function stepPlayer(s, inp, dt) {
    const pl = s.player;
    preStep(s, pl);
    const want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    pl.facing = pl.aimX >= cxOf(pl) ? 1 : -1;
    if (pl.ground) {
      if (want) {
        if (pl.vx * want < 0) pl.vx += want * (PH.accG + PH.fricG) * dt;
        else if (Math.abs(pl.vx) > PH.run) pl.vx -= Math.sign(pl.vx) * Math.min(PH.fricFast * dt, Math.abs(pl.vx) - PH.run);
        else pl.vx = clamp(pl.vx + want * PH.accG * dt, -PH.run, PH.run);
      } else {
        const f = (Math.abs(pl.vx) > PH.run ? PH.fricFast : PH.fricG) * dt;
        pl.vx = Math.abs(pl.vx) <= f ? 0 : pl.vx - Math.sign(pl.vx) * f;
      }
      pl.coyote = PH.coyote;
    } else {
      pl.coyote -= dt;
      if (want && pl.vx * want < PH.run) pl.vx = Math.min(pl.vx * want + PH.accA * dt, Math.max(PH.run, pl.vx * want)) * want;
      else if (!want && Math.abs(pl.vx) <= PH.run) {
        const f = 520 * dt;
        pl.vx = Math.abs(pl.vx) <= f ? 0 : pl.vx - Math.sign(pl.vx) * f;
      }
    }
    pl.buf -= dt;
    if (pl.buf > 0 && pl.coyote > 0) {
      pl.vy = -PH.jump; pl.ground = false; pl.coyote = 0; pl.buf = 0;
      s.events.push({ t: 'jump', x: cxOf(pl), y: pl.y + pl.h });
    }
    const grav = pl.vy < 0 && !inp.jump && pl.jumped ? PH.g * PH.cutGrav : PH.g;
    if (pl.vy >= 0) pl.jumped = false;
    if (pl.vy === -PH.jump) pl.jumped = true;
    pl.vy = Math.min(pl.vy + grav * dt, PH.maxFall);

    pl.hitX = pl.hitY = false;
    const dx = pl.vx * dt;
    moveAxis(s, pl, dx, 0);
    if (pl.hitX) pl.vx = 0;
    pushCubes(s, pl, dx);
    const vy = pl.vy, prevBottom = pl.y + pl.h;
    moveAxis(s, pl, pl.vy * dt, 1);
    const wasGround = pl.ground;
    pl.ground = false;
    if (pl.hitY) { if (vy > 0) pl.ground = true; pl.vy = 0; }
    if (vy >= 0) for (const c of s.cubes) {
      if (c.gone || c.held) continue;
      if (pl.x + pl.w > c.x + 1 && pl.x < c.x + c.w - 1 && prevBottom <= c.y + 0.6 && pl.y + pl.h >= c.y) {
        pl.y = c.y - pl.h; pl.vy = 0; pl.ground = true;
      }
    }
    if (pl.ground && !wasGround && pl.airT > 0.12) s.events.push({ t: 'land', x: cxOf(pl), y: pl.y + pl.h, v: vy });
    pl.airT = pl.ground ? 0 : pl.airT + dt;
    if (pl.ground && Math.abs(pl.vx) > 5) pl.walk += Math.abs(pl.vx) * dt;
    postStep(s, pl);
    if (pl.ground) standOn(s, pl);
  }

  function pushCubes(s, pl, dx) {
    if (!dx) return;
    for (const c of s.cubes) {
      if (c.gone || c.held) continue;
      const vOver = Math.min(pl.y + pl.h, c.y + c.h) - Math.max(pl.y, c.y);
      if (vOver <= 2) continue;
      if (pl.x + pl.w <= c.x || pl.x >= c.x + c.w) continue;
      const dir = dx > 0 ? 1 : -1;
      if ((cxOf(c) - cxOf(pl)) * dir < 0) continue; // only push what is ahead of you, never what you just set down behind you
      const need = dir > 0 ? pl.x + pl.w - c.x : c.x + c.w - pl.x;
      c.pcx = cxOf(c); c.pcy = cyOf(c);
      const got = moveAxis(s, c, dir * need, 0);
      const rest = need - Math.abs(got);
      if (rest > 0.001) { pl.x -= dir * rest; pl.vx = 0; }
    }
  }

  /* ---------- volcano: crumbling rock ---------- */
  function standOn(s, e) {
    if (!s.crumbs.length) return;
    const y = Math.floor((e.y + e.h + 0.5) / T);
    const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.001) / T);
    for (let x = x0; x <= x1; x++) {
      const c = s.crumb[ix(s, x, y)];
      if (c && c.st === 0) { c.st = 1; c.t = 0; s.events.push({ t: 'crack', x: (x + 0.5) * T, y: y * T }); }
    }
  }
  function stepCrumbs(s, dt) {
    for (const c of s.crumbs) {
      if (c.st === 0) continue;
      c.t += dt;
      if (c.st === 1 && c.t >= PH.crumbleT) { c.st = 2; c.t = 0; s.events.push({ t: 'crumble', x: (c.x + 0.5) * T, y: (c.y + 0.5) * T }); }
      else if (c.st === 2 && c.t >= PH.crumbleBack && (c.y + 1) * T < s.lavaY) {
        if (!ents(s).some(e => overlapRect(e, c.x * T, c.y * T, T, T))) { c.st = 0; c.t = 0; s.events.push({ t: 'reform', x: (c.x + 0.5) * T, y: (c.y + 0.5) * T }); }
      }
    }
  }

  /* ---------- volcano: rising lava ---------- */
  function stepLava(s, dt) {
    const r = s.def.rise;
    if (!r) return;
    const pl = s.player;
    if (s.riseT < 0) {
      const a = r.at; // [x0,y0,x1,y1] trigger rect in tiles
      const px = cxOf(pl) / T, py = cyOf(pl) / T;
      if (px >= a[0] && px <= a[2] + 1 && py >= a[1] && py <= a[3] + 1) { s.riseT = 0; s.events.push({ t: 'rumble' }); }
      return;
    }
    s.riseT += dt;
    if (s.riseT < (r.delay || 0)) return;
    const top = (r.to != null ? r.to : 0) * T;
    const sp = r.at2 != null && s.lavaY <= r.at2 * T ? r.speed2 : r.speed; // optional surge once the lava passes row at2
    const y = Math.max(top, s.lavaY - sp * T * dt);
    s.lavaY = y;
    for (let i = 0; i < 2; i++) {
      const p = s.portals[i];
      if (p && p.py > s.lavaY + 1) { s.events.push({ t: 'close', c: i, x: p.px, y: p.py, n: p.n, sink: true }); removePortal(s, i); s.events.push({ t: 'sizzle', x: p.px, y: p.py }); }
    }
  }

  /* ---------- volcano: fire vents ---------- */
  function stepVents(s, dt) {
    const P = s.ventP, ON = s.ventOn;
    for (const v of s.vents) {
      const cyc = ((s.time + v.ph * P) % P + P) % P;
      const on = cyc >= P - ON, warn = !on && cyc >= P - ON - 0.75;
      if (on && !v.on) s.events.push({ t: 'vent', x: (v.x + 0.5) * T, y: v.y * T });
      v.on = on; v.warn = warn; v.k = on ? Math.min(1, (cyc - (P - ON)) / 0.12) : 0;
      let top = v.y * T;
      for (let k = 1; k <= s.ventH; k++) { if (solidTile(s, v.x, v.y - k)) break; top = (v.y - k) * T; }
      v.top = top;
      if (!on) continue;
      const rx = v.x * T + 3, rw = 10, ry = top, rh = v.y * T - top;
      if (!s.dead && overlapRect(s.player, rx, ry, rw, rh)) kill(s, 'fire');
      for (const c of s.cubes) if (!c.gone && overlapRect(c, rx, ry, rw, rh)) destroyCube(s, c, 'fire');
      for (const m of s.mons) if (!m.dead && overlapRect(m, rx, ry, rw, rh)) killMon(s, m, 'fire');
    }
  }

  /* ---------- volcano: stalactites ---------- */
  function clearColumn(s, x, y0, y1) {
    for (let y = y0; y <= y1; y++) if (solidTile(s, x, y)) return false;
    return true;
  }
  function stepSpikes(s, dt) {
    const pl = s.player;
    for (const k of s.spikes) {
      if (k.st === 0) {
        // anything heavy passing beneath sets it off: you, or a stalker
        const col = Math.floor((k.x + 4) / T);
        const under = e => { const c = cxOf(e); return c > k.x - 7 && c < k.x + k.w + 7 && e.y > k.y && clearColumn(s, col, Math.floor(k.y / T), Math.floor((e.y + e.h - 1) / T)); };
        if ((!s.dead && under(pl)) || s.mons.some(m => !m.dead && under(m))) {
          k.st = 1; k.t = 0; s.events.push({ t: 'spikeShake', x: k.x + 4, y: k.y });
        }
      } else if (k.st === 1) {
        k.t += dt;
        if (k.t >= PH.spikeShake) { k.st = 2; k.vy = 0; }
      } else if (k.st === 2) {
        k.vy = Math.min(k.vy + PH.g * dt, PH.maxFall);
        k.y += k.vy * dt;
        const bx = Math.floor((k.x + 4) / T), by = Math.floor((k.y + k.h) / T);
        let hit = solidTile(s, bx, by) || lavaAt(s, k.x + 4, k.y + k.h) || k.y > s.rows * T;
        if (!s.dead && overlapRect(pl, k.x + 1, k.y + 2, k.w - 2, k.h - 2)) { kill(s, 'spike'); hit = true; }
        for (const m of s.mons) if (!m.dead && overlapRect(m, k.x, k.y, k.w, k.h)) { killMon(s, m, 'spike'); hit = true; }
        for (const c of s.cubes) if (!c.gone && !c.held && overlapRect(c, k.x, k.y + 4, k.w, k.h - 4)) hit = true;
        if (hit) { k.st = 3; k.t = 0; s.events.push({ t: 'shatter', x: k.x + 4, y: k.y + k.h }); }
      } else if (k.st === 3) {
        k.t += dt;
        if (k.t >= PH.spikeRegrow) { k.st = 0; k.y = k.hy; k.t = 0; }
      }
    }
  }

  /* ---------- volcano: lava sharks ---------- */
  function lavaCell(s, x, y) { // a cell a shark can swim in
    if (x < 0 || x >= s.cols || y < 0 || y >= s.rows) return false;
    const t = tileAt(s, x, y);
    if (t === ACID) return true;
    return (y + 1) * T > s.lavaY + 2 && !solidTile(s, x, y);
  }
  function surfaceAt(s, px, py) {
    const cx = Math.floor(px / T);
    let cy = Math.floor(py / T);
    if (tileAt(s, cx, cy) === ACID) {
      while (cy > 0 && tileAt(s, cx, cy - 1) === ACID) cy--;
      return Math.min(cy * T + 5, s.lavaY);
    }
    return s.lavaY;
  }
  function poolSpan(s, sh) {
    const row = Math.floor((sh.y + sh.h - 1) / T), c0 = Math.floor((sh.x + sh.w / 2) / T);
    let a = c0, b = c0;
    while (lavaCell(s, a - 1, row)) a--;
    while (lavaCell(s, b + 1, row)) b++;
    sh.x0 = a * T; sh.x1 = (b + 1) * T;
  }
  function stepSharks(s, dt) {
    const pl = s.player;
    for (const sh of s.sharks) {
      if (sh.dead) continue;
      sh.t += dt;
      const scx = cxOf(sh);
      if (sh.mode === 'swim') {
        sh.cd -= dt;
        const surf = surfaceAt(s, scx, sh.y + sh.h);
        sh.y = surf + 2;
        poolSpan(s, sh);
        const pcx = cxOf(pl), dx = pcx - scx;
        const pb = pl.y + pl.h;
        const hunting = !s.dead && Math.abs(dx) < 16 * T && pb <= surf + 6 && pb > surf - 10 * T;
        // line up under the player, or in the nearest open column next to them
        let tcx = pcx;
        if (hunting) {
          const c = Math.floor(pcx / T), row = Math.floor((surf + 1) / T);
          tcx = null;
          for (const o of [0, -1, 1]) {
            const cc = c + o;
            if (lavaCell(s, cc, row) && !solidTile(s, cc, row - 1) && !solidTile(s, cc, row - 2) && cc * T >= sh.x0 && (cc + 1) * T <= sh.x1) { tcx = (cc + 0.5) * T; break; }
          }
          if (tcx == null) tcx = clamp(pcx, sh.x0 + sh.w / 2, sh.x1 - sh.w / 2);
        }
        let v;
        if (hunting) v = Math.abs(tcx - scx) < 2 ? 0 : Math.sign(tcx - scx) * PH.sharkSwim;
        else { v = sh.dir * PH.sharkPatrol; }
        let nx = sh.x + v * dt;
        if (nx < sh.x0) { nx = sh.x0; sh.dir = 1; }
        if (nx + sh.w > sh.x1) { nx = sh.x1 - sh.w; sh.dir = -1; }
        if (v) sh.face = Math.sign(v);
        sh.x = nx;
        sh.px0 = sh.x0; sh.px1 = sh.x1;
        if (hunting && sh.cd <= 0 && Math.abs(tcx - cxOf(sh)) < 4 && Math.abs(pcx - cxOf(sh)) < PH.sharkReach && pb < surf) {
          const h = clamp(surf - pl.y + 8, 24, PH.sharkMaxH);
          sh.vy = -Math.sqrt(2 * PH.g * h);
          // rise straight out of the lava for the first 26px, then curve toward the player
          const v0 = -sh.vy, d = 26, tA = v0 / PH.g, t1 = v0 * v0 > 2 * PH.g * d ? (v0 - Math.sqrt(v0 * v0 - 2 * PH.g * d)) / PH.g : tA;
          sh.vx = clamp((pcx - cxOf(sh)) / Math.max(0.08, tA - t1), -160, 160);
          sh.ly = sh.y; sh.tx = pcx;
          sh.face = sh.vx > 0 ? 1 : sh.vx < 0 ? -1 : sh.face;
          sh.mode = 'leap'; sh.strand = 0;
          s.events.push({ t: 'splash', x: cxOf(sh), y: surf, up: true });
        }
      } else {
        sh.vy = Math.min(sh.vy + PH.g * dt, PH.maxFall);
        sh.hitX = sh.hitY = false;
        if ((sh.y < sh.ly - 26 || sh.vy > 0) && sh.vx) {
          const before = cxOf(sh);
          moveAxis(s, sh, sh.vx * dt, 0);
          if ((cxOf(sh) - sh.tx) * Math.sign(sh.vx) >= 0 && (before - sh.tx) * Math.sign(sh.vx) <= 0) sh.vx = 0; // lunged to where you were
        }
        const fall = sh.vy;
        moveAxis(s, sh, sh.vy * dt, 1);
        if (sh.hitY) sh.vy = Math.max(sh.vy, 0);
        if (sh.vy > 0 && lavaAt(s, cxOf(sh), sh.y + sh.h - 2)) {
          sh.mode = 'swim'; sh.cd = PH.sharkCD; sh.vx = sh.vy = 0;
          s.events.push({ t: 'splash', x: cxOf(sh), y: sh.y + sh.h });
        } else if (sh.hitY && fall > 0) {
          // stranded on rock: flop back toward the pool, or bake if it can't
          sh.strand = (sh.strand || 0) + 1;
          if (sh.strand > 6) { sh.dead = true; s.events.push({ t: 'monDie', x: cxOf(sh), y: cyOf(sh), why: 'stranded' }); continue; }
          sh.vy = -200; sh.vx = ((sh.px0 + sh.px1) / 2 > cxOf(sh) ? 1 : -1) * 80;
        }
      }
      if (!s.dead && overlapRect(pl, sh.x + 2, sh.y + 1, sh.w - 4, sh.h - 2) && (sh.mode === 'leap' || pl.y + pl.h > sh.y + 3)) kill(s, 'shark');
    }
  }

  /* ---------- volcano: stalkers (chase you, use portals, press buttons) ---------- */
  function sees(s, ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 5);
    for (let i = 1; i < n; i++) {
      const x = Math.floor((ax + (bx - ax) * i / n) / T), y = Math.floor((ay + (by - ay) * i / n) / T);
      if (solidTile(s, x, y) && tileAt(s, x, y) !== GRATE) return false;
    }
    return true;
  }
  function killMon(s, m, why) {
    if (m.dead) return;
    m.dead = true; m.deadT = 0;
    s.events.push({ t: 'monDie', x: cxOf(m), y: cyOf(m), why });
  }
  function stepMon(s, m, dt) {
    if (m.dead) { m.deadT += dt; return; }
    const pl = s.player;
    preStep(s, m);
    const dx = cxOf(pl) - cxOf(m), dy = cyOf(pl) - cyOf(m);
    if (!m.aggro && !s.dead && Math.abs(dx) < PH.monSeeX && Math.abs(dy) < PH.monSeeY && sees(s, cxOf(m), m.y + 4, cxOf(pl), pl.y + 6)) {
      m.aggro = true; s.events.push({ t: 'growl', x: cxOf(m), y: m.y });
    }
    let want = m.aggro && !s.dead && Math.abs(dx) > 3 ? Math.sign(dx) : 0;
    // a stalker freezes to stare up at stone cracking right above it
    if (s.spikes.some(k => k.st === 1 && cxOf(m) > k.x - 6 && cxOf(m) < k.x + k.w + 6 && m.y > k.y)) { want = 0; if (m.ground) m.vx = 0; }
    if (m.ground && want) {
      const fx = Math.floor((want > 0 ? m.x + m.w + 0.5 : m.x - 0.5) / T), fy = Math.floor((m.y + m.h + 2) / T);
      const below = tileAt(s, fx, fy);
      if (!solidTile(s, fx, fy)) {
        let hot = below === ACID || (fy + 1) * T > s.lavaY;
        for (let k = 1; k < 12 && !hot; k++) { if (solidTile(s, fx, fy + k)) break; if (tileAt(s, fx, fy + k) === ACID || (fy + k + 1) * T > s.lavaY) hot = true; }
        if (hot || dy < 20) { want = 0; m.vx = 0; }
      }
    }
    if (want) m.face = want;
    const acc = PH.monAcc * dt, tv = want * PH.monRun;
    if (m.ground) m.vx = m.vx < tv ? Math.min(tv, m.vx + acc) : Math.max(tv, m.vx - acc); // no steering in the air
    if (m.ground && want && m.blocked) { m.vy = -PH.monJump; m.ground = false; s.events.push({ t: 'monJump', x: cxOf(m), y: m.y + m.h }); }
    m.vy = Math.min(m.vy + PH.g * dt, PH.maxFall);
    m.hitX = m.hitY = false;
    moveAxis(s, m, m.vx * dt, 0);
    m.blocked = !!m.hitX && want !== 0;
    if (m.hitX && m.ground) m.vx = 0;
    const vy = m.vy;
    moveAxis(s, m, m.vy * dt, 1);
    m.ground = false;
    if (m.hitY) { if (vy > 0) { m.ground = true; if (Math.abs(m.vx) > PH.monRun) m.vx *= 0.5; } m.vy = 0; }
    if (m.ground && Math.abs(m.vx) > 5) m.walk += Math.abs(m.vx) * dt;
    postStep(s, m);
    if (m.ground) standOn(s, m);
    if (!s.dead && overlapRect(pl, m.x + 2, m.y + 2, m.w - 4, m.h - 2)) { kill(s, 'eaten'); s.events.push({ t: 'chomp', x: cxOf(m), y: cyOf(m) }); }
  }

  /* ---------- checkpoints ---------- */
  function stepFlags(s, dt) {
    const pl = s.player;
    for (const f of s.flags) {
      if (f.on) { f.t += dt; continue; }
      if (!s.dead && overlapRect(pl, f.x * T + 2, (f.y - 1) * T, 12, 2 * T)) {
        for (const o of s.flags) o.on = o === f ? true : o.on;
        f.on = true; f.t = 0;
        s.events.push({ t: 'checkpoint', x: (f.x + 0.5) * T, y: f.y * T });
      }
    }
  }

  /* ---------- portal device pickups ---------- */
  // 'G' upgrades the gun one step (none -> mint -> both). Fixed portals are handed over: all of them close,
  // then def.gunPre[newGunLevel] (if any) places the fixed portals for the next part of the chamber.
  function stepPickups(s) {
    const pl = s.player;
    for (const g of s.pickups) {
      if (g.taken || s.dead || !overlapRect(pl, g.x * T + 1, g.y * T - 4, 14, 20)) continue;
      g.taken = true;
      s.gun = Math.min(2, s.gun + 1);
      for (let i = 0; i < 2; i++) {
        const p = s.portals[i];
        if (p && p.fixed) { s.events.push({ t: 'close', c: i, x: p.px, y: p.py, n: p.n }); removePortal(s, i); }
      }
      for (const pre of (s.def.gunPre && s.def.gunPre[s.gun]) || []) {
        const p = makePortal(pre.c, pre.x, pre.y, FACE[pre.f], true);
        p.born = s.time; s.portals[pre.c] = p;
        s.events.push({ t: 'portal', c: pre.c, x: p.px, y: p.py, n: p.n });
      }
      s.events.push({ t: 'gun', gun: s.gun, x: (g.x + 0.5) * T, y: g.y * T + 8 });
    }
  }

  /* ---------- switches / doors / lasers ---------- */
  function overlapRect(e, x, y, w, h) { return e.x < x + w && e.x + e.w > x && e.y < y + h && e.y + e.h > y; }

  function updateSwitches(s, init) {
    const es = [];
    if (!s.dead) es.push(s.player);
    for (const c of s.cubes) if (!c.gone && !c.held) es.push(c);
    for (const m of s.mons) if (!m.dead) es.push(m);
    for (const b of s.buttons) {
      const x = b.x0 * T + 1, w = (b.x1 - b.x0 + 1) * T - 2, y = b.y * T + 11;
      const on = es.some(e => overlapRect(e, x, y, w, 5));
      if (on !== b.on && !init) s.events.push({ t: 'button', on, x: x + w / 2, y: y + 5 });
      b.on = on;
    }
    for (let ch = 1; ch <= 4; ch++) {
      let any = false, all = true;
      for (const b of s.buttons) if (b.ch === ch) { any = true; if (!b.on) all = false; }
      for (const r of s.receivers) if (r.ch === ch) { any = true; if (!r.on) all = false; }
      s.chan[ch] = any && all;
    }
    // anything standing in a doorway props every cell of that door's channel open
    const propped = [false, false, false, false, false];
    if (!init) for (const d of s.doors) if (d.open && !propped[d.ch] && ents(s).some(e => overlapRect(e, d.x * T, d.y * T, T, T))) propped[d.ch] = true;
    for (const d of s.doors) {
      const want = s.chan[d.ch];
      if (want !== d.open) {
        if (!want && propped[d.ch]) continue;
        d.open = want;
        if (!init) s.events.push({ t: 'door', open: want, x: (d.x + 0.5) * T, y: (d.y + 0.5) * T });
      }
      if (init) d.amt = d.open ? 1 : 0;
    }
    const ex = s.exit ? (s.exit.ch ? s.chan[s.exit.ch] : true) : false;
    if (ex !== s.exitOpen && !init) s.events.push({ t: 'exit', open: ex });
    s.exitOpen = ex;
  }

  function traceLasers(s) {
    s.beams.length = 0;
    const prev = s.receivers.map(r => r.on);
    for (const r of s.receivers) r.on = false;
    for (const em of s.emitters) {
      let x = (em.x + 0.5) * T + em.d[0] * T / 2, y = (em.y + 0.5) * T + em.d[1] * T / 2;
      let dx = em.d[0], dy = em.d[1];
      for (let hop = 0; hop < 8; hop++) {
        const r = traceSeg(s, x, y, dx, dy);
        s.beams.push({ x0: x, y0: y, x1: r.x, y1: r.y, dx, dy, end: r.kind });
        if (r.kind === 'player') { kill(s, 'laser'); break; }
        if (r.kind === 'mon') { killMon(s, r.ref, 'laser'); break; }
        if (r.kind === 'recv') { r.ref.on = true; break; }
        if (r.kind === 'wall' && r.crumb) { // the beam heats the whole rock formation it touches until it gives
          if (r.crumb.st === 0) {
            const todo = [r.crumb];
            while (todo.length) {
              const c = todo.pop();
              if (c.st !== 0) continue;
              c.st = 1; c.t = 0; s.events.push({ t: 'crack', x: (c.x + 0.5) * T, y: (c.y + 0.5) * T });
              for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const n = s.crumb[ix(s, c.x + ox, c.y + oy)];
                if (n && n.st === 0 && c.x + ox >= 0 && c.x + ox < s.cols) todo.push(n);
              }
            }
          }
          break;
        }
        if (r.kind !== 'portal') break;
        const p = r.ref, q = s.portals[1 - p.c];
        const [c, sn] = rotFor(p, q);
        const rx = r.x - p.px, ry = r.y - p.py;
        x = q.px + c * rx - sn * ry; y = q.py + sn * rx + c * ry;
        dx = q.n[0]; dy = q.n[1];
      }
    }
    s.receivers.forEach((r, i) => { if (r.on !== prev[i]) s.events.push({ t: 'recv', on: r.on, x: (r.x + 0.5) * T, y: (r.y + 0.5) * T }); });
  }

  function traceSeg(s, x, y, dx, dy) {
    let cx = Math.floor((x + dx * 0.5) / T), cy = Math.floor((y + dy * 0.5) / T);
    let hx = x + dx * 6000, hy = y + dy * 6000, kind = 'wall', ref = null, crumb = null;
    for (let i = 0; i < 400; i++) {
      const t = tileAt(s, cx, cy);
      const out = cx < 0 || cy < 0 || cx >= s.cols || cy >= s.rows;
      if (out || opaque(s, cx, cy, t)) {
        hx = dx > 0 ? cx * T : dx < 0 ? (cx + 1) * T : x;
        hy = dy > 0 ? cy * T : dy < 0 ? (cy + 1) * T : y;
        if (t === PANEL && linked(s)) {
          const p = portalOn(s, cx, cy);
          if (p && p.n[0] === -dx && p.n[1] === -dy) { kind = 'portal'; ref = p; }
        } else if (t === RECV) { kind = 'recv'; ref = s.recvAt[ix(s, cx, cy)]; }
        else if (t === CRUMB) crumb = s.crumb[ix(s, cx, cy)];
        break;
      }
      cx += dx; cy += dy;
    }
    let best = Math.abs(hx - x) + Math.abs(hy - y);
    for (const e of ents(s)) {
      let t = Infinity;
      if (dx !== 0) {
        if (y < e.y || y > e.y + e.h) continue;
        const edge = dx > 0 ? e.x : e.x + e.w;
        t = (edge - x) * dx;
        if (t < 0 && x > e.x && x < e.x + e.w) t = 0;
      } else {
        if (x < e.x || x > e.x + e.w) continue;
        const edge = dy > 0 ? e.y : e.y + e.h;
        t = (edge - y) * dy;
        if (t < 0 && y > e.y && y < e.y + e.h) t = 0;
      }
      if (t >= 0 && t < best) { best = t; kind = e.kind; ref = e; hx = x + dx * t; hy = y + dy * t; crumb = null; }
    }
    return { x: hx, y: hy, kind, ref, crumb };
  }

  function kill(s, cause) {
    if (s.dead || s.won) return;
    s.dead = true; s.endT = 0;
    const pl = s.player;
    if (pl.held) { pl.held.held = false; pl.held = null; }
    s.events.push({ t: 'die', cause, x: cxOf(pl), y: cyOf(pl) });
  }

  function inLava(s, e) { return e.y + e.h > s.lavaY + 3; }

  function hazards(s) {
    const pl = s.player;
    const check = (e, onAcid, onFizz) => {
      const x0 = Math.floor(e.x / T), x1 = Math.floor((e.x + e.w - 0.001) / T);
      const y0 = Math.floor(e.y / T), y1 = Math.floor((e.y + e.h - 0.001) / T);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const t = tileAt(s, x, y);
        if (t === ACID && e.y + e.h > y * T + 6) onAcid();
        else if (t === FIZZ && e.x < x * T + 11 && e.x + e.w > x * T + 5) onFizz();
      }
      if (inLava(s, e)) onAcid();
    };
    for (const c of s.cubes) if (!c.gone) check(c, () => destroyCube(s, c, 'acid'), () => destroyCube(s, c, 'fizz'));
    for (const m of s.mons) if (!m.dead) check(m, () => killMon(s, m, 'lava'), () => killMon(s, m, 'fizz'));
    if (!s.dead) {
      let fz = false;
      check(pl, () => kill(s, 'acid'), () => { fz = true; });
      if (fz) fizzlePortals(s);
    }
  }

  /* ---------- main step ---------- */
  function world(s, dt) {
    stepLava(s, dt);
    stepCrumbs(s, dt);
    stepVents(s, dt);
    stepSpikes(s, dt);
    stepSharks(s, dt);
  }

  function step(s, inp, dt) {
    s.time += dt;
    for (const d of s.doors) d.amt += clamp((d.open ? 1 : 0) - d.amt, -dt * 5, dt * 5);
    for (const b of s.buttons) b.amt += clamp((b.on ? 1 : 0) - b.amt, -dt * 12, dt * 12);
    for (const r of s.receivers) r.onT += clamp((r.on ? 1 : 0) - r.onT, -dt * 4, dt * 4);
    if (s.won || s.dead) {
      s.endT += dt;
      world(s, dt);
      for (const m of s.mons) stepMon(s, m, dt);
      return;
    }
    const pl = s.player;
    s.shotCD = Math.max(0, s.shotCD - dt);
    if (inp.ax != null) { pl.aimX = inp.ax; pl.aimY = inp.ay; }
    if (inp.shoot === 0 || inp.shoot === 1) shoot(s, inp.shoot, pl.aimX, pl.aimY);
    if (inp.grab) toggleGrab(s);
    if (inp.jumpPressed) pl.buf = PH.buffer;
    stepPlayer(s, inp, dt);
    stepPickups(s);
    for (const c of s.cubes) stepCube(s, c, dt);
    for (const m of s.mons) stepMon(s, m, dt);
    world(s, dt);
    stepFlags(s, dt);
    updateSwitches(s, false);
    traceLasers(s);
    hazards(s);
    if (!s.dead && s.exit && s.exitOpen) {
      const ex = s.exit, px = cxOf(pl), py = cyOf(pl);
      if (px > ex.x * T + 2 && px < ex.x * T + 14 && py > (ex.y - 1) * T && py < (ex.y + 1) * T) {
        s.won = true; s.endT = 0; s.events.push({ t: 'win', x: px, y: py });
      }
    }
  }

  const API = {
    T, COLS: VCOLS, ROWS: VROWS, W, H, PH,
    TILE: { EMPTY, METAL, PANEL, GRATE, ACID, FIZZ, EMIT, RECV, DOOR, CRUMB, VENT },
    load, step, shoot, aimInfo, raycast, tileAt, solidTile, portalOn, linked, gunOrigin, camTarget, lavaAt
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.Engine = API;
})(typeof window !== 'undefined' ? window : globalThis);
