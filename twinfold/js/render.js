/* TWINFOLD — renderer. Draws the simulation into a 640x352 pixel view that scrolls over bigger maps. */
(function (root) {
  'use strict';
  const E = root.Engine, T = E.T, VW = E.W, VH = E.H, TL = E.TILE;

  const C = {
    metal: '#282f4d', metalHi: '#3b456c', metalLo: '#1a1e33', metalEdge: '#5a679a', metalDeep: '#11131f', rivet: '#56639a',
    panel: '#d6dae8', panelHi: '#f6f7fc', panelLo: '#a3a9c2', panelSeam: '#b9bfd4',
    grate: '#5f6996', grateHi: '#7d88b8', acid: '#ff7a2e', acidDeep: '#9c2f0c', acidSurf: '#e2561c', acidHi: '#ffd28c',
    fizz: '#c4e6ff', laser: '#ff3b5c', laserCore: '#fff1f4',
    A: '#2ef2c4', A2: '#0e8c74', B: '#a878ff', B2: '#5530b8',
    power: '#ffcf5a', powerDim: '#3b3550', door: '#2a3050', doorHi: '#3c4570',
    body: '#efe9da', bodyLo: '#b8b09c', visor: '#171927',
    cube: '#c8cde0', cubeLo: '#868ca6', cubeHi: '#eef0f8'
  };
  // the underground volcano re-skins the same tile set
  const VOLC = {
    metal: '#2c2225', metalHi: '#47353a', metalLo: '#211a1c', metalEdge: '#7a5446', metalDeep: '#150f11', rivet: '#5d4441',
    panel: '#d9cdbf', panelHi: '#f4ebe0', panelLo: '#a59584', panelSeam: '#bdae9e',
    grate: '#7a5c52', grateHi: '#a07a66', acid: '#ff8a2a', acidDeep: '#8e1c06', acidSurf: '#ff5a14', acidHi: '#ffe08a',
    door: '#3a2a2a', doorHi: '#5a403a', powerDim: '#3f2c30'
  };
  const PC = [C.A, C.B], PC2 = [C.A2, C.B2];
  let P = C;

  let cv, ctx, bgCv, tileCv, lightCv, lctx;
  let parts = [], trails = [], acidTops = [], motes = [];
  let st = null, levelIdx = 0, MW = VW, MH = VH, BW = VW, BH = VH, deep = 0, volc = false;
  let cam = { x: 0, y: 0 }, shake = 0;
  const hash = (x, y) => (((x * 73856093) ^ (y * 19349663) ^ 0x5bd1e995) >>> 0);
  const rnd = (a, b) => a + Math.random() * (b - a);

  function init(canvas) {
    cv = canvas; ctx = cv.getContext('2d');
    cv.width = VW; cv.height = VH;
    ctx.imageSmoothingEnabled = false;
    bgCv = mk(VW, VH); tileCv = mk(VW, VH); lightCv = mk(VW, VH); lctx = lightCv.getContext('2d');
  }
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  /* ---------- static layers ---------- */
  function solidish(s, x, y) {
    const t = E.tileAt(s, x, y);
    return t === TL.METAL || t === TL.PANEL || t === TL.EMIT || t === TL.RECV || t === TL.VENT;
  }

  function buildStatic(s, idx) {
    st = s; levelIdx = idx; parts = []; trails = []; acidTops = []; motes = [];
    volc = s.theme === 'volcano';
    P = volc ? Object.assign({}, C, VOLC) : C;
    deep = volc ? (s.def.deep != null ? s.def.deep : 0.5) : 0;
    MW = s.cols * T; MH = s.rows * T;
    BW = Math.round(VW + (MW - VW) * 0.5); BH = Math.round(VH + (MH - VH) * 0.5);
    bgCv.width = BW; bgCv.height = BH;
    tileCv.width = MW; tileCv.height = MH;
    for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) if (E.tileAt(s, x, y) === TL.ACID && E.tileAt(s, x, y - 1) !== TL.ACID && x % 2 === 0) acidTops.push([x * T + 16, y * T + 6]);
    for (let i = 0; i < 54; i++) motes.push({ x: Math.random() * VW, y: Math.random() * VH, v: rnd(2, 7) * (volc ? 2.2 : 1), p: Math.random() * 6, a: rnd(0.08, 0.28) });
    const bg = bgCv.getContext('2d');
    if (volc) drawCave(bg, idx); else drawBackground(bg, idx);
    const g = tileCv.getContext('2d');
    g.clearRect(0, 0, MW, MH);
    for (let y = 0; y < s.rows; y++) for (let x = 0; x < s.cols; x++) {
      const t = E.tileAt(s, x, y);
      if (t === TL.METAL || t === TL.EMIT || t === TL.RECV) drawMetal(g, s, x, y);
      else if (t === TL.PANEL) drawPanel(g, s, x, y);
      else if (t === TL.GRATE) drawGrate(g, s, x, y);
      else if (t === TL.VENT) { drawMetal(g, s, x, y); drawVentBase(g, x, y); }
    }
    for (const em of s.emitters) drawEmitter(g, em);
    for (const r of s.receivers) drawReceiverBase(g, r);
    cam = { x: 0, y: 0 }; shake = 0;
  }
  function rebind(s) { st = s; }

  function drawBackground(g, idx) {
    const hue = 232 + idx * 2.2;
    const grd = g.createLinearGradient(0, 0, 0, BH);
    grd.addColorStop(0, `hsl(${hue},42%,6%)`);
    grd.addColorStop(1, `hsl(${hue + 18},38%,11%)`);
    g.fillStyle = grd; g.fillRect(0, 0, BW, BH);
    let seed = idx * 977 + 13;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 7 * BW / VW; i++) {
      const x = Math.floor(r() * BW), w = 10 + Math.floor(r() * 26), top = Math.floor(r() * 120);
      g.fillStyle = `hsla(${hue + 10},30%,${11 + r() * 5}%,1)`;
      g.fillRect(x, top, w, BH - top);
      g.fillStyle = `hsla(${hue + 14},45%,22%,0.7)`;
      for (let wy = top + 6; wy < BH; wy += 10) if (r() > 0.55) g.fillRect(x + 3, wy, Math.max(2, w - 6), 2);
    }
    for (let i = 0; i < 4 * BH / VH; i++) {
      const y = Math.floor(r() * BH), h = 4 + Math.floor(r() * 6);
      g.fillStyle = `hsla(${hue + 6},28%,10%,0.9)`;
      g.fillRect(0, y, BW, h);
      g.fillStyle = `hsla(${hue + 6},30%,15%,0.7)`;
      for (let x = Math.floor(r() * 20); x < BW; x += 20) g.fillRect(x, y, 2, h);
    }
    for (let i = 0; i < 3; i++) {
      const x = 60 + r() * (BW - 120), w = 30 + r() * 50, sk = 40 + r() * 80;
      const lg = g.createLinearGradient(0, 0, 0, BH);
      lg.addColorStop(0, `hsla(${hue + 30},80%,80%,0.07)`); lg.addColorStop(1, 'hsla(0,0%,100%,0)');
      g.fillStyle = lg; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w, 0); g.lineTo(x + w + sk, BH); g.lineTo(x + sk, BH); g.closePath(); g.fill();
    }
    g.fillStyle = 'rgba(160,170,255,0.035)';
    for (let x = 0; x < BW; x += 32) g.fillRect(x, 0, 1, BH);
    for (let y = 0; y < BH; y += 32) g.fillRect(0, y, BW, 1);
    const v = g.createRadialGradient(BW / 2, BH / 2, 80, BW / 2, BH / 2, Math.max(BW, BH) * 0.66);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,6,0.55)');
    g.fillStyle = v; g.fillRect(0, 0, BW, BH);
  }

  // volcanic cave: layered rock silhouettes, far magma glow; redder the deeper you go
  function drawCave(g, idx) {
    let seed = idx * 7919 + 101;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const grd = g.createLinearGradient(0, 0, 0, BH);
    grd.addColorStop(0, `hsl(${350 + deep * 8},${30 + deep * 20}%,${4 + deep * 2}%)`);
    grd.addColorStop(1, `hsl(${8 + deep * 6},${55 + deep * 25}%,${8 + deep * 7}%)`);
    g.fillStyle = grd; g.fillRect(0, 0, BW, BH);
    // far magma glow pools
    for (let i = 0; i < 3 + deep * 5; i++) {
      const x = r() * BW, y = BH * (0.55 + r() * 0.5), rad = 60 + r() * 160;
      const lg = g.createRadialGradient(x, y, 0, x, y, rad);
      lg.addColorStop(0, `rgba(255,${90 + Math.floor(r() * 60)},30,${0.10 + deep * 0.16})`); lg.addColorStop(1, 'rgba(255,80,20,0)');
      g.fillStyle = lg; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // three layers of jagged rock, far to near
    for (let layer = 0; layer < 3; layer++) {
      const l = 7 + layer * 3 + deep * 2;
      const col = `hsl(${355 + layer * 4},${22 + layer * 4}%,${l}%)`;
      const rim = `hsla(${14 + deep * 8},80%,${30 + deep * 15}%,${0.18 + layer * 0.08})`;
      // ceiling teeth
      g.fillStyle = col;
      let x = -10;
      while (x < BW + 10) {
        const w = 12 + r() * (40 - layer * 8), h = 10 + r() * (50 + layer * 30);
        g.beginPath(); g.moveTo(x, 0); g.lineTo(x + w * 0.5 + (r() - 0.5) * 8, h); g.lineTo(x + w, 0); g.closePath(); g.fill();
        x += w * (0.6 + r() * 0.5);
      }
      // floor spires + rim light
      x = -10;
      while (x < BW + 10) {
        const w = 14 + r() * (46 - layer * 10), h = 12 + r() * (60 + layer * 34), tip = x + w * 0.5 + (r() - 0.5) * 10;
        g.fillStyle = col;
        g.beginPath(); g.moveTo(x, BH); g.lineTo(tip, BH - h); g.lineTo(x + w, BH); g.closePath(); g.fill();
        g.fillStyle = rim; g.fillRect(Math.round(tip), Math.round(BH - h), 1, Math.round(h * 0.6));
        x += w * (0.55 + r() * 0.5);
      }
      // a few hanging columns in the mid layer on tall maps
      if (layer === 1) for (let i = 0; i < BW / 180; i++) {
        const cx = r() * BW, w = 10 + r() * 18;
        g.fillStyle = col; g.fillRect(Math.round(cx), 0, Math.round(w), BH);
        g.fillStyle = rim; g.fillRect(Math.round(cx + w - 1), 0, 1, BH);
      }
    }
    // embers baked in as faint specks
    for (let i = 0; i < BW * BH / 900; i++) {
      g.fillStyle = `rgba(255,${120 + Math.floor(r() * 100)},60,${0.05 + r() * 0.12})`;
      g.fillRect(Math.floor(r() * BW), Math.floor(r() * BH), 1, 1);
    }
    const v = g.createRadialGradient(BW / 2, BH / 2, 60, BW / 2, BH / 2, Math.max(BW, BH) * 0.7);
    v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(6,0,0,0.6)');
    g.fillStyle = v; g.fillRect(0, 0, BW, BH);
  }

  function drawMetal(g, s, x, y) {
    const X = x * T, Y = y * T;
    const up = solidish(s, x, y - 1), dn = solidish(s, x, y + 1), lf = solidish(s, x - 1, y), rt = solidish(s, x + 1, y);
    const isDeep = up && dn && lf && rt && solidish(s, x - 1, y - 1) && solidish(s, x + 1, y - 1) && solidish(s, x - 1, y + 1) && solidish(s, x + 1, y + 1);
    const h = hash(x, y);
    if (volc) {
      g.fillStyle = isDeep ? P.metalDeep : ['#2c2225', '#2f2427', '#291f22'][h % 3]; g.fillRect(X, Y, T, T);
      if (isDeep) {
        g.fillStyle = 'rgba(90,60,60,0.12)';
        if (h % 5 === 0) g.fillRect(X + (h >> 3) % 12, Y + (h >> 7) % 12, 3, 2);
        // magma veins appear deeper in the volcano
        if ((h >> 11) % 100 < 6 + deep * 22) {
          const len = 4 + (h >> 5) % 9, vx = X + (h >> 9) % 10, vy = Y + (h >> 13) % 12;
          g.fillStyle = `rgba(255,${80 + (h % 60)},20,${0.25 + deep * 0.35})`;
          for (let i = 0; i < len; i++) g.fillRect(vx + i, vy + Math.round(Math.sin(i * 0.9 + h) * 1.2), 1, 1);
        }
      } else {
        g.fillStyle = P.metalLo;
        if (h % 4 === 0) g.fillRect(X + 2 + h % 9, Y + 5 + (h >> 4) % 8, 4, 1);
        if (h % 7 === 0) g.fillRect(X + 4 + (h >> 3) % 7, Y + 2 + (h >> 6) % 10, 1, 3);
        g.fillStyle = 'rgba(120,90,80,0.18)'; if (h % 3 === 0) g.fillRect(X + (h >> 2) % 13, Y + (h >> 5) % 13, 2, 2);
      }
      if (!up) {
        g.fillStyle = P.metalHi; g.fillRect(X, Y, T, 3);
        g.fillStyle = P.metalEdge; g.fillRect(X, Y, T, 1);
        g.fillStyle = 'rgba(60,40,38,1)'; if (h % 2) g.fillRect(X + (h >> 4) % 12, Y + 1, 3, 1);
      }
      if (!dn) { g.fillStyle = '#140d0e'; g.fillRect(X, Y + T - 2, T, 2); }
      if (!lf) { g.fillStyle = P.metalHi; g.fillRect(X, Y, 1, T); }
      if (!rt) { g.fillStyle = '#1a1214'; g.fillRect(X + T - 1, Y, 1, T); }
      return;
    }
    g.fillStyle = isDeep ? C.metalDeep : C.metal; g.fillRect(X, Y, T, T);
    if (isDeep) {
      g.fillStyle = 'rgba(120,135,200,0.07)';
      if (x % 4 === 0) g.fillRect(X, Y, 1, T);
      if (y % 4 === 0) g.fillRect(X, Y, T, 1);
      if ((x + y) % 4 === 0 && h % 2) { g.fillStyle = 'rgba(120,135,200,0.12)'; g.fillRect(X + 7, Y + 7, 2, 2); }
    } else {
      g.fillStyle = C.metalLo;
      if (x % 2 === 0) g.fillRect(X, Y, 1, T);
      if (y % 2 === 0) g.fillRect(X, Y, T, 1);
      if (x % 2 === 0 && y % 2 === 0 && h % 3 === 0) { g.fillStyle = C.rivet; g.fillRect(X + 3, Y + 3, 1, 1); g.fillRect(X + 12, Y + 3, 1, 1); }
    }
    if (!up) { g.fillStyle = C.metalHi; g.fillRect(X, Y, T, 3); g.fillStyle = C.metalEdge; g.fillRect(X, Y, T, 1); }
    if (!dn) { g.fillStyle = '#10121f'; g.fillRect(X, Y + T - 2, T, 2); }
    if (!lf) { g.fillStyle = C.metalHi; g.fillRect(X, Y, 1, T); }
    if (!rt) { g.fillStyle = '#141729'; g.fillRect(X + T - 1, Y, 1, T); }
  }

  function drawPanel(g, s, x, y) {
    const X = x * T, Y = y * T;
    g.fillStyle = P.panel; g.fillRect(X, Y, T, T);
    g.fillStyle = P.panelHi; g.fillRect(X, Y, T, 1); g.fillRect(X, Y, 1, T);
    g.fillStyle = P.panelSeam; g.fillRect(X, Y + T - 1, T, 1); g.fillRect(X + T - 1, Y, 1, T);
    g.fillStyle = P.panelLo; g.fillRect(X + 7, Y + 7, 2, 2);
    if (volc) { const h = hash(x, y); g.fillStyle = 'rgba(150,130,110,0.35)'; g.fillRect(X + 2 + h % 10, Y + 3 + (h >> 4) % 9, 2, 1); g.fillRect(X + 3 + (h >> 6) % 9, Y + 10 + (h >> 9) % 4, 1, 1); }
    g.fillStyle = 'rgba(120,255,230,0.38)';
    if (!solidish(s, x, y - 1)) g.fillRect(X + 1, Y, T - 2, 1);
    if (!solidish(s, x, y + 1)) g.fillRect(X + 1, Y + T - 1, T - 2, 1);
    if (!solidish(s, x - 1, y)) g.fillRect(X, Y + 1, 1, T - 2);
    if (!solidish(s, x + 1, y)) g.fillRect(X + T - 1, Y + 1, 1, T - 2);
  }

  function drawGrate(g, s, x, y) {
    const X = x * T, Y = y * T;
    g.fillStyle = volc ? 'rgba(30,16,14,0.35)' : 'rgba(20,24,44,0.35)'; g.fillRect(X, Y, T, T);
    g.fillStyle = P.grate;
    for (let i = 1; i < T; i += 4) g.fillRect(X + i, Y, 1, T);
    for (let i = 1; i < T; i += 4) g.fillRect(X, Y + i, T, 1);
    const tg = E.tileAt(s, x, y - 1) === TL.GRATE, bg = E.tileAt(s, x, y + 1) === TL.GRATE;
    g.fillStyle = P.grateHi;
    if (!tg) g.fillRect(X, Y, T, 2);
    if (!bg) g.fillRect(X, Y + T - 1, T, 1);
  }

  function drawVentBase(g, x, y) {
    const X = x * T, Y = y * T;
    g.fillStyle = '#120a0a'; g.fillRect(X + 3, Y, 10, 5);
    g.fillStyle = '#5a2a1c'; g.fillRect(X + 4, Y + 1, 8, 3);
    g.fillStyle = '#ff6a1a'; g.fillRect(X + 6, Y + 2, 4, 1);
    g.fillStyle = '#4a3634'; g.fillRect(X + 1, Y, 2, 3); g.fillRect(X + 13, Y, 2, 3);
  }

  function drawEmitter(g, em) {
    const cx = em.x * T + 8 + em.d[0] * 6, cy = em.y * T + 8 + em.d[1] * 6;
    g.fillStyle = '#0d0f1b'; g.fillRect(cx - 4, cy - 4, 8, 8);
    g.fillStyle = '#3a1520'; g.fillRect(cx - 3, cy - 3, 6, 6);
    g.fillStyle = C.laser; g.fillRect(cx - 2, cy - 2, 4, 4);
    g.fillStyle = C.laserCore; g.fillRect(cx - 1, cy - 1, 2, 2);
  }
  function drawReceiverBase(g, r) {
    const X = r.x * T, Y = r.y * T;
    g.fillStyle = '#0d0f1b'; g.fillRect(X + 3, Y + 3, 10, 10);
    g.fillStyle = P.metalEdge; g.fillRect(X + 2, Y + 2, 12, 1); g.fillRect(X + 2, Y + 13, 12, 1); g.fillRect(X + 2, Y + 2, 1, 12); g.fillRect(X + 13, Y + 2, 1, 12);
  }

  /* ---------- particles ---------- */
  function burst(x, y, n, color, sp = 60, life = 0.6, grav = 0, size = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = rnd(sp * 0.3, sp);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rnd(life * 0.5, life), max: life, color, grav, size });
    }
  }
  function spray(x, y, nx, ny, n, color, sp = 80, life = 0.5) {
    for (let i = 0; i < n; i++) {
      const tx = -ny, ty = nx, t = rnd(-1, 1), v = rnd(sp * 0.4, sp);
      parts.push({ x: x + tx * t * 12, y: y + ty * t * 12, vx: nx * v + tx * rnd(-20, 20), vy: ny * v + ty * rnd(-20, 20), life: rnd(life * 0.4, life), max: life, color, grav: 0, size: 1 });
    }
  }
  const LAVA_COLS = ['#ffd27a', '#ff8a2a', '#ff5a14', '#c2300c'];
  function lavaSplash(x, y, n, up) {
    for (let i = 0; i < n; i++) parts.push({ x: x + rnd(-8, 8), y, vx: rnd(-60, 60), vy: rnd(-200, -60) * (up ? 1.2 : 0.8), life: rnd(0.4, 0.8), max: 0.8, color: LAVA_COLS[i % 4], grav: 600, size: i % 3 ? 1 : 2 });
  }

  function onEvent(ev) {
    switch (ev.t) {
      case 'shot': {
        const n = Math.max(4, Math.floor(Math.hypot(ev.x1 - ev.x0, ev.y1 - ev.y0) / 7));
        for (let i = 0; i < n; i++) {
          const k = i / n;
          parts.push({ x: ev.x0 + (ev.x1 - ev.x0) * k, y: ev.y0 + (ev.y1 - ev.y0) * k, vx: rnd(-6, 6), vy: rnd(-6, 6), life: 0.18 + k * 0.22, max: 0.4, color: PC[ev.c], grav: 0, size: 1 });
        }
        if (!ev.ok) burst(ev.x1, ev.y1, 8, ev.fizz ? C.fizz : '#8d93b0', 50, 0.35);
        break;
      }
      case 'portal': spray(ev.x, ev.y, ev.n[0], ev.n[1], 26, PC[ev.c], 90, 0.6); break;
      case 'close': spray(ev.x, ev.y, ev.n[0], ev.n[1], 12, PC[ev.c], 40, 0.5); if (ev.sink) lavaSplash(ev.x, ev.y, 10, true); break;
      case 'tp': burst(ev.x, ev.y, ev.who === 'player' ? 16 : 8, PC[ev.c], 70, 0.45); break;
      case 'land': if (ev.v > 260) for (let i = 0; i < 6; i++) parts.push({ x: ev.x + rnd(-5, 5), y: ev.y - 1, vx: rnd(-40, 40), vy: rnd(-30, -5), life: 0.3, max: 0.3, color: volc ? '#7a5a50' : '#6c7396', grav: 200, size: 1 }); break;
      case 'jump': for (let i = 0; i < 3; i++) parts.push({ x: ev.x + rnd(-3, 3), y: ev.y - 1, vx: rnd(-20, 20), vy: rnd(-10, 0), life: 0.2, max: 0.2, color: volc ? '#6a4a44' : '#59607f', grav: 100, size: 1 }); break;
      case 'die': {
        shake = Math.max(shake, 5);
        burst(ev.x, ev.y, 40, C.body, 90, 0.9, 120, 2);
        const col = { laser: C.laser, shark: '#ff5a14', eaten: '#ff3a1a', fire: '#ffb347', spike: '#a08070' }[ev.cause] || P.acid;
        burst(ev.x, ev.y, 18, col, 70, 0.8, 60);
        if (ev.cause === 'acid' && volc) lavaSplash(ev.x, ev.y, 16, true);
        break;
      }
      case 'cubeGone': burst(ev.x, ev.y, 22, C.cube, 50, 0.7, -20, 1); break;
      case 'cubeBack': burst(ev.x, ev.y, 14, C.power, 30, 0.5); break;
      case 'win': burst(ev.x, ev.y, 30, '#fff3d6', 50, 1.0, -30); break;
      case 'fizzle': { const pl = st.player; burst(pl.x + 5, pl.y + 9, 14, C.fizz, 40, 0.5); break; }
      case 'recv': if (ev.on) burst(ev.x, ev.y, 10, C.laser, 40, 0.5); break;
      case 'crack': for (let i = 0; i < 5; i++) parts.push({ x: ev.x + rnd(-7, 7), y: ev.y + 1, vx: rnd(-15, 15), vy: rnd(-20, 0), life: 0.4, max: 0.4, color: '#8a6a52', grav: 300, size: 1 }); break;
      case 'crumble': shake = Math.max(shake, 1.5); for (let i = 0; i < 12; i++) parts.push({ x: ev.x + rnd(-7, 7), y: ev.y + rnd(-7, 7), vx: rnd(-30, 30), vy: rnd(-40, 10), life: rnd(0.5, 0.9), max: 0.9, color: i % 2 ? '#6e5240' : '#4a382c', grav: 700, size: i % 3 ? 1 : 2 }); break;
      case 'reform': burst(ev.x, ev.y, 6, '#8a6a52', 20, 0.4); break;
      case 'splash': lavaSplash(ev.x, ev.y, ev.up ? 14 : 9, ev.up); break;
      case 'shatter': shake = Math.max(shake, 1.5); for (let i = 0; i < 10; i++) parts.push({ x: ev.x + rnd(-3, 3), y: ev.y - rnd(0, 6), vx: rnd(-60, 60), vy: rnd(-90, -20), life: 0.6, max: 0.6, color: i % 2 ? '#9a8070' : '#5a4038', grav: 600, size: i % 3 ? 1 : 2 }); break;
      case 'spikeShake': for (let i = 0; i < 4; i++) parts.push({ x: ev.x + rnd(-4, 4), y: ev.y + 1, vx: rnd(-5, 5), vy: rnd(10, 30), life: 0.5, max: 0.5, color: '#7a6050', grav: 300, size: 1 }); break;
      case 'vent': shake = Math.max(shake, 0.6); break;
      case 'monDie': burst(ev.x, ev.y, 26, '#3a2420', 60, 0.8, 160, 2); burst(ev.x, ev.y, 14, '#ff5a1a', 50, 0.6, 40); break;
      case 'growl': burst(ev.x, ev.y - 6, 6, '#ff3a1a', 25, 0.4); break;
      case 'checkpoint': burst(ev.x, ev.y, 24, '#ffcf5a', 50, 0.8, -40); break;
      case 'gun': burst(ev.x, ev.y, 30, ev.gun >= 2 ? C.B : C.A, 60, 0.9, -30); break;
      case 'rumble': shake = Math.max(shake, 3); break;
      case 'sizzle': burst(ev.x, ev.y, 10, '#ddd', 30, 0.7, -60); break;
    }
  }

  function vis() { // visible tile range
    return [Math.max(0, Math.floor(cam.x / T) - 1), Math.max(0, Math.floor(cam.y / T) - 1),
      Math.min(st.cols - 1, Math.floor((cam.x + VW) / T) + 1), Math.min(st.rows - 1, Math.floor((cam.y + VH) / T) + 1)];
  }

  function updateParts(dt, s) {
    for (const p of parts) { p.life -= dt; p.vy += p.grav * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    parts = parts.filter(p => p.life > 0);
    if (parts.length > 1200) parts.splice(0, parts.length - 1200);
    for (const p of s.portals) {
      if (!p || Math.random() > dt * 14) continue;
      const t = rnd(-14, 14);
      const x = p.n[1] ? p.px + t : p.px, y = p.n[1] ? p.py : p.py + t;
      parts.push({ x, y, vx: p.n[0] * rnd(8, 26), vy: p.n[1] * rnd(8, 26), life: 0.6, max: 0.6, color: PC[p.c], grav: 0, size: 1 });
    }
    const [x0, y0, x1, y1] = vis();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = E.tileAt(s, x, y);
      if (t === TL.ACID && E.tileAt(s, x, y - 1) !== TL.ACID && Math.random() < dt * (volc ? 1.6 : 0.9))
        parts.push({ x: x * T + rnd(2, 14), y: y * T + 5, vx: rnd(-4, 4), vy: rnd(-26, -10) * (volc ? 1.6 : 1), life: 0.6, max: 0.6, color: P.acidHi, grav: 30, size: 1 });
      else if (t === TL.FIZZ && Math.random() < dt * 2.2)
        parts.push({ x: x * T + rnd(5, 11), y: y * T + rnd(0, 16), vx: 0, vy: rnd(-14, 14), life: 0.7, max: 0.7, color: C.fizz, grav: 0, size: 1 });
    }
    if (isFinite(s.lavaY) && s.lavaY < cam.y + VH + 8 && Math.random() < dt * 30)
      parts.push({ x: cam.x + Math.random() * VW, y: s.lavaY + 2, vx: rnd(-6, 6), vy: rnd(-60, -20), life: 0.8, max: 0.8, color: LAVA_COLS[Math.floor(Math.random() * 3)], grav: 60, size: 1 });
    for (const v of s.vents) {
      if (v.warn && Math.random() < dt * 30) parts.push({ x: v.x * T + rnd(5, 11), y: v.y * T, vx: rnd(-10, 10), vy: rnd(-90, -30), life: 0.4, max: 0.4, color: LAVA_COLS[Math.floor(Math.random() * 3)], grav: 200, size: 1 });
      if (v.on && Math.random() < dt * 60) parts.push({ x: v.x * T + rnd(3, 13), y: v.top + rnd(0, v.y * T - v.top), vx: rnd(-20, 20), vy: rnd(-120, -40), life: 0.5, max: 0.5, color: LAVA_COLS[Math.floor(Math.random() * 2)], grav: -50, size: 1 });
    }
    for (const r of s.receivers) if (r.on && Math.random() < dt * 6)
      parts.push({ x: r.x * T + 8, y: r.y * T + 8, vx: rnd(-20, 20), vy: rnd(-20, 20), life: 0.4, max: 0.4, color: C.laser, grav: 0, size: 1 });
    for (const f of s.flags) if (f.on && Math.random() < dt * 14)
      parts.push({ x: f.x * T + rnd(5, 11), y: f.y * T + 4, vx: rnd(-5, 5), vy: rnd(-40, -20), life: 0.6, max: 0.6, color: Math.random() < 0.5 ? '#ffcf5a' : '#ff7a2a', grav: -10, size: 1 });
    if (s.exitOpen && s.exit && Math.random() < dt * 5)
      parts.push({ x: s.exit.x * T + rnd(4, 12), y: s.exit.y * T + 14, vx: rnd(-3, 3), vy: rnd(-18, -8), life: 1.2, max: 1.2, color: '#ffe9b8', grav: 0, size: 1 });
    const pl = s.player, sp = Math.hypot(pl.vx, pl.vy);
    if (!s.dead && sp > 260) trails.push({ x: pl.x, y: pl.y, life: 0.22, c: s.lastTp != null ? s.lastTp : 0 });
    for (const t of trails) t.life -= dt;
    trails = trails.filter(t => t.life > 0);
  }

  /* ---------- dynamic drawing ---------- */
  function drawWires(s, time) {
    const targets = (ch) => {
      const out = [];
      for (const d of s.doors) if (d.ch === ch) out.push([d.x * T + 8, d.y * T + 8]);
      if (s.exit && s.exit.ch === ch) out.push([s.exit.x * T + 8, (s.exit.y - 1) * T + 2]);
      return out;
    };
    const srcs = [];
    for (const b of s.buttons) srcs.push({ ch: b.ch, x: (b.x0 + b.x1 + 1) * T / 2, y: b.y * T + 15, on: b.on });
    for (const r of s.receivers) srcs.push({ ch: r.ch, x: r.x * T + 8, y: r.y * T + 8, on: r.on });
    for (const sr of srcs) {
      const tg = targets(sr.ch);
      if (!tg.length) continue;
      const tx = tg.reduce((a, b) => a + b[0], 0) / tg.length, ty = tg.reduce((a, b) => a + b[1], 0) / tg.length;
      const pts = [[sr.x, sr.y], [sr.x, ty], [tx, ty]];
      let dist = 0;
      for (let i = 0; i < 2; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
        const len = Math.abs(x1 - x0) + Math.abs(y1 - y0);
        for (let d = 0; d < len; d += 4) {
          const k = d / (len || 1), x = Math.round(x0 + (x1 - x0) * k), y = Math.round(y0 + (y1 - y0) * k);
          if (x < cam.x - 4 || x > cam.x + VW + 4 || y < cam.y - 4 || y > cam.y + VH + 4) continue;
          const pulse = sr.on && ((dist + d - time * 60) % 40 + 40) % 40 < 6;
          ctx.fillStyle = sr.on ? (pulse ? '#fff4cf' : C.power) : P.powerDim;
          ctx.globalAlpha = sr.on ? 0.75 : 0.55;
          ctx.fillRect(x - 1, y - 1, 2, 2);
        }
        dist += len;
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawAcidAndFizz(s, time) {
    const [x0, y0, x1, y1] = vis();
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const t = E.tileAt(s, x, y), X = x * T, Y = y * T;
      if (t === TL.ACID) {
        const surface = E.tileAt(s, x, y - 1) !== TL.ACID;
        const grd = ctx.createLinearGradient(0, Y, 0, Y + T);
        grd.addColorStop(0, surface ? P.acidSurf : P.acidDeep); grd.addColorStop(1, P.acidDeep);
        ctx.fillStyle = grd;
        if (surface) {
          for (let i = 0; i < T; i++) {
            const h = 4 + Math.round(Math.sin(time * 2.4 + (X + i) * 0.22) * 1.5 + Math.sin(time * 1.3 + (X + i) * 0.07));
            ctx.fillRect(X + i, Y + h, 1, T - h);
            ctx.fillStyle = P.acid; ctx.fillRect(X + i, Y + h, 1, 1);
            if ((X + i + Math.floor(time * 8)) % 11 === 0) { ctx.fillStyle = P.acidHi; ctx.fillRect(X + i, Y + h, 1, 1); }
            ctx.fillStyle = grd;
          }
        } else {
          ctx.fillRect(X, Y, T, T);
          if (volc) { // slow-moving crust and bright seams
            const hh = hash(x, y);
            ctx.fillStyle = 'rgba(255,200,90,0.25)';
            const o = Math.floor(time * 6 + hh) % T;
            ctx.fillRect(X + o, Y + (hh % 12), 3, 1);
            ctx.fillStyle = 'rgba(60,10,4,0.35)'; ctx.fillRect(X + ((hh >> 3) + Math.floor(time * 3)) % 13, Y + 3 + (hh >> 6) % 9, 3, 2);
          }
        }
      } else if (t === TL.FIZZ) {
        ctx.fillStyle = 'rgba(170,215,255,0.07)'; ctx.fillRect(X + 4, Y, 8, T);
        ctx.fillStyle = 'rgba(200,235,255,0.35)';
        ctx.fillRect(X + 7, Y, 1, T);
        for (let k = 0; k < 3; k++) {
          const yy = Math.floor(((time * 22 + k * 37 + x * 13 + y * 16) % T + T) % T);
          ctx.fillRect(X + 5 + ((k * 3 + y) % 6), Y + yy, 1, 2);
        }
        ctx.fillStyle = '#6e7bb0';
        if (E.solidTile(s, x, y - 1)) ctx.fillRect(X + 4, Y, 8, 2);
        if (E.solidTile(s, x, y + 1)) ctx.fillRect(X + 4, Y + T - 2, 8, 2);
      }
    }
  }

  function drawRisingLava(s, time) {
    if (!isFinite(s.lavaY) || s.lavaY > cam.y + VH + 8) return;
    const top = s.lavaY, bot = Math.min(MH, cam.y + VH + 2);
    const grd = ctx.createLinearGradient(0, top, 0, top + 120);
    grd.addColorStop(0, '#ff6a14'); grd.addColorStop(0.25, '#d8380c'); grd.addColorStop(1, '#6e1204');
    ctx.fillStyle = grd;
    const x0 = Math.floor(cam.x / 2) * 2 - 2;
    for (let x = x0; x < cam.x + VW + 2; x += 2) {
      const h = Math.round(Math.sin(time * 2.1 + x * 0.05) * 2 + Math.sin(time * 3.7 + x * 0.13) * 1.2);
      ctx.fillRect(x, top + h, 2, bot - top - h);
    }
    for (let x = x0; x < cam.x + VW + 2; x += 2) {
      const h = Math.round(Math.sin(time * 2.1 + x * 0.05) * 2 + Math.sin(time * 3.7 + x * 0.13) * 1.2);
      ctx.fillStyle = ((x + Math.floor(time * 20)) % 26) < 4 ? '#fff0b0' : '#ffb347';
      ctx.fillRect(x, top + h, 2, 1);
    }
    // drifting crust plates
    for (let i = 0; i < 18; i++) {
      const px = ((i * 211 + time * (8 + (i % 4) * 3)) % (VW + 60)) + cam.x - 30, py = top + 10 + (i * 37) % Math.max(12, bot - top - 10);
      if (py > bot) continue;
      ctx.fillStyle = 'rgba(70,14,6,0.55)'; ctx.fillRect(Math.round(px), Math.round(py), 6 + (i % 5) * 2, 2);
      ctx.fillStyle = 'rgba(255,200,100,0.35)'; ctx.fillRect(Math.round(px) - 1, Math.round(py) - 1, 2, 1);
    }
  }

  function drawCrumbs(s, time) {
    for (const c of s.crumbs) {
      const X = c.x * T, Y = c.y * T;
      if (X > cam.x + VW || X + T < cam.x || Y > cam.y + VH || Y + T < cam.y) continue;
      if (c.st === 2) {
        const k = c.t / E.PH.crumbleBack;
        ctx.fillStyle = `rgba(160,120,90,${0.08 + k * 0.2})`;
        for (let i = 0; i < T; i += 3) { ctx.fillRect(X + i, Y, 1, 1); ctx.fillRect(X + i, Y + T - 1, 1, 1); ctx.fillRect(X, Y + i, 1, 1); ctx.fillRect(X + T - 1, Y + i, 1, 1); }
        continue;
      }
      const sh = c.st === 1 ? Math.round(Math.sin(time * 90 + c.x) * 1) : 0;
      const x = X + sh;
      ctx.fillStyle = '#5c4535'; ctx.fillRect(x, Y, T, T);
      ctx.fillStyle = '#7a5c46'; ctx.fillRect(x, Y, T, 2);
      ctx.fillStyle = '#9a7656'; ctx.fillRect(x, Y, T, 1);
      ctx.fillStyle = '#3e2e24';
      ctx.fillRect(x + 4, Y + 2, 1, 5); ctx.fillRect(x + 5, Y + 7, 3, 1); ctx.fillRect(x + 8, Y + 8, 1, 4); ctx.fillRect(x + 11, Y + 3, 1, 3); ctx.fillRect(x + 2, Y + 11, 4, 1);
      ctx.fillStyle = '#2a1e18'; ctx.fillRect(x, Y + T - 2, T, 2);
      if (c.st === 1) {
        const k = c.t / E.PH.crumbleT;
        ctx.fillStyle = `rgba(255,160,80,${0.3 + k * 0.6})`;
        ctx.fillRect(x + 4, Y + 2, 1, 5); ctx.fillRect(x + 5, Y + 7, 3, 1); ctx.fillRect(x + 8, Y + 8, 1, 4);
        if (k > 0.5) { ctx.fillRect(x + 11, Y + 3, 1, 3); ctx.fillRect(x + 2, Y + 11, 4, 1); }
      }
    }
  }

  function drawVents(s, time) {
    for (const v of s.vents) {
      const X = v.x * T, Y = v.y * T;
      if (X > cam.x + VW + T || X + T < cam.x - T) continue;
      if (v.warn) {
        const a = 0.4 + 0.4 * Math.sin(time * 30);
        ctx.fillStyle = `rgba(255,140,40,${a})`; ctx.fillRect(X + 5, Y - 2, 6, 2);
      }
      if (!v.on) continue;
      const top = v.top, h = Y - top, k = v.k;
      for (let yy = 0; yy < h; yy += 2) {
        const f = yy / h, w = Math.round((8 - f * 3 + Math.sin(time * 40 + yy * 0.7) * 1.5) * k);
        const y = Y - yy - 2;
        ctx.fillStyle = f < 0.3 ? '#fff2b0' : f < 0.6 ? '#ffb347' : f < 0.85 ? '#ff6a14' : '#c2300c';
        ctx.fillRect(X + 8 - w, y, w * 2, 2);
        ctx.fillStyle = 'rgba(255,255,220,0.8)'; if (f < 0.7) ctx.fillRect(X + 7 + Math.round(Math.sin(time * 50 + yy) * 1), y, 2, 2);
      }
    }
  }

  function drawSpikes(s, time) {
    for (const k of s.spikes) {
      if (k.st === 3 && k.t < E.PH.spikeRegrow - 0.6) continue;
      const grow = k.st === 3 ? (k.t - (E.PH.spikeRegrow - 0.6)) / 0.6 : 1;
      let x = Math.round(k.x), y = Math.round(k.y);
      if (k.st === 1) x += Math.round(Math.sin(time * 80) * 1);
      if (k.st === 3) y = Math.round(k.hy);
      const h = Math.round(12 * grow);
      for (let i = 0; i < h; i++) {
        const w = Math.max(1, Math.round(8 * (1 - i / 12)));
        const o = Math.round((8 - w) / 2);
        ctx.fillStyle = i < 2 ? '#3a2a26' : '#6e564a';
        ctx.fillRect(x + o, y + i, w, 1);
        ctx.fillStyle = '#9a8070'; ctx.fillRect(x + o, y + i, 1, 1);
      }
      if (k.st === 2) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + 3, y - 6, 1, 5); }
    }
  }

  function drawSharks(s, time) {
    for (const sh of s.sharks) {
      if (sh.dead) continue;
      const x = Math.round(sh.x), y = Math.round(sh.y), f = sh.face || 1;
      if (sh.mode === 'swim') {
        // dorsal fin cutting the surface + a wake
        const fx = x + 6 + Math.round(Math.sin(sh.t * 6) * 0.5);
        const sy = y - 2;
        ctx.fillStyle = '#1a0c0a';
        for (let i = 0; i < 6; i++) { const w = 6 - i; ctx.fillRect(fx - (f > 0 ? w - 1 : 0) - (f > 0 ? 0 : 0), sy - i, w, 1); }
        ctx.fillStyle = '#ff7a2a'; ctx.fillRect(fx - (f > 0 ? 0 : 0), sy - 5, 1, 4);
        ctx.fillStyle = 'rgba(255,230,140,0.8)';
        ctx.fillRect(fx - f * 6 + Math.round(Math.sin(time * 9) * 1), sy + 1, 3, 1);
        ctx.fillRect(fx - f * 10, sy + 1, 2, 1);
        // eyes glow under the surface when it is close to striking
        if (sh.cd <= 0) { ctx.fillStyle = `rgba(255,240,120,${0.5 + 0.5 * Math.sin(time * 12)})`; ctx.fillRect(x + (f > 0 ? 10 : 1), y + 3, 1, 1); }
        continue;
      }
      // leaping: full body, nose up
      const up = sh.vy < 0;
      ctx.save();
      ctx.translate(x + 6, y + 4);
      if (up) ctx.rotate(-Math.PI / 2 * f * 0.8); else ctx.rotate(Math.PI / 2 * f * 0.6);
      ctx.fillStyle = '#1a0c0a'; ctx.fillRect(-9, -4, 18, 9);
      ctx.fillStyle = '#2e1410'; ctx.fillRect(-9, -4, 18, 2);
      ctx.fillStyle = '#ff5a14'; ctx.fillRect(-7, -1, 2, 1); ctx.fillRect(-3, 0, 3, 1); ctx.fillRect(2, -2, 2, 1);
      ctx.fillStyle = '#1a0c0a'; ctx.fillRect(-13 * f, -5, 4, 3); ctx.fillRect(-13 * f, 3, 4, 3); // tail
      ctx.fillRect(-2, -8, 4, 4); // fin
      // jaws
      ctx.fillStyle = '#ffeec0';
      const jx = f > 0 ? 7 : -9;
      ctx.fillRect(jx, -2, 2, 1); ctx.fillRect(jx, 2, 2, 1);
      ctx.fillStyle = '#ff2a10'; ctx.fillRect(jx, -1, 2, 3);
      ctx.fillStyle = '#fff3a0'; ctx.fillRect(f > 0 ? 4 : -5, -3, 1, 1);
      ctx.restore();
    }
  }

  function drawMons(s, time) {
    for (const m of s.mons) {
      if (m.dead) continue;
      const x = Math.round(m.x), y = Math.round(m.y), f = m.face;
      const stp = m.ground && Math.abs(m.vx) > 6 ? Math.floor(m.walk / 4) % 4 : 0;
      const bob = stp % 2;
      // legs
      ctx.fillStyle = '#1c1210';
      ctx.fillRect(x + 1 + (stp === 1 ? 1 : 0), y + 11, 3, 3); ctx.fillRect(x + 8 - (stp === 3 ? 1 : 0), y + 11, 3, 3);
      // hunched body of cooled magma
      ctx.fillStyle = '#2a1a16'; ctx.fillRect(x, y + 3 + bob, 12, 9);
      ctx.fillStyle = '#3a2420'; ctx.fillRect(x + 1, y + 2 + bob, 10, 3);
      ctx.fillStyle = '#4e302a'; ctx.fillRect(x + 2, y + 2 + bob, 6, 1);
      // glowing cracks
      const glow = m.aggro ? 0.8 + 0.2 * Math.sin(time * 14) : 0.35;
      ctx.fillStyle = `rgba(255,${m.aggro ? 90 : 120},30,${glow})`;
      ctx.fillRect(x + 3, y + 6 + bob, 1, 3); ctx.fillRect(x + 4, y + 8 + bob, 3, 1); ctx.fillRect(x + 8, y + 5 + bob, 1, 2);
      // head and maw on the facing side
      const hx = f > 0 ? x + 8 : x - 2;
      ctx.fillStyle = '#2a1a16'; ctx.fillRect(hx, y + 4 + bob, 6, 6);
      ctx.fillStyle = m.aggro ? '#ff2a10' : '#5a1a10'; ctx.fillRect(f > 0 ? hx + 2 : hx, y + 8 + bob, 4, 2);
      ctx.fillStyle = '#ffeec0'; ctx.fillRect(f > 0 ? hx + 2 : hx, y + 8 + bob, 1, 1); ctx.fillRect(f > 0 ? hx + 4 : hx + 2, y + 8 + bob, 1, 1);
      ctx.fillStyle = m.aggro ? '#fff070' : '#a05030'; ctx.fillRect(f > 0 ? hx + 3 : hx + 1, y + 5 + bob, 2, 1);
      // spines
      ctx.fillStyle = '#1c1210'; ctx.fillRect(x + 2, y + bob, 1, 2); ctx.fillRect(x + 5, y - 1 + bob, 1, 3); ctx.fillRect(x + 8, y + bob, 1, 2);
      if (m.aggro && s.time < 0.5 + (m.aggroT || 0)) { /* reserved */ }
    }
  }

  // the portal device waiting on its pedestal: one coloured core per colour it will give you
  function drawPickups(s, time) {
    for (const g of s.pickups) {
      if (g.taken) continue;
      const X = g.x * T, Y = g.y * T, bob = Math.round(Math.sin(time * 2.4 + g.x) * 1.5);
      ctx.fillStyle = P.metalLo; ctx.fillRect(X + 2, Y + 13, 12, 3);
      ctx.fillStyle = P.metalEdge; ctx.fillRect(X + 2, Y + 13, 12, 1);
      const col = s.gun >= 1 ? C.B : C.A;
      ctx.globalAlpha = 0.25 + 0.15 * Math.sin(time * 4); ctx.fillStyle = col; ctx.fillRect(X + 1, Y - 2 + bob, 14, 12); ctx.globalAlpha = 1;
      ctx.fillStyle = '#c9ccdc'; ctx.fillRect(X + 3, Y + 3 + bob, 9, 4);
      ctx.fillStyle = '#8a8fae'; ctx.fillRect(X + 3, Y + 7 + bob, 3, 3);
      ctx.fillStyle = col; ctx.fillRect(X + 12, Y + 4 + bob, 2, 2); ctx.fillRect(X + 7, Y + 4 + bob, 3, 2);
    }
  }

  function drawFlags(s, time) {
    for (const f of s.flags) {
      const X = f.x * T, Y = f.y * T;
      ctx.fillStyle = '#2a1e1a'; ctx.fillRect(X + 3, Y + 10, 10, 6);
      ctx.fillStyle = '#4a3630'; ctx.fillRect(X + 2, Y + 8, 12, 3);
      ctx.fillStyle = '#6a4e44'; ctx.fillRect(X + 2, Y + 8, 12, 1);
      if (f.on) {
        for (let i = 0; i < 9; i++) {
          const w = Math.max(1, Math.round((7 - i * 0.7) + Math.sin(time * 14 + i) * 1));
          ctx.fillStyle = i < 3 ? '#fff2b0' : i < 6 ? '#ffb347' : '#ff6a14';
          ctx.fillRect(X + 8 - Math.floor(w / 2) + Math.round(Math.sin(time * 9 + i * 0.8) * 1), Y + 7 - i, w, 1);
        }
      } else { ctx.fillStyle = '#3a2a24'; ctx.fillRect(X + 5, Y + 6, 6, 2); ctx.fillStyle = 'rgba(255,120,60,0.4)'; ctx.fillRect(X + 7, Y + 7, 2, 1); }
    }
  }

  function drawDoors(s, time) {
    const seen = new Set();
    for (const d of s.doors) {
      const key = d.x + ',' + d.y;
      if (seen.has(key)) continue;
      const vert = s.doors.some(o => o.ch === d.ch && o.x === d.x && Math.abs(o.y - d.y) === 1);
      const group = s.doors.filter(o => o.ch === d.ch && (vert ? o.x === d.x : o.y === d.y));
      const cells = [];
      const flood = (c) => { if (cells.includes(c)) return; cells.push(c); for (const o of group) if (Math.abs(o.x - c.x) + Math.abs(o.y - c.y) === 1) flood(o); };
      flood(d);
      cells.forEach(c => seen.add(c.x + ',' + c.y));
      const x0 = Math.min(...cells.map(c => c.x)) * T, y0 = Math.min(...cells.map(c => c.y)) * T;
      const x1 = (Math.max(...cells.map(c => c.x)) + 1) * T, y1 = (Math.max(...cells.map(c => c.y)) + 1) * T;
      const amt = d.amt, ease = amt * amt * (3 - 2 * amt);
      ctx.fillStyle = '#0f111e';
      if (vert) {
        ctx.fillRect(x0 + 2, y0, 1, y1 - y0); ctx.fillRect(x1 - 3, y0, 1, y1 - y0);
        const h = Math.round((y1 - y0) * (1 - ease));
        if (h > 0) {
          ctx.fillStyle = P.door; ctx.fillRect(x0 + 3, y0, T - 6, h);
          ctx.fillStyle = P.doorHi; ctx.fillRect(x0 + 3, y0, 1, h);
          ctx.fillStyle = volc ? '#241818' : '#1b1f36';
          for (let yy = y0 + 3; yy < y0 + h - 1; yy += 6) ctx.fillRect(x0 + 5, yy, T - 10, 2);
          ctx.fillStyle = P.powerDim; ctx.fillRect(x0 + 6, y0 + h - 3, 4, 2);
        }
      } else {
        const w = Math.round((x1 - x0) / 2 * (1 - ease));
        if (w > 0) {
          ctx.fillStyle = P.door; ctx.fillRect(x0, y0 + 4, w, T - 8); ctx.fillRect(x1 - w, y0 + 4, w, T - 8);
          ctx.fillStyle = P.doorHi; ctx.fillRect(x0, y0 + 4, w, 1); ctx.fillRect(x1 - w, y0 + 4, w, 1);
          ctx.fillStyle = P.powerDim; ctx.fillRect(x0 + w - 3, y0 + 7, 2, 2); ctx.fillRect(x1 - w + 1, y0 + 7, 2, 2);
        }
      }
    }
  }

  function drawButtons(s) {
    for (const b of s.buttons) {
      const x = b.x0 * T + 1, w = (b.x1 - b.x0 + 1) * T - 2, y = (b.y + 1) * T;
      ctx.fillStyle = '#10121f'; ctx.fillRect(x, y - 2, w, 2);
      const h = Math.round(3 - b.amt * 2);
      ctx.fillStyle = b.on ? C.power : '#5a5470'; ctx.fillRect(x + 2, y - 2 - h, w - 4, h);
      ctx.fillStyle = b.on ? '#fff0c0' : '#7a7392'; ctx.fillRect(x + 2, y - 2 - h, w - 4, 1);
    }
  }

  function drawReceivers(s, time) {
    for (const r of s.receivers) {
      const X = r.x * T, Y = r.y * T, k = r.onT;
      ctx.fillStyle = k > 0.02 ? `rgba(255,59,92,${0.35 + 0.65 * k})` : '#2a1420';
      ctx.fillRect(X + 4, Y + 4, 8, 8);
      if (k > 0.02) { ctx.fillStyle = `rgba(255,241,244,${k})`; ctx.fillRect(X + 6, Y + 6, 4, 4); }
    }
  }

  function drawExit(s, time) {
    if (!s.exit) return;
    const X = s.exit.x * T, Y = (s.exit.y - 1) * T, open = s.exitOpen;
    ctx.fillStyle = '#0c0d18'; ctx.fillRect(X + 1, Y, 14, 32);
    if (open) {
      const g = ctx.createLinearGradient(0, Y, 0, Y + 32);
      g.addColorStop(0, '#fff7e3'); g.addColorStop(1, '#ffc56b');
      ctx.fillStyle = g; ctx.fillRect(X + 3, Y + 2, 10, 30);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(X + 5 + Math.round(Math.sin(time * 1.7) * 2), Y + 4, 1, 26);
    } else {
      ctx.fillStyle = '#1d1f33'; ctx.fillRect(X + 3, Y + 2, 10, 30);
      ctx.fillStyle = P.powerDim;
      for (let yy = Y + 5; yy < Y + 30; yy += 5) ctx.fillRect(X + 4, yy, 8, 1);
    }
    ctx.fillStyle = P.metalEdge; ctx.fillRect(X, Y - 1, 16, 2); ctx.fillRect(X, Y, 1, 32); ctx.fillRect(X + 15, Y, 1, 32);
    ctx.fillStyle = open ? '#fff3d6' : P.powerDim; ctx.fillRect(X + 6, Y - 4, 4, 2);
  }

  function drawCube(c, time, s) {
    if (c.gone) return;
    const x = Math.round(c.x), y = Math.round(c.y);
    ctx.globalAlpha = c.spawnT > 0 ? 1 - c.spawnT / 0.5 : 1;
    ctx.fillStyle = '#0d0f1b'; ctx.fillRect(x - 1, y - 1, 14, 14);
    ctx.fillStyle = C.cube; ctx.fillRect(x, y, 12, 12);
    ctx.fillStyle = C.cubeHi; ctx.fillRect(x, y, 12, 1); ctx.fillRect(x, y, 1, 12);
    ctx.fillStyle = C.cubeLo; ctx.fillRect(x, y + 11, 12, 1); ctx.fillRect(x + 11, y, 1, 12);
    ctx.fillStyle = '#5b6080'; ctx.fillRect(x + 2, y + 2, 2, 2); ctx.fillRect(x + 8, y + 2, 2, 2); ctx.fillRect(x + 2, y + 8, 2, 2); ctx.fillRect(x + 8, y + 8, 2, 2);
    const glow = 0.6 + 0.4 * Math.sin(time * 3 + c.hx);
    ctx.fillStyle = `rgba(255,207,90,${glow})`; ctx.fillRect(x + 4, y + 4, 4, 4);
    if (c.held) { ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x - 1, y - 1, 14, 1); }
    ctx.globalAlpha = 1;
  }

  function drawPortal(p, time) {
    const age = time - p.born, open = Math.min(1, Math.max(0, age / 0.22));
    const e = 1 - Math.pow(1 - open, 3);
    const col = PC[p.c], col2 = PC2[p.c];
    const horiz = p.n[1] !== 0;
    const len = 15 * e, dep = 4.5;
    const cx = p.px + p.n[0] * 1.5, cy = p.py + p.n[1] * 1.5;
    const rx = horiz ? len : dep, ry = horiz ? dep : len;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx + 3, ry + 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx + 1, ry + 1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#05060e';
    ctx.beginPath(); ctx.ellipse(cx, cy, Math.max(0.5, rx - 1), Math.max(0.5, ry - 1), 0, 0, Math.PI * 2); ctx.fill();
    ctx.clip();
    for (let i = 0; i < 10; i++) {
      const a = time * (1.6 + i * 0.13) * (p.c ? -1 : 1) + i * 0.63;
      const r = 0.25 + (i % 5) * 0.15;
      const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r;
      ctx.fillStyle = i % 3 ? col2 : col;
      ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.55;
    if (horiz) ctx.fillRect(Math.round(cx - len * 0.6), Math.round(cy + p.n[1] * (dep - 0.5)), Math.round(len * 1.2), 1);
    else ctx.fillRect(Math.round(cx + p.n[0] * (dep - 0.5)), Math.round(cy - len * 0.6), 1, Math.round(len * 1.2));
    ctx.globalAlpha = 1;
    if (p.fixed) {
      ctx.fillStyle = '#e8e6f0';
      if (horiz) { ctx.fillRect(p.s0 + 1, cy - p.n[1] * 3 - 1, 2, 2); ctx.fillRect(p.s1 - 3, cy - p.n[1] * 3 - 1, 2, 2); }
      else { ctx.fillRect(cx - p.n[0] * 3 - 1, p.s0 + 1, 2, 2); ctx.fillRect(cx - p.n[0] * 3 - 1, p.s1 - 3, 2, 2); }
    }
  }

  function drawBeams(s, time) {
    for (const b of s.beams) {
      const w = 1 + 0.25 * Math.sin(time * 9 + b.x0 * 0.1);
      ctx.strokeStyle = C.laser; ctx.lineCap = 'butt';
      ctx.globalAlpha = 0.16; ctx.lineWidth = 6 * w; line(b);
      ctx.globalAlpha = 0.45; ctx.lineWidth = 3; line(b);
      ctx.globalAlpha = 1; ctx.strokeStyle = C.laserCore; ctx.lineWidth = 1; line(b);
      if (Math.random() < 0.35) parts.push({ x: b.x1, y: b.y1, vx: rnd(-40, 40) - b.dx * 30, vy: rnd(-40, 40) - b.dy * 30, life: 0.25, max: 0.25, color: Math.random() < 0.5 ? C.laser : C.laserCore, grav: 0, size: 1 });
    }
    ctx.globalAlpha = 1;
  }
  function line(b) { ctx.beginPath(); ctx.moveTo(b.x0, b.y0); ctx.lineTo(b.x1, b.y1); ctx.stroke(); }

  function drawPlayer(s, time) {
    const pl = s.player;
    if (s.dead) return;
    for (const t of trails) {
      ctx.globalAlpha = t.life / 0.22 * 0.35;
      ctx.fillStyle = PC[t.c]; ctx.fillRect(Math.round(t.x) + 1, Math.round(t.y) + 2, 8, 15);
    }
    ctx.globalAlpha = 1;
    let x = Math.round(pl.x), y = Math.round(pl.y);
    const f = pl.facing;
    const moving = pl.ground && Math.abs(pl.vx) > 8;
    const step = moving ? Math.floor(pl.walk / 5) % 4 : 0;
    const air = !pl.ground;
    ctx.fillStyle = '#3c4060';
    const l1 = air ? 4 : [5, 4, 3, 4][step], l2 = air ? 3 : [3, 4, 5, 4][step];
    ctx.fillRect(x + 2, y + 18 - l1, 2, l1);
    ctx.fillRect(x + 6, y + 18 - l2, 2, l2);
    ctx.fillStyle = '#23263a'; ctx.fillRect(x + 2, y + 17, 2, 1); ctx.fillRect(x + 6, y + 17, 2, 1);
    const bob = moving && step % 2 ? 1 : 0;
    y += bob;
    ctx.fillStyle = C.bodyLo; ctx.fillRect(x + 1, y + 7, 8, 7);
    ctx.fillStyle = C.body; ctx.fillRect(x + 1, y + 7, 7, 6);
    ctx.fillStyle = '#5a5f80'; ctx.fillRect(x + 1, y + 11, 8, 1);
    ctx.fillStyle = '#4b5074'; ctx.fillRect(f > 0 ? x : x + 8, y + 8, 2, 5);
    ctx.fillStyle = PC[s.lastShot || 0]; ctx.fillRect(f > 0 ? x : x + 9, y + 9, 1, 1);
    ctx.fillStyle = C.body; ctx.fillRect(x + 1, y + 1, 8, 6); ctx.fillRect(x + 2, y, 6, 1);
    ctx.fillStyle = C.bodyLo; ctx.fillRect(x + 1, y + 6, 8, 1);
    ctx.fillStyle = C.visor; ctx.fillRect(f > 0 ? x + 3 : x + 1, y + 2, 6, 3);
    const ax = pl.aimX - (pl.x + 5), ay = pl.aimY - (pl.y + 4), al = Math.hypot(ax, ay) || 1;
    const ex = Math.round(x + (f > 0 ? 6 : 4) + ax / al * 1.2), ey = Math.round(y + 3 + ay / al * 0.8);
    ctx.fillStyle = PC[s.lastShot || 0]; ctx.fillRect(ex - 1, ey, 2, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(ex - (f > 0 ? 0 : 1), ey, 1, 1);
    const sway = Math.round(Math.sin(time * 3 + pl.x * 0.05) * 1 - pl.vx / 120);
    ctx.fillStyle = '#7d82a3'; ctx.fillRect(x + 4, y - 3, 1, 3);
    ctx.fillStyle = PC[s.lastShot || 0]; ctx.fillRect(x + 4 + sway, y - 4, 1, 1);
    if (s.gun > 0) {
      const ox = pl.x + 5, oy = pl.y + 9 + bob;
      const hyp = Math.hypot(pl.aimX - ox, pl.aimY - oy) || 1;
      const dy = (pl.aimY - oy) / hyp, ddx = (pl.aimX - ox) / hyp;
      for (let i = 2; i <= 7; i++) {
        ctx.fillStyle = i < 6 ? '#8a8fae' : i === 6 ? C.A : (s.gun === 2 ? C.B : C.A);
        ctx.fillRect(Math.round(ox + ddx * i), Math.round(oy + dy * i), 1, 1);
      }
    }
  }

  function drawAim(s, aim, time) {
    if (!aim || s.dead || s.won || s.gun === 0) return;
    const c = s.gun === 1 ? 0 : (s.portals[0] && s.portals[0].fixed ? 1 : (s.portals[1] && s.portals[1].fixed ? 0 : -1));
    const info = E.aimInfo(s, aim.x, aim.y, c < 0 ? 0 : c);
    const info2 = c < 0 ? E.aimInfo(s, aim.x, aim.y, 1) : null;
    const dx = info.hit.x - info.ox, dy = info.hit.y - info.oy, len = Math.hypot(dx, dy);
    ctx.fillStyle = 'rgba(232,230,240,0.22)';
    for (let d = 10; d < Math.min(len, 900); d += 6) ctx.fillRect(Math.round(info.ox + dx / len * d), Math.round(info.oy + dy / len * d), 1, 1);
    const p = info.portal || (info2 && info2.portal);
    if (p) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath();
      if (p.n[1]) ctx.ellipse(p.px, p.py + p.n[1] * 1.5, 15, 4, 0, 0, Math.PI * 2); else ctx.ellipse(p.px + p.n[0] * 1.5, p.py, 4, 15, 0, 0, Math.PI * 2);
      ctx.stroke(); ctx.setLineDash([]);
    } else if (info.hit.kind !== 'none') {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      const hx = Math.round(info.hit.x), hy = Math.round(info.hit.y);
      ctx.fillRect(hx - 2, hy - 2, 1, 1); ctx.fillRect(hx + 2, hy - 2, 1, 1); ctx.fillRect(hx - 2, hy + 2, 1, 1); ctx.fillRect(hx + 2, hy + 2, 1, 1); ctx.fillRect(hx, hy, 1, 1);
    }
    const mx = Math.round(aim.x), my = Math.round(aim.y);
    const lc = c === 1 ? C.B : C.A, rc = c === 0 ? C.A : C.B;
    ctx.fillStyle = 'rgba(4,5,12,0.6)'; ctx.fillRect(mx - 7, my - 5, 15, 11);
    ctx.fillStyle = lc; ctx.fillRect(mx - 6, my, 4, 1); ctx.fillRect(mx - 4, my - 4, 1, 3); ctx.fillRect(mx - 4, my + 2, 1, 3); ctx.fillRect(mx - 4, my - 4, 2, 1); ctx.fillRect(mx - 4, my + 4, 2, 1);
    ctx.fillStyle = rc; ctx.fillRect(mx + 3, my, 4, 1); ctx.fillRect(mx + 4, my - 4, 1, 3); ctx.fillRect(mx + 4, my + 2, 1, 3); ctx.fillRect(mx + 3, my - 4, 2, 1); ctx.fillRect(mx + 3, my + 4, 2, 1);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(mx, my, 1, 1);
  }

  function drawParts() {
    for (const p of parts) {
      if (p.x < cam.x - 4 || p.x > cam.x + VW + 4 || p.y < cam.y - 4 || p.y > cam.y + VH + 4) continue;
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max * 1.4));
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function lightPass(s, time) {
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    lctx.globalCompositeOperation = 'source-over';
    lctx.clearRect(0, 0, VW, VH);
    const dark = volc ? [0.34 + deep * 0.16, 0.5 + deep * 0.2] : [0.22, 0.4];
    const amb = lctx.createLinearGradient(0, 0, 0, VH);
    amb.addColorStop(0, `rgba(${volc ? '10,3,3' : '3,4,12'},${dark[0]})`); amb.addColorStop(1, `rgba(${volc ? '10,3,3' : '3,4,12'},${dark[1]})`);
    lctx.fillStyle = amb; lctx.fillRect(0, 0, VW, VH);
    lctx.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
    lctx.globalCompositeOperation = 'destination-out';
    const onScr = (x, y, r) => x + r > cam.x && x - r < cam.x + VW && y + r > cam.y && y - r < cam.y + VH;
    const hole = (x, y, r, a) => {
      if (!onScr(x, y, r)) return;
      const g = lctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)');
      lctx.fillStyle = g; lctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const p of s.portals) if (p) hole(p.px, p.py, 54, 0.95);
    if (s.exit) hole(s.exit.x * T + 8, s.exit.y * T, s.exitOpen ? 46 : 18, s.exitOpen ? 0.95 : 0.4);
    for (const b of s.beams) {
      const len = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
      for (let d = 0; d <= len; d += 22) hole(b.x0 + (b.x1 - b.x0) * d / (len || 1), b.y0 + (b.y1 - b.y0) * d / (len || 1), 18, 0.6);
    }
    if (!s.dead) hole(s.player.x + 5, s.player.y + 6, volc ? 64 : 44, 0.8);
    for (const r of s.receivers) if (r.on) hole(r.x * T + 8, r.y * T + 8, 26, 0.8);
    for (const b of s.buttons) if (b.on) hole((b.x0 + b.x1 + 1) * T / 2, b.y * T + 14, 22, 0.6);
    for (const c of s.cubes) if (!c.gone) hole(c.x + 6, c.y + 6, 16, 0.4);
    for (const a of acidTops) hole(a[0], a[1], volc ? 40 : 26, volc ? 0.75 : 0.55);
    for (const v of s.vents) { if (v.on) hole(v.x * T + 8, (v.top + v.y * T) / 2, 50, 0.9); else if (v.warn) hole(v.x * T + 8, v.y * T, 20, 0.6); }
    for (const f of s.flags) if (f.on) hole(f.x * T + 8, f.y * T + 4, 48, 0.85);
    for (const g of s.pickups) if (!g.taken) hole(g.x * T + 8, g.y * T + 6, 40, 0.8);
    for (const sh of s.sharks) if (!sh.dead && sh.mode === 'leap') hole(sh.x + 6, sh.y + 4, 24, 0.6);
    if (isFinite(s.lavaY) && s.lavaY < cam.y + VH + 40) for (let x = Math.floor(cam.x / 48) * 48; x < cam.x + VW + 48; x += 48) hole(x, s.lavaY + 4, 70, 0.9);
    lctx.globalCompositeOperation = 'source-over';
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lightCv, cam.x, cam.y);
    ctx.globalCompositeOperation = 'lighter';
    const glow = (x, y, r, col, a) => {
      if (!onScr(x, y, r)) return;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = a; ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const p of s.portals) if (p) glow(p.px + p.n[0] * 4, p.py + p.n[1] * 4, 30, PC[p.c], 0.35);
    if (s.exit && s.exitOpen) glow(s.exit.x * T + 8, s.exit.y * T, 30, '#ffcf7a', 0.28);
    for (const a of acidTops) glow(a[0], a[1] + 4, volc ? 22 : 14, '#ff6a1f', volc ? 0.3 : 0.22);
    for (const b of s.beams) glow(b.x1, b.y1, 10, C.laser, 0.6);
    for (const v of s.vents) if (v.on) glow(v.x * T + 8, (v.top + v.y * T) / 2, 40, '#ff8a2a', 0.35);
    for (const f of s.flags) if (f.on) glow(f.x * T + 8, f.y * T + 2, 26, '#ffb347', 0.35);
    for (const m of s.mons) if (!m.dead && m.aggro) glow(m.x + (m.face > 0 ? 11 : 1), m.y + 6, 10, '#ff3a10', 0.5);
    if (isFinite(s.lavaY) && s.lavaY < cam.y + VH + 30) for (let x = Math.floor(cam.x / 64) * 64; x < cam.x + VW + 64; x += 64) glow(x, s.lavaY, 50, '#ff5a14', 0.3);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function drawHint(s, text, t0) {
    if (!text) return;
    const age = s.time - t0;
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(0.75, Math.min(age * 2, 0.75 - (age - 8) * 0.25)));
    ctx.font = '8px Silkscreen, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#e8e6f0';
    ctx.fillText(text, VW / 2, 30);
    ctx.restore();
  }

  // the sky above the cave mouth (chamber 21)
  function drawSky(s, time) {
    const rows = s.def.sky;
    if (!rows) return;
    const h = rows * T;
    if (cam.y > h) return;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0b0e24'); g.addColorStop(0.6, '#3a1c3a'); g.addColorStop(1, '#a3442a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, MW, h);
    for (let i = 0; i < 90; i++) {
      const x = (hash(i, 7) % MW), y = hash(i, 3) % Math.max(1, Math.floor(h * 0.7));
      ctx.fillStyle = `rgba(255,255,240,${0.3 + 0.5 * Math.abs(Math.sin(time * 0.7 + i))})`;
      ctx.fillRect(x, y, 1, 1);
    }
    // a distant volcano cone breathing smoke
    const cx = MW * 0.72;
    ctx.fillStyle = '#1c0e14';
    ctx.beginPath(); ctx.moveTo(cx - 220, h); ctx.lineTo(cx - 30, h - 110); ctx.lineTo(cx + 30, h - 110); ctx.lineTo(cx + 240, h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff6a14'; ctx.fillRect(cx - 28, h - 111, 56, 2);
    for (let i = 0; i < 7; i++) {
      const k = (time * 0.05 + i / 7) % 1;
      ctx.fillStyle = `rgba(60,40,50,${0.5 * (1 - k)})`;
      ctx.beginPath(); ctx.arc(cx + Math.sin(i * 2 + time * 0.3) * 10 + k * 40, h - 115 - k * 120, 10 + k * 30, 0, Math.PI * 2); ctx.fill();
    }
  }

  function frame(s, opts) {
    const time = s.time;
    if (opts.cam) { cam.x = opts.cam.x; cam.y = opts.cam.y; }
    shake = Math.max(0, shake - opts.dt * 12);
    const sx = shake > 0.05 ? Math.round(rnd(-shake, shake)) : 0, sy = shake > 0.05 ? Math.round(rnd(-shake, shake)) : 0;
    cam.x = Math.round(Math.max(0, Math.min(MW - VW, cam.x + sx)));
    cam.y = Math.round(Math.max(0, Math.min(MH - VH, cam.y + sy)));
    updateParts(opts.dt, s);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(bgCv, -Math.round(cam.x * 0.5), -Math.round(cam.y * 0.5));
    for (const m of motes) {
      m.y -= m.v * opts.dt; m.x += Math.sin(time * 0.6 + m.p) * 3 * opts.dt;
      if (m.y < -2) { m.y = VH + 2; m.x = Math.random() * VW; }
      ctx.fillStyle = volc ? `rgba(255,${140 + Math.floor(m.p * 15)},70,${m.a * (0.6 + 0.4 * Math.sin(time * 5 + m.p))})` : `rgba(190,200,255,${m.a})`;
      ctx.fillRect(Math.round(m.x), Math.round(m.y), 1, 1);
    }
    ctx.setTransform(1, 0, 0, 1, -cam.x, -cam.y);
    drawSky(s, time);
    drawWires(s, time);
    drawAcidAndFizz(s, time);
    ctx.drawImage(tileCv, cam.x, cam.y, VW, VH, cam.x, cam.y, VW, VH);
    drawCrumbs(s, time);
    drawReceivers(s, time);
    drawDoors(s, time);
    drawButtons(s);
    drawFlags(s, time);
    drawPickups(s, time);
    drawExit(s, time);
    for (const c of s.cubes) if (!c.held) drawCube(c, time, s);
    drawMons(s, time);
    drawBeams(s, time);
    drawPlayer(s, time);
    for (const c of s.cubes) if (c.held) drawCube(c, time, s);
    drawSpikes(s, time);
    drawVents(s, time);
    drawSharks(s, time);
    drawRisingLava(s, time);
    for (const p of s.portals) if (p) drawPortal(p, time);
    drawParts();
    lightPass(s, time);
    if (opts.aim) drawAim(s, opts.aim, time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawHint(s, opts.hint, opts.hintT || 0);
    if (opts.title && s.time < 2.6) {
      const a = Math.min(1, s.time / 0.4) * Math.min(1, (2.6 - s.time) / 0.8);
      ctx.save(); ctx.globalAlpha = a * 0.9; ctx.textAlign = 'center'; ctx.fillStyle = '#e8e6f0';
      ctx.font = '16px Silkscreen, monospace'; ctx.fillText(opts.title[0], VW / 2, VH / 2 - 30);
      ctx.globalAlpha = a * 0.6; ctx.font = '8px Silkscreen, monospace'; ctx.fillText(opts.title[1], VW / 2, VH / 2 - 16);
      ctx.restore();
    }
    // lava is close: the screen edge glows hot
    if (isFinite(s.lavaY) && !s.dead) {
      const d = (s.lavaY - (s.player.y + s.player.h)) / T;
      if (d < 7) {
        const a = Math.max(0, Math.min(0.45, (7 - d) / 14)) * (0.8 + 0.2 * Math.sin(time * 8));
        const g = ctx.createLinearGradient(0, VH, 0, VH - 120);
        g.addColorStop(0, `rgba(255,70,10,${a})`); g.addColorStop(1, 'rgba(255,70,10,0)');
        ctx.fillStyle = g; ctx.fillRect(0, VH - 120, VW, 120);
      }
    }
    let fade = 0;
    if (s.dead) fade = Math.min(1, Math.max(0, (s.endT - 0.35) / 0.55));
    if (opts.fadeIn != null) fade = Math.max(fade, opts.fadeIn);
    if (fade > 0) { ctx.fillStyle = `rgba(4,5,12,${fade})`; ctx.fillRect(0, 0, VW, VH); }
  }

  root.Render = { init, buildStatic, rebind, frame, onEvent, C };
})(window);
