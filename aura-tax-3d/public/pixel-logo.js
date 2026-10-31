// Pixel logo, ported from Haunt Filter and recoloured in aura gold. The word is rendered once and sampled into a grid of
// cells; every lit cell is a gold square with a flickering glyph, edge cells get orange + marks, flakes stream off and
// the lot glows. The pointer shoves the pixels aside; they heat up, shed flakes and spring home. A click (or tap) blows
// the word apart and it pulls itself back together.
//
//   pixelLogo(canvas, { text, font, cell, width, pad })
//   width: fit the letters to this many CSS px wide (a number or a function). pad: room around the word for flakes and
//   glow; the canvas is pulled out by that much with negative margins, so the layout only sees the word itself.

const KANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'];
const RAMP = [...'·:+×□#▣█'];
const BASE = [245, 185, 66]; // --accent
const HOT = [255, 246, 222];
const EDGE = '#f08c4a'; // --orange

export function pixelLogo(canvas, opts) {
  const o = { text: 'AURA TAX', font: '800 100px Rubik, Inter, sans-serif', cell: 5, width: 400, pad: 16, ...opts };
  const val = v => (typeof v === 'function' ? v() : v);
  const x = canvas.getContext('2d');
  const glow = document.createElement('canvas');
  const gx = glow.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let cells = [];
  let flakes = [];
  let LW = 0;
  let LH = 0;
  let C = o.cell;
  let dpr = 1;
  let ghost = null;
  let last = 0;
  let running = false;

  function build() {
    C = o.cell;
    dpr = Math.min(devicePixelRatio || 1, 2);
    const pad = o.pad;
    const off = document.createElement('canvas');
    const ox = off.getContext('2d', { willReadFrequently: true });
    ox.font = o.font;
    const w100 = ox.measureText(o.text).width;
    const fs = (val(o.width) * 100) / w100;
    LW = Math.ceil((w100 * fs) / 100 + pad * 2);
    LH = Math.ceil(fs * 0.76 + pad * 2);
    off.width = LW;
    off.height = LH;
    ox.font = o.font.replace('100px', `${fs}px`);
    ox.fillStyle = '#fff';
    ox.fillText(o.text, pad, pad + fs * 0.72);
    const d = ox.getImageData(0, 0, LW, LH).data;
    const cols = Math.floor(LW / C);
    const rows = Math.floor(LH / C);
    const on = new Uint8Array(cols * rows);
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
    canvas.width = LW * dpr;
    canvas.height = LH * dpr;
    Object.assign(canvas.style, { width: `${LW}px`, height: `${LH}px`, margin: `${-pad}px` });
    glow.width = Math.ceil(LW / 4);
    glow.height = Math.ceil(LH / 4);
  }
  const flake = (px, py, hot) => flakes.length < 400 && flakes.push({
    x: px, y: py, vx: rnd(10, 60) + (hot ? rnd(-80, 80) : 0), vy: rnd(-30, -6) + (hot ? rnd(-60, 30) : 0),
    life: rnd(0.5, 1.3), max: 1.3, s: rnd(1.5, C * 0.5), hot,
  });

  function draw(now) {
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    const time = now / 1000;
    last = now;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, LW, LH);
    x.font = `700 ${C + 1}px 'JetBrains Mono', monospace`;
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    const R = C * 8;
    const damp = Math.max(0, 1 - dt * 7);
    for (const c of cells) {
      if (ghost) { // the push
        const dx = c.x + C / 2 - ghost.x;
        const dy = c.y + C / 2 - ghost.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < R * R) {
          const dd = Math.sqrt(d2) || 1;
          const f = (1 - dd / R) * 2400 * dt;
          c.vx += (dx / dd) * f;
          c.vy += (dy / dd) * f;
          c.heat = Math.min(1, c.heat + (1 - dd / R) * dt * 9);
        }
      }
      c.vx = (c.vx + (c.hx - c.x) * 70 * dt) * damp; // spring home
      c.vy = (c.vy + (c.hy - c.y) * 70 * dt) * damp;
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      c.heat = Math.max(0, c.heat - dt * 1.1);
      if (Math.abs(c.x - c.hx) + Math.abs(c.y - c.hy) > C * 1.5 && Math.random() < dt * 5) flake(c.x + C / 2, c.y + C / 2, true);
      if ((c.t -= dt * (1 + c.heat * 14)) < 0) { c.g = Math.random(); c.t = rnd(0.3, 2.4); } // flicker re-roll
      const v = clamp(c.v * (0.78 + 0.22 * Math.sin(c.hx * 0.03 - time * 1.8 + c.hy * 0.05)) + c.heat * 0.5, 0, 1);
      const h = c.heat;
      const s = Math.max(1, Math.round(C * (0.6 + 0.38 * c.g * (1 - h))));
      const px = Math.round(c.x + (C - s) / 2);
      const py = Math.round(c.y + (C - s) / 2);
      x.globalAlpha = 0.5 + 0.45 * v;
      x.fillStyle = `rgb(${BASE.map((b, k) => (b + (HOT[k] - b) * h) | 0)})`; // gold, heating toward white
      x.fillRect(px, py, s, s);
      x.globalAlpha = Math.min(1, v + 0.1) * (h > 0.3 ? 1 : 0.7);
      if (c.g < 0.45 && h < 0.3) continue; // bare squares on the rest, so the letters stay readable
      if (c.edge && c.g > 0.6) { x.fillStyle = EDGE; x.fillText('+', c.x + C / 2, c.y + C / 2); }
      else {
        x.fillStyle = h > 0.3 ? '#fff' : '#2a1c06';
        x.fillText(v > 0.72 ? RAMP[Math.min(RAMP.length - 1, (c.g * RAMP.length) | 0)] : KANA[(c.g * KANA.length) | 0], c.x + C / 2, c.y + C / 2);
      }
    }
    // flakes peel off the edges and drift right and up
    for (let k = cells.length * dt * 0.06; k > 0; k--) {
      if (Math.random() > k) break;
      const c = cells[(Math.random() * cells.length) | 0];
      if (c.edge) flake(c.x + C / 2, c.y + C / 2, false);
    }
    for (let i = flakes.length - 1; i >= 0; i--) {
      const p = flakes[i];
      if ((p.life -= dt) <= 0) { flakes.splice(i, 1); continue; }
      p.vy -= 26 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      x.globalAlpha = (p.life / p.max) * 0.9;
      x.fillStyle = p.hot ? EDGE : '#f5b942';
      const s = Math.max(1, Math.round(p.s * (p.life / p.max)));
      x.fillRect(Math.round(p.x), Math.round(p.y), s, s);
    }
    x.globalAlpha = 1;
    // bloom: a small blurred copy added back on top
    gx.clearRect(0, 0, glow.width, glow.height);
    gx.filter = 'blur(2px)';
    gx.drawImage(canvas, 0, 0, glow.width, glow.height);
    gx.filter = 'none';
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = 0.5;
    x.drawImage(glow, 0, 0, canvas.width, canvas.height);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    if (!still) requestAnimationFrame(draw);
  }

  const local = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  canvas.addEventListener('pointermove', e => { if (e.pointerType !== 'touch') ghost = local(e); });
  canvas.addEventListener('pointerleave', () => { ghost = null; });
  canvas.addEventListener('click', e => { // blow it apart from where you clicked
    const p = local(e);
    for (const c of cells) {
      const dx = c.x + C / 2 - p.x;
      const dy = c.y + C / 2 - p.y;
      const dd = Math.hypot(dx, dy) || 1;
      const sp = rnd(300, 900) * (0.4 + 60 / (dd + 60));
      c.vx += (dx / dd) * sp;
      c.vy += (dy / dd) * sp - rnd(0, 200);
      c.heat = 1;
    }
    for (let i = 0; i < 60; i++) flake(p.x, p.y, true);
  });

  const rebuild = () => { build(); if (still) draw(performance.now()); };
  Promise.all([document.fonts.load(o.font), document.fonts.load("700 6px 'JetBrains Mono'")]).catch(() => {}).then(() => {
    build();
    if (!running) { running = true; requestAnimationFrame(draw); }
    let rt = 0;
    new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(rebuild, 120); }).observe(canvas.parentElement);
  });
  return { rebuild };
}
