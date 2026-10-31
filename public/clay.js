// Clay: organic modelling with signed distance fields.
//
// Shapes (balls, ellipsoids, tapered limbs, rounded boxes, tori) are blended into each other like clay with a smooth
// union (k = how soft the join is), carved with smooth subtraction, roughened with noise, then turned into a dense,
// smooth mesh. Each shape brings a colour (with optional patterns) and a material channel; colours melt into each
// other where shapes blend, and the result is one mesh per channel so skin, cloth and metal get their own materials.
//
//   const C = clay();
//   C.ell([0, 1, 0], [0.2, 0.25, 0.2], { color: '#c99a5b', bump: [0.002, 80] });
//   C.limb([[0, 1, 0], [0, 0.5, 0.1], [0, 0, 0]], [0.08, 0.05, 0.04], { color: SKIN, mat: 'skin', k: 0.03 });
//   group.add(C.build({ voxel: 0.006, mats: { base: { roughness: 0.6 }, skin: { roughness: 0.5 } } }));
//
// build() returns a group right away and fills it once the mesh is ready: meshing runs in a pool of workers, so the
// page never stalls. group.userData.ready resolves when it's filled. Recipes are cached, so a repeat is instant.
import * as THREE from '/vendor/three/three.module.js';
import { mesh as meshSync, BALL, CONE, ELL, BOX, TORUS, CYL, PLANE, OP_ADD, OP_SUB, OP_AND } from './clay-core.js';

const OPS = { add: OP_ADD, sub: OP_SUB, and: OP_AND };
const colorTmp = new THREE.Color();
export const rgb = c => {
  if (Array.isArray(c)) return c;
  colorTmp.set(c); // sRGB in, linear out (what vertex colours want)
  return [colorTmp.r, colorTmp.g, colorTmp.b];
};

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------
export function clay() {
  const prims = [];
  let frame = new THREE.Matrix4();
  let scale = 1;
  const stack = [];
  const v3 = new THREE.Vector3();
  const box = new THREE.Box3();
  const W = pt => { v3.set(pt[0], pt[1], pt[2]).applyMatrix4(frame); return [v3.x, v3.y, v3.z]; };
  const placed = (pos, rot) => frame.clone().multiply(new THREE.Matrix4().compose(
    new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new THREE.Vector3(1, 1, 1)));

  function add(t, shape, o, center, radius, aabb) {
    const tint = o.tint ? [].concat(o.tint).map(x => ({ ...x, c: x.c ? rgb(x.c) : null })) : null;
    const bumpAmp = o.bump ? o.bump[0] * scale : 0;
    // Clip plane: [point, normal, soft] in the current frame -> world [nx, ny, nz, d, soft]
    let clip = null;
    if (o.clip) {
      const pw = W(o.clip[0]);
      v3.set(...o.clip[1]).transformDirection(frame);
      clip = [v3.x, v3.y, v3.z, v3.x * pw[0] + v3.y * pw[1] + v3.z * pw[2], (o.clip[2] || 0) * scale];
    }
    const p = {
      clip, t, op: OPS[o.op || 'add'], k: (o.k ?? 0.015) * scale, col: rgb(o.color || '#888888'), mat: o.mat || 'base',
      bump: o.bump ? [bumpAmp, o.bump[1] / scale] : null, tint, disp: o.disp || null, paint: !!o.paint,
      bound: [center[0], center[1], center[2], radius + bumpAmp + (o.disp ? (o.disp.a || 0) * scale : 0)],
      ...shape,
    };
    prims.push(p);
    // Tight-ish bounds for sizing the model before the mesh exists
    if (p.op === OP_ADD && aabb) box.union(aabb.expandByScalar(bumpAmp));
    return api;
  }
  // Shapes with their own frame: store the inverse transform and the frame's scale
  function framed(t, pos, rot, shape, o, localHalf) {
    const L = placed(pos, rot);
    const inv = L.clone().invert().elements.slice();
    const c = W(pos);
    const half = new THREE.Vector3(...localHalf);
    const radius = half.length() * scale;
    // (Box3 keeps the vectors it's given, and applyMatrix4 moves them: hand it copies)
    const aabb = new THREE.Box3(half.clone().negate(), half.clone()).applyMatrix4(L);
    return add(t, { inv, s: scale, ...shape }, o, c, radius, aabb);
  }

  const api = {
    prims,
    // Shapes made inside fn are placed at pos, turned by rot (Euler XYZ) and scaled by s.
    at(pos, rot, fn, s = 1) {
      stack.push([frame, scale]);
      frame = frame.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot || [0, 0, 0]))), new THREE.Vector3(s, s, s)));
      scale *= s;
      fn(api);
      [frame, scale] = stack.pop();
      return api;
    },
    ball(c, r, o = {}) {
      const w = W(c);
      const R = r * scale;
      return add(BALL, { x: w[0], y: w[1], z: w[2], r: R }, o, w, R, new THREE.Box3(new THREE.Vector3(w[0] - R, w[1] - R, w[2] - R), new THREE.Vector3(w[0] + R, w[1] + R, w[2] + R)));
    },
    ell: (c, rad, o = {}) => framed(ELL, c, o.rot, { rx: rad[0], ry: rad[1], rz: rad[2] }, o, rad),
    box: (c, size, r, o = {}) => framed(BOX, c, o.rot, { bx: size[0] / 2, by: size[1] / 2, bz: size[2] / 2, r }, o, size.map(x => x / 2)),
    torus: (c, R, r, o = {}) => framed(TORUS, c, o.rot, { R, r }, o, [R + r, r, R + r]),
    cyl: (c, r, h, round, o = {}) => framed(CYL, c, o.rot, { r, h: h / 2, rd: round }, o, [r, h / 2, r]),
    // Tapered round cone from a (radius ra) to b (radius rb)
    cone(a, b, ra, rb, o = {}) {
      const A = W(a);
      const B = W(b);
      ra *= scale;
      rb *= scale;
      const bx = B[0] - A[0];
      const by = B[1] - A[1];
      const bz = B[2] - A[2];
      const l2 = bx * bx + by * by + bz * bz || 1e-10;
      const rr = ra - rb;
      const mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2];
      const aabb = new THREE.Box3(new THREE.Vector3(A[0] - ra, A[1] - ra, A[2] - ra), new THREE.Vector3(A[0] + ra, A[1] + ra, A[2] + ra))
        .union(new THREE.Box3(new THREE.Vector3(B[0] - rb, B[1] - rb, B[2] - rb), new THREE.Vector3(B[0] + rb, B[1] + rb, B[2] + rb)));
      return add(CONE, { ax: A[0], ay: A[1], az: A[2], bx, by, bz, l2, rr, a2: l2 - rr * rr, il2: 1 / l2, ra, rb }, o, mid, Math.sqrt(l2) / 2 + Math.max(ra, rb), aabb);
    },
    // A smooth limb through several points, a radius at each point (or a function of 0..1 along it)
    limb(pts, radii, o = {}) {
      const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)), false, 'centripetal') : null;
      const n = curve ? Math.max(pts.length - 1, o.seg || (pts.length - 1) * 3) : 1;
      const at = t => (curve ? curve.getPointAt(t).toArray() : pts[0].map((v, i) => v + (pts[1][i] - v) * t));
      const rad = t => {
        if (typeof radii === 'function') return radii(t);
        const x = t * (radii.length - 1);
        const i = Math.min(radii.length - 2, Math.floor(x));
        const f = x - i;
        return radii[i] + (radii[i + 1] - radii[i]) * (f * f * (3 - 2 * f));
      };
      let s0 = 0;
      for (let i = 0; i < n; i++) {
        const a = at(i / n);
        const b = at((i + 1) / n);
        const disp = o.disp && o.disp.t === 'rings' ? { ...o.disp, s0 } : o.disp;
        api.cone(a, b, rad(i / n), rad((i + 1) / n), { ...o, disp, k: i ? (o.joint ?? 0) : o.k }); // joints inside a limb meet on a shared sphere: no blend (a blend would bulge)
        s0 += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * scale;
      }
      return api;
    },
    // Keep only what's below the plane through c with normal n (op 'and'), or carve it away (op 'sub' flips it)
    plane(c, n, o = {}) {
      const w = W(c);
      v3.set(...n).transformDirection(frame);
      return add(PLANE, { nx: v3.x, ny: v3.y, nz: v3.z, d: v3.x * w[0] + v3.y * w[1] + v3.z * w[2] }, { op: 'and', ...o }, w, 1e6, null);
    },
    // The space the shapes take up (before meshing), in this recipe's coordinates
    bounds: () => box.clone(),
    build: opts => build(api, opts),
  };
  return api;
}

// ---------------------------------------------------------------------------
// Meshing: a small worker pool, a cache, and a fallback for browsers without module workers
// ---------------------------------------------------------------------------
const cache = new Map(); // recipe key -> Promise<buffers by channel name>
const pool = { workers: [], busy: [], home: new Map(), jobs: new Map(), seq: 0, broken: false };

// New shapes go to the least busy worker; the same shapes always go back to that worker, so a colour change can reuse
// the mesh it already made.
function worker(geoKey) {
  if (pool.broken || typeof Worker === 'undefined') return null;
  const max = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  while (pool.workers.length < max) {
    try {
      const w = new Worker(new URL('./clay-worker.js', import.meta.url), { type: 'module' });
      const wi = pool.workers.length;
      pool.busy.push(0);
      w.onmessage = e => {
        pool.busy[wi]--;
        const job = pool.jobs.get(e.data.id);
        pool.jobs.delete(e.data.id);
        if (!job) return;
        if (e.data.error) job.reject(new Error(e.data.error)); else job.resolve(e.data.res);
      };
      w.onerror = () => { pool.broken = true; for (const [id, job] of pool.jobs) { pool.jobs.delete(id); job.fallback(); } };
      pool.workers.push(w);
    } catch { pool.broken = true; return null; }
  }
  let wi = pool.home.get(geoKey);
  if (wi === undefined) {
    wi = pool.busy.indexOf(Math.min(...pool.busy));
    pool.home.set(geoKey, wi);
  }
  pool.busy[wi]++;
  return pool.workers[wi];
}

// shapeOnly: leave out colours, so recipes that differ only in colour share a key
function keyOf(prims, voxel, shapeOnly) {
  const s = JSON.stringify(prims, (k, v) => (shapeOnly && (k === 'col' || k === 'tint') ? undefined : typeof v === 'number' ? Math.round(v * 1e5) / 1e5 : v)) + voxel;
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2, 33) ^ c;
  }
  return `${h1 >>> 0}-${h2 >>> 0}-${s.length}`;
}

function meshAsync(prims, voxel, names) {
  const key = keyOf(prims, voxel);
  if (!cache.has(key)) {
    const named = res => Object.fromEntries(Object.entries(res).map(([i, b]) => [names[i], b]));
    const runHere = () => new Promise(r => setTimeout(r, 0)).then(() => named(meshSync(prims, voxel)));
    const geoKey = keyOf(prims, voxel, true);
    const w = worker(geoKey);
    const p = w
      ? new Promise((resolve, reject) => {
        const id = ++pool.seq;
        pool.jobs.set(id, { resolve, reject, fallback: () => runHere().then(resolve, reject) });
        w.postMessage({ id, prims, voxel, geoKey });
      }).then(named).catch(runHere)
      : runHere();
    cache.set(key, p);
  }
  return cache.get(key);
}

function build(api, { voxel = 0.008, mats = {}, name = 'clay' } = {}) {
  // Channel names become small numbers for the core; colours are already linear
  const names = [];
  const prims = api.prims.map(p => {
    let m = names.indexOf(p.mat);
    if (m < 0) { m = names.length; names.push(p.mat); }
    return { ...p, mat: m };
  });
  const g = new THREE.Group();
  g.name = name;
  g.userData.clay = true;
  // An invisible box the size of the shapes, so the model can be measured before the mesh exists
  const b = api.bounds();
  if (!b.isEmpty()) {
    const proxy = new THREE.Mesh(new THREE.BoxGeometry(...b.getSize(new THREE.Vector3()).toArray()), new THREE.MeshBasicMaterial({ visible: false }));
    proxy.position.copy(b.getCenter(new THREE.Vector3()));
    proxy.userData.clayProxy = true;
    g.add(proxy);
  }
  g.userData.ready = meshAsync(prims, voxel, names).then(res => {
    for (const [ch, buf] of Object.entries(res)) {
      const geo = buf.geo || (buf.geo = toGeometry(buf));
      const spec = mats[ch] || mats.base || {};
      const { physical, ...params } = spec.isMaterial ? {} : spec;
      const m = spec.isMaterial ? spec.clone() : new (physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial)({ roughness: 0.6, ...params });
      m.vertexColors = true;
      const ms = new THREE.Mesh(geo, m);
      ms.castShadow = true;
      ms.receiveShadow = true;
      ms.userData.clayChannel = ch;
      g.add(ms);
    }
    for (const c of [...g.children]) if (c.userData.clayProxy) g.remove(c);
    if (g.userData.onReady) g.userData.onReady(g);
    return g;
  }).catch(err => { console.warn('clay: mesh failed', err); return g; });
  return g;
}

function toGeometry(b) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(b.pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(b.nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(b.col, 3));
  geo.setIndex(new THREE.BufferAttribute(b.idx, 1));
  geo.computeBoundingSphere();
  return geo;
}

// Resolves when every clay part inside obj has its mesh
export function clayReady(obj) {
  const list = [];
  obj.traverse(o => { if (o.userData.clay && o.userData.ready) list.push(o.userData.ready); });
  return Promise.all(list);
}
