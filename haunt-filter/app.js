'use strict';
// Haunt Filter. Re-renders any image in Statue Poop Defender's HAUNT style: the picture is sampled into a grid of cells,
// each lit cell gets a dim square plus a glyph (katakana in the darks, a block ramp in the brights, orange + on edges),
// squares flake off and stream away, and the whole thing blooms. Every size is relative to the grid, so the export is
// the exact frame you see in the preview, just rendered at full resolution.
(() => {
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = (t) => t * t * (3 - 2 * t);
  const hash = (i, j, k) => {
    let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const hex = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const lvl8 = (x) => clamp(Math.round(x * 8) - 1, 0, 7);

  const RAMP = ['·', ':', '+', '×', '□', '#', '▣', '█'];
  const KANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'];
  // low: random glyph per flicker tick for the darker cells. high: picked by brightness
  const SETS = {
    haunt: { name: 'Haunt (kana + blocks)', low: KANA, high: RAMP },
    blocks: { name: 'Blocks only', low: null, high: RAMP },
    kana: { name: 'Katakana only', low: KANA, high: null },
    ascii: { name: 'ASCII', low: null, high: [...'.:-=+*#%@'] },
    binary: { name: 'Binary', low: ['0', '1'], high: null },
  };
  for (const s of Object.values(SETS)) { // one glyph atlas per set: high, then low, then the edge +
    s.atlas = [...(s.high || []), ...(s.low || []), '+'];
    s.lowAt = (s.high || []).length; s.edge = s.atlas.length - 1;
  }

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------
  const CONTROLS = [
    ['Look', [
      { id: 'cols', label: 'Detail (cells across)', min: 40, max: 420, step: 1, def: 160, dp: 0 },
      { id: 'exposure', label: 'Exposure', min: 0.3, max: 4, step: 0.01, def: 1.5 },
      { id: 'black', label: 'Black point', min: 0, max: 0.5, step: 0.005, def: 0.035, dp: 3 },
      { id: 'gamma', label: 'Contrast curve', min: 0.4, max: 3, step: 0.01, def: 1.5 },
      { id: 'cutoff', label: 'Cutoff (hide darks)', min: 0, max: 0.6, step: 0.005, def: 0.06, dp: 3 },
      { id: 'paper', label: 'Paper mode (ink on white)', type: 'toggle', def: false, hint: 'for light backgrounds: dark parts get drawn' },
    ]],
    ['Color', [
      { id: 'boost', label: 'Color boost', min: 1, max: 6, step: 0.05, def: 4 },
      { id: 'mono', label: 'Single color', type: 'toggle', def: false },
      { id: 'tint', label: 'Color', type: 'color', def: '#e8e8e4' },
      { id: 'mix', label: 'Mix in original', min: 0, max: 1, step: 0.01, def: 0, hint: 'keeps the photo detail under the effect' },
    ]],
    ['Squares', [
      { id: 'sqOpacity', label: 'Opacity', min: 0, max: 2, step: 0.01, def: 1 },
      { id: 'sqMin', label: 'Smallest size', min: 0.1, max: 1, step: 0.01, def: 0.5 },
    ]],
    ['Glyphs', [
      { id: 'glyphSet', label: 'Glyph set', type: 'select', def: 'haunt', options: Object.entries(SETS).map(([k, s]) => [k, s.name]) },
      { id: 'glyphOpacity', label: 'Opacity', min: 0, max: 2, step: 0.01, def: 1 },
      { id: 'split', label: 'Kana → blocks at', min: 0, max: 1, step: 0.01, def: 0.45 },
      { id: 'flicker', label: 'Flicker rate', min: 0, max: 12, step: 0.1, def: 1.5, dp: 1 },
    ]],
    ['Edges', [
      { id: 'edgeDensity', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.5 },
      { id: 'edgeThr', label: 'Sensitivity', min: 0.02, max: 0.6, step: 0.005, def: 0.14, dp: 3, invert: true },
      { id: 'edgeColor', label: 'Color', type: 'color', def: '#ff7a2e' },
    ]],
    ['Particles', [
      { id: 'streamChance', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.6 },
      { id: 'streamCount', label: 'Per cell', min: 0, max: 6, step: 1, def: 2, dp: 0 },
      { id: 'streamLen', label: 'Distance (cells)', min: 1, max: 40, step: 0.5, def: 9, dp: 1 },
      { id: 'streamSpeed', label: 'Speed', min: 0, max: 4, step: 0.01, def: 1 },
      { id: 'streamAngle', label: 'Direction (°)', min: -180, max: 180, step: 1, def: 0, dp: 0 },
      { id: 'streamSpread', label: 'Spread', min: 0, max: 4, step: 0.01, def: 1 },
      { id: 'streamRise', label: 'Drift', min: -4, max: 4, step: 0.01, def: 1 },
      { id: 'streamSize', label: 'Size', min: 0.2, max: 3, step: 0.01, def: 1 },
      { id: 'streamOpacity', label: 'Opacity', min: 0, max: 1.5, step: 0.01, def: 1 },
    ]],
    ['Glow & finish', [
      { id: 'glow', label: 'Glow', min: 0, max: 3, step: 0.01, def: 1 },
      { id: 'glowRadius', label: 'Glow radius', min: 0.2, max: 4, step: 0.01, def: 1 },
      { id: 'fade', label: 'Fade bottom', min: 0, max: 1, step: 0.01, def: 0 },
      { id: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.01, def: 0.6 },
      { id: 'scanlines', label: 'Scanlines', min: 0, max: 1, step: 0.01, def: 0.25 },
    ]],
    ['Motion', [
      { id: 'speed', label: 'Animation speed', min: 0, max: 3, step: 0.01, def: 1 },
    ]],
  ];
  const ALL = CONTROLS.flatMap(([, list]) => list);
  const DEFAULTS = Object.fromEntries(ALL.map((c) => [c.id, c.def]));
  const PRESETS = {
    'Game (default)': {},
    'Paper ink': { paper: true, mono: true, tint: '#101012', exposure: 1.6, edgeDensity: 0, glow: 0.35, vignette: 0, scanlines: 0, streamChance: 0.75, sqOpacity: 1.3, glyphOpacity: 0.8 },
    'Dissolve': { streamChance: 1, streamCount: 4, streamLen: 18, sqMin: 0.3, streamSpread: 1.6, glyphOpacity: 0.7, glow: 1.3 },
    'Matrix rain': { mono: true, tint: '#5bff7a', glyphSet: 'kana', streamAngle: 90, streamLen: 14, streamRise: 0, streamSpread: 0.3, edgeColor: '#d8ffd8', flicker: 6, sqOpacity: 0.55, glow: 1.4 },
    'Neon ASCII': { glyphSet: 'ascii', sqOpacity: 0.25, boost: 6, glow: 2, glowRadius: 1.4, streamChance: 0.3, cols: 200 },
    'Photo + haunt': { mix: 0.45, glow: 0.8, vignette: 0.3, streamChance: 0.8 },
    // the keepers from the random batch
    '#02': {cols: 230, exposure: 1.01, black: 0.05, gamma: 1.63, cutoff: 0.206, paper: true, boost: 2.9, mono: true, tint: '#9426d8', mix: 0, sqOpacity: 0.51, sqMin: 0.77, glyphSet: 'ascii', glyphOpacity: 1.67, split: 0.51, flicker: 0.7, edgeDensity: 0.62, edgeThr: 0.164, edgeColor: '#e19536', streamChance: 0.34, streamCount: 4, streamLen: 23.6, streamSpeed: 2.73, streamAngle: -168, streamSpread: 0.18, streamRise: -2.38, streamSize: 0.7, streamOpacity: 1.02, glow: 0.75, glowRadius: 2.8, fade: 0, vignette: 0.59, scanlines: 0.71, speed: 2},
    '#09': {cols: 201, exposure: 1.42, black: 0.098, gamma: 1.03, cutoff: 0.209, paper: false, boost: 1.23, mono: true, tint: '#dd4d2e', mix: 0.19, sqOpacity: 0.52, sqMin: 0.45, glyphSet: 'kana', glyphOpacity: 1.16, split: 0.6, flicker: 3.5, edgeDensity: 0.19, edgeThr: 0.19, edgeColor: '#b9c0f3', streamChance: 0.89, streamCount: 1, streamLen: 28, streamSpeed: 2.8, streamAngle: 84, streamSpread: 0.74, streamRise: 2, streamSize: 1.84, streamOpacity: 1.43, glow: 0.51, glowRadius: 2.1, fade: 0, vignette: 0.41, scanlines: 0.16, speed: 1.1},
    '#11': {cols: 185, exposure: 0.92, black: 0.074, gamma: 2.24, cutoff: 0.209, paper: false, boost: 2.75, mono: false, tint: '#ec54d1', mix: 0.1, sqOpacity: 0.06, sqMin: 0.95, glyphSet: 'blocks', glyphOpacity: 1.65, split: 0.49, flicker: 8.5, edgeDensity: 0.09, edgeThr: 0.158, edgeColor: '#94c6e6', streamChance: 0.2, streamCount: 1, streamLen: 16, streamSpeed: 2.99, streamAngle: 32, streamSpread: 0.93, streamRise: -2.69, streamSize: 0.88, streamOpacity: 0.83, glow: 0.2, glowRadius: 1.95, fade: 0, vignette: 0.09, scanlines: 0.36, speed: 0.91},
    '#16': {cols: 146, exposure: 2.62, black: 0.082, gamma: 2.37, cutoff: 0.173, paper: false, boost: 3.67, mono: true, tint: '#e1a0fa', mix: 0.32, sqOpacity: 1.2, sqMin: 0.53, glyphSet: 'blocks', glyphOpacity: 1.47, split: 0.66, flicker: 9.2, edgeDensity: 0.88, edgeThr: 0.137, edgeColor: '#45fed8', streamChance: 0.81, streamCount: 5, streamLen: 28.4, streamSpeed: 1.77, streamAngle: 133, streamSpread: 2.66, streamRise: -2.09, streamSize: 1.07, streamOpacity: 1.22, glow: 0.84, glowRadius: 1.55, fade: 0, vignette: 0.07, scanlines: 0.22, speed: 0.59},
    '#17': {cols: 124, exposure: 0.89, black: 0.039, gamma: 1.52, cutoff: 0.003, paper: false, boost: 1.66, mono: true, tint: '#afef20', mix: 0, sqOpacity: 0.17, sqMin: 0.62, glyphSet: 'ascii', glyphOpacity: 1.47, split: 0.6, flicker: 4.8, edgeDensity: 0.08, edgeThr: 0.148, edgeColor: '#b966e3', streamChance: 0.27, streamCount: 2, streamLen: 22.2, streamSpeed: 2.81, streamAngle: -175, streamSpread: 1.03, streamRise: 1.16, streamSize: 2.13, streamOpacity: 1.13, glow: 0.86, glowRadius: 3, fade: 0, vignette: 0.38, scanlines: 0.43, speed: 1.39},
    '#20': {cols: 103, exposure: 1.42, black: 0.108, gamma: 1.3, cutoff: 0.174, paper: false, boost: 4.12, mono: true, tint: '#7e2af5', mix: 0, sqOpacity: 0.52, sqMin: 0.35, glyphSet: 'binary', glyphOpacity: 1.24, split: 0.62, flicker: 8.5, edgeDensity: 0.46, edgeThr: 0.254, edgeColor: '#ace32e', streamChance: 0.5, streamCount: 2, streamLen: 18.9, streamSpeed: 1.32, streamAngle: 63, streamSpread: 2.1, streamRise: 2.21, streamSize: 1.4, streamOpacity: 1.39, glow: 2.42, glowRadius: 2.52, fade: 0.97, vignette: 0.79, scanlines: 0.75, speed: 1.59},
    '#21': {cols: 106, exposure: 0.81, black: 0.001, gamma: 2.35, cutoff: 0.189, paper: false, boost: 1.9, mono: false, tint: '#f0b2de', mix: 0, sqOpacity: 1.01, sqMin: 0.8, glyphSet: 'blocks', glyphOpacity: 1.77, split: 0.38, flicker: 9.7, edgeDensity: 0.41, edgeThr: 0.168, edgeColor: '#0dde45', streamChance: 0.93, streamCount: 2, streamLen: 3.6, streamSpeed: 2.55, streamAngle: 115, streamSpread: 1.55, streamRise: -2.18, streamSize: 2.49, streamOpacity: 1.21, glow: 1.63, glowRadius: 2.07, fade: 0.88, vignette: 0.02, scanlines: 0.32, speed: 1.42},
    '#30': {cols: 84, exposure: 1.47, black: 0.037, gamma: 1.72, cutoff: 0.126, paper: false, boost: 5.1, mono: false, tint: '#b1efdc', mix: 0.56, sqOpacity: 1.49, sqMin: 0.45, glyphSet: 'blocks', glyphOpacity: 1.31, split: 0.51, flicker: 1.9, edgeDensity: 0.45, edgeThr: 0.112, edgeColor: '#d789ec', streamChance: 0.61, streamCount: 2, streamLen: 11.1, streamSpeed: 1.31, streamAngle: -94, streamSpread: 0.22, streamRise: -2.54, streamSize: 2.03, streamOpacity: 1.31, glow: 0.26, glowRadius: 2.92, fade: 0, vignette: 0.25, scanlines: 0.29, speed: 1.06},
    '#40': {cols: 229, exposure: 0.91, black: 0.117, gamma: 2.38, cutoff: 0.013, paper: false, boost: 3.48, mono: true, tint: '#c8a82d', mix: 0, sqOpacity: 0.6, sqMin: 0.86, glyphSet: 'ascii', glyphOpacity: 0.71, split: 0.47, flicker: 2.5, edgeDensity: 0.41, edgeThr: 0.139, edgeColor: '#f77f45', streamChance: 0.77, streamCount: 3, streamLen: 11, streamSpeed: 2.94, streamAngle: 139, streamSpread: 0.48, streamRise: -2.95, streamSize: 0.88, streamOpacity: 1.33, glow: 1.04, glowRadius: 2.34, fade: 0.29, vignette: 0.98, scanlines: 0.55, speed: 0.64},
    // made in the app with Export preset
    'My preset': { cols: 82, exposure: 0.3, black: 0.025, boost: 2.85, mono: true, tint: '#5bff7a', sqOpacity: 0.18, glyphSet: 'kana', glyphOpacity: 0.99, split: 0.42, flicker: 5, edgeDensity: 0.22, edgeThr: 0.16, edgeColor: '#d8ffd8', streamLen: 12, streamSpeed: 0.11, streamAngle: -48, streamSpread: 0.3, streamRise: 0, streamSize: 0.74, glow: 1.4 },
  };

  const STORE = 'haunt-filter:v1';
  const P = { ...DEFAULTS };
  try { Object.assign(P, JSON.parse(localStorage.getItem(STORE)) || {}); } catch {}
  let saveTimer = 0;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(P)); } catch {} }, 300); };

  const inputs = {};
  const fmt = (c, v) => c.type ? v : Number(v).toFixed(c.dp ?? 2);
  let current = '';
  function buildPanel() {
    const panel = $('panel');
    // presets first; the raw sliders live behind "Modify settings"
    panel.innerHTML = '<h2 class="ptitle">Presets</h2>';
    const list = document.createElement('div'); list.className = 'presets'; list.id = 'presets';
    for (const k of Object.keys(PRESETS)) {
      const b = document.createElement('button'); b.textContent = k; b.dataset.p = k;
      b.onclick = () => applyPreset(k);
      list.append(b);
    }
    const more = document.createElement('button'); more.className = 'more'; more.textContent = 'Modify settings';
    const settings = document.createElement('div'); settings.className = 'settings'; settings.hidden = true;
    more.onclick = () => { settings.hidden = !settings.hidden; panel.classList.toggle('open', !settings.hidden); };
    panel.append(list, more, settings);

    for (const [title, list] of CONTROLS) {
      const det = document.createElement('details'); det.open = title !== 'Motion';
      det.innerHTML = `<summary>${title}</summary>`;
      for (const c of list) {
        const row = document.createElement('div'); row.className = 'ctl' + (c.type && c.type !== 'select' ? ' row' : '');
        const lab = document.createElement('label'); lab.textContent = c.label; lab.htmlFor = 'c_' + c.id;
        let el, out = null;
        if (c.type === 'toggle') { el = document.createElement('input'); el.type = 'checkbox'; }
        else if (c.type === 'color') { el = document.createElement('input'); el.type = 'color'; }
        else if (c.type === 'select') {
          el = document.createElement('select');
          for (const [v, name] of c.options) el.add(new Option(name, v));
          row.classList.add('row');
        } else {
          el = document.createElement('input'); el.type = 'range'; el.min = c.min; el.max = c.max; el.step = c.step;
          out = document.createElement('output');
          // double-click a slider to put it back
          el.addEventListener('dblclick', () => { P[c.id] = c.def; sync(); changed(); });
        }
        el.id = 'c_' + c.id;
        el.addEventListener('input', () => {
          P[c.id] = c.type === 'toggle' ? el.checked : c.type ? el.value : Number(el.value);
          if (out) out.value = fmt(c, P[c.id]);
          markPreset('');
          changed();
        });
        row.append(lab);
        if (out) row.append(out);
        row.append(el);
        if (c.hint) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = c.hint; row.append(h); }
        inputs[c.id] = { el, out, c };
        det.append(row);
      }
      settings.append(det);
    }
    const reset = document.createElement('button'); reset.className = 'btn reset'; reset.textContent = 'Reset settings';
    reset.onclick = () => applyPreset('Game (default)');
    const share = document.createElement('button'); share.className = 'go reset'; share.textContent = 'Export preset';
    share.onclick = openPresetCode;
    settings.append(share, reset);
    sync();
    try { markPreset(localStorage.getItem(STORE + ':preset') || ''); } catch {}
  }
  function markPreset(name) {
    current = PRESETS[name] ? name : '';
    for (const b of $('presets').children) b.classList.toggle('on', b.dataset.p === current);
    try { localStorage.setItem(STORE + ':preset', current); } catch {}
  }
  // the current settings as one line that drops straight into PRESETS. only what differs from the game default is written
  function presetCode() {
    const name = ($('presetName').value.trim() || 'My preset').replace(/\\/g, '').replace(/'/g, '’');
    const diff = ALL.filter((c) => P[c.id] !== c.def).map((c) => {
      const v = P[c.id];
      return `${c.id}: ${typeof v === 'number' ? +v.toFixed(c.dp ?? 3) : typeof v === 'string' ? `'${v}'` : v}`;
    });
    return `'${name}': { ${diff.join(', ')} },`;
  }
  function openPresetCode() {
    if (!$('presetName').value) $('presetName').value = current && current !== 'Game (default)' ? current + ' edit' : '';
    $('presetCode').value = presetCode();
    $('presetBox').hidden = false;
    $('presetName').focus();
  }
  // debug: walk the list with the arrow keys
  function stepPreset(d) {
    const keys = Object.keys(PRESETS), i = keys.indexOf(current);
    const k = keys[(i < 0 ? (d > 0 ? 0 : keys.length - 1) : (i + d + keys.length) % keys.length)];
    applyPreset(k);
    $('presets').querySelector(`[data-p="${CSS.escape(k)}"]`)?.scrollIntoView({ block: 'nearest' });
  }
  function sync() {
    for (const { el, out, c } of Object.values(inputs)) {
      if (c.type === 'toggle') el.checked = !!P[c.id];
      else el.value = P[c.id];
      if (out) out.value = fmt(c, P[c.id]);
    }
  }
  function applyPreset(name) {
    Object.assign(P, DEFAULTS, PRESETS[name]);
    sync(); changed();
    markPreset(name);
  }
  function changed() { dirty = true; persist(); }

  // ---------------------------------------------------------------------------
  // Image in
  // ---------------------------------------------------------------------------
  // the open picture, plus the debug multi-image set. each is { img, proxy, name, sampled }
  let img = null, proxy = null, baseName = 'image', main = null;
  const multi = [];
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
  // halve repeatedly before the last step, so big photos shrink without aliasing
  function downscale(src, sw, sh, tw, th) {
    let cur = src, cw = sw, ch = sh;
    while (cw / 2 >= tw && ch / 2 >= th) {
      const nw = Math.round(cw / 2), nh = Math.round(ch / 2), c = mk(nw, nh), x = c.getContext('2d');
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, nw, nh);
      cur = c; cw = nw; ch = nh;
    }
    const out = mk(tw, th), x = out.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, tw, th);
    return out;
  }
  async function readImage(file, maxSide = 2048) {
    if (!file || !/^image\//.test(file.type)) { toast('That isn\'t an image.'); return null; }
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.decoding = 'async';
    im.src = url;
    try { await im.decode(); } catch { URL.revokeObjectURL(url); toast('Couldn\'t read that image.'); return null; }
    const W = im.width, H = im.height, k = Math.min(1, maxSide / Math.max(W, H));
    return { img: im, proxy: downscale(im, W, H, Math.round(W * k), Math.round(H * k)), name: file.name || 'pasted image', sampled: null };
  }
  async function loadFile(file) {
    if (multiOn) return addMulti([file]);
    const m = await readImage(file);
    if (!m) return;
    if (cropping) closeCrop();
    // orig stays untouched so the crop can always be redone from the full picture
    m.orig = m.img; m.origProxy = m.proxy; m.crop = null;
    main = m; img = m.img; proxy = m.proxy;
    baseName = m.name.replace(/\.[^.]+$/, '') || 'image';
    $('drop').hidden = true; $('view').hidden = false; $('exportBtn').disabled = false; $('cropBtn').disabled = false;
    showInfo();
    fit(); dirty = true;
  }
  const showInfo = () => {
    $('info').textContent = `${main.name} · ${img.width} × ${img.height}` + (main.crop ? ` (cropped from ${main.orig.width} × ${main.orig.height})` : '');
  };

  // ---------------------------------------------------------------------------
  // Crop, done on the original before anything gets filtered
  // ---------------------------------------------------------------------------
  let cropping = false, cr = null, cropK = 1, drag = null;
  const MIN_CROP = 16;
  function openCrop() {
    if (!main || multiOn || busy) return;
    cropping = true;
    $('crop').hidden = false; $('view').hidden = true; $('info').hidden = true;
    cr = main.crop ? { ...main.crop } : { x: 0, y: 0, w: main.orig.width, h: main.orig.height };
    layoutCrop();
  }
  function closeCrop() {
    cropping = false; drag = null;
    $('crop').hidden = true; $('view').hidden = !img || multiOn; $('info').hidden = multiOn;
    fit(); dirty = true;
  }
  function layoutCrop() {
    const o = main.orig, sr = stage.getBoundingClientRect();
    cropK = Math.min((sr.width - 48) / o.width, (sr.height - 48 - 60) / o.height);
    const w = o.width * cropK, h = o.height * cropK, cv = $('cropImg'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    $('cropWrap').style.width = cv.style.width = w + 'px'; $('cropWrap').style.height = cv.style.height = h + 'px';
    cv.width = Math.max(1, Math.round(w * dpr)); cv.height = Math.max(1, Math.round(h * dpr));
    drawOriginal(cv, main.origProxy);
    drawBox();
  }
  function drawBox() {
    const b = $('cropBox').style;
    b.left = cr.x * cropK + 'px'; b.top = cr.y * cropK + 'px'; b.width = cr.w * cropK + 'px'; b.height = cr.h * cropK + 'px';
    $('cropSize').textContent = `${Math.round(cr.w)} × ${Math.round(cr.h)}`;
  }
  const cropRatio = () => { const v = $('cropAspect').value; return v === 'orig' ? main.orig.width / main.orig.height : Number(v); };
  // biggest box of the chosen ratio around the current centre
  function fitRatio() {
    const a = cropRatio(), W = main.orig.width, H = main.orig.height;
    if (!a) return;
    const cx = cr.x + cr.w / 2, cy = cr.y + cr.h / 2;
    let w = Math.max(cr.w, cr.h * a), h = w / a;
    const k = Math.min(1, W / w, H / h); w *= k; h *= k;
    cr = { x: clamp(cx - w / 2, 0, W - w), y: clamp(cy - h / 2, 0, H - h), w, h };
    drawBox();
  }
  // h is a handle (n, se, ...), 'move', or 'new' for a fresh box dragged out from an empty spot
  function dragTo(px, py) {
    const W = main.orig.width, H = main.orig.height, s = drag.start, h = drag.h, a = cropRatio();
    px = clamp(px, 0, W); py = clamp(py, 0, H);
    if (h === 'move') {
      cr.x = clamp(s.x + px - drag.px, 0, W - s.w); cr.y = clamp(s.y + py - drag.py, 0, H - s.h);
      return drawBox();
    }
    const corner = h === 'new' || h.length === 2;
    if (!a) { // free: just move whichever sides the handle owns
      let x0 = s.x, y0 = s.y, x1 = s.x + s.w, y1 = s.y + s.h;
      if (h === 'new') { x0 = drag.px; y0 = drag.py; x1 = px; y1 = py; }
      else {
        if (h.includes('w')) x0 = px; if (h.includes('e')) x1 = px;
        if (h.includes('n')) y0 = py; if (h.includes('s')) y1 = py;
      }
      cr = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(MIN_CROP, Math.abs(x1 - x0)), h: Math.max(MIN_CROP, Math.abs(y1 - y0)) };
      cr.x = Math.min(cr.x, W - cr.w); cr.y = Math.min(cr.y, H - cr.h);
      return drawBox();
    }
    let w, hh, x, y;
    if (corner) { // the opposite corner stays put
      const ax = h === 'new' ? drag.px : h.includes('w') ? s.x + s.w : s.x, ay = h === 'new' ? drag.py : h.includes('n') ? s.y + s.h : s.y;
      const sx = px >= ax ? 1 : -1, sy = py >= ay ? 1 : -1;
      w = Math.abs(px - ax); hh = Math.abs(py - ay);
      if (w < hh * a) w = hh * a; else hh = w / a;
      const k = Math.min(1, (sx > 0 ? W - ax : ax) / w, (sy > 0 ? H - ay : ay) / hh); w *= k; hh *= k;
      x = sx > 0 ? ax : ax - w; y = sy > 0 ? ay : ay - hh;
    } else if (h === 'e' || h === 'w') { // the opposite edge stays put, height follows, centred
      const ax = h === 'w' ? s.x + s.w : s.x, sx = h === 'e' ? 1 : -1, cy = s.y + s.h / 2;
      w = Math.max(0, (px - ax) * sx); hh = w / a;
      const k = Math.min(1, (sx > 0 ? W - ax : ax) / w, 2 * Math.min(cy, H - cy) / hh); w *= k; hh *= k;
      x = sx > 0 ? ax : ax - w; y = cy - hh / 2;
    } else {
      const ay = h === 'n' ? s.y + s.h : s.y, sy = h === 's' ? 1 : -1, cx = s.x + s.w / 2;
      hh = Math.max(0, (py - ay) * sy); w = hh * a;
      const k = Math.min(1, (sy > 0 ? H - ay : ay) / hh, 2 * Math.min(cx, W - cx) / w); w *= k; hh *= k;
      x = cx - w / 2; y = sy > 0 ? ay : ay - hh;
    }
    if (!(w >= MIN_CROP && hh >= MIN_CROP)) return; // too small or degenerate: keep the last good box
    cr = { x, y, w, h: hh };
    drawBox();
  }
  function applyCrop() {
    const o = main.orig, x = Math.round(cr.x), y = Math.round(cr.y);
    const w = Math.min(o.width - x, Math.round(cr.w)), h = Math.min(o.height - y, Math.round(cr.h));
    if (w >= o.width && h >= o.height) { main.crop = null; main.img = o; main.proxy = main.origProxy; }
    else {
      main.crop = { x, y, w, h };
      const c = mk(w, h); c.getContext('2d').drawImage(o, x, y, w, h, 0, 0, w, h);
      const k = Math.min(1, 2048 / Math.max(w, h));
      main.img = c; main.proxy = downscale(c, w, h, Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
    }
    main.sampled = null; img = main.img; proxy = main.proxy;
    showInfo(); closeCrop();
  }
  {
    const wrap = $('cropWrap');
    const at = (e) => { const r = wrap.getBoundingClientRect(); return [(e.clientX - r.left) / cropK, (e.clientY - r.top) / cropK]; };
    wrap.addEventListener('pointerdown', (e) => {
      e.preventDefault(); wrap.setPointerCapture(e.pointerId);
      const [px, py] = at(e);
      drag = { h: e.target.dataset.h || (e.target.id === 'cropBox' ? 'move' : 'new'), px, py, start: { ...cr } };
    });
    wrap.addEventListener('pointermove', (e) => { if (drag) dragTo(...at(e)); });
    for (const ev of ['pointerup', 'pointercancel']) wrap.addEventListener(ev, () => (drag = null));
    $('cropAspect').onchange = fitRatio;
    $('cropReset').onclick = () => { cr = { x: 0, y: 0, w: main.orig.width, h: main.orig.height }; fitRatio(); drawBox(); };
    $('cropCancel').onclick = closeCrop;
    $('cropApply').onclick = applyCrop;
  }
  // the image squeezed down to one pixel per cell. paper mode flips it so the darks are what lights up
  function sample(m) {
    const c = P.cols | 0, r = Math.max(1, Math.round(c * m.img.height / m.img.width)), key = `${c}|${P.paper}`;
    if (m.sampled && m.sampled.key === key) return m.sampled;
    const proxy = m.proxy, raw = downscale(proxy, proxy.width, proxy.height, c, r).getContext('2d').getImageData(0, 0, c, r).data;
    const d = new Uint8ClampedArray(c * r * 4), L = new Float32Array(c * r);
    for (let n = 0, p = 0; n < c * r; n++, p += 4) {
      const a = raw[p + 3] / 255; // transparent counts as background
      let R = raw[p], G = raw[p + 1], B = raw[p + 2];
      if (P.paper) { R = 255 - R; G = 255 - G; B = 255 - B; }
      d[p] = R * a; d[p + 1] = G * a; d[p + 2] = B * a;
      L[n] = (0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]) / 255;
    }
    return (m.sampled = { key, c, r, d, L });
  }

  // ---------------------------------------------------------------------------
  // HAUNT renderer, resolution independent
  // ---------------------------------------------------------------------------
  const masks = new Map();
  function glyphMasks(chars, M) {
    const key = chars.join('') + M;
    let m = masks.get(key);
    if (!m) {
      const tc = mk(M * chars.length, M), c = tc.getContext('2d', { willReadFrequently: true });
      c.font = `${Math.round(M * 1.125)}px 'JetBrains Mono', monospace`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff';
      chars.forEach((ch, g) => c.fillText(ch, g * M + M / 2, M / 2));
      const d = c.getImageData(0, 0, tc.width, M).data;
      m = new Uint8Array(chars.length * M * M);
      for (let g = 0; g < chars.length; g++) for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) m[(g * M + y) * M + x] = d[(y * tc.width + g * M + x) * 4 + 3];
      masks.set(key, m);
    }
    return m;
  }
  if (document.fonts) document.fonts.ready.then(() => { masks.clear(); dirty = true; });

  const HAS_FILTER = 'filter' in CanvasRenderingContext2D.prototype;
  const glow = mk(1, 1), wx = glow.getContext('2d');
  function bloom(x, cv, alpha, radius) {
    if (alpha <= 0) return;
    const k = HAS_FILTER ? 4 : Math.max(4, radius * 1.5), gw = Math.ceil(cv.width / k), gh = Math.ceil(cv.height / k);
    if (glow.width !== gw || glow.height !== gh) { glow.width = gw; glow.height = gh; } else wx.clearRect(0, 0, gw, gh);
    wx.imageSmoothingEnabled = true; wx.imageSmoothingQuality = 'high';
    if (HAS_FILTER) wx.filter = `blur(${radius / k}px)`;
    wx.drawImage(cv, 0, 0, gw, gh);
    if (HAS_FILTER) wx.filter = 'none';
    x.save(); x.globalCompositeOperation = 'lighter'; x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    for (let a = alpha; a > 0.001; a -= 1) { x.globalAlpha = Math.min(1, a); x.drawImage(glow, 0, 0, cv.width, cv.height); }
    x.restore();
  }

  const bufs = new WeakMap();
  // draws one frame at time t into cv at whatever size cv is. src is what "mix in original" blends back over the top
  function render(cv, t, src, m = main) {
    const x = cv.getContext('2d'), W = cv.width, H = cv.height;
    const { c, r, d, L } = sample(m), Nn = c * r, CX = W / c, CY = H / r;
    let buf = bufs.get(cv);
    if (!buf || buf.width !== W || buf.height !== H) { buf = x.createImageData(W, H); bufs.set(cv, buf); }
    const o = buf.data;
    new Uint32Array(o.buffer).fill(0xff000000); // opaque black

    // a filled square, alpha-blended into the buffer
    const rect = (rx, ry, s, R, G, B, A) => {
      let x0 = Math.round(rx), y0 = Math.round(ry), x1 = Math.round(rx + s), y1 = Math.round(ry + s);
      if (x1 <= x0) x1 = x0 + 1; if (y1 <= y0) y1 = y0 + 1;
      x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(W, x1); y1 = Math.min(H, y1);
      const a = clamp(A, 0, 255) / 255, ia = 1 - a, aR = R * a, aG = G * a, aB = B * a;
      for (let yy = y0; yy < y1; yy++) for (let p = (yy * W + x0) * 4, e = (yy * W + x1) * 4; p < e; p += 4) {
        o[p] = o[p] * ia + aR; o[p + 1] = o[p + 1] * ia + aG; o[p + 2] = o[p + 2] * ia + aB;
      }
    };

    const set = SETS[P.glyphSet] || SETS.haunt, tick = Math.floor(t * P.flicker);
    const fade = new Float32Array(r);
    for (let j = 0; j < r; j++) fade[j] = 1 - P.fade * ease(clamp((j / r - 0.5) / 0.5, 0, 1));
    const tone = new Float32Array(Nn);
    for (let n = 0; n < Nn; n++) tone[n] = Math.pow(clamp((L[n] * P.exposure - P.black) * 1.6, 0, 1), P.gamma) * 1.15 * fade[(n / c) | 0];
    const cut = P.cutoff;
    let tint = hex(P.tint), edge = hex(P.edgeColor);
    if (P.paper) { tint = tint.map((v) => 255 - v); edge = edge.map((v) => 255 - v); } // flipped back at the end
    const ang = P.streamAngle * Math.PI / 180, ux = Math.cos(ang), uy = Math.sin(ang), ni = Math.round(ux), nj = Math.round(uy);
    const ts = t * P.streamSpeed, streams = P.streamCount | 0;

    const g = new Int16Array(Nn).fill(-1), ga = new Float32Array(Nn), rgb = new Uint8Array(Nn * 3);
    for (let j = 0; j < r; j++) for (let i = 0; i < c; i++) {
      const n = j * c + i, v = Math.min(1, tone[n]);
      if (v <= cut) continue;
      const l = L[n], k = 0.35 + 0.65 * fade[j], p4 = n * 4, m = n * 3;
      let R, G, B;
      if (P.mono) { R = tint[0] * k; G = tint[1] * k; B = tint[2] * k; }
      else {
        const mx = Math.max(d[p4], d[p4 + 1], d[p4 + 2]) || 1, f = Math.min(255 / mx, P.boost);
        R = Math.min(255, d[p4] * f) * k; G = Math.min(255, d[p4 + 1] * f) * k; B = Math.min(255, d[p4 + 2] * f) * k;
      }
      const hs = hash(i, j, 3), s = CX * (P.sqMin + (1 - P.sqMin) * hs), sx = i * CX + (CX - s) / 2, sy = j * CY + (CY - s) / 2;
      if (P.sqOpacity > 0) rect(sx, sy, s, R * 0.6, G * 0.6, B * 0.6, (90 + v * 110) * P.sqOpacity);
      // flakes stream off cells whose neighbour (in the stream direction) is dark
      if (streams && P.streamOpacity > 0 && hs < P.streamChance) {
        const ii = i + ni, jj = j + nj;
        if (ii >= 0 && ii < c && jj >= 0 && jj < r && tone[jj * c + ii] <= cut) {
          for (let q = 0; q < streams; q++) {
            const f = (ts * (0.35 + hs * 0.4) + hash(i, j, q)) % 1, qs = CX * (0.25 + 0.35 * hash(j, i, q)) * P.streamSize;
            const along = CX + f * CX * P.streamLen, side = (hash(i, j, q + 5) - 0.5) * CX * 3 * P.streamSpread - f * CX * P.streamRise;
            rect(sx + ux * along - uy * side, sy + uy * along + ux * side, qs, R, G, B, (1 - f) * 200 * P.streamOpacity);
          }
        }
      }
      if (P.edgeDensity > 0) {
        const e = (i < c - 1 ? Math.abs(l - L[n + 1]) : 0) + (j < r - 1 ? Math.abs(l - L[n + c]) : 0);
        if (e > P.edgeThr && hash(i, j, tick) < P.edgeDensity) { g[n] = set.edge; ga[n] = 1; rgb[m] = edge[0]; rgb[m + 1] = edge[1]; rgb[m + 2] = edge[2]; continue; }
      }
      rgb[m] = R; rgb[m + 1] = G; rgb[m + 2] = B;
      if (set.low && (v < P.split || !set.high)) { g[n] = set.lowAt + Math.floor(hash(i, j, tick) * set.low.length); ga[n] = (lvl8(0.25 + v) + 1) / 8; }
      else { g[n] = Math.min(set.high.length - 1, Math.floor(v * set.high.length)); ga[n] = (lvl8(0.3 + v) + 1) / 8; }
    }

    // glyphs are added on top, like the game's 'lighter' pass
    if (P.glyphOpacity > 0) {
      const M = Math.max(3, Math.round(Math.min(CX, CY))), mask = glyphMasks(set.atlas, M), go = P.glyphOpacity / 255;
      for (let n = 0; n < Nn; n++) {
        if (g[n] < 0) continue;
        const i = n % c, j = (n / c) | 0, ox = Math.round(i * CX + (CX - M) / 2), oy = Math.round(j * CY + (CY - M) / 2);
        const kk = ga[n] * go, R = rgb[n * 3] * kk, G = rgb[n * 3 + 1] * kk, B = rgb[n * 3 + 2] * kk, base = g[n] * M * M;
        const xa = Math.max(0, -ox), xb = Math.min(M, W - ox);
        for (let y = 0; y < M; y++) {
          const yy = oy + y;
          if (yy < 0 || yy >= H) continue;
          for (let xx = xa, p = (yy * W + ox + xa) * 4, q = base + y * M + xa; xx < xb; xx++, p += 4, q++) {
            const cov = mask[q];
            if (!cov) continue;
            o[p] += R * cov; o[p + 1] += G * cov; o[p + 2] += B * cov;
          }
        }
      }
    }
    x.putImageData(buf, 0, 0);

    // bloom twice like the game: a tight glow, then a wide one. radii scale with the picture
    const u = W / 1600 * P.glowRadius;
    bloom(x, cv, 0.9 * P.glow, 9 * u);
    bloom(x, cv, 0.45 * P.glow, 30 * u);

    x.save();
    if (P.vignette > 0) {
      const rx = W / 2 * Math.SQRT2, ry = H / 2 * Math.SQRT2;
      x.translate(W / 2, H / 2); x.scale(1, ry / rx);
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, rx);
      gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, `rgba(0,0,0,${0.8 * P.vignette})`);
      x.fillStyle = gr; x.fillRect(-rx, -rx, rx * 2, rx * 2);
      x.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (P.scanlines > 0) {
      const period = Math.max(3, Math.round(W * 3 / 1600)), lh = Math.max(1, Math.round(period / 3));
      x.fillStyle = `rgba(255,255,255,${0.08 * P.scanlines})`;
      for (let y = H - lh; y >= 0; y -= period) x.fillRect(0, y, W, lh);
    }
    if (P.paper) { x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); }
    if (P.mix > 0 && src) {
      x.globalCompositeOperation = 'source-over'; x.globalAlpha = P.mix;
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(src, 0, 0, W, H);
    }
    x.restore();
  }

  // ---------------------------------------------------------------------------
  // Preview
  // ---------------------------------------------------------------------------
  const view = $('view'), stage = $('stage');
  let t = 0, dirty = true, comparing = false, busy = false, last = performance.now();
  function fit() {
    if (cropping) layoutCrop();
    if (multiOn) return fitGrid();
    if (!img) return;
    const sr = stage.getBoundingClientRect(), pad = 24;
    const aw = Math.max(50, sr.width - pad * 2), ah = Math.max(50, sr.height - pad * 2);
    const k = Math.min(aw / img.width, ah / img.height);
    const cw = img.width * k, ch = img.height * k;
    // device pixels, capped so the preview stays smooth; the export renders at full size regardless
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    dpr = Math.min(dpr, Math.sqrt(2.4e6 / (cw * ch)));
    view.style.width = cw + 'px'; view.style.height = ch + 'px';
    view.width = Math.max(1, Math.round(cw * dpr)); view.height = Math.max(1, Math.round(ch * dpr));
    dirty = true;
  }
  new ResizeObserver(fit).observe(stage);

  const drawOriginal = (cv, src) => {
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, cv.width, cv.height);
  };
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    const shots = multiOn ? multi.map((m) => [m.cv, m]) : img && !cropping ? [[view, main]] : [];
    if (shots.length && !busy) {
      if (P.speed > 0) { t += dt * P.speed; dirty = true; }
      if (comparing) {
        for (const [cv, m] of shots) drawOriginal(cv, m.proxy);
        dirty = true; // redraw the effect on release
      } else if (dirty) { for (const [cv, m] of shots) render(cv, t, m.proxy, m); dirty = false; }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------------------------------------------------------------------------
  // Debug: up to 10 images side by side, all on the current settings. delete before shipping
  // ---------------------------------------------------------------------------
  const MULTI_MAX = 10, grid = $('grid');
  let multiOn = false;
  function setMulti(on) {
    if (on && cropping) closeCrop();
    multiOn = on; $('multiToggle').checked = on; $('cropBtn').disabled = on || !img;
    grid.hidden = !on;
    $('view').hidden = on || !img; $('drop').hidden = on || !!img;
    $('info').hidden = on;
    if (on && !multi.length) toast('Debug → Add images, or drop up to 10 here.');
    fit(); dirty = true;
  }
  async function addMulti(files) {
    files = [...files].filter((f) => /^image\//.test(f.type));
    const room = MULTI_MAX - multi.length;
    if (files.length > room) toast(`Only ${MULTI_MAX} at a time, kept the first ${Math.max(0, room)}.`);
    for (const f of files.slice(0, Math.max(0, room))) {
      const m = await readImage(f, 1024); // they're shown small, so a lighter proxy keeps ten of them smooth
      if (!m) continue;
      const cell = document.createElement('figure');
      m.cv = document.createElement('canvas');
      const cap = document.createElement('figcaption'); cap.textContent = m.name;
      cell.append(m.cv, cap); grid.append(cell); m.cell = cell;
      multi.push(m);
    }
    if (!multiOn) setMulti(true); else { fit(); dirty = true; }
  }
  function clearMulti() {
    for (const m of multi) { URL.revokeObjectURL(m.img.src); m.cell.remove(); }
    multi.length = 0; dirty = true;
  }
  // picks the column count that makes the cells biggest, then fits each picture inside its cell
  function fitGrid() {
    const n = multi.length;
    if (!n) return;
    const sr = stage.getBoundingClientRect(), gap = 8, pad = 12, capH = 18;
    const aw = sr.width - pad * 2, ah = sr.height - pad * 2;
    let best = 1, bestS = 0;
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols), cw = (aw - gap * (cols - 1)) / cols, ch = (ah - gap * (rows - 1)) / rows - capH;
      const s = Math.min(cw / 1.4, ch); // assume roughly landscape pictures
      if (s > bestS) { bestS = s; best = cols; }
    }
    const cols = best, rows = Math.ceil(n / cols);
    const cw = (aw - gap * (cols - 1)) / cols, ch = (ah - gap * (rows - 1)) / rows - capH;
    grid.style.gridTemplateColumns = `repeat(${cols}, ${cw}px)`;
    const budget = 2.4e6 / n;
    for (const m of multi) {
      const k = Math.min(cw / m.img.width, ch / m.img.height);
      const w = m.img.width * k, h = m.img.height * k;
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(budget / (w * h)));
      m.cv.style.width = w + 'px'; m.cv.style.height = h + 'px';
      m.cv.width = Math.max(1, Math.round(w * dpr)); m.cv.height = Math.max(1, Math.round(h * dpr));
    }
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  const MAX_AREA = 80e6, MAX_SIDE = 16384;
  let exFmt = 'png';
  const VIDEO_TYPES = ['video/mp4;codecs=avc1.640033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const videoType = () => window.MediaRecorder && VIDEO_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
  function openExport() {
    if (!img || cropping) return;
    $('exportBox').hidden = false;
    setFmt(exFmt);
  }
  function setFmt(f) {
    exFmt = f;
    for (const b of $('fmt').children) b.classList.toggle('on', b.dataset.f === f);
    const W = img.width, H = img.height, sel = $('exSize');
    sel.innerHTML = '';
    $('fpsRow').hidden = f !== 'gif';
    if (f === 'video') {
      const long = Math.max(W, H);
      for (const L of [1080, 1440, 2160]) {
        if (L > long && L !== 1080) continue;
        const k = Math.min(1, L / long), w = Math.round(W * k / 2) * 2, h = Math.round(H * k / 2) * 2;
        sel.add(new Option(`${w} × ${h}${k === 1 ? ' (original)' : ''}`, k));
      }
      $('durRow').hidden = false;
      const vt = videoType();
      $('exNote').textContent = vt ? `Records the motion in real time as ${vt.includes('mp4') ? 'MP4' : 'WebM'}. Larger sizes may stutter on slower machines; 1080 is the safe pick.` : 'This browser can\'t record video. Try Chrome or Edge.';
      $('exSave').disabled = !vt;
    } else if (f === 'gif') {
      const long = Math.max(W, H);
      for (const L of [320, 480, 640, 800, 1080]) {
        if (L >= long && L !== 320) break;
        const k = Math.min(1, L / long);
        sel.add(new Option(`${Math.round(W * k)} × ${Math.round(H * k)}${k === 1 ? ' (original)' : ''}`, k, L === 480, L === 480));
      }
      if (long < 1080 && long > 320) sel.add(new Option(`${W} × ${H} (original)`, 1));
      $('durRow').hidden = false;
      $('exNote').textContent = 'Rendered frame by frame, so it never stutters. GIF only has 256 colours per frame and the files get big fast: 480 for 3 to 5 seconds is a good default.';
      $('exSave').disabled = false;
    } else {
      for (const k of [1, 2, 3, 4]) {
        const w = Math.round(W * k), h = Math.round(H * k);
        if (k > 1 && (w * h > MAX_AREA || Math.max(w, h) > MAX_SIDE)) break;
        sel.add(new Option(`${w} × ${h}${k === 1 ? ' (original size)' : ` (${k}× upscale, sharper glyphs)`}`, k));
      }
      $('durRow').hidden = true;
      $('exNote').textContent = f === 'png'
        ? 'Lossless. Saves the exact frame in the preview, re-rendered at full resolution.'
        : 'JPEG at maximum quality: smaller file, tiny compression loss. Use PNG for zero loss.';
      $('exSave').disabled = false;
    }
  }
  // open the Save As dialog first, while the click still counts as a user gesture
  async function pickTarget(name, mime, ext, desc) {
    if (window.showSaveFilePicker) {
      try { return { handle: await window.showSaveFilePicker({ suggestedName: name, types: [{ description: desc, accept: { [mime.split(';')[0]]: [ext] } }] }), name }; }
      catch (e) { if (e.name === 'AbortError') return null; }
    }
    return { name }; // no picker (Firefox, Safari, iframes): plain download
  }
  async function write(target, blob) {
    if (target.handle) { const w = await target.handle.createWritable(); await w.write(blob); await w.close(); return; }
    const a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = target.name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  const nextFrame = () => new Promise((res) => requestAnimationFrame(() => setTimeout(res, 0)));

  async function exportStill(k, jpg) {
    const W = Math.round(img.width * k), H = Math.round(img.height * k);
    const mime = jpg ? 'image/jpeg' : 'image/png', ext = jpg ? '.jpg' : '.png';
    const target = await pickTarget(`${baseName}-haunt${ext}`, mime, ext, jpg ? 'JPEG image' : 'PNG image');
    if (!target) return;
    busy = true; toast(`Rendering ${W} × ${H}…`, 0);
    try {
      await nextFrame();
      const cv = mk(W, H);
      render(cv, t, img);
      toast('Encoding…', 0); await nextFrame();
      const blob = await new Promise((res) => cv.toBlob(res, mime, 1));
      if (!blob) throw new Error('the browser ran out of memory for an image this size');
      await write(target, blob);
      cv.width = cv.height = 1; bufs.delete(cv);
      toast(`Saved ${target.handle ? target.handle.name : target.name} · ${W} × ${H}`);
    } catch (e) { toast('Export failed: ' + e.message); }
    busy = false; dirty = true;
  }

  async function exportVideo(k, secs) {
    const vt = videoType(), mp4 = vt.includes('mp4'), ext = mp4 ? '.mp4' : '.webm';
    const W = Math.round(img.width * k / 2) * 2, H = Math.round(img.height * k / 2) * 2;
    const target = await pickTarget(`${baseName}-haunt${ext}`, vt, ext, mp4 ? 'MP4 video' : 'WebM video');
    if (!target) return;
    busy = true;
    try {
      const cv = mk(W, H), src = Math.max(W, H) > Math.max(proxy.width, proxy.height) ? img : proxy;
      render(cv, t, src);
      const stream = cv.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: vt, videoBitsPerSecond: Math.round(Math.min(80e6, Math.max(8e6, W * H * 30 * 0.25))) });
      const chunks = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const done = new Promise((res) => (rec.onstop = res));
      rec.start(250);
      const t0 = t, start = performance.now();
      for (;;) {
        const el = (performance.now() - start) / 1000;
        if (el >= secs) break;
        render(cv, t0 + el * P.speed, src);
        toast(`Recording ${Math.ceil(secs - el)}s…`, 0);
        await new Promise((res) => requestAnimationFrame(res));
      }
      rec.stop(); await done;
      stream.getTracks().forEach((tr) => tr.stop());
      t = t0 + secs * P.speed;
      await write(target, new Blob(chunks, { type: vt.split(';')[0] }));
      toast(`Saved ${target.handle ? target.handle.name : target.name} · ${W} × ${H}, ${secs}s`);
    } catch (e) { toast('Video export failed: ' + e.message); }
    busy = false; dirty = true;
  }

  // GIF encoder is only fetched the first time someone exports one
  let gifLib = null;
  const loadGif = () => (gifLib ||= import('https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js').catch((e) => { gifLib = null; throw e; }));
  async function exportGif(k, secs, fps) {
    const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k));
    const target = await pickTarget(`${baseName}-haunt.gif`, 'image/gif', '.gif', 'GIF animation');
    if (!target) return;
    busy = true; toast('Loading GIF encoder…', 0);
    try {
      let lib;
      try { lib = await loadGif(); } catch { throw new Error('couldn\'t load the GIF encoder (are you offline?)'); }
      const { GIFEncoder, quantize, applyPalette } = lib;
      const cv = mk(W, H), x = cv.getContext('2d', { willReadFrequently: true }), gif = GIFEncoder();
      const n = Math.max(1, Math.round(secs * fps)), delay = 1000 / fps, t0 = t;
      for (let i = 0; i < n; i++) {
        render(cv, t0 + i / fps * P.speed, proxy);
        const data = x.getImageData(0, 0, W, H).data, palette = quantize(data, 256);
        gif.writeFrame(applyPalette(data, palette), W, H, { palette, delay });
        if (i % 2 === 0) { toast(`Encoding GIF ${Math.round(i / n * 100)}%…`, 0); await nextFrame(); }
      }
      gif.finish();
      const blob = new Blob([gif.bytes()], { type: 'image/gif' });
      await write(target, blob);
      cv.width = cv.height = 1; bufs.delete(cv);
      toast(`Saved ${target.handle ? target.handle.name : target.name} · ${W} × ${H}, ${secs}s, ${(blob.size / 1048576).toFixed(1)} MB`);
    } catch (e) { toast('GIF export failed: ' + e.message); }
    busy = false; dirty = true;
  }

  function doExport() {
    const k = Number($('exSize').value);
    $('exportBox').hidden = true;
    if (exFmt === 'gif') exportGif(k, Number($('exDur').value), Number($('exFps').value));
    else if (exFmt === 'video') exportVideo(k, Number($('exDur').value));
    else exportStill(k, exFmt === 'jpg');
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------
  let toastTimer = 0;
  function toast(msg, ms = 3200) {
    const el = $('toast'); el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => (el.hidden = true), ms);
  }

  buildPanel();
  $('openBtn').onclick = () => $('file').click();
  $('file').onchange = (e) => { loadFile(e.target.files[0]); e.target.value = ''; };
  $('multiToggle').onchange = (e) => setMulti(e.target.checked);
  $('multiAdd').onclick = () => $('multiFile').click();
  $('multiFile').onchange = (e) => { addMulti(e.target.files); e.target.value = ''; };
  $('multiClear').onclick = clearMulti;
  document.addEventListener('click', (e) => { if (!$('debug').contains(e.target)) $('debug').open = false; });
  const cmp = $('cmpBtn');
  const setComparing = (on) => { comparing = on; cmp.classList.toggle('on', on); cmp.setAttribute('aria-pressed', on); };
  cmp.onclick = () => setComparing(!comparing);
  $('exportBtn').onclick = openExport;
  $('exCancel').onclick = () => ($('exportBox').hidden = true);
  $('exportBox').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
  $('exSave').onclick = doExport;
  $('cropBtn').onclick = () => (cropping ? closeCrop() : openCrop());
  $('presetName').addEventListener('input', () => ($('presetCode').value = presetCode()));
  $('presetCode').addEventListener('focus', (e) => e.target.select());
  $('presetClose').onclick = () => ($('presetBox').hidden = true);
  $('presetBox').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.hidden = true; });
  $('presetCopy').onclick = async () => {
    const ta = $('presetCode');
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    toast('Preset code copied.');
  };
  for (const b of $('fmt').children) b.onclick = () => setFmt(b.dataset.f);

  stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragging'); });
  stage.addEventListener('dragleave', () => stage.classList.remove('dragging'));
  stage.addEventListener('drop', (e) => {
    e.preventDefault(); stage.classList.remove('dragging');
    if (multiOn) addMulti(e.dataTransfer.files); else loadFile(e.dataTransfer.files[0]);
  });
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'));
    if (item) loadFile(item.getAsFile());
  });
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') { e.preventDefault(); $('file').click(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); openExport(); }
    else if (e.key === 'Escape') { if (cropping) closeCrop(); $('exportBox').hidden = $('presetBox').hidden = true; }
    else if (cropping && e.key === 'Enter') { e.preventDefault(); applyCrop(); }
    else if (typing || e.ctrlKey || e.metaKey) return;
    else if (e.key.toLowerCase() === 'r') cropping ? closeCrop() : openCrop();
    else if (/INPUT|SELECT/.test(document.activeElement?.tagName) && e.key.startsWith('Arrow')) return; // arrows belong to the focused slider
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); stepPreset(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); stepPreset(-1); }
    else if (e.key.toLowerCase() === 'c' && !e.repeat) setComparing(!comparing);
  });
})();
