'use strict';
// Haunt Filter. Re-renders any image in Statue Poop Defender's HAUNT style: the picture is sampled into a grid of cells,
// each lit cell gets a dim square plus a glyph (katakana in the darks, a block ramp in the brights, orange + on edges),
// squares flake off and stream away, and the whole thing blooms. Every size is relative to the grid, so the export is
// the exact frame you see in the preview, just rendered at full resolution.
(() => {
  const $ = (id) => document.getElementById(id);
  // touch-first devices: lighter live preview so phones stay smooth, and tap instead of hover in the debug grid
  const COARSE = matchMedia('(pointer: coarse)').matches, PREVIEW_PX = COARSE ? 1.1e6 : 2.4e6;
  const PHONE = matchMedia('(max-width: 820px)'); // same breakpoint as the one-column layout in style.css
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
    // made in the app with Export preset
    'My preset': { cols: 82, exposure: 0.3, black: 0.025, boost: 2.85, mono: true, tint: '#5bff7a', sqOpacity: 0.18, glyphSet: 'kana', glyphOpacity: 0.99, split: 0.42, flicker: 5, edgeDensity: 0.22, edgeThr: 0.16, edgeColor: '#d8ffd8', streamLen: 12, streamSpeed: 0.11, streamAngle: -48, streamSpread: 0.3, streamRise: 0, streamSize: 0.74, glow: 1.4 },
    'Rasengan': {},
    'Super Beast Scroll': { paper: true, mono: true, tint: '#101012', exposure: 1.6, edgeDensity: 0, glow: 0.35, vignette: 0, scanlines: 0, streamChance: 0.75, sqOpacity: 1.3, glyphOpacity: 0.8 },
    'Kamui': { streamChance: 1, streamCount: 4, streamLen: 18, sqMin: 0.3, streamSpread: 1.6, glyphOpacity: 0.7, glow: 1.3 },
    'Leaf Hurricane': { mono: true, tint: '#5bff7a', glyphSet: 'kana', streamAngle: 90, streamLen: 14, streamRise: 0, streamSpread: 0.3, edgeColor: '#d8ffd8', flicker: 6, sqOpacity: 0.55, glow: 1.4 },
    'Chidori': { glyphSet: 'ascii', sqOpacity: 0.25, boost: 6, glow: 2, glowRadius: 1.4, streamChance: 0.3, cols: 200 },
    'Shadow Clone Jutsu': { mix: 0.45, glow: 0.8, vignette: 0.3, streamChance: 0.8 },
    // the keepers from the random batch
    'Almighty Push': {cols: 230, exposure: 1.01, black: 0.05, gamma: 1.63, cutoff: 0.206, paper: true, boost: 2.9, mono: true, tint: '#9426d8', mix: 0, sqOpacity: 0.51, sqMin: 0.77, glyphSet: 'ascii', glyphOpacity: 1.67, split: 0.51, flicker: 0.7, edgeDensity: 0.62, edgeThr: 0.164, edgeColor: '#e19536', streamChance: 0.34, streamCount: 4, streamLen: 23.6, streamSpeed: 2.73, streamAngle: -168, streamSpread: 0.18, streamRise: -2.38, streamSize: 0.7, streamOpacity: 1.02, glow: 0.75, glowRadius: 2.8, fade: 0, vignette: 0.59, scanlines: 0.71, speed: 2},
    'Fireball Jutsu': {cols: 201, exposure: 1.42, black: 0.098, gamma: 1.03, cutoff: 0.209, paper: false, boost: 1.23, mono: true, tint: '#dd4d2e', mix: 0.19, sqOpacity: 0.52, sqMin: 0.45, glyphSet: 'kana', glyphOpacity: 1.16, split: 0.6, flicker: 3.5, edgeDensity: 0.19, edgeThr: 0.19, edgeColor: '#b9c0f3', streamChance: 0.89, streamCount: 1, streamLen: 28, streamSpeed: 2.8, streamAngle: 84, streamSpread: 0.74, streamRise: 2, streamSize: 1.84, streamOpacity: 1.43, glow: 0.51, glowRadius: 2.1, fade: 0, vignette: 0.41, scanlines: 0.16, speed: 1.1},
    'Sexy Jutsu': {cols: 185, exposure: 0.92, black: 0.074, gamma: 2.24, cutoff: 0.209, paper: false, boost: 2.75, mono: false, tint: '#ec54d1', mix: 0.1, sqOpacity: 0.06, sqMin: 0.95, glyphSet: 'blocks', glyphOpacity: 1.65, split: 0.49, flicker: 8.5, edgeDensity: 0.09, edgeThr: 0.158, edgeColor: '#94c6e6', streamChance: 0.2, streamCount: 1, streamLen: 16, streamSpeed: 2.99, streamAngle: 32, streamSpread: 0.93, streamRise: -2.69, streamSize: 0.88, streamOpacity: 0.83, glow: 0.2, glowRadius: 1.95, fade: 0, vignette: 0.09, scanlines: 0.36, speed: 0.91},
    'Tsukuyomi': {cols: 146, exposure: 2.62, black: 0.082, gamma: 2.37, cutoff: 0.173, paper: false, boost: 3.67, mono: true, tint: '#e1a0fa', mix: 0.32, sqOpacity: 1.2, sqMin: 0.53, glyphSet: 'blocks', glyphOpacity: 1.47, split: 0.66, flicker: 9.2, edgeDensity: 0.88, edgeThr: 0.137, edgeColor: '#45fed8', streamChance: 0.81, streamCount: 5, streamLen: 28.4, streamSpeed: 1.77, streamAngle: 133, streamSpread: 2.66, streamRise: -2.09, streamSize: 1.07, streamOpacity: 1.22, glow: 0.84, glowRadius: 1.55, fade: 0, vignette: 0.07, scanlines: 0.22, speed: 0.59},
    'Summoning Jutsu': {cols: 124, exposure: 0.89, black: 0.039, gamma: 1.52, cutoff: 0.003, paper: false, boost: 1.66, mono: true, tint: '#afef20', mix: 0, sqOpacity: 0.17, sqMin: 0.62, glyphSet: 'ascii', glyphOpacity: 1.47, split: 0.6, flicker: 4.8, edgeDensity: 0.08, edgeThr: 0.148, edgeColor: '#b966e3', streamChance: 0.27, streamCount: 2, streamLen: 22.2, streamSpeed: 2.81, streamAngle: -175, streamSpread: 1.03, streamRise: 1.16, streamSize: 2.13, streamOpacity: 1.13, glow: 0.86, glowRadius: 3, fade: 0, vignette: 0.38, scanlines: 0.43, speed: 1.39},
    'Infinite Tsukuyomi': {cols: 103, exposure: 1.42, black: 0.108, gamma: 1.3, cutoff: 0.174, paper: false, boost: 4.12, mono: true, tint: '#7e2af5', mix: 0, sqOpacity: 0.52, sqMin: 0.35, glyphSet: 'binary', glyphOpacity: 1.24, split: 0.62, flicker: 8.5, edgeDensity: 0.46, edgeThr: 0.254, edgeColor: '#ace32e', streamChance: 0.5, streamCount: 2, streamLen: 18.9, streamSpeed: 1.32, streamAngle: 63, streamSpread: 2.1, streamRise: 2.21, streamSize: 1.4, streamOpacity: 1.39, glow: 2.42, glowRadius: 2.52, fade: 0.97, vignette: 0.79, scanlines: 0.75, speed: 1.59},
    'Thousand Years of Death': {cols: 106, exposure: 0.81, black: 0.001, gamma: 2.35, cutoff: 0.189, paper: false, boost: 1.9, mono: false, tint: '#f0b2de', mix: 0, sqOpacity: 1.01, sqMin: 0.8, glyphSet: 'blocks', glyphOpacity: 1.77, split: 0.38, flicker: 9.7, edgeDensity: 0.41, edgeThr: 0.168, edgeColor: '#0dde45', streamChance: 0.93, streamCount: 2, streamLen: 3.6, streamSpeed: 2.55, streamAngle: 115, streamSpread: 1.55, streamRise: -2.18, streamSize: 2.49, streamOpacity: 1.21, glow: 1.63, glowRadius: 2.07, fade: 0.88, vignette: 0.02, scanlines: 0.32, speed: 1.42},
    'Mind Transfer Jutsu': {cols: 84, exposure: 1.47, black: 0.037, gamma: 1.72, cutoff: 0.126, paper: false, boost: 5.1, mono: false, tint: '#b1efdc', mix: 0.56, sqOpacity: 1.49, sqMin: 0.45, glyphSet: 'blocks', glyphOpacity: 1.31, split: 0.51, flicker: 1.9, edgeDensity: 0.45, edgeThr: 0.112, edgeColor: '#d789ec', streamChance: 0.61, streamCount: 2, streamLen: 11.1, streamSpeed: 1.31, streamAngle: -94, streamSpread: 0.22, streamRise: -2.54, streamSize: 2.03, streamOpacity: 1.31, glow: 0.26, glowRadius: 2.92, fade: 0, vignette: 0.25, scanlines: 0.29, speed: 1.06},
    'Kurama Mode': {cols: 229, exposure: 0.91, black: 0.117, gamma: 2.38, cutoff: 0.013, paper: false, boost: 3.48, mono: true, tint: '#c8a82d', mix: 0, sqOpacity: 0.6, sqMin: 0.86, glyphSet: 'ascii', glyphOpacity: 0.71, split: 0.47, flicker: 2.5, edgeDensity: 0.41, edgeThr: 0.139, edgeColor: '#f77f45', streamChance: 0.77, streamCount: 3, streamLen: 11, streamSpeed: 2.94, streamAngle: 139, streamSpread: 0.48, streamRise: -2.95, streamSize: 0.88, streamOpacity: 1.33, glow: 1.04, glowRadius: 2.34, fade: 0.29, vignette: 0.98, scanlines: 0.55, speed: 0.64},
    // second random batch for picking favourites; the losers get deleted
    '#1': {cols: 126, exposure: 0.86, black: 0.047, gamma: 0.94, cutoff: 0.186, paper: false, boost: 3.11, mono: false, tint: '#77a8d5', mix: 0.23, sqOpacity: 1.23, sqMin: 0.8, glyphSet: 'kana', glyphOpacity: 1.27, split: 0.54, flicker: 3.7, edgeDensity: 0.31, edgeThr: 0.06, edgeColor: '#99b5ef', streamChance: 0.04, streamCount: 2, streamLen: 17.9, streamSpeed: 2.95, streamAngle: -112, streamSpread: 1.85, streamRise: -2.12, streamSize: 1.31, streamOpacity: 1.18, glow: 2.11, glowRadius: 2.89, fade: 0, vignette: 0.52, scanlines: 0.12, speed: 0.44},
    '#2': {cols: 168, exposure: 2.85, black: 0.003, gamma: 1.75, cutoff: 0.2, paper: false, boost: 4.65, mono: false, tint: '#dd9579', mix: 0, sqOpacity: 0.28, sqMin: 0.88, glyphSet: 'binary', glyphOpacity: 0.61, split: 0.86, flicker: 8.2, edgeDensity: 0.32, edgeThr: 0.186, edgeColor: '#ec42fc', streamChance: 0.09, streamCount: 4, streamLen: 17.4, streamSpeed: 2.16, streamAngle: -52, streamSpread: 2.9, streamRise: -0.27, streamSize: 1.71, streamOpacity: 0.98, glow: 1.97, glowRadius: 1.94, fade: 0, vignette: 0.49, scanlines: 0.11, speed: 1.48},
    '#3': {cols: 296, exposure: 1.55, black: 0.097, gamma: 1.08, cutoff: 0.023, paper: false, boost: 3.06, mono: true, tint: '#92ace8', mix: 0, sqOpacity: 1.29, sqMin: 0.73, glyphSet: 'kana', glyphOpacity: 1.43, split: 0.77, flicker: 3.2, edgeDensity: 0.32, edgeThr: 0.167, edgeColor: '#e2e8a8', streamChance: 0.12, streamCount: 3, streamLen: 15.4, streamSpeed: 2.72, streamAngle: 55, streamSpread: 2.11, streamRise: 1.67, streamSize: 1.28, streamOpacity: 0.81, glow: 0.98, glowRadius: 2.34, fade: 0, vignette: 0.88, scanlines: 0.45, speed: 0.56},
    '#4': {cols: 155, exposure: 2.27, black: 0.063, gamma: 1.71, cutoff: 0.147, paper: false, boost: 5.19, mono: true, tint: '#d16abb', mix: 0, sqOpacity: 0.62, sqMin: 0.98, glyphSet: 'haunt', glyphOpacity: 0.54, split: 0.55, flicker: 6.1, edgeDensity: 0.07, edgeThr: 0.301, edgeColor: '#b92beb', streamChance: 0.54, streamCount: 1, streamLen: 16.3, streamSpeed: 2.68, streamAngle: -150, streamSpread: 2.28, streamRise: -1.36, streamSize: 1.43, streamOpacity: 1.23, glow: 1.89, glowRadius: 1.53, fade: 0, vignette: 0.36, scanlines: 0.53, speed: 2},
    '#5': {cols: 125, exposure: 1.55, black: 0.013, gamma: 1.3, cutoff: 0.178, paper: false, boost: 2.42, mono: false, tint: '#06f7b9', mix: 0, sqOpacity: 1.05, sqMin: 0.36, glyphSet: 'haunt', glyphOpacity: 1, split: 0.61, flicker: 7.2, edgeDensity: 0.56, edgeThr: 0.396, edgeColor: '#74e582', streamChance: 0.44, streamCount: 4, streamLen: 19.1, streamSpeed: 0.74, streamAngle: 134, streamSpread: 0.23, streamRise: 0.75, streamSize: 1.48, streamOpacity: 0.94, glow: 2.39, glowRadius: 2.86, fade: 0, vignette: 0.41, scanlines: 0.45, speed: 0.73},
    '#6': {cols: 208, exposure: 2.63, black: 0.012, gamma: 1.29, cutoff: 0.042, paper: false, boost: 2.7, mono: false, tint: '#8337f2', mix: 0.36, sqOpacity: 0.51, sqMin: 0.89, glyphSet: 'haunt', glyphOpacity: 1.05, split: 0.39, flicker: 5.8, edgeDensity: 0.51, edgeThr: 0.35, edgeColor: '#c9eabe', streamChance: 0.67, streamCount: 5, streamLen: 7.2, streamSpeed: 1.84, streamAngle: -93, streamSpread: 2.68, streamRise: -0.6, streamSize: 1.13, streamOpacity: 0.66, glow: 1.9, glowRadius: 1.79, fade: 0, vignette: 0.55, scanlines: 0.14, speed: 1.61},
    '#7': {cols: 185, exposure: 1.21, black: 0.006, gamma: 1.27, cutoff: 0.064, paper: false, boost: 1.06, mono: false, tint: '#74f646', mix: 0.34, sqOpacity: 0.74, sqMin: 0.29, glyphSet: 'ascii', glyphOpacity: 0.46, split: 0.28, flicker: 3.9, edgeDensity: 0.1, edgeThr: 0.123, edgeColor: '#9764e5', streamChance: 0.19, streamCount: 3, streamLen: 19.7, streamSpeed: 0.64, streamAngle: 56, streamSpread: 0.44, streamRise: 0.42, streamSize: 0.83, streamOpacity: 1.06, glow: 2.07, glowRadius: 1.44, fade: 0.68, vignette: 0.45, scanlines: 0.37, speed: 1.81},
    '#8': {cols: 138, exposure: 1.06, black: 0.083, gamma: 2.06, cutoff: 0.201, paper: false, boost: 5.68, mono: true, tint: '#c3db77', mix: 0, sqOpacity: 0.49, sqMin: 0.25, glyphSet: 'blocks', glyphOpacity: 1.07, split: 0.17, flicker: 3.1, edgeDensity: 0.8, edgeThr: 0.167, edgeColor: '#6dfc5f', streamChance: 0.38, streamCount: 0, streamLen: 15.8, streamSpeed: 2.04, streamAngle: 29, streamSpread: 1, streamRise: -2.33, streamSize: 2.07, streamOpacity: 0.62, glow: 0.15, glowRadius: 2.76, fade: 0, vignette: 0.19, scanlines: 0.13, speed: 0.9},
    '#9': {cols: 93, exposure: 2.51, black: 0.114, gamma: 0.95, cutoff: 0.103, paper: false, boost: 4.92, mono: false, tint: '#79ed3e', mix: 0, sqOpacity: 1.26, sqMin: 0.89, glyphSet: 'ascii', glyphOpacity: 1.11, split: 0.39, flicker: 1.1, edgeDensity: 0.59, edgeThr: 0.289, edgeColor: '#41ceab', streamChance: 0.3, streamCount: 1, streamLen: 17.6, streamSpeed: 2.07, streamAngle: -71, streamSpread: 2.86, streamRise: -0.7, streamSize: 1.51, streamOpacity: 0.71, glow: 0.55, glowRadius: 2.45, fade: 0, vignette: 0.37, scanlines: 0.39, speed: 0.54},
    '#10': {cols: 137, exposure: 1.13, black: 0.071, gamma: 1.68, cutoff: 0.182, paper: false, boost: 3.76, mono: false, tint: '#4bfab6', mix: 0, sqOpacity: 1.77, sqMin: 0.33, glyphSet: 'kana', glyphOpacity: 0.77, split: 0.55, flicker: 9.9, edgeDensity: 0.94, edgeThr: 0.376, edgeColor: '#a8b2f2', streamChance: 0.57, streamCount: 2, streamLen: 23.4, streamSpeed: 0.82, streamAngle: 76, streamSpread: 0.09, streamRise: 0.91, streamSize: 0.96, streamOpacity: 1.03, glow: 1.42, glowRadius: 2.45, fade: 0.57, vignette: 0.54, scanlines: 0.43, speed: 1.86},
    '#11': {cols: 92, exposure: 1.01, black: 0.105, gamma: 1.5, cutoff: 0.083, paper: false, boost: 1.51, mono: false, tint: '#7344cc', mix: 0.47, sqOpacity: 1.34, sqMin: 0.43, glyphSet: 'haunt', glyphOpacity: 1.4, split: 0.16, flicker: 10, edgeDensity: 0.56, edgeThr: 0.175, edgeColor: '#63e1a6', streamChance: 0.08, streamCount: 2, streamLen: 9.3, streamSpeed: 2.97, streamAngle: 160, streamSpread: 0.9, streamRise: 1.35, streamSize: 1.45, streamOpacity: 0.65, glow: 0.72, glowRadius: 0.41, fade: 0.66, vignette: 0.61, scanlines: 0.01, speed: 1.53},
    '#12': {cols: 268, exposure: 2.77, black: 0.003, gamma: 1.34, cutoff: 0.077, paper: false, boost: 4.01, mono: false, tint: '#a5d984', mix: 0, sqOpacity: 1.41, sqMin: 0.69, glyphSet: 'binary', glyphOpacity: 0.48, split: 0.61, flicker: 9.6, edgeDensity: 0.25, edgeThr: 0.115, edgeColor: '#2327e0', streamChance: 0.58, streamCount: 2, streamLen: 23.9, streamSpeed: 1.83, streamAngle: 108, streamSpread: 2.86, streamRise: -2.07, streamSize: 2.04, streamOpacity: 0.45, glow: 2.4, glowRadius: 2.76, fade: 0, vignette: 0.41, scanlines: 0.41, speed: 0.46},
    '#13': {cols: 168, exposure: 2.86, black: 0.026, gamma: 1.59, cutoff: 0.226, paper: false, boost: 3.59, mono: false, tint: '#f3df98', mix: 0, sqOpacity: 0.24, sqMin: 0.54, glyphSet: 'binary', glyphOpacity: 0.5, split: 0.6, flicker: 8.9, edgeDensity: 0.86, edgeThr: 0.067, edgeColor: '#91fee7', streamChance: 0.2, streamCount: 1, streamLen: 27.4, streamSpeed: 1.1, streamAngle: -5, streamSpread: 1.78, streamRise: 2.98, streamSize: 1.41, streamOpacity: 0.35, glow: 0.92, glowRadius: 1.94, fade: 0, vignette: 0.93, scanlines: 0.32, speed: 1.94},
    '#14': {cols: 201, exposure: 2.01, black: 0.061, gamma: 1.98, cutoff: 0.174, paper: false, boost: 3.71, mono: true, tint: '#e9a3a5', mix: 0, sqOpacity: 0.1, sqMin: 0.66, glyphSet: 'haunt', glyphOpacity: 0.44, split: 0.22, flicker: 1.8, edgeDensity: 0.55, edgeThr: 0.244, edgeColor: '#75c726', streamChance: 0.03, streamCount: 1, streamLen: 18.1, streamSpeed: 0.97, streamAngle: 74, streamSpread: 2.56, streamRise: -0.37, streamSize: 1.41, streamOpacity: 0.44, glow: 0.83, glowRadius: 2.94, fade: 0.32, vignette: 0.2, scanlines: 0.18, speed: 1.53},
    '#15': {cols: 283, exposure: 1.29, black: 0.067, gamma: 1.85, cutoff: 0.244, paper: false, boost: 3.95, mono: false, tint: '#30b0f5', mix: 0, sqOpacity: 1.47, sqMin: 0.29, glyphSet: 'binary', glyphOpacity: 0.86, split: 0.5, flicker: 2.4, edgeDensity: 0.92, edgeThr: 0.204, edgeColor: '#fb3a43', streamChance: 0.95, streamCount: 5, streamLen: 3.9, streamSpeed: 0.42, streamAngle: -131, streamSpread: 0.13, streamRise: -1.19, streamSize: 1.25, streamOpacity: 0.87, glow: 1.34, glowRadius: 2.25, fade: 0, vignette: 0.57, scanlines: 0.46, speed: 1.18},
    '#16': {cols: 204, exposure: 0.94, black: 0.034, gamma: 1.41, cutoff: 0.247, paper: false, boost: 5.94, mono: false, tint: '#919ff0', mix: 0.22, sqOpacity: 1.31, sqMin: 0.2, glyphSet: 'binary', glyphOpacity: 0.36, split: 0.36, flicker: 8.6, edgeDensity: 0.24, edgeThr: 0.122, edgeColor: '#e74edd', streamChance: 0.3, streamCount: 6, streamLen: 21.8, streamSpeed: 1.84, streamAngle: 65, streamSpread: 0.79, streamRise: 2.35, streamSize: 2.25, streamOpacity: 0.34, glow: 1.79, glowRadius: 2.68, fade: 0, vignette: 0.51, scanlines: 0.62, speed: 1.24},
    '#17': {cols: 193, exposure: 2.71, black: 0.002, gamma: 0.72, cutoff: 0.224, paper: false, boost: 3.98, mono: false, tint: '#e351e7', mix: 0.34, sqOpacity: 1.08, sqMin: 0.78, glyphSet: 'ascii', glyphOpacity: 0.78, split: 0.63, flicker: 3, edgeDensity: 0.32, edgeThr: 0.174, edgeColor: '#ddaa32', streamChance: 0.72, streamCount: 2, streamLen: 8.9, streamSpeed: 2.52, streamAngle: 31, streamSpread: 0.42, streamRise: -0.65, streamSize: 1.54, streamOpacity: 0.7, glow: 1.88, glowRadius: 0.96, fade: 0, vignette: 0.49, scanlines: 0.37, speed: 1.36},
    '#18': {cols: 194, exposure: 0.94, black: 0.091, gamma: 1.36, cutoff: 0.179, paper: false, boost: 3.21, mono: true, tint: '#bde416', mix: 0, sqOpacity: 1.24, sqMin: 0.95, glyphSet: 'blocks', glyphOpacity: 1.11, split: 0.89, flicker: 7, edgeDensity: 0.15, edgeThr: 0.354, edgeColor: '#ebfc93', streamChance: 0.2, streamCount: 2, streamLen: 26.2, streamSpeed: 0.82, streamAngle: -23, streamSpread: 0.48, streamRise: 0.28, streamSize: 1.31, streamOpacity: 0.76, glow: 1.77, glowRadius: 1.62, fade: 0, vignette: 0.58, scanlines: 0.1, speed: 0.53},
    '#19': {cols: 197, exposure: 2.06, black: 0.09, gamma: 1.28, cutoff: 0.194, paper: false, boost: 2.35, mono: false, tint: '#c0efbc', mix: 0.5, sqOpacity: 0.24, sqMin: 0.21, glyphSet: 'haunt', glyphOpacity: 1.72, split: 0.89, flicker: 6.5, edgeDensity: 0.96, edgeThr: 0.173, edgeColor: '#a8f6cc', streamChance: 0.31, streamCount: 0, streamLen: 5.6, streamSpeed: 1.93, streamAngle: -172, streamSpread: 0.77, streamRise: 1.39, streamSize: 0.46, streamOpacity: 0.81, glow: 1.58, glowRadius: 2.64, fade: 0.32, vignette: 0.53, scanlines: 0.22, speed: 1.43},
    '#20': {cols: 267, exposure: 1.37, black: 0.072, gamma: 1.73, cutoff: 0.166, paper: false, boost: 2.62, mono: true, tint: '#fdfdb3', mix: 0.42, sqOpacity: 0.93, sqMin: 0.32, glyphSet: 'haunt', glyphOpacity: 1.02, split: 0.7, flicker: 0.4, edgeDensity: 0.63, edgeThr: 0.396, edgeColor: '#0fbde2', streamChance: 0.02, streamCount: 2, streamLen: 19.2, streamSpeed: 1.38, streamAngle: -24, streamSpread: 2.79, streamRise: 2.68, streamSize: 1.18, streamOpacity: 1.06, glow: 0.3, glowRadius: 1.94, fade: 0, vignette: 0.29, scanlines: 0.7, speed: 1.66},
    '#21': {cols: 158, exposure: 1.28, black: 0.023, gamma: 1.54, cutoff: 0.006, paper: false, boost: 1.5, mono: false, tint: '#f1cc6b', mix: 0, sqOpacity: 1.21, sqMin: 0.54, glyphSet: 'binary', glyphOpacity: 1.12, split: 0.49, flicker: 3.6, edgeDensity: 0.1, edgeThr: 0.182, edgeColor: '#d1c118', streamChance: 0.37, streamCount: 6, streamLen: 3.9, streamSpeed: 2.76, streamAngle: 100, streamSpread: 2.19, streamRise: 2.85, streamSize: 1.43, streamOpacity: 1.4, glow: 1.73, glowRadius: 1.54, fade: 0, vignette: 0.37, scanlines: 0.16, speed: 1.45},
    '#22': {cols: 195, exposure: 1.83, black: 0.064, gamma: 1.16, cutoff: 0.229, paper: false, boost: 2.11, mono: false, tint: '#22f44c', mix: 0, sqOpacity: 1.27, sqMin: 0.79, glyphSet: 'blocks', glyphOpacity: 0.47, split: 0.15, flicker: 8.3, edgeDensity: 0.62, edgeThr: 0.202, edgeColor: '#ae06fa', streamChance: 0.88, streamCount: 1, streamLen: 25.2, streamSpeed: 1.92, streamAngle: -144, streamSpread: 0.82, streamRise: -1.46, streamSize: 1.38, streamOpacity: 0.71, glow: 1.48, glowRadius: 2.72, fade: 0.42, vignette: 0.26, scanlines: 0.44, speed: 1.41},
    '#23': {cols: 300, exposure: 2.67, black: 0.078, gamma: 2.12, cutoff: 0.124, paper: false, boost: 2.48, mono: true, tint: '#69e5ec', mix: 0, sqOpacity: 1.68, sqMin: 0.56, glyphSet: 'kana', glyphOpacity: 1.78, split: 0.46, flicker: 8.5, edgeDensity: 0.93, edgeThr: 0.3, edgeColor: '#7be08b', streamChance: 0.18, streamCount: 5, streamLen: 16.6, streamSpeed: 2.66, streamAngle: -82, streamSpread: 0.08, streamRise: 2.59, streamSize: 0.9, streamOpacity: 0.48, glow: 2.04, glowRadius: 2.58, fade: 0, vignette: 0.72, scanlines: 0.22, speed: 1.39},
    '#24': {cols: 279, exposure: 1.55, black: 0.035, gamma: 2.02, cutoff: 0.014, paper: false, boost: 3.61, mono: true, tint: '#2c3ec8', mix: 0.36, sqOpacity: 0.2, sqMin: 0.61, glyphSet: 'ascii', glyphOpacity: 1.47, split: 0.24, flicker: 0.8, edgeDensity: 0.78, edgeThr: 0.253, edgeColor: '#83fc5f', streamChance: 0.43, streamCount: 2, streamLen: 12, streamSpeed: 0.27, streamAngle: -178, streamSpread: 2.7, streamRise: -1.06, streamSize: 0.67, streamOpacity: 0.93, glow: 2.07, glowRadius: 0.48, fade: 0.87, vignette: 0.18, scanlines: 0.62, speed: 1.77},
    '#25': {cols: 267, exposure: 2.14, black: 0.029, gamma: 1.85, cutoff: 0.018, paper: false, boost: 5.32, mono: true, tint: '#fd95ed', mix: 0, sqOpacity: 1.3, sqMin: 0.57, glyphSet: 'haunt', glyphOpacity: 0.53, split: 0.32, flicker: 2.9, edgeDensity: 0.73, edgeThr: 0.318, edgeColor: '#9eacef', streamChance: 0.78, streamCount: 4, streamLen: 26.9, streamSpeed: 1.53, streamAngle: -64, streamSpread: 2.94, streamRise: -1.59, streamSize: 0.74, streamOpacity: 0.78, glow: 0.48, glowRadius: 1.84, fade: 0, vignette: 0.89, scanlines: 0.21, speed: 0.56},
    '#26': {cols: 239, exposure: 1.51, black: 0.104, gamma: 1.06, cutoff: 0.01, paper: false, boost: 5.59, mono: true, tint: '#9ceda6', mix: 0, sqOpacity: 1.71, sqMin: 0.83, glyphSet: 'haunt', glyphOpacity: 0.64, split: 0.5, flicker: 0.5, edgeDensity: 0.32, edgeThr: 0.152, edgeColor: '#35f7d4', streamChance: 0.27, streamCount: 4, streamLen: 26.9, streamSpeed: 2.37, streamAngle: 148, streamSpread: 0.35, streamRise: -1.68, streamSize: 1.82, streamOpacity: 1.17, glow: 2.04, glowRadius: 2.46, fade: 0, vignette: 0.16, scanlines: 0.45, speed: 0.41},
    '#27': {cols: 225, exposure: 2.19, black: 0.06, gamma: 1.99, cutoff: 0.1, paper: false, boost: 1.38, mono: false, tint: '#91edf6', mix: 0.33, sqOpacity: 0.38, sqMin: 0.75, glyphSet: 'haunt', glyphOpacity: 0.43, split: 0.17, flicker: 1.1, edgeDensity: 0.67, edgeThr: 0.066, edgeColor: '#4993c8', streamChance: 0.6, streamCount: 2, streamLen: 3.8, streamSpeed: 2.25, streamAngle: 8, streamSpread: 2.62, streamRise: -2.3, streamSize: 2.25, streamOpacity: 0.6, glow: 1.81, glowRadius: 2.38, fade: 0.78, vignette: 0.97, scanlines: 0.36, speed: 1.39},
    '#28': {cols: 112, exposure: 2.24, black: 0.082, gamma: 2.11, cutoff: 0.236, paper: false, boost: 5.3, mono: false, tint: '#8ffeff', mix: 0, sqOpacity: 0.66, sqMin: 0.66, glyphSet: 'haunt', glyphOpacity: 1, split: 0.28, flicker: 0.1, edgeDensity: 0.53, edgeThr: 0.321, edgeColor: '#e8c2ef', streamChance: 0.29, streamCount: 4, streamLen: 10.5, streamSpeed: 2.28, streamAngle: -169, streamSpread: 2.2, streamRise: -0.97, streamSize: 1.28, streamOpacity: 1.03, glow: 0.99, glowRadius: 2.76, fade: 0.24, vignette: 0.86, scanlines: 0.3, speed: 0.58},
    '#29': {cols: 282, exposure: 1.2, black: 0.065, gamma: 1.68, cutoff: 0.196, paper: false, boost: 5.6, mono: false, tint: '#2fe826', mix: 0.42, sqOpacity: 1.39, sqMin: 0.13, glyphSet: 'kana', glyphOpacity: 1.29, split: 0.27, flicker: 9.7, edgeDensity: 0.13, edgeThr: 0.065, edgeColor: '#f4a4d8', streamChance: 0.71, streamCount: 1, streamLen: 5.5, streamSpeed: 0.27, streamAngle: 80, streamSpread: 1.25, streamRise: 2.68, streamSize: 1.19, streamOpacity: 0.49, glow: 1.15, glowRadius: 1.49, fade: 0.69, vignette: 0.81, scanlines: 0.66, speed: 1.81},
    '#30': {cols: 153, exposure: 2.63, black: 0.063, gamma: 0.75, cutoff: 0.065, paper: false, boost: 2.27, mono: false, tint: '#5ae469', mix: 0.52, sqOpacity: 0.51, sqMin: 0.14, glyphSet: 'ascii', glyphOpacity: 1.28, split: 0.31, flicker: 7, edgeDensity: 0.2, edgeThr: 0.139, edgeColor: '#c2b2f7', streamChance: 0.42, streamCount: 2, streamLen: 10.3, streamSpeed: 0.38, streamAngle: -146, streamSpread: 2, streamRise: 0.14, streamSize: 1.24, streamOpacity: 1.43, glow: 2.13, glowRadius: 0.63, fade: 0.29, vignette: 0.25, scanlines: 0.71, speed: 0.93},
    '#31': {cols: 115, exposure: 2.34, black: 0.013, gamma: 1.53, cutoff: 0.238, paper: false, boost: 1.62, mono: true, tint: '#c9f292', mix: 0, sqOpacity: 1.25, sqMin: 0.73, glyphSet: 'binary', glyphOpacity: 1.7, split: 0.35, flicker: 8.1, edgeDensity: 0.21, edgeThr: 0.162, edgeColor: '#b3f9e8', streamChance: 0.79, streamCount: 3, streamLen: 12.7, streamSpeed: 0.87, streamAngle: 88, streamSpread: 1.87, streamRise: 1.27, streamSize: 0.78, streamOpacity: 0.96, glow: 1.64, glowRadius: 2.74, fade: 0, vignette: 0.63, scanlines: 0.55, speed: 1.91},
    '#32': {cols: 239, exposure: 1.72, black: 0.042, gamma: 1.91, cutoff: 0.225, paper: false, boost: 5.2, mono: true, tint: '#bbf4f4', mix: 0, sqOpacity: 1.72, sqMin: 0.34, glyphSet: 'haunt', glyphOpacity: 1.69, split: 0.42, flicker: 2.8, edgeDensity: 0.39, edgeThr: 0.262, edgeColor: '#df661c', streamChance: 0.46, streamCount: 5, streamLen: 23.6, streamSpeed: 0.92, streamAngle: 46, streamSpread: 2.61, streamRise: -0.23, streamSize: 1.15, streamOpacity: 1.33, glow: 2.16, glowRadius: 0.51, fade: 0.65, vignette: 0.22, scanlines: 0.44, speed: 0.71},
    '#33': {cols: 182, exposure: 1.44, black: 0.084, gamma: 1.81, cutoff: 0.224, paper: true, boost: 1.44, mono: true, tint: '#d59a42', mix: 0.52, sqOpacity: 1.48, sqMin: 0.17, glyphSet: 'ascii', glyphOpacity: 1.21, split: 0.9, flicker: 9.8, edgeDensity: 0.94, edgeThr: 0.274, edgeColor: '#d6721d', streamChance: 0.04, streamCount: 1, streamLen: 26.3, streamSpeed: 0.96, streamAngle: 160, streamSpread: 1.49, streamRise: -1.62, streamSize: 1.96, streamOpacity: 1.24, glow: 2.03, glowRadius: 0.79, fade: 0, vignette: 0.95, scanlines: 0.43, speed: 1.97},
    '#34': {cols: 94, exposure: 0.91, black: 0.08, gamma: 0.74, cutoff: 0.124, paper: true, boost: 1.8, mono: true, tint: '#8373fc', mix: 0.56, sqOpacity: 0.55, sqMin: 0.45, glyphSet: 'ascii', glyphOpacity: 1.02, split: 0.55, flicker: 7.1, edgeDensity: 0, edgeThr: 0.278, edgeColor: '#60bbf4', streamChance: 0.88, streamCount: 5, streamLen: 16, streamSpeed: 0.51, streamAngle: 146, streamSpread: 1.69, streamRise: 1.07, streamSize: 0.59, streamOpacity: 0.48, glow: 0.36, glowRadius: 2, fade: 0.9, vignette: 0.15, scanlines: 0.32, speed: 1.25},
    '#35': {cols: 73, exposure: 2.11, black: 0.039, gamma: 2.19, cutoff: 0.228, paper: false, boost: 5.43, mono: true, tint: '#bde1ed', mix: 0.23, sqOpacity: 1.75, sqMin: 0.85, glyphSet: 'kana', glyphOpacity: 1.46, split: 0.79, flicker: 6.9, edgeDensity: 0.77, edgeThr: 0.081, edgeColor: '#52fcc8', streamChance: 0.66, streamCount: 4, streamLen: 29.1, streamSpeed: 0.84, streamAngle: 37, streamSpread: 0.17, streamRise: -1.33, streamSize: 0.5, streamOpacity: 1.39, glow: 1.56, glowRadius: 0.49, fade: 0, vignette: 0.52, scanlines: 0.61, speed: 1.89},
    '#36': {cols: 237, exposure: 2.71, black: 0.064, gamma: 1.03, cutoff: 0.224, paper: false, boost: 3, mono: false, tint: '#175fe6', mix: 0, sqOpacity: 0.1, sqMin: 0.6, glyphSet: 'haunt', glyphOpacity: 1.24, split: 0.2, flicker: 8.8, edgeDensity: 0.25, edgeThr: 0.346, edgeColor: '#e77678', streamChance: 0.44, streamCount: 4, streamLen: 5, streamSpeed: 1.1, streamAngle: -160, streamSpread: 0.06, streamRise: 0.57, streamSize: 1.05, streamOpacity: 1.05, glow: 1.79, glowRadius: 0.45, fade: 0.61, vignette: 0.28, scanlines: 0.69, speed: 0.89},
    '#37': {cols: 209, exposure: 1.72, black: 0.107, gamma: 2.28, cutoff: 0.139, paper: false, boost: 5.54, mono: false, tint: '#2ef83c', mix: 0, sqOpacity: 1.35, sqMin: 0.78, glyphSet: 'haunt', glyphOpacity: 1.16, split: 0.73, flicker: 9.5, edgeDensity: 0.02, edgeThr: 0.131, edgeColor: '#90f468', streamChance: 0.7, streamCount: 2, streamLen: 7.8, streamSpeed: 0.69, streamAngle: 80, streamSpread: 2.27, streamRise: 0.24, streamSize: 0.78, streamOpacity: 1.45, glow: 1.07, glowRadius: 2.68, fade: 0.75, vignette: 0.28, scanlines: 0.13, speed: 1.15},
    '#38': {cols: 213, exposure: 1.29, black: 0.047, gamma: 1.75, cutoff: 0.002, paper: false, boost: 2.82, mono: true, tint: '#33d8b2', mix: 0, sqOpacity: 1.08, sqMin: 0.32, glyphSet: 'binary', glyphOpacity: 1.19, split: 0.52, flicker: 2.3, edgeDensity: 0.28, edgeThr: 0.156, edgeColor: '#f243ec', streamChance: 0.84, streamCount: 2, streamLen: 4.8, streamSpeed: 2.35, streamAngle: -139, streamSpread: 1.54, streamRise: -0.38, streamSize: 1.39, streamOpacity: 1.42, glow: 1.16, glowRadius: 2.29, fade: 0, vignette: 0.82, scanlines: 0.67, speed: 1.32},
    '#39': {cols: 223, exposure: 2.25, black: 0.013, gamma: 1.5, cutoff: 0.064, paper: false, boost: 2.11, mono: true, tint: '#faec8c', mix: 0, sqOpacity: 1.23, sqMin: 0.48, glyphSet: 'kana', glyphOpacity: 1.62, split: 0.5, flicker: 1, edgeDensity: 0.35, edgeThr: 0.32, edgeColor: '#cce59a', streamChance: 0.97, streamCount: 5, streamLen: 6, streamSpeed: 1.35, streamAngle: 43, streamSpread: 0.79, streamRise: 2.02, streamSize: 2.37, streamOpacity: 0.37, glow: 1.48, glowRadius: 2.44, fade: 0, vignette: 0.77, scanlines: 0.69, speed: 1.93},
    '#40': {cols: 80, exposure: 1.27, black: 0.098, gamma: 0.91, cutoff: 0.099, paper: false, boost: 2.29, mono: true, tint: '#73e2df', mix: 0.47, sqOpacity: 1.13, sqMin: 0.69, glyphSet: 'haunt', glyphOpacity: 1.09, split: 0.12, flicker: 7.5, edgeDensity: 0.88, edgeThr: 0.16, edgeColor: '#4467c5', streamChance: 0.43, streamCount: 4, streamLen: 25.6, streamSpeed: 2.19, streamAngle: 29, streamSpread: 2.55, streamRise: 1.87, streamSize: 1.48, streamOpacity: 1.42, glow: 1.25, glowRadius: 1.66, fade: 0, vignette: 0.11, scanlines: 0.53, speed: 0.96},
    '#41': {cols: 297, exposure: 2.03, black: 0.009, gamma: 1.52, cutoff: 0.052, paper: false, boost: 5.6, mono: false, tint: '#59dd25', mix: 0, sqOpacity: 1.01, sqMin: 0.24, glyphSet: 'haunt', glyphOpacity: 0.43, split: 0.5, flicker: 2.3, edgeDensity: 0.62, edgeThr: 0.062, edgeColor: '#b63c95', streamChance: 0.3, streamCount: 1, streamLen: 11.4, streamSpeed: 1.84, streamAngle: -72, streamSpread: 0.24, streamRise: -2.71, streamSize: 2.35, streamOpacity: 1.22, glow: 0.94, glowRadius: 1.13, fade: 0, vignette: 0.66, scanlines: 0.44, speed: 1.36},
    '#42': {cols: 205, exposure: 1.35, black: 0.093, gamma: 1.79, cutoff: 0.247, paper: false, boost: 4.71, mono: true, tint: '#fda762', mix: 0, sqOpacity: 0.91, sqMin: 0.12, glyphSet: 'haunt', glyphOpacity: 0.51, split: 0.68, flicker: 4, edgeDensity: 0.9, edgeThr: 0.38, edgeColor: '#cf1c73', streamChance: 0.92, streamCount: 0, streamLen: 8.2, streamSpeed: 0.29, streamAngle: -3, streamSpread: 2.73, streamRise: -0.64, streamSize: 0.52, streamOpacity: 0.65, glow: 1.28, glowRadius: 1.89, fade: 0.35, vignette: 0.18, scanlines: 0.09, speed: 1.94},
    '#43': {cols: 174, exposure: 2.5, black: 0.012, gamma: 1.24, cutoff: 0.002, paper: false, boost: 5.25, mono: true, tint: '#a8e9dd', mix: 0, sqOpacity: 0.29, sqMin: 0.65, glyphSet: 'ascii', glyphOpacity: 0.84, split: 0.6, flicker: 1.7, edgeDensity: 0.66, edgeThr: 0.085, edgeColor: '#26fddb', streamChance: 0.34, streamCount: 4, streamLen: 14.7, streamSpeed: 1.3, streamAngle: -66, streamSpread: 2.61, streamRise: 1.48, streamSize: 1.31, streamOpacity: 1.26, glow: 1.14, glowRadius: 1.66, fade: 0, vignette: 0.72, scanlines: 0.72, speed: 0.81},
    '#44': {cols: 187, exposure: 2.52, black: 0.093, gamma: 1.51, cutoff: 0.204, paper: false, boost: 4.11, mono: false, tint: '#32e05e', mix: 0.22, sqOpacity: 0.15, sqMin: 0.54, glyphSet: 'haunt', glyphOpacity: 1.55, split: 0.86, flicker: 2.4, edgeDensity: 0.28, edgeThr: 0.271, edgeColor: '#c72a74', streamChance: 0.51, streamCount: 4, streamLen: 3, streamSpeed: 2.03, streamAngle: -94, streamSpread: 1.99, streamRise: -0.65, streamSize: 2.13, streamOpacity: 1.45, glow: 0.19, glowRadius: 1.43, fade: 0, vignette: 0.33, scanlines: 0.08, speed: 0.73},
    '#45': {cols: 118, exposure: 2.28, black: 0.008, gamma: 2.39, cutoff: 0.165, paper: false, boost: 5.66, mono: true, tint: '#27d847', mix: 0, sqOpacity: 0.09, sqMin: 0.13, glyphSet: 'haunt', glyphOpacity: 0.47, split: 0.66, flicker: 3.1, edgeDensity: 0.34, edgeThr: 0.213, edgeColor: '#dae28a', streamChance: 1, streamCount: 3, streamLen: 5.8, streamSpeed: 0.79, streamAngle: -135, streamSpread: 0.12, streamRise: 1.63, streamSize: 1.71, streamOpacity: 1.32, glow: 0.92, glowRadius: 2.59, fade: 0, vignette: 0.48, scanlines: 0.13, speed: 1.86},
    '#46': {cols: 293, exposure: 1.21, black: 0.012, gamma: 1.46, cutoff: 0.041, paper: false, boost: 3.86, mono: false, tint: '#e89ab5', mix: 0, sqOpacity: 1.25, sqMin: 0.99, glyphSet: 'haunt', glyphOpacity: 1.66, split: 0.49, flicker: 7.2, edgeDensity: 0.42, edgeThr: 0.28, edgeColor: '#d5ae1d', streamChance: 0.62, streamCount: 1, streamLen: 16.3, streamSpeed: 1.42, streamAngle: 109, streamSpread: 0.93, streamRise: 2.34, streamSize: 1.67, streamOpacity: 0.32, glow: 1.28, glowRadius: 2.54, fade: 0, vignette: 0.24, scanlines: 0.45, speed: 1.58},
    '#47': {cols: 215, exposure: 1.66, black: 0.118, gamma: 1.14, cutoff: 0.066, paper: false, boost: 5.09, mono: true, tint: '#702ce8', mix: 0, sqOpacity: 1.71, sqMin: 0.35, glyphSet: 'kana', glyphOpacity: 0.97, split: 0.48, flicker: 8.7, edgeDensity: 0.02, edgeThr: 0.177, edgeColor: '#9be393', streamChance: 0.25, streamCount: 1, streamLen: 20.3, streamSpeed: 0.5, streamAngle: -57, streamSpread: 1, streamRise: -1.68, streamSize: 2, streamOpacity: 0.35, glow: 1.03, glowRadius: 1.42, fade: 0, vignette: 0.64, scanlines: 0.52, speed: 0.53},
    '#48': {cols: 260, exposure: 1.41, black: 0.102, gamma: 1.91, cutoff: 0.071, paper: false, boost: 2.82, mono: false, tint: '#ee9f9a', mix: 0.56, sqOpacity: 0.05, sqMin: 0.22, glyphSet: 'binary', glyphOpacity: 1.39, split: 0.37, flicker: 3.1, edgeDensity: 0.23, edgeThr: 0.223, edgeColor: '#f87f72', streamChance: 0.81, streamCount: 0, streamLen: 23.5, streamSpeed: 2.21, streamAngle: -122, streamSpread: 1.9, streamRise: -2.39, streamSize: 1.18, streamOpacity: 0.65, glow: 1.78, glowRadius: 2.3, fade: 0, vignette: 0.79, scanlines: 0.77, speed: 1.2},
    '#49': {cols: 217, exposure: 0.81, black: 0.077, gamma: 1.08, cutoff: 0.233, paper: false, boost: 3.5, mono: true, tint: '#c57024', mix: 0.21, sqOpacity: 1, sqMin: 0.33, glyphSet: 'haunt', glyphOpacity: 1.5, split: 0.14, flicker: 7.6, edgeDensity: 0.04, edgeThr: 0.088, edgeColor: '#a1ebec', streamChance: 0.41, streamCount: 2, streamLen: 22.9, streamSpeed: 0.88, streamAngle: 169, streamSpread: 0.98, streamRise: -0.79, streamSize: 0.99, streamOpacity: 0.76, glow: 0.58, glowRadius: 1.94, fade: 0, vignette: 0.32, scanlines: 0.62, speed: 1.66},
    '#50': {cols: 205, exposure: 1.07, black: 0.026, gamma: 1.14, cutoff: 0.224, paper: false, boost: 5.65, mono: false, tint: '#9a32d0', mix: 0, sqOpacity: 0.73, sqMin: 0.36, glyphSet: 'binary', glyphOpacity: 1.13, split: 0.22, flicker: 0.5, edgeDensity: 0.37, edgeThr: 0.178, edgeColor: '#1fd1e4', streamChance: 0.44, streamCount: 4, streamLen: 22.6, streamSpeed: 0.63, streamAngle: 51, streamSpread: 1.45, streamRise: 2.44, streamSize: 1.15, streamOpacity: 0.73, glow: 0.75, glowRadius: 2.05, fade: 0.42, vignette: 0.73, scanlines: 0.77, speed: 0.87},
    '#51': {cols: 88, exposure: 2.49, black: 0.069, gamma: 1.03, cutoff: 0.189, paper: false, boost: 1.35, mono: true, tint: '#68d884', mix: 0, sqOpacity: 0.84, sqMin: 0.41, glyphSet: 'ascii', glyphOpacity: 0.96, split: 0.21, flicker: 2.7, edgeDensity: 0.16, edgeThr: 0.268, edgeColor: '#dd9187', streamChance: 0.63, streamCount: 6, streamLen: 24.1, streamSpeed: 2.4, streamAngle: -91, streamSpread: 2.24, streamRise: 0.52, streamSize: 1.32, streamOpacity: 1.32, glow: 0.33, glowRadius: 2.44, fade: 0.63, vignette: 0.13, scanlines: 0.07, speed: 0.99},
    '#52': {cols: 181, exposure: 2.17, black: 0.091, gamma: 1.34, cutoff: 0.025, paper: false, boost: 2.38, mono: false, tint: '#8e9ffc', mix: 0, sqOpacity: 0.33, sqMin: 0.59, glyphSet: 'binary', glyphOpacity: 0.85, split: 0.21, flicker: 6.4, edgeDensity: 0.33, edgeThr: 0.053, edgeColor: '#67c1fa', streamChance: 0.07, streamCount: 3, streamLen: 15.4, streamSpeed: 0.9, streamAngle: 176, streamSpread: 0.94, streamRise: 0.78, streamSize: 1.22, streamOpacity: 1.15, glow: 0.69, glowRadius: 1.35, fade: 0, vignette: 0.26, scanlines: 0.44, speed: 1.8},
    '#53': {cols: 246, exposure: 1.94, black: 0.089, gamma: 0.79, cutoff: 0.098, paper: false, boost: 4.11, mono: false, tint: '#a3eed9', mix: 0, sqOpacity: 1.77, sqMin: 0.35, glyphSet: 'binary', glyphOpacity: 0.94, split: 0.84, flicker: 9.2, edgeDensity: 0.29, edgeThr: 0.386, edgeColor: '#95f263', streamChance: 0.22, streamCount: 5, streamLen: 22.5, streamSpeed: 2.85, streamAngle: -66, streamSpread: 1.84, streamRise: 1.5, streamSize: 2.12, streamOpacity: 0.66, glow: 2.37, glowRadius: 2.94, fade: 0, vignette: 0.27, scanlines: 0.05, speed: 1.55},
    '#54': {cols: 260, exposure: 2.6, black: 0.069, gamma: 1.56, cutoff: 0.147, paper: false, boost: 2.63, mono: true, tint: '#509afe', mix: 0.3, sqOpacity: 1.24, sqMin: 0.42, glyphSet: 'blocks', glyphOpacity: 1.57, split: 0.83, flicker: 7.6, edgeDensity: 0.68, edgeThr: 0.142, edgeColor: '#f805e1', streamChance: 0.41, streamCount: 2, streamLen: 20.7, streamSpeed: 2.22, streamAngle: 65, streamSpread: 1.17, streamRise: 0.14, streamSize: 1.82, streamOpacity: 0.41, glow: 0.83, glowRadius: 1.36, fade: 0.65, vignette: 0.35, scanlines: 0.46, speed: 0.8},
    '#55': {cols: 233, exposure: 2.05, black: 0.116, gamma: 0.72, cutoff: 0.174, paper: false, boost: 4.23, mono: false, tint: '#df5d32', mix: 0, sqOpacity: 0.15, sqMin: 0.16, glyphSet: 'ascii', glyphOpacity: 0.61, split: 0.46, flicker: 6.6, edgeDensity: 0.21, edgeThr: 0.301, edgeColor: '#7af9df', streamChance: 0.19, streamCount: 2, streamLen: 5.8, streamSpeed: 0.27, streamAngle: 65, streamSpread: 2.23, streamRise: -2.82, streamSize: 2.39, streamOpacity: 1, glow: 2.04, glowRadius: 2.27, fade: 0, vignette: 0.76, scanlines: 0.15, speed: 0.41},
    '#56': {cols: 188, exposure: 2.92, black: 0.096, gamma: 1.76, cutoff: 0.207, paper: false, boost: 4.65, mono: false, tint: '#c944db', mix: 0.48, sqOpacity: 1.52, sqMin: 0.64, glyphSet: 'blocks', glyphOpacity: 0.6, split: 0.35, flicker: 8.2, edgeDensity: 0.34, edgeThr: 0.294, edgeColor: '#6fd9fa', streamChance: 0.84, streamCount: 1, streamLen: 3.7, streamSpeed: 2.55, streamAngle: 92, streamSpread: 0.82, streamRise: 2.76, streamSize: 1.64, streamOpacity: 0.73, glow: 2.03, glowRadius: 1.48, fade: 0, vignette: 0.11, scanlines: 0.49, speed: 1.9},
    '#57': {cols: 225, exposure: 2.57, black: 0.081, gamma: 1.82, cutoff: 0.183, paper: false, boost: 5.2, mono: false, tint: '#f57ed9', mix: 0, sqOpacity: 0.79, sqMin: 0.63, glyphSet: 'kana', glyphOpacity: 0.76, split: 0.87, flicker: 7.3, edgeDensity: 0.37, edgeThr: 0.267, edgeColor: '#e1fe6a', streamChance: 0.77, streamCount: 4, streamLen: 12.2, streamSpeed: 1.58, streamAngle: 7, streamSpread: 0.58, streamRise: -0.91, streamSize: 0.54, streamOpacity: 0.4, glow: 0.59, glowRadius: 0.79, fade: 0.46, vignette: 0.83, scanlines: 0.4, speed: 1.64},
    '#58': {cols: 239, exposure: 2.18, black: 0.054, gamma: 1.84, cutoff: 0.213, paper: false, boost: 4.68, mono: true, tint: '#b4f41f', mix: 0, sqOpacity: 1.25, sqMin: 0.17, glyphSet: 'haunt', glyphOpacity: 0.59, split: 0.7, flicker: 6, edgeDensity: 0.14, edgeThr: 0.078, edgeColor: '#729dd3', streamChance: 0.11, streamCount: 5, streamLen: 14.6, streamSpeed: 1.73, streamAngle: -52, streamSpread: 1.54, streamRise: -2.38, streamSize: 0.65, streamOpacity: 0.45, glow: 0.39, glowRadius: 0.9, fade: 0, vignette: 0.27, scanlines: 0.26, speed: 1.05},
    '#59': {cols: 234, exposure: 1.68, black: 0.013, gamma: 1.65, cutoff: 0.214, paper: false, boost: 4.23, mono: false, tint: '#7659cb', mix: 0, sqOpacity: 1.23, sqMin: 0.42, glyphSet: 'haunt', glyphOpacity: 0.75, split: 0.42, flicker: 0.4, edgeDensity: 0.47, edgeThr: 0.263, edgeColor: '#e8c0a4', streamChance: 0.08, streamCount: 5, streamLen: 18.8, streamSpeed: 1.81, streamAngle: 69, streamSpread: 1.77, streamRise: 0.34, streamSize: 1.87, streamOpacity: 0.53, glow: 1.08, glowRadius: 1.58, fade: 0, vignette: 0.94, scanlines: 0.79, speed: 0.59},
    '#60': {cols: 226, exposure: 2.97, black: 0.103, gamma: 1.15, cutoff: 0.203, paper: false, boost: 1.21, mono: false, tint: '#8569ed', mix: 0, sqOpacity: 1.54, sqMin: 0.81, glyphSet: 'kana', glyphOpacity: 1.55, split: 0.12, flicker: 1.5, edgeDensity: 0.98, edgeThr: 0.394, edgeColor: '#f5d68e', streamChance: 0.83, streamCount: 4, streamLen: 27.1, streamSpeed: 2.13, streamAngle: -113, streamSpread: 2.44, streamRise: -1.03, streamSize: 1.02, streamOpacity: 0.85, glow: 1.43, glowRadius: 0.55, fade: 0, vignette: 0.94, scanlines: 0.44, speed: 0.57},
    '#61': {cols: 274, exposure: 2.95, black: 0.065, gamma: 1.95, cutoff: 0.175, paper: false, boost: 5.7, mono: true, tint: '#6660d4', mix: 0.11, sqOpacity: 0.9, sqMin: 0.9, glyphSet: 'kana', glyphOpacity: 1.78, split: 0.65, flicker: 9.2, edgeDensity: 0.95, edgeThr: 0.239, edgeColor: '#8138b7', streamChance: 0.15, streamCount: 2, streamLen: 27, streamSpeed: 1.56, streamAngle: -32, streamSpread: 1.34, streamRise: 1.2, streamSize: 1.18, streamOpacity: 0.92, glow: 2.17, glowRadius: 1.97, fade: 0.33, vignette: 0.06, scanlines: 0.71, speed: 1.17},
    '#62': {cols: 196, exposure: 2.89, black: 0.107, gamma: 1.48, cutoff: 0.088, paper: false, boost: 3.3, mono: false, tint: '#a16ff1', mix: 0.45, sqOpacity: 0.13, sqMin: 0.76, glyphSet: 'binary', glyphOpacity: 1.56, split: 0.77, flicker: 8.7, edgeDensity: 0.56, edgeThr: 0.242, edgeColor: '#ed305b', streamChance: 0.87, streamCount: 4, streamLen: 13.9, streamSpeed: 2.98, streamAngle: 99, streamSpread: 0.15, streamRise: -2.05, streamSize: 1.93, streamOpacity: 1.37, glow: 1.53, glowRadius: 2.11, fade: 0.87, vignette: 0.13, scanlines: 0.19, speed: 1.72},
    '#63': {cols: 264, exposure: 0.89, black: 0.045, gamma: 2.02, cutoff: 0.115, paper: false, boost: 2.64, mono: false, tint: '#94aeee', mix: 0.11, sqOpacity: 0.99, sqMin: 0.48, glyphSet: 'binary', glyphOpacity: 0.96, split: 0.81, flicker: 4.1, edgeDensity: 0.7, edgeThr: 0.325, edgeColor: '#85c1ff', streamChance: 0.64, streamCount: 1, streamLen: 13.4, streamSpeed: 1.56, streamAngle: 120, streamSpread: 0.75, streamRise: -2.4, streamSize: 1.29, streamOpacity: 0.81, glow: 2.25, glowRadius: 1.91, fade: 0, vignette: 0.2, scanlines: 0.09, speed: 1.32},
    '#64': {cols: 295, exposure: 1.37, black: 0.106, gamma: 1.4, cutoff: 0.063, paper: false, boost: 2.14, mono: false, tint: '#59cbc3', mix: 0, sqOpacity: 0.87, sqMin: 0.67, glyphSet: 'haunt', glyphOpacity: 1.64, split: 0.58, flicker: 8.8, edgeDensity: 0.35, edgeThr: 0.11, edgeColor: '#5ebbf9', streamChance: 0.19, streamCount: 1, streamLen: 23.8, streamSpeed: 1.53, streamAngle: 67, streamSpread: 2.36, streamRise: 1.93, streamSize: 1.17, streamOpacity: 1.07, glow: 0.83, glowRadius: 0.61, fade: 0.28, vignette: 0.47, scanlines: 0.37, speed: 1.15},
    '#65': {cols: 300, exposure: 1.42, black: 0.012, gamma: 0.75, cutoff: 0.204, paper: false, boost: 4.57, mono: false, tint: '#d035fb', mix: 0, sqOpacity: 1.57, sqMin: 0.48, glyphSet: 'kana', glyphOpacity: 1.41, split: 0.37, flicker: 3.6, edgeDensity: 0.63, edgeThr: 0.287, edgeColor: '#b2fa8a', streamChance: 0.58, streamCount: 1, streamLen: 23.3, streamSpeed: 0.59, streamAngle: -147, streamSpread: 1.05, streamRise: 0.68, streamSize: 1.59, streamOpacity: 0.36, glow: 2.13, glowRadius: 0.63, fade: 0, vignette: 0.91, scanlines: 0.53, speed: 1.21},
    '#66': {cols: 172, exposure: 2.98, black: 0.108, gamma: 1.53, cutoff: 0.031, paper: false, boost: 3.86, mono: true, tint: '#fbec38', mix: 0, sqOpacity: 0.26, sqMin: 0.7, glyphSet: 'ascii', glyphOpacity: 1.73, split: 0.45, flicker: 7.2, edgeDensity: 0.53, edgeThr: 0.237, edgeColor: '#fb0ff8', streamChance: 0.71, streamCount: 4, streamLen: 7.2, streamSpeed: 1.4, streamAngle: -47, streamSpread: 0.85, streamRise: -1.36, streamSize: 0.51, streamOpacity: 0.83, glow: 0.14, glowRadius: 2.02, fade: 0, vignette: 0.69, scanlines: 0.57, speed: 0.82},
    '#67': {cols: 115, exposure: 1.48, black: 0.039, gamma: 1.14, cutoff: 0.226, paper: false, boost: 4.76, mono: false, tint: '#76df3c', mix: 0, sqOpacity: 1.5, sqMin: 0.39, glyphSet: 'haunt', glyphOpacity: 1.2, split: 0.51, flicker: 1.9, edgeDensity: 0.1, edgeThr: 0.245, edgeColor: '#4b9be8', streamChance: 0.4, streamCount: 1, streamLen: 3.3, streamSpeed: 2.69, streamAngle: 82, streamSpread: 0.66, streamRise: -1.48, streamSize: 1.02, streamOpacity: 1.45, glow: 1.04, glowRadius: 2.92, fade: 0, vignette: 0.31, scanlines: 0.03, speed: 0.65},
    '#68': {cols: 152, exposure: 1.49, black: 0.027, gamma: 2.1, cutoff: 0.238, paper: false, boost: 3.01, mono: false, tint: '#f023d6', mix: 0.2, sqOpacity: 1.11, sqMin: 0.19, glyphSet: 'binary', glyphOpacity: 1.46, split: 0.26, flicker: 4.4, edgeDensity: 0.81, edgeThr: 0.157, edgeColor: '#b36e3a', streamChance: 0.51, streamCount: 4, streamLen: 4.3, streamSpeed: 1.9, streamAngle: 53, streamSpread: 0.42, streamRise: -0.36, streamSize: 1.13, streamOpacity: 1.37, glow: 0.69, glowRadius: 2.39, fade: 0, vignette: 0.94, scanlines: 0.2, speed: 0.76},
    '#69': {cols: 155, exposure: 2.32, black: 0.003, gamma: 1.53, cutoff: 0.248, paper: false, boost: 2.64, mono: true, tint: '#ba64e6', mix: 0, sqOpacity: 0.89, sqMin: 0.63, glyphSet: 'ascii', glyphOpacity: 0.86, split: 0.13, flicker: 9.9, edgeDensity: 0.75, edgeThr: 0.066, edgeColor: '#d6bd66', streamChance: 0.9, streamCount: 0, streamLen: 27.2, streamSpeed: 1.58, streamAngle: 166, streamSpread: 2.8, streamRise: 2.8, streamSize: 2.09, streamOpacity: 0.33, glow: 1.4, glowRadius: 2.51, fade: 0, vignette: 0.09, scanlines: 0.56, speed: 1.94},
    '#70': {cols: 194, exposure: 2.71, black: 0.071, gamma: 2.2, cutoff: 0.147, paper: false, boost: 1.73, mono: true, tint: '#3fc380', mix: 0, sqOpacity: 1.23, sqMin: 0.52, glyphSet: 'ascii', glyphOpacity: 1.72, split: 0.14, flicker: 0.1, edgeDensity: 0.06, edgeThr: 0.077, edgeColor: '#caebc1', streamChance: 0.85, streamCount: 2, streamLen: 8.5, streamSpeed: 0.41, streamAngle: 173, streamSpread: 0.45, streamRise: -1.08, streamSize: 1.89, streamOpacity: 0.48, glow: 2.21, glowRadius: 1.47, fade: 0, vignette: 0.72, scanlines: 0.31, speed: 1.19},
    '#71': {cols: 98, exposure: 1.88, black: 0.031, gamma: 1.18, cutoff: 0.204, paper: false, boost: 5.22, mono: true, tint: '#b95d36', mix: 0, sqOpacity: 0.72, sqMin: 0.18, glyphSet: 'haunt', glyphOpacity: 0.45, split: 0.59, flicker: 2.5, edgeDensity: 0.73, edgeThr: 0.299, edgeColor: '#c9fca8', streamChance: 0.98, streamCount: 4, streamLen: 3.3, streamSpeed: 2.65, streamAngle: 106, streamSpread: 1.86, streamRise: -0.24, streamSize: 2.32, streamOpacity: 1.19, glow: 1.72, glowRadius: 2.29, fade: 0.51, vignette: 0.74, scanlines: 0.26, speed: 0.76},
    '#72': {cols: 73, exposure: 1.11, black: 0.024, gamma: 1.15, cutoff: 0.113, paper: false, boost: 2.85, mono: true, tint: '#9267e6', mix: 0.24, sqOpacity: 0.84, sqMin: 0.52, glyphSet: 'binary', glyphOpacity: 0.74, split: 0.38, flicker: 8.6, edgeDensity: 0.92, edgeThr: 0.271, edgeColor: '#ddcf42', streamChance: 0.6, streamCount: 2, streamLen: 29.7, streamSpeed: 2.66, streamAngle: -179, streamSpread: 1.23, streamRise: -0.62, streamSize: 1.64, streamOpacity: 0.67, glow: 0.64, glowRadius: 0.8, fade: 0.76, vignette: 0.87, scanlines: 0.31, speed: 1.45},
    '#73': {cols: 254, exposure: 0.99, black: 0.111, gamma: 2.33, cutoff: 0.104, paper: false, boost: 2.46, mono: false, tint: '#1edee9', mix: 0, sqOpacity: 1.5, sqMin: 0.78, glyphSet: 'haunt', glyphOpacity: 1.79, split: 0.17, flicker: 3.8, edgeDensity: 0.42, edgeThr: 0.369, edgeColor: '#b3b9fd', streamChance: 0.63, streamCount: 5, streamLen: 19.9, streamSpeed: 2.58, streamAngle: -60, streamSpread: 1.55, streamRise: -1.07, streamSize: 1.13, streamOpacity: 1.16, glow: 2.44, glowRadius: 0.66, fade: 0.29, vignette: 0.46, scanlines: 0.21, speed: 1.13},
    '#74': {cols: 211, exposure: 1.55, black: 0.042, gamma: 1.71, cutoff: 0.068, paper: false, boost: 3.44, mono: true, tint: '#55d9e9', mix: 0, sqOpacity: 0.2, sqMin: 0.46, glyphSet: 'haunt', glyphOpacity: 1.61, split: 0.52, flicker: 4.4, edgeDensity: 0.74, edgeThr: 0.303, edgeColor: '#a10df7', streamChance: 0.74, streamCount: 4, streamLen: 17.2, streamSpeed: 1.28, streamAngle: 132, streamSpread: 0.93, streamRise: 2.54, streamSize: 0.83, streamOpacity: 0.66, glow: 0.66, glowRadius: 1.74, fade: 0, vignette: 0.92, scanlines: 0.76, speed: 0.86},
    '#75': {cols: 138, exposure: 1.11, black: 0.092, gamma: 0.76, cutoff: 0.124, paper: true, boost: 5.01, mono: false, tint: '#d778ad', mix: 0, sqOpacity: 1.5, sqMin: 0.46, glyphSet: 'kana', glyphOpacity: 0.41, split: 0.69, flicker: 3.7, edgeDensity: 0.85, edgeThr: 0.072, edgeColor: '#cbc3ee', streamChance: 0.07, streamCount: 3, streamLen: 12.4, streamSpeed: 2.01, streamAngle: -77, streamSpread: 0.32, streamRise: 2.24, streamSize: 1.28, streamOpacity: 1.1, glow: 2.39, glowRadius: 1.14, fade: 0, vignette: 0.03, scanlines: 0.15, speed: 0.94},
    '#76': {cols: 107, exposure: 0.94, black: 0.097, gamma: 1.44, cutoff: 0.054, paper: true, boost: 1.87, mono: false, tint: '#d297e0', mix: 0, sqOpacity: 0.44, sqMin: 0.27, glyphSet: 'kana', glyphOpacity: 1.01, split: 0.72, flicker: 2.5, edgeDensity: 0.23, edgeThr: 0.185, edgeColor: '#e6c18e', streamChance: 0.54, streamCount: 5, streamLen: 28.1, streamSpeed: 0.87, streamAngle: -86, streamSpread: 0.16, streamRise: -0.37, streamSize: 1.22, streamOpacity: 1.36, glow: 1.68, glowRadius: 0.83, fade: 0.5, vignette: 0.86, scanlines: 0.48, speed: 1.08},
    '#77': {cols: 241, exposure: 1.52, black: 0.067, gamma: 0.76, cutoff: 0.052, paper: false, boost: 4.45, mono: false, tint: '#979cf8', mix: 0, sqOpacity: 1.73, sqMin: 0.92, glyphSet: 'binary', glyphOpacity: 0.78, split: 0.42, flicker: 1.4, edgeDensity: 0.69, edgeThr: 0.346, edgeColor: '#32dea4', streamChance: 0.51, streamCount: 2, streamLen: 28.5, streamSpeed: 2.28, streamAngle: 119, streamSpread: 2.72, streamRise: -0.6, streamSize: 1.06, streamOpacity: 0.54, glow: 2.11, glowRadius: 1.08, fade: 0.99, vignette: 0.69, scanlines: 0.27, speed: 1.26},
    '#78': {cols: 272, exposure: 1.82, black: 0.093, gamma: 0.94, cutoff: 0.023, paper: false, boost: 3.69, mono: false, tint: '#56cb94', mix: 0, sqOpacity: 0.49, sqMin: 0.94, glyphSet: 'haunt', glyphOpacity: 1.78, split: 0.81, flicker: 6.8, edgeDensity: 0.85, edgeThr: 0.094, edgeColor: '#c1f88a', streamChance: 0.26, streamCount: 2, streamLen: 17.5, streamSpeed: 0.67, streamAngle: 11, streamSpread: 0.92, streamRise: 1.15, streamSize: 1.16, streamOpacity: 0.73, glow: 1.28, glowRadius: 1.27, fade: 0, vignette: 0.38, scanlines: 0.79, speed: 1.7},
    '#79': {cols: 139, exposure: 1.04, black: 0.048, gamma: 1.67, cutoff: 0.205, paper: false, boost: 4.56, mono: false, tint: '#db64b1', mix: 0, sqOpacity: 1.59, sqMin: 0.94, glyphSet: 'blocks', glyphOpacity: 1.78, split: 0.29, flicker: 0.7, edgeDensity: 0.13, edgeThr: 0.218, edgeColor: '#a3feee', streamChance: 0.48, streamCount: 1, streamLen: 29.5, streamSpeed: 0.93, streamAngle: -173, streamSpread: 0.66, streamRise: -1.4, streamSize: 2.48, streamOpacity: 0.74, glow: 1.83, glowRadius: 1.85, fade: 0, vignette: 0.98, scanlines: 0.53, speed: 0.76},
    '#80': {cols: 249, exposure: 2.01, black: 0.104, gamma: 1.76, cutoff: 0.204, paper: false, boost: 3.49, mono: false, tint: '#d7116a', mix: 0.11, sqOpacity: 1.6, sqMin: 0.91, glyphSet: 'ascii', glyphOpacity: 1.17, split: 0.5, flicker: 3.4, edgeDensity: 0.13, edgeThr: 0.188, edgeColor: '#8ce177', streamChance: 0.43, streamCount: 0, streamLen: 18.2, streamSpeed: 2.27, streamAngle: 33, streamSpread: 0.45, streamRise: 1.94, streamSize: 1.99, streamOpacity: 1.22, glow: 2.41, glowRadius: 1.32, fade: 0, vignette: 0.45, scanlines: 0.26, speed: 1.47},
    '#81': {cols: 240, exposure: 2.47, black: 0.094, gamma: 1.93, cutoff: 0.01, paper: false, boost: 1.33, mono: false, tint: '#e48e5d', mix: 0.4, sqOpacity: 0.23, sqMin: 0.35, glyphSet: 'kana', glyphOpacity: 1.01, split: 0.88, flicker: 9.9, edgeDensity: 0.45, edgeThr: 0.12, edgeColor: '#ef640f', streamChance: 0.36, streamCount: 5, streamLen: 23.9, streamSpeed: 1.06, streamAngle: -56, streamSpread: 1.47, streamRise: -0.86, streamSize: 1.27, streamOpacity: 1.13, glow: 0.94, glowRadius: 2.39, fade: 0.42, vignette: 0.64, scanlines: 0.3, speed: 0.68},
    '#82': {cols: 221, exposure: 2.85, black: 0.054, gamma: 0.99, cutoff: 0.179, paper: false, boost: 3.98, mono: true, tint: '#7719f7', mix: 0.37, sqOpacity: 0.11, sqMin: 0.18, glyphSet: 'kana', glyphOpacity: 1.27, split: 0.88, flicker: 7.5, edgeDensity: 0.17, edgeThr: 0.239, edgeColor: '#d4c775', streamChance: 0.32, streamCount: 2, streamLen: 29.1, streamSpeed: 1.86, streamAngle: -27, streamSpread: 0.62, streamRise: 0.8, streamSize: 2.42, streamOpacity: 1.3, glow: 0.33, glowRadius: 0.64, fade: 0, vignette: 0.56, scanlines: 0.08, speed: 1.31},
    '#83': {cols: 254, exposure: 1.11, black: 0.095, gamma: 2.07, cutoff: 0.047, paper: false, boost: 5.16, mono: false, tint: '#e38fab', mix: 0, sqOpacity: 0.11, sqMin: 0.44, glyphSet: 'haunt', glyphOpacity: 1.05, split: 0.46, flicker: 3.1, edgeDensity: 0.82, edgeThr: 0.174, edgeColor: '#5a75e3', streamChance: 0.78, streamCount: 5, streamLen: 5.3, streamSpeed: 0.36, streamAngle: 129, streamSpread: 2.09, streamRise: -1.82, streamSize: 2.15, streamOpacity: 1.18, glow: 2.02, glowRadius: 2.44, fade: 0.6, vignette: 0.04, scanlines: 0.41, speed: 1.46},
    '#84': {cols: 98, exposure: 2.65, black: 0.006, gamma: 1.78, cutoff: 0.135, paper: false, boost: 4.36, mono: false, tint: '#ca79dd', mix: 0, sqOpacity: 1.58, sqMin: 0.85, glyphSet: 'ascii', glyphOpacity: 1.61, split: 0.22, flicker: 5, edgeDensity: 0.55, edgeThr: 0.112, edgeColor: '#a850d2', streamChance: 0.55, streamCount: 4, streamLen: 3.2, streamSpeed: 2.29, streamAngle: -54, streamSpread: 2.56, streamRise: -1.44, streamSize: 1.54, streamOpacity: 0.89, glow: 0.5, glowRadius: 0.82, fade: 0.5, vignette: 0.41, scanlines: 0.04, speed: 1.86},
    '#85': {cols: 144, exposure: 1.86, black: 0.013, gamma: 1.93, cutoff: 0.224, paper: false, boost: 4.15, mono: false, tint: '#fb5c97', mix: 0.21, sqOpacity: 0.44, sqMin: 0.65, glyphSet: 'ascii', glyphOpacity: 0.83, split: 0.41, flicker: 2.9, edgeDensity: 0.33, edgeThr: 0.373, edgeColor: '#3bb38d', streamChance: 0.18, streamCount: 3, streamLen: 13.5, streamSpeed: 2.18, streamAngle: 113, streamSpread: 0.32, streamRise: -0.92, streamSize: 1.98, streamOpacity: 0.88, glow: 2.48, glowRadius: 1.57, fade: 0.83, vignette: 0.22, scanlines: 0.13, speed: 1.39},
    '#86': {cols: 184, exposure: 1.45, black: 0.092, gamma: 1.08, cutoff: 0.047, paper: false, boost: 5.64, mono: false, tint: '#9bf7f5', mix: 0.58, sqOpacity: 0.29, sqMin: 0.92, glyphSet: 'blocks', glyphOpacity: 1.07, split: 0.36, flicker: 8.2, edgeDensity: 0.48, edgeThr: 0.278, edgeColor: '#f8114d', streamChance: 0.01, streamCount: 2, streamLen: 24.3, streamSpeed: 2.26, streamAngle: -110, streamSpread: 2.77, streamRise: 1.26, streamSize: 2.28, streamOpacity: 1.14, glow: 1.07, glowRadius: 1.73, fade: 0, vignette: 0.1, scanlines: 0.66, speed: 1.34},
    '#87': {cols: 166, exposure: 2.71, black: 0.072, gamma: 1.23, cutoff: 0.056, paper: false, boost: 5.22, mono: true, tint: '#c606e6', mix: 0, sqOpacity: 0.36, sqMin: 0.64, glyphSet: 'haunt', glyphOpacity: 0.95, split: 0.5, flicker: 9.4, edgeDensity: 0.8, edgeThr: 0.292, edgeColor: '#30bcc1', streamChance: 0.58, streamCount: 5, streamLen: 4.5, streamSpeed: 1.19, streamAngle: -109, streamSpread: 1.59, streamRise: 2.41, streamSize: 0.87, streamOpacity: 0.46, glow: 0.23, glowRadius: 1.04, fade: 0.22, vignette: 0.42, scanlines: 0.41, speed: 1.68},
    '#88': {cols: 199, exposure: 2.32, black: 0.009, gamma: 1.04, cutoff: 0.173, paper: false, boost: 5, mono: true, tint: '#deb07e', mix: 0, sqOpacity: 1.78, sqMin: 0.49, glyphSet: 'blocks', glyphOpacity: 0.87, split: 0.43, flicker: 3.5, edgeDensity: 0.85, edgeThr: 0.271, edgeColor: '#8c21d3', streamChance: 0.24, streamCount: 4, streamLen: 24.4, streamSpeed: 0.96, streamAngle: 113, streamSpread: 0.75, streamRise: -0.46, streamSize: 0.85, streamOpacity: 0.71, glow: 0.35, glowRadius: 0.62, fade: 0.29, vignette: 0.5, scanlines: 0.17, speed: 1.16},
    '#89': {cols: 289, exposure: 1.42, black: 0.029, gamma: 1.92, cutoff: 0.04, paper: false, boost: 4.05, mono: true, tint: '#cedb12', mix: 0, sqOpacity: 1.75, sqMin: 0.23, glyphSet: 'haunt', glyphOpacity: 0.94, split: 0.7, flicker: 0.3, edgeDensity: 0.3, edgeThr: 0.294, edgeColor: '#e9f169', streamChance: 0.55, streamCount: 6, streamLen: 23.3, streamSpeed: 2.48, streamAngle: -94, streamSpread: 0.61, streamRise: -1.14, streamSize: 0.59, streamOpacity: 0.4, glow: 0.14, glowRadius: 1.83, fade: 0.34, vignette: 0.77, scanlines: 0.27, speed: 1.46},
    '#90': {cols: 287, exposure: 1.69, black: 0.076, gamma: 1.9, cutoff: 0.081, paper: false, boost: 4.88, mono: false, tint: '#b6693d', mix: 0, sqOpacity: 0.11, sqMin: 0.9, glyphSet: 'blocks', glyphOpacity: 1.16, split: 0.39, flicker: 1.4, edgeDensity: 0.17, edgeThr: 0.084, edgeColor: '#434ae1', streamChance: 0.47, streamCount: 3, streamLen: 18.3, streamSpeed: 1.88, streamAngle: 53, streamSpread: 1.96, streamRise: 2.29, streamSize: 2.46, streamOpacity: 1.28, glow: 1.79, glowRadius: 1.32, fade: 0, vignette: 0.29, scanlines: 0.31, speed: 1.18},
    '#91': {cols: 226, exposure: 2.5, black: 0.081, gamma: 2.26, cutoff: 0.07, paper: false, boost: 5.21, mono: false, tint: '#5fdbea', mix: 0, sqOpacity: 0.76, sqMin: 0.93, glyphSet: 'blocks', glyphOpacity: 1.72, split: 0.69, flicker: 8, edgeDensity: 0.3, edgeThr: 0.213, edgeColor: '#9df0e8', streamChance: 0.51, streamCount: 2, streamLen: 27.7, streamSpeed: 2.69, streamAngle: 142, streamSpread: 0.69, streamRise: 1.23, streamSize: 2.46, streamOpacity: 1.48, glow: 1.43, glowRadius: 2.87, fade: 0, vignette: 0.03, scanlines: 0.45, speed: 1.26},
    '#92': {cols: 218, exposure: 1.21, black: 0.001, gamma: 1.53, cutoff: 0.084, paper: false, boost: 4.49, mono: false, tint: '#4f15f4', mix: 0.34, sqOpacity: 0.25, sqMin: 0.49, glyphSet: 'ascii', glyphOpacity: 1.6, split: 0.78, flicker: 5.4, edgeDensity: 0.62, edgeThr: 0.267, edgeColor: '#c94d3c', streamChance: 0.97, streamCount: 5, streamLen: 18.8, streamSpeed: 1.33, streamAngle: -46, streamSpread: 2.67, streamRise: -1.18, streamSize: 1.46, streamOpacity: 1.22, glow: 0.82, glowRadius: 1.3, fade: 0, vignette: 0.41, scanlines: 0.05, speed: 0.94},
    '#93': {cols: 282, exposure: 1.55, black: 0.049, gamma: 1.92, cutoff: 0.186, paper: true, boost: 4.84, mono: false, tint: '#39ce94', mix: 0, sqOpacity: 0.69, sqMin: 0.39, glyphSet: 'binary', glyphOpacity: 1.54, split: 0.17, flicker: 1.1, edgeDensity: 0.82, edgeThr: 0.216, edgeColor: '#fbacad', streamChance: 0.73, streamCount: 1, streamLen: 28.6, streamSpeed: 0.59, streamAngle: -3, streamSpread: 1.82, streamRise: -2.49, streamSize: 1.22, streamOpacity: 0.54, glow: 0.06, glowRadius: 2.05, fade: 0.28, vignette: 0.33, scanlines: 0.25, speed: 1.56},
    '#94': {cols: 114, exposure: 1.14, black: 0.06, gamma: 1.86, cutoff: 0.111, paper: false, boost: 3.47, mono: false, tint: '#f6b6dd', mix: 0, sqOpacity: 1.52, sqMin: 0.52, glyphSet: 'ascii', glyphOpacity: 0.49, split: 0.74, flicker: 0.7, edgeDensity: 0.15, edgeThr: 0.108, edgeColor: '#ca72e8', streamChance: 0.21, streamCount: 0, streamLen: 22.6, streamSpeed: 0.48, streamAngle: 46, streamSpread: 0.53, streamRise: 1.85, streamSize: 2.23, streamOpacity: 0.57, glow: 0.21, glowRadius: 1.21, fade: 0, vignette: 0.77, scanlines: 0.17, speed: 1.64},
    '#95': {cols: 260, exposure: 1.11, black: 0.092, gamma: 1.38, cutoff: 0.103, paper: false, boost: 5.85, mono: false, tint: '#ee70cd', mix: 0, sqOpacity: 1.26, sqMin: 0.4, glyphSet: 'blocks', glyphOpacity: 0.75, split: 0.44, flicker: 6, edgeDensity: 0.5, edgeThr: 0.369, edgeColor: '#8deb8d', streamChance: 0.65, streamCount: 1, streamLen: 24.9, streamSpeed: 0.6, streamAngle: -78, streamSpread: 0.83, streamRise: -2.13, streamSize: 2.3, streamOpacity: 0.75, glow: 1.62, glowRadius: 2.5, fade: 0, vignette: 0.36, scanlines: 0.03, speed: 0.92},
    '#96': {cols: 104, exposure: 2.7, black: 0.026, gamma: 1.46, cutoff: 0.154, paper: false, boost: 5.75, mono: false, tint: '#78f093', mix: 0, sqOpacity: 0.76, sqMin: 0.79, glyphSet: 'kana', glyphOpacity: 0.48, split: 0.16, flicker: 1.8, edgeDensity: 0.11, edgeThr: 0.191, edgeColor: '#f02381', streamChance: 0.72, streamCount: 5, streamLen: 4.2, streamSpeed: 1.83, streamAngle: 36, streamSpread: 2.22, streamRise: 1.4, streamSize: 2.14, streamOpacity: 1.06, glow: 0.4, glowRadius: 1.4, fade: 0, vignette: 0.38, scanlines: 0.19, speed: 0.6},
    '#97': {cols: 149, exposure: 2.75, black: 0.055, gamma: 2.36, cutoff: 0.185, paper: false, boost: 3.38, mono: false, tint: '#e7498b', mix: 0, sqOpacity: 0.51, sqMin: 1, glyphSet: 'ascii', glyphOpacity: 0.46, split: 0.39, flicker: 1, edgeDensity: 0.01, edgeThr: 0.141, edgeColor: '#74c8d4', streamChance: 0.83, streamCount: 5, streamLen: 18.3, streamSpeed: 1.8, streamAngle: -78, streamSpread: 1.84, streamRise: 1.96, streamSize: 2.47, streamOpacity: 1.23, glow: 1.05, glowRadius: 2.21, fade: 0, vignette: 0.78, scanlines: 0.44, speed: 1.12},
    '#98': {cols: 185, exposure: 2, black: 0.102, gamma: 2.39, cutoff: 0.097, paper: false, boost: 5.62, mono: true, tint: '#ee125c', mix: 0, sqOpacity: 1.43, sqMin: 0.49, glyphSet: 'binary', glyphOpacity: 1.17, split: 0.19, flicker: 7.6, edgeDensity: 0.25, edgeThr: 0.229, edgeColor: '#92e2f7', streamChance: 0.58, streamCount: 5, streamLen: 16.4, streamSpeed: 1.81, streamAngle: 34, streamSpread: 2.78, streamRise: 0.47, streamSize: 0.81, streamOpacity: 1.28, glow: 1.32, glowRadius: 2.05, fade: 0, vignette: 0.57, scanlines: 0.04, speed: 0.5},
    '#99': {cols: 187, exposure: 1.68, black: 0.049, gamma: 1.72, cutoff: 0.217, paper: false, boost: 4.04, mono: false, tint: '#c25c35', mix: 0.18, sqOpacity: 0.08, sqMin: 0.46, glyphSet: 'blocks', glyphOpacity: 1.57, split: 0.89, flicker: 9.5, edgeDensity: 0.37, edgeThr: 0.278, edgeColor: '#9d1fd7', streamChance: 0.9, streamCount: 3, streamLen: 14.7, streamSpeed: 1.29, streamAngle: 92, streamSpread: 2.71, streamRise: 0.66, streamSize: 1.82, streamOpacity: 0.73, glow: 0.05, glowRadius: 1.9, fade: 0.83, vignette: 0.75, scanlines: 0.49, speed: 0.9},
    '#100': {cols: 282, exposure: 2.53, black: 0.071, gamma: 0.88, cutoff: 0.178, paper: false, boost: 2.27, mono: true, tint: '#a46eda', mix: 0, sqOpacity: 0.87, sqMin: 0.43, glyphSet: 'ascii', glyphOpacity: 0.89, split: 0.14, flicker: 6.7, edgeDensity: 0.54, edgeThr: 0.346, edgeColor: '#b045f5', streamChance: 0.59, streamCount: 4, streamLen: 19.4, streamSpeed: 0.38, streamAngle: 40, streamSpread: 0.9, streamRise: 2.89, streamSize: 1.99, streamOpacity: 1.34, glow: 0.05, glowRadius: 2.53, fade: 0, vignette: 0.62, scanlines: 0.47, speed: 1.73},
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
    panel.innerHTML = '<div class="phead"><h2 class="ptitle">Presets</h2><md-filled-tonal-button id="randomBtn" title="Roll random settings"><md-icon slot="icon">casino</md-icon>Random</md-filled-tonal-button></div>';
    panel.querySelector('#randomBtn').onclick = randomize;
    // phone only (CSS hides it on desktop): presets and settings get a tab each instead of one long scroll
    const tabs = document.createElement('md-tabs'); tabs.className = 'mtabs'; tabs.ariaLabel = 'Panel';
    tabs.innerHTML = '<md-primary-tab><md-icon slot="icon">style</md-icon>Presets</md-primary-tab><md-primary-tab><md-icon slot="icon">tune</md-icon>Settings</md-primary-tab>';
    panel.dataset.tab = 'presets';
    tabs.addEventListener('change', () => {
      panel.dataset.tab = tabs.activeTabIndex ? 'settings' : 'presets';
      if (PHONE.matches) window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    panel.append(tabs);
    // the named presets stay in view; the numbered random batch folds away below them
    const list = document.createElement('div'); list.id = 'presets';
    const keys = Object.keys(PRESETS), isRandom = (k) => /^#\d+$/.test(k);
    const chips = (names) => {
      const set = document.createElement('md-chip-set'); set.className = 'presets';
      for (const k of names) {
        const b = document.createElement('md-filter-chip'); b.label = k; b.dataset.p = k;
        b.addEventListener('click', () => applyPreset(k)); // runs after the chip's own toggle, so markPreset gets the last word
        set.append(b);
      }
      return set;
    };
    list.append(chips(keys.filter((k) => !isRandom(k))));
    if (keys.some(isRandom)) {
      const fold = document.createElement('details'); fold.className = 'randoms'; fold.id = 'randoms';
      fold.innerHTML = `<summary>Random presets <span>${keys.filter(isRandom).length}</span></summary>`;
      fold.append(chips(keys.filter(isRandom)));
      list.append(fold);
    }
    const more = document.createElement('md-text-button'); more.className = 'more'; more.trailingIcon = true; more.hasIcon = true;
    more.innerHTML = 'Modify settings<md-icon slot="icon">expand_more</md-icon>';
    const settings = document.createElement('div'); settings.className = 'settings'; settings.hidden = true;
    more.onclick = () => {
      settings.hidden = !settings.hidden; panel.classList.toggle('open', !settings.hidden);
      more.querySelector('md-icon').textContent = settings.hidden ? 'expand_more' : 'expand_less';
    };
    panel.append(list, more, settings);

    for (const [title, list] of CONTROLS) {
      const det = document.createElement('details'); det.open = PHONE.matches ? title === CONTROLS[0][0] : title !== 'Motion';
      // on a phone the sections behave like an accordion: opening one folds the rest, so it never turns into a wall of sliders
      det.addEventListener('toggle', () => { if (det.open && PHONE.matches) for (const o of settings.querySelectorAll('details')) if (o !== det) o.open = false; });
      det.innerHTML = `<summary>${title}</summary>`;
      for (const c of list) {
        const row = document.createElement('div'); row.className = 'ctl' + (c.type ? ' row' : '');
        const lab = document.createElement('label'); lab.textContent = c.label;
        let el, out = null;
        if (c.type === 'toggle') { el = document.createElement('md-switch'); el.icons = true; }
        else if (c.type === 'color') { el = document.createElement('input'); el.type = 'color'; }
        else if (c.type === 'select') {
          el = document.createElement('md-outlined-select');
          for (const [v, name] of c.options) {
            const o = document.createElement('md-select-option'); o.value = v; o.innerHTML = `<div slot="headline">${name}</div>`;
            if (v === P[c.id]) o.selected = true;
            el.append(o);
          }
        } else {
          el = document.createElement('md-slider'); el.min = c.min; el.max = c.max; el.step = c.step;
          out = document.createElement('output');
          // double-click a slider to put it back
          el.addEventListener('dblclick', () => { P[c.id] = c.def; sync(); changed(); });
        }
        el.id = 'c_' + c.id; el.ariaLabel = c.label;
        const read = () => {
          const v = c.type === 'toggle' ? el.selected : c.type ? el.value : Number(el.value);
          if (v === P[c.id]) return;
          P[c.id] = v;
          if (out) out.value = fmt(c, v);
          markPreset('');
          changed();
        };
        el.addEventListener('input', read); el.addEventListener('change', read);
        row.append(lab);
        if (out) row.append(out);
        row.append(el);
        if (c.hint) { const h = document.createElement('div'); h.className = 'hint'; h.textContent = c.hint; row.append(h); }
        inputs[c.id] = { el, out, c };
        det.append(row);
      }
      settings.append(det);
    }
    const acts = document.createElement('div'); acts.className = 'pacts';
    acts.innerHTML = '<md-filled-button id="shareBtn"><md-icon slot="icon">ios_share</md-icon>Export preset</md-filled-button>'
      + '<md-outlined-button id="resetBtn"><md-icon slot="icon">restart_alt</md-icon>Reset settings</md-outlined-button>';
    settings.append(acts);
    acts.querySelector('#shareBtn').onclick = openPresetCode;
    acts.querySelector('#resetBtn').onclick = () => applyPreset('Rasengan');
    sync();
    try { markPreset(localStorage.getItem(STORE + ':preset') || ''); } catch {}
  }
  function markPreset(name) {
    current = PRESETS[name] ? name : '';
    for (const b of $('presets').querySelectorAll('md-filter-chip')) b.selected = b.dataset.p === current;
    // a random one picked earlier: open the fold so the selection is visible
    if (current && $('randoms')?.querySelector(`[data-p="${CSS.escape(current)}"]`)) $('randoms').open = true;
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
    if (!$('presetName').value) $('presetName').value = current && current !== 'Rasengan' ? current + ' edit' : '';
    $('presetCode').value = presetCode();
    $('presetBox').show();
    setTimeout(() => $('presetName').focus(), 50);
  }
  // same ranges the numbered presets were rolled from. keep a good roll with Export preset
  function randomize() {
    const r = (a, b, dp = 2) => +(a + Math.random() * (b - a)).toFixed(dp), chance = (p) => Math.random() < p;
    const col = () => {
      const h = Math.random() * 360, l = 0.45 + Math.random() * 0.4, a = (0.5 + Math.random() * 0.5) * Math.min(l, 1 - l);
      const f = (n) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
      return '#' + f(0) + f(8) + f(4);
    };
    Object.assign(P, DEFAULTS, {
      cols: Math.round(r(70, 300)), exposure: r(0.8, 3), black: r(0, 0.12, 3), gamma: r(0.7, 2.4), cutoff: r(0, 0.25, 3),
      paper: chance(0.12), boost: r(1, 6), mono: chance(0.35), tint: col(), mix: chance(0.25) ? r(0.1, 0.6) : 0,
      sqOpacity: r(0, 1.8), sqMin: r(0.1, 1), glyphSet: ['haunt', 'haunt', 'blocks', 'kana', 'ascii', 'binary'][Math.floor(Math.random() * 6)],
      glyphOpacity: r(0.3, 1.8), split: r(0.1, 0.9), flicker: r(0, 10, 1),
      edgeDensity: r(0, 1), edgeThr: r(0.05, 0.4, 3), edgeColor: col(),
      streamChance: r(0, 1), streamCount: Math.round(r(0, 6)), streamLen: r(2, 30, 1), streamSpeed: r(0.2, 3), streamAngle: Math.round(r(-180, 180)),
      streamSpread: r(0, 3), streamRise: r(-3, 3), streamSize: r(0.4, 2.5), streamOpacity: r(0.3, 1.5),
      glow: r(0, 2.5), glowRadius: r(0.4, 3), fade: chance(0.3) ? r(0.2, 1) : 0, vignette: r(0, 1), scanlines: r(0, 0.8), speed: r(0.4, 2),
    });
    sync(); changed(); markPreset('');
  }
  function sync() {
    for (const { el, out, c } of Object.values(inputs)) {
      if (c.type === 'toggle') el.selected = !!P[c.id];
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
    resetZoom(false);
    // orig stays untouched so the crop can always be redone from the full picture
    m.orig = m.img; m.origProxy = m.proxy; m.crop = null;
    main = m; img = m.img; proxy = m.proxy;
    baseName = m.name.replace(/\.[^.]+$/, '') || 'image';
    $('drop').hidden = true; $('view').hidden = false;
    $('exportBtn').disabled = $('mExport').disabled = $('cropBtn').disabled = $('mCrop').disabled = false;
    showInfo();
    fit(); dirty = true;
  }
  const showInfo = () => {
    $('info').textContent = `${main.name} · ${img.width} × ${img.height}` + (main.crop ? ` (cropped from ${main.orig.width} × ${main.orig.height})` : '') + (COARSE ? ' · pinch to zoom' : '');
  };

  // ---------------------------------------------------------------------------
  // Crop, done on the original before anything gets filtered
  // ---------------------------------------------------------------------------
  let cropping = false, cr = null, cropK = 1, drag = null;
  const MIN_CROP = 16;
  function openCrop() {
    if (!main || multiOn || busy) return;
    cropping = true;
    resetZoom(false);
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
  // pinch zoom on the main preview (touch and pen). it stays where you leave it, one finger pans while zoomed, and pinching
  // back out past the normal size snaps it home. double-tap zooms in on that spot, or back out. after each gesture the
  // canvas is re-rendered with more pixels, so the zoomed view is sharp rather than stretched
  const ZOOM_MAX = 8, ZOOM_PX = COARSE ? 3.5e6 : 6e6;
  let zs = 1, zx = 0, zy = 0, fitW = 0, fitH = 0, settleTimer = 0;
  function fit() {
    if (cropping) layoutCrop();
    if (multiOn) return fitGrid();
    if (!img) return;
    const sr = stage.getBoundingClientRect(), pad = sr.width < 600 ? 10 : 24;
    const aw = Math.max(50, sr.width - pad * 2), ah = Math.max(50, sr.height - pad * 2);
    const k = Math.min(aw / img.width, ah / img.height);
    const cw = img.width * k, ch = img.height * k;
    fitW = cw; fitH = ch;
    // device pixels, capped so the preview stays smooth (a bigger cap while zoomed); the export renders at full size regardless
    let dpr = Math.min(window.devicePixelRatio || 1, 2) * Math.max(1, zs);
    dpr = Math.min(dpr, Math.sqrt((zs > 1 ? ZOOM_PX : PREVIEW_PX) / (cw * ch)));
    view.style.width = cw + 'px'; view.style.height = ch + 'px';
    view.width = Math.max(1, Math.round(cw * dpr)); view.height = Math.max(1, Math.round(ch * dpr));
    dirty = true;
  }
  new ResizeObserver(() => { resetZoom(false); fit(); }).observe(stage);

  const applyZoom = (anim) => {
    view.classList.toggle('zoom-anim', !!anim);
    view.style.transform = zs === 1 && !zx && !zy ? '' : `translate(${zx}px, ${zy}px) scale(${zs})`;
    stage.classList.toggle('zoomed', zs > 1);
  };
  const settleZoom = () => { clearTimeout(settleTimer); settleTimer = setTimeout(fit, 260); };
  function resetZoom(anim = true) {
    if (zs === 1 && !zx && !zy) return;
    zs = 1; zx = zy = 0; applyZoom(anim);
    if (anim) settleZoom();
  }
  // keep the zoomed picture covering the stage, so it can't be dragged off into the void
  function clampPan() {
    const sr = stage.getBoundingClientRect(), bx = view.offsetLeft, by = view.offsetTop, w = fitW * zs, h = fitH * zs;
    const lim = (tr, base, size, room) => size <= room ? (room - size) / 2 - base : clamp(tr, room - size - base, -base);
    zx = lim(zx, bx, w, sr.width); zy = lim(zy, by, h, sr.height);
  }
  {
    const pts = new Map();
    let g = null, lastTap = 0;
    const begin = () => {
      const p = [...pts.values()], r = view.getBoundingClientRect();
      g = { s: zs, x: zx, y: zy, bl: r.left - zx, bt: r.top - zy,
        mid: p.length > 1 ? [(p[0][0] + p[1][0]) / 2, (p[0][1] + p[1][1]) / 2] : p[0],
        d: p.length > 1 ? Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]) : 0 };
      view.classList.remove('zoom-anim');
    };
    view.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || pts.size >= 2) return;
      view.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      begin();
      if (pts.size > 1) { lastTap = 0; return; }
      const now = performance.now();
      if (now - lastTap > 300) { lastTap = now; return; }
      lastTap = 0; // double tap
      if (zs > 1) resetZoom();
      else {
        const r = view.getBoundingClientRect();
        zs = 2.5; zx = (e.clientX - r.left) * (1 - zs); zy = (e.clientY - r.top) * (1 - zs);
        clampPan(); applyZoom(true); settleZoom();
      }
    });
    view.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      const p = [...pts.values()];
      if (p.length > 1) {
        const d = Math.hypot(p[0][0] - p[1][0], p[0][1] - p[1][1]), mx = (p[0][0] + p[1][0]) / 2, my = (p[0][1] + p[1][1]) / 2;
        const s = clamp(g.s * d / Math.max(1, g.d), 0.6, ZOOM_MAX);
        // the spot of the picture that started under the fingers stays under them
        const ux = (g.mid[0] - g.bl - g.x) / g.s, uy = (g.mid[1] - g.bt - g.y) / g.s;
        zs = s; zx = mx - g.bl - ux * s; zy = my - g.bt - uy * s;
      } else if (zs > 1) {
        zx = g.x + p[0][0] - g.mid[0]; zy = g.y + p[0][1] - g.mid[1];
        clampPan();
      } else return;
      applyZoom();
    });
    const end = (e) => {
      if (!pts.delete(e.pointerId)) return;
      if (pts.size) return begin(); // one finger still down: keep panning from here
      if (zs < 1.05) resetZoom();
      else { clampPan(); applyZoom(true); settleZoom(); }
    };
    view.addEventListener('pointerup', end); view.addEventListener('pointercancel', end);
  }

  const drawOriginal = (cv, src) => {
    const x = cv.getContext('2d');
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(src, 0, 0, cv.width, cv.height);
  };
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    // while a debug cell is blown up only the big copy animates; the dimmed grid behind it can wait
    const shots = multiOn ? (zoomM ? [[zoomCv, zoomM]] : multi.map((m) => [m.cv, m])) : img && !cropping ? [[view, main]] : [];
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
    if (!on) hideZoom(true);
    resetZoom(false);
    multiOn = on; $('multiIcon').textContent = $('mMultiIcon').textContent = on ? 'check_box' : 'check_box_outline_blank';
    $('cropBtn').disabled = $('mCrop').disabled = on || !img;
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
      // mouse: hover blows it up. touch has no hover, so a tap opens it and tapping it again (or another cell) swaps or closes
      cell.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') showZoom(m); });
      cell.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') zoomM === m ? hideZoom(true) : showZoom(m, true); });
      multi.push(m);
    }
    if (!multiOn) setMulti(true); else { fit(); dirty = true; }
  }
  // hovering a cell blows that picture up into a big live preview that grows out of the cell. it lets the pointer through,
  // so sliding across the grid swaps the big view to whichever cell is underneath; leaving the grid puts it away
  const zoomBox = $('zoom'), zoomCv = $('zoomCv');
  let zoomM = null, zoomTimer = 0;
  function showZoom(m, now) {
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(() => {
      if (zoomM === m || !multiOn) return;
      if (zoomM) zoomM.cell.classList.remove('hot');
      const first = !zoomM;
      zoomM = m; m.cell.classList.add('hot'); grid.classList.add('zooming');
      $('zoomName').textContent = m.name;
      fitZoom();
      if (comparing) drawOriginal(zoomCv, m.proxy); else render(zoomCv, t, m.proxy, m); // no blank first frame
      if (first) {
        const sr = stage.getBoundingClientRect(), cr = m.cv.getBoundingClientRect();
        zoomBox.style.transformOrigin = `${cr.left + cr.width / 2 - sr.left}px ${cr.top + cr.height / 2 - sr.top}px`;
        zoomBox.classList.add('on');
      }
    }, zoomM || now ? 0 : 140); // a short wait before the first one, so just passing over the grid doesn't pop it
  }
  function hideZoom(now) {
    clearTimeout(zoomTimer);
    const go = () => {
      if (zoomM) zoomM.cell.classList.remove('hot');
      zoomM = null; grid.classList.remove('zooming'); zoomBox.classList.remove('on');
      dirty = true;
    };
    if (now) go(); else zoomTimer = setTimeout(go, 80);
  }
  grid.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideZoom(); });
  function fitZoom() {
    if (!zoomM) return;
    const sr = stage.getBoundingClientRect(), m = zoomM;
    const k = Math.min(sr.width * 0.88 / m.img.width, (sr.height - 44) * 0.9 / m.img.height);
    const w = m.img.width * k, h = m.img.height * k, dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PREVIEW_PX / (w * h)));
    zoomCv.style.width = w + 'px'; zoomCv.style.height = h + 'px';
    zoomCv.width = Math.max(1, Math.round(w * dpr)); zoomCv.height = Math.max(1, Math.round(h * dpr));
  }
  function clearMulti() {
    hideZoom(true);
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
    const budget = PREVIEW_PX / n;
    for (const m of multi) {
      const k = Math.min(cw / m.img.width, ch / m.img.height);
      const w = m.img.width * k, h = m.img.height * k;
      const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(budget / (w * h)));
      m.cv.style.width = w + 'px'; m.cv.style.height = h + 'px';
      m.cv.width = Math.max(1, Math.round(w * dpr)); m.cv.height = Math.max(1, Math.round(h * dpr));
    }
    fitZoom();
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------
  // phone browsers cap canvas memory far lower (iOS Safari at about 16.7 megapixels), so big upscales are only offered on desktop
  const MAX_AREA = COARSE ? 16e6 : 80e6, MAX_SIDE = COARSE ? 8192 : 16384;
  let exFmt = 'png', exSize = '1'; // exSize mirrors the size select, which only learns about new options a moment after they're added
  const VIDEO_TYPES = ['video/mp4;codecs=avc1.640033', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const videoType = () => window.MediaRecorder && VIDEO_TYPES.find((m) => MediaRecorder.isTypeSupported(m));
  function openExport() {
    if (!img || cropping) return;
    setFmt(exFmt);
    $('exportBox').show();
    requestAnimationFrame(() => ($('exSize').value = exSize));
  }
  function setFmt(f) {
    exFmt = f;
    for (const b of $('fmt').children) b.selected = b.dataset.f === f;
    const W = img.width, H = img.height, sel = $('exSize');
    sel.innerHTML = '';
    // md-select-option rows; the first one is picked unless another asks to be
    const add = (label, v, pick) => {
      const o = document.createElement('md-select-option'); o.value = String(v); o.innerHTML = `<div slot="headline">${label}</div>`;
      if (pick || !sel.children.length) { for (const p of sel.children) p.selected = false; o.selected = true; exSize = o.value; }
      sel.append(o);
    };
    $('exFps').hidden = f !== 'gif';
    if (f === 'video') {
      const long = Math.max(W, H);
      for (const L of [1080, 1440, 2160]) {
        if (L > long && L !== 1080) continue;
        const k = Math.min(1, L / long), w = Math.round(W * k / 2) * 2, h = Math.round(H * k / 2) * 2;
        add(`${w} × ${h}${k === 1 ? ' (original)' : ''}`, k);
      }
      $('exDur').hidden = false;
      const vt = videoType();
      $('exNote').textContent = vt ? `Records the motion in real time as ${vt.includes('mp4') ? 'MP4' : 'WebM'}. Larger sizes may stutter on slower machines; 1080 is the safe pick.` : 'This browser can\'t record video. Try Chrome or Edge.';
      $('exSave').disabled = !vt;
    } else if (f === 'gif') {
      const long = Math.max(W, H);
      for (const L of [320, 480, 640, 800, 1080]) {
        if (L >= long && L !== 320) break;
        const k = Math.min(1, L / long);
        add(`${Math.round(W * k)} × ${Math.round(H * k)}${k === 1 ? ' (original)' : ''}`, k, L === 480);
      }
      if (long < 1080 && long > 320) add(`${W} × ${H} (original)`, 1);
      $('exDur').hidden = false;
      $('exNote').textContent = 'Rendered frame by frame, so it never stutters. GIF only has 256 colours per frame and the files get big fast: 480 for 3 to 5 seconds is a good default.';
      $('exSave').disabled = false;
    } else {
      for (const k of [1, 2, 3, 4]) {
        const w = Math.round(W * k), h = Math.round(H * k);
        if (k > 1 && (w * h > MAX_AREA || Math.max(w, h) > MAX_SIDE)) break;
        add(`${w} × ${h}${k === 1 ? ' (original size)' : ` (${k}× upscale, sharper glyphs)`}`, k);
      }
      $('exDur').hidden = true;
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

  $('exSize').addEventListener('change', (e) => (exSize = e.target.value || exSize));
  function doExport() {
    const k = Number(exSize);
    $('exportBox').close();
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
  $('debugBtn').onclick = () => ($('debug').open = !$('debug').open);
  $('multiToggle').onclick = () => setMulti(!multiOn);
  $('multiAdd').onclick = () => $('multiFile').click();
  $('multiFile').onchange = (e) => { addMulti(e.target.files); e.target.value = ''; };
  $('multiClear').onclick = clearMulti;
  const cmp = $('cmpBtn');
  // the chip flips its own selected state on click; the preview just follows it
  const setComparing = (on) => { comparing = cmp.selected = on; $('mCompareIcon').textContent = on ? 'check_box' : 'check_box_outline_blank'; dirty = true; };
  cmp.addEventListener('click', () => setComparing(cmp.selected));
  // phone header menu and footer: the same actions as the desktop buttons
  $('moreBtn').onclick = () => ($('moreMenu').open = !$('moreMenu').open);
  $('mCrop').onclick = () => (cropping ? closeCrop() : openCrop());
  $('mCompare').onclick = () => setComparing(!comparing);
  $('mMulti').onclick = () => setMulti(!multiOn);
  $('mAdd').onclick = () => $('multiFile').click();
  $('mClear').onclick = clearMulti;
  $('mRandom').onclick = randomize;
  $('mExport').onclick = openExport;
  $('exportBtn').onclick = openExport;
  $('exCancel').onclick = () => $('exportBox').close();
  // dialogs close from their buttons or a click outside, never from the keyboard
  let escAt = -1e9;
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') escAt = performance.now(); }, true);
  for (const d of [$('exportBox'), $('presetBox')]) d.addEventListener('cancel', (e) => { if (performance.now() - escAt < 200) e.preventDefault(); });
  $('exSave').onclick = doExport;
  $('cropBtn').onclick = () => (cropping ? closeCrop() : openCrop());
  $('presetName').addEventListener('input', () => ($('presetCode').value = presetCode()));
  $('presetCode').addEventListener('focus', (e) => e.target.select());
  $('presetClose').onclick = () => $('presetBox').close();
  $('presetCopy').onclick = async () => {
    const ta = $('presetCode');
    try { await navigator.clipboard.writeText(ta.value); } catch { ta.select(); document.execCommand('copy'); }
    toast('Preset code copied.');
  };
  for (const b of $('fmt').children) b.addEventListener('click', () => { setFmt(b.dataset.f); requestAnimationFrame(() => ($('exSize').value = exSize)); });

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
})();
