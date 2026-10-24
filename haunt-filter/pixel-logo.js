'use strict';
// Pixel logo: a word drawn the Haunt Filter way. It's rendered once in Creepster and sampled into a grid of cells; every lit
// cell is a blood-red square with a flickering glyph, edge cells get orange + marks, flakes stream off and the lot glows.
// The pointer shoves the pixels aside like a ghost walking through them; they flare, shed flakes and spring home. A click
// (or tap) blows the word apart and it pulls itself back together. Shared by the Projects page and Haunt Filter.
//
//   pixelLogo(canvas, { text, cell, height | width, maxWidth, pad })
//   height: fit the letters to this many CSS px tall. width: fit them to this many px wide (a number or a function).
//   maxWidth: never wider than this (number or function). pad: room around the word for flakes and glow; the canvas is
//   pulled out by that much with negative margins, so the layout only sees the word itself.
window.pixelLogo = (canvas, opts) => {
  const o = { text: 'HAUNT', cell: 5, height: 0, width: 0, maxWidth: Infinity, pad: 14, ...opts };
  const val = (v) => (typeof v === 'function' ? v() : v);
  const x = canvas.getContext('2d'), glow = document.createElement('canvas'), gx = glow.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'], RAMP = [...'·:+×□#▣█'];
  const rnd = (a, b) => a + Math.random() * (b - a), clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let cells = [], flakes = [], LW = 0, LH = 0, C = o.cell, dpr = 1, ghost = null, last = 0, running = false;

  function build() {
    C = o.cell; dpr = Math.min(devicePixelRatio || 1, 2);
    const pad = o.pad, off = document.createElement('canvas'), ox = off.getContext('2d', { willReadFrequently: true });
    ox.font = '400 100px Creepster, Impact, sans-serif';
    const w100 = ox.measureText(o.text).width;
    let fs = val(o.height) ? val(o.height) / 0.86 : (val(o.width) * 100) / w100;
    fs = Math.min(fs, (val(o.maxWidth) * 100) / w100);
    LW = Math.ceil((w100 * fs) / 100 + pad * 2); LH = Math.ceil(fs * 0.86 + pad * 2);
    off.width = LW; off.height = LH;
    ox.font = `400 ${fs}px Creepster, Impact, sans-serif`; ox.fillStyle = '#fff';
    ox.fillText(o.text, pad, pad + fs * 0.74);
    const d = ox.getImageData(0, 0, LW, LH).data, cols = Math.floor(LW / C), rows = Math.floor(LH / C), on = new Uint8Array(cols * rows);
    // a cell is lit when most of it is covered by the letters (3x3 samples)
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      let s = 0;
      for (let v = 0; v < 3; v++) for (let u = 0; u < 3; u++) s += d[((j * C + ((v * (C - 1)) / 2) | 0) * LW + (i * C + ((u * (C - 1)) / 2) | 0)) * 4 + 3];
      on[j * cols + i] = s / 9 > 110 ? 1 : 0;
    }
    cells = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      if (!on[j * cols + i]) continue;
      const edge = !on[j * cols + i - 1] || !on[j * cols + i + 1] || !on[(j - 1) * cols + i] || !on[(j + 1) * cols + i];
      cells.push({ hx: i * C, hy: j * C, x: i * C, y: j * C, vx: 0, vy: 0, g: Math.random(), t: rnd(0, 2), heat: 0, edge, v: 0.6 + 0.4 * (1 - j / rows) });
    }
    canvas.width = LW * dpr; canvas.height = LH * dpr;
    Object.assign(canvas.style, { width: `${LW}px`, height: `${LH}px`, margin: `${-pad}px 0 ${-pad}px ${-pad}px` });
    glow.width = Math.ceil(LW / 4); glow.height = Math.ceil(LH / 4);
  }
  const flake = (px, py, hot) => flakes.length < 400 && flakes.push({ x: px, y: py, vx: rnd(10, 60) + (hot ? rnd(-80, 80) : 0), vy: rnd(-30, -6) + (hot ? rnd(-60, 30) : 0), life: rnd(0.5, 1.3), max: 1.3, s: rnd(1.5, C * 0.5), hot });

  function draw(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016, time = now / 1000; last = now;
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.clearRect(0, 0, LW, LH);
    x.font = `700 ${C + 1}px 'JetBrains Mono', monospace`; x.textAlign = 'center'; x.textBaseline = 'middle';
    const R = C * 8, damp = Math.max(0, 1 - dt * 7), glyphs = C >= 5; // below 5px a glyph is just noise, so tiny logos are squares only
    for (const c of cells) {
      if (ghost) { // the push
        const dx = c.x + C / 2 - ghost.x, dy = c.y + C / 2 - ghost.y, d2 = dx * dx + dy * dy;
        if (d2 < R * R) { const dd = Math.sqrt(d2) || 1, f = (1 - dd / R) * 2400 * dt; c.vx += (dx / dd) * f; c.vy += (dy / dd) * f; c.heat = Math.min(1, c.heat + (1 - dd / R) * dt * 9); }
      }
      c.vx = (c.vx + (c.hx - c.x) * 70 * dt) * damp; c.vy = (c.vy + (c.hy - c.y) * 70 * dt) * damp; // spring home
      c.x += c.vx * dt; c.y += c.vy * dt;
      c.heat = Math.max(0, c.heat - dt * 1.1);
      if (Math.abs(c.x - c.hx) + Math.abs(c.y - c.hy) > C * 1.5 && Math.random() < dt * 5) flake(c.x + C / 2, c.y + C / 2, true);
      if ((c.t -= dt * (1 + c.heat * 14)) < 0) { c.g = Math.random(); c.t = rnd(0.3, 2.4); } // flicker re-roll
      const v = clamp(c.v * (0.78 + 0.22 * Math.sin(c.hx * 0.03 - time * 1.8 + c.hy * 0.05)) + c.heat * 0.5, 0, 1), h = c.heat;
      const s = glyphs ? Math.max(1, Math.round(C * (0.55 + 0.4 * c.g * (1 - h)))) : C, px = Math.round(c.x + (C - s) / 2), py = Math.round(c.y + (C - s) / 2);
      x.globalAlpha = glyphs ? 0.45 + 0.45 * v : 0.7 + 0.3 * v; // small logos keep solid, steady squares so the word reads
      x.fillStyle = `rgb(${(196 + 59 * h) | 0},${(18 + 104 * h) | 0},${(31 + 15 * h) | 0})`; // blood, heating toward ember
      x.fillRect(px, py, s, s);
      if (!glyphs) { if (c.edge && c.g > 0.93) { x.globalAlpha = v * 0.8; x.fillStyle = '#ff7a2e'; x.fillRect(px, py, s, s); } continue; }
      x.globalAlpha = Math.min(1, v + 0.1) * (h > 0.3 ? 1 : 0.6);
      if (c.g < 0.45 && h < 0.3) continue; // bare squares on the rest, so the letters stay readable
      if (c.edge && c.g > 0.6) { x.fillStyle = '#ff7a2e'; x.fillText('+', c.x + C / 2, c.y + C / 2); }
      else { x.fillStyle = h > 0.3 ? '#fff4ea' : '#f3e9e4'; x.fillText(v > 0.72 ? RAMP[Math.min(RAMP.length - 1, (c.g * RAMP.length) | 0)] : KANA[(c.g * KANA.length) | 0], c.x + C / 2, c.y + C / 2); }
    }
    // flakes peel off the edges and drift right and up, like the filter's particles
    for (let k = cells.length * dt * 0.06; k > 0; k--) { if (Math.random() > k) break; const c = cells[(Math.random() * cells.length) | 0]; if (c.edge) flake(c.x + C / 2, c.y + C / 2, false); }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const p = flakes[i];
      if ((p.life -= dt) <= 0) { flakes.splice(i, 1); continue; }
      p.vy -= 26 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      x.globalAlpha = (p.life / p.max) * 0.9; x.fillStyle = p.hot ? '#ff7a2e' : '#c4121f';
      const s = Math.max(1, Math.round(p.s * (p.life / p.max)));
      x.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    x.globalAlpha = 1;
    // bloom: a small blurred copy added back on top
    gx.clearRect(0, 0, glow.width, glow.height); gx.filter = 'blur(2px)'; gx.drawImage(canvas, 0, 0, glow.width, glow.height); gx.filter = 'none';
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.6;
    x.drawImage(glow, 0, 0, canvas.width, canvas.height);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    if (!still) requestAnimationFrame(draw);
  }

  const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') ghost = local(e); });
  canvas.addEventListener('pointerleave', () => (ghost = null));
  canvas.addEventListener('click', (e) => { // blow it apart from where you clicked
    const p = local(e);
    for (const c of cells) {
      const dx = c.x + C / 2 - p.x, dy = c.y + C / 2 - p.y, dd = Math.hypot(dx, dy) || 1, sp = rnd(300, 900) * (0.4 + 60 / (dd + 60));
      c.vx += (dx / dd) * sp; c.vy += (dy / dd) * sp - rnd(0, 200); c.heat = 1;
    }
    for (let i = 0; i < 60; i++) flake(p.x, p.y, true);
  });

  const rebuild = () => { build(); if (still) draw(performance.now()); };
  document.fonts.load('100px Creepster').catch(() => {}).then(() => {
    build();
    if (!running) { running = true; requestAnimationFrame(draw); }
    let rt = 0;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(rebuild, 120); }).observe(canvas.parentElement);
  });
  return { rebuild, set(next) { Object.assign(o, next); rebuild(); } };
};
