// 3D tabletop board: tiles, pawns, decks and a die, rendered with three.js.
// game.js owns the game state; this module only draws it and reports clicks.
import * as THREE from '/vendor/three/three.module.js';
import { buildChampion } from './champions.js';

const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const C = {
  bg: css('--bg'), surface: css('--surface'), surface2: css('--surface-2'), line: css('--line'),
  text: css('--text'), muted: css('--muted'), accent: css('--accent'),
  good: css('--good'), bad: css('--bad'), purple: css('--purple'), blue: css('--blue'), orange: css('--orange'),
};
const TILE_COLOR = {
  spawn: C.accent, aura: C.good, cringe: C.bad, booster: C.bad, deathnote: C.bad,
  card: C.purple, shop: C.purple, oasis: C.purple, arena: C.orange, tax: C.orange, storm: C.blue, sprint: C.blue,
};
const DECK = {
  guard: { color: C.blue, icon: 'shield', title: 'Guard', sub: 'Defense & utility', x: -1.25 },
  attack: { color: C.bad, icon: 'bolt', title: 'Attack', sub: 'Offense & chaos', x: 1.25 },
};
const ICON_FONT = '"Material Symbols Rounded"';
const TEXT_FONT = 'Inter, system-ui, sans-serif';
const TILE_H = 0.14;
const HOP_MS = 220;
const TBAG_MS = 1800; // 6 dips of 300ms

function mix(a, b, t) {
  const pa = new THREE.Color(a);
  return '#' + pa.lerp(new THREE.Color(b), 1 - t).getHexString();
}

// Same layout as the 2D board: 24 tiles around a 7x7 grid.
function idxToRC(i) {
  if (i <= 6) return [1, i + 1];
  if (i <= 12) return [i - 5, 7];
  if (i <= 18) return [7, 19 - i];
  return [25 - i, 1];
}
export function tileXZ(i, k = 0, n = 1) {
  const [r, c] = idxToRC(i);
  let dx = 0;
  let dz = 0;
  if (n > 1) {
    const ang = (k / n) * Math.PI * 2 - Math.PI / 2;
    const rad = n > 4 ? 0.3 : 0.24;
    dx = Math.cos(ang) * rad;
    dz = Math.sin(ang) * rad;
  }
  return new THREE.Vector3(c - 4 + dx, TILE_H, r - 4 + dz);
}

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.userData.redraw = fn => { fn(cv.getContext('2d'), w, h); tex.needsUpdate = true; };
  tex.userData.redraw(draw);
  return tex;
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

function wrap(g, text, maxW, maxLines) {
  const words = text.split(/\s+/);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (g.measureText(next).width > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

function drawTile(g, w, h, t) {
  const k = TILE_COLOR[t.type] || C.muted;
  g.fillStyle = mix(k, C.surface, 0.16);
  g.fillRect(0, 0, w, h);
  g.fillStyle = k;
  g.fillRect(0, 0, w, 14);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = k;
  g.font = `76px ${ICON_FONT}`;
  g.fillText(t.icon, w / 2, 74);
  g.fillStyle = C.text;
  g.font = `700 27px ${TEXT_FONT}`;
  const lines = wrap(g, t.name, w - 24, 3);
  lines.forEach((ln, i) => g.fillText(ln, w / 2, 140 + i * 30 - (lines.length - 1) * 8));
  if (t.effect) {
    g.fillStyle = C.muted;
    g.font = `600 22px ${TEXT_FONT}`;
    g.fillText(wrap(g, t.effect, w - 20, 1)[0] || '', w / 2, h - 26);
  }
}

function drawFelt(g, w, h) {
  g.fillStyle = C.surface;
  g.fillRect(0, 0, w, h);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = C.accent;
  g.font = `700 92px ${TEXT_FONT}`;
  g.fillText('Aura Tax', w / 2, h * 0.8);
  g.fillStyle = C.muted;
  g.font = `500 30px ${TEXT_FONT}`;
  g.fillText('Steal aura. Make people pay to duo q with you.', w / 2, h * 0.8 + 70);
}

function drawDeckTop(g, w, h, d, count) {
  g.fillStyle = mix(d.color, C.surface, 0.18);
  roundRect(g, 0, 0, w, h, 26);
  g.fill();
  g.fillStyle = d.color;
  g.fillRect(0, 0, w, 18);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `110px ${ICON_FONT}`;
  g.fillText(d.icon, w / 2, h * 0.36);
  g.fillStyle = C.text;
  g.font = `700 44px ${TEXT_FONT}`;
  g.fillText(d.title, w / 2, h * 0.58);
  g.fillStyle = C.muted;
  g.font = `500 26px ${TEXT_FONT}`;
  g.fillText(d.sub, w / 2, h * 0.68);
  g.font = `600 28px ${TEXT_FONT}`;
  g.fillText(`${count} left`, w / 2, h * 0.86);
}

// Tabletop-RPG style die: swirled galaxy marble with an engraved gold numeral (6 underlined, like real dice).
function drawMarble(g, w, h, seed) {
  const img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w;
      const v = y / h;
      // Domain-warped sine bands give the swirl; a second, sharper band adds lighter veins.
      const wx = u + 0.18 * Math.sin(v * 9 + seed) + 0.08 * Math.sin(u * 23 + seed * 2);
      const wy = v + 0.18 * Math.cos(u * 8 - seed);
      const band = 0.5 + 0.5 * Math.sin((wx * 5 + wy * 3) * Math.PI + seed);
      const vein = Math.pow(Math.max(0, Math.sin((wx * 11 - wy * 7) * Math.PI + seed * 3)), 18);
      const i = (y * w + x) * 4;
      img.data[i] = Math.min(255, 40 + band * 120 + vein * 140);
      img.data[i + 1] = Math.min(255, 18 + band * 30 + vein * 120);
      img.data[i + 2] = Math.min(255, 90 + band * 140 + vein * 60);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // Tiny glitter flecks
  for (let i = 0; i < 70; i++) {
    const a = Math.sin(i * 12.9898 + seed * 78.233) * 43758.5453;
    const b = Math.sin(i * 39.346 + seed * 11.135) * 24634.6345;
    g.fillStyle = `rgba(255,240,255,${0.35 + (i % 5) * 0.12})`;
    g.fillRect((a - Math.floor(a)) * w, (b - Math.floor(b)) * h, 1.5, 1.5);
  }
}
const SERIF = "Georgia, 'Times New Roman', serif";
function drawNumeral(g, w, h, n, fill, outline, font = `900 ${w * 0.56}px ${SERIF}`) {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font;
  g.lineJoin = 'round';
  if (outline) {
    g.lineWidth = w * 0.045;
    g.strokeStyle = outline;
    g.strokeText(String(n), w / 2, h * 0.53);
  }
  g.fillStyle = fill;
  g.fillText(String(n), w / 2, h * 0.53);
  if (n === 6) g.fillRect(w * 0.36, h * 0.78, w * 0.28, h * 0.045);
}
const blackout = (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); };
// Small seeded random so every face of a style looks the same each time it's drawn.
const seeded = seed => { let s = seed * 9301 + 49297; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); };

// Cracks of glowing magma: jagged polylines spreading from a few points.
function drawCracks(g, w, h, n, color, width) {
  const r = seeded(n * 7 + 3);
  g.strokeStyle = color;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let c = 0; c < 6; c++) {
    let x = r() * w;
    let y = r() * h;
    let a = r() * Math.PI * 2;
    g.lineWidth = width * (0.5 + r());
    g.beginPath();
    g.moveTo(x, y);
    for (let i = 0; i < 9; i++) {
      a += (r() - 0.5) * 1.4;
      x += Math.cos(a) * w * 0.07;
      y += Math.sin(a) * h * 0.07;
      g.lineTo(x, y);
    }
    g.stroke();
  }
}

// Old-school carved pips, for the bone dice.
const PIP_POS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
function drawPips(g, w, h, n, fill, rim) {
  for (const p of PIP_POS[n]) {
    const x = (p % 3) * (w * 0.28) + w * 0.22;
    const y = Math.floor(p / 3) * (h * 0.28) + h * 0.22;
    g.beginPath();
    g.arc(x, y, w * 0.085, 0, Math.PI * 2);
    g.fillStyle = fill;
    g.fill();
    if (rim) { g.lineWidth = w * 0.02; g.strokeStyle = rim; g.stroke(); }
  }
}

// Dice styles: each has its own shape (corner rounding), face art, finish, glow colour and landing burst.
// face/glow draw one face on a canvas; glow is the emissive map (black = no glow).
const DICE_STYLES = {
  marble: {
    name: 'Galaxy Marble', round: 0.16, light: 0xb388ff, glow: 0.35, flare: 2.2,
    burst: ['rgba(255,255,240,1)', 'rgba(255,200,90,0.8)', 'rgba(180,120,255,0)'], burstSize: 0.09, gravity: 4.5,
    mat: { roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.06, iridescence: 0.55, iridescenceIOR: 1.4, sheen: 0.4, sheenColor: 0xd9b3ff },
    face(g, w, h, n) {
      drawMarble(g, w, h, n * 1.7);
      const grad = g.createLinearGradient(0, h * 0.25, 0, h * 0.8);
      grad.addColorStop(0, '#fff3b0');
      grad.addColorStop(0.5, '#f5b942');
      grad.addColorStop(1, '#b8741a');
      drawNumeral(g, w, h, n, grad, '#2a1405');
    },
    glowMap(g, w, h, n) { blackout(g, w, h); drawNumeral(g, w, h, n, '#ffc861', null); },
  },
  lava: {
    name: 'Molten Core', round: 0.06, light: 0xff5a1a, glow: 0.9, flare: 2.5,
    burst: ['rgba(255,240,180,1)', 'rgba(255,120,30,0.85)', 'rgba(120,20,0,0)'], burstSize: 0.07, gravity: -0.6, // embers drift up
    mat: { roughness: 0.75, metalness: 0.1, bumpScale: 2 },
    face(g, w, h, n) {
      g.fillStyle = '#1b100d';
      g.fillRect(0, 0, w, h);
      const r = seeded(n + 40);
      for (let i = 0; i < 260; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(60,40,36,0.6)' : 'rgba(8,5,4,0.6)';
        g.beginPath();
        g.arc(r() * w, r() * h, 2 + r() * 9, 0, Math.PI * 2);
        g.fill();
      }
      drawCracks(g, w, h, n, '#ff6a1a', w * 0.018);
      drawNumeral(g, w, h, n, '#120806', '#ff7a22', `900 ${w * 0.6}px Impact, 'Arial Black', sans-serif`);
    },
    glowMap(g, w, h, n) {
      blackout(g, w, h);
      g.shadowColor = '#ff4500';
      g.shadowBlur = w * 0.04;
      drawCracks(g, w, h, n, '#ff8a2a', w * 0.018);
      drawNumeral(g, w, h, n, '#000', '#ffb347', `900 ${w * 0.6}px Impact, 'Arial Black', sans-serif`);
    },
  },
  ice: {
    name: 'Frost Crystal', round: 0.03, light: 0x8fe3ff, glow: 0.25, flare: 1.6,
    burst: ['rgba(255,255,255,1)', 'rgba(170,230,255,0.85)', 'rgba(90,170,255,0)'], burstSize: 0.06, gravity: 7,
    mat: { roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.82, ior: 1.31, specularIntensity: 1 },
    face(g, w, h, n) {
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#f2fbff');
      grad.addColorStop(0.5, '#a9e1fb');
      grad.addColorStop(1, '#5aaee6');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      // Facets: light shards meeting at an off-centre point
      const r = seeded(n + 90);
      const cx = w * (0.35 + r() * 0.3);
      const cy = h * (0.35 + r() * 0.3);
      const edge = [[0, 0], [w * 0.5, 0], [w, 0], [w, h * 0.5], [w, h], [w * 0.5, h], [0, h], [0, h * 0.5]];
      edge.forEach(([x, y], i) => {
        const [x2, y2] = edge[(i + 1) % edge.length];
        g.fillStyle = `rgba(255,255,255,${0.06 + r() * 0.2})`;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.lineTo(x2, y2); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(x, y); g.stroke();
      });
      for (let i = 0; i < 120; i++) { g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(r() * w, r() * h, 1.2, 1.2); }
      drawNumeral(g, w, h, n, '#ffffff', '#1f6fb2', `800 ${w * 0.55}px 'Segoe UI', Inter, sans-serif`);
    },
    glowMap(g, w, h, n) { blackout(g, w, h); drawNumeral(g, w, h, n, '#9feaff', null, `800 ${w * 0.55}px 'Segoe UI', Inter, sans-serif`); },
  },
  bone: {
    name: 'Ancient Bone', round: 0.24, light: 0xffd9a0, glow: 0, flare: 0,
    burst: ['rgba(240,225,200,0.9)', 'rgba(190,170,140,0.6)', 'rgba(120,100,80,0)'], burstSize: 0.14, gravity: 0.8, // a puff of dust
    mat: { roughness: 0.85, metalness: 0, sheen: 0.3, sheenColor: 0xfff1d6 },
    face(g, w, h, n) {
      const grad = g.createRadialGradient(w / 2, h / 2, w * 0.1, w / 2, h / 2, w * 0.75);
      grad.addColorStop(0, '#efe4c8');
      grad.addColorStop(1, '#bba57c');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      const r = seeded(n + 7);
      g.strokeStyle = 'rgba(120,95,60,0.25)';
      for (let i = 0; i < 40; i++) {
        g.lineWidth = 0.6 + r();
        const y = r() * h;
        g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(w * 0.3, y + (r() - 0.5) * 12, w * 0.7, y + (r() - 0.5) * 12, w, y); g.stroke();
      }
      drawCracks(g, w, h, n + 20, 'rgba(70,50,30,0.45)', w * 0.006);
      drawPips(g, w, h, n, '#3a2614', 'rgba(255,245,220,0.5)');
    },
    glowMap(g, w, h) { blackout(g, w, h); },
  },
  neon: {
    name: 'Neon Grid', round: 0.015, light: 0xff3df0, glow: 1.1, flare: 2, edges: 0x3df5ff,
    burst: ['rgba(255,255,255,1)', 'rgba(61,245,255,0.9)', 'rgba(255,61,240,0)'], burstSize: 0.07, gravity: 0, // a flat ring
    mat: { roughness: 0.3, metalness: 0.6, clearcoat: 0.8 },
    face(g, w, h, n) {
      g.fillStyle = '#07060d';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(140,90,255,0.35)';
      g.lineWidth = 1;
      for (let i = 1; i < 8; i++) {
        g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, h); g.stroke();
        g.beginPath(); g.moveTo(0, (i * h) / 8); g.lineTo(w, (i * h) / 8); g.stroke();
      }
      g.strokeStyle = '#3df5ff';
      g.lineWidth = w * 0.03;
      g.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
      drawNumeral(g, w, h, n, '#ff3df0', null, `700 ${w * 0.58}px 'JetBrains Mono', Consolas, monospace`);
    },
    glowMap(g, w, h, n) {
      blackout(g, w, h);
      g.shadowBlur = w * 0.05;
      g.shadowColor = '#3df5ff';
      g.strokeStyle = '#3df5ff';
      g.lineWidth = w * 0.03;
      g.strokeRect(w * 0.08, h * 0.08, w * 0.84, h * 0.84);
      g.shadowColor = '#ff3df0';
      drawNumeral(g, w, h, n, '#ff3df0', null, `700 ${w * 0.58}px 'JetBrains Mono', Consolas, monospace`);
    },
  },
};
export const DICE_STYLE_IDS = Object.keys(DICE_STYLES);
export const diceStyleName = id => (DICE_STYLES[id] || DICE_STYLES.marble).name;

// A flat picture of one face (a 5) for the lobby picker. Drawn once per style.
const previews = new Map();
export function dicePreview(id, size = 96) {
  if (!previews.has(id)) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    (DICE_STYLES[id] || DICE_STYLES.marble).face(cv.getContext('2d'), size, size, 5);
    previews.set(id, cv.toDataURL());
  }
  return previews.get(id);
}

// A box with rounded edges and corners: every vertex is pulled onto a rounded shell. Keeps the box's six
// material groups and per-face UVs, so each face still gets its own texture.
function roundedBox(size, radius, seg = 8) {
  const geo = new THREE.BoxGeometry(size, size, size, seg, seg, seg);
  const pos = geo.attributes.position;
  const inner = size / 2 - radius;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    c.set(THREE.MathUtils.clamp(v.x, -inner, inner), THREE.MathUtils.clamp(v.y, -inner, inner), THREE.MathUtils.clamp(v.z, -inner, inner));
    v.sub(c);
    if (v.lengthSq() > 0) v.setLength(radius);
    v.add(c);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function drawBadge(g, w, h, color, letter, lead) {
  g.clearRect(0, 0, w, h);
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - 6, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = 8;
  g.strokeStyle = lead ? C.accent : C.bg;
  g.stroke();
  g.fillStyle = C.bg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `700 ${w * 0.5}px ${TEXT_FONT}`;
  g.fillText(letter.toUpperCase(), w / 2, h / 2 + 3);
}

const RING_GEO = new THREE.TorusGeometry(0.22, 0.022, 10, 48);

// Face values for BoxGeometry's material order (+x, -x, +y, -y, +z, -z), opposite faces sum to 7.
const DIE_FACES = [3, 4, 1, 6, 2, 5];
const DIE_UP = {
  1: new THREE.Euler(0, 0, 0), 6: new THREE.Euler(Math.PI, 0, 0),
  2: new THREE.Euler(-Math.PI / 2, 0, 0), 5: new THREE.Euler(Math.PI / 2, 0, 0),
  3: new THREE.Euler(0, 0, Math.PI / 2), 4: new THREE.Euler(0, 0, -Math.PI / 2),
};
const DIE_SIZE = 0.5;

// Aura motes: gold dust drifting up off the table. Animates itself, so any scene can just add it.
export function createMotes(n = 220) {
  const pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 14;
    pos[i * 3 + 1] = Math.random() * 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 14;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const motes = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xf5b942, size: 0.05, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  motes.frustumCulled = false;
  let last = performance.now();
  motes.onBeforeRender = () => {
    const t = performance.now();
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    const a = geo.attributes.position;
    for (let i = 0; i < a.count; i++) {
      let y = a.getY(i) + dt * (0.12 + (i % 7) * 0.03);
      if (y > 5) y = 0;
      a.setY(i, y);
      a.setX(i, a.getX(i) + Math.sin(t / 1400 + i) * dt * 0.05);
    }
    a.needsUpdate = true;
  };
  return motes;
}

export function createBoard(stage, opts = {}) {
  // Phones and tablets get a lighter shadow setup: same look from a normal distance, much cheaper to draw.
  const light = matchMedia('(pointer: coarse)').matches || Math.min(screen.width, screen.height) < 700;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, opts.maxDpr || 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = light ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  stage.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);
  scene.fog = new THREE.Fog(C.bg, 22, 46);

  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3448, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-4, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(light ? 1024 : 2048, light ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  sun.shadow.bias = -0.0005;
  sun.shadow.radius = 4;
  scene.add(sun);

  // Table and board slab
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.36;
  floor.receiveShadow = true;
  scene.add(floor);

  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(7.5, 0.36, 7.5),
    new THREE.MeshStandardMaterial({ color: mix(C.surface2, C.bg, 0.6), roughness: 0.7 }),
  );
  slab.position.y = -0.18;
  slab.receiveShadow = true;
  slab.castShadow = true;
  scene.add(slab);

  const feltTex = canvasTex(1024, 1024, drawFelt);
  const felt = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 4.9), new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = 0.002;
  felt.receiveShadow = true;
  scene.add(felt);

  // ---------------------------------------------------------------------------
  // Tiles
  // ---------------------------------------------------------------------------
  const tiles = [];
  const tileGeo = new THREE.BoxGeometry(0.95, TILE_H, 0.95);
  const taxGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 20);
  let lit = null;

  function build(board) {
    board.forEach((t, i) => {
      const k = TILE_COLOR[t.type] || C.muted;
      const side = new THREE.MeshStandardMaterial({ color: mix(k, C.surface, 0.3), roughness: 0.6 });
      const tex = canvasTex(256, 256, (g, w, h) => drawTile(g, w, h, t));
      const top = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, emissive: new THREE.Color(C.accent), emissiveIntensity: 0 });
      const mesh = new THREE.Mesh(tileGeo, [side, side, top, side, side, side]);
      const p = tileXZ(i);
      mesh.position.set(p.x, TILE_H / 2, p.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = { tile: i, info: t, tex, top, baseY: TILE_H / 2, lift: 0 };
      const dots = new THREE.Group();
      dots.position.set(0.32, TILE_H / 2 + 0.015, -0.32);
      mesh.add(dots);
      mesh.userData.dots = dots;
      scene.add(mesh);
      tiles.push(mesh);
    });
    // Icons and text need the web fonts: redraw once they're in.
    Promise.all([
      document.fonts.load(`76px ${ICON_FONT}`, 'casino'),
      document.fonts.load(`700 27px Inter`),
    ]).then(() => {
      tiles.forEach(m => m.userData.tex.userData.redraw((g, w, h) => drawTile(g, w, h, m.userData.info)));
      feltTex.userData.redraw(drawFelt);
      for (const k of Object.keys(decks)) redrawDeck(k);
      for (const p of pawns.values()) if (p.color) p.redrawBadge();
    });
  }

  function setLit(i) {
    if (lit === i) return;
    if (lit != null && tiles[lit]) tiles[lit].userData.lift = 0;
    lit = i;
    if (lit != null && tiles[lit]) tiles[lit].userData.lift = 1;
  }

  // Tiles you can pick right now (a card that targets a tile): they pulse red and take clicks.
  const tileTargets = new Set();
  const EMIT_LIT = new THREE.Color(C.accent);
  const EMIT_BAD = new THREE.Color(C.bad);
  function setTileTargets(list) {
    tileTargets.clear();
    for (const i of list || []) tileTargets.add(i);
  }

  function setTax(map) {
    tiles.forEach((m, i) => {
      const colors = map[i] || [];
      const dots = m.userData.dots;
      if (dots.userData.key === colors.join()) return;
      dots.userData.key = colors.join();
      dots.clear();
      colors.forEach((c, j) => {
        const d = new THREE.Mesh(taxGeo, new THREE.MeshStandardMaterial({ color: c, roughness: 0.4 }));
        d.position.x = -j * 0.13;
        d.castShadow = true;
        dots.add(d);
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Decks
  // ---------------------------------------------------------------------------
  const decks = {};
  const cardGeo = new THREE.BoxGeometry(0.95, 0.014, 1.3);
  const glowGeo = new THREE.PlaneGeometry(1.12, 1.47);
  for (const [k, d] of Object.entries(DECK)) {
    const group = new THREE.Group();
    group.position.set(d.x, 0, -0.55);
    const edge = new THREE.MeshStandardMaterial({ color: mix(d.color, C.surface, 0.35), roughness: 0.6 });
    const tex = canvasTex(380, 520, () => {});
    const topMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, emissive: new THREE.Color(d.color), emissiveIntensity: 0 });
    const cards = [];
    for (let j = 0; j < 14; j++) {
      const card = new THREE.Mesh(cardGeo, [edge, edge, topMat, edge, edge, edge]);
      card.position.set((Math.random() - 0.5) * 0.03, 0.008 + j * 0.015, (Math.random() - 0.5) * 0.03);
      card.rotation.y = (Math.random() - 0.5) * 0.05;
      card.castShadow = true;
      card.receiveShadow = true;
      card.userData.deck = k;
      group.add(card);
      cards.push(card);
    }
    const glow = new THREE.Mesh(glowGeo, new THREE.MeshBasicMaterial({ color: C.accent, transparent: true, opacity: 0 }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.004;
    group.add(glow);
    scene.add(group);
    decks[k] = { group, cards, tex, topMat, glow, count: 0, ready: false, def: d };
    redrawDeck(k);
  }

  function redrawDeck(k) {
    const dk = decks[k];
    dk.tex.userData.redraw((g, w, h) => drawDeckTop(g, w, h, dk.def, dk.count));
  }

  function setDeck(k, ready, count) {
    const dk = decks[k];
    dk.ready = ready;
    if (dk.count !== count) {
      dk.count = count;
      redrawDeck(k);
      const shown = count > 0 ? Math.max(1, Math.min(14, Math.ceil(count / 2))) : 0;
      dk.cards.forEach((c, j) => { c.visible = j < shown; });
    }
  }

  // ---------------------------------------------------------------------------
  // Die
  // ---------------------------------------------------------------------------
  // One die on the table that takes on the roller's style (DICE_STYLES). Each style's geometry, materials and
  // burst sprite are built the first time it's used, then reused.
  const dieKits = new Map();
  function dieKit(id) {
    if (!dieKits.has(id)) {
      const st = DICE_STYLES[id];
      const mats = DIE_FACES.map(n => {
        const m = new THREE.MeshPhysicalMaterial({
          ...st.mat,
          map: canvasTex(256, 256, (g, w, h) => st.face(g, w, h, n)),
          emissiveMap: canvasTex(256, 256, (g, w, h) => st.glowMap(g, w, h, n)),
          emissive: 0xffffff, emissiveIntensity: st.glow,
        });
        if (st.mat.sheenColor != null) m.sheenColor.setHex(st.mat.sheenColor);
        return m;
      });
      if (id === 'lava') mats.forEach(m => { m.bumpMap = m.map; });
      const kit = { st, mats, geo: roundedBox(DIE_SIZE, DIE_SIZE * st.round, st.round < 0.05 ? 4 : 8), edges: null };
      // Neon: glowing tubes along all twelve edges
      if (st.edges) {
        kit.edges = new THREE.Group();
        const e = DIE_SIZE / 2 - DIE_SIZE * st.round * 0.3;
        const tube = new THREE.MeshBasicMaterial({ color: st.edges, toneMapped: false });
        const cyl = new THREE.CylinderGeometry(0.009, 0.009, DIE_SIZE * 1.0, 6);
        for (const [ax, rot] of [['y', [0, 0, 0]], ['x', [0, 0, Math.PI / 2]], ['z', [Math.PI / 2, 0, 0]]]) {
          for (const a of [-e, e]) {
            for (const b of [-e, e]) {
              const m = new THREE.Mesh(cyl, tube);
              m.rotation.set(...rot);
              if (ax === 'y') m.position.set(a, 0, b);
              else if (ax === 'x') m.position.set(0, a, b);
              else m.position.set(a, b, 0);
              kit.edges.add(m);
            }
          }
        }
      }
      kit.burstTex = canvasTex(64, 64, (g, w, h) => {
        const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gr.addColorStop(0, st.burst[0]);
        gr.addColorStop(0.35, st.burst[1]);
        gr.addColorStop(1, st.burst[2]);
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      });
      dieKits.set(id, kit);
    }
    return dieKits.get(id);
  }
  let dieStyle = null;
  let kit = null;
  const die = new THREE.Mesh();
  die.castShadow = true;
  die.position.set(0, DIE_SIZE / 2, -0.55);
  scene.add(die);
  // Soft glow in the style's colour that follows the die, brighter while it's in the air
  const dieLight = new THREE.PointLight(0xffffff, 0.5, 2.2, 1.6);
  scene.add(dieLight);
  // Burst for the landing pop (sparks, embers, shards, dust or a neon ring, by style)
  const BURST_N = 42;
  const burstPos = new Float32Array(BURST_N * 3);
  const burstVel = Array.from({ length: BURST_N }, () => new THREE.Vector3());
  const burstGeo = new THREE.BufferGeometry();
  burstGeo.setAttribute('position', new THREE.BufferAttribute(burstPos, 3));
  const burstMat = new THREE.PointsMaterial({ size: 0.09, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const burst = new THREE.Points(burstGeo, burstMat);
  burst.frustumCulled = false;
  scene.add(burst);

  function setDieStyle(id) {
    id = DICE_STYLES[id] ? id : 'marble';
    if (id === dieStyle) return;
    if (kit && kit.edges) die.remove(kit.edges);
    dieStyle = id;
    kit = dieKit(id);
    die.geometry = kit.geo;
    die.material = kit.mats;
    if (kit.edges) die.add(kit.edges);
    dieLight.color.setHex(kit.st.light);
    burstMat.map = kit.burstTex;
    burstMat.size = kit.st.burstSize;
    burstMat.needsUpdate = true;
  }
  setDieStyle('marble');

  function popDie(t) {
    dieAnim.pop = t;
    const flat = kit.st.gravity === 0;
    for (let i = 0; i < BURST_N; i++) {
      const a = (i / BURST_N) * Math.PI * 2 + Math.random() * 0.3;
      const sp = flat ? 2.2 : 1.2 + Math.random();
      burstVel[i].set(Math.cos(a) * sp, flat ? 0 : 0.8 + Math.random() * 1.8, Math.sin(a) * sp);
      burstPos.set([die.position.x, flat ? TILE_H + 0.03 : die.position.y, die.position.z], i * 3);
    }
    burstGeo.attributes.position.needsUpdate = true;
  }
  const dieAnim = { rolling: false, t0: 0, settle: null, spin: new THREE.Vector3(), pop: 0 };

  function dieTarget(n) {
    const q = new THREE.Quaternion().setFromEuler(DIE_UP[n]);
    return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2).multiply(q);
  }

  function roll(value, ms = 950, style) {
    if (style) setDieStyle(style);
    dieAnim.rolling = true;
    dieAnim.t0 = performance.now();
    dieAnim.spin.set(8 + Math.random() * 6, 5 + Math.random() * 6, 7 + Math.random() * 6);
    dieAnim.settle = null;
    dieAnim.pop = 0;
    return new Promise(res => setTimeout(() => {
      dieAnim.rolling = false;
      dieAnim.settle = { from: die.quaternion.clone(), to: dieTarget(value), y: die.position.y, t0: performance.now() };
      res();
    }, ms));
  }

  // ---------------------------------------------------------------------------
  // Pawns
  // ---------------------------------------------------------------------------
  const pawns = new Map();

  function makePawn(id) {
    const group = new THREE.Group();
    const figure = new THREE.Group();
    group.add(figure);
    const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: C.accent }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    ring.visible = false;
    group.add(ring);
    // Shown while you're picking a target: a red ring you can click (or tap) to pick this rider.
    const tring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({ color: C.bad, transparent: true, opacity: 0.9, depthWrite: false }));
    tring.rotation.x = -Math.PI / 2;
    tring.position.y = 0.018;
    tring.visible = false;
    group.add(tring);
    const badgeTex = canvasTex(128, 128, () => {});
    const badge = new THREE.Sprite(new THREE.SpriteMaterial({ map: badgeTex, depthWrite: false }));
    badge.scale.setScalar(0.24);
    group.add(badge);
    scene.add(group);
    const p = {
      id, group, figure, ring, tring, badge, badgeTex, model: null, height: 0.55,
      color: null, champion: null, letter: '?', lead: false, faded: null,
      target: null, hop: null, tbagUntil: 0, shakeUntil: 0, poofAt: 0, scale: 1,
      redrawBadge() { badgeTex.userData.redraw((g, w, h) => drawBadge(g, w, h, p.color, p.letter, p.lead)); },
    };
    pawns.set(id, p);
    return p;
  }

  function setFaded(p, faded) {
    p.faded = faded;
    p.model.traverse(o => {
      if (!o.material) return;
      if (o.material.userData.opacity == null) o.material.userData.opacity = o.material.opacity;
      o.material.transparent = true;
      o.material.opacity = o.material.userData.opacity * (faded ? 0.4 : 1);
    });
    p.badge.material.opacity = faded ? 0.5 : 1;
  }

  // list: [{ id, color, champion, letter, current, faded, lead }]
  function setPlayers(list) {
    const ids = new Set(list.map(x => x.id));
    for (const [id, p] of pawns) {
      if (!ids.has(id)) { scene.remove(p.group); pawns.delete(id); }
    }
    for (const x of list) {
      const p = pawns.get(x.id) || makePawn(x.id);
      if (p.color !== x.color || p.champion !== x.champion) {
        if (p.model) p.figure.remove(p.model);
        const model = buildChampion(x.champion, x.color);
        p.model = model;
        p.height = model.userData.height;
        p.figure.add(model);
        p.faded = null;
        model.userData.ready.then(() => { if (p.model === model && p.faded) setFaded(p, true); });
      }
      if (p.color !== x.color || p.letter !== x.letter || p.lead !== x.lead) {
        p.color = x.color;
        p.letter = x.letter;
        p.lead = x.lead;
        p.redrawBadge();
      }
      p.champion = x.champion;
      if (p.faded !== !!x.faded) setFaded(p, !!x.faded);
      p.ring.visible = !!x.current;
    }
  }

  // Slide a pawn to its spot on a tile (k of n pawns sharing it).
  function place(id, pos, k = 0, n = 1) {
    const p = pawns.get(id);
    if (!p) return;
    const v = tileXZ(pos, k, n);
    p.scale = n > 4 ? 0.75 : n > 2 ? 0.88 : 1;
    if (!p.target) p.group.position.copy(v);
    p.target = v;
  }

  function hop(id, pos) {
    const p = pawns.get(id);
    if (!p) return;
    const to = tileXZ(pos);
    p.hop = { from: p.group.position.clone(), to, t0: performance.now() };
    p.target = to;
    p.scale = 1;
  }

  const now = () => performance.now();
  const poof = id => { const p = pawns.get(id); if (p) p.poofAt = now(); };
  const tbag = id => { const p = pawns.get(id); if (p) p.tbagUntil = now() + TBAG_MS; };
  const shake = id => { const p = pawns.get(id); if (p) p.shakeUntil = now() + 1100; };

  // Riders you can pick right now (a card or prompt that targets a rider), and the one you're pointing at.
  const targets = new Set();
  let hot = null;
  function setTargets(list) {
    targets.clear();
    for (const id of list || []) targets.add(id);
    if (!targets.has(hot)) hot = null;
  }
  function setHot(id) { hot = id && targets.has(id) ? id : null; }

  // ---------------------------------------------------------------------------
  // Camera: orbit around the board; drag to turn, wheel to zoom, double-click to reset.
  // ---------------------------------------------------------------------------
  const cam = {
    yaw: 0, pitch: 0.95, base: 0.95, zoom: 1, fit: 14, pan: new THREE.Vector3(),
    target: new THREE.Vector3(), cur: { yaw: 0, pitch: 0.95, dist: 14, target: new THREE.Vector3() },
    follow: null,
  };
  let insets = { top: 0, right: 0, bottom: 0, left: 0 };
  let W = 1;
  let H = 1;

  function applyCamera(yaw, pitch, dist, target) {
    camera.position.set(
      target.x + dist * Math.sin(yaw) * Math.cos(pitch),
      target.y + dist * Math.sin(pitch),
      target.z + dist * Math.cos(yaw) * Math.cos(pitch),
    );
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }

  // Find the distance at which the whole board fits in the part of the screen the HUD leaves free.
  function fitDistance() {
    // The slab's corners, plus head height over the outer tiles (where riders stand). A full-height box would waste
    // a lot of room: its near top corners sit right in front of the camera and project much wider than the board.
    const corners = [];
    for (const x of [-1, 1]) {
      for (const z of [-1, 1]) {
        corners.push(new THREE.Vector3(x * 3.75, 0, z * 3.75), new THREE.Vector3(x * 3.75, -0.36, z * 3.75), new THREE.Vector3(x * 3.1, 0.85, z * 3.1));
      }
    }
    const pad = 14;
    const L = insets.left + pad;
    const R = W - insets.right - pad;
    const T = insets.top + pad;
    const B = H - insets.bottom - pad;
    const fits = d => {
      applyCamera(0, cam.pitch, d, new THREE.Vector3());
      return corners.every(c => {
        const v = c.clone().project(camera);
        const px = (v.x + 1) / 2 * W;
        const py = (1 - v.y) / 2 * H;
        return px >= L && px <= R && py >= T && py <= B;
      });
    };
    let lo = 4;
    let hi = 60;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (fits(mid)) hi = mid; else lo = mid;
    }
    return hi;
  }

  // Where the projection centre sits (in px off the canvas centre) so the board lands in the space the HUD leaves free.
  // It eases toward its target, so when the HUD grows or shrinks the board glides instead of jumping.
  const view = { x: 0, y: 0, tx: 0, ty: 0, ready: false };
  function setOffset(x, y) {
    camera.setViewOffset(W, H, x, y, W, H);
    camera.updateProjectionMatrix();
  }

  function resize() {
    W = Math.max(1, stage.clientWidth);
    H = Math.max(1, stage.clientHeight);
    insets = opts.insets ? opts.insets() : insets;
    // Tall screens (phones held upright) look down more steeply: the board fills more of the height and the tiles
    // are less squashed. Only changes the angle if you haven't turned the camera yourself.
    const base = !opts.director && (W - insets.left - insets.right) / Math.max(1, H - insets.top - insets.bottom) < 0.8 ? 1.2 : 0.95;
    if (base !== cam.base) {
      if (cam.pitch === cam.base) cam.pitch = base;
      cam.base = base;
    }
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const cx = (insets.left + (W - insets.right)) / 2;
    const cy = (insets.top + (H - insets.bottom)) / 2;
    view.tx = W / 2 - cx;
    view.ty = H / 2 - cy;
    // Fit with the projection the camera is heading to, then put back the one it's showing now.
    setOffset(view.tx, view.ty);
    cam.fit = fitDistance();
    if (!view.ready) { view.x = view.tx; view.y = view.ty; view.ready = true; }
    setOffset(view.x, view.y);
  }
  new ResizeObserver(resize).observe(stage);
  for (const el of opts.watch || []) new ResizeObserver(resize).observe(el);
  window.addEventListener('resize', resize);

  function follow(id) {
    cam.follow = id;
    if (id) cam.pan.set(0, 0, 0);
  }
  function resetView() { cam.yaw = 0; cam.pitch = cam.base; cam.zoom = 1; cam.pan.set(0, 0, 0); }

  const el = renderer.domElement;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let drag = null;
  let pinch = null;
  let lastTap = null;
  const pointers = new Map(); // every finger (or the mouse) currently down on the board

  function aim(e) {
    const r = el.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function pick(e, objects) {
    aim(e);
    return ray.intersectObjects(objects, false)[0];
  }
  // The rider under the pointer, if any (only riders you can target count when a target is being picked).
  function pickPawn(e, onlyTargets) {
    aim(e);
    let best = null;
    for (const p of pawns.values()) {
      if (onlyTargets && !targets.has(p.id)) continue;
      const hit = ray.intersectObject(p.figure, true)[0] || ray.intersectObject(p.tring, false)[0];
      if (hit && (!best || hit.distance < best.d)) best = { id: p.id, d: hit.distance };
    }
    return best ? best.id : null;
  }
  const deckCards = () => Object.values(decks).flatMap(d => d.cards.filter(c => c.visible));

  // Slide along the table so the board follows the pointer.
  function panFrom(from, dx, dy) {
    const k = (2 * cam.cur.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / H;
    const right = new THREE.Vector3(Math.cos(cam.cur.yaw), 0, -Math.sin(cam.cur.yaw));
    const away = new THREE.Vector3(-Math.sin(cam.cur.yaw), 0, -Math.cos(cam.cur.yaw));
    cam.pan.copy(from).addScaledVector(right, -dx * k).addScaledVector(away, (dy * k) / Math.sin(cam.cur.pitch));
    cam.pan.clampLength(0, 5);
  }
  const startDrag = (id, x, y, o = {}) => {
    drag = { id, x, y, yaw: cam.yaw, pitch: cam.pitch, moved: false, pan: false, from: cam.pan.clone(), button: 0, type: 'touch', ...o };
  };

  el.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
    try { el.setPointerCapture(e.pointerId); } catch { /* already gone */ }
    if (pointers.size === 2) {
      // Two fingers: pinch to zoom, move together to slide the board. Cancels the one-finger turn.
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)), zoom: cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, from: cam.pan.clone() };
      drag = null;
      opts.onHover && opts.onHover(null);
      return;
    }
    if (pointers.size > 2) return;
    const pan = e.button === 1 || e.button === 2;
    if (pan) e.preventDefault();
    startDrag(e.pointerId, e.clientX, e.clientY, { pan, button: e.button, type: e.pointerType });
  });
  // Stop the browser's middle-click autoscroll and the right-click menu on the board.
  el.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
  el.addEventListener('contextmenu', e => e.preventDefault());
  el.addEventListener('pointermove', e => {
    const pt = pointers.get(e.pointerId);
    if (pt) { pt.x = e.clientX; pt.y = e.clientY; }
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.max(20, Math.hypot(a.x - b.x, a.y - b.y));
      cam.zoom = THREE.MathUtils.clamp((pinch.zoom * pinch.d) / d, 0.45, 1.6);
      panFrom(pinch.from, (a.x + b.x) / 2 - pinch.mx, (a.y + b.y) / 2 - pinch.my);
      return;
    }
    if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > (drag.type === 'mouse' ? 5 : 9)) drag.moved = true;
      if (drag.moved && drag.pan) {
        panFrom(drag.from, dx, dy);
        el.style.cursor = 'move';
        opts.onHover && opts.onHover(null);
        return;
      }
      if (drag.moved) {
        cam.yaw = drag.yaw - dx * 0.006;
        cam.pitch = THREE.MathUtils.clamp(drag.pitch + dy * 0.004, 0.45, 1.45);
        el.style.cursor = 'grabbing';
        opts.onHover && opts.onHover(null);
        return;
      }
    }
    if (e.pointerType !== 'mouse') return; // hover tips are for a mouse; fingers tap instead
    const deckHit = pick(e, deckCards());
    const ready = deckHit && decks[deckHit.object.userData.deck].ready;
    const pawn = !ready && targets.size ? pickPawn(e, true) : null;
    const tileHit = ready || pawn ? null : pick(e, tiles);
    const tileTarget = tileHit && tileTargets.has(tileHit.object.userData.tile);
    el.style.cursor = ready || pawn || tileTarget ? 'pointer' : 'grab';
    if (pawn !== hot) { hot = pawn; opts.onPawnHover && opts.onPawnHover(pawn); }
    opts.onHover && opts.onHover(tileHit ? { tile: tileHit.object.userData.info, x: e.clientX, y: e.clientY } : null);
  });
  function release(e) {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) {
        pinch = null;
        // One finger is still down: keep turning from it, without a jump.
        const rest = [...pointers.entries()][0];
        if (rest) startDrag(rest[0], rest[1].x, rest[1].y, { moved: true, type: rest[1].type });
      }
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const { moved, button, type } = drag;
    drag = null;
    el.style.cursor = 'grab';
    if (moved || button !== 0 || e.type === 'pointercancel') return;
    tap(e, type);
  }
  // A click or tap that didn't turn the board: a deck, then a rider you're targeting, then a tile.
  function tap(e, type) {
    const deckHit = pick(e, deckCards());
    if (deckHit && decks[deckHit.object.userData.deck].ready && opts.onDeck) { opts.onDeck(deckHit.object.userData.deck); return; }
    if (targets.size) {
      const pawn = pickPawn(e, true);
      if (pawn && opts.onPawn) { opts.onPawn(pawn); return; }
    }
    const touch = type !== 'mouse';
    if (touch) {
      // Double tap puts the camera back where it started
      const t = now();
      if (lastTap && t - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 36) {
        lastTap = null;
        resetView();
        opts.onTileTap && opts.onTileTap(null);
        return;
      }
      lastTap = { t, x: e.clientX, y: e.clientY };
    }
    const hit = pick(e, tiles);
    if (opts.onTileTap) opts.onTileTap(hit ? { tile: hit.object.userData.info, index: hit.object.userData.tile, x: e.clientX, y: e.clientY, touch } : null);
  }
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', release);
  el.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    opts.onHover && opts.onHover(null);
    if (hot) { hot = null; opts.onPawnHover && opts.onPawnHover(null); }
  });
  el.addEventListener('wheel', e => {
    e.preventDefault();
    cam.zoom = THREE.MathUtils.clamp(cam.zoom * Math.exp(e.deltaY * 0.001), 0.45, 1.6);
  }, { passive: false });
  el.addEventListener('dblclick', resetView);

  // Page coordinates of a pawn's head, for floating text.
  function screenPos(id, pos) {
    const p = pawns.get(id);
    const v = p ? p.group.position.clone() : tileXZ(pos || 0);
    v.y += p ? p.height + 0.3 : 0.6;
    v.project(camera);
    const r = el.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  // ---------------------------------------------------------------------------
  // Frame loop
  // ---------------------------------------------------------------------------
  let last = now();
  function frame() {
    const t = now();
    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;
    const ease = k => 1 - Math.exp(-dt * k);

    if (Math.abs(view.tx - view.x) > 0.25 || Math.abs(view.ty - view.y) > 0.25) {
      const k = ease(7);
      view.x += (view.tx - view.x) * k;
      view.y += (view.ty - view.y) * k;
      setOffset(view.x, view.y);
    }

    // Camera eases toward where it wants to be; while a pawn moves it leans in on it.
    // A director (the home screen's bot match) can take the camera over instead.
    if (opts.director) {
      opts.director(camera, t, dt);
      camera.updateMatrixWorld();
    } else {
      const fp = cam.follow && pawns.get(cam.follow);
      // Tall screens lean in less: the board is already as wide as the screen, so a big zoom would crop it away.
      const tall = cam.base > 1;
      const wantTarget = fp ? fp.group.position.clone().multiplyScalar(tall ? 0.25 : 0.55).setY(0) : cam.pan.clone();
      const wantDist = cam.fit * cam.zoom * (fp ? (tall ? 0.9 : 0.72) : 1);
      const c = cam.cur;
      c.yaw += (cam.yaw - c.yaw) * ease(10);
      c.pitch += (cam.pitch - c.pitch) * ease(10);
      c.dist += (wantDist - c.dist) * ease(fp ? 3 : 2.5);
      c.target.lerp(wantTarget, ease(fp ? 3 : 2.2));
      applyCamera(c.yaw, c.pitch, c.dist, c.target);
    }

    // Tiles: the current rider's tile rises and glows; tiles you can pick pulse red.
    const pulse = 0.5 + 0.5 * Math.sin(t / 220);
    for (const m of tiles) {
      const u = m.userData;
      const tgt = tileTargets.has(u.tile);
      const want = u.lift ? 0.06 + Math.sin(t / 300) * 0.015 : tgt ? 0.03 + pulse * 0.03 : 0;
      m.position.y += (u.baseY + want - m.position.y) * ease(10);
      u.top.emissive.copy(tgt ? EMIT_BAD : EMIT_LIT);
      u.top.emissiveIntensity += ((tgt ? 0.12 + pulse * 0.25 : u.lift ? 0.22 : 0) - u.top.emissiveIntensity) * ease(8);
    }

    // Decks bob and glow when you can draw from them.
    for (const dk of Object.values(decks)) {
      const want = dk.ready ? 0.12 + Math.sin(t / 260) * 0.04 : 0;
      dk.group.position.y += (want - dk.group.position.y) * ease(10);
      dk.glow.material.opacity += ((dk.ready ? 0.5 + Math.sin(t / 260) * 0.2 : 0) - dk.glow.material.opacity) * ease(10);
      dk.topMat.emissiveIntensity += ((dk.ready ? 0.12 : 0) - dk.topMat.emissiveIntensity) * ease(10);
    }

    // Die: tumble in the air while rolling, then settle on the result.
    if (dieAnim.rolling) {
      const k = (t - dieAnim.t0) / 1000;
      die.position.y = DIE_SIZE / 2 + Math.abs(Math.sin(k * 7)) * 0.9 * Math.max(0.3, 1 - k);
      die.rotateX(dieAnim.spin.x * dt);
      die.rotateY(dieAnim.spin.y * dt);
      die.rotateZ(dieAnim.spin.z * dt);
    } else if (dieAnim.settle) {
      const s = dieAnim.settle;
      const k = Math.min(1, (t - s.t0) / 260);
      const e = 1 - (1 - k) ** 3;
      die.quaternion.slerpQuaternions(s.from, s.to, e);
      die.position.y = s.y + (DIE_SIZE / 2 - s.y) * e;
      if (k >= 1) { dieAnim.settle = null; popDie(t); }
    }
    // Landing pop: the die swells and springs back, the numerals flare, sparks fly out and fall
    let dieScale = 1;
    const base = kit.st.glow;
    let glow = dieAnim.rolling && base ? base + 0.25 : base;
    if (dieAnim.pop) {
      const k = (t - dieAnim.pop) / 1000;
      if (k < 0.9) {
        dieScale = 1 + Math.sin(Math.min(1, k / 0.35) * Math.PI) * 0.3;
        glow += Math.max(0, 1 - k / 0.6) * kit.st.flare;
        burstMat.opacity = Math.max(0, 1 - k / 0.9);
        for (let i = 0; i < BURST_N; i++) {
          burstVel[i].y -= kit.st.gravity * dt;
          burstPos[i * 3] += burstVel[i].x * dt;
          burstPos[i * 3 + 1] = Math.max(TILE_H, burstPos[i * 3 + 1] + burstVel[i].y * dt);
          burstPos[i * 3 + 2] += burstVel[i].z * dt;
        }
        burstGeo.attributes.position.needsUpdate = true;
      } else {
        dieAnim.pop = 0;
        burstMat.opacity = 0;
      }
    }
    die.scale.setScalar(dieScale);
    for (const m of kit.mats) m.emissiveIntensity = glow;
    dieLight.position.set(die.position.x, die.position.y + 0.25, die.position.z);
    dieLight.intensity = 0.5 + (dieAnim.rolling ? 0.8 : 0) + (glow - base) * 0.8 + (dieAnim.pop && !kit.st.flare ? 0.8 : 0);

    // Pawns
    for (const p of pawns.values()) {
      const g = p.group;
      if (p.hop) {
        const k = Math.min(1, (t - p.hop.t0) / HOP_MS);
        g.position.lerpVectors(p.hop.from, p.hop.to, k);
        g.position.y = TILE_H + Math.sin(Math.PI * k) * 0.45;
        if (k >= 1) p.hop = null;
      } else if (p.target) {
        g.position.lerp(p.target, ease(12));
      }
      let sx = p.scale;
      let sy = p.scale;
      let lift = 0;
      // T-bag: crouch down and spring back up, over and over.
      if (t < p.tbagUntil) {
        const ph = ((t - (p.tbagUntil - TBAG_MS)) / 300) % 1;
        lift = 0.08 * (1 + Math.cos(ph * Math.PI * 2)); // up, down onto them, back up
        const low = (1 - lift / 0.16) ** 2;
        sy *= 1 - 0.3 * low;
        sx *= 1 + 0.1 * low;
      }
      if (t - p.poofAt < 400) {
        const k = (t - p.poofAt) / 400;
        sx *= k;
        sy *= k;
      }
      // Idle: breathe, sway a touch and slowly look around. Each figure has its own rhythm, and the motion
      // fades out while it hops or T-bags so nothing snaps.
      if (p.idlePhase == null) { p.idlePhase = Math.random() * 100; p.idleW = 0; }
      p.idleW += ((p.hop || t < p.tbagUntil ? 0 : 1) - p.idleW) * ease(4);
      const ph = p.idlePhase;
      const breath = Math.sin(t / 650 + ph);
      sy *= 1 + 0.025 * breath * p.idleW;
      sx *= 1 - 0.012 * breath * p.idleW;
      lift += 0.004 * (1 + Math.sin(t / 650 + ph - 0.6)) * p.idleW;
      p.figure.rotation.z = 0.035 * Math.sin(t / 1400 + ph * 1.3) * p.idleW;
      p.figure.rotation.y = 0.14 * Math.sin(t / 2600 + ph * 0.7) * p.idleW;
      p.figure.scale.set(sx, sy, sx);
      p.figure.position.y = lift;
      p.figure.position.x = t < p.shakeUntil ? Math.sin(t / 14) * 0.06 : 0;
      p.badge.position.y = (p.height + 0.16) * sy + lift;
      if (p.ring.visible) p.ring.scale.setScalar(1 + Math.sin(t / 250) * 0.08);
      p.tring.visible = targets.has(p.id);
      if (p.tring.visible) {
        const big = p.id === hot;
        p.tring.scale.setScalar((big ? 1.45 : 1.18) + pulse * (big ? 0.12 : 0.08));
        p.tring.material.opacity = big ? 1 : 0.55 + pulse * 0.35;
      }
    }

    renderer.render(scene, camera);
    if (opts.afterRender) opts.afterRender(el, t);
    raf = running ? requestAnimationFrame(frame) : 0;
  }

  // Stop drawing while the board is off screen.
  let running = true;
  let raf = 0;
  function setRunning(on) {
    running = on;
    if (on && !raf) { last = now(); raf = requestAnimationFrame(frame); }
  }
  const pawnPos = id => { const p = pawns.get(id); return p ? p.group.position : null; };

  resize();
  cam.cur.dist = cam.fit;
  raf = requestAnimationFrame(frame);

  return {
    build, setLit, setTax, setDeck, roll, setPlayers, place, hop, poof, tbag, shake, follow, screenPos, resize,
    setRunning, pawnPos, fit: () => cam.fit, scene, canvas: el, resetView, setTargets, setHot, setTileTargets,
    inspect: () => ({ W, H, insets, fit: cam.fit, zoom: cam.zoom, dist: cam.cur.dist, view: { ...view }, pitch: cam.cur.pitch }),
  };
}
