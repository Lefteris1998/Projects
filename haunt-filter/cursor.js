'use strict';
// Spooky cursor, built from the same pieces as the filter: square flakes, katakana and block glyphs, orange + marks.
// Two states: a glowing square with a dashed square ring that trails behind, and over anything clickable a pointing hand
// inside target brackets. Clicks throw sparks; clicking a button or chip also bursts flakes and glyphs off its edges.
// Drawn on one full-screen canvas in the top layer (it's a popover) so it stays above dialogs. Mouse and pen only.
(() => {
  const cv = document.getElementById('cursor');
  if (!cv || !cv.showPopover || !matchMedia('(any-pointer: fine)').matches) return;
  const x = cv.getContext('2d');
  const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a), pick = (a) => a[(Math.random() * a.length) | 0];
  const EMBER = ['#ef3b45', '#c4121f', '#ff7a2e', '#ff4d3a'];
  const GLYPHS = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン·:+×□#▣█'];
  const MONO = "'JetBrains Mono', monospace";

  document.documentElement.classList.add('ghost-cursor');
  // the Material components set their own cursor inside shadow DOM, so each one gets a no-cursor sheet the first time it's hovered
  const noCursor = new CSSStyleSheet();
  noCursor.replaceSync('*, :host { cursor: none !important; }');
  const patched = new WeakSet();
  const patch = (el) => {
    const sr = el.shadowRoot;
    if (!sr || patched.has(el)) return;
    patched.add(el);
    sr.adoptedStyleSheets = [...sr.adoptedStyleSheets, noCursor];
    for (const c of sr.querySelectorAll('*')) patch(c);
  };

  // top layer: whatever was shown last sits on top, so re-raise after dialogs and select menus open
  const raise = () => { try { cv.hidePopover(); } catch {} try { cv.showPopover(); } catch {} };
  raise();
  const raiseSoon = () => { setTimeout(raise, 30); setTimeout(raise, 320); };

  let W = 0, H = 0, dpr = 1;
  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2); W = innerWidth; H = innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  };
  resize();
  addEventListener('resize', resize);

  // the hover hand is the Material Symbols pointing hand. its fingertip is found once by scanning the rendered glyph
  const HAND = 30;
  let hand = null;
  const makeHand = () => {
    const c = document.createElement('canvas'); c.width = c.height = HAND * 2;
    const g = c.getContext('2d');
    g.font = `${HAND}px 'Material Symbols Outlined'`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#f3e9e4'; // bone white
    g.fillText('pan_tool_alt', HAND, HAND);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    for (let yy = 0; yy < c.height; yy++) {
      let sx = 0, n = 0;
      for (let xx = 0; xx < c.width; xx++) if (d[(yy * c.width + xx) * 4 + 3] > 128) { sx += xx; n++; }
      if (n) { hand = { c, tx: sx / n, ty: yy }; return; }
    }
  };
  if (document.fonts) document.fonts.load(`${HAND}px 'Material Symbols Outlined'`, 'pan_tool_alt').then(makeHand, () => {});

  let mx = -100, my = -100, rx = -100, ry = -100, shown = false, hover = 0, hoverTarget = false, native = false, press = 0;
  const parts = [], frames = [];
  const MAX = 700;
  // a square flake (like the filter's squares) or a glyph that re-rolls its character as it flickers
  const flake = (px, py, vx, vy, life, size, c = pick(EMBER)) => parts.length < MAX && parts.push({ px, py, vx, vy, life, max: life, size, c });
  const glyph = (px, py, vx, vy, life, size, c) => parts.length < MAX && parts.push({ px, py, vx, vy, life, max: life, size, c: c || (Math.random() < 0.25 ? '#ff7a2e' : '#f3e9e4'), ch: pick(GLYPHS), flick: rnd(0.05, 0.2) });

  const INTERACTIVE = /^(A|BUTTON|LABEL|SUMMARY|SELECT|INPUT|TEXTAREA|MD-.*)$/;
  const isClickable = (path) => path.some((n) => n.tagName && (INTERACTIVE.test(n.tagName) || n.classList?.contains('drop')));
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    const path = e.composedPath();
    for (const n of path) if (n.shadowRoot) patch(n);
    hoverTarget = isClickable(path);
    native = path.some((n) => n.classList?.contains('cropwrap'));
    if (!shown) { rx = mx = e.clientX; ry = my = e.clientY; shown = true; }
    const dx = e.clientX - mx, dy = e.clientY - my, d = Math.hypot(dx, dy);
    // flakes shed along the path, more when moving fast; now and then a glyph peels off too
    const n = Math.min(7, Math.floor(d / 7));
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n);
      flake(mx + dx * t + rnd(-2, 2), my + dy * t + rnd(-2, 2), rnd(-20, 20) - dx * 0.6, rnd(-30, 5) - dy * 0.6, rnd(0.45, 1), rnd(1.5, 3.5));
    }
    if (d > 3 && Math.random() < 0.18) glyph(e.clientX + rnd(-6, 6), e.clientY + rnd(-6, 6), rnd(-12, 12), rnd(-40, -16), rnd(0.8, 1.5), rnd(9, 14));
    mx = e.clientX; my = e.clientY;
  }, true);
  addEventListener('pointerover', (e) => { for (const n of e.composedPath()) if (n.shadowRoot) patch(n); }, true);
  document.addEventListener('pointerleave', () => (shown = false));
  addEventListener('blur', () => (shown = false));

  // which element counts as "the button" for the edge burst, and how round its corners are
  const BURST = /^MD-(.*-BUTTON|.*-CHIP|MENU-ITEM|SELECT-OPTION|SWITCH|ICON-BUTTON)$/;
  const burstTarget = (path) => {
    for (const n of path) {
      if (!n.tagName) continue;
      if (BURST.test(n.tagName)) return { el: n, round: /CHIP|MENU|OPTION/.test(n.tagName) ? 8 : null };
      if (n.tagName === 'SUMMARY' || n.classList?.contains('drop')) return { el: n, round: 6 };
    }
    return null;
  };
  addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;
    const px = e.clientX, py = e.clientY;
    press = 1;
    for (let i = 0; i < 18; i++) { const a = rnd(0, TAU), s = rnd(60, 200); flake(px, py, Math.cos(a) * s, Math.sin(a) * s - 30, rnd(0.5, 1), rnd(1.5, 3.5)); }
    const bt = burstTarget(e.composedPath());
    if (bt) {
      const r = bt.el.getBoundingClientRect(), round = bt.round ?? Math.min(r.height / 2, 20);
      frames.push({ x: r.left, y: r.top, w: r.width, h: r.height, round, t: 0 });
      // flakes leave from all round the outline, flying outward
      const per = 2 * (r.width + r.height), count = Math.min(60, 16 + per / 10);
      for (let i = 0; i < count; i++) {
        let d = Math.random() * per, ex, ey, nx, ny;
        if (d < r.width) { ex = r.left + d; ey = r.top; nx = 0; ny = -1; }
        else if ((d -= r.width) < r.height) { ex = r.right; ey = r.top + d; nx = 1; ny = 0; }
        else if ((d -= r.height) < r.width) { ex = r.right - d; ey = r.bottom; nx = 0; ny = 1; }
        else { d -= r.width; ex = r.left; ey = r.bottom - d; nx = -1; ny = 0; }
        const s = rnd(40, 160);
        flake(ex, ey, nx * s + rnd(-30, 30), ny * s + rnd(-30, 30) - 20, rnd(0.4, 0.9), rnd(1.5, 3.2), Math.random() < 0.3 ? '#f3e9e4' : pick(EMBER));
      }
      for (let i = 0; i < 6; i++) glyph(rnd(r.left, r.right), rnd(r.top, r.bottom), rnd(-50, 50), rnd(-90, -40), rnd(0.7, 1.2), rnd(10, 15));
    } else {
      for (let i = 0; i < 3; i++) glyph(px + rnd(-8, 8), py + rnd(-8, 8), rnd(-30, 30), rnd(-70, -30), rnd(0.8, 1.3), rnd(10, 14));
    }
  }, true);
  addEventListener('pointerup', raiseSoon, true);
  document.addEventListener('open', raiseSoon, true);

  const roundRect = (rx0, ry0, w, h, r) => { x.beginPath(); x.roundRect ? x.roundRect(rx0, ry0, w, h, r) : x.rect(rx0, ry0, w, h); };

  let last = performance.now(), clock = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, W, H);
    rx += (mx - rx) * Math.min(1, dt * 14); ry += (my - ry) * Math.min(1, dt * 14);
    hover += ((hoverTarget && !native ? 1 : 0) - hover) * Math.min(1, dt * 12);
    press = Math.max(0, press - dt * 4);
    if (shown && Math.random() < dt * 8) flake(mx + rnd(-4, 4), my + rnd(-2, 4), rnd(-8, 8), rnd(-40, -18), rnd(0.6, 1.2), rnd(1.2, 2.4)); // idle smoulder
    if (shown && Math.random() < dt * 1.2) glyph(mx + rnd(-8, 8), my + rnd(-4, 6), rnd(-6, 6), rnd(-30, -14), rnd(1, 1.6), rnd(9, 12));

    x.globalCompositeOperation = 'lighter';
    // button outlines flaring outward after a click
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      f.t += dt;
      const k = f.t / 0.5;
      if (k >= 1) { frames.splice(i, 1); continue; }
      const e = 1 - Math.pow(1 - k, 3), g = e * 12, a = (1 - k) * (1 - k);
      roundRect(f.x - g, f.y - g, f.w + g * 2, f.h + g * 2, f.round + g);
      x.setLineDash([4, 3]); x.lineDashOffset = -f.t * 60;
      x.strokeStyle = `rgba(255,122,46,${0.9 * a})`; x.lineWidth = 2; x.stroke();
      x.setLineDash([]);
      if (k < 0.3) { roundRect(f.x, f.y, f.w, f.h, f.round); x.fillStyle = `rgba(239,59,69,${0.35 * (1 - k / 0.3)})`; x.fill(); } // flash
    }
    // flakes and glyphs
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.life -= dt;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      const k = p.life / p.max;
      p.vx *= 1 - dt * 2.2; p.vy = p.vy * (1 - dt * 2.2) - dt * 40; // drag, then a ghostly updraft
      p.vx += Math.sin(clock * 3 + p.py * 0.05) * dt * 30;
      p.px += p.vx * dt; p.py += p.vy * dt;
      if (p.ch) {
        if ((p.flick -= dt) < 0) { p.ch = pick(GLYPHS); p.flick = rnd(0.06, 0.22); }
        x.font = `${p.size | 0}px ${MONO}`; x.textAlign = 'center'; x.textBaseline = 'middle';
        x.globalAlpha = Math.min(1, k * 1.5) * 0.85; x.fillStyle = p.c;
        x.fillText(p.ch, p.px, p.py);
      } else {
        const s = p.size * (0.5 + 0.5 * k), h = s * 2.6;
        x.globalAlpha = k * 0.22; x.fillStyle = p.c;
        x.fillRect(p.px - h / 2, p.py - h / 2, h, h); // soft square halo
        x.globalAlpha = Math.min(1, k * 1.4);
        x.fillRect(Math.round(p.px - s / 2), Math.round(p.py - s / 2), Math.max(1, Math.round(s)), Math.max(1, Math.round(s)));
      }
      x.globalAlpha = 1;
    }
    x.globalCompositeOperation = 'source-over';

    if (shown && !native) {
      const idle = 1 - hover;
      if (idle > 0.02) {
        // default: dashed square ring trailing behind, square motes circling it, a glowing square at the tip
        x.globalAlpha = idle;
        const R = 12 - press * 4;
        x.save(); x.translate(rx, ry); x.rotate(clock * 0.9);
        x.strokeStyle = 'rgba(239,59,69,0.75)'; x.lineWidth = 1.5; x.setLineDash([4, 4]); x.lineDashOffset = -clock * 16;
        x.strokeRect(-R, -R, R * 2, R * 2); x.setLineDash([]);
        x.restore();
        x.fillStyle = '#ff7a2e';
        for (let m = 0; m < 3; m++) {
          const a = clock * 1.8 + m * TAU / 3;
          x.fillRect(rx + Math.cos(a) * (R + 6) - 1.5, ry + Math.sin(a) * (R + 6) - 1.5, 3, 3);
        }
        const fl = 0.85 + 0.15 * Math.sin(clock * 23) * Math.sin(clock * 7.3), cr = (6 + press * 4) * fl;
        const g = x.createRadialGradient(mx, my, 0, mx, my, cr * 2.6);
        g.addColorStop(0, 'rgba(255,240,235,0.9)'); g.addColorStop(0.3, 'rgba(239,59,69,0.7)'); g.addColorStop(1, 'rgba(196,18,31,0)');
        x.fillStyle = g; x.fillRect(mx - cr * 2.6, my - cr * 2.6, cr * 5.2, cr * 5.2);
        x.fillStyle = '#fff'; x.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 4, 4);
        x.globalAlpha = 1;
      }
      if (hover > 0.02) {
        // over something clickable: target brackets snap in around a pointing hand
        x.globalAlpha = hover;
        const B = 20 - hover * 4 + press * 3, L = 6, cx = mx + 4, cy = my + 10;
        x.strokeStyle = '#ff7a2e'; x.lineWidth = 2;
        x.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          x.moveTo(cx + sx * B, cy + sy * (B - L)); x.lineTo(cx + sx * B, cy + sy * B); x.lineTo(cx + sx * (B - L), cy + sy * B);
        }
        x.stroke();
        if (hand) {
          const s = 1 - press * 0.12, ox = mx - hand.tx * s, oy = my - hand.ty * s;
          x.save();
          x.shadowColor = 'rgba(239,59,69,0.9)'; x.shadowBlur = 10;
          x.drawImage(hand.c, ox, oy, hand.c.width * s, hand.c.height * s);
          x.restore();
        } else {
          x.fillStyle = '#fff'; x.fillRect(Math.round(mx) - 2, Math.round(my) - 2, 4, 4);
        }
        x.globalAlpha = 1;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
