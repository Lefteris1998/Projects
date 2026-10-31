// The champions riders can play as. Each model is built in a 1-unit-tall space (y up, facing +z),
// then scaled down to fit a tile. The rider's colour is the model's main accent colour.
import * as THREE from '/vendor/three/three.module.js';
import { clay, clayReady } from './clay.js';
import { MATS, sHead, sHand, sArm, sLeg, sShoe, darken, lighten } from './anatomy.js';

// Mesh density for sculpted (clay) parts: 'board' for pawns, lobby pictures and portraits, 'hero' for the close-up.
const VOXEL = { board: 0.011, hero: 0.0042 };
let voxel = VOXEL.board;

const TAU = Math.PI * 2;
const SKIN = '#e9b48c';
const DARK = '#1d1a22';
const WHITE = '#f4f1ea';
const GOLD = '#e8b33c';
const STEEL = '#9aa1ad';
const IRON = '#4b525d';
const LEATHER = '#5b3a24';
const WOOD = '#8a5a34';

function rng(seed) {
  let s = Math.floor(seed) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
function shade(hex, amt) {
  const c = new THREE.Color(hex);
  return '#' + c.lerp(new THREE.Color(amt < 0 ? '#000000' : '#ffffff'), Math.abs(amt)).getHexString();
}

// ---------------------------------------------------------------------------
// Procedural textures (drawn once on a canvas, shared between models)
// ---------------------------------------------------------------------------
const texCache = new Map();
function tex(key, draw, { size = 256, repeat = [1, 1], color = true } = {}) {
  const k = `${key}|${repeat.join()}`;
  if (texCache.has(k)) return texCache.get(k);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  draw(cv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(k, t);
  return t;
}

const T = {
  // Short strokes of lighter and darker hair over a base colour.
  fur: (base, repeat = [3, 3]) => tex(`fur${base}`, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    const r = rng(11);
    g.lineCap = 'round';
    for (let i = 0; i < 4200; i++) {
      const x = r() * n;
      const y = r() * n;
      const a = 1.3 + (r() - 0.5) * 0.7;
      const l = 3 + r() * 8;
      g.globalAlpha = 0.35;
      g.strokeStyle = r() < 0.55 ? shade(base, -0.15 - r() * 0.15) : shade(base, 0.1 + r() * 0.15);
      g.lineWidth = 0.8 + r() * 1.2;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      g.stroke();
    }
    g.globalAlpha = 1;
  }, { repeat }),
  // Grey-scale relief maps.
  bump: (kind, repeat = [2, 2]) => tex(`bump-${kind}`, (g, n) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, n, n);
    const r = rng(kind.length * 97);
    if (kind === 'fur') {
      for (let i = 0; i < 5000; i++) {
        const x = r() * n;
        const y = r() * n;
        const v = Math.floor(80 + r() * 120);
        g.strokeStyle = `rgb(${v},${v},${v})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (r() - 0.5) * 3, y + 4 + r() * 6);
        g.stroke();
      }
    } else if (kind === 'wrinkle') {
      for (let i = 0; i < 260; i++) {
        const y = r() * n;
        const x = r() * n;
        g.strokeStyle = `rgba(30,30,30,${0.3 + r() * 0.4})`;
        g.lineWidth = 1 + r() * 2;
        g.beginPath();
        g.moveTo(x, y);
        g.bezierCurveTo(x + 15, y + (r() - 0.5) * 8, x + 30, y + (r() - 0.5) * 8, x + 45, y);
        g.stroke();
      }
    } else {
      // 'skin' / 'rough': soft blotches
      const blobs = kind === 'rough' ? 1400 : 2600;
      for (let i = 0; i < blobs; i++) {
        const v = Math.floor(100 + r() * 60);
        g.fillStyle = `rgba(${v},${v},${v},0.5)`;
        g.beginPath();
        g.arc(r() * n, r() * n, kind === 'rough' ? 1 + r() * 4 : 0.6 + r() * 1.4, 0, TAU);
        g.fill();
      }
    }
  }, { repeat, color: false }),
  speckle: (base, amt = 0.12, repeat = [2, 2]) => tex(`speckle${base}${amt}`, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    const r = rng(5);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? shade(base, -amt * r()) : shade(base, amt * r());
      g.fillRect(r() * n, r() * n, 1 + r() * 3, 1 + r() * 3);
    }
  }, { repeat }),
  stripes: (a, b, count, repeat = [1, 1]) => tex(`stripes${a}${b}${count}`, (g, n) => {
    const h = n / count;
    for (let i = 0; i < count; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect(0, i * h, n, h);
    }
  }, { repeat }),
  vstripes: (a, b, count, repeat = [1, 1]) => tex(`vstripes${a}${b}${count}`, (g, n) => {
    const w = n / count;
    for (let i = 0; i < count; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect(i * w, 0, w, n);
    }
  }, { repeat }),
  // Overlapping rows of scales with a dark edge and a light top.
  scales: (base, repeat = [6, 6]) => tex(`scales${base}`, (g, n) => {
    g.fillStyle = shade(base, -0.35);
    g.fillRect(0, 0, n, n);
    const s = n / 8;
    for (let row = -1; row < 18; row++) {
      for (let col = -1; col < 9; col++) {
        const x = col * s + (row % 2 ? s / 2 : 0);
        const y = row * s * 0.5;
        const grad = g.createRadialGradient(x, y - s * 0.2, 1, x, y, s * 0.6);
        grad.addColorStop(0, shade(base, 0.25));
        grad.addColorStop(0.7, base);
        grad.addColorStop(1, shade(base, -0.3));
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, s * 0.55, 0, Math.PI);
        g.fill();
      }
    }
  }, { repeat }),
  wood: (base, repeat = [1, 1]) => tex(`wood${base}`, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    const r = rng(3);
    for (let i = 0; i < 70; i++) {
      const x = r() * n;
      g.strokeStyle = r() < 0.6 ? shade(base, -0.2 - r() * 0.15) : shade(base, 0.12);
      g.globalAlpha = 0.6;
      g.lineWidth = 0.6 + r() * 1.8;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= n; y += 16) g.lineTo(x + Math.sin(y * 0.03 + i) * 4, y);
      g.stroke();
    }
    g.globalAlpha = 1;
  }, { repeat }),
  knit: (base, repeat = [6, 6]) => tex(`knit${base}`, (g, n) => {
    g.fillStyle = shade(base, -0.25);
    g.fillRect(0, 0, n, n);
    const s = n / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        for (const d of [-1, 1]) {
          g.fillStyle = d < 0 ? base : shade(base, 0.1);
          g.beginPath();
          g.ellipse(x * s + s / 2 + d * s * 0.2, y * s + s / 2, s * 0.22, s * 0.48, d * 0.5, 0, TAU);
          g.fill();
        }
      }
    }
  }, { repeat }),
  plaid: (base, repeat = [3, 3]) => tex(`plaid${base}`, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    g.globalAlpha = 0.45;
    g.fillStyle = '#1b1820';
    for (let i = 0; i < 4; i++) {
      g.fillRect(i * n / 4, 0, n / 10, n);
      g.fillRect(0, i * n / 4, n, n / 10);
    }
    g.globalAlpha = 0.5;
    g.fillStyle = shade(base, 0.35);
    for (let i = 0; i < 4; i++) {
      g.fillRect(i * n / 4 + n / 6, 0, 3, n);
      g.fillRect(0, i * n / 4 + n / 6, n, 3);
    }
    g.globalAlpha = 1;
  }, { repeat }),
  checker: (base, repeat = [4, 4]) => tex(`checker${base}`, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    g.strokeStyle = shade(base, -0.4);
    g.lineWidth = 2;
    for (let i = -n; i < n * 2; i += 14) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + n, n); g.stroke();
      g.beginPath(); g.moveTo(i, n); g.lineTo(i + n, 0); g.stroke();
    }
  }, { repeat }),
  panels: (base, repeat = [2, 2]) => tex(`panels${base}`, (g, n) => {
    g.fillStyle = base;
    g.fillRect(0, 0, n, n);
    g.strokeStyle = shade(base, -0.4);
    g.lineWidth = 2;
    const r = rng(17);
    for (let i = 0; i < 9; i++) g.strokeRect(r() * n, r() * n, 30 + r() * 60, 20 + r() * 40);
    g.fillStyle = shade(base, 0.25);
    for (let i = 0; i < 40; i++) g.fillRect(r() * n, r() * n, 2, 2);
  }, { repeat }),
  runes: (glow) => tex(`runes${glow}`, (g, n) => {
    g.fillStyle = '#cfe9f5';
    g.fillRect(0, 0, n, n);
    g.strokeStyle = glow;
    g.lineWidth = 4;
    const r = rng(23);
    for (let y = 20; y < n; y += 34) {
      g.beginPath();
      g.moveTo(n / 2 - 8 + r() * 4, y);
      g.lineTo(n / 2 + 8, y + 10);
      g.lineTo(n / 2 - 6, y + 20);
      g.stroke();
    }
  }),
  // Toasted bread: a golden base, darker baked top, a few crumbs.
  bun: (repeat = [1, 1]) => tex('bun', (g, n) => {
    const grad = g.createLinearGradient(0, 0, 0, n);
    grad.addColorStop(0, '#b8732f');
    grad.addColorStop(0.45, '#e2a75e');
    grad.addColorStop(1, '#f0cf96');
    g.fillStyle = grad;
    g.fillRect(0, 0, n, n);
    const r = rng(29);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(120,70,30,0.25)' : 'rgba(255,235,190,0.25)';
      g.fillRect(r() * n, r() * n, 1 + r() * 2, 1 + r() * 2);
    }
  }, { repeat }),
};

const basic = color => new THREE.MeshBasicMaterial({ color });

// ---------------------------------------------------------------------------
// Modelling kit: smooth primitives, tapered tubes, extrusions
// ---------------------------------------------------------------------------
function kit() {
  const g = new THREE.Group();
  const M = (c, o = {}) => (c && c.isMaterial ? c : new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, ...o }));
  const put = (geo, c, pos = [0, 0, 0], o = {}) => {
    const mesh = new THREE.Mesh(geo, M(c, o.m));
    mesh.position.set(...pos);
    if (o.rot) mesh.rotation.set(...o.rot);
    if (o.scale) mesh.scale.set(...o.scale);
    mesh.castShadow = o.shadow !== false;
    mesh.receiveShadow = true;
    (o.parent || g).add(mesh);
    return mesh;
  };
  const k = {
    g, M, put,
    grp(pos = [0, 0, 0], o = {}) {
      const grp = new THREE.Group();
      grp.position.set(...pos);
      if (o.rot) grp.rotation.set(...o.rot);
      if (o.scale) grp.scale.set(...o.scale);
      (o.parent || g).add(grp);
      return grp;
    },
    sph: (r, c, pos, o = {}) => put(new THREE.SphereGeometry(r, o.seg || 32, o.seg ? Math.ceil(o.seg * 0.75) : 24, 0, TAU, o.t0 || 0, o.tl || Math.PI), c, pos, o),
    cap: (r, len, c, pos, o = {}) => put(new THREE.CapsuleGeometry(r, len, 8, o.seg || 20), c, pos, o),
    cyl: (rt, rb, h, c, pos, o = {}) => put(new THREE.CylinderGeometry(rt, rb, h, o.seg || 32, 1, !!o.open, 0, o.arc || TAU), c, pos, o),
    cone: (r, h, c, pos, o = {}) => put(new THREE.ConeGeometry(r, h, o.seg || 24), c, pos, o),
    tor: (R, t, c, pos, o = {}) => put(new THREE.TorusGeometry(R, t, o.rs || 14, o.ts || 48, o.arc || TAU), c, pos, o),
    // Rounded box: a rounded rectangle extruded with a bevel.
    rbox(w, h, d, r, c, pos, o = {}) {
      r = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
      const iw = w - 2 * r;
      const ih = h - 2 * r;
      const s = new THREE.Shape();
      s.moveTo(-iw / 2, -ih / 2); s.lineTo(iw / 2, -ih / 2); s.lineTo(iw / 2, ih / 2); s.lineTo(-iw / 2, ih / 2); s.lineTo(-iw / 2, -ih / 2);
      const geo = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-4, d - 2 * r), bevelEnabled: true, bevelThickness: r, bevelSize: r, bevelSegments: 4, curveSegments: 4 });
      geo.center();
      return put(geo, c, pos, o);
    },
    lathe: (pts, c, pos, o = {}) => put(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), o.seg || 48), c, pos, o),
    // A tube along a smooth curve whose radius can change along its length and can have ribs.
    tube(pts, r0, r1, c, o = {}) {
      const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
      const seg = o.seg || 28;
      const rad = o.radial || 18;
      const geo = new THREE.TubeGeometry(curve, seg, 1, rad, false);
      const pos = geo.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const center = curve.getPointAt(t);
        const r = o.radius ? o.radius(t) : r0 + (r1 - r0) * t;
        for (let j = 0; j <= rad; j++) {
          const idx = i * (rad + 1) + j;
          const rib = o.ribs ? 1 + o.ribs[1] * Math.cos((j / rad) * TAU * o.ribs[0]) : 1;
          v.fromBufferAttribute(pos, idx).sub(center).multiplyScalar(r * rib).add(center);
          pos.setXYZ(idx, v.x, v.y, v.z);
        }
      }
      geo.computeVertexNormals();
      const mesh = put(geo, c, [0, 0, 0], o);
      if (o.caps !== false) {
        const ends = [[0, o.radius ? o.radius(0) : r0], [1, o.radius ? o.radius(1) : r1]];
        for (const [t, r] of ends) if (r > 0.002) k.sph(r, mesh.material, curve.getPointAt(t).toArray(), { parent: o.parent, seg: 16 });
      }
      return mesh;
    },
    // Extrude a 2D outline (XY) into a slab; smooth outlines use a spline through the points.
    ext(pts, depth, c, pos, o = {}) {
      const s = new THREE.Shape();
      const v2 = pts.map(([x, y]) => new THREE.Vector2(x, y));
      s.moveTo(v2[0].x, v2[0].y);
      if (o.smooth) s.splineThru([...v2.slice(1), v2[0]]);
      else v2.slice(1).forEach(p => s.lineTo(p.x, p.y));
      const bevel = o.bevel ?? depth * 0.35;
      const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
      if (o.center !== false) geo.center();
      return put(geo, c, pos, o);
    },
    // Mesh a clay recipe into this model (one mesh per material channel; channels default to MATS presets).
    // feature: the size of the smallest thing that matters (a head's radius): its mesh gets finer to keep faces crisp.
    sculpt(C, o = {}) {
      let v = voxel * (o.res || 1);
      if (o.feature) v = Math.min(v, o.feature / (voxel <= VOXEL.hero ? 42 : 13));
      const g = C.build({ voxel: v, mats: { ...MATS, ...(o.mats || {}) }, name: o.name });
      (o.parent || k.g).add(g);
      return g;
    },
    clay,
    // Many copies of one small mesh (spines, rivets, barnacles).
    inst(geo, c, list, o = {}) {
      const mesh = new THREE.InstancedMesh(geo, M(c, o.m), list.length);
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      list.forEach(([p, r = [0, 0, 0], s = [1, 1, 1]], i) => {
        q.setFromEuler(new THREE.Euler(...r));
        m4.compose(new THREE.Vector3(...p), q, new THREE.Vector3(...s));
        mesh.setMatrixAt(i, m4);
      });
      mesh.castShadow = true;
      (o.parent || g).add(mesh);
      return mesh;
    },
  };
  return k;
}

// ---------------------------------------------------------------------------
// Shared body parts
// ---------------------------------------------------------------------------
const skinMat = (k, color, bump = 'skin', scale = 1) => k.M(color, { roughness: 0.62, bumpMap: T.bump(bump), bumpScale: scale });

// An eye looking along +z: white, iris, pupil, catch-light, and an upper lid.
// The eye's surface painted on a texture: white with soft veins of shade at the edges, an iris with radial fibres,
// a dark limbal ring, the pupil (round or a slit) and a catch-light. The front of a SphereGeometry is at u = 0.25.
const eyeTex = (iris, slit, size = 0.62) => tex(`eye${iris}${slit}${size}`, (g, n) => {
  const W = n * 2;
  g.canvas.width = W;
  g.canvas.height = n;
  const grad = g.createLinearGradient(0, 0, 0, n);
  grad.addColorStop(0, '#d9d3cc');
  grad.addColorStop(0.5, '#fbf8f3');
  grad.addColorStop(1, '#d9d3cc');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, n);
  const cx = W * 0.25;
  const cy = n / 2;
  const R = (size / Math.PI) * n; // angular radius -> pixels (same in u and v when W = 2n)
  const ir = g.createRadialGradient(cx, cy, R * 0.15, cx, cy, R);
  ir.addColorStop(0, shade(iris, 0.35));
  ir.addColorStop(0.55, iris);
  ir.addColorStop(0.88, shade(iris, -0.35));
  ir.addColorStop(1, shade(iris, -0.7));
  g.fillStyle = ir;
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  g.strokeStyle = shade(iris, 0.45);
  g.globalAlpha = 0.35;
  for (let a = 0; a < TAU; a += 0.21) {
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 0.3, cy + Math.sin(a) * R * 0.3); g.lineTo(cx + Math.cos(a + 0.05) * R * 0.85, cy + Math.sin(a + 0.05) * R * 0.85); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = '#07060a';
  g.beginPath();
  if (slit) g.ellipse(cx, cy, R * 0.16, R * 0.86, 0, 0, TAU); else g.arc(cx, cy, R * 0.42, 0, TAU);
  g.fill();
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath(); g.arc(cx - R * 0.32, cy - R * 0.36, R * 0.16, 0, TAU); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath(); g.arc(cx + R * 0.28, cy + R * 0.3, R * 0.07, 0, TAU); g.fill();
}, { size: 128, color: true });

function eye(k, parent, pos, r, o = {}) {
  const e = k.grp(pos, { parent, rot: o.rot });
  if (o.glow) {
    k.sph(r, o.white || '#f7f4ee', [0, 0, 0], { parent: e, m: { roughness: 0.12 }, seg: 20 });
    k.sph(r * 0.75, basic(o.glow), [0, 0, r * 0.4], { parent: e, scale: [1, 1, 0.65], seg: 16 });
  } else {
    const t = eyeTex(o.iris || '#6b4423', !!o.slit, o.irisSize || 0.62);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.repeat.set(1, 1);
    const m = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.04 });
    k.put(new THREE.SphereGeometry(r, 32, 20), m, [0, 0, 0], { parent: e, shadow: false });
  }
  if (o.lid) k.put(new THREE.SphereGeometry(r * 1.12, 24, 12, 0, TAU, 0, Math.PI * (o.lidAmt || 0.36)), o.lid, [0, 0, 0], { parent: e, rot: [-0.35, 0, 0] });
  return e;
}

// A sculpted head at P turned by R (see sHead in anatomy.js), meshed finer than the body so the face stays crisp.
// extra(C, r) adds hair, hats or beards in the head's own frame. Returns the head's group (for glasses, crowns...),
// with the eyes mounted unless o.eyes === false. o.eye: options for eye() (iris, glow, glowOne, slit).
function headAt(k, P, R, o, extra, parent) {
  const C = k.clay();
  let face;
  C.at(P, R, () => {
    face = sHead(C, o);
    if (extra) extra(C, o.r);
  });
  k.sculpt(C, { feature: o.r, parent });
  const hd = k.grp(P, { rot: R, parent });
  if (o.eyes !== false) {
    face.eyes.forEach((e, i) => {
      const glow = o.eye && o.eye.glow && (!o.eye.glowOne || i === 1) ? o.eye.glow : null;
      eye(k, hd, e, face.er, { iris: '#4a3020', ...(o.eye || {}), glow });
    });
  }
  hd.userData.face = face;
  return hd;
}

// A head facing +z with eyes, lids, brows, nose, ears and a mouth.
function head(k, parent, pos, o = {}) {
  const r = o.r || 0.12;
  const h = k.grp(pos, { parent, rot: o.rot });
  const skin = o.skinMat || skinMat(k, o.skin || SKIN, o.bump || 'skin', o.bumpScale ?? 1);
  k.sph(r, skin, [0, 0, 0], { parent: h, scale: o.scale || [0.96, 1.05, 1] });
  k.sph(r * 0.78, skin, [0, -r * 0.38, r * 0.16], { parent: h, scale: o.jaw || [1.05, 0.82, 0.98] });
  const ey = o.eyeY ?? r * 0.1;
  const gap = o.eyeGap ?? r * 0.38;
  const er = o.eyeR ?? r * 0.2;
  const ez = Math.sqrt(Math.max(0, r * r - gap * gap - ey * ey)) * 0.92;
  for (const s of [-1, 1]) {
    const glow = o.glow && (o.glowOne ? s === 1 : true) ? o.glow : null;
    eye(k, h, [s * gap, ey, ez], er, { iris: o.iris, lid: o.lid === false ? null : skin, lidAmt: o.lidAmt, glow, white: o.eyeWhite, rot: [0, s * 0.12, 0] });
    if (o.liner) k.tube([[s * gap * 0.55, ey + er * 0.2, ez + er * 0.8], [s * gap * 1.45, ey + er * 0.3, ez - er * 0.1], [s * gap * 1.85, ey + er * 0.8, ez - er * 0.6]], er * 0.14, er * 0.05, o.liner, { parent: h, seg: 10, radial: 8 });
    if (o.brows) k.tube([[s * gap * 0.45, ey + er * 1.45, ez + er * 0.55], [s * gap, ey + er * 1.85, ez + er * 0.35], [s * gap * 1.55, ey + er * 1.55, ez - er * 0.4]], o.browR || r * 0.05, (o.browR || r * 0.05) * 0.6, o.brows, { parent: h, seg: 10, radial: 8 });
    if (o.ears !== false) {
      k.sph(r * 0.25, skin, [s * r * 0.95, -r * 0.05, -r * 0.05], { parent: h, scale: [0.4, 1, 0.75] });
      k.sph(r * 0.12, shade(o.skin || SKIN, -0.2), [s * r * 1.02, -r * 0.05, -r * 0.02], { parent: h, scale: [0.3, 1, 0.7] });
    }
  }
  if (o.nose !== false) {
    k.sph(r * 0.16, skin, [0, -r * 0.14, r * 1.0], { parent: h, scale: o.noseScale || [0.85, 1, 1.05] });
    for (const s of [-1, 1]) k.sph(r * 0.08, skin, [s * r * 0.1, -r * 0.2, r * 0.96], { parent: h });
  }
  if (o.mouth !== false) {
    k.tube([[-r * 0.24, -r * 0.46, r * 0.86], [0, -r * (o.frown ? 0.44 : 0.53), r * 0.95], [r * 0.24, -r * 0.46, r * 0.86]], r * 0.035, r * 0.035, o.lips || '#8a3b3b', { parent: h, seg: 12, radial: 8 });
  }
  return h;
}

// A hand at the end of an arm. Fingers point along -y; a fist is a rounded lump with knuckles.
function hand(k, parent, pos, s, mat, o = {}) {
  const h = k.grp(pos, { parent, rot: o.rot });
  k.sph(0.032 * s, mat, [0, -0.018 * s, 0], { parent: h, scale: [0.75, 1, 1.05], seg: 16 });
  if (o.fist) {
    k.sph(0.033 * s, mat, [0, -0.045 * s, 0.006 * s], { parent: h, scale: [0.9, 0.8, 1.1], seg: 16 });
    for (let i = 0; i < 4; i++) k.sph(0.01 * s, mat, [0.022 * s, -0.05 * s, (i - 1.5) * 0.016 * s], { parent: h, seg: 8 });
  } else {
    for (let i = 0; i < 4; i++) k.cap(0.0085 * s, 0.03 * s, mat, [0, -0.062 * s, (i - 1.5) * 0.016 * s], { parent: h, rot: [(i - 1.5) * 0.1, 0, 0], seg: 10 });
  }
  k.cap(0.0095 * s, 0.024 * s, mat, [0.012 * s, -0.035 * s, 0.03 * s], { parent: h, rot: [0.7, 0, 0.3], seg: 10 });
  return h;
}

// Arm from shoulder through elbow to wrist, with a sleeve colour and a hand.
function arm(k, parent, pts, r0, r1, sleeve, skin, o = {}) {
  k.tube(pts, r0, r1, sleeve, { parent, seg: 20, radial: 16 });
  const w = pts[pts.length - 1];
  if (o.cuff) k.tor(r1 * 1.05, r1 * 0.35, o.cuff, w, { parent, rot: o.cuffRot || [Math.PI / 2, 0, 0], rs: 10, ts: 24 });
  if (o.hand !== false) return hand(k, parent, w, o.handScale || 1.3, skin, { fist: o.fist !== false, rot: o.handRot });
  return null;
}

function boot(k, parent, pos, mat, o = {}) {
  const b = k.grp(pos, { parent, rot: o.rot });
  const h = o.h || 0.1;
  k.cyl(0.045, 0.05, h, mat, [0, h / 2 + 0.01, 0], { parent: b });
  k.sph(0.052, mat, [0, 0.035, 0.035], { parent: b, scale: [0.95, 0.68, 1.55] });
  k.rbox(0.1, 0.02, 0.17, 0.007, o.sole || '#2a2420', [0, 0.01, 0.025], { parent: b });
  if (o.cuff) k.tor(0.05, 0.016, o.cuff, [0, h + 0.01, 0], { parent: b, rot: [Math.PI / 2, 0, 0] });
  return b;
}

// A cape / cloak hanging from the shoulders, wrapped around the back, with folds.
function capeGeo(width, height, radius, flare, folds = 9) {
  const geo = new THREE.PlaneGeometry(width, height, 36, 20);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const t = (height / 2 - y) / height; // 0 at the shoulders, 1 at the hem
    const a = (x / (width / 2)) * 1.35;
    const R = radius + t * flare + Math.sin(a * folds) * 0.012 * t;
    p.setXYZ(i, Math.sin(a) * R, y, -Math.cos(a) * R);
  }
  geo.computeVertexNormals();
  return geo;
}

// A robe wrapped around the torso, open down the front. radius(t) and gap(t) (the angle left open
// at the front, in radians) are given from the hem (t = 0) to the neckline (t = 1).
function openRobeGeo(y0, y1, radius, gap, depth = 0.78) {
  const geo = new THREE.PlaneGeometry(1, 1, 48, 16);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5;
    const t = p.getY(i) + 0.5;
    const g = gap(t);
    const a = g / 2 + u * (TAU - g);
    const R = radius(t) + Math.sin(a * 7) * 0.004 * (1 - t);
    p.setXYZ(i, Math.sin(a) * R, y0 + (y1 - y0) * t, Math.cos(a) * R * depth);
  }
  geo.computeVertexNormals();
  return geo;
}

// ---------------------------------------------------------------------------
// Champions
// ---------------------------------------------------------------------------
export const CHAMPIONS = {
  camel: {
    name: 'Riico', mythic: true, blurb: 'MYTHIC. The original. Rides in, T-bags, rides out.',
    build(c) {
      const k = kit();
      const sand = '#c99a5b';
      const cam = k.grp([0, 0, 0], { rot: [0, -0.55, 0] });
      const C = k.clay();
      // Sandy fur: lighter belly and legs, darker along the back, fine grain
      const fur = {
        color: sand, mat: 'fur', bump: [0.0022, 95],
        tint: [{ t: 'noise', a: 0.1, f: 11 }, { t: 'grad', ax: [0, -1, 0], a0: -0.62, a1: -0.42, c: '#e6c48e', amt: 0.6 }, { t: 'grad', ax: [0, 1, 0], a0: 0.68, a1: 0.82, c: darken(sand, 0.22), amt: 0.7 }],
      };
      const pad = { color: darken(sand, 0.42), mat: 'leather', bump: [0.0015, 120] };

      // Barrel body, chest, rump, belly and the hump
      C.ell([0, 0.6, 0], [0.3, 0.165, 0.155], { ...fur, k: 0 });
      C.ell([0, 0.545, 0], [0.24, 0.12, 0.14], { ...fur, k: 0.06 });
      C.ell([0.235, 0.585, 0], [0.12, 0.14, 0.125], { ...fur, k: 0.07 });
      C.ell([-0.235, 0.61, 0], [0.11, 0.13, 0.13], { ...fur, k: 0.07 });
      C.ell([-0.03, 0.735, 0], [0.165, 0.14, 0.115], { ...fur, k: 0.09 });
      // Long legs: muscled tops, knobbly knees, thin shins, wide split pads
      for (const [x, z, back] of [[0.22, 0.095, 0], [0.22, -0.095, 0], [-0.22, 0.1, 1], [-0.22, -0.1, 1]]) {
        if (back) C.ell([x - 0.01, 0.5, z * 0.9], [0.075, 0.12, 0.055], { ...fur, k: 0.05 });
        else C.ell([x + 0.01, 0.5, z * 0.85], [0.055, 0.1, 0.05], { ...fur, k: 0.05 });
        C.limb([[x, 0.48, z], [x + (back ? -0.025 : 0.012), 0.37, z], [x, 0.28, z], [x + 0.008, 0.16, z], [x + 0.012, 0.06, z]], [0.048, 0.035, 0.03, 0.022, 0.024], { ...fur, k: 0.02 });
        C.ball([x + 0.006, 0.28, z], 0.031, { ...fur, k: 0.012 });
        C.ell([x + 0.022, 0.026, z], [0.05, 0.026, 0.043], { ...pad, k: 0.02 });
        C.box([x + 0.06, 0.03, z], [0.04, 0.06, 0.006], 0.002, { ...pad, op: 'sub', k: 0.004 });
      }
      // Neck in a lazy S, the head on top
      C.limb([[0.27, 0.64, 0], [0.4, 0.6, 0], [0.51, 0.7, 0], [0.54, 0.9, 0]], [0.1, 0.072, 0.062, 0.052], { ...fur, k: 0.06, seg: 12 });
      C.ell([0.42, 0.57, 0], [0.06, 0.04, 0.05], { ...fur, k: 0.04 }); // throat
      const H = [0.57, 0.98, 0];
      let eyes;
      C.at(H, [0, 0, 0], () => {
        C.ell([0, 0, 0], [0.082, 0.064, 0.06], { ...fur, k: 0.03 });
        C.ell([0.085, -0.024, 0], [0.085, 0.046, 0.044], { ...fur, k: 0.04 });
        // heavy, drooping upper lip split in the middle, a soft lower lip, a sly little grin
        C.ell([0.158, -0.048, 0], [0.04, 0.032, 0.042], { ...fur, k: 0.02 });
        C.box([0.19, -0.05, 0], [0.03, 0.035, 0.005], 0.002, { ...fur, op: 'sub', k: 0.006, color: darken(sand, 0.4), paint: true });
        C.ell([0.145, -0.08, 0], [0.042, 0.018, 0.032], { ...fur, k: 0.016 });
        C.limb([[0.1, -0.066, -0.04], [0.15, -0.068, 0], [0.1, -0.066, 0.04]], [0.003, 0.0045, 0.003], { op: 'sub', k: 0.004, color: '#3a2216', paint: true });
        for (const s of [-1, 1]) {
          // slit nostrils
          C.ell([0.178, -0.02, s * 0.022], [0.012, 0.004, 0.009], { op: 'sub', k: 0.004, rot: [s * 0.6, 0, 0.3], color: '#2a1d17', paint: true });
          // brow bulge, sleepy eyelids, ears
          C.ell([0.03, 0.034, s * 0.04], [0.035, 0.016, 0.022], { ...fur, k: 0.02 });
          const e = [0.032, 0.02, s * 0.054];
          C.ball(e, 0.019, { ...fur, op: 'sub', k: 0.006 });
          C.ball(e, 0.0185, { ...fur, k: 0.005, clip: [[e[0], e[1] + 0.002, e[2]], [-0.25, -1, 0], 0.002] });
          C.limb([[-0.035, 0.05, s * 0.042], [-0.048, 0.08, s * 0.058]], [0.016, 0.006], { ...fur, k: 0.012 });
        }
        eyes = [[0.032, 0.02, -0.054], [0.032, 0.02, 0.054]];
      }, 1);
      // Tail with a dark tuft
      C.limb([[-0.31, 0.65, 0], [-0.36, 0.55, 0], [-0.36, 0.43, 0.01]], [0.022, 0.014, 0.01], { ...fur, k: 0.02 });
      C.ell([-0.36, 0.4, 0.01], [0.02, 0.042, 0.02], { color: darken(sand, 0.5), mat: 'fur', bump: [0.004, 90], k: 0.01 });

      // Saddle blanket in the rider's colour, draped over the hump with a striped weave and a fold at the hem
      C.ell([-0.03, 0.745, 0], [0.205, 0.165, 0.138], {
        color: c, mat: 'cloth', k: 0.004, bump: [0.0012, 140],
        tint: [{ t: 'stripes', ax: [1, 0, 0], f: 9, c: darken(c, 0.35), w: 0.55, soft: 0.15 }, { t: 'stripes', ax: [1, 0, 0], f: 18, c: '#f3d27a', w: 0.93, soft: 0.1, amt: 0.8 }],
        clip: [[0, 0.67, 0], [0, -1, 0], 0.01], disp: { t: 'folds', ax: [1, 0, 0], f: 60, a: 0.002 },
      });
      k.sculpt(C, { parent: cam });

      // Eyes with long lashes
      const hd = k.grp(H, { parent: cam });
      k.g.userData.face = hd;
      for (const [i, e] of eyes.entries()) {
        const s = i ? 1 : -1;
        eye(k, hd, e, 0.016, { iris: '#3a2214', rot: [0, s > 0 ? 0.6 : Math.PI - 0.6, 0] });
        for (let l = 0; l < 5; l++) k.cyl(0.0011, 0.0006, 0.016, DARK, [0.03 + (l - 2) * 0.006, 0.033, s * 0.068], { parent: hd, rot: [s * 0.9, 0, -0.35 + (l - 2) * 0.08], seg: 4 });
      }
      // Bridle and reins, saddle, fringe of gold tassels on the blanket
      k.tor(0.058, 0.007, c, [0.1, -0.02, 0], { parent: hd, rot: [0, Math.PI / 2, 0], rs: 8, ts: 32 });
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * TAU;
        const x = -0.03 + Math.cos(a) * 0.205 * 0.87;
        const z = Math.sin(a) * 0.138 * 0.87;
        k.cyl(0.0025, 0.0025, 0.035, GOLD, [x, 0.655, z], { parent: cam, seg: 6 });
        k.sph(0.007, GOLD, [x, 0.635, z], { parent: cam, seg: 8 });
      }
      k.tor(0.07, 0.018, LEATHER, [-0.03, 0.915, 0], { parent: cam, rot: [Math.PI / 2, 0, 0] });
      k.cyl(0.075, 0.08, 0.025, shade(LEATHER, 0.1), [-0.03, 0.915, 0], { parent: cam });
      k.cyl(0.012, 0.016, 0.08, LEATHER, [0.06, 0.955, 0], { parent: cam });

      // The rider, facing along the camel (+x)
      const RP = [-0.04, 0.94, 0];
      const RR = [0, Math.PI / 2, 0];
      const R = k.clay();
      const robe = { color: WHITE, mat: 'cloth', bump: [0.001, 120], tint: { t: 'noise', a: 0.05, f: 20 } };
      const skinC = '#c98e64';
      let face;
      R.at(RP, RR, () => {
        // Robe: seated body, sash in the rider's colour, legs straddling the saddle, boots
        R.cone([0, 0.02, 0], [0, 0.2, 0], 0.088, 0.075, { ...robe, k: 0.02, disp: { t: 'ribs', n: 9, a: 0.004 } });
        R.ell([0, 0.19, -0.005], [0.085, 0.05, 0.06], { ...robe, k: 0.04 });
        R.torus([0, 0.065, 0], 0.083, 0.014, { color: c, mat: 'cloth', k: 0.004, tint: { t: 'stripes', ax: [0, 1, 0], f: 90, c: darken(c, 0.3), w: 0.6 } });
        for (const s of [-1, 1]) {
          R.limb([[s * 0.055, 0.04, 0.02], [s * 0.15, 0.0, 0.1], [s * 0.17, -0.12, 0.12]], [0.04, 0.032, 0.027], { ...robe, k: 0.025 });
          R.at([s * 0.17, -0.15, 0.125], [0, 0, 0], () => {
            R.ell([0, 0, 0.012], [0.026, 0.024, 0.04], { color: LEATHER, mat: 'leather', k: 0.01 });
          });
          // arms reaching forward for the reins, hands in fists
          R.limb([[s * 0.075, 0.2, 0], [s * 0.1, 0.125, 0.06], [s * 0.05, 0.13, 0.15]], [0.028, 0.023, 0.02], { ...robe, k: 0.02 });
          R.at([s * 0.05, 0.13, 0.155], [Math.PI / 2, 0, s * -0.3], () => sHand(R, { s: 0.85, skin: skinC, fist: true, side: -s }));
        }
      });
      k.sculpt(R, { parent: cam });
      // Head and keffiyeh: the cloth hoods the head and falls behind the neck, held on by a black agal
      const Hd = k.clay();
      Hd.at(RP, RR, () => Hd.at([0, 0.31, 0], [0, 0, 0], () => {
        face = sHead(Hd, { r: 0.068, skin: skinC, brows: '#1e140c', browR: 0.0035, mouth: 'smirk', nose: 'broad', jaw: 1.05, lids: 0.42 });
        const cloth = { ...robe, k: 0.004, bump: [0.0006, 260] };
        Hd.ell([0, 0.02, -0.02], [0.08, 0.085, 0.085], { ...cloth, clip: [[0, 0.03, 0.032], [0, -0.35, 1], 0.003] });
        Hd.limb([[0, 0.0, -0.06], [0, -0.07, -0.09], [0, -0.14, -0.08]], [0.065, 0.055, 0.04], { ...cloth, k: 0.02 });
        for (const s of [-1, 1]) Hd.limb([[s * 0.074, 0.01, 0.0], [s * 0.078, -0.06, -0.015], [s * 0.07, -0.12, -0.015]], [0.016, 0.017, 0.012], { ...cloth, k: 0.015 });
        Hd.torus([0, 0.052, -0.012], 0.077, 0.0065, { color: '#141217', mat: 'cloth', k: 0.002, rot: [-0.2, 0, 0] });
      }));
      k.sculpt(Hd, { parent: cam, feature: 0.068 });
      const rd = k.grp(RP, { parent: cam, rot: RR });
      const rh = k.grp([0, 0.31, 0], { parent: rd });
      for (const e of face.eyes) eye(k, rh, e, face.er, { iris: '#2a1a10' });
      // Reins from the rider's hands to the bridle
      for (const s of [-1, 1]) k.tube([[0.11, 1.07, s * 0.05], [0.35, 0.94, s * 0.06], [0.64, 0.97, s * 0.05]], 0.003, 0.003, LEATHER, { parent: cam, caps: false });
      return k.g;
    },
  },

  cactus: {
    name: 'COCKtus', blurb: 'Stands still. Hurts to T-bag.',
    build(c) {
      const k = kit();
      const green = '#4f9a55';
      const C = k.clay();
      // Waxy green skin: darker in the grooves between the ribs, a little lighter toward the tips
      const skin = {
        color: green, mat: 'plant', bump: [0.0012, 120],
        tint: [{ t: 'noise', a: 0.1, f: 14 }, { t: 'grad', ax: [0, 1, 0], a0: 0.75, a1: 1.0, c: '#7cc06a', amt: 0.45 }],
      };
      const ribs = { t: 'ribs', n: 10, a: 0.011, sharp: 0.65 };

      // Terracotta pot: tapered body, thick rolled rim, a painted band with dots, soil with pebbles
      const clayC = { color: '#c8653c', mat: 'clayPot', bump: [0.0012, 90], tint: [{ t: 'noise', a: 0.12, f: 10 }, { t: 'grad', ax: [0, 1, 0], a0: 0.0, a1: 0.18, c: '#d97a4f', amt: 0.5 }] };
      // (a rounded cone ends in hemispheres: cut them off flat at the rim and the floor)
      C.cone([0, 0.015, 0], [0, 0.2, 0], 0.168, 0.205, { ...clayC, k: 0, clip: [[0, 0.21, 0], [0, 1, 0], 0.004] });
      C.plane([0, 0, 0], [0, -1, 0], { k: 0.004 });
      C.cyl([0, 0.012, 0], 0.168, 0.024, 0.01, { ...clayC, k: 0.01 });
      C.cyl([0, 0.232, 0], 0.243, 0.058, 0.022, { ...clayC, k: 0.012 });
      C.cyl([0, 0.27, 0], 0.212, 0.06, 0.008, { ...clayC, op: 'sub', k: 0.01 });
      C.torus([0, 0.115, 0], 0.192, 0.011, { color: c, mat: 'gloss', k: 0.004 });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        C.ball([Math.cos(a) * 0.197, 0.152, Math.sin(a) * 0.197], 0.011, { color: c, mat: 'gloss', k: 0.003 });
      }
      C.cyl([0, 0.236, 0], 0.214, 0.02, 0.006, { color: '#4a3226', mat: 'clayPot', k: 0.008, bump: [0.003, 80], tint: { t: 'noise', a: 0.3, f: 40 } });
      const r = rng(31);
      for (let i = 0; i < 9; i++) {
        const a = r() * TAU;
        const d = 0.14 + r() * 0.06;
        C.ell([Math.cos(a) * d, 0.247, Math.sin(a) * d], [0.012 + r() * 0.008, 0.007, 0.011 + r() * 0.006], { color: shade('#9a9086', r() * 0.3 - 0.15), mat: 'clayPot', k: 0.003 });
      }

      k.sculpt(C);
      const P = k.clay();
      // Ribbed stem with a domed top, rising out of the soil
      P.cyl([0, 0.6, 0], 0.122, 0.74, 0.11, { ...skin, k: 0.015, disp: ribs });
      // Two arms: out sideways, an elbow, then up, each with its own ribs
      for (const [s, y0, R, top] of [[-1, 0.48, 0.064, 0.82], [1, 0.6, 0.056, 0.86]]) {
        const x = s * (s < 0 ? 0.27 : 0.24);
        P.limb([[s * 0.08, y0, 0], [s * 0.19, y0 + 0.01, 0], [x, y0 + 0.08, 0]], [R * 0.95, R, R], { ...skin, k: 0.03 });
        P.cyl([x, (y0 + 0.07 + top) / 2, 0], R, top - y0 - 0.07, R * 0.92, { ...skin, k: 0.02, disp: { ...ribs, a: 0.007 } });
      }
      // Bud on the left arm, the flower on top: soft petals around a fuzzy yellow centre
      P.ell([-0.27, 0.84, 0], [0.018, 0.026, 0.018], { color: lighten(c, 0.2), mat: 'plant', k: 0.008 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        P.ell([Math.cos(a) * 0.036, 0.975, Math.sin(a) * 0.036], [0.034, 0.009, 0.02], { color: c, mat: 'plant', k: 0.004, rot: [0, -a, 0.35], tint: { t: 'grad', ax: [0, 1, 0], a0: 0.96, a1: 0.99, c: lighten(c, 0.35), amt: 0.6 } });
      }
      P.ell([0, 0.985, 0], [0.022, 0.012, 0.022], { color: '#ffd34d', mat: 'fur', k: 0.006, bump: [0.002, 600] });

      // Face carved into the stem: sockets for the eyes, rosy cheeks, a little smile
      for (const s of [-1, 1]) {
        P.ball([s * 0.045, 0.66, 0.122], 0.026, { ...skin, op: 'sub', k: 0.006 });
        P.ball([s * 0.045, 0.66, 0.122], 0.028, { ...skin, k: 0.004, clip: [[s * 0.045, 0.675, 0.122], [0, -1, -0.3], 0.002] });
        P.ell([s * 0.076, 0.616, 0.12], [0.02, 0.012, 0.008], { color: '#e88a8a', mat: 'plant', k: 0.008 });
      }
      P.limb([[-0.03, 0.607, 0.13], [0, 0.596, 0.134], [0.03, 0.607, 0.13]], [0.003, 0.0045, 0.003], { op: 'sub', k: 0.004, color: '#203018', paint: true });
      k.sculpt(P);
      for (const s of [-1, 1]) eye(k, k.g, [s * 0.045, 0.66, 0.122], 0.025, { iris: '#2f1e14', rot: [0, s * 0.3, 0] });
      k.g.userData.face = k.grp([0, 0.64, 0.1]);

      // White fuzzy areoles with spines along the ridges
      const fuzz = [];
      const spines = [];
      const ridge = (cx, cz, R, y0, y1, step, phase) => {
        for (let rib = 0; rib < 10; rib++) {
          const a = (rib / 10) * TAU;
          for (let y = y0; y < y1; y += step) {
            const rr = R + 0.012;
            const p = [cx + Math.cos(a) * rr, y + (rib % 2) * step * 0.5 + phase, cz + Math.sin(a) * rr];
            fuzz.push([p, [0, 0, 0], [1, 1, 1]]);
            for (let sp = 0; sp < 3; sp++) {
              const sa = a + (sp - 1) * 0.5;
              spines.push([[p[0] + Math.cos(sa) * 0.012, p[1] + (sp - 1) * 0.008, p[2] + Math.sin(sa) * 0.012], [0, -sa, Math.PI / 2 + (sp - 1) * 0.3], [1, 1, 1]]);
            }
          }
        }
      };
      ridge(0, 0, 0.122, 0.3, 0.9, 0.055, 0);
      ridge(-0.27, 0, 0.064, 0.6, 0.79, 0.05, 0);
      ridge(0.24, 0, 0.056, 0.72, 0.83, 0.05, 0);
      k.inst(new THREE.SphereGeometry(0.0075, 8, 6), '#f3efe0', fuzz.filter(([p]) => !(p[2] > 0.08 && Math.abs(p[0]) < 0.11 && p[1] > 0.58 && p[1] < 0.7)), { m: { roughness: 1 } });
      k.inst(new THREE.ConeGeometry(0.0022, 0.028, 5), '#efe6c8', spines.filter(([p]) => !(p[2] > 0.08 && Math.abs(p[0]) < 0.11 && p[1] > 0.58 && p[1] < 0.7)));
      return k.g;
    },
  },

  mrx: {
    name: 'Mr. X', blurb: 'Hands in pockets. Already three moves ahead of your T-bag.',
    build(c) {
      const k = kit();
      const SKIN_FAIR = '#efcdb6';
      const suitC = '#f1efe9';
      const C = k.clay();
      const suit = { color: suitC, mat: 'cloth', bump: [0.0008, 160], tint: { t: 'noise', a: 0.03, f: 30 } };
      const shirt = { color: '#fbfbf8', mat: 'cloth', bump: [0.0005, 200] };
      const red = '#d3172b';

      // Polished white shoes; weight on the right leg, the left kicked out a little
      C.at([0.058, 0, 0.005], [0, 0.1, 0], () => sShoe(C, { color: '#efece6', sole: '#c9c3b8', mat: 'gloss', w: 0.95 }));
      C.at([-0.1, 0, 0.012], [0, -0.3, 0], () => sShoe(C, { color: '#efece6', sole: '#c9c3b8', mat: 'gloss', w: 0.95 }));
      // Slim trousers with a front crease and a soft break over the shoes
      for (const [a, b, f] of [[[0.055, 0.5, 0], [0.057, 0.27, 0.006], [0.058, 0.05, 0.006]], [[-0.055, 0.5, 0], [-0.08, 0.27, 0.035], [-0.1, 0.05, 0.014]]].map(p => p)) {
        sLeg(C, [a, b, f], [0.046, 0.039, 0.036], { ...suit, k: 0.01, knee: false });
        C.limb([[a[0], a[1] - 0.04, a[2] + 0.04], [b[0], b[1], b[2] + 0.034], [f[0], f[1] + 0.03, f[2] + 0.032]], [0.004, 0.004, 0.003], { ...suit, k: 0.012 }); // front crease
      }
      C.ell([0, 0.475, 0], [0.105, 0.075, 0.08], { ...suit, k: 0.03 });

      // Shirt underneath: chest and collar
      C.ell([0, 0.65, 0.0], [0.104, 0.165, 0.08], { ...shirt, k: 0.03 });
      C.cone([0, 0.79, 0.0], [0, 0.865, -0.004], 0.044, 0.04, { ...shirt, k: 0.012 });
      // The jacket: two tailored panels (slim waist, broad shoulders) that stop along a V down to the one button
      for (const s of [-1, 1]) {
        const V = { clip: [[0, 0.535, 0], [-s, 0.27, 0], 0.004] }; // keep the side of the V away from the middle
        C.ell([0, 0.6, 0], [0.12, 0.17, 0.087], { ...suit, k: 0.006, ...V });
        C.ell([0, 0.715, -0.004], [0.132, 0.085, 0.088], { ...suit, k: 0.05, ...V });
        C.ell([s * 0.118, 0.755, -0.006], [0.058, 0.04, 0.062], { ...suit, k: 0.04 });
        C.ell([0, 0.47, 0.03], [0.118, 0.06, 0.072], { ...suit, k: 0.03, ...V });
        // the lapel rolled along the V's edge
        C.limb([[s * 0.004, 0.54, 0.084], [s * 0.03, 0.64, 0.088], [s * 0.056, 0.73, 0.083], [s * 0.05, 0.79, 0.062]], [0.004, 0.006, 0.008, 0.005], { ...suit, k: 0.014 });
        // sleeves down into the trouser pockets
        sArm(C, [[s * 0.13, 0.755, 0], [s * 0.165, 0.61, -0.035], [s * 0.12, 0.49, 0.03]], [0.037, 0.032, 0.03], { ...suit, k: 0.02 });
        C.ell([s * 0.112, 0.47, 0.04], [0.012, 0.03, 0.016], { ...suit, op: 'sub', k: 0.006, color: darken(suitC, 0.3), paint: true, rot: [0, 0, s * 0.3] }); // pocket opening
      }
      k.sculpt(C);
      // Red cuffs peeking out of the pockets, a slim red tie with a shiny X clip, the button and a pocket square
      const redM = k.M(red, { roughness: 0.35 });
      const metal = k.M('#d9dde3', { roughness: 0.15, metalness: 1 });
      for (const s of [-1, 1]) k.tor(0.026, 0.007, redM, [s * 0.12, 0.49, 0.03], { rot: [Math.PI / 2 + 0.4, s * 0.3, 0], rs: 8, ts: 24 });
      k.sph(0.011, redM, [0, 0.79, 0.04], { scale: [1, 1.15, 0.8], seg: 14 });
      const tie = k.grp([0, 0.775, 0.058], { rot: [-0.2, 0, 0] });
      k.ext([[-0.009, 0], [0.009, 0], [0.014, -0.222], [0, -0.238], [-0.014, -0.222]], 0.003, redM, [0, 0, 0], { parent: tie, center: false, bevel: 0.001 });
      for (const a of [0.6, -0.6]) k.rbox(0.026, 0.005, 0.003, 0.0015, metal, [0, -0.11, 0.006], { parent: tie, rot: [0, 0, a] });
      k.sph(0.006, '#dcd8d0', [0, 0.535, 0.09], { scale: [1, 1, 0.5], seg: 10 });
      k.ext([[-0.018, 0], [0.018, 0], [0.012, 0.022], [0.002, 0.012], [-0.01, 0.026]], 0.004, k.M(c, { roughness: 0.4 }), [-0.072, 0.7, 0.09], { rot: [0, -0.5, 0], bevel: 0.001 });

      // Angular face, calm smug smirk, head tilted; white hair slicked straight back
      const r = 0.062;
      const HP = [0, 0.905, 0.008];
      const HR = [0.03, -0.1, -0.1];
      const Hd = k.clay();
      let face;
      const hair = { color: '#eceef3', mat: 'hair', k: r * 0.06, disp: { t: 'folds', ax: [1, 0, 0], f: 1 / (r * 0.05), a: r * 0.012 } };
      Hd.at(HP, HR, () => {
        face = sHead(Hd, { r, skin: SKIN_FAIR, neck: 0.78, jaw: 0.88, chin: 1.25, nose: 'fine', mouth: 'smirk', brows: '#e4e6ea', browR: r * 0.04, browArch: 0.6, lids: 0.3 });
        Hd.ell([0, r * 0.18, -r * 0.1], [r * 0.98, r * 0.92, r * 1.04], { ...hair, clip: [[0, r * 0.55, r * 0.55], [0, -0.45, 1], r * 0.03] });
        Hd.ell([0, r * 0.62, -r * 0.05], [r * 0.85, r * 0.42, r * 0.95], { ...hair, k: r * 0.25, clip: [[0, r * 0.55, r * 0.55], [0, -0.45, 1], r * 0.03] });
        // two loose strands falling over the forehead
        Hd.limb([[r * 0.12, r * 0.86, r * 0.5], [r * 0.24, r * 0.7, r * 0.86], [r * 0.32, r * 0.42, r * 1.0]], [r * 0.07, r * 0.045, r * 0.012], { ...hair, k: r * 0.04, disp: null });
        Hd.limb([[r * 0.3, r * 0.84, r * 0.48], [r * 0.4, r * 0.66, r * 0.86], [r * 0.43, r * 0.48, r * 0.96]], [r * 0.05, r * 0.03, r * 0.01], { ...hair, k: r * 0.03, disp: null });
      });
      k.sculpt(Hd, { feature: r });
      const hd = k.grp(HP, { rot: HR });
      k.g.userData.face = hd;
      for (const e of face.eyes) eye(k, hd, e, face.er, { iris: '#4a4d55' });

      // Square glasses: thin metal frames, tinted orange-gold lenses
      const lens = new THREE.MeshPhysicalMaterial({ color: '#ffa52e', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.55, emissive: '#c46a00', emissiveIntensity: 0.25 });
      const [gx, gy, gz, lw, lh, ft] = [r * 0.38, r * 0.07, r * 0.98, r * 0.36, r * 0.27, r * 0.022];
      for (const s of [-1, 1]) {
        const gl = k.grp([s * gx, gy, gz], { parent: hd, rot: [0, s * 0.15, 0] });
        k.rbox(lw, lh, r * 0.02, r * 0.01, lens, [0, 0, 0], { parent: gl, shadow: false });
        for (const y of [-1, 1]) k.cyl(ft, ft, lw + ft * 2, metal, [0, y * lh / 2, 0], { parent: gl, rot: [0, 0, Math.PI / 2], seg: 6 });
        for (const x of [-1, 1]) k.cyl(ft, ft, lh, metal, [x * lw / 2, 0, 0], { parent: gl, seg: 6 });
        k.tube([[s * (gx + lw / 2 + r * 0.02), gy + lh * 0.3, gz - r * 0.08], [s * r * 0.92, gy + lh * 0.2, r * 0.3], [s * r * 0.94, gy - r * 0.05, -r * 0.2]], ft, ft, metal, { parent: hd, seg: 10, radial: 6 });
      }
      k.cyl(ft, ft, gx * 2 - lw, metal, [0, gy + lh * 0.15, gz + r * 0.02], { parent: hd, rot: [0, 0, Math.PI / 2], seg: 6 });
      return k.g;
    },
  },

  viking: {
    name: 'Torb', blurb: 'Raids your tiles, takes your aura.',
    build(c) {
      const k = kit();
      const SK = '#e0a582';
      const C = k.clay();
      const skin = { color: SK, mat: 'skin', bump: [0.0008, 120] };
      const tunic = { color: c, mat: 'cloth', bump: [0.001, 110], tint: { t: 'noise', a: 0.08, f: 18 } };
      const furC = '#7c7268';
      const fur = { color: furC, mat: 'fur', bump: [0.006, 45], tint: [{ t: 'noise', a: 0.18, f: 30 }, { t: 'mix', c: '#a59b90', f: 22, th: 0.6, amt: 0.6 }] };
      const leather = { color: LEATHER, mat: 'leather', bump: [0.0008, 120] };

      // Boots with fur cuffs; trousers criss-crossed with leather wraps
      for (const s of [-1, 1]) {
        C.at([s * 0.075, 0, 0], [0, s * 0.15, 0], () => sShoe(C, { color: '#4e3424', sole: '#1f1712', h: 0.13, w: 1.12, mat: 'leather' }));
        C.torus([s * 0.075, 0.13, 0], 0.05, 0.018, { ...fur, k: 0.01 });
        sLeg(C, [[s * 0.075, 0.43, 0], [s * 0.08, 0.27, 0.012], [s * 0.075, 0.14, 0]], [0.06, 0.05, 0.046], {
          color: '#4b4a52', mat: 'cloth', k: 0.015, bump: [0.0008, 120],
          tint: [{ t: 'stripes', ax: [0.6, 1, 0], f: 34, c: LEATHER, w: 0.75, soft: 0.12 }, { t: 'stripes', ax: [-0.6, 1, 0], f: 34, c: LEATHER, w: 0.75, soft: 0.12 }],
        });
      }
      // Tunic over a proud belly, with the hem flaring into folds; a belt with a pouch
      C.limb([[0, 0.3, 0], [0, 0.52, 0], [0, 0.73, 0]], [0.18, 0.17, 0.145], { ...tunic, k: 0.03, disp: { t: 'ribs', n: 9, a: 0.004, sharp: 0.7 } });
      C.ell([0, 0.5, 0.05], [0.15, 0.13, 0.13], { ...tunic, k: 0.06 });
      C.torus([0, 0.43, 0.01], 0.178, 0.018, { ...leather, k: 0.006 });
      // Shoulders, a heavy fur mantle, bare muscled arms with leather bracers, fists on the axe and the shield
      for (const s of [-1, 1]) C.ell([s * 0.19, 0.69, 0], [0.07, 0.065, 0.07], { ...tunic, k: 0.04 });
      C.torus([0, 0.735, -0.01], 0.15, 0.058, { ...fur, k: 0.02, rot: [0.22, 0, 0] });
      C.ball([0, 0.77, -0.06], 0.1, { ...fur, k: 0.04 });
      const arms = [[[0.19, 0.69, 0], [0.245, 0.55, 0.03], [0.22, 0.45, 0.12]], [[-0.19, 0.69, 0], [-0.25, 0.56, 0.02], [-0.22, 0.47, 0.1]]];
      for (const pts of arms) {
        sArm(C, pts, [0.054, 0.045, 0.038], { ...skin, k: 0.02, muscle: 1.05 });
        C.limb([pts[1].map((v, i) => v + (pts[2][i] - v) * 0.35), pts[2]], [0.047, 0.042], { ...leather, k: 0.006 });
      }
      C.at([0.22, 0.44, 0.13], [0.25, 0, -0.15], () => sHand(C, { s: 1.35, skin: SK, fist: true, side: -1 }));
      C.at([-0.22, 0.46, 0.105], [0, 0, 0.3], () => sHand(C, { s: 1.35, skin: SK, fist: true, side: 1 }));
      k.sculpt(C);

      // Belt buckle, pouch, brooch; the cloak behind
      const steel = k.M(STEEL, { metalness: 0.75, roughness: 0.3 });
      const goldM = k.M(GOLD, { metalness: 0.8, roughness: 0.3 });
      k.rbox(0.06, 0.05, 0.015, 0.006, goldM, [0, 0.43, 0.195]);
      k.rbox(0.06, 0.07, 0.035, 0.012, k.M(LEATHER, { roughness: 0.6 }), [0.13, 0.38, 0.12], { rot: [0, 0.6, 0] });
      k.put(capeGeo(0.55, 0.5, 0.18, 0.08), k.M('#6c4f3a', { map: T.speckle('#6c4f3a', 0.1), side: THREE.DoubleSide, roughness: 0.9 }), [0, 0.5, 0]);
      k.cyl(0.028, 0.028, 0.01, goldM, [-0.1, 0.72, 0.18], { rot: [Math.PI / 2 - 0.4, 0, 0] });
      k.tor(0.018, 0.004, DARK, [-0.1, 0.722, 0.186], { rot: [-0.4, 0, 0] });
      // Axe in the right hand
      const axe = k.grp([0.22, 0.42, 0.13], { rot: [0.25, 0, -0.15] });
      k.cyl(0.013, 0.015, 0.5, k.M(WOOD, { map: T.wood(WOOD) }), [0, 0.12, 0], { parent: axe });
      for (let w = 0; w < 3; w++) k.tor(0.015, 0.004, LEATHER, [0, 0.02 + w * 0.025, 0], { parent: axe, rot: [Math.PI / 2, 0, 0] });
      k.ext([[0, 0.04], [0.06, 0.07], [0.14, 0.12], [0.15, 0.01], [0.12, -0.08], [0.06, -0.04], [0, -0.02]], 0.012, steel, [0.07, 0.33, 0], { parent: axe, smooth: true, bevel: 0.004 });
      // Round shield on the left arm
      const shield = k.grp([-0.27, 0.48, 0.1], { rot: [0, -1.1, 0.1] });
      const plank = k.M(c, { map: T.vstripes(c, shade(c, -0.25), 6), bumpMap: T.bump('rough'), bumpScale: 1, roughness: 0.8 });
      k.cyl(0.17, 0.17, 0.02, plank, [0, 0, 0], { parent: shield, rot: [Math.PI / 2, 0, 0], seg: 48 });
      k.tor(0.17, 0.012, steel, [0, 0, 0], { parent: shield, ts: 64 });
      k.sph(0.045, steel, [0, 0, 0.01], { parent: shield, tl: Math.PI / 2, rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        k.sph(0.006, steel, [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.012], { parent: shield, seg: 8 });
      }

      // Head: broad nose, bushy brows, a big braided red beard and moustache, under a horned helmet
      const beard = { color: '#b5561f', mat: 'hair', bump: [0.004, 70], tint: { t: 'noise', a: 0.15, f: 40 } };
      const hd = headAt(k, [0, 0.86, 0], [0, 0, 0], {
        r: 0.115, skin: SK, jaw: 1.15, nose: 'broad', noseSize: 1.25, brows: '#9a4a1a', browR: 0.011, mouth: false, lids: 0.35,
        eye: { iris: '#3e6a8a' },
      }, (H, r) => {
        // a full beard that flows forward over the chest and the fur mantle
        H.ell([0, -r * 0.7, r * 0.62], [r * 0.92, r * 0.8, r * 0.62], { ...beard, k: r * 0.14 });
        H.ell([0, -r * 1.12, r * 1.05], [r * 0.78, r * 0.58, r * 0.55], { ...beard, k: r * 0.25 });
        H.ell([0, -r * 1.5, r * 1.42], [r * 0.5, r * 0.42, r * 0.42], { ...beard, k: r * 0.22 });
        for (const s of [-1, 1]) {
          H.limb([[s * r * 0.82, -r * 0.05, r * 0.15], [s * r * 0.8, -r * 0.4, r * 0.3]], [r * 0.12, r * 0.2], { ...beard, k: r * 0.1 });
          H.limb([[s * r * 0.04, -r * 0.3, r * 0.98], [s * r * 0.36, -r * 0.36, r * 0.92], [s * r * 0.62, -r * 0.56, r * 0.7]], [r * 0.09, r * 0.1, r * 0.05], { ...beard, k: r * 0.05 });
          for (let b = 0; b < 4; b++) H.ball([s * r * 0.3, -r * (1.6 + b * 0.22), r * (1.5 + b * 0.05)], r * (0.15 - b * 0.014), { ...beard, k: r * 0.08 });
        }
        H.ball([0, -r * 0.25, r * 1.0], r * 0.08, { ...beard, op: 'sub', k: r * 0.06, color: '#7a3010', paint: true }); // mouth hidden in the beard
      });
      k.g.userData.face = hd;
      for (const s of [-1, 1]) k.tor(0.015, 0.005, steel, [s * 0.0345, -0.284, 0.177], { parent: hd, rot: [Math.PI / 2, 0, 0] });
      const helm = k.grp([0, 0.04, -0.008], { parent: hd });
      k.sph(0.13, steel, [0, 0, 0], { parent: helm, tl: Math.PI / 2, seg: 48 });
      k.tor(0.128, 0.012, goldM, [0, 0.005, 0], { parent: helm, rot: [Math.PI / 2, 0, 0], ts: 64 });
      for (const a of [0, Math.PI / 2, -Math.PI / 2]) k.rbox(0.014, 0.12, 0.01, 0.004, IRON, [Math.sin(a) * 0.123, 0.065, Math.cos(a) * 0.123], { parent: helm, rot: [Math.cos(a) * -0.55, a, 0] });
      k.rbox(0.018, 0.075, 0.012, 0.005, IRON, [0, -0.03, 0.13], { parent: helm });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        k.sph(0.005, IRON, [Math.cos(a) * 0.133, 0.005, Math.sin(a) * 0.133], { parent: helm, seg: 8 });
      }
      const hornM = k.M('#efe5cc', { roughness: 0.4 });
      for (const s of [-1, 1]) {
        k.tube([[s * 0.115, 0.04, 0], [s * 0.19, 0.08, 0.01], [s * 0.23, 0.17, 0.03], [s * 0.21, 0.25, 0.05]], 0.03, 0.004, hornM, { parent: helm, seg: 30 });
        k.tor(0.032, 0.006, IRON, [s * 0.125, 0.045, 0], { parent: helm, rot: [0, Math.PI / 2, 0.4 * s] });
      }
      return k.g;
    },
  },

  dragon: {
    name: 'Dragunov', blurb: 'Small, but breathes fire in all chat.',
    build(c) {
      const k = kit();
      const C = k.clay();
      const belly = '#f0d9a2';
      const hornC = '#efe3c4';
      const skin = { color: c, mat: 'scale', bump: [0.0025, 70], tint: [{ t: 'noise', a: 0.1, f: 9 }, { t: 'mix', c: darken(c, 0.35), f: 7, th: 0.62, amt: 0.6 }] };
      const plates = { color: belly, mat: 'horn', tint: { t: 'noise', a: 0.06, f: 14 } };
      const horn = { color: hornC, mat: 'horn', tint: { t: 'grad', ax: [0, 1, 0], a0: 0, a1: 0.25, c: '#fff8e8', amt: 0.6 } };

      // Pear-shaped sitting body with a soft, round belly of plates
      C.ell([0, 0.37, -0.01], [0.19, 0.23, 0.19], { ...skin, k: 0 });
      C.ell([0, 0.27, 0.03], [0.205, 0.165, 0.19], { ...skin, k: 0.08 });
      C.ell([0, 0.33, 0.1], [0.15, 0.2, 0.115], { ...plates, k: 0.035, disp: { t: 'rings', a: 0.004, f: 21 } });
      // Neck, curving forward, with belly plates down its front
      C.limb([[0, 0.5, 0.0], [0, 0.63, 0.05], [0, 0.75, 0.09]], [0.12, 0.085, 0.07], { ...skin, k: 0.06 });
      C.limb([[0, 0.53, 0.1], [0, 0.63, 0.13], [0, 0.73, 0.15]], [0.058, 0.05, 0.04], { ...plates, k: 0.03, disp: { t: 'rings', a: 0.003, f: 24 } });

      // Head: domed skull, long snout with a smiling mouth, heavy brow ridges, cheek fins, horns
      const H = [0, 0.82, 0.1];
      const HR = [0.12, 0, 0];
      let eyes;
      C.at(H, HR, () => {
        C.ell([0, 0.005, -0.01], [0.092, 0.084, 0.092], { ...skin, k: 0.05 });
        C.ell([0, -0.022, 0.095], [0.066, 0.052, 0.085], { ...skin, k: 0.05 });
        C.ell([0, -0.012, 0.165], [0.05, 0.04, 0.032], { ...skin, k: 0.03 });
        C.ell([0, -0.062, 0.085], [0.058, 0.026, 0.08], { ...plates, k: 0.03 });
        // smile: a carved curve from cheek to cheek, up at the corners
        C.limb([[-0.06, -0.03, 0.05], [-0.045, -0.045, 0.12], [0, -0.05, 0.19], [0.045, -0.045, 0.12], [0.06, -0.03, 0.05]], [0.004, 0.006, 0.007, 0.006, 0.004], { op: 'sub', k: 0.006, color: '#3a1018', paint: true });
        for (const s of [-1, 1]) {
          C.ball([s * 0.022, 0.006, 0.192], 0.011, { op: 'sub', k: 0.008, color: '#2a0d10', paint: true });
          C.ell([s * 0.022, 0.012, 0.18], [0.02, 0.012, 0.02], { ...skin, k: 0.012 });
          // brow ridge over each eye
          C.limb([[s * 0.022, 0.058, 0.085], [s * 0.058, 0.066, 0.068], [s * 0.088, 0.048, 0.03]], [0.013, 0.016, 0.008], { ...skin, k: 0.02 });
          // eye socket and lids
          const e = [s * 0.054, 0.024, 0.066];
          C.ball(e, 0.031, { ...skin, op: 'sub', k: 0.01 });
          C.ball(e, 0.03, { ...skin, k: 0.008, clip: [[e[0], e[1] + 0.01, e[2]], [0, -1, -0.45], 0.003] });
          C.ball(e, 0.029, { ...skin, k: 0.008, clip: [[e[0], e[1] - 0.019, e[2]], [0, 1, -0.5], 0.003] });
          // horns sweeping back, ridged
          C.limb([[s * 0.045, 0.055, -0.03], [s * 0.08, 0.12, -0.1], [s * 0.095, 0.15, -0.2], [s * 0.085, 0.14, -0.26]], [0.024, 0.017, 0.009, 0.002], { ...horn, k: 0.02, disp: { t: 'rings', a: 0.0018, f: 55 } });
          // cheek fin
          C.limb([[s * 0.085, -0.01, 0.0], [s * 0.125, 0.0, -0.05], [s * 0.15, 0.02, -0.1]], [0.022, 0.012, 0.002], { ...skin, k: 0.02 });
          // fangs
          C.cone([s * 0.03, -0.045, 0.15], [s * 0.03, -0.068, 0.152], 0.006, 0.001, { color: '#fffaf0', mat: 'horn', k: 0.003 });
        }
        eyes = [[-0.054, 0.024, 0.066], [0.054, 0.024, 0.066]];
      });

      // Spines down the back, from the crown to the tail
      const spine = new THREE.CatmullRomCurve3([[0, 0.9, 0.06], [0, 0.74, -0.01], [0, 0.57, -0.12], [0, 0.42, -0.17], [0, 0.24, -0.17]].map(p => new THREE.Vector3(...p)));
      for (let i = 0; i < 11; i++) {
        const p = spine.getPointAt(i / 10);
        const tan = spine.getTangentAt(i / 10);
        const out = new THREE.Vector3(0, -tan.z, tan.y).normalize(); // perpendicular, pointing back/out
        const len = 0.055 - i * 0.003;
        C.cone(p.toArray(), p.clone().addScaledVector(out, len).add(new THREE.Vector3(0, len * 0.35, 0)).toArray(), 0.02 - i * 0.001, 0.002, { ...horn, k: 0.012 });
      }

      // Arms with three claws, chubby thighs, big three-toed feet
      for (const s of [-1, 1]) {
        C.limb([[s * 0.13, 0.49, 0.06], [s * 0.165, 0.4, 0.12], [s * 0.1, 0.375, 0.185]], [0.04, 0.03, 0.025], { ...skin, k: 0.03 });
        C.ell([s * 0.09, 0.37, 0.2], [0.027, 0.022, 0.03], { ...skin, k: 0.012 });
        for (let t = 0; t < 3; t++) C.cone([s * (0.075 + t * 0.014), 0.37, 0.21], [s * (0.07 + t * 0.016), 0.35, 0.235], 0.0055, 0.0012, { ...horn, k: 0.004 });
        C.ell([s * 0.14, 0.2, 0.03], [0.085, 0.105, 0.12], { ...skin, k: 0.06 });
        C.limb([[s * 0.145, 0.16, 0.06], [s * 0.15, 0.06, 0.1]], [0.05, 0.04], { ...skin, k: 0.04 });
        C.ell([s * 0.15, 0.04, 0.11], [0.052, 0.032, 0.075], { ...skin, k: 0.035 });
        for (let t = 0; t < 3; t++) {
          const tx = s * (0.15 + (t - 1) * 0.032);
          C.limb([[tx, 0.03, 0.14], [tx + (t - 1) * 0.008 * s, 0.022, 0.19]], [0.016, 0.013], { ...skin, k: 0.012 });
          C.cone([tx + (t - 1) * 0.009 * s, 0.022, 0.195], [tx + (t - 1) * 0.01 * s, 0.012, 0.222], 0.008, 0.0015, { ...horn, k: 0.004 });
        }
      }
      // Tail curling round the feet to a spade tip
      C.limb([[0, 0.22, -0.16], [0.12, 0.08, -0.28], [0.3, 0.05, -0.2], [0.36, 0.05, -0.02], [0.32, 0.07, 0.12]], [0.085, 0.06, 0.04, 0.026, 0.015], { ...skin, k: 0.05, seg: 18 });
      C.at([0.31, 0.07, 0.16], [Math.PI / 2, 0, 0.6], () => {
        C.ell([0, 0, 0], [0.042, 0.055, 0.009], { ...horn, k: 0.012 });
      });
      k.sculpt(C);

      // Slit-pupil eyes in the sculpted sockets
      const hd = k.grp(H, { rot: HR });
      for (const [i, e] of eyes.entries()) eye(k, hd, e, 0.026, { iris: '#ffcc33', slit: true, rot: [0, (i ? 1 : -1) * 0.35, 0] });
      k.g.userData.face = hd;

      // Wings: thin membranes on sculpted-looking bones (meshes: a membrane is too thin for clay)
      const membrane = k.M(darken(c, 0.25), { side: THREE.DoubleSide, roughness: 0.55, transparent: true, opacity: 0.94 });
      const bone = k.M(c, { roughness: 0.4 });
      for (const s of [-1, 1]) {
        const w = k.grp([s * 0.1, 0.52, -0.12], { rot: [0.1, s * 0.5, s * -0.45], scale: [s, 1, 1] });
        k.ext([[0, 0], [0.12, 0.18], [0.36, 0.28], [0.34, 0.14], [0.3, 0.05], [0.24, 0.03], [0.2, -0.06], [0.13, -0.04], [0.08, -0.11], [0.02, -0.05]], 0.004, membrane, [0, 0, 0], { parent: w, center: false, bevel: 0.002 });
        k.tube([[0, 0, 0.004], [0.12, 0.18, 0.004], [0.36, 0.28, 0.004]], 0.016, 0.004, bone, { parent: w, seg: 24, radial: 14 });
        for (const tip of [[0.3, 0.05], [0.2, -0.06], [0.08, -0.11]]) k.tube([[0.12, 0.18, 0.004], [(0.12 + tip[0]) / 2, (0.18 + tip[1]) / 2 + 0.01, 0.004], [tip[0], tip[1], 0.004]], 0.008, 0.003, bone, { parent: w, seg: 14, radial: 10 });
        k.cone(0.008, 0.03, hornC, [0.37, 0.3, 0.004], { parent: w, rot: [0, 0, -0.9] });
      }
      return k.g;
    },
  },

  penguin: {
    name: 'COCK COCK', blurb: 'Lost in the desert. Still farming aura.',
    build(c) {
      const k = kit();
      const C = k.clay();
      const black = '#1f2430';
      // One body: black back and head, the white belly and face patch painted in where the shapes overlap
      const feathers = { color: black, mat: 'fur', bump: [0.0015, 110], tint: { t: 'noise', a: 0.12, f: 20 } };
      const white = { color: WHITE, mat: 'fur', bump: [0.0015, 110], tint: { t: 'noise', a: 0.04, f: 20 } };
      const orange = { color: '#f29a2e', mat: 'gloss', k: 0.008 };
      const knit = { color: c, mat: 'knit', bump: [0.0025, 140], tint: [{ t: 'stripes', ax: [0, 1, 0], f: 45, c: darken(c, 0.3), w: 0.3, soft: 0.5 }] };

      // Teardrop body, white belly, round head with a white face mask
      C.ell([0, 0.36, 0], [0.245, 0.3, 0.22], { ...feathers, k: 0 });
      C.ell([0, 0.2, 0.01], [0.21, 0.17, 0.2], { ...feathers, k: 0.08 });
      C.ell([0, 0.32, 0.075], [0.19, 0.26, 0.16], { ...white, k: 0.03 });
      C.ball([0, 0.82, 0], 0.155, { ...feathers, k: 0.12 });
      C.ell([0, 0.8, 0.06], [0.11, 0.1, 0.1], { ...white, k: 0.03 });
      for (const s of [-1, 1]) {
        // yellow-orange ear patches, eye sockets
        C.ell([s * 0.12, 0.79, 0.05], [0.022, 0.05, 0.035], { color: '#ffc94a', mat: 'fur', k: 0.02, rot: [0, 0, s * 0.3] });
        C.ball([s * 0.058, 0.87, 0.128], 0.027, { ...white, op: 'sub', k: 0.006 });
        C.torus([s * 0.058, 0.87, 0.13], 0.029, 0.006, { color: WHITE, mat: 'fur', k: 0.004, rot: [Math.PI / 2, s * 0.35, 0] });
        // flippers, a little raised, tips curling
        C.at([s * 0.235, 0.47, 0.01], [0.1, 0, s * 0.3], () => C.ell([0, 0, 0], [0.024, 0.13, 0.06], { ...feathers, k: 0.03, tint: { t: 'grad', ax: [0, -1, 0], a0: -0.5, a1: -0.38, c: '#2c3344', amt: 0.6 } }));
        // webbed orange feet with three toes and dark claws
        C.ell([s * 0.09, 0.025, 0.08], [0.045, 0.02, 0.045], orange);
        for (let t = 0; t < 3; t++) {
          const a = (t - 1) * 0.45;
          C.limb([[s * 0.09, 0.02, 0.09], [s * 0.09 + Math.sin(a) * 0.075, 0.016, 0.1 + Math.cos(a) * 0.075]], [0.018, 0.013], orange);
          C.cone([s * 0.09 + Math.sin(a) * 0.075, 0.016, 0.1 + Math.cos(a) * 0.075], [s * 0.09 + Math.sin(a) * 0.095, 0.012, 0.1 + Math.cos(a) * 0.095], 0.006, 0.0015, { color: DARK, mat: 'horn', k: 0.002 });
        }
      }
      // Beak: dark upper, orange lower
      C.limb([[0, 0.835, 0.13], [0, 0.83, 0.2], [0, 0.815, 0.255]], [0.03, 0.016, 0.004], { color: '#2a2a2f', mat: 'gloss', k: 0.012 });
      C.limb([[0, 0.81, 0.13], [0, 0.805, 0.2], [0, 0.808, 0.235]], [0.022, 0.012, 0.004], orange);
      // Knitted scarf with a hanging tail and fringe; a beanie with a folded cuff and a big pompom
      C.torus([0, 0.712, 0.01], 0.15, 0.042, { ...knit, k: 0.012, rot: [0.1, 0, 0] });
      C.at([0.08, 0.6, 0.185], [0.15, 0, 0.18], () => {
        C.box([0, 0, 0], [0.075, 0.24, 0.028], 0.012, { ...knit, k: 0.01, disp: { t: 'folds', ax: [1, 0, 0], f: 160, a: 0.0018 } });
        for (let f = 0; f < 6; f++) C.limb([[(f - 2.5) * 0.012, -0.12, 0], [(f - 2.5) * 0.013, -0.155, 0.002]], [0.004, 0.003], { color: c, mat: 'knit', k: 0.002 });
      });
      C.ell([0, 0.92, -0.01], [0.162, 0.17, 0.162], { ...knit, k: 0.006, clip: [[0, 0.925, 0], [0, -1, 0], 0.004] });
      C.torus([0, 0.94, -0.01], 0.158, 0.028, { ...knit, color: darken(c, 0.15), k: 0.006, disp: { t: 'ribs', n: 40, a: 0.003 } });
      C.ball([0, 1.11, -0.01], 0.052, { color: WHITE, mat: 'fur', k: 0.02, bump: [0.008, 90] });
      // dark feathers: a cool, faint sheen (the shared fur sheen would wash the black out to grey)
      k.sculpt(C, { mats: { fur: { physical: true, roughness: 0.7, sheen: 0.3, sheenRoughness: 0.5, sheenColor: '#55606f' } } });
      const hd = k.grp([0, 0.82, 0]);
      k.g.userData.face = hd;
      for (const s of [-1, 1]) eye(k, k.g, [s * 0.058, 0.87, 0.128], 0.025, { iris: '#3a2a1e', rot: [0, s * 0.35, 0] });
      return k.g;
    },
  },

  frostking: {
    name: 'Fruit Cake', blurb: 'Rules a frozen server. Nobody duos with him twice.',
    build(c) {
      const k = kit();
      const PLATE = '#3d4656';
      const TRIM = '#a9c4d8';
      const C = k.clay();
      const plate = { color: PLATE, mat: 'metal', bump: [0.0006, 160], tint: { t: 'noise', a: 0.12, f: 14 } };
      const trim = { color: TRIM, mat: 'metal' };
      const ice = k.M('#cfefff', { emissive: new THREE.Color('#6fd0ff'), emissiveIntensity: 0.5, roughness: 0.1, transparent: true, opacity: 0.9 });
      const glow = basic('#9be7ff');

      // Armoured legs: greaves, knee cops, sabatons
      for (const s of [-1, 1]) {
        C.at([s * 0.075, 0, 0], [0, s * 0.08, 0], () => sShoe(C, { color: PLATE, sole: '#22262e', h: 0.14, w: 1.12, mat: 'metal' }));
        sLeg(C, [[s * 0.075, 0.43, 0], [s * 0.078, 0.28, 0.01], [s * 0.075, 0.15, 0]], [0.06, 0.052, 0.047], { ...plate, k: 0.012, knee: false });
        C.ell([s * 0.078, 0.28, 0.048], [0.042, 0.034, 0.026], { ...trim, k: 0.008 });
        C.ell([s * 0.078, 0.31, 0.052], [0.016, 0.02, 0.014], { ...trim, k: 0.006 });
      }
      // Tassets over the hips, a breastplate with a ridge, a trimmed waist
      for (const s of [-1, 1]) for (let l = 0; l < 3; l++) C.box([s * 0.1, 0.43 - l * 0.045, 0.06], [0.12, 0.05, 0.03], 0.012, { ...plate, k: 0.006, rot: [0.1, s * 0.4, 0] });
      C.ell([0, 0.58, 0.0], [0.155, 0.17, 0.115], { ...plate, k: 0.02 });
      C.ell([0, 0.69, 0], [0.18, 0.1, 0.125], { ...plate, k: 0.05 });
      C.limb([[0, 0.47, 0.11], [0, 0.6, 0.124], [0, 0.73, 0.1]], [0.008, 0.012, 0.008], { ...trim, k: 0.01 });
      C.torus([0, 0.45, 0], 0.158, 0.014, { ...trim, k: 0.006 });
      // Layered spiked pauldrons
      for (const s of [-1, 1]) {
        for (let l = 0; l < 3; l++) C.ell([s * (0.2 + l * 0.012), 0.72 - l * 0.038, 0], [0.11 - l * 0.012, 0.085, 0.11 - l * 0.008], { ...(l === 0 ? plate : trim), k: 0.006, rot: [0, 0, s * 0.35], clip: [[s * (0.2 + l * 0.012), 0.69 - l * 0.038, 0], [s * 0.35, -1, 0], 0.004] });
        // armoured arms reaching for the sword, gauntleted fists on its pommel
        sArm(C, [[s * 0.2, 0.69, 0], [s * 0.22, 0.55, 0.06], [s * 0.06, 0.48 + (s < 0 ? 0.02 : 0), 0.16]], [0.048, 0.044, 0.04], { ...plate, k: 0.02 });
        C.ball([s * 0.222, 0.55, 0.075], 0.03, { ...trim, k: 0.008 });
        C.at([s * 0.055, 0.475 + (s < 0 ? 0.02 : 0), 0.165], [0, 0, s * 1.3], () => sHand(C, { s: 1.45, skin: PLATE, mat: 'metal', fist: true, side: -s }));
      }
      // Fur collar
      C.torus([0, 0.77, -0.01], 0.165, 0.048, { color: '#e6eef4', mat: 'fur', k: 0.01, bump: [0.006, 50] });
      k.sculpt(C);

      // Tabard in the rider's colour, glowing runes, cape, ice spikes on the pauldrons
      k.ext([[-0.07, 0], [0.07, 0], [0.09, -0.3], [0, -0.34], [-0.09, -0.3]], 0.01, k.M(c, { roughness: 0.7 }), [0, 0.32, 0.135], { bevel: 0.003 });
      for (const s of [-1, 1]) for (let r = 0; r < 3; r++) k.tube([[s * 0.03, 0.66 - r * 0.07, 0.122], [s * 0.07, 0.63 - r * 0.07, 0.118], [s * 0.06, 0.6 - r * 0.07, 0.12]], 0.004, 0.004, glow, { seg: 8, radial: 6 });
      k.sph(0.028, glow, [0, 0.45, 0.162], { scale: [1, 1, 0.5] });
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.cone(0.014, 0.09 - i * 0.015, ice, [s * (0.2 + i * 0.03), 0.79 - i * 0.012, -0.02 + i * 0.025], { rot: [0, 0, s * (-0.4 - i * 0.2)], seg: 6 });
      k.put(capeGeo(0.6, 0.72, 0.2, 0.12, 11), k.M(c, { side: THREE.DoubleSide, roughness: 0.8, map: T.speckle(c, 0.08) }), [0, 0.39, 0]);
      // The runed sword, planted in front
      const sw = k.grp([0, 0, 0.18]);
      k.ext([[0, 0], [0.035, 0.05], [0.032, 0.42], [0, 0.44], [-0.032, 0.42], [-0.035, 0.05]], 0.008, k.M('#dff4ff', { map: T.runes('#5fd0ff'), metalness: 0.6, roughness: 0.15, emissive: new THREE.Color('#3aa6d8'), emissiveIntensity: 0.25 }), [0, 0.23, 0], { parent: sw, rot: [0, 0, Math.PI], bevel: 0.006 });
      k.tube([[-0.11, 0.49, 0], [-0.05, 0.45, 0], [0, 0.46, 0], [0.05, 0.45, 0], [0.11, 0.49, 0]], 0.012, 0.012, k.M(TRIM, { metalness: 0.85, roughness: 0.25 }), { parent: sw });
      for (const s of [-1, 1]) k.cone(0.012, 0.05, ice, [s * 0.115, 0.52, 0], { parent: sw, rot: [0, 0, -s * 0.5], seg: 6 });
      k.cyl(0.014, 0.014, 0.1, k.M(LEATHER, { map: T.stripes(LEATHER, '#2e1e14', 12) }), [0, 0.52, 0], { parent: sw });
      k.sph(0.022, glow, [0, 0.585, 0], { parent: sw, scale: [1, 1.3, 1] });

      // Gaunt undead face with glowing eyes, under a hood; an icicle crown
      const hd = headAt(k, [0, 0.88, 0], [0, 0, 0], {
        r: 0.1, skin: '#a8b8c8', age: 1.3, jaw: 0.86, chin: 1.2, nose: 'fine', mouth: 'frown', lips: '#4a5664', brows: '#dfe8ef', browR: 0.008, browArch: -0.8, lids: 0.3,
        eye: { glow: '#9be7ff' },
      }, (H, r) => {
        const hood = { color: darken(c, 0.4), mat: 'cloth', k: r * 0.04, bump: [r * 0.004, 1 / (r * 0.05)] };
        H.ell([0, r * 0.12, -r * 0.18], [r * 1.12, r * 1.1, r * 1.12], { ...hood, clip: [[0, 0, r * 0.18], [0, -0.1, 1], r * 0.05] });
        H.limb([[0, -r * 0.1, -r * 0.6], [0, -r * 0.7, -r * 0.9], [0, -r * 1.2, -r * 0.85]], [r * 1.0, r * 0.95, r * 0.8], { ...hood, k: r * 0.2 });
      });
      k.g.userData.face = hd;
      const trimM = k.M(TRIM, { metalness: 0.85, roughness: 0.25 });
      k.tor(0.11, 0.012, trimM, [0, 0.075, 0], { parent: hd, rot: [Math.PI / 2 - 0.1, 0, 0] });
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU;
        const tall = i === 0 ? 0.13 : i % 2 ? 0.06 : 0.09;
        k.cone(0.014, tall, ice, [Math.sin(a) * 0.11, 0.08 + tall / 2, Math.cos(a) * 0.11 - 0.01], { parent: hd, rot: [Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2], seg: 6 });
      }
      k.sph(0.018, glow, [0, 0.09, 0.11], { parent: hd, seg: 12 });
      // Frost motes
      const r = rng(41);
      const motes = [];
      for (let i = 0; i < 14; i++) {
        const a = r() * TAU;
        motes.push([[Math.cos(a) * (0.28 + r() * 0.08), 0.2 + r() * 0.75, Math.sin(a) * (0.28 + r() * 0.08)], [r() * 3, r() * 3, 0], [1, 1, 1]]);
      }
      k.inst(new THREE.OctahedronGeometry(0.012), ice, motes);
      return k.g;
    },
  },

  crone: {
    name: 'Osoka', blurb: "Wanted a loan. You said no. Now you're cursed.",
    build(c) {
      const k = kit();
      const SK = '#cdc6a3';
      const C = k.clay();
      const dress = { color: '#3d3346', mat: 'cloth', bump: [0.001, 110], tint: { t: 'noise', a: 0.1, f: 20 } };
      const shawl = { color: c, mat: 'knit', bump: [0.0016, 140], tint: [{ t: 'stripes', ax: [0, 1, 0.3], f: 60, c: darken(c, 0.3), w: 0.2, soft: 0.5 }, { t: 'noise', a: 0.08, f: 30 }] };
      const skin = { color: SK, mat: 'skin', bump: [0.0014, 140] };

      // Pointy shoes curling up at the toes, a long dress falling in deep folds
      for (const s of [-1, 1]) C.limb([[s * 0.06, 0.025, 0.0], [s * 0.065, 0.025, 0.1], [s * 0.062, 0.05, 0.165], [s * 0.058, 0.075, 0.17]], [0.034, 0.022, 0.009, 0.004], { color: '#1d1a22', mat: 'leather', k: 0.01 });
      C.limb([[0, 0.03, 0], [0, 0.3, 0.01], [0, 0.54, 0.04]], [0.19, 0.16, 0.125], { ...dress, k: 0.02, disp: { t: 'ribs', n: 9, a: 0.007, sharp: 0.55 } });
      // Hunched torso leaning forward, with a hump on the back
      C.limb([[0, 0.5, 0.03], [0, 0.6, 0.02], [0, 0.68, 0.07]], [0.125, 0.112, 0.1], { ...dress, k: 0.04 });
      C.ell([0, 0.665, -0.035], [0.125, 0.095, 0.11], { ...dress, k: 0.05 });
      // Knitted shawl over the shoulders and hump, two ends hanging down the front
      C.ell([0, 0.665, 0.0], [0.17, 0.11, 0.16], { ...shawl, k: 0.008, clip: [[0, 0.6, 0], [0, -1, -0.35], 0.006] });
      for (const s of [-1, 1]) C.limb([[s * 0.07, 0.67, 0.12], [s * 0.08, 0.58, 0.155], [s * 0.075, 0.5, 0.16]], [0.045, 0.04, 0.03], { ...shawl, k: 0.02 });
      // Bony arms in knitted sleeves: one grips the cane, one reaches out with long, yellowed nails
      sArm(C, [[0.13, 0.66, 0.03], [0.17, 0.55, 0.1], [0.16, 0.505, 0.17]], [0.038, 0.031, 0.024], { ...shawl, k: 0.02 });
      sArm(C, [[-0.13, 0.66, 0.03], [-0.19, 0.58, 0.14], [-0.15, 0.6, 0.235]], [0.038, 0.031, 0.024], { ...shawl, k: 0.02 });
      C.at([0.165, 0.5, 0.18], [0, 0, 0.2], () => sHand(C, { s: 1.2, skin: SK, fist: true, side: -1, bump: [0.001, 160] }));
      C.at([-0.15, 0.6, 0.24], [-1.3, 0, 0], () => {
        sHand(C, { s: 1.2, skin: SK, curl: 0.5, spread: 0.25, side: 1, bump: [0.001, 160] });
        for (let i = 0; i < 4; i++) {
          const z = (i - 1.5) * 0.0136 * 1.2 * 1.25 * 1.12;
          const tip = [0.01 * 1.2 + 0.3 * 0.03 * 1.2, -0.05 * 1.2 - 0.041 * 1.2 * [0.9, 1, 0.94, 0.76][i], z];
          C.cone(tip, [tip[0] + 0.006, tip[1] - 0.026, z * 1.05], 0.004, 0.0012, { color: '#4a4628', mat: 'horn', k: 0.002 });
        }
      });
      k.sculpt(C);

      // Fringe along the shawl's edge, the amulet, the gnarled cane
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * TAU;
        const x = Math.cos(a) * 0.168;
        const z = Math.sin(a) * 0.158;
        const y = 0.6 - z * 0.35 * 0.9;
        k.cyl(0.0028, 0.0018, 0.045, c, [x, y - 0.02, z], { seg: 5 });
      }
      k.tube([[-0.05, 0.7, 0.115], [0, 0.6, 0.16], [0.05, 0.7, 0.115]], 0.003, 0.003, GOLD, { caps: false });
      k.sph(0.022, k.M('#4dff88', { emissive: new THREE.Color('#2bd16a'), emissiveIntensity: 0.6, roughness: 0.1 }), [0, 0.59, 0.165]);
      k.tor(0.024, 0.005, GOLD, [0, 0.59, 0.165]);
      const r = rng(19);
      const cane = [];
      for (let i = 0; i <= 8; i++) cane.push([0.17 + (r() - 0.5) * 0.02, 0.005 + i * 0.07, 0.2 + (r() - 0.5) * 0.02]);
      cane.push([0.2, 0.6, 0.19], [0.22, 0.57, 0.18]);
      k.tube(cane, 0.012, 0.01, k.M('#5a4130', { map: T.wood('#5a4130'), bumpMap: T.bump('rough'), bumpScale: 2 }), { seg: 50 });

      // Wrinkled face: hooked nose, warts, one milky glowing eye, a pointed chin, two teeth, wild grey hair
      const hair = { color: '#a7a7ae', mat: 'hair', k: 0.004 };
      const hd = headAt(k, [0, 0.78, 0.13], [0.15, 0, 0], {
        r: 0.1, skin: SK, age: 1, nose: 'hook', noseSize: 1.35, mouth: 'frown', jaw: 0.88, chin: 1.6, brows: '#bdbdc4', browR: 0.008, browArch: 1.6, lids: 0.45,
        eye: { iris: '#2a2a18', glow: '#e6f0ff', glowOne: true },
      }, (H, r) => {
        for (const [x, y, z, w] of [[0.012, -0.03, 0.15, 0.008], [-0.05, -0.04, 0.088, 0.007], [0.04, 0.05, 0.088, 0.006], [-0.02, -0.075, 0.098, 0.005]]) H.ball([x, y, z], w, { color: darken(SK, 0.25), mat: 'skin', k: 0.003 });
        H.ell([0, r * 0.15, -r * 0.12], [r * 0.95, r * 0.92, r * 0.98], { ...hair, k: r * 0.06, bump: [r * 0.015, 1 / (r * 0.05)], clip: [[0, r * 0.45, r * 0.4], [0, -0.4, 1], r * 0.05] });
        const rr = rng(23);
        for (let i = 0; i < 30; i++) {
          const a = rr() * TAU;
          const up = rr() * 0.8;
          const sx = Math.cos(a) * 0.088;
          const sz = Math.sin(a) * 0.088 - 0.025;
          if (sz > 0.04 && up < 0.5) continue;
          const len = 0.08 + rr() * 0.1;
          H.limb([[sx, 0.04 + up * 0.05, sz], [sx * 1.45 + (rr() - 0.5) * 0.04, 0.02 + up * 0.08, sz * 1.3], [sx * 1.75 + (rr() - 0.5) * 0.06, -len + up * 0.1, sz * 1.5 - 0.02]], [0.011, 0.009, 0.0065], { ...hair, k: 0.006, seg: 4 });
        }
      });
      k.g.userData.face = hd;
      k.rbox(0.008, 0.012, 0.005, 0.002, '#e8dfb0', [-0.012, -0.05, 0.088], { parent: hd, rot: [0.1, 0, 0] });
      k.rbox(0.008, 0.01, 0.005, 0.002, '#e8dfb0', [0.014, -0.049, 0.088], { parent: hd, rot: [0.1, 0, 0] });
      return k.g;
    },
  },

  captain: {
    name: 'Cpt. Diff', blurb: 'Sank with the ship. Still collecting taxes.',
    build(c) {
      const k = kit();
      const SEA = '#6f9a8c';
      const C = k.clay();
      const coatC = '#2c4140';
      const coat = { color: coatC, mat: 'cloth', bump: [0.0012, 110], tint: [{ t: 'noise', a: 0.12, f: 16 }, { t: 'mix', c: '#3f5a50', f: 9, th: 0.62, amt: 0.6 }] };
      const skin = { color: SEA, mat: 'skin', bump: [0.0015, 110] };

      // Tall boots with folded cuffs, breeches
      for (const s of [-1, 1]) {
        C.at([s * 0.075, 0, 0], [0, s * 0.1, 0], () => sShoe(C, { color: '#2a211c', sole: '#141110', h: 0.22, w: 1.05, mat: 'leather' }));
        C.cone([s * 0.075, 0.2, -0.005], [s * 0.075, 0.25, -0.005], 0.054, 0.06, { color: '#3a2d24', mat: 'leather', k: 0.006 });
        sLeg(C, [[s * 0.075, 0.43, 0], [s * 0.078, 0.33, 0.01], [s * 0.076, 0.24, 0]], [0.058, 0.054, 0.05], { color: '#c8b896', mat: 'cloth', k: 0.012, knee: false });
      }
      // Waistcoat in the rider's colour underneath, then the long flared coat, open down the front
      C.limb([[0, 0.38, 0.01], [0, 0.55, 0.02], [0, 0.7, 0.005]], [0.15, 0.15, 0.13], { color: c, mat: 'cloth', k: 0.02, bump: [0.0008, 120] });
      for (const s of [-1, 1]) {
        const open = { clip: [[s * 0.05, 0, 0], [-s, 0, 0.12], 0.005] }; // keep this side of the opening
        C.limb([[0, 0.12, -0.01], [0, 0.3, 0], [0, 0.45, 0], [0, 0.72, 0]], [0.2, 0.17, 0.152, 0.138], { ...coat, k: 0.006, ...open, disp: { t: 'ribs', n: 7, a: 0.007, sharp: 0.6, fade: [0.5, 0.1] } });
        C.limb([[s * 0.07, 0.72, 0.112], [s * 0.084, 0.5, 0.13], [s * 0.155, 0.14, 0.122]], [0.011, 0.011, 0.013], { ...coat, k: 0.006 }); // rolled front edge
        C.box([s * 0.15, 0.32, 0.13], [0.05, 0.05, 0.015], 0.006, { ...coat, color: '#24302f', k: 0.004, rot: [0, s * 0.5, 0] }); // pocket flap
        C.ell([s * 0.18, 0.7, 0], [0.065, 0.06, 0.068], { ...coat, k: 0.04 });
      }
      C.torus([0, 0.42, 0.005], 0.168, 0.017, { color: LEATHER, mat: 'leather', k: 0.004 });
      // Arms: big gold-braided cuffs, a green hand on the left, the hook on the right
      sArm(C, [[-0.18, 0.69, 0], [-0.22, 0.55, 0.04], [-0.17, 0.46, 0.1]], [0.05, 0.045, 0.04], { ...coat, k: 0.02 });
      sArm(C, [[0.18, 0.69, 0], [0.23, 0.56, 0.05], [0.2, 0.5, 0.14]], [0.05, 0.045, 0.04], { ...coat, k: 0.02 });
      for (const [p, rot] of [[[-0.175, 0.47, 0.095], [0.9, 0, 0.3]], [[0.205, 0.505, 0.13], [1.1, 0, -0.2]]]) C.torus(p, 0.044, 0.016, { color: GOLD, mat: 'metal', k: 0.004, rot, bump: [0.0012, 300] });
      C.at([-0.17, 0.455, 0.1], [0.4, 0, 0.3], () => sHand(C, { s: 1.3, skin: SEA, fist: true, side: 1 }));
      // Coral growing on the shoulder
      const coral = (base, col, seed) => {
        const r = rng(seed);
        for (let i = 0; i < 6; i++) {
          const tip = [base[0] + (r() - 0.5) * 0.09, base[1] + 0.05 + r() * 0.07, base[2] + (r() - 0.5) * 0.07];
          C.limb([base, [(base[0] + tip[0]) / 2 + (r() - 0.5) * 0.02, base[1] + 0.035, (base[2] + tip[2]) / 2], tip], [0.011, 0.008, 0.006], { color: col, mat: 'horn', k: 0.008, bump: [0.0015, 260] });
          C.ball(tip, 0.008, { color: lighten(col, 0.3), mat: 'horn', k: 0.004 });
        }
      };
      coral([0.19, 0.745, 0], '#ff8a7a', 7);
      coral([0.15, 0.74, -0.06], '#ffb36b', 9);
      k.sculpt(C);

      // Gold trim and buttons, belt buckle, cutlass on the hip, the hook
      const gold = k.M(GOLD, { metalness: 0.75, roughness: 0.3 });
      for (let b = 0; b < 5; b++) k.sph(0.009, gold, [0, 0.64 - b * 0.05, 0.172], { seg: 10 });
      for (const s of [-1, 1]) k.tube([[s * 0.072, 0.72, 0.124], [s * 0.088, 0.5, 0.142], [s * 0.16, 0.14, 0.134]], 0.0055, 0.0055, gold, { seg: 24 });
      k.rbox(0.05, 0.045, 0.012, 0.006, gold, [0, 0.42, 0.19]);
      const cut = k.grp([-0.2, 0.38, 0.06], { rot: [0.2, 0, 0.25] });
      k.ext([[0, 0], [0.025, 0.02], [0.03, -0.2], [0.0, -0.32], [-0.005, -0.2]], 0.005, k.M(STEEL, { metalness: 0.8, roughness: 0.25 }), [0, -0.15, 0], { parent: cut, bevel: 0.002 });
      k.tor(0.035, 0.006, gold, [0.0, 0.03, 0], { parent: cut, arc: Math.PI, rot: [0, Math.PI / 2, 0] });
      k.cyl(0.012, 0.012, 0.06, LEATHER, [0, 0.06, 0], { parent: cut });
      k.cyl(0.03, 0.035, 0.04, gold, [0.2, 0.48, 0.15], { rot: [0.5, 0, 0] });
      k.tor(0.035, 0.008, k.M(STEEL, { metalness: 0.85, roughness: 0.2 }), [0.2, 0.43, 0.2], { arc: Math.PI * 1.3, rot: [0, Math.PI / 2, 0] });
      k.cone(0.008, 0.02, STEEL, [0.2, 0.44, 0.238], { rot: [0.6, 0, 0], seg: 8 });
      const bar = rng(13);
      const barnacles = [];
      for (let i = 0; i < 36; i++) {
        const a = (bar() < 0.5 ? -1 : 1) * (0.5 + bar() * 1.2);
        const y = 0.2 + bar() * 0.45;
        const R = y < 0.45 ? 0.2 - ((y - 0.12) / 0.33) * 0.048 : 0.152 - ((y - 0.45) / 0.27) * 0.014;
        barnacles.push([[Math.sin(a) * R, y, Math.cos(a) * R], [Math.PI / 2 - 0.2, 0, -a], [1, 1, 1]]);
      }
      k.inst(new THREE.CylinderGeometry(0.004, 0.009, 0.01, 7), '#d8d2c4', barnacles, { m: { roughness: 0.9 } });

      // Drowned face: sea-green, one glowing eye, a seaweed beard; tricorn hat with gold trim, a feather and a starfish
      const weed = ['#3f7d4f', '#2f6a44', '#5a8f3c'];
      const hd = headAt(k, [0, 0.86, 0], [0, 0, 0], {
        r: 0.105, skin: SEA, age: 0.8, jaw: 1.05, nose: 'normal', noseSize: 1.1, mouth: 'grin', brows: '#2a3a2e', browR: 0.009, browArch: -0.6, lids: 0.35,
        eye: { iris: '#1d2a20', glow: '#d7ff7a', glowOne: true },
      }, (H, r) => {
        for (let i = 0; i < 15; i++) {
          const x = -0.07 + (i / 14) * 0.14;
          const len = 0.11 + Math.sin(i * 1.7) * 0.035 + (1 - Math.abs(x) / 0.07) * 0.06;
          H.limb([[x, -0.065, 0.075 - Math.abs(x) * 0.4], [x * 1.1 + Math.sin(i) * 0.01, -0.065 - len * 0.5, 0.095 - Math.abs(x) * 0.3], [x * 1.15 + Math.cos(i) * 0.015, -0.065 - len, 0.085]], [0.009, 0.007, 0.003], { color: weed[i % 3], mat: 'plant', k: 0.004, seg: 4 });
        }
        H.limb([[-0.06, -0.045, 0.092], [0, -0.035, 0.108], [0.06, -0.045, 0.092]], [0.008, 0.009, 0.008], { color: '#2f6a44', mat: 'plant', k: 0.004 });
      });
      k.g.userData.face = hd;
      const brim = new THREE.RingGeometry(0.1, 0.2, 90, 4);
      const bp = brim.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        const x = bp.getX(i);
        const y = bp.getY(i);
        const rr = Math.hypot(x, y);
        const a = Math.atan2(y, x);
        const t = (rr - 0.1) / 0.1;
        bp.setXYZ(i, x, y, 0.07 * t * t * (0.5 + 0.5 * Math.cos(3 * a + Math.PI)));
      }
      brim.rotateX(-Math.PI / 2);
      brim.computeVertexNormals();
      const hat = k.grp([0, 0.085, -0.005], { parent: hd, rot: [0, Math.PI / 6 + Math.PI, 0] });
      const felt = k.M('#1c1a1e', { side: THREE.DoubleSide, roughness: 0.9, map: T.speckle('#1c1a1e', 0.1) });
      k.put(brim, felt, [0, 0, 0], { parent: hat });
      k.sph(0.108, felt, [0, 0, 0], { parent: hat, tl: Math.PI / 2, scale: [1, 0.85, 1] });
      const trimPts = [];
      for (let i = 0; i <= 60; i++) {
        const a = (i / 60) * TAU;
        trimPts.push([Math.cos(a) * 0.2, 0.07 * (0.5 + 0.5 * Math.cos(3 * a + Math.PI)), -Math.sin(a) * 0.2]);
      }
      k.tube(trimPts, 0.006, 0.006, gold, { parent: hat, seg: 120, radial: 6, caps: false });
      k.ext([[0, 0], [0.02, 0.08], [0.01, 0.2], [-0.015, 0.1]], 0.004, k.M(c, { side: THREE.DoubleSide }), [-0.07, 0.12, -0.05], { parent: hd, rot: [0, 0, 0.6], smooth: true, bevel: 0.001 });
      const star = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * TAU;
        const rr = i % 2 ? 0.014 : 0.035;
        star.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      k.ext(star, 0.006, k.M('#ff7a59', { bumpMap: T.bump('rough'), bumpScale: 2 }), [0.08, 0.105, 0.095], { parent: hd, rot: [-0.4, 0.4, 0], bevel: 0.004 });
      return k.g;
    },
  },

  pistol: {
    name: 'Pistolero', blurb: 'Six shots of pure aura. Always loaded.',
    build(c) {
      const k = kit();
      const blued = k.M('#3b424d', { metalness: 0.85, roughness: 0.28 });
      const bright = k.M('#b8bec8', { metalness: 0.9, roughness: 0.2 });
      const grip = k.M(WOOD, { map: T.checker('#7a4a2a'), bumpMap: T.bump('rough'), bumpScale: 1.5, roughness: 0.6 });
      const gun = k.grp([0, 0, 0], { rot: [0, -0.5, 0] });
      const G = { parent: gun };
      // Frame and grip
      k.ext([[-0.16, 0.5], [0.12, 0.5], [0.13, 0.7], [-0.02, 0.73], [-0.12, 0.72], [-0.17, 0.66]], 0.07, blued, [-0.02, 0.61, 0], { ...G, bevel: 0.01 });
      k.ext([[-0.16, 0.52], [-0.06, 0.52], [-0.1, 0.35], [-0.17, 0.25], [-0.27, 0.26], [-0.24, 0.38]], 0.075, grip, [-0.165, 0.39, 0], { ...G, smooth: true, bevel: 0.008 });
      for (const s of [-1, 1]) {
        k.cyl(0.028, 0.028, 0.006, k.M(c, { metalness: 0.6, roughness: 0.3 }), [-0.17, 0.4, s * 0.046], { ...G, rot: [Math.PI / 2, 0, 0] });
        k.tor(0.028, 0.004, k.M(GOLD, { metalness: 0.8, roughness: 0.25 }), [-0.17, 0.4, s * 0.049], G);
        k.cyl(0.006, 0.006, 0.004, bright, [-0.12, 0.47, s * 0.047], { ...G, rot: [Math.PI / 2, 0, 0], seg: 12 });
      }
      // Fluted cylinder with chambers and an engraved band
      const cyl = k.grp([0.03, 0.615, 0], G);
      k.cyl(0.085, 0.085, 0.15, blued, [0, 0, 0], { parent: cyl, rot: [0, 0, Math.PI / 2], seg: 48 });
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU + Math.PI / 6;
        k.cap(0.016, 0.08, '#20242b', [0, Math.cos(a) * 0.082, Math.sin(a) * 0.082], { parent: cyl, rot: [0, 0, Math.PI / 2], seg: 12 });
        k.cyl(0.018, 0.018, 0.01, '#0d0f12', [0.072, Math.cos(a - Math.PI / 6) * 0.05, Math.sin(a - Math.PI / 6) * 0.05], { parent: cyl, rot: [0, 0, Math.PI / 2], seg: 16 });
        k.sph(0.011, GOLD, [0.076, Math.cos(a - Math.PI / 6) * 0.05, Math.sin(a - Math.PI / 6) * 0.05], { parent: cyl, scale: [0.5, 1, 1], seg: 10 });
      }
      k.tor(0.086, 0.006, k.M(c, { metalness: 0.6, roughness: 0.3 }), [-0.04, 0, 0], { parent: cyl, rot: [0, Math.PI / 2, 0] });
      // Barrel with top rib, ejector rod, front sight and muzzle
      k.cyl(0.033, 0.035, 0.4, blued, [0.32, 0.655, 0], { ...G, rot: [0, 0, Math.PI / 2] });
      k.rbox(0.4, 0.022, 0.03, 0.008, blued, [0.32, 0.688, 0], G);
      k.cyl(0.013, 0.013, 0.28, bright, [0.25, 0.605, 0], { ...G, rot: [0, 0, Math.PI / 2] });
      k.sph(0.016, bright, [0.39, 0.605, 0], G);
      k.ext([[0, 0], [0.02, 0], [0.016, 0.03], [0.004, 0.03]], 0.008, bright, [0.5, 0.71, 0], { ...G, bevel: 0.002 });
      k.cyl(0.02, 0.02, 0.01, '#07080a', [0.522, 0.655, 0], { ...G, rot: [0, 0, Math.PI / 2] });
      // Hammer, trigger and trigger guard
      k.ext([[0, 0], [0.025, 0.02], [0.0, 0.09], [-0.04, 0.1], [-0.03, 0.08], [-0.01, 0.06]], 0.025, bright, [-0.14, 0.75, 0], { ...G, bevel: 0.004 });
      k.tor(0.055, 0.01, blued, [-0.04, 0.47, 0], { ...G, arc: Math.PI * 1.1, rot: [0, 0, Math.PI * 0.95] });
      k.tube([[-0.04, 0.51, 0], [-0.03, 0.47, 0], [-0.05, 0.44, 0]], 0.009, 0.006, bright, G);
      // Cartoon face on the frame
      k.g.userData.face = k.grp([-0.02, 0.62, 0.05], G);
      for (const s of [-1, 1]) {
        eye(k, gun, [-0.06 + s * 0.035, 0.65, 0.045], 0.026, { iris: '#2b1a10' });
        k.tube([[-0.06 + s * 0.035 - 0.02, 0.69, 0.05], [-0.06 + s * 0.035 + 0.02, 0.695 - s * 0.006, 0.05]], 0.005, 0.005, DARK, { ...G, seg: 6 });
      }
      k.tube([[-0.09, 0.6, 0.047], [-0.06, 0.59, 0.05], [-0.03, 0.6, 0.047]], 0.005, 0.005, '#c0392b', { ...G, seg: 10 });
      // Rubber-hose arms and legs, puffy white cartoon gloves, chunky sneakers in the rider's colour
      const L = k.clay();
      const hose = { color: '#1d1a22', mat: 'gloss', k: 0.012 };
      const glove = { color: WHITE, mat: 'cloth', bump: [0.0006, 200] };
      L.at([0, 0, 0], [0, -0.5, 0], () => {
        for (const s of [-1, 1]) {
          L.limb([[-0.04, 0.58, s * 0.035], [-0.03, 0.51, s * 0.1], [0.035, 0.465, s * 0.12]], [0.012, 0.011, 0.011], hose);
          L.torus([0.036, 0.465, s * 0.12], 0.02, 0.011, { ...glove, k: 0.006, rot: [0, 0, Math.PI / 2] });
          L.at([0.05, 0.465, s * 0.12], [0, 0, Math.PI / 2], () => sHand(L, { s: 1.35, skin: WHITE, mat: 'cloth', fist: true, side: -1 }));
          L.limb([[-0.2, 0.28, s * 0.03], [-0.205, 0.15, s * 0.06], [-0.19, 0.06, s * 0.07]], [0.014, 0.013, 0.012], hose);
          L.at([-0.17, 0, s * 0.07], [0, Math.PI / 2, 0], () => {
            L.ell([0, 0.04, 0.03], [0.042, 0.035, 0.07], { color: c, mat: 'leather', k: 0.015 });
            L.ell([0, 0.05, -0.02], [0.038, 0.04, 0.04], { color: c, mat: 'leather', k: 0.03 });
            L.box([0, 0.012, 0.012], [0.09, 0.024, 0.16], 0.01, { color: WHITE, mat: 'dark', k: 0.004 });
            L.ell([0, 0.035, 0.085], [0.04, 0.022, 0.03], { color: WHITE, mat: 'dark', k: 0.008 }); // toe cap
            for (let l = 0; l < 3; l++) L.limb([[-0.025, 0.07, 0.02 - l * 0.018], [0.025, 0.07, 0.02 - l * 0.018]], [0.003, 0.003], { color: WHITE, mat: 'cloth', k: 0.002 });
          });
        }
      });
      k.sculpt(L);
      return k.g;
    },
  },

  buzzsaw: {
    name: 'CockSaw Man', blurb: 'Revs up before every T-bag.',
    build(c) {
      const k = kit();
      const SK = '#d9a07c';
      const C = k.clay();
      const skin = { color: SK, mat: 'skin', bump: [0.0008, 120] };
      const denim = { color: '#3b5578', mat: 'cloth', bump: [0.0012, 140], tint: [{ t: 'noise', a: 0.12, f: 60 }] };
      const flannel = { color: c, mat: 'cloth', bump: [0.0008, 120], tint: [{ t: 'plaid', f: 16, c: darken(c, 0.6), amt: 0.8 }, { t: 'stripes', ax: [1, 0, 0], f: 48, c: lighten(c, 0.35), w: 0.85, soft: 0.1, amt: 0.6 }] };

      // Chunky work boots, jeans
      for (const s of [-1, 1]) {
        C.at([s * 0.085, 0, 0.005], [0, s * 0.1, 0], () => sShoe(C, { color: '#6b4628', sole: '#1c1814', h: 0.12, w: 1.18, toe: 1.05 }));
        sLeg(C, [[s * 0.085, 0.43, 0], [s * 0.09, 0.27, 0.012], [s * 0.085, 0.12, 0]], [0.068, 0.06, 0.056], { ...denim, k: 0.015 });
      }
      // Big frame in flannel, overalls bib and straps over it
      C.limb([[0, 0.38, 0], [0, 0.58, 0], [0, 0.75, 0]], [0.18, 0.19, 0.16], { ...flannel, k: 0.03 });
      C.ell([0, 0.66, 0.02], [0.18, 0.1, 0.15], { ...flannel, k: 0.05 });
      C.cone([0, 0.36, 0], [0, 0.47, 0], 0.188, 0.186, { ...denim, k: 0.006 });
      C.box([0, 0.55, 0.168], [0.2, 0.2, 0.06], 0.02, { ...denim, k: 0.006 });
      C.box([0, 0.57, 0.2], [0.08, 0.06, 0.008], 0.003, { ...denim, color: '#2f4565', k: 0.003 }); // bib pocket
      for (const s of [-1, 1]) C.limb([[s * 0.08, 0.64, 0.19], [s * 0.12, 0.76, 0.1], [s * 0.1, 0.77, -0.12], [s * 0.08, 0.5, -0.18]], [0.013, 0.013, 0.013, 0.013], { ...denim, k: 0.004 });
      // Shoulders, sleeves rolled to the elbow, hairy forearms; both hands on the chainsaw
      for (const s of [-1, 1]) C.ell([s * 0.2, 0.71, 0], [0.075, 0.07, 0.075], { ...flannel, k: 0.04 });
      const arms = [[[-0.21, 0.7, 0], [-0.26, 0.56, 0.06], [-0.12, 0.5, 0.17]], [[0.21, 0.7, 0], [0.26, 0.56, 0.04], [0.14, 0.58, 0.16]]];
      for (const [a, b, w] of arms) {
        C.limb([a, b], [0.06, 0.052], { ...flannel, k: 0.02 });
        C.torus(b, 0.054, 0.016, { ...flannel, k: 0.006, rot: [Math.PI / 2, 0, 0.6] });
        C.limb([b, w], [0.046, 0.04], { ...skin, k: 0.012, bump: [0.002, 160], tint: { t: 'mix', c: darken(SK, 0.25), f: 90, th: 0.55, amt: 0.6 } });
      }
      C.at([-0.12, 0.49, 0.18], [0, 0, 0.6], () => sHand(C, { s: 1.4, skin: SK, fist: true, side: 1 }));
      C.at([0.14, 0.57, 0.17], [0, 0, -0.9], () => sHand(C, { s: 1.4, skin: SK, fist: true, side: -1 }));
      k.sculpt(C);
      const steel = k.M(STEEL, { metalness: 0.85, roughness: 0.25 });
      for (const s of [-1, 1]) {
        for (let l = 0; l < 3; l++) k.tor(0.034, 0.003, '#d8c9a0', [s * 0.085, 0.07 + l * 0.022, 0.05], { rot: [Math.PI / 2, 0, 0], arc: Math.PI, ts: 12 });
        k.rbox(0.035, 0.03, 0.012, 0.005, steel, [s * 0.08, 0.64, 0.2]);
      }
      // The chainsaw
      const saw = k.grp([0.02, 0.53, 0.21], { rot: [0, -0.15, 0.15] });
      k.rbox(0.18, 0.12, 0.09, 0.025, k.M('#f08c2a', { roughness: 0.45 }), [0, 0, 0], { parent: saw });
      k.rbox(0.08, 0.05, 0.095, 0.01, DARK, [-0.03, -0.035, 0], { parent: saw });
      k.tube([[-0.08, 0.06, 0], [-0.02, 0.11, 0], [0.06, 0.06, 0]], 0.012, 0.012, DARK, { parent: saw, seg: 16 });
      k.cyl(0.015, 0.015, 0.03, '#888888', [0.07, 0.05, 0.03], { parent: saw, rot: [Math.PI / 2, 0, 0], seg: 12 });
      k.rbox(0.36, 0.06, 0.012, 0.025, steel, [0.25, -0.01, 0], { parent: saw });
      const teeth = [];
      for (let i = 0; i < 26; i++) {
        const x = 0.07 + (i / 26) * 0.36;
        teeth.push([[x, 0.025, 0], [0, 0, -0.4], [1, 1, 1]], [[x, -0.045, 0], [0, 0, Math.PI + 0.4], [1, 1, 1]]);
      }
      k.inst(new THREE.ConeGeometry(0.006, 0.016, 4), DARK, teeth, { parent: saw, m: { metalness: 0.6, roughness: 0.4 } });

      // Rugged head: square jaw, stubble, frown; goggles pushed up on the forehead; a saw-blade crest
      const hd = headAt(k, [0, 0.9, 0], [0, 0, 0], {
        r: 0.12, skin: SK, jaw: 1.25, chin: 1.3, nose: 'broad', noseSize: 1.1, brows: '#3a2618', browR: 0.011, browArch: -0.5, mouth: 'frown', lids: 0.4,
        eye: { iris: '#3e5a2a' },
      }, (H, r) => {
        // stubble: a dark shadow over the jaw, cheeks and upper lip
        H.ell([0, -r * 0.5, r * 0.32], [r * 0.82, r * 0.5, r * 0.62], { color: darken(SK, 0.35), mat: 'skin', k: r * 0.015, bump: [r * 0.01, 1 / (r * 0.03)], clip: [[0, -r * 0.1, 0], [0, 1, -0.25], r * 0.05] });
        H.ell([0, r * 0.12, -r * 0.1], [r * 0.93, r * 0.9, r * 0.96], { color: '#3a2618', mat: 'hair', k: r * 0.04, bump: [r * 0.012, 1 / (r * 0.05)], clip: [[0, r * 0.5, r * 0.4], [0, -0.5, 1], r * 0.05] });
      });
      k.g.userData.face = hd;
      for (const s of [-1, 1]) {
        k.cyl(0.028, 0.028, 0.025, IRON, [s * 0.035, 0.095, 0.1], { parent: hd, rot: [Math.PI / 2 - 0.5, 0, 0] });
        k.cyl(0.022, 0.022, 0.006, k.M('#ffb347', { metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.8 }), [s * 0.035, 0.102, 0.111], { parent: hd, rot: [Math.PI / 2 - 0.5, 0, 0] });
      }
      k.tor(0.124, 0.012, DARK, [0, 0.07, 0], { parent: hd, rot: [Math.PI / 2 - 0.3, 0, 0] });
      const blade = [];
      for (let i = 0; i < 48; i++) {
        const a = (i / 48) * TAU;
        const rr = i % 2 ? 0.115 : 0.14;
        blade.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      const bl = k.grp([0, 0.17, -0.01], { parent: hd, rot: [0, Math.PI / 2, 0] });
      k.ext(blade, 0.006, steel, [0, 0, 0], { parent: bl, bevel: 0.002 });
      k.cyl(0.035, 0.035, 0.016, '#c43a2a', [0, 0, 0], { parent: bl, rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU;
        k.cyl(0.006, 0.006, 0.02, k.M('#d6dbe2', { metalness: 0.9, roughness: 0.2 }), [Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0], { parent: bl, rot: [Math.PI / 2, 0, 0], seg: 6 });
      }
      return k.g;
    },
  },

  dog: {
    name: 'Amigo', blurb: 'Fetches aura. Brings it back. Keeps it.',
    build(c) {
      const k = kit();
      const tan = '#d48a3f';
      const cream = '#f5e6cc';
      const dog = k.grp([0, 0, 0], { rot: [0, -0.6, 0] });
      const C = k.clay();
      // Shiba colouring: tan on top, cream on the chest, belly, legs and muzzle, all in one fur
      const fur = { color: tan, mat: 'fur', bump: [0.0025, 85], tint: [{ t: 'noise', a: 0.1, f: 16 }, { t: 'grad', ax: [0, -1, 0], a0: -0.4, a1: -0.33, c: cream, amt: 1 }] };
      const creamF = { color: cream, mat: 'fur', bump: [0.0025, 85], tint: { t: 'noise', a: 0.06, f: 16 } };

      // Body, deep chest, haunches
      C.ell([0, 0.41, 0], [0.27, 0.15, 0.15], { ...fur, k: 0 });
      C.ell([0.18, 0.42, 0], [0.12, 0.14, 0.13], { ...fur, k: 0.06 });
      C.ell([0.21, 0.4, 0], [0.09, 0.12, 0.11], { ...creamF, k: 0.05 });
      C.ell([-0.19, 0.42, 0], [0.11, 0.12, 0.13], { ...fur, k: 0.06 });
      // Legs with paws and toes
      for (const [x, z, back] of [[0.18, 0.085, 0], [0.18, -0.085, 0], [-0.2, 0.095, 1], [-0.2, -0.095, 1]]) {
        if (back) C.ell([x - 0.01, 0.34, z * 1.05], [0.075, 0.1, 0.055], { ...fur, k: 0.04 });
        C.limb([[x, 0.36, z], [x + (back ? -0.035 : 0.01), 0.2, z], [x + 0.008, 0.05, z]], [0.045, 0.034, 0.03], { ...(back ? fur : creamF), k: 0.02 });
        C.ell([x + 0.025, 0.026, z], [0.045, 0.026, 0.036], { ...creamF, k: 0.02 });
        for (let t = 0; t < 4; t++) C.ball([x + 0.058, 0.02, z + (t - 1.5) * 0.015], 0.012, { ...creamF, k: 0.008 });
      }
      // Curled tail over the back, cream underneath
      C.limb([[-0.28, 0.48, 0], [-0.35, 0.58, 0], [-0.3, 0.665, 0.02], [-0.22, 0.62, 0.03]], [0.04, 0.042, 0.032, 0.02], { ...fur, k: 0.03, seg: 10, tint: [{ t: 'noise', a: 0.1, f: 16 }, { t: 'grad', ax: [0, -1, 0], a0: -0.62, a1: -0.58, c: cream, amt: 0.8 }] });
      // Neck and the head, turned toward the viewer
      C.limb([[0.22, 0.47, 0], [0.28, 0.56, 0]], [0.09, 0.08], { ...fur, k: 0.05 });
      const H = [0.3, 0.62, 0];
      const HR = [0, 0.6, 0];
      C.at(H, HR, () => {
        const face = { color: tan, mat: 'fur', bump: [0.002, 110], tint: [{ t: 'noise', a: 0.1, f: 16 }] };
        C.ell([0, 0.01, -0.01], [0.115, 0.105, 0.11], { ...face, k: 0 });
        // fluffy cream cheeks and muzzle, a little nose bridge
        for (const s of [-1, 1]) C.ell([s * 0.06, -0.04, 0.06], [0.06, 0.05, 0.055], { ...creamF, k: 0.03 });
        C.ell([0, -0.035, 0.12], [0.05, 0.04, 0.06], { ...creamF, k: 0.03 });
        C.ell([0, -0.012, 0.175], [0.022, 0.016, 0.014], { color: '#151316', mat: 'gloss', k: 0.008 });
        C.ell([0, -0.075, 0.13], [0.032, 0.016, 0.03], { color: '#5a2a2a', mat: 'lips', op: 'sub', k: 0.012, paint: true });
        C.limb([[-0.035, -0.058, 0.155], [0, -0.066, 0.168], [0.035, -0.058, 0.155]], [0.003, 0.004, 0.003], { op: 'sub', k: 0.004, color: '#3a2020', paint: true });
        // brow dots, eye sockets
        for (const s of [-1, 1]) {
          C.ell([s * 0.045, 0.066, 0.098], [0.014, 0.008, 0.008], { ...creamF, k: 0.006 });
          C.ball([s * 0.045, 0.025, 0.095], 0.027, { ...face, op: 'sub', k: 0.008 });
          C.ball([s * 0.045, 0.025, 0.095], 0.029, { ...face, k: 0.006, clip: [[s * 0.045, 0.04, 0.095], [0, -1, -0.3], 0.003] });
          // pointy ears, pink inside
          C.at([s * 0.07, 0.09, -0.01], [-0.15, 0, s * -0.3], () => {
            C.cone([0, 0, 0], [0, 0.1, 0], 0.04, 0.006, { ...face, k: 0.02, clip: [[0, 0, -0.012], [0, 0, -1], 0.004] });
            C.cone([0, 0.01, 0.005], [0, 0.075, 0.005], 0.024, 0.004, { color: '#f2a6a6', mat: 'skin', op: 'sub', k: 0.004, paint: true });
          });
        }
      });
      C.torus([0.25, 0.53, 0], 0.085, 0.016, { color: c, mat: 'leather', k: 0.004, rot: [0, 0, Math.PI / 2 - 0.5] });
      k.sculpt(C, { parent: dog });

      const hd = k.grp(H, { parent: dog, rot: HR });
      k.g.userData.face = hd;
      for (const s of [-1, 1]) eye(k, hd, [s * 0.045, 0.025, 0.095], 0.026, { iris: '#4a2a14', rot: [0, s * 0.3, 0] });
      k.ext([[-0.02, 0], [0.02, 0], [0.022, -0.035], [0, -0.045], [-0.022, -0.035]], 0.006, k.M('#ef7f8f', { roughness: 0.3 }), [0, -0.09, 0.145], { parent: hd, rot: [-0.4, 0, 0], smooth: true, bevel: 0.004 });
      // Studs on the collar and a gold bone-shaped tag
      const goldM = k.M(GOLD, { metalness: 0.8, roughness: 0.25 });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        k.sph(0.006, k.M(STEEL, { metalness: 0.8 }), [0.25 + Math.sin(a) * 0.045, 0.53 + Math.cos(a) * 0.085, Math.sin(a) * 0.085], { parent: dog, seg: 8 });
      }
      const tag = k.grp([0.31, 0.45, 0], { parent: dog, rot: [0, Math.PI / 2, 0] });
      k.rbox(0.04, 0.014, 0.004, 0.003, goldM, [0, 0, 0], { parent: tag });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.sph(0.008, goldM, [sx * 0.02, sy * 0.006, 0], { parent: tag, scale: [1, 1, 0.4], seg: 10 });
      return k.g;
    },
  },

  jetpack: {
    name: 'Mr CockMan', blurb: 'Never touches the ground. Never touches grass either.',
    build(c) {
      const k = kit();
      const SUIT = '#2b2f38';
      const body = k.grp([0, 0.14, 0]); // hovering
      const B = { parent: body };
      const C = k.clay();
      const suit = { color: SUIT, mat: 'leather', bump: [0.0006, 140] };
      const armor = { color: c, mat: 'gloss', k: 0.006 };
      const metal = { color: '#8b929d', mat: 'metal', k: 0.006 };

      // Legs: undersuit, thigh plates, knee pads, shin guards, armoured boots dangling as he hovers
      for (const s of [-1, 1]) {
        sLeg(C, [[s * 0.07, 0.4, 0], [s * 0.075, 0.24, 0.03], [s * 0.07, 0.08, -0.01]], [0.052, 0.045, 0.04], { ...suit, k: 0.015, knee: false });
        C.box([s * 0.075, 0.33, 0.04], [0.09, 0.11, 0.05], 0.02, { ...armor, rot: [0.1, 0, 0] });
        C.ell([s * 0.076, 0.24, 0.058], [0.036, 0.034, 0.025], metal);
        C.box([s * 0.072, 0.15, 0.03], [0.08, 0.13, 0.042], 0.018, { ...armor, rot: [-0.08, 0, 0] });
        C.at([s * 0.07, -0.03, -0.01], [0.35, 0, 0], () => sShoe(C, { color: '#8b929d', sole: '#1a1c20', h: 0.08, mat: 'metal' }));
      }
      // Torso: undersuit, a sculpted chest plate, abdomen plates, belt with pouches
      C.ell([0, 0.56, 0], [0.145, 0.19, 0.11], { ...suit, k: 0.03 });
      C.ell([0, 0.69, 0], [0.165, 0.08, 0.12], { ...suit, k: 0.05 });
      C.ell([0, 0.64, 0.025], [0.165, 0.1, 0.11], { ...armor, k: 0.01, clip: [[0, 0.56, 0], [0, -1, -0.3], 0.006] });
      for (let i = 0; i < 3; i++) C.box([0, 0.52 - i * 0.04, 0.1], [0.11 - i * 0.01, 0.032, 0.03], 0.012, armor);
      C.torus([0, 0.4, 0], 0.142, 0.016, { color: '#1d2026', mat: 'leather', k: 0.004 });
      for (const s of [-1, 1]) C.box([s * 0.11, 0.39, 0.1], [0.05, 0.05, 0.03], 0.01, { color: '#3a3f49', mat: 'leather', k: 0.004, rot: [0, s * 0.5, 0] });
      // Shoulder pads, arms with gauntlets, armoured fists
      for (const s of [-1, 1]) {
        C.ell([s * 0.2, 0.71, 0], [0.085, 0.07, 0.078], { ...armor, rot: [0, 0, s * 0.3], clip: [[s * 0.2, 0.68, 0], [s * 0.3, -1, 0], 0.004] });
        C.torus([s * 0.2, 0.68, 0], 0.075, 0.007, { ...metal, rot: [0, 0, s * 0.3] });
      }
      const arms = [[[-0.2, 0.68, 0], [-0.24, 0.55, 0.02], [-0.23, 0.44, 0.06]], [[0.2, 0.68, 0], [0.25, 0.57, 0.06], [0.2, 0.55, 0.17]]];
      for (const pts of arms) {
        sArm(C, pts, [0.042, 0.038, 0.034], { ...suit, k: 0.02 });
        C.limb([pts[1].map((v, i) => v + (pts[2][i] - v) * 0.25), pts[2]], [0.042, 0.04], { ...armor, k: 0.008 });
      }
      C.at([-0.23, 0.435, 0.06], [0, 0, 0.1], () => sHand(C, { s: 1.35, skin: c, mat: 'gloss', fist: true, side: 1 }));
      C.at([0.2, 0.55, 0.18], [Math.PI / 2, 0, 0], () => sHand(C, { s: 1.35, skin: c, mat: 'gloss', fist: true, side: -1 }));
      // Helmet: a rounded shell with a jaw guard
      C.at([0, 0.86, 0], [0, 0, 0], () => {
        C.ell([0, 0, 0], [0.11, 0.117, 0.12], { ...armor, k: 0 });
        C.box([0, -0.08, 0.06], [0.09, 0.05, 0.05], 0.02, { color: '#30343d', mat: 'metal', k: 0.02 });
        C.limb([[0, 0.12, -0.06], [0, 0.13, 0.04]], [0.012, 0.01], { ...armor, k: 0.01 }); // crest
      });
      C.cone([0, 0.76, 0], [0, 0.82, 0], 0.055, 0.05, { ...suit, k: 0.02 }); // neck seal
      k.sculpt(C, B);

      const metalM = k.M('#8b929d', { metalness: 0.85, roughness: 0.25 });
      const visor = k.M('#5fe1ff', { emissive: new THREE.Color('#2fb8e0'), emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.05 });
      const flame = (col, op) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
      for (const s of [-1, 1]) {
        k.cyl(0.02, 0.016, 0.02, '#22252b', [s * 0.07, -0.03, -0.04], B);
        k.cone(0.018, 0.12, flame('#ffb347', 0.8), [s * 0.07, -0.1, -0.04], { ...B, rot: [Math.PI, 0, 0], shadow: false });
      }
      k.rbox(0.07, 0.07, 0.02, 0.01, visor, [0, 0.64, 0.14], B);
      // Blaster in the right hand
      k.rbox(0.05, 0.06, 0.12, 0.012, '#30343d', [0.2, 0.57, 0.22], B);
      k.cyl(0.014, 0.014, 0.1, metalM, [0.2, 0.585, 0.3], { ...B, rot: [Math.PI / 2, 0, 0] });
      k.rbox(0.008, 0.01, 0.1, 0.003, visor, [0.226, 0.57, 0.22], B);
      // Helmet visor, vents, ear modules with lights, antenna
      const hd = k.grp([0, 0.86, 0], B);
      const H = { parent: hd };
      k.put(new THREE.SphereGeometry(0.1215, 48, 24, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.3), visor, [0, 0, 0.004], { ...H, scale: [0.94, 1.0, 1.02] });
      for (let i = 0; i < 4; i++) k.rbox(0.05, 0.004, 0.005, 0.0015, metalM, [0, -0.07 - i * 0.01, 0.087], H);
      for (const s of [-1, 1]) {
        k.cyl(0.035, 0.035, 0.03, metalM, [s * 0.11, 0, 0], { ...H, rot: [0, 0, Math.PI / 2] });
        k.cyl(0.015, 0.015, 0.008, basic('#ff5a5a'), [s * 0.127, 0, 0], { ...H, rot: [0, 0, Math.PI / 2], seg: 12 });
      }
      k.cyl(0.003, 0.003, 0.08, metalM, [0.11, 0.06, -0.02], { ...H, seg: 6 });
      k.sph(0.006, basic('#ff5a5a'), [0.11, 0.1, -0.02], { ...H, seg: 8 });
      k.g.userData.face = hd;
      // Jetpack: rounded housing, fins, twin thrusters with layered flames
      k.rbox(0.24, 0.26, 0.1, 0.035, k.M('#3a3f49', { metalness: 0.6, roughness: 0.35 }), [0, 0.6, -0.17], B);
      k.rbox(0.16, 0.06, 0.02, 0.01, k.M(c, { metalness: 0.45, roughness: 0.3 }), [0, 0.67, -0.225], B);
      for (const s of [-1, 1]) {
        k.ext([[0, 0], [0.07, -0.02], [0.07, -0.1], [0, -0.05]], 0.008, k.M(c, { metalness: 0.45, roughness: 0.3 }), [s * 0.16, 0.65, -0.17], { ...B, rot: [0, s > 0 ? 0 : Math.PI, 0], bevel: 0.003 });
        const th = k.grp([s * 0.08, 0.47, -0.2], B);
        k.cyl(0.045, 0.05, 0.14, metalM, [0, 0.03, 0], { parent: th });
        k.cyl(0.055, 0.04, 0.05, '#2a2d33', [0, -0.06, 0], { parent: th, open: true });
        k.tor(0.05, 0.006, k.M(c, { metalness: 0.45, roughness: 0.3 }), [0, 0.07, 0], { parent: th, rot: [Math.PI / 2, 0, 0] });
        k.cone(0.042, 0.4, flame('#ff7a1a', 0.55), [0, -0.29, 0], { parent: th, rot: [Math.PI, 0, 0], shadow: false });
        k.cone(0.03, 0.28, flame('#ffd04a', 0.75), [0, -0.22, 0], { parent: th, rot: [Math.PI, 0, 0], shadow: false });
        k.cone(0.016, 0.16, flame('#ffffff', 0.9), [0, -0.15, 0], { parent: th, rot: [Math.PI, 0, 0], shadow: false });
      }
      return k.g;
    },
  },

  hotdog: {
    name: 'COCK Dog', blurb: 'Came to the party in costume. Never took it off.',
    build(c) {
      const k = kit();
      const C = k.clay();
      const denim = { color: '#3b5578', mat: 'cloth', bump: [0.0012, 140], tint: { t: 'noise', a: 0.12, f: 60 } };
      // Jeans and sneakers in the rider's colour
      for (const s of [-1, 1]) {
        sLeg(C, [[s * 0.07, 0.32, 0], [s * 0.075, 0.19, 0.012], [s * 0.072, 0.07, 0]], [0.052, 0.047, 0.044], { ...denim, k: 0.012, knee: false });
        C.at([s * 0.075, 0, 0.02], [0, s * 0.1, 0], () => sShoe(C, { color: c, sole: '#f4f1ea', mat: 'leather', w: 1.05 }));
      }
      // Hoodie arms coming out between the bun halves, hands in loose fists
      for (const s of [-1, 1]) {
        sArm(C, [[s * 0.2, 0.68, 0], [s * 0.28, 0.56, 0.04], [s * 0.27, 0.45, 0.1]], [0.042, 0.038, 0.034], { color: c, mat: 'cloth', k: 0.02, bump: [0.0008, 120] });
        C.torus([s * 0.27, 0.46, 0.098], 0.033, 0.012, { color: darken(c, 0.2), mat: 'cloth', k: 0.004, rot: [0.4, 0, 0] });
        C.at([s * 0.27, 0.445, 0.1], [0.4, 0, 0], () => sHand(C, { s: 1.25, fist: true, side: -s }));
      }
      k.sculpt(C);

      // The costume: a long glossy sausage with a hole for the face, wrapped in two toasted bun halves
      const S = k.clay();
      const sausage = { color: '#b5502f', mat: 'gloss', bump: [0.0012, 80], tint: [{ t: 'noise', a: 0.12, f: 12 }, { t: 'mix', c: '#8e3a20', f: 9, th: 0.62, amt: 0.6 }] };
      S.limb([[0, 0.24, 0], [0, 0.66, 0.0], [0, 1.08, 0]], [0.13, 0.135, 0.13], { ...sausage, k: 0 });
      S.ell([0, 0.83, 0.12], [0.085, 0.1, 0.08], { ...sausage, op: 'sub', k: 0.02 });
      S.torus([0, 0.83, 0.105], 0.085, 0.016, { ...sausage, k: 0.02, rot: [Math.PI / 2 + 0.1, 0, 0] });
      // Mustard zigzag and a ketchup squiggle in the rider's colour, painted on the front
      const zig = [];
      for (let i = 0; i <= 12; i++) zig.push([(i % 2 ? 1 : -1) * 0.05, 0.71 - i * 0.04, 0.128]);
      S.limb(zig, [0.011, 0.011], { color: '#ffd23f', mat: 'gloss', k: 0.004, seg: 60 });
      const sq = [];
      for (let i = 0; i <= 14; i++) sq.push([Math.sin(i * 0.9) * 0.03, 0.7 - i * 0.032, 0.132]);
      S.limb(sq, [0.007, 0.007], { color: c, mat: 'gloss', k: 0.003, seg: 60 });
      const bun = {
        color: '#e2a75e', mat: 'cloth', bump: [0.002, 60],
        tint: [{ t: 'grad', ax: [0, 0, -1], a0: -0.02, a1: 0.12, c: '#b8732f', amt: 0.9 }, { t: 'noise', a: 0.08, f: 30 }],
      };
      for (const s of [-1, 1]) {
        S.limb([[s * 0.13, 0.25, -0.02], [s * 0.135, 0.62, -0.03], [s * 0.13, 0.99, -0.02]], [0.1, 0.11, 0.1], { ...bun, k: 0.01 });
        S.ell([s * 0.135, 0.62, -0.03], [0.1, 0.42, 0.135], { ...bun, k: 0.05 });
      }
      k.sculpt(S);

      // The face peeking out of the hole
      const hd = headAt(k, [0, 0.83, 0.055], [0, 0, 0], { r: 0.075, ears: false, mouth: 'grin', brows: '#4a3020', browR: 0.006, eye: { iris: '#3a5a8a' } });
      hd.scale.setScalar(1.05);
      k.g.userData.face = hd;
      return k.g;
    },
  },

  sensei: {
    name: 'Sensei', blurb: "Blindfolded, hands in pockets, smirking. Your T-bag never even touched him.",
    build(c) {
      const k = kit();
      const SKIN_FAIR = '#f1d5c2';
      const navyC = '#171b2c';
      const C = k.clay();
      const navy = { color: navyC, mat: 'cloth', bump: [0.0008, 150], tint: { t: 'noise', a: 0.08, f: 25 } };
      const skin = { color: SKIN_FAIR, mat: 'skin' };

      // Plain black shoes under loose, straight trousers
      for (const s of [-1, 1]) {
        C.at([s * 0.058, 0, 0.005], [0, s * 0.12, 0], () => sShoe(C, { color: '#121216', sole: '#08080a', mat: 'gloss', w: 0.95 }));
        sLeg(C, [[s * 0.058, 0.5, 0], [s * 0.059, 0.27, 0.004], [s * 0.06, 0.055, 0.004]], [0.048, 0.045, 0.043], { ...navy, k: 0.01, knee: false });
      }
      // Long jacket: fitted at broad shoulders, loose through the body, seamless front down to mid-thigh
      C.ell([0, 0.47, 0], [0.105, 0.07, 0.075], { ...navy, k: 0.03 });
      C.ell([0, 0.6, 0], [0.112, 0.19, 0.078], { ...navy, k: 0.03, disp: { t: 'ribs', n: 7, a: 0.0016, fade: [0.0, -0.15] } });
      C.ell([0, 0.73, -0.004], [0.13, 0.075, 0.08], { ...navy, k: 0.05 });
      for (const s of [-1, 1]) C.ell([s * 0.116, 0.765, -0.004], [0.056, 0.038, 0.06], { ...navy, k: 0.04 });
      C.ell([0, 0.43, 0.004], [0.11, 0.03, 0.078], { ...navy, k: 0.03 });
      // Tall stiff collar right up under the jaw
      C.cyl([0, 0.83, 0.004], 0.05, 0.08, 0.01, { ...navy, k: 0.015 });
      // Left hand shoved in the pocket
      sArm(C, [[-0.128, 0.765, 0], [-0.152, 0.63, -0.02], [-0.118, 0.51, 0.035]], [0.037, 0.034, 0.034], { ...navy, k: 0.02 });
      C.ell([-0.108, 0.5, 0.05], [0.012, 0.03, 0.014], { ...navy, op: 'sub', k: 0.006, color: '#07080d', paint: true, rot: [0, 0, -0.3] });
      // Right hand raised lazily, palm up, fingers relaxed
      sArm(C, [[0.128, 0.765, 0], [0.205, 0.67, 0.05], [0.172, 0.79, 0.118]], [0.037, 0.034, 0.032], { ...navy, k: 0.02 });
      C.torus([0.17, 0.787, 0.12], 0.03, 0.006, { color: '#0f121d', mat: 'cloth', k: 0.004, rot: [0.6, 0, 0.3] });
      C.at([0.165, 0.79, 0.135], [0, 0, Math.PI / 2], () => C.at([0, 0, 0], [-Math.PI / 2, 0, 0], () => sHand(C, { s: 1.12, skin: SKIN_FAIR, curl: 0.55, side: 1 })));
      k.sculpt(C);
      // A little orb of aura in the rider's colour, hovering over the palm
      k.sph(0.024, k.M(c, { emissive: c, emissiveIntensity: 1.6, roughness: 0.2 }), [0.15, 0.885, 0.165], { seg: 24 });
      k.sph(0.04, k.M(c, { emissive: c, emissiveIntensity: 0.6, transparent: true, opacity: 0.25 }), [0.15, 0.885, 0.165], { seg: 24, shadow: false });

      // Handsome sharp-jawed face, head tilted, a cocky smirk; black blindfold; snow-white hair pushed up by the band
      const r = 0.062;
      const hairM = { color: '#f2f4f8', mat: 'hair', k: r * 0.1 };
      const hd = headAt(k, [0, 0.905, 0.008], [0.06, 0.1, 0.13], { r, skin: SKIN_FAIR, jaw: 0.9, chin: 1.2, nose: 'fine', mouth: 'smirk', brows: false, eyes: false, lids: 0.6 }, (H, r) => {
        const ey = r * 0.06;
        // the blindfold: a glossy band wrapped temple to temple, knotted at the back with two short tails
        H.cyl([0, ey, -r * 0.02], r * 1.02, r * 0.42, r * 0.06, { color: '#0b0b0f', mat: 'leather', k: r * 0.02 });
        H.ball([0, ey, -r * 1.04], r * 0.16, { color: '#0b0b0f', mat: 'leather', k: r * 0.04 });
        for (const s of [-1, 1]) H.limb([[s * r * 0.05, ey, -r * 1.08], [s * r * 0.22, ey - r * 0.4, -r * 1.16], [s * r * 0.28, ey - r * 0.85, -r * 1.12]], [r * 0.09, r * 0.08, r * 0.05], { color: '#0b0b0f', mat: 'leather', k: r * 0.03 });
        // hair: a cap with spikes sticking up and out, the front ones pushed up by the band
        H.ell([0, r * 0.32, -r * 0.08], [r * 0.98, r * 0.78, r * 1.0], { ...hairM, k: r * 0.05, clip: [[0, ey + r * 0.2, 0], [0, -1, 0], r * 0.05] });
        const rand = rng(77);
        for (let i = 0; i < 46; i++) {
          const phi = rand() * TAU;
          const th = 0.08 + Math.pow(rand(), 0.8) * 1.25;
          const d = new THREE.Vector3(Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi));
          if (d.z > 0.2) d.y += 0.6; // the band pushes the front up
          d.z -= 0.1;
          d.normalize();
          const base = new THREE.Vector3(0, r * 0.22, -r * 0.06).addScaledVector(d, r * 0.7);
          const len = r * (0.7 + rand() * 0.9) * (d.y > 0.7 ? 1.25 : 1);
          const tip = base.clone().addScaledVector(d, len).add(new THREE.Vector3(0, len * 0.15, 0));
          H.cone(base.toArray(), tip.toArray(), r * (0.2 + rand() * 0.1), r * 0.012, hairM);
        }
      });
      k.g.userData.face = hd;
      return k.g;
    },
  },

  leech: {
    name: 'Merry', blurb: 'Latches on and drains. Never lets go.',
    build(c) {
      const k = kit();
      const C = k.clay();
      // Glossy dark body ringed like a real leech, rearing up from a coil, with two stripes in the rider's colour
      // and yellow spots down its sides
      const slime = {
        color: '#3d2e2a', mat: 'slime', bump: [0.0012, 90],
        tint: [{ t: 'noise', a: 0.15, f: 12 }, { t: 'spots', f: 70, th: 0.8, c: '#e8c34a' }],
      };
      const path = [[-0.18, 0.06, -0.12], [0.05, 0.07, -0.2], [0.2, 0.07, -0.05], [0.12, 0.1, 0.12], [-0.02, 0.25, 0.08], [0.0, 0.48, 0.02], [0.05, 0.68, 0.06], [0.06, 0.8, 0.13]];
      const radius = t => 0.05 + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.06 + (t > 0.85 ? (t - 0.85) * 0.25 : 0);
      C.limb(path, radius, { ...slime, k: 0.02, seg: 40, disp: { t: 'rings', a: 0.0035, f: 55 } });
      const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p)), false, 'centripetal');
      for (const off of [-0.6, 0.6]) {
        const pts = [];
        for (let i = 0; i <= 14; i++) {
          const t = 0.04 + (i / 14) * 0.9;
          const p = curve.getPointAt(t);
          const r = radius(t);
          const d = new THREE.Vector3(Math.sin(off) * 0.6, 0.55, -Math.cos(off) * 0.3).normalize().multiplyScalar(r * 1.0);
          pts.push([p.x + d.x, p.y + d.y, p.z + d.z]);
        }
        C.limb(pts, [0.009, 0.009], { color: c, mat: 'slime', k: 0.004, seg: 28 });
      }
      // Head: a flared oral sucker with a thick lip, a deep throat, eyespots round the rim
      const end = curve.getPointAt(1);
      const HP = [end.x, end.y + 0.02, end.z + 0.02];
      const HR = [-0.9, 0, 0];
      C.at(HP, HR, () => {
        C.cyl([0, 0, 0], 0.098, 0.05, 0.02, { ...slime, k: 0.02 });
        C.torus([0, 0.022, 0], 0.088, 0.017, { color: darken(c, 0.1), mat: 'slime', k: 0.008 });
        C.cyl([0, 0.03, 0], 0.07, 0.05, 0.02, { color: '#5a1e24', mat: 'lips', op: 'sub', k: 0.012, paint: true });
        C.ball([0, -0.01, 0], 0.035, { color: '#2a080c', mat: 'lips', op: 'sub', k: 0.02, paint: true });
        for (let e = 0; e < 5; e++) {
          const a = Math.PI * 1.2 + (e / 4) * Math.PI * 0.6;
          C.ball([Math.cos(a) * 0.08, -0.006, Math.sin(a) * 0.08], 0.008, { color: '#0b0a0e', mat: 'gloss', k: 0.003 });
        }
      });
      k.sculpt(C);
      // Rings of tiny teeth and three jaws inside the sucker
      const hd = k.grp(HP, { rot: HR });
      k.g.userData.face = hd;
      const teeth = [];
      for (const [R, n, y] of [[0.062, 24, 0.022], [0.046, 18, 0.016], [0.03, 12, 0.01]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          teeth.push([[Math.cos(a) * R, y, Math.sin(a) * R], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], [1, 1, 1]]);
        }
      }
      k.inst(new THREE.ConeGeometry(0.0045, 0.016, 5), k.M('#f3ead2', { roughness: 0.3 }), teeth, { parent: hd });
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * TAU + Math.PI / 2;
        k.rbox(0.03, 0.012, 0.012, 0.005, '#f3ead2', [Math.cos(a) * 0.015, 0.016, Math.sin(a) * 0.015], { parent: hd, rot: [0, -a, 0] });
      }
      // A drop of slime dripping off the lip
      k.sph(0.014, k.M('#a9e36b', { transparent: true, opacity: 0.75, roughness: 0.05 }), [0.0, -0.035, 0.105], { parent: hd, scale: [1, 1.5, 1] });
      return k.g;
    },
  },

  poop: {
    name: 'Lefteris', blurb: 'Smells like victory. Mostly smells.',
    build(c) {
      const k = kit();
      const C = k.clay();
      const brown = {
        color: '#7a4a26', mat: 'gloss', bump: [0.0015, 70],
        tint: [{ t: 'noise', a: 0.12, f: 9 }, { t: 'mix', c: '#5c3418', f: 6, th: 0.6, amt: 0.6 }],
      };
      // Three coils melting into each other, smaller toward the top, each one swirling a little off-centre
      [[0.3, 0.135, 0.13, 0], [0.225, 0.118, 0.345, 0.012], [0.15, 0.1, 0.535, -0.01]].forEach(([R, t, y, dx]) => {
        C.torus([dx, y, 0], R - t * 0.6, t, { ...brown, k: 0.05 });
        C.cyl([dx, y, 0], R - t * 0.8, t * 1.5, t * 0.6, { ...brown, k: 0.04 });
      });
      // Curled tip
      C.limb([[0, 0.6, 0.02], [0.02, 0.72, 0.03], [-0.03, 0.8, 0.0], [-0.08, 0.8, -0.02]], [0.085, 0.06, 0.035, 0.018], { ...brown, k: 0.04, seg: 10 });
      // A grooved line spiralling down the coils
      for (let i = 0; i < 50; i++) {
        const t = i / 50;
        const a = t * TAU * 2.6;
        const R = 0.3 - t * 0.16;
        const y = 0.06 + t * 0.56;
        C.ball([Math.cos(a) * R, y, Math.sin(a) * R], 0.007, { ...brown, op: 'sub', k: 0.006 });
      }
      // Eye sockets with heavy lids; a big open smile with a tongue
      for (const s of [-1, 1]) {
        C.ball([s * 0.09, 0.4, 0.27], 0.07, { ...brown, op: 'sub', k: 0.012 });
        C.ball([s * 0.09, 0.4, 0.27], 0.074, { ...brown, k: 0.01, clip: [[s * 0.09, 0.43, 0.27], [0, -1, -0.3], 0.004] });
      }
      C.ell([0, 0.2, 0.33], [0.13, 0.075, 0.08], { color: '#3a1418', mat: 'gloss', op: 'sub', k: 0.02, paint: true, clip: [[0, 0.215, 0.33], [0, 1, 0], 0.008] });
      C.box([0, 0.207, 0.335], [0.15, 0.022, 0.03], 0.008, { color: '#fbf7ef', mat: 'gloss', k: 0.004 });
      C.ell([0, 0.163, 0.335], [0.052, 0.026, 0.035], { color: '#e8616d', mat: 'lips', k: 0.012 });
      k.sculpt(C);
      for (const s of [-1, 1]) eye(k, k.g, [s * 0.09, 0.4, 0.27], 0.065, { iris: '#2b1a10', rot: [0, s * 0.25, 0] });
      k.g.userData.face = k.grp([0, 0.36, 0.25]);
      // A few flies buzzing round the tip
      const fly = k.M('#1a1a1e', { roughness: 0.4 });
      const wing = k.M('#e8f2ff', { transparent: true, opacity: 0.55, roughness: 0.1, side: THREE.DoubleSide });
      for (const [x, y, z] of [[0.14, 0.86, 0.05], [-0.16, 0.92, -0.04], [0.04, 0.98, -0.1]]) {
        k.sph(0.008, fly, [x, y, z], { scale: [1.3, 1, 1], seg: 10 });
        for (const s of [-1, 1]) k.sph(0.008, wing, [x, y + 0.006, z + s * 0.008], { scale: [1.2, 0.2, 0.7], rot: [s * 0.5, 0, 0], seg: 10, shadow: false });
      }
      return k.g;
    },
  },

  ronin: {
    name: 'Sausage', blurb: 'Blade at his back, never says a word. Gone before you see the T-bag.',
    build(c) {
      const k = kit();
      const SKIN_PALE = '#efd8c8';
      const C = k.clay();
      const skin = { color: SKIN_PALE, mat: 'skin' };
      const kimonoC = '#ebe5d9';
      const kimono = { color: kimonoC, mat: 'cloth', bump: [0.0008, 140], tint: { t: 'noise', a: 0.04, f: 22 } };
      const navy = { color: '#1d2438', mat: 'cloth', bump: [0.0008, 140] };
      const trousers = { color: '#2a3a5e', mat: 'cloth', bump: [0.0008, 140], tint: { t: 'noise', a: 0.06, f: 22 } };
      const wraps = { color: '#1d2438', mat: 'cloth', tint: { t: 'stripes', ax: [0.2, 1, 0], f: 70, c: '#2c3554', w: 0.2, soft: 0.25 } };

      // Bare feet on flat sandals, legs wrapped from ankle to knee, loose tapering trousers above
      for (const s of [-1, 1]) {
        C.at([s * 0.075, 0, 0.01], [0, s * 0.08, 0], () => {
          C.box([0, 0.006, 0.03], [0.07, 0.012, 0.15], 0.005, { color: '#2a2433', mat: 'leather', k: 0.002 });
          C.ell([0, 0.026, 0.03], [0.033, 0.02, 0.062], { ...skin, k: 0.01 });
          for (let i = 0; i < 4; i++) C.ball([(i - 1.5) * 0.012, 0.02, 0.088 - Math.abs(i - 1.5) * 0.005], 0.0072, { ...skin, k: 0.004 });
          for (const z of [0.03, 0.062]) C.box([0, 0.03, z], [0.072, 0.008, 0.012], 0.003, { ...navy, k: 0.003 });
        });
        sLeg(C, [[s * 0.072, 0.29, 0.01], [s * 0.074, 0.16, 0.004], [s * 0.075, 0.04, 0.012]], [0.043, 0.036, 0.03], { ...wraps, k: 0.01, knee: false });
        sLeg(C, [[s * 0.06, 0.49, 0], [s * 0.07, 0.37, 0.012], [s * 0.072, 0.27, 0.01]], [0.066, 0.06, 0.05], { ...trousers, k: 0.02, knee: false, disp: { t: 'folds', ax: [1, 0, 0.6], f: 90, a: 0.0025 } });
      }
      C.ell([0, 0.47, 0], [0.105, 0.075, 0.08], { ...trousers, k: 0.03 });
      // Lean torso: chest, pecs, a six-pack, collarbones and the neck
      C.ell([0, 0.62, 0], [0.098, 0.16, 0.07], { ...skin, k: 0.03 });
      C.ell([0, 0.71, -0.004], [0.122, 0.07, 0.074], { ...skin, k: 0.05 });
      for (const s of [-1, 1]) {
        C.ell([s * 0.045, 0.672, 0.055], [0.05, 0.034, 0.024], { ...skin, k: 0.02 });
        for (const y of [0.53, 0.568, 0.606]) C.ell([s * 0.021, y, 0.058], [0.018, 0.015, 0.012], { ...skin, k: 0.012 });
        C.limb([[s * 0.012, 0.765, 0.05], [s * 0.07, 0.775, 0.04]], [0.007, 0.006], { ...skin, k: 0.01 });
      }
      C.cone([0, 0.76, 0.0], [0, 0.85, 0.004], 0.042, 0.036, { ...skin, k: 0.02 });
      // Kimono shirt hanging open in a deep V, with a wide rolled collar
      for (const s of [-1, 1]) {
        const V = { clip: [[0, 0.45, 0], [-s, 0.46, 0], 0.004] };
        C.ell([0, 0.6, 0], [0.112, 0.17, 0.083], { ...kimono, k: 0.004, ...V, disp: { t: 'folds', ax: [1, 0, 0], f: 110, a: 0.0015 } });
        C.ell([0, 0.725, -0.006], [0.14, 0.07, 0.086], { ...kimono, k: 0.04, ...V });
        C.limb([[s * 0.025, 0.47, 0.082], [s * 0.05, 0.6, 0.088], [s * 0.075, 0.73, 0.08], [s * 0.06, 0.8, 0.02], [0, 0.805, -0.045]], [0.008, 0.011, 0.014, 0.014, 0.012], { ...kimono, k: 0.006 });
        // wide sleeves to mid-forearm
        C.limb(s > 0 ? [[0.14, 0.73, 0], [0.18, 0.62, -0.005], [0.196, 0.53, 0.01]] : [[-0.14, 0.73, 0], [-0.19, 0.63, -0.04], [-0.215, 0.55, -0.085]], [0.05, 0.056, 0.064], { ...kimono, k: 0.02 });
      }
      // Navy arm warmers and hands: right resting by the hilt, left hanging loose
      sArm(C, [[0.15, 0.72, 0], [0.19, 0.585, -0.01], [0.2, 0.445, 0.03]], [0.032, 0.029, 0.025], { ...navy, k: 0.015 });
      sArm(C, [[-0.15, 0.72, 0], [-0.205, 0.6, -0.06], [-0.235, 0.49, -0.12]], [0.032, 0.029, 0.025], { ...navy, k: 0.015 });
      C.at([0.2, 0.44, 0.03], [0, 0, 0.05], () => sHand(C, { s: 1.1, skin: SKIN_PALE, fist: true, side: -1 }));
      C.at([-0.235, 0.485, -0.12], [0.3, 0, -0.2], () => sHand(C, { s: 1.1, skin: SKIN_PALE, curl: 0.35, side: 1 }));
      // Thick braided rope belt looped three times, sitting low and loose, with a big bow at the back
      const rope = { color: '#4b2a6e', mat: 'cloth', k: 0.003, tint: { t: 'stripes', ax: [1, 1.6, 0], f: 70, c: '#6a3f96', w: 0.1, soft: 0.4 }, bump: [0.0008, 200] };
      [[0.475, 0.12, 0.06], [0.5, 0.118, -0.04], [0.523, 0.116, 0.03]].forEach(([y, R, tilt]) => C.torus([0, y, 0], R, 0.015, { ...rope, rot: [0.1 + tilt, 0, 0] }));
      C.ball([0, 0.495, -0.115], 0.024, { ...rope, k: 0.006 });
      for (const s of [-1, 1]) {
        C.torus([s * 0.048, 0.5, -0.118], 0.034, 0.013, { ...rope, k: 0.006, rot: [Math.PI / 2, 0, s * 0.3] });
        C.limb([[s * 0.008, 0.485, -0.12], [s * 0.022, 0.44, -0.125], [s * 0.028, 0.4, -0.118]], [0.013, 0.012, 0.01], { ...rope, k: 0.006 });
      }
      // Navy waist cloth hanging front and back
      for (const z of [0.098, -0.1]) C.box([0, 0.33, z], [0.15, 0.16, 0.014], 0.006, { color: '#26304c', mat: 'cloth', k: 0.006, rot: [z > 0 ? -0.1 : 0.1, 0, 0], disp: { t: 'folds', ax: [1, 0, 0], f: 160, a: 0.0015 } });
      k.sculpt(C);

      // Red-and-white paper fan on the upper back
      const fan = k.grp([0, 0.67, -0.11], { rot: [0, Math.PI, 0] });
      const half = (start, col) => k.put(new THREE.CylinderGeometry(0.03, 0.03, 0.003, 32, 1, false, start, Math.PI), col, [0, 0.006, 0.001], { parent: fan, rot: [Math.PI / 2, 0, 0] });
      half(Math.PI / 2, k.M('#b3262e', { roughness: 0.6 }));
      half(-Math.PI / 2, k.M('#f2eee6', { roughness: 0.6 }));
      // Straight katana slid through the belt at the small of the back, hilt out to his right
      const sheath = k.M('#1a1820', { roughness: 0.3, metalness: 0.15 });
      const sw = k.grp([0.02, 0.45, -0.14], { rot: [0, 0, -0.1] });
      k.tube([[0.2, 0, 0], [0.05, 0, 0], [-0.14, 0, 0]], 0.014, 0.014, sheath, { parent: sw, seg: 10 });
      k.cyl(0.018, 0.018, 0.012, k.M(GOLD, { metalness: 0.7, roughness: 0.3 }), [-0.145, 0, 0], { parent: sw, rot: [0, 0, Math.PI / 2] });
      k.tube([[-0.152, 0, 0], [-0.3, 0, 0]], 0.012, 0.012, k.M(c, { map: T.checker(c, [4, 1]), roughness: 0.7 }), { parent: sw, seg: 8 });
      k.sph(0.014, '#2b2832', [-0.305, 0, 0], { parent: sw, scale: [0.6, 1, 1] });

      // Narrow, angular face with sharp black eyes and low brows; jet-black hair swept back in spikes, long bangs
      const r = 0.08;
      const hair = { color: '#101219', mat: 'hair', k: r * 0.05 };
      const hd = headAt(k, [0, 0.905, 0.01], [0, 0, 0], {
        r, skin: SKIN_PALE, jaw: 0.82, chin: 1.3, nose: 'fine', mouth: 'flat', brows: '#14161f', browR: r * 0.05, browArch: -0.4, browLift: -0.04,
        eyeR: r * 0.15, lids: 0.42, eye: { iris: '#141214', irisSize: 0.75 },
      }, (H, r) => {
        H.ell([0, r * 0.2, -r * 0.12], [r * 0.98, r * 0.92, r * 1.02], { ...hair, clip: [[0, r * 0.55, r * 0.5], [0, -0.4, 1], r * 0.04] });
        const spike = (pts, w) => H.limb(pts, t => w * Math.pow(1 - t, 0.9) + r * 0.035, { ...hair, seg: 6 });
        for (const [elev, n, len] of [[0.75, 4, 1.25], [0.35, 5, 1.55], [-0.05, 4, 1.3]]) {
          for (let i = 0; i < n; i++) {
            const a = (i / (n - 1) - 0.5) * 1.5;
            const base = new THREE.Vector3(Math.sin(a) * r * 0.55, r * (0.25 + elev * 0.45), -r * 0.55);
            const dir = new THREE.Vector3(Math.sin(a) * 0.8, elev, -1).normalize().multiplyScalar(len * r);
            const mid = base.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, r * 0.1, 0));
            spike([base.toArray(), mid.toArray(), base.clone().add(dir).toArray()], r * 0.26);
          }
        }
        for (const x of [-0.4, -0.1, 0.2, 0.5]) spike([[x * r, r * 0.95, r * 0.35], [x * r * 1.1, r * 1.15, -r * 0.2], [x * r * 1.3, r * 1.05, -r * 0.85]], r * 0.2);
        for (const x of [-0.5, -0.2, 0.15, 0.45]) spike([[x * r, r, r * 0.35], [x * r * 1.05, r * 0.85, r * 0.82], [x * r * 1.15, r * 0.55, r * 1.0]], r * 0.16);
        for (const s of [-1, 1]) {
          spike([[s * r * 0.3, r * 0.95, r * 0.55], [s * r * 0.74, r * 0.45, r * 0.86], [s * r * 0.88, -r * 0.25, r * 0.72], [s * r * 0.82, -r * 0.95, r * 0.5]], r * 0.2);
          spike([[s * r * 0.55, r * 0.9, r * 0.3], [s * r * 0.94, r * 0.25, r * 0.58], [s * r * 1.02, -r * 0.5, r * 0.4], [s * r * 0.94, -r, r * 0.22]], r * 0.22);
        }
        spike([[-r * 0.05, r * 0.9, r * 0.72], [-r * 0.1, r * 0.5, r * 1.0], [-r * 0.03, r * 0.1, r * 1.08]], r * 0.07);
      });
      k.g.userData.face = hd;
      return k.g;
    },
  },

};

export const CHAMPION_IDS = Object.keys(CHAMPIONS);

// Build a champion scaled to fit on a tile: about 0.55 tall, never too wide for its spot.
// quality: 'board' (pawns, lobby pictures) or 'hero' (the big close-up). Sculpted parts mesh in the background:
// the model is measured and placed right away, and wrap.userData.ready resolves once every part is in.
export function buildChampion(id, color, quality = 'board') {
  const def = CHAMPIONS[id] || CHAMPIONS.camel;
  const prev = voxel;
  voxel = VOXEL[quality] || VOXEL.board;
  let model;
  try { model = def.build(color); } finally { voxel = prev; }
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const s = Math.min(0.55 / size.y, 0.5 / Math.max(size.x, size.z));
  model.scale.setScalar(s);
  model.position.y = -box.min.y * s;
  const wrap = new THREE.Group();
  wrap.add(model);
  wrap.userData.height = size.y * s;
  wrap.userData.face = model.userData.face || null;
  // Added after measuring, so the glow doesn't count towards the model's size.
  if (def.mythic) wrap.add(mythicGlow(size.y * s, Math.max(size.x, size.z) * s));
  wrap.userData.ready = clayReady(model).then(() => wrap);
  return wrap;
}

// Mythic tier: a pulsing golden halo, a turning rune ring on the ground, rising sparks and a warm light.
// Animated in onBeforeRender so it moves in every view (board, lobby spinner, close-up) without a hook.
const glowTex = () => tex('mythic-halo', (g, n) => {
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,236,160,0.95)');
  grad.addColorStop(0.25, 'rgba(255,200,70,0.55)');
  grad.addColorStop(0.6, 'rgba(255,160,20,0.15)');
  grad.addColorStop(1, 'rgba(255,140,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
});
const ringTex = () => tex('mythic-ring', (g, n) => {
  const c = n / 2;
  g.clearRect(0, 0, n, n);
  g.lineCap = 'round';
  g.shadowColor = '#ffb300';
  g.shadowBlur = 10;
  g.strokeStyle = 'rgba(255,215,90,0.95)';
  g.lineWidth = 5;
  g.beginPath(); g.arc(c, c, n * 0.44, 0, TAU); g.stroke();
  g.lineWidth = 2.5;
  g.beginPath(); g.arc(c, c, n * 0.36, 0, TAU); g.stroke();
  // Little rune ticks between the two circles
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU;
    const r0 = n * (i % 2 ? 0.375 : 0.385);
    const r1 = n * (i % 2 ? 0.405 : 0.425);
    g.beginPath();
    g.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0);
    g.lineTo(c + Math.cos(a + 0.06) * r1, c + Math.sin(a + 0.06) * r1);
    g.stroke();
  }
  const grad = g.createRadialGradient(c, c, 0, c, c, n * 0.44);
  grad.addColorStop(0, 'rgba(255,200,60,0.35)');
  grad.addColorStop(1, 'rgba(255,200,60,0)');
  g.fillStyle = grad;
  g.beginPath(); g.arc(c, c, n * 0.44, 0, TAU); g.fill();
});
const sparkTex = () => tex('mythic-spark', (g, n) => {
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(0.3, 'rgba(255,210,80,0.8)');
  grad.addColorStop(1, 'rgba(255,170,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, n, n);
}, { size: 64 });

function mythicGlow(h, w) {
  const g = new THREE.Group();
  const add = { blending: THREE.AdditiveBlending, transparent: true, depthWrite: false };
  const now = () => performance.now() / 1000;

  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: '#ffd166', opacity: 0.85, ...add }));
  const hs = Math.max(h, w) * 1.9;
  halo.position.y = h * 0.5;
  halo.scale.setScalar(hs);
  halo.renderOrder = -1;
  halo.onBeforeRender = () => halo.scale.setScalar(hs * (1 + Math.sin(now() * 2.4) * 0.07));
  g.add(halo);

  const ring = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex(), color: '#ffcc4d', side: THREE.DoubleSide, ...add }));
  const rs = w * 1.5;
  ring.rotation.x = -Math.PI / 2;
  ring.userData.glow = true;
  ring.position.y = 0.004;
  ring.scale.setScalar(rs);
  ring.onBeforeRender = () => {
    ring.rotation.z = now() * 0.6;
    ring.scale.setScalar(rs * (1 + Math.sin(now() * 2.4) * 0.04));
  };
  g.add(ring);

  // Sparks drift up through the figure and loop back to the ground
  const N = 36;
  const seeds = Array.from({ length: N }, (_, i) => ({ a: (i / N) * TAU * 3.7, r: w * (0.25 + ((i * 37) % 11) / 22), sp: 0.12 + ((i * 13) % 7) / 40, o: (i * 0.618) % 1 }));
  const pos = new Float32Array(N * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ map: sparkTex(), color: '#ffe08a', size: h * 0.07, sizeAttenuation: true, ...add }));
  sparks.frustumCulled = false;
  sparks.onBeforeRender = () => {
    const t = now();
    seeds.forEach((s, i) => {
      const u = (s.o + t * s.sp) % 1;
      const a = s.a + t * 0.8;
      pos[i * 3] = Math.cos(a) * s.r * (1 - u * 0.4);
      pos[i * 3 + 1] = u * h * 1.25;
      pos[i * 3 + 2] = Math.sin(a) * s.r * (1 - u * 0.4);
    });
    geo.attributes.position.needsUpdate = true;
  };
  g.add(sparks);

  const light = new THREE.PointLight('#ffc23d', 1.2, h * 3, 1.5);
  light.position.set(0, h * 0.6, w * 0.3);
  g.add(light);
  return g;
}

// Lobby pictures: one small offscreen renderer draws every champion into its own 2D canvas,
// turning slowly, about 30 times a second while the picker is on screen.
const THUMB = 112;
const SPIN = 0.6; // radians per second
// Phones and tablets: every picture is drawn once and only the picked champion keeps turning. Drawing all of them
// 30 times a second (each copied out of WebGL) is fine on a desktop GPU but makes a phone's lobby stutter and run hot.
const LITE = matchMedia('(pointer: coarse)').matches;
const spin = { renderer: null, scene: null, cam: null, color: null, models: new Map(), canvases: new Map(), drawn: new Set(), focus: null, last: 0 };

// The champion that keeps turning on phones (the one you picked).
export function setChampionFocus(id) { spin.focus = id; }

function setupSpin() {
  spin.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  spin.renderer.setPixelRatio(2);
  spin.renderer.setSize(THUMB, THUMB, false);
  spin.scene = new THREE.Scene();
  spin.scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3448, 2.2));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-2, 4, 3);
  spin.scene.add(sun);
  spin.cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  spin.cam.position.set(0, 0.6, 1.25);
  spin.cam.lookAt(0, 0.27, 0);
  requestAnimationFrame(spinFrame);
}

function spinFrame(t) {
  requestAnimationFrame(spinFrame);
  if (t - spin.last < 33) return;
  spin.last = t;
  const live = [...spin.canvases].filter(([, cv]) => cv.isConnected);
  if (!live.length || document.hidden) return;
  const r = spin.renderer;
  live.forEach(([id, cv], n) => {
    const m = spin.models.get(id);
    if (!m) return;
    if (LITE && id !== spin.focus && spin.drawn.has(id)) return;
    spin.drawn.add(id);
    m.rotation.y = LITE && id !== spin.focus ? 0.5 : (t / 1000) * SPIN + n * 0.4;
    spin.scene.add(m);
    r.render(spin.scene, spin.cam);
    spin.scene.remove(m);
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(r.domElement, 0, 0, cv.width, cv.height);
  });
}

// The canvas for one champion in the rider's colour. Reuses the same canvas across lobby re-renders.
export function championCanvas(id, color) {
  if (!spin.renderer) setupSpin();
  if (spin.color !== color) {
    spin.color = color;
    spin.models.clear();
    spin.drawn.clear();
  }
  if (!spin.models.has(id)) {
    const m = buildChampion(id, color);
    spin.models.set(id, m);
    m.userData.ready.then(() => spin.drawn.delete(id));
  }
  let cv = spin.canvases.get(id);
  if (!cv) {
    cv = document.createElement('canvas');
    cv.width = cv.height = THUMB * 2;
    spin.canvases.set(id, cv);
  }
  return cv;
}

// A head-and-shoulders picture of a champion for the player list. Rendered once per champion and colour.
const portraits = new Map();
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
export const portraitKey = (id, color) => `${id}|${color}`;
export function championPortrait(id, color) {
  const key = portraitKey(id, color);
  if (portraits.has(key)) return portraits.get(key);
  portraits.set(key, BLANK);
  if (!spin.renderer) setupSpin();
  buildChampion(id, color).userData.ready.then(m => {
    const url = drawPortrait(m);
    portraits.set(key, url);
    document.querySelectorAll('img[data-pk]').forEach(img => { if (img.dataset.pk === key) img.src = url; });
  });
  return BLANK;
}
function drawPortrait(m) {
  m.rotation.y = 0.3;
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m.children[0]); // the model, not a mythic glow
  const size = box.getSize(new THREE.Vector3());
  // Frame the top of the model: the face for people, the whole thing for short wide ones.
  let span = Math.min(size.y, Math.max(size.y * 0.5, Math.max(size.x, size.z) * 0.55));
  let cy = box.max.y - span / 2;
  let cx = 0;
  if (m.userData.face) {
    const f = m.userData.face.getWorldPosition(new THREE.Vector3());
    span = size.y * 0.45;
    cx = f.x;
    cy = f.y;
  }
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  const dist = (span * 0.62) / Math.tan(THREE.MathUtils.degToRad(15));
  cam.position.set(cx, cy + span * 0.15, dist + box.max.z * 0.5);
  cam.lookAt(cx, cy, 0);
  spin.scene.add(m);
  spin.renderer.render(spin.scene, cam);
  spin.scene.remove(m);
  return spin.renderer.domElement.toDataURL();
}

// Big close-up for the lobby: renders one champion large and sharp, turning slowly, while it's open.
export function createZoomView(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x3a3448, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(-1.5, 3, 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -1, right: 1, top: 1, bottom: -1, near: 0.1, far: 8 });
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xb9a8ff, 1.2);
  rim.position.set(2, 1.5, -2);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.ShadowMaterial({ opacity: 0.35 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 20);
  let model = null;
  let shown = null;
  let raf = 0;
  let t0 = 0;

  function frame(t) {
    raf = requestAnimationFrame(frame);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.floor(w * renderer.getPixelRatio())) {
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    if (model) model.rotation.y = 0.5 + ((t - t0) / 1000) * 0.5;
    renderer.render(scene, cam);
  }

  return {
    show(id, color) {
      const put = m => {
        if (model) scene.remove(model);
        model = m;
        scene.add(model);
        const hgt = model.userData.height;
        cam.position.set(0, hgt * 0.75, hgt * 2.6);
        cam.lookAt(0, hgt * 0.48, 0);
      };
      const want = `${id}|${color}`;
      shown = want;
      put(buildChampion(id, color));
      buildChampion(id, color, 'hero').userData.ready.then(m => {
        if (shown !== want) return;
        m.traverse(o => { if (o.isMesh && !o.userData.glow) o.castShadow = true; });
        put(m);
      });
      t0 = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      shown = null;
      if (model) scene.remove(model);
      model = null;
    },
  };
}
