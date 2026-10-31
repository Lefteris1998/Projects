// The backdrop behind the home and lobby screens: the real board with a bot match playing on it, filmed by a director
// camera that cuts between slow cinematic shots. The edge of the frame dissolves into Haunt Filter glyphs (dim squares
// in the scene's colours, katakana in the darks, a block ramp in the brights, orange + marks), and every cut is a glitch:
// the glyphs flood the screen with a few torn, colour-split slices, then dissolve away onto the new shot.
import * as THREE from '/vendor/three/three.module.js';
import { createBoard, createMotes, DICE_STYLE_IDS } from './board3d.js';

const BOT_NAMES = ['xX_CamelSmurf_Xx', 'AuraFarmer', 'DuoQHostage', 'TaxEvader', 'OasisEnjoyer', 'LostToASilver', 'ZoomiesMain', 'SandSweat'];
const STEP_MS = 260;
const MIN_CAST = 4;
const KANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'];
const RAMP = [...'·:+×□#▣█'];
const GLYPHS = [...RAMP, ...KANA, '+'];
const PLUS = GLYPHS.length - 1;
const STILL = matchMedia('(prefers-reduced-motion: reduce)').matches;

const rand = n => Math.floor(Math.random() * n);
const pick = list => list[rand(list.length)];
const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = rand(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const smooth = (a, b, v) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k); };
const hash = (i, j, k) => {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const div = (cls, text) => { const el = document.createElement('div'); el.className = cls; if (text) el.textContent = text; return el; };

// opts.insets(): the parts of the screen the UI covers, so the board is framed in the free part.
export function createAttract(host, opts = {}) {
  const stage = div('bd-stage');
  const fx = document.createElement('canvas');
  fx.className = 'bd-glyphs';
  const ticker = div('bd-ticker');
  const live = div('bd-live');
  const line = div('bd-line');
  ticker.append(live, line);
  host.append(stage, fx, ticker);

  let board = null;
  let intro = null;
  let active = true;
  let bots = [];
  let castKey = '';
  let homeCast = null;
  let cur = null;
  let moving = null;
  let round = 1;
  let pendingCast = null;
  let centerX = 0.5; // where the board sits on screen, 0..1
  let centerY = 0.5;

  // ---------------------------------------------------------------------------
  // Sim clock: only runs while the backdrop is drawn, so the match freezes behind the game screen.
  // ---------------------------------------------------------------------------
  let simT = 0;
  let waiters = [];
  const sleep = ms => new Promise(res => waiters.push({ at: simT + ms, res }));
  function advance(dt) {
    simT += dt * 1000;
    const due = waiters.filter(w => w.at <= simT);
    if (!due.length) return;
    waiters = waiters.filter(w => w.at > simT);
    due.forEach(w => w.res());
  }

  // ---------------------------------------------------------------------------
  // Cast: random bots on the home screen, the lobby's own riders (topped up with bots) in the lobby.
  // ---------------------------------------------------------------------------
  function makeHomeCast() {
    const champs = shuffle(intro.champions);
    const colors = shuffle(intro.colors);
    const names = shuffle(BOT_NAMES);
    return Array.from({ length: 5 }, (_, i) => ({ id: `bot${i}`, name: names[i], color: colors[i], champion: champs[i] }));
  }

  function lobbyCast(players) {
    const list = players.map(p => ({ id: p.id, name: p.name, color: p.color, champion: p.champion || 'camel' }));
    const champs = shuffle(intro.champions.filter(c => !list.some(p => p.champion === c)));
    const colors = shuffle(intro.colors.filter(c => !list.some(p => p.color === c)));
    const names = shuffle(BOT_NAMES);
    for (let i = 0; list.length < MIN_CAST; i++) {
      list.push({ id: `bot${i}`, name: `${names[i]} (bot)`, color: colors[i] || pick(intro.colors), champion: champs[i] || 'camel' });
    }
    return list;
  }

  function setCast(players) {
    if (!intro) { pendingCast = players; return; }
    const list = players ? lobbyCast(players) : (homeCast ||= makeHomeCast());
    const key = list.map(b => `${b.id}:${b.color}:${b.champion}:${b.name}`).join('|');
    pendingCast = players;
    if (key === castKey) return;
    castKey = key;
    const old = new Map(bots.map(b => [b.id, b]));
    bots = list.map(x => Object.assign(old.get(x.id) || { pos: rand(24), aura: 40 + rand(60) }, x));
    pushPlayers();
    layout();
  }

  function pushPlayers() {
    const top = [...bots].sort((a, b) => b.aura - a.aura);
    const lead = top.length > 1 && top[0].aura > top[1].aura ? top[0] : null;
    board.setPlayers(bots.map(b => ({
      id: b.id, color: b.color, champion: b.champion, letter: (b.name.trim()[0] || '?'), current: b === cur, faded: false, lead: b === lead,
    })));
  }

  // Riders sharing a tile stand in a little circle on it.
  function layout() {
    const at = {};
    for (const b of bots) if (b !== moving) (at[b.pos] ||= []).push(b);
    for (const [pos, list] of Object.entries(at)) list.forEach((b, k) => board.place(b.id, +pos, k, list.length));
  }

  // ---------------------------------------------------------------------------
  // The match
  // ---------------------------------------------------------------------------
  const floats = div('bd-floats');
  host.append(floats);
  function float(b, text, good) {
    if (!bots.includes(b)) return;
    const { x, y } = board.screenPos(b.id);
    const el = div(`float ${good ? 'good' : 'bad'}`, text);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    floats.append(el);
    setTimeout(() => el.remove(), 1500);
  }

  // Sometimes the bots aim for each other, so there's a t-bag to cut to.
  function pickRoll(b) {
    if (Math.random() < 0.45) {
      for (let k = 1; k <= 6; k++) if (bots.some(o => o !== b && o.pos === (b.pos + k) % 24)) return k;
    }
    return 1 + rand(6);
  }

  async function land(b) {
    const t = intro.board[b.pos];
    const here = bots.filter(o => o !== b && o.pos === b.pos);
    if (here.length && Math.random() < 0.85) {
      const v = pick(here);
      const steal = 5 + rand(11);
      director.event('tbag', b);
      await sleep(450);
      board.tbag(b.id);
      board.shake(v.id);
      say(`${b.name} t-bagged ${v.name} · stole ${steal} aura`);
      await sleep(500);
      b.aura += steal;
      v.aura -= steal;
      float(b, `+${steal}`, true);
      await sleep(500);
      float(v, `-${steal}`, false);
      await sleep(1200);
      return;
    }
    switch (t.type) {
      case 'aura':
        b.aura += t.amount;
        float(b, `+${t.amount}`, true);
        say(`${b.name} · ${t.name} · +${t.amount} aura`);
        break;
      case 'cringe':
        b.aura -= t.amount;
        board.shake(b.id);
        float(b, `-${t.amount}`, false);
        say(`${b.name} · ${t.name} · -${t.amount} aura`);
        break;
      case 'storm':
        say(`${b.name} got caught in a sandstorm`);
        await sleep(500);
        board.poof(b.id);
        b.pos = rand(24);
        board.place(b.id, b.pos);
        board.setLit(b.pos);
        await sleep(700);
        break;
      case 'arena': {
        const opp = bots.length > 1 ? pick(bots.filter(o => o !== b)) : null;
        if (!opp) break;
        say(`${b.name} called ${opp.name} to a Ranked 1v1`);
        await sleep(900);
        const [w, l] = Math.random() < 0.5 ? [b, opp] : [opp, b];
        w.aura += 12;
        l.aura -= 12;
        board.shake(l.id);
        float(w, '+12', true);
        float(l, '-12', false);
        say(`${w.name} won the 1v1 · +12 aura`);
        break;
      }
      default:
        float(b, t.name, true);
        say(`${b.name} landed on ${t.name}`);
    }
  }

  async function play() {
    for (let turn = 0; ; turn++) {
      if (!bots.length) { await sleep(500); continue; }
      cur = bots[turn % bots.length];
      round = Math.floor(turn / bots.length) + 1;
      const b = cur;
      pushPlayers();
      board.setLit(b.pos);
      director.event('turn', b);
      say(`${b.name}'s turn`);
      await sleep(1100);
      const n = pickRoll(b);
      await board.roll(n, 850, DICE_STYLE_IDS[Math.floor(Math.random() * DICE_STYLE_IDS.length)]);
      say(`${b.name} rolled a ${n}`);
      await sleep(450);
      moving = b;
      for (let s = 0; s < n; s++) {
        b.pos = (b.pos + 1) % 24;
        board.hop(b.id, b.pos);
        board.setLit(b.pos);
        await sleep(STEP_MS);
      }
      moving = null;
      await sleep(250);
      await land(b);
      layout();
      pushPlayers();
      await sleep(1600);
    }
  }

  // ---------------------------------------------------------------------------
  // Ticker: a broadcast lower third. New lines decode in from glyphs, left to right.
  // ---------------------------------------------------------------------------
  let sayTimer = 0;
  function say(text) {
    live.textContent = `LIVE · BOT MATCH · ROUND ${round}`;
    clearInterval(sayTimer);
    if (STILL) { line.textContent = text; return; }
    const t0 = performance.now();
    sayTimer = setInterval(() => {
      const shown = Math.floor((performance.now() - t0) / 18);
      line.textContent = [...text].map((ch, i) => (i < shown || ch === ' ' ? ch : pick(i < shown + 6 ? RAMP : KANA))).join('');
      if (shown >= text.length) clearInterval(sayTimer);
    }, 30);
  }

  // ---------------------------------------------------------------------------
  // Director: picks a shot on each turn (and a close-up on every t-bag), eases within a shot, hard-cuts between them.
  // ---------------------------------------------------------------------------
  const WIDE = ['orbit', 'crane', 'sweep'];
  const director = {
    shot: { kind: 'orbit', subject: null, seed: Math.random(), age: 0 },
    snap: true,
    pos: new THREE.Vector3(),
    look: new THREE.Vector3(),
    focus: new THREE.Vector3(),
    cut(kind, subject) {
      this.shot = { kind, subject, seed: Math.random(), age: 0, yaw0: null };
      this.snap = true;
      glitch();
    },
    event(type, b) {
      const s = this.shot;
      if (type === 'tbag') { if (s.age > 1) this.cut('closeup', b); return; }
      if (WIDE.includes(s.kind) && s.age < 2.5) return;
      const r = Math.random();
      this.cut(r < 0.5 ? 'follow' : r < 0.67 ? 'sweep' : r < 0.84 ? 'crane' : 'orbit', b);
    },
    frame(camera, dt) {
      const s = this.shot;
      s.age += dt * (STILL ? 0.5 : 1);
      if (s.age > 11) this.cut(pick(WIDE), cur);
      const u = s.age;
      const fit = board.fit();
      const p = s.subject && board.pawnPos(s.subject.id);
      const want = p ? p.clone().setY(0) : new THREE.Vector3();
      if (this.snap) this.focus.copy(want); else this.focus.lerp(want, 1 - Math.exp(-dt * 3.5));
      const F = this.focus;
      const sph = (yaw, pitch, dist) => new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
      const out = Math.atan2(F.x, F.z); // from the centre out past the subject
      const front = (s.seed - 0.5) * 1.8; // wide shots stay on the near side, so the tiles read the right way up
      if (s.yaw0 == null) s.yaw0 = out + (s.seed - 0.5) * 1.4;
      let pos;
      let look;
      switch (s.kind) {
        case 'crane': {
          const k = Math.min(1, u / 10);
          pos = sph(front + u * 0.05, 1.42 - k * 0.32, fit * (0.95 - k * 0.12));
          look = new THREE.Vector3();
          break;
        }
        case 'sweep': { // low across the tiles, gliding along one side of the board
          const side = s.seed < 0.5 ? 0 : s.seed < 0.75 ? Math.PI / 2 : -Math.PI / 2;
          const local = new THREE.Vector3(-3.4 + u * 0.55, 0.55, 5.4);
          pos = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), side);
          look = F.clone().multiplyScalar(0.6).setY(0.25);
          break;
        }
        case 'follow':
          pos = F.clone().add(sph(out + (s.seed - 0.5) * 1.2, 0.42, 4.6 - Math.min(u, 6) * 0.14));
          look = F.clone().multiplyScalar(0.75).setY(0.35);
          break;
        case 'closeup':
          pos = F.clone().add(sph(s.yaw0 + u * 0.3, 0.2, 2.1));
          look = F.clone().setY(0.32);
          break;
        default: // orbit
          pos = sph(front + u * 0.07, 0.72, fit * 0.92);
          look = F.clone().multiplyScalar(0.25);
      }
      // a little handheld drift
      const tt = simT / 1000;
      pos.x += Math.sin(tt * 0.7) * 0.04;
      pos.y += Math.sin(tt * 0.9 + 1) * 0.03;
      if (this.snap) { this.pos.copy(pos); this.look.copy(look); this.snap = false; }
      else { this.pos.lerp(pos, 1 - Math.exp(-dt * 5)); this.look.lerp(look, 1 - Math.exp(-dt * 5)); }
      camera.position.copy(this.pos);
      camera.lookAt(this.look);
    },
  };

  // ---------------------------------------------------------------------------
  // Glyph pass: the WebGL frame is sampled into cells and redrawn as squares + glyphs, strongest at the edges.
  // ---------------------------------------------------------------------------
  const g = fx.getContext('2d');
  const small = document.createElement('canvas');
  const sg = small.getContext('2d', { willReadFrequently: true });
  const atlas = document.createElement('canvas');
  let cell = 11;
  let dpr = 1;
  let cols = 0;
  let rows = 0;
  let flood = 0;
  let floodSeed = 1;
  let tear = 0;
  let frameNo = 0;
  let lastT = 0;

  function sizeGlyphs() {
    dpr = Math.min(devicePixelRatio || 1, 1.5);
    cell = innerWidth < 700 ? 9 : 11;
    cols = Math.ceil(innerWidth / cell);
    rows = Math.ceil(innerHeight / cell);
    small.width = cols;
    small.height = rows;
    const cd = Math.round(cell * dpr);
    fx.width = cols * cd;
    fx.height = rows * cd;
    fx.style.width = `${cols * cell}px`;
    fx.style.height = `${rows * cell}px`;
    atlas.width = GLYPHS.length * cd;
    atlas.height = cd;
    const ag = atlas.getContext('2d');
    ag.font = `700 ${cd}px 'JetBrains Mono', ui-monospace, monospace`;
    ag.textAlign = 'center';
    ag.textBaseline = 'middle';
    GLYPHS.forEach((ch, k) => { ag.fillStyle = k === PLUS ? '#f08c4a' : '#f3ece0'; ag.fillText(ch, k * cd + cd / 2, cd / 2 + 1); });
  }

  function glitch() {
    if (STILL) return;
    flood = 1;
    tear = 1;
    floodSeed = rand(1e6);
  }

  function drawGlyphs(src, t) {
    const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 0.016;
    lastT = t;
    flood = Math.max(0, flood - dt / 0.42);
    tear = Math.max(0, tear - dt / 0.26);
    if (++frameNo % 2 && !flood) return; // 30fps is plenty for the edges
    sg.drawImage(src, 0, 0, cols, rows);
    const d = sg.getImageData(0, 0, cols, rows).data;
    const cd = Math.round(cell * dpr);
    g.clearRect(0, 0, fx.width, fx.height);
    const cx = centerX;
    const tick = Math.floor(t / (STILL ? 400 : 110));
    for (let j = 0; j < rows; j++) {
      const ny = ((j + 0.5) / rows - centerY) * 2;
      for (let i = 0; i < cols; i++) {
        const nx = ((i + 0.5) / cols - cx) * 2.1;
        const e = smooth(0.6, 1.25, Math.sqrt(nx * nx * 0.75 + ny * ny));
        const fl = flood > 0 && hash(i >> 1, j >> 1, floodSeed) < flood ? 1 : 0;
        const m = Math.max(e, fl);
        if (m < 0.05) continue;
        const o = (j * cols + i) * 4;
        const lum = (d[o] * 0.3 + d[o + 1] * 0.59 + d[o + 2] * 0.11) / 255;
        if (lum < 0.11 && !fl) continue;
        const x = i * cd;
        const y = j * cd;
        const sz = Math.max(1, Math.round(cd * (0.3 + 0.62 * lum)));
        g.globalAlpha = Math.min(1, m * (0.3 + 0.7 * lum));
        g.fillStyle = `rgb(${Math.min(255, d[o] * 1.3) | 0},${Math.min(255, d[o + 1] * 1.3) | 0},${Math.min(255, d[o + 2] * 1.3) | 0})`;
        g.fillRect(x + ((cd - sz) >> 1), y + ((cd - sz) >> 1), sz, sz);
        const r = hash(i, j, tick + ((i * 7 + j * 3) % 11));
        if (r < 0.38) continue;
        const k = e > 0.08 && e < 0.4 && r > 0.93 ? PLUS : lum > 0.55 ? Math.min(7, (lum * 8) | 0) : 8 + ((r * KANA.length) | 0);
        g.globalAlpha = Math.min(1, m * (0.25 + lum * 1.4));
        g.drawImage(atlas, k * cd, 0, cd, cd, x, y, cd, cd);
      }
    }
    // the tear: a few slices of the frame knocked sideways, tinted red and cyan
    if (tear > 0) {
      const sx = src.width / fx.width;
      const sy = src.height / fx.height;
      for (let n = 0; n < 6; n++) {
        const y = rand(fx.height);
        const hgt = 6 + rand(60);
        const off = (Math.random() - 0.5) * 120 * tear;
        g.globalAlpha = 0.9 * tear;
        g.drawImage(src, 0, y * sy, src.width, hgt * sy, off, y, fx.width, hgt);
        g.globalAlpha = 0.35 * tear;
        g.fillStyle = n % 2 ? '#4cc9f0' : '#ff4d6d';
        g.fillRect(off + (n % 2 ? 6 : -6), y, fx.width, hgt);
      }
    }
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function resize() {
    sizeGlyphs();
    if (board) board.resize();
    const ins = opts.insets ? opts.insets() : { top: 0, right: 0, bottom: 0, left: 0 };
    centerX = (ins.left + (innerWidth - ins.right)) / 2 / innerWidth;
    centerY = (ins.top + (innerHeight - ins.bottom)) / 2 / innerHeight;
    host.style.setProperty('--cx', `${centerX * 100}%`);
    host.style.setProperty('--cy', `${centerY * 100}%`);
  }
  addEventListener('resize', resize);
  sizeGlyphs();

  fetch('/intro.json').then(r => r.json()).then(data => {
    intro = data;
    board = createBoard(stage, {
      maxDpr: 1.5,
      insets: opts.insets,
      watch: opts.watch,
      director: (camera, t, dt) => {
        advance(dt);
        director.frame(camera, dt);
      },
      afterRender: drawGlyphs,
    });
    board.build(intro.board);
    board.setDeck('guard', false, 28);
    board.setDeck('attack', false, 28);
    board.scene.add(createMotes());
    board.setRunning(active);
    setCast(pendingCast);
    resize();
    host.classList.add('ready');
    play();
  }).catch(() => { /* no backdrop, the plain background still works */ });

  function setScreen(name) {
    active = name !== 'game';
    host.classList.toggle('off', !active);
    if (board) board.setRunning(active);
    if (name === 'home') setCast(null);
    requestAnimationFrame(resize);
  }

  return { setScreen, setCast, resize };
}
