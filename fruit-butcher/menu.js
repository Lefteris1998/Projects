'use strict';
// The menu's dressing, borrowed from the Projects page: "FRUIT BUTCHER" as a live pixel logo (../haunt-filter/pixel-logo.js)
// and square pixel blood that drips out of whatever level or weapon you hover.
(() => {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wrap = document.getElementById('logoWrap'), panel = document.querySelector('#menu .panel');
  const narrow = () => innerWidth < 600;
  pixelLogo(document.getElementById('fbLogo'), {
    text: 'FRUIT BUTCHER', cell: narrow() ? 4 : 5, pad: 14,
    width: () => Math.min(wrap.getBoundingClientRect().width, 560),
  });

  // one drip at (x, y) inside host, which must be position: relative. sizes stay on the 4px grid
  const rnd = (a, b) => a + Math.random() * (b - a);
  const px4 = (a, b) => 4 * Math.round(rnd(a, b) / 4);
  const drip = (host, x, y) => {
    const d = document.createElement('span');
    d.className = 'drip';
    d.style.cssText = `left:${x}px;top:${y}px;--len:${px4(12, 32)}px;--w:${Math.random() < 0.6 ? 4 : 8}px;--t:${rnd(0.7, 1.6).toFixed(2)}s;--fall:${px4(40, 90)}px`;
    host.append(d);
    d.addEventListener('animationend', (e) => { if (e.animationName === 'drip-life') d.remove(); });
  };
  // the buttons are rebuilt every time the menu opens, so hover is tracked on the panel
  let hovered = null, timer = 0;
  const bleed = () => {
    if (!hovered || !hovered.isConnected) return;
    const pr = panel.getBoundingClientRect(), r = hovered.getBoundingClientRect();
    drip(panel, Math.round(r.left - pr.left + rnd(16, r.width - 16)), Math.round(r.bottom - pr.top + panel.scrollTop - 2));
  };
  panel.addEventListener('pointerover', (e) => {
    if (still || e.pointerType === 'touch') return;
    const b = e.target.closest('.lvl-btn, .wpn');
    if (b === hovered) return;
    hovered = b; clearInterval(timer);
    if (b) { bleed(); bleed(); timer = setInterval(bleed, 260); }
  });
  panel.addEventListener('pointerleave', () => { hovered = null; clearInterval(timer); });
})();
