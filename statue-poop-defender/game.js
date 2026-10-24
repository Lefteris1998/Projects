'use strict';
// Statue Poop Defender. After Damn Birds (Dmitry Zheltobriukhov / MoFunZone, 2008): you're a park statue with a gun,
// the birds have been pooping on you for years, and tonight you shoot back. Kill birds for cash, spend it between
// nights on guns, ammo, a wax coat and a scrub. The park is drawn into a low-res "source" canvas and re-rendered in the
// HAUNT style; the crosshair, cash pops and banners are drawn sharp on top.
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('view'), ctx = cv.getContext('2d');
  const src = document.createElement('canvas'), sx = src.getContext('2d', { willReadFrequently: true });
  const bgc = document.createElement('canvas'), bx = bgc.getContext('2d');
  const grid = document.createElement('canvas'), gx = grid.getContext('2d', { willReadFrequently: true });
  const glow = document.createElement('canvas'), wx = glow.getContext('2d');

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => t * t * (3 - 2 * t);
  const hash = (i, j, k) => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const RAMP = ['·', ':', '+', '×', '□', '#', '▣', '█'];
  const KANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'];
  const DISPLAY = 'Creepster, Impact, sans-serif', BODY = 'Rubik, system-ui, sans-serif';

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    src.width = Math.ceil(W / 2); src.height = Math.ceil(H / 2);
    glow.width = Math.ceil(W / 3); glow.height = Math.ceil(H / 3);
    layout();
  }

  // ---------------------------------------------------------------------------
  // Rules
  // ---------------------------------------------------------------------------
  // the guns, keys 1-7, in the order you'd buy them (bazooka aside). they all feed from one ammo pool; use is how much a single shot eats (the laser: per point of energy)
  const GUNS = [
    { id: 'musket', name: 'Musket', price: 0, dmg: 3, pellets: 1, spread: 0.006, delay: 0.55, len: 0.95, use: 1, useLabel: '1 per shot', ups: [120, 240, 360, 480, 600],
      icon: '<path d="M2 18 L30 14 L34 21 L8 27 Z"/><rect x="30" y="13" width="86" height="4"/><rect x="40" y="17" width="4" height="5"/>' },
    { id: 'smg', name: 'SMG', price: 400, dmg: 1, pellets: 1, spread: 0.045, delay: 0.075, len: 0.55, auto: true, use: 0.25, useLabel: '¼ per shot', ups: [180, 360, 540, 720, 900],
      icon: '<path d="M24 12 L6 16 L6 23 L24 19 Z"/><rect x="24" y="9" width="58" height="11"/><rect x="40" y="20" width="8" height="12"/><rect x="82" y="12" width="20" height="4"/>' },
    { id: 'shotgun', name: 'Shotgun', price: 900, dmg: 1, pellets: 7, spread: 0.13, delay: 0.6, len: 0.75, use: 3, useLabel: '3 per shot', ups: [260, 520, 780, 1040, 1300],
      icon: '<path d="M2 17 L30 13 L34 22 L6 27 Z"/><rect x="30" y="11" width="70" height="4"/><rect x="30" y="16" width="70" height="4"/>' },
    { id: 'pump', name: 'Pump Gun', price: 1500, dmg: 1.3, pellets: 6, spread: 0.08, delay: 0.5, len: 0.82, use: 2, useLabel: '2 per shot', ups: [350, 700, 1050, 1400, 1750],
      icon: '<path d="M2 16 L28 13 L30 22 L4 25 Z"/><rect x="28" y="12" width="80" height="6"/><rect x="58" y="18" width="26" height="6"/>' },
    { id: 'bazooka', name: 'Bazooka', price: 3800, dmg: 14, pellets: 1, spread: 0.01, delay: 1.4, len: 0.95, rocket: true, use: 12, useLabel: '12 per rocket', ups: [650, 1300, 1950, 2600, 3250],
      icon: '<rect x="6" y="9" width="104" height="12" rx="2"/><rect x="100" y="6" width="14" height="18"/><rect x="40" y="21" width="6" height="10"/><rect x="62" y="21" width="6" height="7"/>' },
    { id: 'tesla', name: 'Tesla', price: 2200, dmg: 5, pellets: 1, spread: 0.01, delay: 0.35, len: 0.8, chain: 5, charge: 1.5, use: 4, useLabel: '4 per shot', ups: [450, 900, 1350, 1800, 2250],
      icon: '<rect x="4" y="12" width="28" height="9"/><rect x="30" y="9" width="56" height="14" rx="3"/><rect x="40" y="5" width="5" height="22"/><rect x="52" y="5" width="5" height="22"/><rect x="64" y="5" width="5" height="22"/><rect x="86" y="13" width="22" height="5"/><circle cx="111" cy="15" r="5"/><rect x="40" y="23" width="7" height="8"/>' },
    { id: 'laser', name: 'Eye Laser', price: 3000, dmg: 2, pellets: 1, spread: 0, delay: 0, len: 0, beam: true, auto: true, use: 0.08, useLabel: '~2 per second', ups: [550, 1100, 1650, 2200, 2750],
      icon: '<path d="M4 16 Q26 3 48 16 Q26 29 4 16Z"/><circle cx="26" cy="16" r="6" fill="#140808"/><path d="M48 13 L116 10 L116 22 L48 19Z"/>' },
  ];
  const bulletGun = (g) => !g.rocket && !g.chain && !g.beam; // the ones that fire the loaded bullet type
  // bullet types, after Terraria's ammo. bought once, then one is loaded at a time (E cycles them)
  const AMMO = [
    { id: 'ball', name: 'Musket Ball', price: 0, col: '#ffe9a0', tag: 'Plain lead' },
    { id: 'meteor', name: 'Meteor Shot', price: 400, col: '#ff8a4a', tag: 'Ricochets' },
    { id: 'chloro', name: 'Chlorophyte', price: 800, col: '#7dff8a', tag: 'Homes in' },
    { id: 'crystal', name: 'Crystal Bullet', price: 900, col: '#e08aff', tag: 'Shatters' },
    { id: 'cursed', name: 'Cursed Bullet', price: 1000, col: '#a6ff3a', tag: 'Cursed flame' },
    { id: 'exploding', name: 'Exploding Bullet', price: 1500, col: '#ffb050', tag: 'Explodes' },
    { id: 'golden', name: 'Golden Bullet', price: 1200, col: '#f2c14e', tag: '+50% money' },
  ];
  const AMMO_PACKS = [[100, 15], [500, 60]];
  const stats = (i) => { const g = GUNS[i], L = S.guns[i].lvl; return { dmg: g.dmg * (1 + 0.5 * L), delay: g.delay * (1 - 0.08 * L) }; }; // upgrades: harder and faster
  // shadowy birds with red eyes. re: how often they pick a new altitude, climb: how hard they chase it,
  // surge: speed bursts, turn: chance per second of a u-turn mid-screen, wob: flutter
  const BIRDS = {
    pigeon: { hp: 3, speed: [95, 135], size: 27, poop: 4, loads: [1, 2], cash: 11, flap: 14, col: '#464b62', wing: '#33374a', beak: '#6a6458', re: [0.6, 1.4], climb: 2.6, surge: 0.35, turn: 0.14, wob: 14 },
    crow: { hp: 5, speed: [145, 185], size: 27, poop: 4, loads: [1, 2], cash: 16, flap: 16, col: '#3a3048', wing: '#2a2236', beak: '#4a4650', re: [0.25, 0.6], climb: 4.5, surge: 0.5, turn: 0.2, wob: 8 },
    gull: { hp: 8, speed: [105, 145], size: 34, poop: 7, loads: [1, 2], cash: 24, flap: 9, col: '#666c78', wing: '#4a505c', beak: '#8a7a50', re: [1.2, 2.4], climb: 1.8, surge: 0.25, turn: 0.1, wob: 24 },
    goose: { hp: 20, speed: [55, 75], size: 42, poop: 11, loads: [2, 4], cash: 50, flap: 7, col: '#3e342a', wing: '#2e261e', beak: '#6a5030', re: [1.8, 3.2], climb: 1.2, surge: 0.15, turn: 0.06, wob: 10 },
    mega: { hp: 70, speed: [45, 60], size: 64, poop: 16, loads: [3, 5], cash: 300, flap: 5, col: '#565b76', wing: '#3e4258', beak: '#7a7060', re: [2, 3.5], climb: 1, surge: 0.1, turn: 0.04, wob: 8, crown: true },
    golden: { hp: 3, speed: [250, 310], size: 22, poop: 0, loads: [0, 0], cash: 120, flap: 22, col: '#c89a30', wing: '#a07420', beak: '#e8d090', re: [0.15, 0.4], climb: 6, surge: 0.7, turn: 0.3, wob: 18 },
  };
  const COMBO = ['', '', 'DOUBLE', 'TRIPLE', 'QUAD'];
  let BEST = 0;
  try { BEST = +localStorage.getItem('statue.best') || 0; } catch (e) { /* storage blocked */ }

  // statue geometry in CSS px, set in layout(): U is the size unit, SX the centre line, GY the ground, top the plinth top
  const G = { U: 60, SX: 0, GY: 0, top: 0 };
  function layout() {
    G.U = clamp(Math.min(H / 12.5, W / 8.5), 28, 72);
    G.SX = W / 2; G.GY = H - Math.max(40, H * 0.1); G.top = G.GY - 1.25 * G.U;
    drawBackdrop();
  }
  const ceiling = () => G.top - 3.1 * G.U; // lowest a bird will fly: just over the statue's head
  const skyY = () => rand(H * 0.07, Math.max(H * 0.12, ceiling() - 0.3 * G.U));
  const gravity = () => H * 1.6;

  const S = {};
  // playtest cheats, flipped from the debug menu
  const D = { ammo: false, god: false, money: false, oneshot: false, storm: false, freeze: false, slow: false };
  function newGame() {
    Object.assign(S, {
      phase: 'play', night: 0, cash: 0, cov: 0, cap: 100, capLvl: 0, kills: 0, shots: 0, hits: 0, trickle: 0,
      guns: GUNS.map((g, i) => ({ owned: i === 0, lvl: 0 })), ammo: 80, ammoOwned: { ball: true }, ammoType: 'ball', chargeT: 0,
      gun: 0, side: 1, aim: -Math.PI / 2 + 0.3, mx: W / 2 + 120, my: H * 0.3, trigger: false,
      cool: 0, recoil: 0, flash: 0, dry: 0, shake: 0,
      birds: [], poops: [], rockets: [], corpses: [], parts: [], tracers: [], blasts: [], splats: [], ground: [], pops: [],
      queue: [], clock: 0, combo: { n: 0, t: -9 }, banner: null,
      acidOwned: false, acidReady: true, acid: null, acidDrops: Array.from({ length: 260 }, () => ({ x: rand(-60, W), y: rand(0, H), v: rand(600, 900), l: rand(12, 22) })),
      rain: Array.from({ length: 180 }, () => ({ x: rand(-60, W), y: rand(0, H), v: rand(700, 1000), l: rand(10, 18) })), fullMoon: false,
      arcs: [], bolts: [], storm: null, stormReady: true, babies: { n: 0, lvl: 0, tur: [], gun: 'pistol', guns: { pistol: true } },
      clouds: Array.from({ length: 6 }, () => ({ x: rand(0, W), y: rand(H * 0.04, H * 0.35), w: rand(160, 320), h: rand(14, 30), v: rand(5, 14) })),
      fog: Array.from({ length: 5 }, (_, i) => ({ x: rand(0, W), y: i % 2, w: rand(300, 600), v: rand(-14, 14) || 8 })),
    });
  }

  function startNight() {
    S.snap = JSON.stringify({ night: S.night, cash: S.cash, cov: S.cov, cap: S.cap, capLvl: S.capLvl, kills: S.kills, guns: S.guns, acidOwned: S.acidOwned, ammo: S.ammo, ammoOwned: S.ammoOwned, ammoType: S.ammoType, babies: { n: S.babies.n, lvl: S.babies.lvl, gun: S.babies.gun, guns: S.babies.guns }, splats: S.splats });
    S.night++; S.phase = 'play'; S.clock = 0;
    S.fullMoon = S.night % 3 === 0; // bigger birds, rain, and the mega pigeon
    S.dayKills = 0; S.dayCash = 0; S.dayShots = 0; S.dayHits = 0; S.stormReady = true; S.acidReady = true; S.acid = null;
    S.maxAlive = Math.min(6, 2 + Math.floor((S.night - 1) / 2)); // only a few in the air at once
    S.ammo = Math.max(S.ammo, 40); // the park keeper tops you up to 40 rounds a night
    S.queue = planNight(S.night);
    S.total = S.queue.reduce((n, e) => n + e.flock, 0);
    S.aggr = Math.min(6, 1.6 + S.night * 0.3);
    const what = { 1: 'pigeons', 2: 'crows join them', 3: 'gulls tonight' }[S.night] || `${S.total} of them`;
    S.banner = S.fullMoon ? { text: 'Full Moon', sub: "they're huge, it's raining, and something wears a crown", life: 3.4 } : { text: `Night ${S.night}`, sub: what, life: 2.8 };
    if (S.fullMoon) Snd.howl();
    $('shop').hidden = true;
  }

  function planNight(d) {
    const q = []; let t = 1.6, n = 0;
    const want = 8 + d * 2;
    while (n < want) {
      const r = Math.random();
      let type = 'pigeon';
      if (d >= 5 && r < 0.05 + d * 0.012) type = 'goose';
      else if (d >= 3 && r < 0.3) type = 'gull';
      else if (d >= 2 && r < 0.5) type = 'crow';
      const flock = type === 'pigeon' && d >= 4 && Math.random() < 0.25 ? randi(2, 3) : 1;
      q.push({ t, type, flock }); n += flock;
      t += Math.max(0.45, 2.1 - d * 0.12) * rand(0.6, 1.4) * (flock > 1 ? 1.8 : 1);
    }
    if (d >= 2 && Math.random() < 0.4) q.push({ t: rand(3, t), type: 'golden', flock: 1 });
    if (d % 3 === 0) q.push({ t: t * 0.45, type: 'mega', flock: 1 }); // halfway through a full moon, the king arrives
    return q.sort((a, b) => a.t - b.t);
  }

  function spawn(e) {
    const side = Math.random() < 0.5 ? 1 : -1, y0 = skyY();
    for (let i = 0; i < e.flock; i++) {
      const T = BIRDS[e.type], d = S.night, big = S.fullMoon && e.type !== 'golden', hp = T.hp * (big && e.type !== 'mega' ? 1.5 : 1) * (e.type === 'golden' ? 1 : 1 + 0.05 * Math.max(0, d - 3)), y = clamp(y0 + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 30, H * 0.05, ceiling());
      S.birds.push({
        type: e.type, x: (side > 0 ? -40 : W + 40) - side * i * 52, y, baseY: y, ty: y, vy: 0, re: rand(0.3, 1),
        vx: side * rand(...T.speed) * (1 + Math.min(0.4, d * 0.02)), hp, maxHp: hp, loads: randi(...T.loads),
        inside: false, refill: 0, dove: false, big,
        r: T.size * (big && e.type !== 'mega' ? 1.35 : 1), flap: rand(0, TAU), bob: rand(0, TAU), age: 0, hit: 0, cool: rand(0.3, 1),
      });
    }
    if (e.type === 'golden') pop(W / 2, H * 0.18, 'a golden pigeon. $120', '#d9b25a', 2.4);
    if (e.type === 'mega') { pop(W / 2, H * 0.18, 'THE MEGA PIGEON', '#ff3b3b', 2.6); S.shake = 0.5; Snd.howl(); }
  }

  // ---------------------------------------------------------------------------
  // Shooting
  // ---------------------------------------------------------------------------
  // the gun is held in both hands in front of the chest and swings through the whole upper half-circle.
  // grip() is where the back hand holds it, a little to the side so the barrel clears the head when aiming straight up
  const chest = () => ({ x: G.SX, y: G.top - 1.75 * G.U });
  function grip() {
    const C = chest(), a = S.aim, off = 0.32 * G.U, s = S.side;
    return { x: C.x - s * Math.sin(a) * off, y: C.y + s * Math.cos(a) * off };
  }
  const GS = 1.5; // held guns are drawn this much bigger than the statue's proportions, so you can read them
  function muzzle() {
    const P = grip(), L = (GUNS[S.gun].len * GS - S.recoil * 0.12) * G.U;
    return { x: P.x + Math.cos(S.aim) * L, y: P.y + Math.sin(S.aim) * L };
  }
  function aimAt(x, y) {
    S.mx = x; S.my = y;
    const C = chest();
    let a = Math.atan2(y - C.y, x - C.x);
    if (a > 0.08 && a <= Math.PI / 2) a = 0.08; else if (a > Math.PI / 2 && a < Math.PI - 0.08) a = Math.PI - 0.08;
    S.aim = a;
    if (Math.cos(a) > 0.25) S.side = 1; else if (Math.cos(a) < -0.25) S.side = -1; // swap shoulders only well past vertical
  }

  const hasAmmo = () => S.ammo >= GUNS[S.gun].use - 1e-9;
  function fire(charged = false) { // the laser is driven from update(), and the tesla only fires once it has charged
    const g = GUNS[S.gun];
    if (S.phase !== 'play' || S.cool > 0 || g.beam || (g.charge && !charged)) return;
    const st = S.guns[S.gun], k = stats(S.gun);
    if (!hasAmmo()) { Snd.empty(); S.cool = 0.25; S.dry = 1.2; return; }
    S.ammo = Math.max(0, S.ammo - g.use); S.cool = k.delay; S.recoil = 1; S.flash = 0.06; S.shots++; S.dayShots++;
    const M = muzzle(), O = grip(); // shots are traced from the hands, so birds right overhead can't slip past the barrel
    if (g.rocket) {
      S.rockets.push({ x: O.x, y: O.y, a: S.aim, v: 160, dmg: k.dmg, R: 120 + 15 * st.lvl, life: 4 }); // leaves slow, then the motor kicks in
      Snd.rocket();
    } else {
      let hit = false;
      if (g.chain) { hit = ray(O.x, O.y, M, S.aim + rand(-1, 1) * g.spread, k.dmg, 'big'); if (hit) { sparkBurst(hit.x, hit.y, 16); chain(hit, k.dmg, g.chain + st.lvl); } }
      else for (let i = 0; i < g.pellets; i++) hit = bullet(O, M, S.aim + rand(-1, 1) * g.spread, k.dmg) || hit;
      if (hit) { S.hits++; S.dayHits++; }
      Snd[g.id]();
    }
    for (let i = 0; i < 6; i++) { const a = S.aim + rand(-0.5, 0.5), v = rand(80, 260); S.parts.push({ x: M.x, y: M.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.2, max: 0.2, col: '#ffb050', s: 3 }); }
  }
  function ray(ox, oy, M, a, dmg, zap = false) { // traced from (ox, oy); the tracer (or a lightning arc) is drawn from the muzzle M. returns the bird hit
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = null, bt = 3000;
    for (const b of S.birds) {
      if (b.dead) continue;
      const px = b.x - ox, py = b.y - oy, t = px * dx + py * dy;
      if (t <= 0 || t >= bt) continue;
      const ex = px - dx * t, ey = py - dy * t;
      if (ex * ex + ey * ey < (b.r * 0.9) ** 2) { best = b; bt = t; }
    }
    const x1 = ox + dx * bt, y1 = oy + dy * bt, past = (x1 - M.x) * dx + (y1 - M.y) * dy > 0;
    if (zap) S.arcs.push({ x0: past ? M.x : ox, y0: past ? M.y : oy, x1, y1, life: zap === 'big' ? 0.3 : 0.16, max: zap === 'big' ? 0.3 : 0.16, big: zap === 'big' });
    else S.tracers.push({ x0: past ? M.x : ox, y0: past ? M.y : oy, x1, y1, life: 0.07, max: 0.07 });
    if (best) damage(best, dmg);
    return best;
  }
  function chain(from, dmg, jumps, reach = 340, big = true) { // the tesla's arc leaps a long way to the nearest unhit bird, barely weakening
    const seen = new Set([from]);
    for (let j = 0; j < jumps; j++) {
      dmg *= 0.85;
      let next = null, nd = reach;
      for (const b of S.birds) if (!b.dead && !seen.has(b)) { const d = Math.hypot(b.x - from.x, b.y - from.y); if (d < nd) { nd = d; next = b; } }
      if (!next) break;
      S.arcs.push({ x0: from.x, y0: from.y, x1: next.x, y1: next.y, life: big ? 0.3 : 0.18, max: big ? 0.3 : 0.18, big });
      seen.add(next); next.stun = Math.max(next.stun || 0, 0.6); damage(next, dmg); sparkBurst(next.x, next.y, 10); from = next;
    }
  }
  function sparkBurst(x, y, n) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), v = rand(60, 260); S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.15, 0.35), max: 0.35, col: pick(['#bfe8ff', '#ffffff', '#7fd0ff']), s: 3, rise: true }); } }

  // one bullet of the loaded type. returns the bird it hit
  function bullet(O, M, a, dmg) {
    const A = S.ammoType, col = AMMO.find((x) => x.id === A).col;
    if (A === 'chloro') { // homing: if a bird is close to the line of fire, the shot bends into it
      let best = null, bd = 0.3;
      for (const b of S.birds) {
        if (b.dead || Math.hypot(b.x - O.x, b.y - O.y) > 750) continue;
        const ba = Math.atan2(b.y - O.y, b.x - O.x), d = Math.abs(Math.atan2(Math.sin(ba - a), Math.cos(ba - a)));
        if (d < bd) { bd = d; best = b; }
      }
      if (best) {
        const L = Math.hypot(best.x - M.x, best.y - M.y);
        S.tracers.push({ x0: M.x, y0: M.y, cx: M.x + Math.cos(a) * L * 0.6, cy: M.y + Math.sin(a) * L * 0.6, x1: best.x, y1: best.y, life: 0.14, max: 0.14, col });
        damage(best, dmg); return best;
      }
    }
    let ox = O.x, oy = O.y, ang = a, left = 2600, bounces = A === 'meteor' ? 2 : 0, first = true;
    for (;;) {
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const tx = dx > 0 ? (W - ox) / dx : dx < 0 ? -ox / dx : Infinity, ty = dy > 0 ? (G.GY - oy) / dy : dy < 0 ? -oy / dy : Infinity;
      const edge = Math.min(tx, ty, left);
      let best = null, bt = edge;
      for (const b of S.birds) {
        if (b.dead) continue;
        const px = b.x - ox, py = b.y - oy, t = px * dx + py * dy;
        if (t <= 2 || t >= bt) continue;
        if ((px - dx * t) ** 2 + (py - dy * t) ** 2 < (b.r * 0.9) ** 2) { best = b; bt = t; }
      }
      const x1 = ox + dx * bt, y1 = oy + dy * bt, past = first && (x1 - M.x) * dx + (y1 - M.y) * dy > 0;
      S.tracers.push({ x0: past ? M.x : ox, y0: past ? M.y : oy, x1, y1, life: 0.08, max: 0.08, col });
      if (best) { damage(best, dmg); onHit(best, x1, y1, dmg); return best; }
      if (bounces-- <= 0 || bt >= left) return null;
      left -= bt; first = false; ox = x1; oy = y1; ang = bt === tx ? Math.PI - ang : -ang; // bounce off the edge
      sparkBurst(x1, y1, 4);
    }
  }
  function onHit(b, x, y, dmg) {
    const A = S.ammoType;
    if (A === 'crystal') for (let k = 0; k < 4; k++) shard(x, y, rand(0, TAU), b, dmg * 0.4);
    else if (A === 'cursed') ignite(b, 3, Math.max(1, dmg * 0.6), 'cursed');
    else if (A === 'exploding') explode(x, y, 55, dmg * 0.7, 'small');
    else if (A === 'golden') b.gold = true;
  }
  function shard(x, y, a, skip, dmg) { // a crystal splinter: a short, weak ray that ignores the bird it came out of
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = null, bt = 200;
    for (const b of S.birds) {
      if (b.dead || b === skip) continue;
      const px = b.x - x, py = b.y - y, t = px * dx + py * dy;
      if (t > 0 && t < bt && (px - dx * t) ** 2 + (py - dy * t) ** 2 < (b.r * 0.9) ** 2) { best = b; bt = t; }
    }
    S.tracers.push({ x0: x, y0: y, x1: x + dx * bt, y1: y + dy * bt, life: 0.12, max: 0.12, col: '#e08aff' });
    if (best) damage(best, dmg);
  }
  function ignite(b, t, dps, kind) { b.burn = Math.max(b.burn || 0, t); b.burnDps = Math.max(b.burn > 0 && b.burnDps ? b.burnDps : 0, dps); b.fire = kind; }

  // ---------------------------------------------------------------------------
  // Lightning strike: once a night. the sky goes white and a bolt finds every bird
  // ---------------------------------------------------------------------------
  const STORM = { dmg: 9, stun: 4 }; // kills pigeons, crows, gulls and golden ones outright; anything tougher is paralysed
  function boltPath(x0, y0, x1, y1, rough) {
    const n = Math.max(6, Math.round(Math.hypot(x1 - x0, y1 - y0) / 26)), pts = [[x0, y0]];
    for (let i = 1; i < n; i++) { const t = i / n; pts.push([lerp(x0, x1, t) + rand(-1, 1) * rough * (1 - t * 0.6), lerp(y0, y1, t) + rand(-6, 6)]); }
    pts.push([x1, y1]);
    return pts;
  }
  function bolt(x0, y0, x1, y1) {
    const main = boltPath(x0, y0, x1, y1, 38), forks = [];
    for (let k = 0; k < 3; k++) { const p = main[randi(2, main.length - 3)], a = Math.atan2(y1 - y0, x1 - x0) + rand(-1.1, 1.1), L = rand(40, 120); forks.push(boltPath(p[0], p[1], p[0] + Math.cos(a) * L, p[1] + Math.sin(a) * L, 16)); }
    return { main, forks, life: 0.9 };
  }
  function lightning() {
    if (S.phase !== 'play' || !S.stormReady) return;
    S.stormReady = false; S.storm = { t: 0, struck: false }; S.bolts = [];
    const targets = S.birds.filter((b) => !b.dead);
    for (const b of targets) S.bolts.push(bolt(b.x + rand(-140, 140), -20, b.x, b.y));
    for (let i = 0; i < (targets.length ? 2 : 5); i++) { const x = rand(W * 0.05, W * 0.95); S.bolts.push(bolt(x + rand(-90, 90), -20, x, G.GY + rand(0, 16))); }
    S.shake = 1; Snd.thunder();
  }
  const ACID = { price: 2000, time: 9, dps: 2, slow: 0.65 };
  function acidRain() {
    if (S.phase !== 'play' || !S.acidOwned || !S.acidReady) return;
    S.acidReady = false; S.acid = { t: ACID.time }; Snd.acid();
    pop(W / 2, H * 0.22, 'ACID RAIN', '#7dff5a', 1.8);
  }
  function stormFlash() { // white, a breath of dark, white again, then fading
    if (!S.storm) return 0;
    const t = S.storm.t;
    return t < 0.07 ? 1 : t < 0.15 ? 0.15 : t < 0.24 ? 0.85 : Math.max(0, 0.55 - (t - 0.24) * 0.9);
  }
  function switchGun(i) {
    if (i === S.gun || !S.guns[i] || !S.guns[i].owned) return;
    S.gun = i; S.cool = 0.2; S.chargeT = 0; Snd.click();
  }

  function damage(b, dmg, quiet = false) { // quiet: the laser ticks every frame, so no thud and fewer feathers
    if (b.dead) return;
    if (D.oneshot) dmg = 1e6;
    b.hp -= dmg; b.hit = 0.08;
    feathers(b, quiet ? +(Math.random() < 0.15) : 3);
    if (b.hp <= 0) kill(b); else if (!quiet) Snd.thwack();
  }

  // the eye laser works like an inferno tower: the longer it stays on target, the hotter and wider it gets
  const eyes = () => ({ x: G.SX + Math.cos(S.aim) * 0.06 * G.U, y: G.top - 2.47 * G.U });
  const LASER = { drain: 22, heatMax: 3 };
  function beamTick(dt) {
    const st = S.guns[S.gun], k = stats(S.gun), E = eyes();
    let a = Math.atan2(S.my - E.y, S.mx - E.x);
    if (a > 0.08 && a <= Math.PI / 2) a = 0.08; else if (a > Math.PI / 2 && a < Math.PI - 0.08) a = Math.PI - 0.08;
    const dx = Math.cos(a), dy = Math.sin(a);
    let best = null, bt = 3000;
    for (const b of S.birds) {
      if (b.dead) continue;
      const px = b.x - E.x, py = b.y - E.y, t = px * dx + py * dy;
      if (t <= 0 || t >= bt) continue;
      if ((px - dx * t) ** 2 + (py - dy * t) ** 2 < (b.r * 0.85) ** 2) { best = b; bt = t; }
    }
    const B = S.beam || (S.beam = { target: null, heat: 0 });
    B.target = best;
    B.heat = best ? Math.min(LASER.heatMax, B.heat + dt) : 0; // keeps its heat when it slides onto another bird; only a miss cools it
    B.x0 = E.x; B.y0 = E.y; B.x1 = E.x + dx * bt; B.y1 = E.y + dy * bt;
    if (best) { damage(best, k.dmg * (1 + 3 * B.heat ** 1.4) * dt, true); ignite(best, 2.5, k.dmg * (0.6 + 0.6 * B.heat), 'fire'); }
    S.ammo = Math.max(0, S.ammo - LASER.drain * GUNS[S.gun].use * dt);
    if (Math.random() < dt * 40) S.parts.push({ x: B.x1, y: B.y1, vx: rand(-90, 90), vy: rand(-90, 40), life: 0.2, max: 0.2, col: pick(['#ff2236', '#ff9a3c', '#ffe9a0']), s: 2 + B.heat });
    Snd.beam(B.heat);
  }
  function kill(b) {
    const T = BIRDS[b.type], cash = Math.round(T.cash * (b.gold ? 1.5 : 1) * (b.big && b.type !== 'mega' ? 1.5 : 1)); // golden bullets and full moons pay more
    b.dead = true; S.kills++; S.dayKills++;
    S.combo.n = S.clock - S.combo.t < 1.1 ? S.combo.n + 1 : 1; S.combo.t = S.clock;
    S.cash += cash; S.dayCash += cash;
    pop(b.x, b.y - b.r, `+$${cash}`, '#6ee07a');
    if (S.combo.n >= 2) {
      const bonus = 5 * S.combo.n;
      S.cash += bonus; S.dayCash += bonus;
      pop(b.x, b.y - b.r - 20, `${COMBO[S.combo.n] || 'x' + S.combo.n} +$${bonus}`, '#ff6a4a');
    }
    S.corpses.push({ type: b.type, x: b.x, y: b.y, vx: b.vx * 0.3, vy: -60, rot: 0, vr: rand(-8, 8), r: b.r, life: 2.5, landed: false });
    feathers(b, 14);
    Snd.squawk(b.type === 'goose' ? 0.5 : b.type === 'gull' ? 0.8 : 1); Snd.cash();
  }
  function feathers(b, n) {
    const T = BIRDS[b.type];
    for (let i = 0; i < n; i++) S.parts.push({ x: b.x + rand(-b.r, b.r) * 0.5, y: b.y + rand(-b.r, b.r) * 0.4, vx: rand(-120, 120), vy: rand(-140, 40), life: rand(0.6, 1.4), max: 1.4, col: pick([T.col, T.wing, '#5a5e70']), s: rand(3, 6), feather: true, rot: rand(0, TAU) });
  }
  function explode(x, y, R, dmg, kind = 'big') {
    const big = kind === 'big', max = big ? 1.2 : 0.35;
    S.blasts.push({ x, y, R, life: max, max, big });
    let hit = false;
    for (const b of S.birds) { // full damage in the inner 60%, falling to half at the edge
      if (b.dead) continue;
      const d = Math.max(0, Math.hypot(b.x - x, b.y - y) - b.r);
      if (d < R) { damage(b, dmg * (d < R * 0.6 ? 1 : 1 - 0.5 * (d - R * 0.6) / (R * 0.4)), !big); hit = true; }
    }
    if (big) {
      if (hit) { S.hits++; S.dayHits++; }
      S.shake = Math.max(S.shake, 0.7); S.boomFlash = 0.18; Snd.boom();
      for (let i = 0; i < 70; i++) { const a = rand(0, TAU), v = rand(120, 620); S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 1.1), max: 1.1, col: pick(['#ffb050', '#ff6a3a', '#ffe9a0', '#fff4d0']), s: rand(3, 8) }); }
      for (let i = 0; i < 26; i++) { const a = rand(0, TAU), v = rand(30, 160); S.parts.push({ x: x + Math.cos(a) * R * 0.3, y: y + Math.sin(a) * R * 0.3, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: rand(1, 2), max: 2, col: pick(['#6a6a70', '#8a8a90', '#4a4a50']), s: rand(10, 18), rise: true, smoke: true }); }
      for (let i = 0; i < 14; i++) { const a = rand(-Math.PI, 0), v = rand(200, 500); S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.8, 1.4), max: 1.4, col: '#2a2420', s: rand(4, 7) }); }
    } else {
      Snd.pop();
      for (let i = 0; i < 12; i++) { const a = rand(0, TAU), v = rand(60, 240); S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.2, 0.45), max: 0.45, col: pick(['#ffb050', '#ffe9a0']), s: rand(2, 4) }); }
    }
  }

  // ---------------------------------------------------------------------------
  // Poop
  // ---------------------------------------------------------------------------
  function onStatue(x, y) {
    const { U, SX, top } = G;
    if ((x - SX) ** 2 + (y - (top - 2.45 * U)) ** 2 < (0.3 * U) ** 2) return true;  // head
    if (y > top - 2.2 * U && y < top && Math.abs(x - SX) < 0.48 * U) return true;    // body
    if (y > top - 0.02 * U && y < top + 0.18 * U && Math.abs(x - SX) < 0.92 * U) return true; // plinth cap
    return false;
  }
  function drop(b) {
    const T = BIRDS[b.type];
    b.loads--; b.cool = 0.6;
    const amt = T.poop * (b.big && b.type !== 'mega' ? 1.6 : 1);
    S.poops.push({ x: b.x, y: b.y + b.r * 0.3, vx: b.vx * 0.6, vy: Math.max(0, b.vy), amt, r: 4 + amt * 0.45 });
    if (b.type === 'mega' && b.loads > 0 && Math.random() < 0.6) setTimeout(() => { if (!b.dead) drop(b); }, 180); // it unloads in bursts
  }
  function splatStatue(p) {
    S.cov = Math.min(S.cap, S.cov + (D.god ? 0 : p.amt));
    S.splats.push({ rx: (p.x - G.SX) / G.U, ry: (p.y - G.top) / G.U, s: (p.r * 1.7) / G.U, rot: rand(0, TAU), drip: 0, seed: randi(0, 9999) });
    S.shake = Math.max(S.shake, 0.45); Snd.splat();
    if (S.cov >= S.cap) lose();
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function flyBird(b, dt, g) {
    const T = BIRDS[b.type], dir = Math.sign(b.vx);
    if (D.freeze) { b.hit = Math.max(0, b.hit - dt); return; }
    if (b.stun > 0) { // paralysed: no flying, no pooping, just sparks
      b.stun -= dt; b.hit = Math.max(0, b.hit - dt); b.flap += dt * 30;
      b.baseY = Math.min(ceiling(), b.baseY + 14 * dt); b.y = b.baseY + rand(-2, 2);
      if (Math.random() < dt * 30) S.parts.push({ x: b.x + rand(-b.r, b.r) * 0.7, y: b.y + rand(-b.r, b.r) * 0.5, vx: rand(-70, 70), vy: rand(-70, 70), life: 0.15, max: 0.15, col: pick(['#bfe8ff', '#ffffff', '#7fd0ff']), s: 2.5 });
      return;
    }
    b.age += dt; b.flap += dt * T.flap * (b.vy < -40 ? 1.6 : 1); b.hit = Math.max(0, b.hit - dt);
    // pick a new altitude every so often, and line up a bombing run when the statue is just ahead
    if ((b.re -= dt) <= 0) { b.ty = skyY(); b.re = rand(...T.re); }
    const ahead = (G.SX - b.x) * dir;
    if (!b.dove && b.loads > 0 && ahead > 0 && ahead < 3.2 * G.U) { b.dove = true; if (Math.random() < 0.7) { b.ty = ceiling(); b.re = 1.1; } }
    b.ty = Math.min(b.ty, ceiling());
    b.vy = lerp(b.vy, clamp((b.ty - b.baseY) * T.climb, -280, 280), Math.min(1, dt * 4));
    b.baseY = clamp(b.baseY + b.vy * dt, H * 0.04, ceiling());
    b.y = b.baseY + Math.sin(b.bob + b.age * 3.2) * T.wob * 0.5;
    b.x += b.vx * (1 + T.surge * Math.sin(b.age * 2.3 + b.bob)) * (S.acid ? ACID.slow : 1) * dt;
    if (b.inside && b.x > W * 0.15 && b.x < W * 0.85 && Math.random() < dt * T.turn) { b.vx = -b.vx; b.dove = false; b.ty = skyY(); }
    if (T.poop && b.loads <= 0 && (b.refill += dt) > 3.5) { b.loads = 1; b.refill = 0; b.dove = false; } // they keep coming back for more
    if (b.loads > 0 && (b.cool -= dt) <= 0) {
      const fall = Math.sqrt(Math.max(0, (2 * (G.top - 1.6 * G.U - b.y)) / g)), land = b.x + b.vx * 0.6 * fall;
      if (Math.abs(land - G.SX) < 0.5 * G.U && Math.random() < dt * S.aggr) drop(b);
      else if (Math.random() < dt * 0.04) drop(b); // stray, lands in the park
    }
    if (Math.random() < dt * 24) { // the eyes leave a red smear
      const s = b.r;
      S.parts.push({ x: b.x + dir * s * 0.8, y: b.y - s * 0.3, vx: -b.vx * 0.15, vy: rand(-6, 6), life: 0.35, max: 0.35, col: '#ff1a2a', s: 2.5 });
    }
    // they never leave: once on screen they turn back at the edges. only the golden pigeon gets bored and goes
    const m = b.r * 1.4;
    if (!b.inside && b.x > m && b.x < W - m) b.inside = true;
    if (b.type === 'golden' && b.age > 9) { if (b.x < -60 || b.x > W + 60) b.gone = true; }
    else if (b.inside && ((b.vx > 0 && b.x > W - m) || (b.vx < 0 && b.x < m))) { b.vx = -b.vx; b.ty = skyY(); b.dove = false; }
  }

  function update(dt) {
    if (D.money) S.cash = 999999;
    if (S.fullMoon && S.phase === 'play') { // the rain washes a little of it off
      S.cov = Math.max(0, S.cov - 0.35 * dt);
      for (const d of S.rain) { d.y += d.v * dt; d.x += d.v * 0.18 * dt; if (d.y > H) { d.y = rand(-40, 0); d.x = rand(-60, W); } }
    }
    if (D.storm) { S.stormReady = true; if (S.acidOwned && !S.acid) S.acidReady = true; }
    if (S.acid && S.phase === 'play') { // green rain: everything in the sky fizzes
      S.acid.t -= dt;
      for (const d of S.acidDrops) { d.y += d.v * dt; d.x -= d.v * 0.12 * dt; if (d.y > H) { d.y = rand(-40, 0); d.x = rand(0, W + 60); } }
      for (const b of S.birds) {
        if (b.dead) continue;
        damage(b, ACID.dps * dt, true);
        if (Math.random() < dt * 14) S.parts.push({ x: b.x + rand(-0.6, 0.6) * b.r, y: b.y + rand(-0.4, 0.3) * b.r, vx: rand(-20, 20), vy: rand(-60, -20), life: rand(0.25, 0.5), max: 0.5, col: pick(['#7dff5a', '#c8ff8a', '#3acf3a']), s: rand(2, 4), rise: true });
      }
      if (S.acid.t <= 0) S.acid = null;
    }
    if (D.ammo) S.ammo = Math.max(S.ammo, 9999);
    S.boomFlash = Math.max(0, (S.boomFlash || 0) - dt);
    for (const c of S.clouds) { c.x += c.v * dt; if (c.x - c.w > W) { c.x = -c.w; c.y = rand(H * 0.04, H * 0.35); } }
    for (const f of S.fog) { f.x += f.v * dt; if (f.x - f.w > W) f.x = -f.w; if (f.x + f.w < 0) f.x = W + f.w; }
    S.recoil = Math.max(0, S.recoil - dt * 8); S.flash = Math.max(0, S.flash - dt); S.dry = Math.max(0, S.dry - dt); S.shake = Math.max(0, S.shake - dt * 1.5);
    for (const s of S.splats) s.drip = Math.min(1, s.drip + dt * 0.25);
    if (S.banner && (S.banner.life -= dt) <= 0) S.banner = null;
    for (const p of S.pops) { p.y -= 40 * dt; p.life -= dt; }
    S.pops = S.pops.filter((p) => p.life > 0);

    if (S.phase === 'play') {
      S.clock += dt;
      // release the next bird only when there's room in the sky, and never two in the same breath
      S.gap = (S.gap || 0) - dt;
      const nx = S.queue[0];
      if (nx && nx.t <= S.clock && S.gap <= 0 && S.birds.length + nx.flock <= S.maxAlive) { spawn(S.queue.shift()); S.gap = rand(0.9, 1.8); }
      S.cool = Math.max(0, S.cool - dt);
      // completely dry with birds still up: the keeper tosses you a round every couple of seconds
      if (S.birds.length && S.ammo < 1 && (S.trickle += dt) > 2) { S.trickle = 0; S.ammo += 1; if (S.gun !== 0) switchGun(0); }
      const gg = GUNS[S.gun];
      if (S.trigger && gg.auto) fire();
      if (gg.charge) { // the tesla winds up while you hold the trigger, crackling at the muzzle, then lets go
        if (S.trigger && S.cool <= 0 && hasAmmo()) {
          if (S.chargeT === 0) Snd.charge();
          S.chargeT += dt;
          const M = muzzle(), f = S.chargeT / gg.charge;
          if (Math.random() < dt * 60 * f) { const a = rand(0, TAU), r = rand(6, 22) * (1 - f * 0.6); S.parts.push({ x: M.x + Math.cos(a) * r, y: M.y + Math.sin(a) * r, vx: -Math.cos(a) * 60, vy: -Math.sin(a) * 60, life: 0.15, max: 0.15, col: pick(['#bfe8ff', '#ffffff', '#7fd0ff']), s: 2 + f * 3, rise: true }); }
          if (S.chargeT >= gg.charge) { S.chargeT = 0; fire(true); }
        } else S.chargeT = 0;
      }
      if (S.trigger && !hasAmmo()) S.dry = 0.3;
      if (gg.beam && S.trigger && hasAmmo()) beamTick(dt);
      else S.beam = null;
    }

    const g = gravity();
    if (S.storm) {
      S.storm.t += dt;
      if (!S.storm.struck && S.storm.t > 0.07) { // the strike lands on the first flash
        S.storm.struck = true;
        for (const b of S.birds) { if (b.dead) continue; damage(b, STORM.dmg); if (!b.dead) b.stun = STORM.stun; }
      }
      if (S.storm.t > 1.3) S.storm = null;
    }
    for (const bo of S.bolts) bo.life -= dt;
    S.bolts = S.bolts.filter((bo) => bo.life > 0);
    for (const a of S.arcs) a.life -= dt;
    S.arcs = S.arcs.filter((a) => a.life > 0);
    if (S.phase === 'play') babies(dt);
    for (const b of S.birds) { // burning birds lose health steadily, with flames and embers coming off them
      if (!(b.burn > 0) || b.dead) continue;
      b.burn -= dt; damage(b, b.burnDps * dt, true);
      if (Math.random() < dt * 28) S.parts.push({ x: b.x + rand(-0.5, 0.5) * b.r, y: b.y - b.r * 0.5, vx: rand(-15, 15), vy: rand(-110, -50), life: rand(0.3, 0.6), max: 0.6, col: pick(b.fire === 'cursed' ? ['#a6ff3a', '#e8ff9a', '#5aff2a'] : ['#ff6a1a', '#ffb030', '#ffe080']), s: rand(2, 4), rise: true });
    }
    for (const b of S.birds) flyBird(b, dt, g);
    S.birds = S.birds.filter((b) => !b.dead && !b.gone);

    for (const p of S.poops) {
      p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (S.phase === 'play' && onStatue(p.x, p.y)) { p.dead = true; splatStatue(p); }
      else if (p.y >= G.GY + p.r) { p.dead = true; S.ground.push({ x: p.x, y: Math.min(H - 4, G.GY + rand(2, 26)), s: p.r * 1.4, life: 8 }); }
    }
    S.poops = S.poops.filter((p) => !p.dead);
    for (const s of S.ground) s.life -= dt;
    S.ground = S.ground.filter((s) => s.life > 0);

    for (const r of S.rockets) { // slow off the shoulder, then accelerating hard
      r.v = Math.min(1700, r.v * (1 + 2.6 * dt) + 260 * dt);
      r.x += Math.cos(r.a) * r.v * dt; r.y += Math.sin(r.a) * r.v * dt; r.life -= dt;
      for (let i = 0; i < 2; i++) S.parts.push({ x: r.x - Math.cos(r.a) * 8, y: r.y - Math.sin(r.a) * 8, vx: rand(-25, 25), vy: rand(-25, 25), life: rand(0.5, 0.9), max: 0.9, col: pick(['#8a8a90', '#6a6a70']), s: rand(5, 9), rise: true, smoke: true });
      S.parts.push({ x: r.x - Math.cos(r.a) * 6, y: r.y - Math.sin(r.a) * 6, vx: -Math.cos(r.a) * 120 + rand(-30, 30), vy: -Math.sin(r.a) * 120 + rand(-30, 30), life: 0.12, max: 0.12, col: pick(['#ffb050', '#ffe9a0']), s: 4 });
      const hitB = S.birds.some((b) => Math.hypot(b.x - r.x, b.y - r.y) < b.r + 6);
      if (hitB || r.y > G.GY) { r.dead = true; explode(r.x, r.y, r.R, r.dmg, r.mini ? 'small' : 'big'); }
      else if (r.life <= 0 || r.x < -100 || r.x > W + 100 || r.y < -100) r.dead = true;
    }
    S.rockets = S.rockets.filter((r) => !r.dead);

    for (const c of S.corpses) {
      if (!c.landed) { c.vy += g * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.rot += c.vr * dt; if (c.y >= G.GY + 6) { c.landed = true; c.y = G.GY + rand(4, 20); Snd.thud(); } }
      else c.life -= dt;
    }
    S.corpses = S.corpses.filter((c) => c.life > 0 && c.y < H + 80);
    for (const p of S.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; if (p.feather) { p.vx *= 1 - dt * 2; p.vy = lerp(p.vy, 40, dt * 3); p.rot += dt * 4; } else if (p.rise) { p.vx *= 1 - dt * 1.5; if (p.smoke) { p.vy -= 25 * dt; p.s += dt * 10; } } else if (p.col !== '#ff1a2a') p.vy += g * 0.2 * dt; }
    S.parts = S.parts.filter((p) => p.life > 0);
    for (const t of S.tracers) t.life -= dt;
    S.tracers = S.tracers.filter((t) => t.life > 0);
    for (const b of S.blasts) b.life -= dt;
    S.blasts = S.blasts.filter((b) => b.life > 0);

    if (S.phase === 'play' && !S.queue.length && !S.birds.length && !S.poops.length && !S.rockets.length) clearNight();
  }

  // baby statues: little turrets either side of the plinth. short range, and armed with whatever you bought them
  const BABY_GUNS = [['pistol', 'Pistol', 0], ['shotgun', 'Shotgun', 800], ['tesla', 'Tesla', 1500], ['laser', 'Laser', 2000], ['rocket', 'Rockets', 2500]];
  const babyPos = (i) => ({ x: G.SX + (i ? 1 : -1) * 2.3 * G.U, y: G.GY - 1.0 * G.U });
  const babyRange = () => 280 + 40 * S.babies.lvl, babyPow = () => 1 + 0.35 * S.babies.lvl;
  function babies(dt) {
    const B = S.babies, R = babyRange(), pw = babyPow();
    while (B.tur.length < B.n) B.tur.push({ cool: rand(0.3, 1), aim: -Math.PI / 2, heat: 0, target: null });
    B.tur.forEach((tb, i) => {
      const P = babyPos(i);
      tb.beam = null; tb.flash = Math.max(0, (tb.flash || 0) - dt);
      let best = null, bd = R;
      bd = Infinity;
      for (const b of S.birds) if (!b.dead && b.inside && Math.abs(b.x - P.x) < R) { const d = Math.hypot(b.x - P.x, b.y - P.y); if (d < bd) { bd = d; best = b; } }
      if (!best) { tb.heat = 0; tb.target = null; return; }
      const want = Math.atan2(best.y - P.y, best.x - P.x);
      tb.aim += Math.atan2(Math.sin(want - tb.aim), Math.cos(want - tb.aim)) * Math.min(1, dt * 8);
      const M = { x: P.x + Math.cos(tb.aim) * 0.55 * G.U, y: P.y + Math.sin(tb.aim) * 0.55 * G.U };
      if (B.gun === 'laser') { // a thin eye-beam that warms up like the big one
        tb.heat = tb.target === best ? Math.min(3, tb.heat + dt) : 0; tb.target = best;
        damage(best, 0.7 * pw * (1 + tb.heat) * dt, true); ignite(best, 1.2, 0.4 * pw, 'fire');
        tb.beam = { x0: P.x, y0: P.y - 0.23 * G.U, x1: best.x, y1: best.y, heat: tb.heat };
        return;
      }
      if ((tb.cool -= dt) > 0) return;
      tb.flash = 0.06;
      if (B.gun === 'shotgun') { tb.cool = 2.4; for (let k = 0; k < 4; k++) ray(P.x, P.y, M, tb.aim + rand(-0.15, 0.15), 0.6 * pw); Snd.baby(); }
      else if (B.gun === 'tesla') { tb.cool = 2.6; const h = ray(P.x, P.y, M, tb.aim, 1.4 * pw, true); if (h) chain(h, 1.4 * pw, 2, 170, false); Snd.zap(); }
      else if (B.gun === 'rocket') { tb.cool = 4; S.rockets.push({ x: M.x, y: M.y, a: tb.aim, v: 220, dmg: 5 * pw, R: 60, life: 3, mini: true }); Snd.rocket(); }
      else { tb.cool = 2 - 0.25 * B.lvl; ray(P.x, P.y, M, tb.aim + rand(-0.05, 0.05), pw); Snd.baby(); }
    });
  }

  function pop(x, y, text, col, life = 1.1) { S.pops.push({ x, y, text, col, life }); }

  // ---------------------------------------------------------------------------
  // Nights, shop, game over
  // ---------------------------------------------------------------------------
  function clearNight() {
    S.phase = 'clear'; S.trigger = false;
    const acc = S.dayShots ? S.dayHits / S.dayShots : 0;
    S.bonus = 60 + S.night * 25 + Math.round(acc * 40); // grows by the same step every night
    S.lastAcc = acc;
    S.cash += S.bonus;
    if (S.night > BEST) { BEST = S.night; try { localStorage.setItem('statue.best', String(BEST)); } catch (e) { /* storage blocked */ } }
    S.banner = { text: 'Dawn', sub: `night ${S.night} survived`, life: 1.8 };
    Snd.fanfare();
    setTimeout(openShop, 1700);
  }

  const capCost = () => 120 + S.capLvl * 80;
  const babyCost = () => 600 * (S.babies.n + 1), babyUp = () => 900 * (S.babies.lvl + 1);
  const cleanRate = () => 2 + S.night * 0.25;
  function openShop() { if (S.phase !== 'clear' && S.phase !== 'shop') return; S.phase = 'shop'; renderShop(); $('shop').hidden = false; }
  function renderShop() {
    const money = (v) => `$${Math.ceil(v)}`;
    const dis = (cost) => (S.cash < cost ? 'disabled' : '');
    const lv = (n, max) => `<span class="lv">Lv ${n}/${max}</span>`;
    const guns = GUNS.map((g, i) => {
      const st = S.guns[i], up = g.ups[st.lvl];
      const act = !st.owned ? `<button class="btn" data-act="buy" data-i="${i}" ${dis(g.price)}>Buy <em>${money(g.price)}</em></button>`
        : up ? `<button class="btn" data-act="up" data-i="${i}" ${dis(up)}>Upgrade <em>${money(up)}</em></button>` : '<button class="btn" disabled>Maxed</button>';
      return `<div class="tile${st.owned ? '' : ' locked'}"><div class="top"><b>${g.name}</b><kbd>${i + 1}</kbd></div>
        <svg viewBox="0 0 120 32" fill="currentColor">${g.icon}</svg>
        <div class="meta">${st.owned ? lv(st.lvl, g.ups.length) : ''}<small>${g.useLabel}</small></div>${act}</div>`;
    }).join('');
    const ammo = `<div class="tile"><div class="top"><b>Rounds</b></div><div class="big">${Math.floor(S.ammo)}</div>
        ${AMMO_PACKS.map(([n, c]) => `<button class="btn" data-act="pack" data-n="${n}" data-c="${c}" ${dis(c)}>+${n} <em>${money(c)}</em></button>`).join('')}</div>`
      + AMMO.map((a) => `<div class="tile ammo${S.ammoOwned[a.id] ? '' : ' locked'}"><div class="top"><b>${a.name}</b><i style="--c:${a.col}"></i></div>
        <div class="meta"><small>${a.tag}</small></div>
        ${!S.ammoOwned[a.id] ? `<button class="btn" data-act="ammotype" data-a="${a.id}" ${dis(a.price)}>Buy <em>${money(a.price)}</em></button>`
          : S.ammoType === a.id ? '<button class="btn on" disabled>Loaded</button>' : `<button class="btn" data-act="ammotype" data-a="${a.id}">Load</button>`}</div>`).join('');
    const B = S.babies, bi = BABY_GUNS.findIndex((x) => x[0] === B.gun), nx = BABY_GUNS[(bi + 1) % BABY_GUNS.length];
    const clean = Math.ceil(S.cov * cleanRate());
    const defense = `<div class="tile"><div class="top"><b>Max HP</b></div><div class="big">${S.cap}</div>
          <button class="btn" data-act="cap" ${dis(capCost())}>+20 <em>${money(capCost())}</em></button></div>
        <div class="tile"><div class="top"><b>Clean</b></div><div class="big">${Math.round(S.cov)}<small>/${S.cap}</small></div>
          <button class="btn" data-act="clean" ${S.cov < 0.5 || S.cash < cleanRate() ? 'disabled' : ''}>Clean <em>${money(clean)}</em></button></div>
        <div class="tile"><div class="top"><b>Baby Statue</b></div><div class="meta"><span class="lv">${B.n}/2</span>${B.n ? lv(B.lvl, 3) : ''}</div>
          ${B.n < 2 ? `<button class="btn" data-act="baby" ${dis(babyCost())}>Buy <em>${money(babyCost())}</em></button>` : ''}
          ${B.n && B.lvl < 3 ? `<button class="btn" data-act="babyup" ${dis(babyUp())}>Upgrade <em>${money(babyUp())}</em></button>` : ''}</div>
        <div class="tile${B.n ? '' : ' locked'}"><div class="top"><b>Baby Arms</b></div><div class="meta"><span class="lv">${BABY_GUNS[bi][1]}</span></div>
          ${B.n ? `<button class="btn" data-act="babygun" data-g="${nx[0]}" ${B.guns[nx[0]] ? '' : dis(nx[2])}>${nx[1]} ${B.guns[nx[0]] ? '' : `<em>${money(nx[2])}</em>`}</button>` : '<button class="btn" disabled>Buy a baby first</button>'}</div>`;
    const abilities = `<div class="tile"><div class="top"><b>Lightning</b><kbd>Q</kbd></div><div class="meta"><small>Instant</small></div><button class="btn on" disabled>Owned</button></div>
        <div class="tile acid${S.acidOwned ? '' : ' locked'}"><div class="top"><b>Acid Rain</b><kbd>W</kbd></div><div class="meta"><small>${ACID.time}s of burning rain</small></div>
          ${S.acidOwned ? '<button class="btn on" disabled>Owned</button>' : `<button class="btn" data-act="acid" ${dis(ACID.price)}>Buy <em>${money(ACID.price)}</em></button>`}</div>`;
    $('shop').innerHTML = `<div class="wrap">
      <header><div class="purse"><span>Money</span><b>$${S.cash}</b></div><button class="go" data-act="go">Next night →</button></header>
      <h3>Guns</h3><div class="row guns">${guns}</div>
      <h3>Ammo</h3><div class="row ammo">${ammo}</div>
      <div class="split"><div><h3>Defense</h3><div class="row def">${defense}</div></div><div><h3>Abilities</h3><div class="row abil">${abilities}</div></div></div>
    </div>`;
    for (const b of $('shop').querySelectorAll('.btn:not(:disabled)')) if (b.querySelector('em')) b.classList.add('can'); // priced and affordable
  }
  $('shop').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    const i = +b.dataset.i, g = GUNS[i], st = S.guns[i];
    switch (b.dataset.act) {
      case 'buy': if (S.cash >= g.price) { S.cash -= g.price; st.owned = true; Snd.cash(); } break;
      case 'pack': { const n = +b.dataset.n, c = +b.dataset.c; if (S.cash >= c) { S.cash -= c; S.ammo += n; Snd.click(); } break; }
      case 'ammotype': {
        const a = AMMO.find((x) => x.id === b.dataset.a);
        if (!S.ammoOwned[a.id]) { if (S.cash < a.price) break; S.cash -= a.price; S.ammoOwned[a.id] = true; Snd.cash(); }
        S.ammoType = a.id; break;
      }
      case 'up': if (S.cash >= g.ups[st.lvl]) { S.cash -= g.ups[st.lvl]; st.lvl++; Snd.cash(); } break;
      case 'cap': if (S.cash >= capCost()) { S.cash -= capCost(); S.cap += 20; S.capLvl++; Snd.cash(); } break;
      case 'baby': if (S.babies.n < 2 && S.cash >= babyCost()) { S.cash -= babyCost(); S.babies.n++; Snd.cash(); } break;
      case 'babygun': {
        const [id, , price] = BABY_GUNS.find((x) => x[0] === b.dataset.g);
        if (!S.babies.guns[id]) { if (S.cash < price) break; S.cash -= price; S.babies.guns[id] = true; Snd.cash(); }
        S.babies.gun = id; break;
      }
      case 'babyup': if (S.babies.lvl < 3 && S.cash >= babyUp()) { S.cash -= babyUp(); S.babies.lvl++; Snd.cash(); } break;
      case 'clean': { // scrub off as much as you can pay for
        const before = S.cov, off = Math.min(S.cov, Math.floor(S.cash / cleanRate()));
        S.cash -= Math.ceil(off * cleanRate()); S.cov = Math.max(0, S.cov - off);
        S.splats = S.splats.slice(0, Math.round(S.splats.length * (before ? S.cov / before : 0)));
        Snd.scrub(); break;
      }
      case 'acid': if (!S.acidOwned && S.cash >= ACID.price) { S.cash -= ACID.price; S.acidOwned = true; Snd.cash(); } break;
      case 'go': startNight(); return;
    }
    const y = $('shop').scrollTop; renderShop(); $('shop').scrollTop = y;
  });

  function lose() {
    S.phase = 'lost'; S.trigger = false; Snd.bury();
    setTimeout(() => screen('Buried in poop', `Night ${S.night}. ${S.kills} birds shot. The pigeons have finally won: the statue is under a mound of droppings, and the council has sent a man with a pressure washer and a sign that says “closed for cleaning”.${BEST ? ` Best: night ${BEST}.` : ''}`, 'click to rise again', true), 1400);
  }

  // pause menu: resume, replay this night from its start, or quit to the title
  function pause(on) {
    if (on && S.phase !== 'play') return;
    S.paused = on; S.trigger = false; Snd.beamOff();
    $('pause').hidden = !on;
  }
  function replayNight() {
    const o = JSON.parse(S.snap);
    Object.assign(S, o, { babies: { gun: 'pistol', guns: { pistol: true }, ...o.babies, tur: [] }, birds: [], poops: [], rockets: [], corpses: [], parts: [], tracers: [], arcs: [], bolts: [], blasts: [], ground: [], pops: [], storm: null, beam: null, cool: 0 });
    if (!S.guns[S.gun].owned) S.gun = 0;
    pause(false); startNight();
  }
  $('pause').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.p === 'resume') pause(false);
    else if (b.dataset.p === 'replay') replayNight();
    else if (b.dataset.p === 'quit') { pause(false); newGame(); S.phase = 'intro'; title(); }
  });
  $('pauseBtn').addEventListener('click', () => pause(!S.paused));

  // debug menu, on the right. backtick toggles it
  const DEBUG_TOGGLES = [['ammo', 'Infinite ammo'], ['god', 'Infinite HP'], ['money', 'Infinite money'], ['oneshot', 'One-shot everything'], ['storm', 'Unlimited lightning'], ['freeze', 'Freeze birds'], ['slow', 'Slow motion']];
  const DEBUG_ACTIONS = [['skip', 'Skip night'], ['jump', 'Jump +5 nights'], ['guns', 'All guns, max level'], ['babies', 'Baby statues, max'], ['bolt', 'Recharge lightning'], ['acid', 'Acid rain now'],
    ['pigeon', 'Spawn pigeon'], ['goose', 'Spawn goose'], ['flock', 'Spawn flock'], ['golden', 'Spawn golden'], ['killall', 'Kill all birds'], ['poop', 'Poop +25'], ['clean', 'Clean statue']];
  $('debug').innerHTML = `<h4>Debug</h4>${DEBUG_TOGGLES.map(([k, l]) => `<label><input type="checkbox" data-d="${k}"> ${l}</label>`).join('')}
    <div class="dbtns">${DEBUG_ACTIONS.map(([k, l]) => `<button class="btn" data-a="${k}">${l}</button>`).join('')}</div>`;
  $('debug').addEventListener('change', (e) => { const k = e.target.dataset.d; if (k) D[k] = e.target.checked; });
  $('debug').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const play = S.phase === 'play';
    switch (b.dataset.a) {
      case 'skip':
        if (S.phase === 'shop') startNight();
        else if (play) { S.queue.length = 0; for (const bd of S.birds) if (!bd.dead) kill(bd); S.poops.length = 0; S.rockets.length = 0; }
        break;
      case 'jump': S.night += 5; pop(W / 2, H * 0.45, `next night: ${S.night + 1}`, '#9fd4ff', 1.6); break;
      case 'guns': S.guns.forEach((st, i) => { st.owned = true; st.lvl = GUNS[i].ups.length; }); S.ammo = Math.max(S.ammo, 999); AMMO.forEach((a) => { S.ammoOwned[a.id] = true; }); break;
      case 'babies': S.babies.n = 2; S.babies.lvl = 3; break;
      case 'bolt': S.stormReady = true; break;
      case 'acid': S.acidOwned = true; S.acidReady = true; acidRain(); break;
      case 'pigeon': case 'goose': case 'golden': if (play) spawn({ type: b.dataset.a, flock: 1 }); break;
      case 'flock': if (play) spawn({ type: 'pigeon', flock: 4 }); break;
      case 'killall': for (const bd of S.birds) if (!bd.dead) kill(bd); break;
      case 'poop': S.cov = Math.min(S.cap - 1, S.cov + 25); break;
      case 'clean': S.cov = 0; S.splats = []; break;
    }
    if (S.phase === 'shop') renderShop();
  });
  const showDebug = (on) => { $('debug').hidden = !on; $('debugToggle').classList.toggle('on', on); };
  $('debugToggle').addEventListener('click', () => showDebug($('debug').hidden));

  const gate = $('gate');
  function screen(title, body, sub, red = false) {
    $('gateTitle').textContent = title; $('gateTitle').classList.toggle('red', red);
    $('gateText').textContent = body; $('gateSub').textContent = sub;
    gate.hidden = false;
  }

  // ---------------------------------------------------------------------------
  // Drawing the source (what HAUNT sees)
  // ---------------------------------------------------------------------------
  function glowDot(c, x, y, r, col, a = 0.35) {
    c.fillStyle = col; c.globalAlpha = a; c.beginPath(); c.arc(x, y, r * 2.4, 0, TAU); c.fill();
    c.globalAlpha = 1; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }
  const LAMPS = [0.2, 0.8];
  const TOWER = 0.84; // the clock tower's x, as a fraction of the width
  function branch(c, x, y, len, a, w, depth, seed) { // a bare tree, recursively
    const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
    c.lineWidth = w; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + Math.cos(a + 0.3) * len * 0.5, y + Math.sin(a + 0.3) * len * 0.5, x2, y2); c.stroke();
    if (depth <= 0) return;
    const n = depth > 3 ? 2 : 2 + (hash(seed, depth, 1) < 0.4 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const da = (k - (n - 1) / 2) * (0.45 + hash(seed, k, depth) * 0.35) + (hash(seed, k, 9) - 0.5) * 0.3;
      branch(c, x2, y2, len * (0.66 + hash(seed, k, depth + 3) * 0.16), a + da, Math.max(1, w * 0.68), depth - 1, seed * 7 + k + 1);
    }
  }
  // everything that never moves: sky, moon, skyline, trees, fence, path, bench. redrawn on resize only
  function drawBackdrop() {
    bgc.width = src.width; bgc.height = src.height;
    const c = bx, k = src.width / W, { GY, SX, U } = G;
    c.setTransform(k, 0, 0, k, 0, 0);
    const sky = c.createLinearGradient(0, 0, 0, GY);
    sky.addColorStop(0, '#020205'); sky.addColorStop(0.55, '#06060c'); sky.addColorStop(0.85, '#140c14'); sky.addColorStop(1, '#2a1218');
    c.fillStyle = sky; c.fillRect(0, 0, W, GY);
    for (let i = 0; i < 110; i++) { c.fillStyle = `rgba(220,215,230,${0.25 + hash(i, 5, 7) * 0.5})`; c.fillRect(hash(i, 1, 7) * W, hash(i, 2, 7) * GY * 0.55, 1.5, 1.5); }
    // far skyline, then near skyline with roof furniture
    const skyline = (seed, base, hMin, hMax, col, winP) => {
      let x = -20, i = 0;
      while (x < W) {
        const bw = 30 + hash(i, 3, seed) * 70, bh = H * (hMin + hash(i, 4, seed) * (hMax - hMin)), by = base - bh, kind = hash(i, 8, seed);
        c.fillStyle = col; c.fillRect(x, by, bw, bh);
        if (kind < 0.18) { c.beginPath(); c.moveTo(x, by); c.lineTo(x + bw / 2, by - bw * 0.5); c.lineTo(x + bw, by); c.fill(); } // gable
        else if (kind < 0.3) { c.fillRect(x + bw * 0.3, by - 14, bw * 0.4, 14); c.fillRect(x + bw * 0.45, by - 30, 3, 16); } // stair head + mast
        else if (kind < 0.42) { // water tower
          const tx = x + bw * 0.55; c.fillRect(tx - 1, by - 10, 2, 10); c.fillRect(tx + 13, by - 10, 2, 10); c.fillRect(tx - 3, by - 26, 20, 16);
          c.beginPath(); c.moveTo(tx - 4, by - 26); c.lineTo(tx + 7, by - 34); c.lineTo(tx + 18, by - 26); c.fill();
        } else if (kind < 0.55) { c.fillRect(x + bw * 0.2, by - 12, 6, 12); c.fillRect(x + bw * 0.7, by - 9, 5, 9); } // chimneys
        for (let wy = by + 8; wy < base - 16; wy += 11) for (let wx = x + 5; wx < x + bw - 7; wx += 9) {
          const hh = hash(Math.round(wx), Math.round(wy), seed);
          if (hh < winP) { c.fillStyle = hh < winP * 0.75 ? '#c8904a' : '#5a7a98'; c.fillRect(wx, wy, 3, 4); }
        }
        x += bw + 2 + hash(i, 6, seed) * 6; i++;
      }
    };
    skyline(11, GY - H * 0.06, 0.16, 0.34, '#0c0d14', 0.05);
    // the clock tower
    const tx = W * TOWER, tw = Math.max(46, U * 0.9), tb = GY - H * 0.02, tt = tb - H * 0.46;
    c.fillStyle = '#17171f'; c.fillRect(tx - tw / 2, tt, tw, tb - tt);
    c.beginPath(); c.moveTo(tx - tw * 0.6, tt); c.lineTo(tx, tt - tw * 1.4); c.lineTo(tx + tw * 0.6, tt); c.fill();
    c.fillRect(tx - 1.5, tt - tw * 1.4 - 16, 3, 16);
    for (let i = 0; i < 3; i++) { c.fillStyle = '#0c0c14'; c.beginPath(); c.moveTo(tx - tw * 0.3 + i * tw * 0.3 - 4, tt + tw * 1.4); c.lineTo(tx - tw * 0.3 + i * tw * 0.3 - 4, tt + tw * 1.1); c.arc(tx - tw * 0.3 + i * tw * 0.3, tt + tw * 1.1, 4, Math.PI, 0); c.lineTo(tx - tw * 0.3 + i * tw * 0.3 + 4, tt + tw * 1.4); c.fill(); }
    const cr = tw * 0.32, cy = tt + tw * 0.5;
    c.fillStyle = '#b8a878'; c.beginPath(); c.arc(tx, cy, cr, 0, TAU); c.fill();
    c.strokeStyle = '#2a2418'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(tx, cy); c.lineTo(tx + cr * 0.05, cy - cr * 0.8); c.moveTo(tx, cy); c.lineTo(tx + cr * 0.5, cy + cr * 0.25); c.stroke();
    skyline(23, GY, 0.07, 0.2, '#111219', 0.09);
    // bare trees either side
    c.strokeStyle = '#2e2a28'; c.lineCap = 'round';
    for (const [fx, sz, seed] of [[0.06, 1.25, 3], [0.27, 0.9, 7], [0.37, 0.7, 11], [0.63, 0.75, 13], [0.72, 1, 17], [0.95, 1.15, 19]]) {
      const x = W * fx; if (Math.abs(x - SX) < 1.5 * U) continue;
      branch(c, x, GY + 4, H * 0.1 * sz, -Math.PI / 2 + (hash(seed, 1, 1) - 0.5) * 0.2, 9 * sz, 6, seed);
    }
    c.lineCap = 'butt';
    // iron fence along the back of the lawn
    const fy = GY - 2, fh = Math.max(18, U * 0.35);
    c.fillStyle = '#26262c';
    c.fillRect(0, fy - fh, W, 2.5); c.fillRect(0, fy - fh * 0.3, W, 2.5);
    for (let x = 4; x < W; x += 11) {
      c.fillRect(x, fy - fh - 4, 2.5, fh + 4);
      c.beginPath(); c.moveTo(x - 2, fy - fh - 4); c.lineTo(x + 1.25, fy - fh - 11); c.lineTo(x + 4.5, fy - fh - 4); c.fill();
    }
    for (let x = 40; x < W; x += 120) { c.fillRect(x - 3, fy - fh - 8, 8, fh + 8); c.beginPath(); c.arc(x + 1, fy - fh - 11, 5, 0, TAU); c.fill(); }
    // lawn, cobbles, the plinth's path
    c.fillStyle = '#0d120c'; c.fillRect(0, GY, W, H - GY);
    c.fillStyle = '#1e2a18'; c.fillRect(0, GY, W, 3);
    for (let i = 0; i < 260; i++) { const x = hash(i, 1, 31) * W, y = GY + 4 + hash(i, 2, 31) * (H - GY); c.fillStyle = hash(i, 3, 31) < 0.5 ? '#1a2414' : '#141c10'; c.fillRect(x, y, 3, 2); }
    const pw0 = 1.05 * U, pw1 = 2.6 * U;
    c.fillStyle = '#0a0a08'; c.beginPath(); c.moveTo(SX - pw0, GY); c.lineTo(SX + pw0, GY); c.lineTo(SX + pw1, H); c.lineTo(SX - pw1, H); c.fill();
    for (let row = 0, y = GY + 2; y < H; row++) {
      const f = (y - GY) / (H - GY), hw = lerp(pw0, pw1, f), sh = 5 + f * 10, sw = 12 + f * 22;
      for (let x = SX - hw + ((row % 2) * sw) / 2; x < SX + hw - 4; x += sw) {
        c.fillStyle = hash(row, Math.round(x), 41) < 0.5 ? '#2e2c27' : '#383530';
        c.beginPath(); c.roundRect(x + 1.5, y, Math.min(sw - 3, SX + hw - x - 2), sh - 2, 3); c.fill();
      }
      y += sh;
    }
    // a bench and a bin
    const bxp = W * 0.32, by = GY + 8;
    c.fillStyle = '#4a3a28'; for (let i = 0; i < 3; i++) c.fillRect(bxp - 34, by - 30 + i * 6, 68, 3.5);
    c.fillRect(bxp - 36, by - 10, 72, 4);
    c.fillStyle = '#2c2c34'; c.fillRect(bxp - 32, by - 32, 4, 32); c.fillRect(bxp + 28, by - 32, 4, 32); c.fillRect(bxp - 34, by - 6, 6, 8); c.fillRect(bxp + 28, by - 6, 6, 8);
    const binx = W * 0.68;
    c.fillStyle = '#2c2c34'; c.fillRect(binx - 9, by - 26, 18, 26); c.fillStyle = '#3a3a44'; c.fillRect(binx - 11, by - 29, 22, 4);
    // lamp posts (the lantern glass is drawn live)
    for (const lx of LAMPS) {
      const x = W * lx, top = GY - H * 0.27;
      c.fillStyle = '#30303a';
      c.fillRect(x - 2.5, top, 5, GY - top); c.fillRect(x - 9, GY - 10, 18, 10); c.fillRect(x - 6, GY - 16, 12, 6);
      c.fillRect(x - 10, top - 4, 20, 4); c.fillRect(x - 10, top - 26, 20, 3);
      c.beginPath(); c.moveTo(x - 12, top - 26); c.lineTo(x, top - 38); c.lineTo(x + 12, top - 26); c.fill();
      c.fillRect(x - 1, top - 44, 2, 6);
    }
  }

  function drawLive(c, t) { // things in the park that flicker or drift
    for (const [n, lx] of LAMPS.entries()) {
      const x = W * lx, top = G.GY - H * 0.27, on = hash(n, Math.floor(t * 9), 3) > 0.05;
      c.fillStyle = on ? '#e8c27a' : '#5a4a30'; c.fillRect(x - 8, top - 23, 16, 19);
      c.fillStyle = '#30303a'; c.fillRect(x - 1, top - 23, 2, 19);
      if (on) { c.globalAlpha = 0.1; c.fillStyle = '#e8c27a'; c.beginPath(); c.ellipse(x, G.GY + 10, H * 0.09, 12, 0, 0, TAU); c.fill(); c.globalAlpha = 1; }
    }
    // red aircraft light on the clock tower
    if (Math.sin(t * 2.6) > 0.55) { const tw = Math.max(46, G.U * 0.9), tt = G.GY - H * 0.02 - H * 0.46; c.fillStyle = '#ff2a2a'; glowDot(c, W * TOWER, tt - tw * 1.4 - 17, 2.5, '#ff2a2a', 0.4); }
    // a few windows switch on and off
    for (let i = 0; i < 6; i++) if (hash(i, Math.floor(t * 0.4 + i), 5) < 0.5) { c.fillStyle = '#c8904a'; c.fillRect(hash(i, 2, 61) * W, G.GY - H * (0.03 + hash(i, 3, 61) * 0.12), 3, 4); }
    drawMoon(c);
    // dark clouds, some crossing the moon
    c.fillStyle = '#151520';
    for (const cl of S.clouds) for (let i = 0; i < 4; i++) { c.beginPath(); c.ellipse(cl.x + (i - 1.5) * cl.w * 0.25, cl.y + Math.sin(i * 2.1) * cl.h * 0.3, cl.w * 0.3, cl.h * (0.55 + (i % 2) * 0.3), 0, 0, TAU); c.fill(); }
  }
  const moonPhase = () => (!S.night ? 0.25 : S.fullMoon ? 1 : [0.35, 0.7][(S.night - 1) % 3]);
  function nightProgress() {
    if (S.phase === 'clear' || S.phase === 'shop') return 1;
    if (!S.total) return 0.2;
    return clamp(1 - (S.queue.reduce((n, e) => n + e.flock, 0) + S.birds.length) / S.total, 0, 1);
  }
  function drawMoon(c) { // waxing from the right; the dark side stays faintly visible
    S.moonP = lerp(S.moonP ?? 0, nightProgress(), 0.02);
    const f = moonPhase(), full = f >= 1, r = Math.min(W, H) * (full ? 0.075 : 0.05), p = S.moonP;
    const x = lerp(W * 0.1, W * 0.9, p), y = H * 0.21 - Math.sin(p * Math.PI) * H * 0.09;
    c.fillStyle = '#1c0b0c'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    const w = r * Math.abs(2 * f - 1);
    c.beginPath(); c.arc(x, y, r, -Math.PI / 2, Math.PI / 2);
    if (f >= 0.5) c.ellipse(x, y, w, r, 0, Math.PI / 2, Math.PI * 1.5); else c.ellipse(x, y, w, r, 0, Math.PI / 2, -Math.PI / 2, true);
    c.fillStyle = full ? '#c03a2e' : '#a8302a'; c.fill();
    c.save(); c.clip();
    c.fillStyle = full ? '#8e2a22' : '#7e221e';
    for (const [ox, oy, cr] of [[0.35, -0.35, 0.16], [0.55, 0.2, 0.12], [0.2, 0.5, 0.09], [-0.3, -0.1, 0.14], [-0.5, 0.35, 0.1], [0.05, -0.05, 0.07]]) { c.beginPath(); c.arc(x + ox * r, y + oy * r, cr * r, 0, TAU); c.fill(); }
    c.restore();
  }
  function drawRain(c) {
    if (S.acid) {
      const a = Math.min(1, S.acid.t / 1.2, (ACID.time - S.acid.t) / 0.6);
      c.strokeStyle = '#7dff5a'; c.lineWidth = 2; c.globalAlpha = 0.7 * a; c.beginPath();
      for (const d of S.acidDrops) { c.moveTo(d.x, d.y); c.lineTo(d.x + d.l * 0.12, d.y - d.l); }
      c.stroke(); c.globalAlpha = 1;
    }
    if (!S.fullMoon) return;
    c.strokeStyle = '#a0b0d0'; c.lineWidth = 3; c.globalAlpha = 0.7; c.beginPath();
    for (const d of S.rain) { c.moveTo(d.x, d.y); c.lineTo(d.x - d.l * 0.18, d.y - d.l); }
    c.stroke(); c.globalAlpha = 1;
  }
  function drawFog(c) { // low mist rolling across the lawn, in front of everything on the ground
    c.fillStyle = '#4a4e5e';
    for (const f of S.fog) { c.globalAlpha = 0.16; c.beginPath(); c.ellipse(f.x, G.GY - 6 + f.y * 14, f.w * 0.5, 14 + f.y * 6, 0, 0, TAU); c.fill(); }
    c.globalAlpha = 1;
  }
  function drawGrass(c, t) { // tall foreground grass along the bottom edge, swaying
    const pw = 2.6 * G.U;
    c.lineCap = 'round';
    for (let i = 0; i < W / 5; i++) {
      const x = i * 5 + hash(i, 1, 71) * 4;
      if (Math.abs(x - G.SX) < pw * 0.92) continue;
      const h = H * (0.025 + hash(i, 2, 71) * 0.05), sway = Math.sin(t * 1.3 + x * 0.02) * h * 0.25, lit = hash(i, 3, 71);
      c.strokeStyle = lit < 0.25 ? '#6a7064' : lit < 0.6 ? '#3a4232' : '#262c20'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(x, H + 2); c.quadraticCurveTo(x + sway * 0.3, H - h * 0.5, x + sway, H - h); c.stroke();
    }
    c.lineCap = 'butt';
  }

  const PATINA = { body: '#3e3a44', light: '#524c5a', dark: '#2a2730' }; // weathered iron, dim enough not to blow out the glyphs
  function drawGun(c, id, u) { // drawn along +x from the hand, in bright colours that stand out from the iron statue
    const STEEL = '#dfe3ec', DARK = '#8a909c', WOOD = '#c47a3a';
    if (id === 'musket') { c.fillStyle = WOOD; c.fillRect(-0.12 * u, -0.06 * u, 0.42 * u, 0.13 * u); c.fillStyle = STEEL; c.fillRect(0.25 * u, -0.04 * u, 0.7 * u, 0.065 * u); }
    else if (id === 'shotgun') { c.fillStyle = WOOD; c.fillRect(-0.12 * u, -0.07 * u, 0.34 * u, 0.15 * u); c.fillStyle = STEEL; c.fillRect(0.2 * u, -0.075 * u, 0.55 * u, 0.065 * u); c.fillRect(0.2 * u, 0.005 * u, 0.55 * u, 0.065 * u); }
    else if (id === 'pump') { c.fillStyle = STEEL; c.fillRect(-0.1 * u, -0.06 * u, 0.92 * u, 0.1 * u); c.fillStyle = WOOD; c.fillRect(0.4 * u - S.recoil * 0.1 * u, 0.03 * u, 0.24 * u, 0.09 * u); c.fillRect(-0.14 * u, -0.07 * u, 0.16 * u, 0.14 * u); }
    else if (id === 'smg') { c.fillStyle = STEEL; c.fillRect(-0.06 * u, -0.07 * u, 0.6 * u, 0.14 * u); c.fillStyle = DARK; c.fillRect(0.12 * u, 0.06 * u, 0.09 * u, 0.24 * u); c.fillRect(0.5 * u, -0.035 * u, 0.14 * u, 0.06 * u); }
    else if (id === 'laser') { /* nothing in the hands: it comes out of the eyes */ }
    else if (id === 'tesla') {
      c.fillStyle = DARK; c.fillRect(-0.1 * u, -0.07 * u, 0.7 * u, 0.14 * u); c.fillRect(0.12 * u, 0.06 * u, 0.07 * u, 0.16 * u);
      c.fillStyle = '#7fe8ff'; for (let i = 0; i < 3; i++) c.fillRect((0.18 + i * 0.13) * u, -0.13 * u, 0.055 * u, 0.26 * u);
      c.fillStyle = '#d8f8ff'; glowDot(c, 0.72 * u, 0, 0.07 * u, '#7fe8ff', 0.5);
    } else { c.fillStyle = '#9fcf4a'; c.fillRect(-0.3 * u, -0.1 * u, 1.25 * u, 0.2 * u); c.fillStyle = '#5f8a2a'; c.fillRect(0.85 * u, -0.13 * u, 0.12 * u, 0.26 * u); c.fillRect(-0.32 * u, -0.12 * u, 0.08 * u, 0.24 * u); c.fillRect(0.1 * u, 0.1 * u, 0.06 * u, 0.14 * u); }
  }
  // where the back hand holds the gun this frame (pulled back a touch by recoil)
  function heldBack() { const kick = S.recoil * 0.12 * G.U, P = grip(); return { x: P.x - Math.cos(S.aim) * kick, y: P.y - Math.sin(S.aim) * kick }; }
  function drawHeldGun(c) {
    const B = heldBack();
    c.save(); c.translate(B.x, B.y); c.rotate(S.aim);
    if (Math.cos(S.aim) < 0) c.scale(1, -1);
    drawGun(c, GUNS[S.gun].id, G.U * GS);
    c.restore();
  }
  function drawStatue(c, t) {
    const { U, SX, top, GY } = G;
    // plinth: two steps, a shaft with a plaque, a moulded cap
    c.fillStyle = '#2e2e2c'; c.fillRect(SX - 1.05 * U, GY - 0.12 * U, 2.1 * U, 0.12 * U);
    c.fillStyle = '#383836'; c.fillRect(SX - 0.95 * U, GY - 0.24 * U, 1.9 * U, 0.12 * U);
    c.fillStyle = '#343432'; c.fillRect(SX - 0.78 * U, top + 0.1 * U, 1.56 * U, 1.0 * U);
    c.fillStyle = '#2a2a28'; c.fillRect(SX - 0.78 * U, top + 0.1 * U, 0.12 * U, 1.0 * U); c.fillRect(SX + 0.66 * U, top + 0.1 * U, 0.12 * U, 1.0 * U);
    c.fillStyle = '#4a4a46'; c.fillRect(SX - 0.92 * U, top, 1.84 * U, 0.14 * U);
    c.fillStyle = '#7a5e2e'; c.fillRect(SX - 0.4 * U, top + 0.4 * U, 0.8 * U, 0.32 * U);
    c.fillStyle = '#3e2e14'; for (let i = 0; i < 3; i++) c.fillRect(SX - (0.3 - i * 0.05) * U, top + (0.47 + i * 0.08) * U, (0.6 - i * 0.1) * U, 0.03 * U);
    c.fillStyle = '#2c4a2a'; for (let i = 0; i < 5; i++) c.fillRect(SX + (hash(i, 1, 81) - 0.5) * 1.4 * U, top + 0.85 * U + hash(i, 2, 81) * 0.25 * U, 0.12 * U, 0.06 * U); // moss
    // legs, coat, head
    c.fillStyle = PATINA.dark; c.fillRect(SX - 0.3 * U, top - 1.1 * U, 0.24 * U, 1.1 * U); c.fillRect(SX + 0.06 * U, top - 1.1 * U, 0.24 * U, 1.1 * U);
    c.fillRect(SX - 0.34 * U, top - 0.08 * U, 0.3 * U, 0.08 * U); c.fillRect(SX + 0.04 * U, top - 0.08 * U, 0.3 * U, 0.08 * U);
    c.fillStyle = PATINA.body; c.beginPath();
    c.moveTo(SX - 0.5 * U, top - 0.6 * U); c.lineTo(SX + 0.5 * U, top - 0.6 * U); c.lineTo(SX + 0.46 * U, top - 2.12 * U); c.lineTo(SX - 0.46 * U, top - 2.12 * U); c.fill();
    c.fillStyle = PATINA.dark; for (let i = 0; i < 3; i++) c.fillRect(SX + (i - 1) * 0.25 * U - 0.02 * U, top - 1.0 * U, 0.04 * U, 0.4 * U); // coat folds
    c.fillStyle = PATINA.light; c.beginPath(); c.moveTo(SX - 0.46 * U, top - 2.12 * U); c.lineTo(SX - 0.2 * U, top - 2.12 * U); c.lineTo(SX + 0.36 * U, top - 0.8 * U); c.lineTo(SX + 0.1 * U, top - 0.8 * U); c.fill(); // sash
    c.fillStyle = PATINA.dark; c.fillRect(SX - 0.09 * U, top - 2.25 * U, 0.18 * U, 0.15 * U);
    c.fillStyle = PATINA.body; c.beginPath(); c.arc(SX, top - 2.45 * U, 0.27 * U, 0, TAU); c.fill();
    c.strokeStyle = '#4e5040'; c.lineWidth = 0.06 * U; c.beginPath(); c.arc(SX, top - 2.47 * U, 0.27 * U, Math.PI * 1.05, Math.PI * 1.95); c.stroke(); // laurels
    const look = Math.cos(S.aim) * 0.06 * U;
    c.fillStyle = '#ff1a2a'; for (const ex of [-0.1, 0.1]) glowDot(c, SX + ex * U + look, top - 2.46 * U, 0.05 * U, '#ff1a2a', 0.6);
    c.strokeStyle = PATINA.dark; c.lineWidth = 0.05 * U; c.beginPath(); // brows slanting down to the middle
    c.moveTo(SX - 0.19 * U + look, top - 2.58 * U); c.lineTo(SX - 0.03 * U + look, top - 2.51 * U); c.moveTo(SX + 0.19 * U + look, top - 2.58 * U); c.lineTo(SX + 0.03 * U + look, top - 2.51 * U); c.stroke();
    // both hands on the gun: back hand at the grip, front hand along the barrel
    const dx = Math.cos(S.aim), dy = Math.sin(S.aim), back = heldBack(), front = { x: back.x + dx * 0.4 * GS * U, y: back.y + dy * 0.4 * GS * U };
    c.strokeStyle = PATINA.body; c.lineCap = 'round'; c.lineJoin = 'round'; c.lineWidth = 0.16 * U;
    const sh = (k) => ({ x: SX + k * 0.42 * U, y: top - 2.04 * U });
    const near = sh(S.side), far = sh(-S.side); // the near shoulder works the grip, the far arm reaches across for the barrel
    c.beginPath(); c.moveTo(near.x, near.y); c.lineTo(lerp(near.x, back.x, 0.5) + S.side * 0.12 * U, lerp(near.y, back.y, 0.5) + 0.1 * U); c.lineTo(back.x, back.y);
    c.moveTo(far.x, far.y); c.lineTo(lerp(far.x, front.x, 0.5), lerp(far.y, front.y, 0.5) + 0.12 * U); c.lineTo(front.x, front.y); c.stroke();
    c.lineCap = 'butt'; c.lineJoin = 'miter';
    drawHeldGun(c);
    c.fillStyle = PATINA.light; for (const h of [back, front]) { c.beginPath(); c.arc(h.x, h.y, 0.1 * U, 0, TAU); c.fill(); } // hands over the gun
    // droppings: splats with drips, then the mound rising off the plinth
    for (const s of S.splats) {
      const x = SX + s.rx * U, y = top + s.ry * U, r = s.s * U * 0.5;
      c.fillStyle = '#eef2d8';
      c.beginPath(); c.ellipse(x, y, r, r * 0.7, s.rot, 0, TAU); c.fill();
      for (let k = 0; k < 4; k++) { const a = hash(s.seed, k, 1) * TAU; c.beginPath(); c.arc(x + Math.cos(a) * r * 1.1, y + Math.sin(a) * r * 0.8, r * 0.3, 0, TAU); c.fill(); }
      c.fillRect(x - r * 0.15, y, r * 0.3, r * 1.8 * s.drip);
      c.fillStyle = '#9aa078'; c.beginPath(); c.arc(x + r * 0.2, y - r * 0.1, r * 0.25, 0, TAU); c.fill();
    }
    if (S.cov > 1) {
      const h = (S.cov / S.cap) * 2.3 * U, wv = 0.95 * U;
      c.fillStyle = '#e8e0a8'; c.beginPath(); c.moveTo(SX - wv, top);
      for (let i = 0; i <= 12; i++) { const f = i / 12, bump = Math.sin(f * Math.PI); c.lineTo(SX - wv + f * 2 * wv, top - h * bump * (0.85 + hash(i, 7, 7) * 0.3) - Math.sin(t * 2 + i) * 1.5); }
      c.lineTo(SX + wv, top); c.fill();
      c.fillStyle = '#a8ae8c'; for (let i = 0; i < 6; i++) c.fillRect(SX - wv * 0.7 + i * wv * 0.28, top - h * 0.5 * (0.5 + hash(i, 3, 3)), 3, h * 0.3);
    }
  }

  function drawBabyRange() { // two faint dashed lines either side of each baby statue: the column it covers
    if (S.phase !== 'play') return;
    ctx.save(); ctx.setLineDash([4, 8]); ctx.strokeStyle = 'rgba(233,226,208,0.12)'; ctx.lineWidth = 1;
    S.babies.tur.forEach((tb, i) => { const P = babyPos(i), R = babyRange(); ctx.beginPath(); for (const x of [P.x - R, P.x + R]) { ctx.moveTo(x, 0); ctx.lineTo(x, G.GY); } ctx.stroke(); });
    ctx.restore();
  }
  function drawBabies(c) { // knee-high iron statues on little pedestals, each with whatever you armed it with
    const u = G.U * 0.45;
    S.babies.tur.forEach((tb, i) => {
      const P = babyPos(i), gy = G.GY;
      c.fillStyle = '#383836'; c.fillRect(P.x - 0.9 * u, gy - 0.9 * u, 1.8 * u, 0.9 * u);
      c.fillStyle = '#4a4a46'; c.fillRect(P.x - 1.0 * u, gy - 1.0 * u, 2.0 * u, 0.14 * u);
      c.fillStyle = PATINA.dark; c.fillRect(P.x - 0.32 * u, gy - 1.9 * u, 0.26 * u, 0.9 * u); c.fillRect(P.x + 0.06 * u, gy - 1.9 * u, 0.26 * u, 0.9 * u);
      c.fillStyle = PATINA.body; c.fillRect(P.x - 0.45 * u, P.y - 0.1 * u, 0.9 * u, gy - 1.9 * u - P.y + 0.1 * u);
      c.beginPath(); c.arc(P.x, P.y - 0.5 * u, 0.36 * u, 0, TAU); c.fill();
      c.fillStyle = '#ff2236'; glowDot(c, P.x + Math.cos(tb.aim) * 0.12 * u, P.y - 0.52 * u, Math.max(1.2, 0.05 * u), '#ff2236', 0.45);
      c.save(); c.translate(P.x, P.y); c.rotate(tb.aim);
      c.strokeStyle = PATINA.body; c.lineWidth = 0.22 * u; c.lineCap = 'round'; c.beginPath(); c.moveTo(0, 0); c.lineTo(0.75 * u, 0); c.stroke(); c.lineCap = 'butt';
      c.fillStyle = '#5a5a62'; c.fillRect(0.7 * u, -0.1 * u, 0.5 * u, 0.16 * u);
      c.restore();
      if (tb.flash > 0) { c.fillStyle = '#ffb050'; glowDot(c, P.x + Math.cos(tb.aim) * 1.25 * u, P.y + Math.sin(tb.aim) * 1.25 * u, 4, '#ffcf6a', 0.5); }
    });
  }
  function blastRings(b) { // three shockwave ripples, a beat apart
    const f = 1 - b.life / b.max, out = [];
    for (let k = 0; k < 3; k++) { const rf = f * 1.4 - k * 0.16; if (rf > 0 && rf < 1) out.push({ r: b.R * (0.25 + rf * 1.7), a: 1 - rf }); }
    return out;
  }
  function drawBlast(c, b, crisp) {
    const f = 1 - b.life / b.max;
    if (!b.big) {
      if (crisp) return;
      c.globalAlpha = 1 - f; c.fillStyle = '#ffb050'; c.beginPath(); c.arc(b.x, b.y, b.R * (0.4 + f * 0.6), 0, TAU); c.fill(); c.globalAlpha = 1;
      return;
    }
    if (!crisp) { // fireball, swelling then guttering, with a white-hot core
      const fb = Math.max(0, 1 - f * 1.6);
      c.globalAlpha = fb; c.fillStyle = '#ff6a2a'; c.beginPath(); c.arc(b.x, b.y, b.R * (0.35 + f * 0.6), 0, TAU); c.fill();
      c.fillStyle = '#ffb050'; c.beginPath(); c.arc(b.x, b.y, b.R * (0.25 + f * 0.4), 0, TAU); c.fill();
      c.fillStyle = '#fff4d0'; c.beginPath(); c.arc(b.x, b.y, b.R * 0.2 * fb, 0, TAU); c.fill();
    }
    for (const ring of blastRings(b)) {
      c.globalAlpha = ring.a * (crisp ? 0.45 : 1); c.strokeStyle = crisp ? '#fff4d0' : '#ffd9a0'; c.lineWidth = (crisp ? 3 : 10) * ring.a;
      c.beginPath(); c.arc(b.x, b.y, ring.r, 0, TAU); c.stroke();
    }
    c.globalAlpha = 1;
  }
  function flame(c, x, y, w, h) { c.beginPath(); c.moveTo(x - w, y); c.quadraticCurveTo(x - w * 0.9, y - h * 0.5, x, y - h); c.quadraticCurveTo(x + w * 0.9, y - h * 0.5, x + w, y); c.closePath(); c.fill(); }
  function strokePath(c, pts) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.stroke(); }
  function drawBolts(c, crisp) {
    c.lineJoin = 'round'; c.lineCap = 'round';
    for (const bo of S.bolts) {
      const a = clamp(bo.life / 0.9, 0, 1) * (Math.random() < 0.25 ? 0.4 : 1);
      c.globalAlpha = a;
      c.strokeStyle = crisp ? 'rgba(160,210,255,0.5)' : '#9fd4ff'; c.lineWidth = crisp ? 7 : 12; strokePath(c, bo.main);
      c.strokeStyle = '#ffffff'; c.lineWidth = crisp ? 2.5 : 5; strokePath(c, bo.main);
      c.lineWidth = crisp ? 1.2 : 3; for (const f of bo.forks) strokePath(c, f);
    }
    for (const ar of S.arcs) { // tesla arcs re-jag every frame so they crackle
      const pts = boltPath(ar.x0, ar.y0, ar.x1, ar.y1, 14);
      const k = ar.big ? 2.2 : 1;
      c.globalAlpha = clamp(ar.life / (ar.max || 0.16), 0, 1);
      c.strokeStyle = crisp ? 'rgba(127,216,255,0.6)' : '#7fd8ff'; c.lineWidth = (crisp ? 4 : 8) * k; strokePath(c, pts);
      c.strokeStyle = '#ffffff'; c.lineWidth = (crisp ? 1.5 : 3) * k; strokePath(c, pts);
    }
    c.globalAlpha = 1; c.lineJoin = 'miter'; c.lineCap = 'butt';
  }

  function drawBeam(c, crisp) {
    const B = S.beam || { heat: 0, none: true };
    const h = B.heat / LASER.heatMax, w0 = (crisp ? 2 : 4) + h * (crisp ? 14 : 30), w = w0, off = 0.1 * G.U;
    if (!B.none) {
    const col = h < 0.4 ? '#ff2236' : h < 0.8 ? '#ff7a2a' : '#ffd9a0';
    c.lineCap = 'round';
    for (const e of [-off, off]) { // one beam from each eye, meeting on the target
      c.globalAlpha = (crisp ? 0.2 : 0.35) * (0.4 + h); c.strokeStyle = col; c.lineWidth = w * 2.2; c.beginPath(); c.moveTo(B.x0 + e, B.y0); c.lineTo(B.x1, B.y1); c.stroke(); // halo
      c.globalAlpha = crisp ? 0.55 : 1;
      c.strokeStyle = col; c.lineWidth = w * (0.9 + Math.random() * 0.2); c.beginPath(); c.moveTo(B.x0 + e, B.y0); c.lineTo(B.x1, B.y1); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = w * 0.3; c.beginPath(); c.moveTo(B.x0 + e, B.y0); c.lineTo(B.x1, B.y1); c.stroke();
    }
    c.globalAlpha = 1; c.lineCap = 'butt';
    if (!crisp) { c.fillStyle = col; glowDot(c, B.x1, B.y1, 4 + h * 16, col, 0.5); for (const e of [-off, off]) glowDot(c, B.x0 + e, B.y0, 2 + h * 6, col, 0.6); }
    }
    for (const tb of S.babies.tur) { // the baby statues' little beams
      if (!tb.beam) continue;
      const bw = (crisp ? 1 : 2) + tb.beam.heat * (crisp ? 1.5 : 3);
      c.globalAlpha = crisp ? 0.5 : 1; c.strokeStyle = '#ff3a2e'; c.lineWidth = bw; c.lineCap = 'round';
      c.beginPath(); c.moveTo(tb.beam.x0, tb.beam.y0); c.lineTo(tb.beam.x1, tb.beam.y1); c.stroke(); c.globalAlpha = 1; c.lineCap = 'butt';
    }
  }

  function drawBird(c, b) {
    c.save(); c.translate(b.x, b.y); c.scale(Math.sign(b.vx) || 1, 1); c.rotate(clamp(b.vy / 600, -0.35, 0.35) * Math.sign(b.vx));
    birdBody(c, BIRDS[b.type], b.r, Math.sin(b.flap), b.hit > 0 || (b.stun > 0 && Math.random() < 0.35), b.big ? 'big' : true);
    c.restore();
    if (b.burn > 0) { // a crown of fire on top of it
      const cols = b.fire === 'cursed' ? ['#4aff2a', '#d8ff7a'] : ['#ff5a14', '#ffc040'];
      for (let i = 0; i < 3; i++) {
        const fx = b.x + (i - 1) * b.r * 0.42, h = b.r * (0.7 + Math.random() * 0.6) * (i === 1 ? 1.25 : 1);
        c.fillStyle = cols[0]; flame(c, fx, b.y - b.r * 0.2, b.r * 0.26, h);
        c.fillStyle = cols[1]; flame(c, fx, b.y - b.r * 0.2, b.r * 0.12, h * 0.55);
      }
    }
  }
  function birdBody(c, T, s, f, white = false, eyes = false) { // a ragged silhouette facing +x
    const wing = (k, ff) => { // a wing with four torn feather tips
      const tipY = -s * 0.1 - s * 1.1 * ff * k;
      c.beginPath(); c.moveTo(s * 0.3, -s * 0.12);
      for (let i = 0; i < 4; i++) { const u = i / 3; c.lineTo(lerp(s * 0.15, -s * 0.75, u), lerp(-s * 0.12, tipY, 0.75 + u * 0.25) + (i % 2 ? s * 0.1 * ff : 0)); c.lineTo(lerp(s * 0.05, -s * 0.85, u), lerp(-s * 0.12, tipY, 0.55 + u * 0.2)); }
      c.lineTo(-s * 0.45, -s * 0.05); c.closePath(); c.fill();
    };
    c.fillStyle = white ? '#fff' : T.wing;
    c.beginPath(); c.moveTo(-s * 0.6, 0); c.lineTo(-s * 1.3, -s * 0.28); c.lineTo(-s * 1.15, -s * 0.02); c.lineTo(-s * 1.35, s * 0.18); c.lineTo(-s * 1.1, s * 0.26); c.fill(); // forked tail
    wing(0.75, -f * 0.6);
    c.fillStyle = white ? '#fff' : T.col;
    c.beginPath(); c.moveTo(s * 0.95, -s * 0.38); c.quadraticCurveTo(s * 0.5, -s * 0.55, s * 0.2, -s * 0.3); c.quadraticCurveTo(-s * 0.4, -s * 0.4, -s * 0.75, 0);
    c.quadraticCurveTo(-s * 0.2, s * 0.45, s * 0.5, s * 0.15); c.quadraticCurveTo(s * 0.8, 0, s * 0.95, -s * 0.38); c.fill();
    c.beginPath(); c.arc(s * 0.74, -s * 0.28, s * 0.26, 0, TAU); c.fill();
    c.fillStyle = T.beak; c.beginPath(); c.moveTo(s * 0.94, -s * 0.36); c.quadraticCurveTo(s * 1.3, -s * 0.32, s * 1.32, -s * 0.12); c.lineTo(s * 0.96, -s * 0.2); c.fill(); // hooked beak
    if (eyes) { // the red eyes, slanted brow. bigger and hotter under a full moon
      c.fillStyle = '#ff1a2a'; glowDot(c, s * 0.82, -s * 0.31, Math.max(2, s * (eyes === 'big' ? 0.13 : 0.09)), '#ff1a2a', eyes === 'big' ? 0.75 : 0.5);
      c.fillStyle = white ? '#fff' : T.col; c.beginPath(); c.moveTo(s * 0.68, -s * 0.46); c.lineTo(s * 0.98, -s * 0.36); c.lineTo(s * 0.98, -s * 0.44); c.fill();
    }
    c.fillStyle = white ? '#fff' : T.wing; wing(1, f);
    if (T.crown) { // a tiny gold crown, slightly askew
      c.fillStyle = '#f2c14e'; c.beginPath(); const cx = s * 0.72, cy = -s * 0.52, cw = s * 0.22;
      c.moveTo(cx - cw, cy); c.lineTo(cx - cw, cy - cw * 0.9); c.lineTo(cx - cw * 0.5, cy - cw * 0.4); c.lineTo(cx, cy - cw * 1.1); c.lineTo(cx + cw * 0.5, cy - cw * 0.4); c.lineTo(cx + cw, cy - cw * 0.9); c.lineTo(cx + cw, cy); c.fill();
    }
  }

  function drawSource(t) {
    const k = src.width / W;
    sx.setTransform(1, 0, 0, 1, 0, 0); sx.drawImage(bgc, 0, 0);
    sx.setTransform(k, 0, 0, k, 0, 0);
    drawLive(sx, t);
    const fl = Math.max(stormFlash(), (S.boomFlash || 0) * 2);
    if (fl > 0) { sx.fillStyle = `rgba(190,205,255,${fl * 0.6})`; sx.fillRect(0, 0, W, H); } // the whole sky lights up
    for (const g of S.ground) { sx.globalAlpha = Math.min(1, g.life / 2); sx.fillStyle = '#d8dcc0'; sx.beginPath(); sx.ellipse(g.x, g.y, g.s, g.s * 0.35, 0, 0, TAU); sx.fill(); }
    sx.globalAlpha = 1;
    for (const c of S.corpses) {
      sx.globalAlpha = Math.min(1, c.life); sx.save(); sx.translate(c.x, c.y); sx.rotate(c.landed ? Math.PI : c.rot);
      birdBody(sx, BIRDS[c.type], c.r, 0.2); sx.restore();
    }
    sx.globalAlpha = 1;
    drawStatue(sx, t);
    drawBabies(sx);
    drawFog(sx);
    sx.fillStyle = '#f2f4e2';
    for (const p of S.poops) { sx.beginPath(); sx.ellipse(p.x, p.y, p.r * 0.8, p.r * 1.1, 0, 0, TAU); sx.fill(); }
    for (const b of S.birds) drawBird(sx, b);
    for (const r of S.rockets) {
      sx.save(); sx.translate(r.x, r.y); sx.rotate(r.a); sx.fillStyle = '#6a7a3a'; sx.fillRect(-9, -3, 16, 6); sx.fillStyle = '#c8c8c2'; sx.beginPath(); sx.moveTo(7, -3); sx.lineTo(12, 0); sx.lineTo(7, 3); sx.fill(); sx.restore();
      sx.fillStyle = '#ffb050'; glowDot(sx, r.x - Math.cos(r.a) * 10, r.y - Math.sin(r.a) * 10, 3 + Math.min(4, r.v / 300), '#ffb050', 0.5);
    }
    for (const b of S.blasts) drawBlast(sx, b, false);
    sx.globalAlpha = 1;
    sx.strokeStyle = '#ffe9a0'; sx.lineWidth = 4;
    for (const tr of S.tracers) {
      sx.globalAlpha = tr.life / tr.max; sx.strokeStyle = tr.col || '#ffe9a0';
      sx.beginPath(); sx.moveTo(tr.x0, tr.y0); if (tr.cx !== undefined) sx.quadraticCurveTo(tr.cx, tr.cy, tr.x1, tr.y1); else sx.lineTo(tr.x1, tr.y1); sx.stroke();
    }
    sx.globalAlpha = 1;
    for (const p of S.parts) {
      sx.globalAlpha = clamp((p.life / p.max) * 1.5, 0, 1); sx.fillStyle = p.col;
      if (p.feather) { sx.save(); sx.translate(p.x, p.y); sx.rotate(p.rot); sx.fillRect(-p.s, -1.5, p.s * 2, 3); sx.restore(); }
      else sx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    }
    sx.globalAlpha = 1;
    drawBolts(sx, false);
    drawBeam(sx, false);
    if (S.flash > 0) { const M = muzzle(); sx.fillStyle = '#ffb050'; glowDot(sx, M.x, M.y, GUNS[S.gun].rocket ? 14 : 8, '#ffcf6a', 0.5); }
    drawRain(sx);
    drawGrass(sx, t);
  }

  // ---------------------------------------------------------------------------
  // HAUNT renderer
  // ---------------------------------------------------------------------------
  const HAUNT = { exposure: 1.5, fade: 0 };
  function sample(cell) {
    const c = Math.ceil(W / cell), r = Math.ceil(H / cell);
    if (grid.width !== c || grid.height !== r) { grid.width = c; grid.height = r; }
    gx.imageSmoothingEnabled = true; gx.imageSmoothingQuality = 'high';
    gx.drawImage(src, 0, 0, c, r);
    const d = gx.getImageData(0, 0, c, r).data, L = new Float32Array(c * r);
    for (let i = 0; i < L.length; i++) L[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    return { d, L, c, r };
  }
  const level = (l) => clamp((l - 0.035) * 1.6, 0, 1);
  const lvl8 = (x) => clamp(Math.round(x * 8) - 1, 0, 7);
  function boostInto(d, p, rgb, m) {
    const mx = Math.max(d[p], d[p + 1], d[p + 2]) || 1, f = Math.min(255 / mx, 4);
    rgb[m] = Math.min(255, d[p] * f); rgb[m + 1] = Math.min(255, d[p + 1] * f); rgb[m + 2] = Math.min(255, d[p + 2] * f);
  }
  function bloom(alpha, blur = 3) {
    wx.clearRect(0, 0, glow.width, glow.height);
    wx.filter = `blur(${blur}px)`; wx.drawImage(cv, 0, 0, glow.width, glow.height); wx.filter = 'none';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = alpha;
    ctx.drawImage(glow, 0, 0, cv.width, cv.height);
    ctx.restore();
  }
  // glyph shapes are rendered once into coverage masks, then copied straight into one pixel buffer per frame
  const glc = document.createElement('canvas'), glx = glc.getContext('2d');
  const masks = new Map();
  function glyphMasks(ramp, cell, font) {
    const key = ramp.join('') + cell + font;
    let m = masks.get(key);
    if (!m) {
      const tc = document.createElement('canvas'); tc.width = cell * ramp.length; tc.height = cell;
      const c = tc.getContext('2d', { willReadFrequently: true });
      c.font = `${font}px 'JetBrains Mono', monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      ramp.forEach((ch, g) => c.fillText(ch, g * cell + cell / 2, cell / 2));
      const d = c.getImageData(0, 0, tc.width, cell).data;
      m = new Uint8Array(ramp.length * cell * cell);
      for (let g = 0; g < ramp.length; g++) for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) m[(g * cell + y) * cell + x] = d[(y * tc.width + g * cell + x) * 4 + 3];
      masks.set(key, m);
    }
    return m;
  }
  if (document.fonts) document.fonts.ready.then(() => masks.clear());
  let glImg = null;
  function glyphPass(cell, font, ramp, c, r, g, a, rgb) {
    const mk = glyphMasks(ramp, cell, font), w = c * cell, h = r * cell;
    if (!glImg || glImg.width !== w || glImg.height !== h) { glc.width = w; glc.height = h; glImg = glx.createImageData(w, h); }
    const o = glImg.data;
    o.fill(0);
    for (let n = 0; n < c * r; n++) {
      if (g[n] < 0) continue;
      const k = (a[n] + 1) / 8, R = rgb[n * 3], Gc = rgb[n * 3 + 1], B = rgb[n * 3 + 2];
      const ox = (n % c) * cell, oy = ((n / c) | 0) * cell, base = g[n] * cell * cell;
      for (let y = 0; y < cell; y++) {
        let p = ((oy + y) * w + ox) * 4, q = base + y * cell;
        for (let x = 0; x < cell; x++, p += 4, q++) { const cov = mk[q]; if (!cov) continue; o[p] = R; o[p + 1] = Gc; o[p + 2] = B; o[p + 3] = cov * k; }
      }
    }
    glx.putImageData(glImg, 0, 0);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glc, 0, 0, w * DPR, h * DPR);
    ctx.restore();
  }
  // dark-to-mid: glowing dissolve squares that flake off and stream right. mid: katakana. bright: glyph ramp. edges: orange +
  const sqc = document.createElement('canvas'), sqx = sqc.getContext('2d');
  let sqImg = null;
  const HAUNT_RAMP = [...RAMP, ...KANA];
  function renderHaunt(t) {
    const CS = 8, { d, L, c, r } = sample(CS), Nn = c * r, w = c * CS, h = r * CS, tick = Math.floor(t * 1.5);
    if (!sqImg || sqImg.width !== w || sqImg.height !== h) { sqc.width = w; sqc.height = h; sqImg = sqx.createImageData(w, h); }
    const o = sqImg.data;
    o.fill(0);
    const rect = (x, y, s, R, Gc, B, A) => {
      x |= 0; y |= 0; s = Math.max(1, s | 0);
      for (let yy = Math.max(0, y); yy < Math.min(h, y + s); yy++) for (let xx = Math.max(0, x); xx < Math.min(w, x + s); xx++) { const p = (yy * w + xx) * 4; o[p] = R; o[p + 1] = Gc; o[p + 2] = B; o[p + 3] = A; }
    };
    const g = new Int8Array(Nn).fill(-1), a = new Uint8Array(Nn), rgb = new Uint8Array(Nn * 3), col = [0, 0, 0];
    const fade = Array.from({ length: r }, (_, j) => 1 - HAUNT.fade * ease(clamp((j / r - 0.5) / 0.5, 0, 1)));
    const tone = (n) => Math.pow(level(L[n] * HAUNT.exposure), 1.5) * 1.15 * fade[(n / c) | 0];
    const on = (n) => tone(n) > 0.06;
    for (let n = 0; n < Nn; n++) {
      const l = L[n], v = Math.min(1, tone(n));
      if (v <= 0.06) continue;
      const i = n % c, j = (n / c) | 0, m = n * 3, k = 0.35 + 0.65 * fade[j];
      boostInto(d, n * 4, col, 0);
      col[0] *= k; col[1] *= k; col[2] *= k;
      const hs = hash(i, j, 3), s = CS * (0.5 + 0.5 * hs), x = i * CS + (CS - s) / 2, y = j * CS + (CS - s) / 2;
      rect(x, y, s, col[0] * 0.6, col[1] * 0.6, col[2] * 0.6, 90 + v * 110);
      if (i < c - 1 && !on(n + 1) && hs < 0.6) {
        for (let q = 0; q < 2; q++) {
          const f = (t * (0.35 + hs * 0.4) + hash(i, j, q)) % 1, qs = CS * (0.25 + 0.35 * hash(j, i, q));
          rect(x + CS + f * CS * 9, y + (hash(i, j, q + 5) - 0.5) * CS * 3 - f * CS, qs, col[0], col[1], col[2], (1 - f) * 200);
        }
      }
      const e = (i < c - 1 ? Math.abs(l - L[n + 1]) : 0) + (j < r - 1 ? Math.abs(l - L[n + c]) : 0);
      if (e > 0.14 && hash(i, j, tick) < 0.5) { g[n] = 2; a[n] = 7; rgb[m] = 255; rgb[m + 1] = 122; rgb[m + 2] = 46; continue; }
      rgb[m] = col[0]; rgb[m + 1] = col[1]; rgb[m + 2] = col[2];
      if (v < 0.45) { g[n] = RAMP.length + Math.floor(hash(i, j, tick) * KANA.length); a[n] = lvl8(0.25 + v); }
      else { g[n] = Math.min(RAMP.length - 1, Math.floor(v * RAMP.length)); a[n] = lvl8(0.3 + v); }
    }
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    sqx.putImageData(sqImg, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sqc, 0, 0, w * DPR, h * DPR);
    ctx.imageSmoothingEnabled = true;
    glyphPass(CS, 9, HAUNT_RAMP, c, r, g, a, rgb);
    bloom(0.9, 3);
    bloom(0.45, 10);
  }
  function renderGlitch(gl) { // torn scanlines and stray pixel blocks when you get hit
    if (gl < 0.15) return;
    gl = (gl - 0.15) / 0.85; gl *= gl;
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (let k = 0; k < gl * 10; k++) { const y = rand(0, cv.height), hh = rand(3, 40) * DPR, dx = rand(-60, 60) * gl * DPR; ctx.drawImage(cv, 0, y, cv.width, hh, dx, y, cv.width, hh); }
    for (let k = 0; k < gl * 30; k++) {
      ctx.fillStyle = pick(['#1f3cff', '#e8e8e4', '#ff2a3a', '#000', '#5fb0ff']); ctx.globalAlpha = rand(0.2, 0.7) * gl;
      const s = 8 * DPR * Math.ceil(rand(1, 6));
      ctx.fillRect(Math.floor(rand(0, cv.width) / s) * s, Math.floor(rand(0, cv.height) / s) * s, s * rand(1, 4) | 0, s);
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------------------
  // Crisp overlay: crosshair, cash pops, health bars, banners
  // ---------------------------------------------------------------------------
  function drawOverlay() {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const fl = stormFlash();
    if (fl > 0) { ctx.fillStyle = `rgba(235,242,255,${fl * 0.5})`; ctx.fillRect(0, 0, W, H); }
    if (S.phase === 'play' || S.phase === 'clear') { ctx.save(); ctx.globalAlpha = 0.92; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4; drawHeldGun(ctx); ctx.restore(); }
    drawBabyRange();
    drawBolts(ctx, true);
    drawBeam(ctx, true);
    for (const b of S.blasts) drawBlast(ctx, b, true);
    if (S.boomFlash > 0) { ctx.fillStyle = `rgba(255,230,190,${S.boomFlash * 1.4})`; ctx.fillRect(0, 0, W, H); }
    for (const b of S.birds) { // any bird that survives a hit wears its health over its head
      if (b.dead || b.hp >= b.maxHp) continue;
      const w = Math.max(34, b.r * 1.8), x = b.x - w / 2, y = b.y - b.r - 16, f = clamp(b.hp / b.maxHp, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.8)'; ctx.fillRect(x - 1, y - 1, w + 2, 7);
      ctx.fillStyle = f > 0.5 ? '#f2c14e' : '#ff3b3b'; ctx.fillRect(x, y, w * f, 5);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 6);
      if (b.stun > 0) { ctx.font = `800 10px ${BODY}`; ctx.fillStyle = '#9fd4ff'; ctx.fillText('STUNNED', b.x, y - 4); }
    }
    ctx.font = `22px ${DISPLAY}`;
    for (const p of S.pops) { // Fruit Butcher style: drop shadow straight down, then the colour
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = '#000'; ctx.fillText(p.text, p.x, p.y + 2); ctx.fillStyle = p.col; ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    if (S.banner) {
      ctx.globalAlpha = clamp(S.banner.life * 1.5, 0, 1);
      const by = H * 0.3, big = Math.round(clamp(W * 0.09, 52, 104));
      ctx.font = `${big}px ${DISPLAY}`;
      ctx.fillStyle = '#000'; ctx.fillText(S.banner.text, W / 2, by + 4);
      ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 30; ctx.fillStyle = '#ef3b45'; ctx.fillText(S.banner.text, W / 2, by); ctx.shadowBlur = 0;
      ctx.font = `800 15px ${BODY}`; ctx.letterSpacing = '4px';
      ctx.fillStyle = '#000'; ctx.fillText(S.banner.sub.toUpperCase(), W / 2, by + 34); ctx.fillStyle = '#f0c9c4'; ctx.fillText(S.banner.sub.toUpperCase(), W / 2, by + 32);
      ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1;
    }
    ctx.shadowBlur = 0;
    if (S.phase !== 'play') return;
    const x = S.mx, y = S.my;
    ctx.strokeStyle = '#ff3a2e'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 5, y + dy * 5); ctx.lineTo(x + dx * 14, y + dy * 14); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(233,226,208,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(x, y, 18, 0, TAU); ctx.stroke();
    if (S.dry > 0 || !hasAmmo()) {
      ctx.font = `800 12px ${BODY}`; const msg = otherGunWithAmmo() ? 'EMPTY · PRESS TAB' : 'OUT OF AMMO';
      ctx.fillStyle = '#000'; ctx.fillText(msg, x, y + 38); ctx.fillStyle = '#ff3b3b'; ctx.fillText(msg, x, y + 36);
    }
  }
  function otherGunWithAmmo() { return S.guns.some((st, i) => i !== S.gun && st.owned && S.ammo >= GUNS[i].use); }

  // ---------------------------------------------------------------------------
  // HUD: poop gauge, cash, ammo
  // ---------------------------------------------------------------------------
  const shown = {};
  const set = (id, text) => { if (shown[id] !== text) { shown[id] = text; $(id).textContent = text; } };
  function hud() {
    const playing = S.phase === 'play' || S.phase === 'clear';
    $('hud').hidden = !playing; $('storm').hidden = !playing; if (!playing) $('acidBtn').hidden = true; $('pauseBtn').hidden = S.phase !== 'play';
    if (!playing) return;
    set('covTxt', `${Math.round(S.cov)}/${S.cap}`);
    const frac = clamp(S.cov / S.cap, 0, 1), hpct = frac.toFixed(3);
    if (shown.cov !== hpct) { shown.cov = hpct; $('covBar').style.height = `calc((100% - 4px) * ${frac})`; }
    $('hud').classList.toggle('bad', frac >= 0.7);
    set('cash', `$${S.cash}`);
    const loaded = bulletGun(GUNS[S.gun]) && S.ammoType !== 'ball' ? ` · ${AMMO.find((a) => a.id === S.ammoType).name.toLowerCase()}` : '';
    if (shown.icon !== S.gun) { shown.icon = S.gun; $('gunIcon').innerHTML = GUNS[S.gun].icon; } // the gun in your hands, drawn above the ammo
    set('gunName', `${GUNS[S.gun].name.toLowerCase()}${loaded}`);
    set('ammo', `${Math.floor(S.ammo)}`);
    $('ammo').classList.toggle('empty', !hasAmmo());
    const sb = $('storm'), ready = S.stormReady && S.phase === 'play';
    sb.disabled = !ready; sb.classList.toggle('used', !S.stormReady);
    set('stormTxt', S.stormReady ? 'Lightning' : 'Next night');
    const ab = $('acidBtn');
    ab.hidden = !S.acidOwned; ab.disabled = !(S.acidReady && S.phase === 'play'); ab.classList.toggle('used', !S.acidReady && !S.acid);
    set('acidTxt', S.acid ? `${Math.ceil(S.acid.t)}s` : S.acidReady ? 'Acid Rain' : 'Next night');
  }

  // ---------------------------------------------------------------------------
  // Sound: short one-shots only, no ambient loops
  // ---------------------------------------------------------------------------
  const Snd = {
    ac: null, vol: 0.6,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = (this.ac = new AC());
      const buf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate), ch = buf.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      this.buf = buf;
      this.out = ac.createGain(); this.out.gain.value = this.vol; this.out.connect(ac.destination);
    },
    burst(dur, type, f0, f1, vol, delay = 0) {
      if (!this.ac || vol < 0.003) return;
      const ac = this.ac, t = ac.currentTime + delay, s = ac.createBufferSource(); s.buffer = this.buf;
      const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(fl).connect(g).connect(this.out); s.start(t, Math.random()); s.stop(t + dur);
    },
    osc(type, f0, f1, dur, vol, delay = 0) {
      if (!this.ac || vol < 0.003) return;
      const ac = this.ac, t = ac.currentTime + delay, o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.out); o.start(t); o.stop(t + dur + 0.05);
    },
    musket() { this.burst(0.35, 'lowpass', 1400, 100, 0.5); this.osc('sine', 120, 40, 0.3, 0.4); },
    shotgun() { this.burst(0.35, 'lowpass', 1800, 120, 0.6); this.osc('sine', 100, 35, 0.3, 0.45); },
    pump() { this.burst(0.3, 'lowpass', 1700, 120, 0.55); this.osc('sine', 110, 40, 0.25, 0.4); this.osc('square', 300, 280, 0.03, 0.04, 0.25); this.osc('square', 260, 240, 0.03, 0.04, 0.36); },
    smg() { this.burst(0.05, 'lowpass', 1600, 400, 0.25); this.osc('sine', 150, 70, 0.05, 0.2); },
    rocket() { this.osc('sawtooth', 120, 60, 0.4, 0.06); this.burst(0.4, 'lowpass', 800, 200, 0.25); },
    boom() { this.burst(1.4, 'lowpass', 900, 30, 1); this.osc('sine', 70, 22, 1.2, 0.7); this.burst(1.8, 'lowpass', 260, 30, 0.5, 0.15); },
    click() { this.osc('square', 600, 580, 0.02, 0.03); },
    empty() { this.osc('square', 300, 280, 0.02, 0.05); },
    thwack() { this.osc('sine', 300, 120, 0.08, 0.15); },
    squawk(p) { this.osc('triangle', 700 * p, 300 * p, 0.2, 0.08); this.osc('triangle', 520 * p, 260 * p, 0.15, 0.05, 0.06); },
    cash() { [1320, 1760].forEach((f, i) => this.osc('triangle', f, f, 0.12, 0.04, i * 0.06)); },
    splat() { this.burst(0.18, 'lowpass', 500, 90, 0.4); this.osc('sine', 200, 60, 0.15, 0.2); },
    thud() { this.osc('sine', 120, 50, 0.1, 0.12); },
    scrub() { this.osc('triangle', 500, 900, 0.15, 0.05); this.osc('triangle', 600, 1000, 0.15, 0.05, 0.15); },
    tesla() { this.osc('sawtooth', 1800, 200, 0.25, 0.07); this.osc('square', 2600, 500, 0.15, 0.03); this.osc('sine', 120, 50, 0.3, 0.3); },
    baby() { this.burst(0.12, 'lowpass', 1100, 150, 0.18); this.osc('sine', 180, 60, 0.1, 0.12); },
    beam(h) { // a low hum that climbs as the laser heats up. pure tone, no noise
      if (!this.ac) return;
      if (!this.hum) { const o = this.ac.createOscillator(), g = this.ac.createGain(); o.type = 'sine'; g.gain.value = 0; o.connect(g).connect(this.out); o.start(); this.hum = { o, g }; }
      this.hum.o.frequency.setTargetAtTime(160 + h * 140, this.ac.currentTime, 0.05); this.hum.g.gain.setTargetAtTime(0.035, this.ac.currentTime, 0.03); this.humOn = true;
    },
    beamOff() { if (this.hum && this.humOn) { this.hum.g.gain.setTargetAtTime(0, this.ac.currentTime, 0.03); this.humOn = false; } },
    zap() { this.osc('sawtooth', 1400, 300, 0.1, 0.04); },
    acid() { this.osc('sine', 220, 110, 0.6, 0.06); this.osc('sine', 330, 160, 0.8, 0.04, 0.15); },
    howl() { this.osc('triangle', 300, 520, 0.6, 0.05); this.osc('triangle', 520, 380, 1.2, 0.05, 0.6); }, // a cartoon wolf
    charge() { this.osc('sine', 200, 1400, 1.5, 0.05); }, // rises for the whole wind-up
    pop() { this.burst(0.15, 'lowpass', 900, 120, 0.25); },
    thunder() { this.osc('sawtooth', 2400, 200, 0.12, 0.05); this.burst(0.5, 'lowpass', 1600, 120, 0.9); this.burst(2.2, 'lowpass', 320, 35, 0.7, 0.18); this.osc('sine', 55, 28, 1.6, 0.45, 0.1); },
    clip(names) { const a = new Audio('sources/' + pick(names)); a.volume = 0.7; a.play().catch(() => {}); }, // sampled clips copied from Fruit Butcher
    fanfare() { this.clip(['Success2.mp3', 'Success3.mp3']); },
    bury() { this.clip(['Defeat1.mp3', 'Defeat2.mp3', 'Defeat3.mp3']); },
  };

  // music from Fruit Butcher (sources/): the main-screen song on the title and in the shop, and the four level tracks
  // taking turns, one per night. switching crossfades: the old track fades out while the new one fades in
  const Music = {
    on: false, cur: null, old: [],
    want() { return S.phase === 'play' || S.phase === 'clear' ? `music${((Math.max(1, S.night) - 1) % 4) + 1}.mp3` : 'main-screen.mp3'; },
    start() { this.on = true; },
    update() {
      if (!this.on) return;
      const file = this.want();
      if (!this.cur || this.cur.file !== file) {
        if (this.cur) this.old.push(this.cur);
        const el = new Audio('sources/' + file); el.loop = true; el.volume = 0; el.play().catch(() => {});
        this.cur = { file, el };
      }
      const target = S.paused ? 0.15 : S.phase === 'play' ? 0.4 : 0.45;
      this.cur.el.volume = clamp(this.cur.el.volume + (target - this.cur.el.volume) * 0.04, 0, 1);
      this.old = this.old.filter((o) => { o.el.volume = Math.max(0, o.el.volume - 0.02); if (o.el.volume <= 0.001) { o.el.pause(); return false; } return true; });
    },
  };

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  cv.addEventListener('pointermove', (e) => aimAt(e.clientX, e.clientY));
  cv.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || S.paused) return;
    aimAt(e.clientX, e.clientY); S.trigger = true;
    cv.setPointerCapture(e.pointerId);
    fire();
  });
  const release = () => { S.trigger = false; };
  cv.addEventListener('pointerup', release); cv.addEventListener('pointercancel', release);
  window.addEventListener('blur', () => { release(); pause(true); });
  window.addEventListener('keydown', (e) => {
    if (e.key === '`') { showDebug($('debug').hidden); return; }
    if ((e.key === 'Escape' || e.key === 'p' || e.key === 'P') && (S.phase === 'play' || S.paused)) { e.preventDefault(); pause(!S.paused); return; }
    if (S.paused) return;
    if (S.phase === 'shop' && e.key === 'Enter') { e.preventDefault(); startNight(); return; }
    if (S.phase !== 'play') return;
    const n = +e.key;
    if (n >= 1 && n <= GUNS.length) switchGun(n - 1);
    else if (e.key === 'Tab') { e.preventDefault(); for (let k = 1; k < GUNS.length; k++) { const i = (S.gun + k) % GUNS.length; if (S.guns[i].owned) { switchGun(i); break; } } }
    else if (e.key === 'q' || e.key === 'Q') lightning();
    else if (e.key === 'w' || e.key === 'W') acidRain();
    else if (e.key === 'e' || e.key === 'E') { // cycle through the bullet types you own
      const own = AMMO.filter((a) => S.ammoOwned[a.id]), i = own.findIndex((a) => a.id === S.ammoType);
      if (own.length > 1) { S.ammoType = own[(i + 1) % own.length].id; Snd.click(); pop(S.mx, S.my - 30, own[(i + 1) % own.length].name, own[(i + 1) % own.length].col, 0.9); }
    }
  });
  $('storm').addEventListener('click', lightning);
  $('acidBtn').addEventListener('click', acidRain);
  gate.addEventListener('click', () => { gate.hidden = true; Snd.init(); Music.start(); newGame(); startNight(); });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  window.addEventListener('resize', resize);
  resize();
  newGame(); S.phase = 'intro';
  if (location.hash.includes('debug')) window.__T = { S, G, D, GUNS, explode, fire, aimAt, startNight, clearNight, openShop, switchGun, lightning, pause, replayNight }; // for automated playtests
  const title = () => screen('Statue Poop Defender', 'The park, 02:40, under a red half moon. For forty years the pigeons have used you as a toilet. Tonight the bronze finger on the trigger finally moves. Shoot the birds before their droppings bury you. Mouse to aim, click to fire, 1–7 or Tab to change guns, E to change bullets, Q for lightning, Esc to pause.', 'click to pull the trigger');
  title();

  let last = performance.now(), T = 0;
  function frame(now) {
    const dt = S.paused ? 0 : Math.min(0.05, (now - last) / 1000) * (D.slow ? 0.35 : 1); last = now; T += dt;
    if (!S.paused) update(dt);
    if (S.phase !== 'play' || S.paused) S.beam = null; // no laser outside a running night
    if (!S.beam) Snd.beamOff();
    Music.update();
    drawSource(T);
    if (location.hash.includes('raw')) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(src, 0, 0, cv.width, cv.height); } else renderHaunt(T);
    renderGlitch(S.shake);
    drawOverlay();
    hud();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
