'use strict';
// The rules every phone and the server agree on: run speed, the pursuer, the runner's physics and the track. The track
// comes from a seed with a seeded random generator, so every phone builds the exact same one without sending it around.
// Units are tiles; y grows downwards. Loaded as a plain script in the browser (window.World) and with require() in Node.
(function (root) {
  const W = {};
  W.TICK = 1 / 120;          // physics step, seconds
  W.HEIGHT = 14;             // the track is 14 tiles tall; anyone who leaves it is gone
  W.PW = 0.8; W.PH = 1.2;    // runner box
  W.G = 70; W.MAX_VY = 26;   // gravity and terminal speed, tiles/s
  W.KICK = 3;                // push off the surface when flipping
  W.BUFFER = 0.15;           // a tap this early before landing still flips
  W.V0 = 7.5; W.VMAX = 14; W.ACCEL = 0.06;
  W.START_X = 2; W.START_Y = 10 - W.PH;

  // Everyone runs at the same speed, which creeps up through the race
  W.speed = t => Math.min(W.VMAX, W.V0 + W.ACCEL * Math.max(0, t));
  const TC = (W.VMAX - W.V0) / W.ACCEL;
  W.distance = t => {
    t = Math.max(0, t);
    return t < TC ? W.V0 * t + W.ACCEL * t * t / 2 : W.V0 * TC + W.ACCEL * TC * TC / 2 + W.VMAX * (t - TC);
  };
  // The pursuer runs a little slower than you, so it only catches runners who snag on walls. After 75s it speeds up
  // for good, so no race lasts much past two minutes.
  W.pursuerX = t => -10 + 0.93 * W.distance(t) + 0.05 * Math.max(0, t - 75) ** 2;

  // mulberry32: small, fast and the same on every JavaScript engine
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const lerp = (a, b, k) => a + (b - a) * k;

  // The track is a chain of bars that alternate between the low lane (stand on top, gravity down) and the high lane
  // (hang underneath, gravity up). Each bar starts before the previous one ends: that overlap is your window to flip.
  // Miss it and you run off the end into the void, or, where the bar ends in a wall, snag on it while the pursuer
  // closes in. Bars get shorter and windows tighter the further you go.
  W.track = seed => {
    const r = rng(seed);
    const solids = [{ x: -40, y: 10, w: 66, h: 1, low: true }];
    let cur = solids[0];

    function next() {
      const d = Math.min(1, cur.x / 2500);
      const low = !cur.low;
      const y = low ? 8 + Math.floor(r() * 4) : 2 + Math.floor(r() * 4);
      const gap = (low ? y - (cur.y + 1) : cur.y - (y + 1)) - W.PH;   // how far a flip carries you
      const overlap = Math.round(lerp(5, 2, d) + r() * 2);
      const carry = Math.sqrt(2 * Math.max(1, gap) / W.G) * W.VMAX;
      const run = lerp(9, 3, d) + r() * lerp(12, 6, d);
      const bar = { x: cur.x + cur.w - overlap, y, w: Math.ceil(overlap + carry + run), h: 1, low };
      // Sometimes the old bar ends in a wall instead of a drop, if the wall can't reach into the new bar's lane
      const wall = r() < lerp(0.5, 0.25, d);
      if (wall && gap - 2 >= W.PH + 0.6) {
        solids.push({ x: cur.x + cur.w - 1, y: cur.low ? cur.y - 2 : cur.y + 1, w: 1, h: 2, wall: true });
      }
      solids.push(bar);
      cur = bar;
    }

    return {
      solids,
      ensure(x) { while (cur.x < x) next(); },
    };
  };

  W.runner = () => ({ x: W.START_X, y: W.START_Y, vy: 0, g: 1, ground: true, stuck: false, want: null, alive: true });

  const hits = (x, y, s) => x < s.x + s.w - 1e-6 && x + W.PW > s.x + 1e-6 && y < s.y + s.h - 1e-6 && y + W.PH > s.y + 1e-6;

  // One physics step at race time t. Run right, stop at walls, fall towards whichever side gravity points at.
  W.step = (p, t, track) => {
    track.ensure(p.x + 80);
    if (p.want !== null) {
      if (p.ground) { p.g = -p.g; p.vy = W.KICK * p.g; p.ground = false; p.want = null; }
      else if (t - p.want > W.BUFFER) p.want = null;
    }
    let nx = p.x + W.speed(t) * W.TICK;
    p.stuck = false;
    for (const s of track.solids) {
      if (hits(nx, p.y, s)) { nx = Math.max(p.x, s.x - W.PW); p.stuck = true; }
    }
    p.x = nx;
    p.vy = Math.max(-W.MAX_VY, Math.min(W.MAX_VY, p.vy + W.G * p.g * W.TICK));
    let ny = p.y + p.vy * W.TICK;
    p.ground = false;
    for (const s of track.solids) {
      if (!hits(p.x, ny, s)) continue;
      if (p.vy > 0) { ny = s.y - W.PH; if (p.g > 0) p.ground = true; }
      else { ny = s.y + s.h; if (p.g < 0) p.ground = true; }
      p.vy = 0;
    }
    p.y = ny;
    return p.y < -3 || p.y > W.HEIGHT + 3 || p.x < W.pursuerX(t);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = W;
  else root.World = W;
})(this);
