import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  runAIDepth, brightnessDepth, inflateDepth, extractAlpha, blur, distanceTransform,
  otsu, depthFromImage, depthToCanvas, loadImage, normalize,
} from './depth.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const view = $('#viewport');
const HAS_SERVER = location.protocol.startsWith('http');

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
view.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2b2b31');
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 200);
const HOME = new THREE.Vector3(0, 0.1, 5.4);
camera.position.copy(HOME);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.target.set(0, 0, 0);
orbit.autoRotateSpeed = 2.5;

const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.75);
gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
gizmo.addEventListener('objectChange', () => renderLightList(false));
scene.add(gizmo);

const hemi = new THREE.HemisphereLight(0xdfe6ff, 0x3a3430, 0.25);
scene.add(hemi);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x45454d, roughness: 1 });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), groundMat);
wall.receiveShadow = true;
wall.visible = false;
scene.add(wall);

const subjectGroup = new THREE.Group();
scene.add(subjectGroup);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const S = {
  item: null,            // library item currently shown
  kind: null,            // 'image' | 'model'
  texture: null,
  depthCanvas: null,     // downscaled source used for depth (and its alpha)
  alpha: null,
  dw: 0, dh: 0,
  rawDepth: null,
  finalDepth: null,
  model: null,           // loaded glTF scene
  modelMats: new Map(),  // original materials of the glTF
  viewDepth: false,
  loadToken: 0,
  p: {
    source: 'ai', strength: 0.7, curve: 1, smooth: 3, cutoff: 0, autocut: true, tear: 0.06, round: 0.04,
    back: 'inflate', backDepth: 0.6, detail: 384, invert: false,
    mode: 'lit', clay: '#c9c2ba', rough: 0.75,
  },
  bounds: { minY: -1, minZ: -0.5 },
};

// ---------------------------------------------------------------------------
// Depth → mesh
// ---------------------------------------------------------------------------

function processDepth() {
  const { dw: w, dh: h, alpha } = S;
  const P = S.p;
  let d = Float32Array.from(S.rawDepth);
  if (P.invert) for (let i = 0; i < d.length; i++) d[i] = 1 - d[i];
  d = blur(d, w, h, P.smooth);

  let cut = P.cutoff;
  if (P.autocut) {
    cut = alpha ? 0 : otsu(d, null) * 0.9;
    setSlider('cutoff', cut);
  }
  const keep = new Uint8Array(w * h);
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < d.length; i++) {
    keep[i] = (!alpha || alpha[i] > 0.5) && d[i] >= cut ? 1 : 0;
    if (keep[i]) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  }
  const range = mx - mn || 1;
  for (let i = 0; i < d.length; i++) d[i] = keep[i] ? (d[i] - mn) / range : 0;

  // Round the silhouette so the front and the mirrored back meet at the edge.
  if (P.round > 0 && (alpha || cut > 0)) {
    const dist = distanceTransform(keep, w, h);
    const R = P.round * Math.max(w, h);
    for (let i = 0; i < d.length; i++) {
      if (!keep[i]) continue;
      const f = Math.min(1, dist[i] / R);
      d[i] *= Math.sqrt(f * (2 - f));
    }
  }
  for (let i = 0; i < d.length; i++) if (keep[i]) d[i] = Math.pow(d[i], P.curve);
  return { d, keep };
}

function buildSubject() {
  if (S.kind !== 'image' || !S.rawDepth) return;
  const P = S.p;
  const { dw: w, dh: h } = S;
  const { d, keep } = processDepth();
  S.finalDepth = d;

  const aspect = w / h;
  let H = 2, W = 2 * aspect;
  if (W > 3) { W = 3; H = 3 / aspect; }
  const sx = aspect >= 1 ? P.detail : Math.max(8, Math.round(P.detail * aspect));
  const sy = aspect >= 1 ? Math.max(8, Math.round(P.detail / aspect)) : P.detail;
  const nx = sx + 1, ny = sy + 1;
  const back = P.back === 'inflate';
  const nv = nx * ny;

  const pos = new Float32Array(nv * 3 * (back ? 2 : 1));
  const uv = new Float32Array(nv * 2 * (back ? 2 : 1));
  const dv = new Float32Array(nv);
  const kv = new Uint8Array(nv);

  const sample = (u, v) => {
    const fx = u * (w - 1), fy = v * (h - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const tx = fx - x0, ty = fy - y0;
    return (d[y0 * w + x0] * (1 - tx) + d[y0 * w + x1] * tx) * (1 - ty) + (d[y1 * w + x0] * (1 - tx) + d[y1 * w + x1] * tx) * ty;
  };

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * nx + i, u = i / sx, v = j / sy;
      const px = Math.round(u * (w - 1)), py = Math.round(v * (h - 1));
      kv[k] = keep[py * w + px];
      dv[k] = sample(u, v);
      const x = (u - 0.5) * W, y = (0.5 - v) * H;
      pos.set([x, y, dv[k] * P.strength], k * 3);
      uv.set([u, 1 - v], k * 2);
      if (back) {
        pos.set([x, y, -dv[k] * P.strength * P.backDepth], (nv + k) * 3);
        uv.set([u, 1 - v], (nv + k) * 2);
      }
    }
  }

  const idx = [];
  for (let j = 0; j < sy; j++) {
    for (let i = 0; i < sx; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, e = c + 1;
      if (!kv[a] || !kv[b] || !kv[c] || !kv[e]) continue;
      const lo = Math.min(dv[a], dv[b], dv[c], dv[e]), hi = Math.max(dv[a], dv[b], dv[c], dv[e]);
      if (hi - lo > P.tear) continue;
      idx.push(a, c, b, b, c, e);
      if (back) idx.push(nv + a, nv + b, nv + c, nv + b, nv + e, nv + c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  geo.translate(0, 0, -(bb.min.z + bb.max.z) / 2);
  geo.computeBoundingBox();

  clearSubject();
  const mesh = new THREE.Mesh(geo, makeMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  subjectGroup.add(mesh);
  S.bounds = { minY: geo.boundingBox.min.y, minZ: geo.boundingBox.min.z };
  placeGround();
}

function clearSubject() {
  for (const c of [...subjectGroup.children]) {
    subjectGroup.remove(c);
    c.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material && !S.modelMats.has(o)) [].concat(o.material).forEach(m => m.dispose());
    });
  }
}

let depthTex = null;
function makeMaterial() {
  const P = S.p;
  const side = P.back === 'none' ? THREE.DoubleSide : THREE.FrontSide;
  if (S.viewDepth && S.finalDepth) {
    if (depthTex) depthTex.dispose();
    depthTex = new THREE.CanvasTexture(depthToCanvas(S.finalDepth, S.dw, S.dh));
    depthTex.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: depthTex, side });
  }
  switch (P.mode) {
    case 'clay': return new THREE.MeshStandardMaterial({ color: P.clay, roughness: P.rough, metalness: 0, side });
    case 'unlit': return new THREE.MeshBasicMaterial({ map: S.texture, side });
    case 'normals': return new THREE.MeshNormalMaterial({ side });
    default: return new THREE.MeshStandardMaterial({ map: S.texture, roughness: P.rough, metalness: 0, side });
  }
}

function applyMaterial() {
  if (S.kind === 'image') {
    const mesh = subjectGroup.children[0];
    if (mesh) { mesh.material.dispose(); mesh.material = makeMaterial(); }
  } else if (S.kind === 'model') {
    const P = S.p;
    S.model.traverse(o => {
      if (!o.isMesh) return;
      const orig = S.modelMats.get(o);
      if (o.material !== orig) [].concat(o.material).forEach(m => m.dispose());
      if (P.mode === 'clay') o.material = new THREE.MeshStandardMaterial({ color: P.clay, roughness: P.rough });
      else if (P.mode === 'normals') o.material = new THREE.MeshNormalMaterial();
      else if (P.mode === 'unlit') o.material = [].concat(orig).map(m => new THREE.MeshBasicMaterial({ map: m.map || null, color: m.map ? 0xffffff : (m.color || 0xffffff) }))[0];
      else o.material = orig;
    });
  }
}

function placeGround() {
  floor.position.y = S.bounds.minY - 0.005;
  wall.position.z = S.bounds.minZ - 0.6;
}

// ---------------------------------------------------------------------------
// Loading images / models
// ---------------------------------------------------------------------------

function scaleToCanvas(img, max) {
  const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * s));
  c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

async function openItem(item) {
  const token = ++S.loadToken;
  S.item = item;
  renderThumbs();
  $('#empty').classList.add('hidden');
  setStatus(`Loading ${item.name}…`);
  try {
    if (item.kind === 'model') await openModel(item, token);
    else await openImage(item, token);
  } catch (e) {
    console.error(e);
    if (token === S.loadToken) { toast(`Could not open ${item.name}: ${e.message}`, true); setStatus('Error'); }
  }
}

async function openImage(item, token) {
  const img = await loadImage(item.url);
  if (token !== S.loadToken) return;
  if (S.texture) S.texture.dispose();
  S.texture = new THREE.CanvasTexture(scaleToCanvas(img, 2048));
  S.texture.colorSpace = THREE.SRGBColorSpace;
  S.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  S.depthCanvas = scaleToCanvas(img, 640);
  S.dw = S.depthCanvas.width;
  S.dh = S.depthCanvas.height;
  S.alpha = extractAlpha(S.depthCanvas);
  S.kind = 'image';
  S.model = null;
  S.modelMats.clear();
  setShapeEnabled(true);

  let depth = null;
  if (item.depthUrl && S.p.source === 'ai') {
    try { depth = await depthFromImage(item.depthUrl, S.dw, S.dh); } catch (e) { depth = null; }
  }
  if (!depth) depth = await computeDepth(S.p.source, token);
  if (token !== S.loadToken || !depth) return;
  S.rawDepth = depth;
  buildSubject();
  resetCamera(false);
  setStatus(`${item.name} · ${S.dw}×${S.dh} depth${item.depthUrl ? ' (cached)' : ''}`);
}

async function computeDepth(source, token) {
  if (source === 'custom') source = 'ai';
  if (source === 'ai') {
    try {
      showOverlay('Preparing AI depth model…', 'First time only: downloading ~25 MB, then it is cached.');
      const d = await runAIDepth(S.depthCanvas, onAIProgress);
      if (token === S.loadToken) saveDepth(d);
      return d;
    } catch (e) {
      console.error(e);
      toast(`AI depth unavailable (${e.message}). Using a simple fallback instead.`, true);
      source = S.alpha ? 'inflate' : 'brightness';
    } finally {
      hideOverlay();
    }
  }
  if (source === 'inflate') return inflateDepth(S.alpha, S.dw, S.dh);
  return brightnessDepth(S.depthCanvas);
}

const fileProgress = {};
function onAIProgress(p) {
  if (p.status === 'progress' && p.total) {
    fileProgress[p.file] = [p.loaded, p.total];
    let l = 0, t = 0;
    for (const [a, b] of Object.values(fileProgress)) { l += a; t += b; }
    showOverlay('Downloading AI depth model…', `${(l / 1048576).toFixed(1)} / ${(t / 1048576).toFixed(1)} MB`, l / t);
  } else if (p.status === 'infer') {
    showOverlay('Estimating depth…', `Running on ${p.device === 'webgpu' ? 'GPU (WebGPU)' : 'CPU (WASM) — can take ~10-30 s'}`, null);
  }
}

async function saveDepth(d) {
  if (!HAS_SERVER || !S.item || !S.item.server) return;
  const blob = await new Promise(r => depthToCanvas(d, S.dw, S.dh).toBlob(r, 'image/png'));
  try {
    await fetch('api/depth?name=' + encodeURIComponent(S.item.name), { method: 'POST', body: blob });
    refreshLibrary();
  } catch (e) { /* cache is optional */ }
}

async function openModel(item, token) {
  showOverlay('Loading 3D model…', item.name, null);
  try {
    const gltf = await new GLTFLoader().loadAsync(item.url);
    if (token !== S.loadToken) return;
    clearSubject();
    const root = gltf.scene;
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const s = 2 / Math.max(size.y, size.x * 0.75, size.z * 0.75, 1e-6);
    root.scale.setScalar(s);
    box.setFromObject(root);
    const c = box.getCenter(new THREE.Vector3());
    root.position.sub(c);
    S.modelMats.clear();
    root.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; S.modelMats.set(o, o.material); }
    });
    subjectGroup.add(root);
    S.kind = 'model';
    S.model = root;
    S.rawDepth = null;
    box.setFromObject(root);
    S.bounds = { minY: box.min.y, minZ: box.min.z };
    placeGround();
    applyMaterial();
    setShapeEnabled(false);
    resetCamera(false);
    setStatus(`${item.name} · full 3D model`);
  } finally {
    hideOverlay();
  }
}

function setShapeEnabled(on) {
  $('#sec-depth').querySelectorAll('input, select, button').forEach(el => { el.disabled = !on; });
}

// ---------------------------------------------------------------------------
// Lights
// ---------------------------------------------------------------------------

const lights = [];
let lightSeq = 1;
let selected = null;
const POWER_SCALE = { point: 6, spot: 10, sun: 1 };
const TYPE_LABEL = { point: 'Point', spot: 'Spot', sun: 'Sun' };

function addLight(type, o = {}) {
  const color = o.color || '#ffffff';
  const power = o.power ?? (type === 'sun' ? 2.5 : 4);
  let L;
  if (type === 'point') L = new THREE.PointLight(color, 0, 0, 2);
  else if (type === 'spot') L = new THREE.SpotLight(color, 0, 0, THREE.MathUtils.degToRad(o.angle ?? 30), o.penumbra ?? 0.5, 2);
  else L = new THREE.DirectionalLight(color, 0);
  L.position.set(...(o.pos || [2, 2, 3]));
  L.castShadow = o.shadow ?? true;
  L.shadow.mapSize.set(2048, 2048);
  L.shadow.bias = -0.0004;
  L.shadow.normalBias = 0.02;
  if (type === 'sun') {
    const cam = L.shadow.camera;
    cam.left = cam.bottom = -4; cam.right = cam.top = 4; cam.near = 0.1; cam.far = 30;
  } else {
    L.shadow.camera.near = 0.1;
    L.shadow.camera.far = 30;
  }
  if (L.target) { L.target.position.set(0, 0, 0); scene.add(L.target); }

  const bulb = new THREE.Mesh(new THREE.SphereGeometry(type === 'sun' ? 0.11 : 0.08, 20, 12), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
  bulb.userData.isBulb = true;
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.16, 32), new THREE.MeshBasicMaterial({ color: 0xffb45e, side: THREE.DoubleSide, toneMapped: false }));
  ring.visible = false;
  bulb.add(ring);
  L.add(bulb);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(lineGeo, new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0.6 }));
  line.visible = type !== 'point';
  scene.add(line);
  scene.add(L);

  const entry = { id: lightSeq++, type, light: L, bulb, ring, line, power, on: true, name: o.name || `${TYPE_LABEL[type]} ${lights.filter(l => l.type === type).length + 1}` };
  lights.push(entry);
  updateLight(entry);
  return entry;
}

function updateLight(e) {
  e.light.intensity = e.on ? e.power * POWER_SCALE[e.type] : 0;
  e.light.color.set(e.color || e.light.color);
  e.bulb.material.color.copy(e.light.color);
  e.line.material.color.copy(e.light.color);
  e.bulb.material.opacity = e.on ? 1 : 0.35;
  e.bulb.material.transparent = !e.on;
}

function removeLight(e) {
  if (selected === e) selectLight(null);
  scene.remove(e.light, e.line);
  if (e.light.target) scene.remove(e.light.target);
  e.light.dispose && e.light.dispose();
  lights.splice(lights.indexOf(e), 1);
  renderLightList();
}

function selectLight(e) {
  selected = e;
  lights.forEach(l => { l.ring.visible = l === e; });
  if (e) gizmo.attach(e.light); else gizmo.detach();
  renderLightList();
}

function clearLights() {
  [...lights].forEach(removeLight);
}

const PRESETS = {
  threepoint: [
    { type: 'spot', name: 'Key', pos: [2.4, 2.2, 3.2], power: 5, color: '#fff1dc', angle: 32 },
    { type: 'point', name: 'Fill', pos: [-3, 0.6, 2.6], power: 1.6, color: '#d9e4ff', shadow: false },
    { type: 'point', name: 'Rim', pos: [-1.2, 2.2, -2.6], power: 4, color: '#ffffff' },
  ],
  rembrandt: [{ type: 'spot', name: 'Key', pos: [2.2, 2.6, 2.2], power: 6, color: '#ffe2bd', angle: 28, penumbra: 0.4 }],
  rim: [
    { type: 'point', name: 'Rim L', pos: [-2.2, 1.4, -2.2], power: 5, color: '#bcd2ff' },
    { type: 'point', name: 'Rim R', pos: [2.2, 1.4, -2.2], power: 5, color: '#bcd2ff' },
    { type: 'point', name: 'Fill', pos: [0, 0.4, 3.5], power: 0.8, color: '#ffffff', shadow: false },
  ],
  top: [{ type: 'spot', name: 'Top', pos: [0, 4.2, 0.5], power: 7, color: '#ffffff', angle: 26, penumbra: 0.6 }],
  under: [{ type: 'point', name: 'Under', pos: [0, -1.6, 1.8], power: 5, color: '#9fffb0' }],
  sunset: [
    { type: 'sun', name: 'Sun', pos: [-4, 1.2, 2.5], power: 3.2, color: '#ffa25e' },
    { type: 'point', name: 'Sky bounce', pos: [3, 2, 2], power: 1.2, color: '#7f9bff', shadow: false },
  ],
};

function applyPreset(name) {
  clearLights();
  if (name !== 'clear') (PRESETS[name] || []).forEach(o => addLight(o.type, o));
  selectLight(null);
}

function renderLightList(full = true) {
  const box = $('#lights');
  if (!full) return;
  if (!lights.length) { box.innerHTML = '<div class="none">No lights. Add one above — only the ambient light is on.</div>'; return; }
  box.innerHTML = lights.map(e => {
    const hex = '#' + e.light.color.getHexString();
    const body = e === selected ? `
      <div class="lc-body">
        <div class="row"><label>Color</label><input type="color" data-k="color" value="${hex}"></div>
        <div class="slider"><label>Power <output>${e.power.toFixed(1)}</output></label><input type="range" data-k="power" min="0" max="10" step="0.1" value="${e.power}"></div>
        ${e.type === 'spot' ? `
        <div class="slider"><label>Cone <output>${Math.round(THREE.MathUtils.radToDeg(e.light.angle))}°</output></label><input type="range" data-k="angle" min="5" max="80" step="1" value="${THREE.MathUtils.radToDeg(e.light.angle)}"></div>
        <div class="slider"><label>Edge softness <output>${e.light.penumbra.toFixed(2)}</output></label><input type="range" data-k="penumbra" min="0" max="1" step="0.01" value="${e.light.penumbra}"></div>` : ''}
        <label class="check"><input type="checkbox" data-k="shadow" ${e.light.castShadow ? 'checked' : ''}> Casts shadows</label>
        <div class="btn-row"><button class="btn small" data-a="cam">Place at camera</button><button class="btn small" data-a="dup">Duplicate</button></div>
      </div>` : '';
    return `<div class="lc ${e === selected ? 'sel' : ''} ${e.on ? '' : 'off'}" data-id="${e.id}">
      <div class="lc-head" data-a="select">
        <span class="sw" style="background:${hex};color:${hex}"></span>
        <b>${e.name}</b><span class="type">${TYPE_LABEL[e.type]}</span>
        <input type="checkbox" data-k="on" title="On/off" ${e.on ? 'checked' : ''}>
        <button class="del" data-a="del" title="Delete">✕</button>
      </div>${body}</div>`;
  }).join('');
}

$('#lights').addEventListener('click', ev => {
  const card = ev.target.closest('.lc');
  if (!card) return;
  const e = lights.find(l => l.id === +card.dataset.id);
  const a = ev.target.closest('[data-a]')?.dataset.a;
  if (ev.target.matches('input')) return;
  if (a === 'del') removeLight(e);
  else if (a === 'cam') { e.light.position.copy(camera.position); toast(`${e.name} moved to the camera position`); }
  else if (a === 'dup') {
    const n = addLight(e.type, { pos: e.light.position.toArray().map((v, i) => v + (i === 0 ? 0.4 : 0)), power: e.power, color: '#' + e.light.color.getHexString(), angle: e.light.angle ? THREE.MathUtils.radToDeg(e.light.angle) : undefined, penumbra: e.light.penumbra, shadow: e.light.castShadow });
    selectLight(n);
  } else if (a === 'select') selectLight(selected === e ? null : e);
});

$('#lights').addEventListener('input', ev => {
  const card = ev.target.closest('.lc');
  const k = ev.target.dataset.k;
  if (!card || !k) return;
  const e = lights.find(l => l.id === +card.dataset.id);
  const v = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
  if (k === 'on') { e.on = v; updateLight(e); card.classList.toggle('off', !v); return; }
  if (k === 'color') { e.color = v; updateLight(e); card.querySelector('.sw').style.background = v; card.querySelector('.sw').style.color = v; }
  if (k === 'power') { e.power = +v; updateLight(e); }
  if (k === 'angle') e.light.angle = THREE.MathUtils.degToRad(+v);
  if (k === 'penumbra') e.light.penumbra = +v;
  if (k === 'shadow') e.light.castShadow = v;
  const out = ev.target.closest('.slider')?.querySelector('output');
  if (out) out.textContent = k === 'angle' ? `${v}°` : (+v).toFixed(k === 'penumbra' ? 2 : 1);
});

$$('[data-add]').forEach(b => {
  b.onclick = () => {
    const t = b.dataset.add;
    const p = camera.position.clone().normalize().multiplyScalar(3.2);
    p.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.6).add(new THREE.Vector3(0, 1.2, 0));
    selectLight(addLight(t, { pos: p.toArray() }));
  };
});
$('#preset').onchange = e => { if (e.target.value) applyPreset(e.target.value); e.target.value = ''; };

// Picking bulbs in the viewport
const ray = new THREE.Raycaster();
let downAt = null;
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4 || e.button !== 0) return;
  if (gizmo.dragging || gizmo.axis) return;
  const r = renderer.domElement.getBoundingClientRect();
  ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
  const hit = ray.intersectObjects(lights.map(l => l.bulb), false)[0];
  selectLight(hit ? lights.find(l => l.bulb === hit.object) : null);
});

// ---------------------------------------------------------------------------
// Camera
// ---------------------------------------------------------------------------

let camTween = null;
function tweenCamera(toPos, ms = 450) {
  const from = camera.position.clone(), t0 = performance.now();
  const fromT = orbit.target.clone();
  camTween = now => {
    const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(from, toPos, e);
    orbit.target.lerpVectors(fromT, new THREE.Vector3(0, 0, 0), e);
    if (k >= 1) camTween = null;
  };
}

function camAngle(name) {
  const r = Math.max(2, camera.position.distanceTo(orbit.target));
  const A = { front: [0, 2], left: [-40, 8], right: [40, 8], high: [0, 45], low: [0, -22] }[name];
  const az = THREE.MathUtils.degToRad(A[0]), el = THREE.MathUtils.degToRad(A[1]);
  tweenCamera(new THREE.Vector3(r * Math.sin(az) * Math.cos(el), r * Math.sin(el), r * Math.cos(az) * Math.cos(el)));
}

function resetCamera(animate = true) {
  if (animate) tweenCamera(HOME.clone());
  else { camera.position.copy(HOME); orbit.target.set(0, 0, 0); }
}

$$('[data-cam]').forEach(b => { b.onclick = () => camAngle(b.dataset.cam); });
$('#btn-spin').onclick = () => { orbit.autoRotate = !orbit.autoRotate; $('#btn-spin').classList.toggle('on', orbit.autoRotate); };
$('#btn-reset-cam').onclick = () => resetCamera(true);

// ---------------------------------------------------------------------------
// Controls panel
// ---------------------------------------------------------------------------

const SHAPE_KEYS = ['strength', 'curve', 'smooth', 'cutoff', 'tear', 'round', 'backDepth'];
const FMT = { smooth: v => v.toFixed(0), cutoff: v => v.toFixed(2), round: v => v.toFixed(3) };

function setSlider(key, v) {
  const el = $('#p-' + key);
  el.value = v;
  el.closest('.slider').querySelector('output').textContent = (FMT[key] || (x => x.toFixed(2)))(+v);
}

let rebuildQueued = false;
function queueRebuild() {
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => { rebuildQueued = false; buildSubject(); });
}

for (const k of SHAPE_KEYS) {
  setSlider(k, S.p[k]);
  $('#p-' + k).addEventListener('input', e => {
    S.p[k] = +e.target.value;
    setSlider(k, S.p[k]);
    if (k === 'cutoff' && S.p.autocut) { S.p.autocut = false; $('#p-autocut').checked = false; }
    queueRebuild();
  });
}
$('#p-autocut').onchange = e => { S.p.autocut = e.target.checked; queueRebuild(); };
$('#p-invert').onchange = e => { S.p.invert = e.target.checked; queueRebuild(); };
$('#p-back').onchange = e => { S.p.back = e.target.value; queueRebuild(); };
$('#p-detail').onchange = e => { S.p.detail = +e.target.value; queueRebuild(); };

$('#p-source').onchange = async e => {
  const v = e.target.value;
  if (S.kind !== 'image') return;
  if (v === 'custom') { $('#depth-input').click(); return; }
  S.p.source = v;
  S.rawDepth = await computeDepth(v, S.loadToken);
  buildSubject();
};
$('#depth-input').onchange = async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f || S.kind !== 'image') return;
  const url = URL.createObjectURL(f);
  try {
    S.rawDepth = normalize(await depthFromImage(url, S.dw, S.dh));
    S.p.source = 'custom';
    buildSubject();
    toast('Custom depth map loaded (white = near)');
  } finally { URL.revokeObjectURL(url); }
};
$('#btn-rerun').onclick = async () => {
  if (S.kind !== 'image') return;
  S.p.source = 'ai';
  $('#p-source').value = 'ai';
  S.rawDepth = await computeDepth('ai', S.loadToken);
  buildSubject();
};
$('#btn-depth-dl').onclick = () => {
  if (!S.finalDepth) return;
  download(depthToCanvas(S.finalDepth, S.dw, S.dh).toDataURL('image/png'), baseName() + '-depth.png');
};
$('#btn-depth-view').onclick = () => {
  S.viewDepth = !S.viewDepth;
  $('#btn-depth-view').textContent = S.viewDepth ? 'Hide depth' : 'View depth';
  applyMaterial();
};

$$('#p-mode button').forEach(b => {
  b.onclick = () => {
    S.p.mode = b.dataset.v;
    S.viewDepth = false;
    $('#btn-depth-view').textContent = 'View depth';
    $$('#p-mode button').forEach(x => x.classList.toggle('on', x === b));
    applyMaterial();
  };
});
$('#p-clay').oninput = e => { S.p.clay = e.target.value; applyMaterial(); };
$('#p-rough').oninput = e => {
  S.p.rough = +e.target.value;
  e.target.closest('.slider').querySelector('output').textContent = S.p.rough.toFixed(2);
  applyMaterial();
};

function bindSlider(id, fn, fmt = v => v.toFixed(2)) {
  const el = $(id), out = el.closest('.slider').querySelector('output');
  const run = () => { fn(+el.value); out.textContent = fmt(+el.value); };
  el.addEventListener('input', run);
  run();
}
bindSlider('#p-rough', v => { S.p.rough = v; });
bindSlider('#p-ambient', v => { hemi.intensity = v; });
bindSlider('#p-exposure', v => { renderer.toneMappingExposure = v; });
bindSlider('#p-fov', v => { camera.fov = v; camera.updateProjectionMatrix(); }, v => `${v}°`);
$('#p-shadows').onchange = e => { renderer.shadowMap.enabled = e.target.checked; scene.traverse(o => { if (o.material) [].concat(o.material).forEach(m => { m.needsUpdate = true; }); }); };
$('#p-helpers').onchange = e => { const v = e.target.checked; lights.forEach(l => { l.bulb.visible = v; l.line.visible = v && l.type !== 'point'; }); if (!v) selectLight(null); };
$('#p-bg').oninput = e => { scene.background.set(e.target.value); };
$('#p-floor').onchange = e => { floor.visible = e.target.checked; };
$('#p-wall').onchange = e => { wall.visible = e.target.checked; };

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------

const library = new Map(); // name -> item
const IMG_RE = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;
const MODEL_RE = /\.(glb|gltf)$/i;

async function refreshLibrary() {
  if (!HAS_SERVER) return;
  try {
    const list = await (await fetch('api/images', { cache: 'no-store' })).json();
    const names = new Set(list.map(i => i.name));
    for (const [k, v] of library) if (v.server && !names.has(k)) library.delete(k);
    for (const it of list) library.set(it.name, { ...it, server: true });
    if (S.item && library.has(S.item.name)) S.item = library.get(S.item.name);
    renderThumbs();
  } catch (e) { /* server stopped */ }
}

function renderThumbs() {
  const items = [...library.values()];
  $('#lib-note').innerHTML = HAS_SERVER
    ? `Watching <code>images/</code> · ${items.length} file${items.length === 1 ? '' : 's'}`
    : 'Running without the server: drop files here (they are not saved).';
  $('#thumbs').innerHTML = items.map(it => `
    <button class="thumb ${S.item && S.item.name === it.name ? 'on' : ''}" data-name="${encodeURIComponent(it.name)}" title="${it.name}">
      ${it.kind === 'model' ? '<div class="glb">🧊</div>' : `<img loading="lazy" src="${it.url}" alt="">`}
      <span>${it.name}</span>${it.kind === 'model' ? '<i>3D</i>' : it.depthUrl ? '<i title="Depth already computed">✓</i>' : ''}
    </button>`).join('');
}

$('#thumbs').addEventListener('click', e => {
  const b = e.target.closest('.thumb');
  if (b) openItem(library.get(decodeURIComponent(b.dataset.name)));
});

async function addFiles(files) {
  let first = null;
  for (const f of files) {
    if (!IMG_RE.test(f.name) && !MODEL_RE.test(f.name)) { toast(`${f.name}: unsupported file type`, true); continue; }
    const kind = MODEL_RE.test(f.name) ? 'model' : 'image';
    if (HAS_SERVER) {
      try {
        const r = await fetch('api/upload?name=' + encodeURIComponent(f.name), { method: 'POST', body: f });
        const { name } = await r.json();
        first = first || name;
        continue;
      } catch (e) { /* fall through to local */ }
    }
    const item = { name: f.name, kind, url: URL.createObjectURL(f), depthUrl: null, server: false };
    library.set(f.name, item);
    first = first || f.name;
  }
  await refreshLibrary();
  renderThumbs();
  if (first && library.has(first)) openItem(library.get(first));
}

$('#btn-open').onclick = () => $('#file-input').click();
$('#file-input').onchange = e => { addFiles([...e.target.files]); e.target.value = ''; };
let dragDepth = 0;
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; view.classList.add('drag'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; view.classList.remove('drag'); } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
  e.preventDefault();
  dragDepth = 0;
  view.classList.remove('drag');
  addFiles([...e.dataTransfer.files]);
});

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

function setStatus(t) { $('#status').textContent = t; }
function showOverlay(title, sub, frac) {
  $('#overlay').classList.remove('hidden');
  $('#ov-title').textContent = title;
  $('#ov-sub').textContent = sub || '';
  $('#ov-bar').style.width = frac == null ? '100%' : `${Math.round(frac * 100)}%`;
  $('#ov-bar').style.opacity = frac == null ? 0.35 : 1;
}
function hideOverlay() { $('#overlay').classList.add('hidden'); }
let toastT;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.className = ''; }, 3200);
}
function baseName() { return S.item ? S.item.name.replace(/\.[^.]+$/, '') : 'angle-studio'; }
function download(url, name) {
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
}

function screenshot() {
  const hidden = [gizmo, ...lights.flatMap(l => [l.bulb, l.line])].filter(o => o.visible);
  hidden.forEach(o => { o.visible = false; });
  renderer.render(scene, camera);
  download(renderer.domElement.toDataURL('image/png'), baseName() + '-view.png');
  hidden.forEach(o => { o.visible = true; });
  toast('Screenshot saved');
}
$('#btn-shot').onclick = screenshot;
$('#btn-help').onclick = () => $('#help').classList.remove('hidden');
$('#help-close').onclick = () => $('#help').classList.add('hidden');
$('#help').onclick = e => { if (e.target.id === 'help') $('#help').classList.add('hidden'); };

document.addEventListener('keydown', e => {
  if (e.target.matches('input, select, textarea')) return;
  const k = e.key.toLowerCase();
  if ((k === 'delete' || k === 'backspace') && selected) removeLight(selected);
  else if (k === 'escape') { selectLight(null); $('#help').classList.add('hidden'); }
  else if (k === 'c' && selected) { selected.light.position.copy(camera.position); toast(`${selected.name} moved to the camera position`); }
  else if (k === 's') screenshot();
  else if ('12345'.includes(k) && k) camAngle(['front', 'left', 'right', 'high', 'low'][+k - 1]);
});

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
resize();

renderer.setAnimationLoop(now => {
  if (camTween) camTween(now);
  orbit.update();
  for (const l of lights) {
    if (!l.line.visible) continue;
    const a = l.line.geometry.attributes.position;
    a.setXYZ(0, l.light.position.x, l.light.position.y, l.light.position.z);
    a.setXYZ(1, 0, 0, 0);
    a.needsUpdate = true;
    l.line.computeLineDistances();
  }
  renderer.render(scene, camera);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

applyPreset('threepoint');
renderThumbs();
refreshLibrary();
setInterval(() => { if (!document.hidden) refreshLibrary(); }, 4000);
window.__angle = { S, lights, openItem, library, camera, orbit }; // debug handle
