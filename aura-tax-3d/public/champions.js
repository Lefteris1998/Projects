// The champions riders can play as. Each model is built in a 1-unit-tall space (y up, facing +z),
// then scaled down to fit a tile. The rider's colour is the model's main accent colour.
import * as THREE from '/vendor/three/three.module.js';

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
function eye(k, parent, pos, r, o = {}) {
  const e = k.grp(pos, { parent, rot: o.rot });
  k.sph(r, o.white || '#f7f4ee', [0, 0, 0], { parent: e, m: { roughness: 0.12 }, seg: 20 });
  if (o.glow) {
    k.sph(r * 0.75, basic(o.glow), [0, 0, r * 0.4], { parent: e, scale: [1, 1, 0.65], seg: 16 });
  } else {
    k.sph(r * 0.64, o.iris || '#6b4423', [0, 0, r * 0.56], { parent: e, scale: [1, 1, 0.5], m: { roughness: 0.15 }, seg: 20 });
    k.sph(r * 0.33, '#0b0a0e', [0, 0, r * 0.83], { parent: e, scale: o.slit ? [0.28, 1.2, 0.4] : [1, 1, 0.4], seg: 16 });
    k.sph(r * 0.14, basic('#ffffff'), [-r * 0.28, r * 0.3, r * 0.93], { parent: e, seg: 10 });
  }
  if (o.lid) k.put(new THREE.SphereGeometry(r * 1.12, 24, 12, 0, TAU, 0, Math.PI * (o.lidAmt || 0.36)), o.lid, [0, 0, 0], { parent: e, rot: [-0.35, 0, 0] });
  return e;
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
      const fur = k.M(sand, { map: T.fur(sand), bumpMap: T.bump('fur'), bumpScale: 1.5, roughness: 0.85 });
      const cam = k.grp([0, 0, 0], { rot: [0, -0.55, 0] });
      const P = { parent: cam };
      // Body, hump and chest
      k.sph(0.22, fur, [0, 0.6, 0], { ...P, scale: [1.5, 0.85, 0.78] });
      k.sph(0.17, fur, [-0.03, 0.76, 0], { ...P, scale: [1.15, 1, 0.8] });
      k.sph(0.12, fur, [0.25, 0.58, 0], { ...P, scale: [1, 1.15, 0.92] });
      k.sph(0.1, fur, [-0.26, 0.6, 0], { ...P, scale: [1, 1, 0.95] });
      // Legs: thigh, knobbly knee, thin shin, wide padded foot
      for (const [x, z, back] of [[0.22, 0.1, 0], [0.22, -0.1, 0], [-0.22, 0.1, 1], [-0.22, -0.1, 1]]) {
        k.tube([[x, 0.56, z], [x + (back ? -0.03 : 0.02), 0.4, z], [x, 0.28, z], [x + 0.01, 0.05, z]], 0.055, 0.024, fur, { ...P, radius: t => 0.055 - t * 0.03 + Math.exp(-((t - 0.55) ** 2) / 0.004) * 0.012 });
        k.sph(0.045, shade(sand, -0.35), [x + 0.015, 0.02, z], { ...P, scale: [1.35, 0.45, 1.05] });
        for (const tz of [-0.015, 0.015]) k.sph(0.016, shade(sand, -0.5), [x + 0.055, 0.015, z + tz], { ...P, seg: 10 });
      }
      // Neck and head
      k.tube([[0.3, 0.62, 0], [0.42, 0.6, 0], [0.52, 0.72, 0], [0.53, 0.92, 0]], 0.09, 0.055, fur, P);
      const hd = k.grp([0.56, 0.98, 0], P);
      k.g.userData.face = hd;
      const H = { parent: hd };
      k.sph(0.075, fur, [0, 0, 0], { ...H, scale: [1.15, 0.9, 0.85] });
      k.sph(0.06, fur, [0.09, -0.028, 0], { ...H, scale: [1.6, 0.82, 0.78] });
      k.sph(0.04, shade(sand, -0.1), [0.14, -0.065, 0], { ...H, scale: [1.2, 0.5, 0.85] });
      k.tube([[0.11, -0.05, -0.035], [0.17, -0.055, 0], [0.11, -0.05, 0.035]], 0.005, 0.005, '#5a3a2a', { ...H, caps: false });
      for (const s of [-1, 1]) {
        k.sph(0.012, '#2a1d17', [0.18, -0.01, s * 0.022], { ...H, scale: [0.6, 0.5, 1], seg: 10 });
        eye(k, hd, [0.03, 0.022, s * 0.056], 0.016, { iris: '#3a2214', lid: fur, rot: [0, s > 0 ? 0.6 : Math.PI - 0.6, 0] });
        for (let l = 0; l < 4; l++) k.cyl(0.0012, 0.0012, 0.014, DARK, [0.03 + (l - 1.5) * 0.007, 0.042, s * 0.065], { ...H, rot: [s * 0.6, 0, -0.3], seg: 4 });
        k.cone(0.016, 0.04, fur, [-0.04, 0.065, s * 0.045], { ...H, rot: [s * -0.5, 0, 0.4] });
      }
      // Bridle
      k.tor(0.058, 0.007, c, [0.1, -0.02, 0], { ...H, rot: [0, Math.PI / 2, 0], rs: 8, ts: 32 });
      // Tail
      k.tube([[-0.32, 0.66, 0], [-0.37, 0.52, 0], [-0.36, 0.4, 0.01]], 0.018, 0.009, fur, P);
      k.sph(0.025, k.M(shade(sand, -0.45), { map: T.fur(shade(sand, -0.45)) }), [-0.36, 0.37, 0.01], { ...P, scale: [0.8, 1.6, 0.8] });
      // Saddle blanket with fringe, saddle and rider
      const blanket = k.M(c, { map: T.stripes(c, shade(c, -0.3), 10), roughness: 0.8, side: THREE.DoubleSide });
      k.put(new THREE.SphereGeometry(0.195, 40, 16, 0, TAU, 0, Math.PI * 0.42), blanket, [-0.03, 0.76, 0], { ...P, scale: [1.18, 1, 0.98] });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * TAU;
        const x = -0.03 + Math.cos(a) * 0.195 * 1.18 * Math.sin(Math.PI * 0.42);
        const z = Math.sin(a) * 0.195 * 0.98 * Math.sin(Math.PI * 0.42);
        const y = 0.76 + 0.195 * Math.cos(Math.PI * 0.42);
        k.cyl(0.003, 0.003, 0.04, GOLD, [x, y - 0.02, z], { ...P, seg: 6 });
        k.sph(0.008, GOLD, [x, y - 0.042, z], { ...P, seg: 8 });
      }
      k.tor(0.07, 0.018, LEATHER, [-0.03, 0.93, 0], { ...P, rot: [Math.PI / 2, 0, 0] });
      k.cyl(0.075, 0.08, 0.025, shade(LEATHER, 0.1), [-0.03, 0.93, 0], P);
      k.cyl(0.012, 0.016, 0.08, LEATHER, [0.06, 0.97, 0], P);
      // Rider (faces +x, along the camel)
      const rd = k.grp([-0.04, 0.95, 0], P);
      const R = { parent: rd };
      const robe = k.M(WHITE, { map: T.speckle(WHITE, 0.08), roughness: 0.8 });
      k.lathe([[0, 0], [0.085, 0], [0.09, 0.05], [0.08, 0.14], [0.075, 0.2], [0.05, 0.24], [0, 0.25]], robe, [0, 0, 0], R);
      k.tor(0.085, 0.012, c, [0, 0.06, 0], { ...R, rot: [Math.PI / 2, 0, 0] });
      for (const s of [-1, 1]) {
        k.tube([[0.02, 0.03, s * 0.06], [0.1, 0.0, s * 0.15], [0.12, -0.13, s * 0.17]], 0.035, 0.026, robe, R);
        k.sph(0.03, LEATHER, [0.135, -0.15, s * 0.17], { ...R, scale: [1.6, 0.7, 1] });
        arm(k, rd, [[0, 0.2, s * 0.08], [0.06, 0.12, s * 0.1], [0.15, 0.13, s * 0.05]], 0.026, 0.02, robe, skinMat(k, SKIN), { handScale: 0.9 });
      }
      const rh = head(k, rd, [0, 0.31, 0], { r: 0.07, rot: [0, Math.PI / 2, 0], brows: '#3a2618' });
      k.put(new THREE.SphereGeometry(0.078, 32, 16, 0, TAU, 0, Math.PI * 0.55), robe, [0, 0.005, -0.005], { parent: rh });
      k.tor(0.074, 0.008, DARK, [0, 0.03, 0], { parent: rh, rot: [Math.PI / 2 - 0.15, 0, 0] });
      k.tube([[0, 0.02, -0.06], [0, -0.06, -0.09], [0, -0.14, -0.08]], 0.035, 0.02, robe, { parent: rh });
      // Reins from the rider's hands to the bridle
      for (const s of [-1, 1]) k.tube([[0.12, 1.03, s * 0.05], [0.35, 0.92, s * 0.06], [0.64, 0.97, s * 0.05]], 0.003, 0.003, LEATHER, { ...P, caps: false });
      return k.g;
    },
  },

  cactus: {
    name: 'COCKtus', blurb: 'Stands still. Hurts to T-bag.',
    build(c) {
      const k = kit();
      const green = '#4f9a55';
      const skin = k.M(green, { map: T.speckle(green, 0.1, [3, 3]), roughness: 0.5 });
      // Terracotta pot with a painted band and soil
      const clay = k.M('#c8653c', { map: T.speckle('#c8653c', 0.12), bumpMap: T.bump('rough'), bumpScale: 1, roughness: 0.85 });
      k.lathe([[0, 0], [0.17, 0], [0.18, 0.015], [0.21, 0.2], [0.245, 0.205], [0.25, 0.26], [0.235, 0.27], [0.215, 0.255], [0, 0.255]], clay);
      k.tor(0.197, 0.012, c, [0, 0.11, 0], { rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        k.sph(0.012, c, [Math.cos(a) * 0.2, 0.15, Math.sin(a) * 0.2], { seg: 10 });
      }
      k.cyl(0.215, 0.215, 0.01, k.M('#4a3226', { map: T.speckle('#4a3226', 0.25), roughness: 1 }), [0, 0.25, 0]);
      const r = rng(31);
      for (let i = 0; i < 9; i++) {
        const a = r() * TAU;
        const d = 0.13 + r() * 0.07;
        k.sph(0.012 + r() * 0.01, shade('#9a9086', r() * 0.3 - 0.15), [Math.cos(a) * d, 0.258, Math.sin(a) * d], { scale: [1, 0.6, 1], seg: 10 });
      }
      // Ribbed stem with a rounded ribbed top, and two arms
      const RIBS = [10, 0.08];
      k.tube([[0, 0.24, 0], [0, 0.6, 0], [0, 0.98, 0]], 0, 0, skin, { ribs: RIBS, radial: 80, seg: 40, caps: false, radius: t => (t < 0.85 ? 0.12 : 0.12 * Math.sqrt(Math.max(0, 1 - ((t - 0.85) / 0.15) ** 2))) });
      const armR = (base, t) => (t < 0.8 ? base : base * Math.sqrt(Math.max(0, 1 - ((t - 0.8) / 0.2) ** 2)));
      k.tube([[-0.08, 0.48, 0], [-0.22, 0.5, 0], [-0.27, 0.6, 0], [-0.27, 0.8, 0]], 0, 0, skin, { ribs: RIBS, radial: 60, seg: 36, caps: false, radius: t => armR(0.062, t) });
      k.tube([[0.08, 0.6, 0], [0.21, 0.61, 0], [0.24, 0.7, 0], [0.24, 0.84, 0]], 0, 0, skin, { ribs: RIBS, radial: 60, seg: 36, caps: false, radius: t => armR(0.054, t) });
      // Areoles (white fuzz) with spines, along the ridges of the stem
      const fuzz = [];
      const spines = [];
      for (let rib = 0; rib < 10; rib++) {
        const a = (rib / 10) * TAU;
        for (let y = 0.3; y < 0.92; y += 0.055) {
          const rr = 0.12 * 1.08 + 0.003;
          const p = [Math.cos(a) * rr, y + (rib % 2) * 0.027, Math.sin(a) * rr];
          fuzz.push([p, [0, 0, 0], [1, 1, 1]]);
          for (let s = 0; s < 3; s++) {
            const sa = a + (s - 1) * 0.5;
            spines.push([[p[0] + Math.cos(sa) * 0.012, p[1] + (s - 1) * 0.008, p[2] + Math.sin(sa) * 0.012], [0, -sa, Math.PI / 2 + (s - 1) * 0.3], [1, 1, 1]]);
          }
        }
      }
      k.inst(new THREE.SphereGeometry(0.008, 8, 6), '#f3efe0', fuzz, { m: { roughness: 1 } });
      k.inst(new THREE.ConeGeometry(0.0025, 0.03, 5), '#efe6c8', spines);
      // Flower on top and a bud on an arm
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * TAU;
        k.sph(0.03, c, [Math.cos(a) * 0.035, 0.985, Math.sin(a) * 0.035], { scale: [1.4, 0.35, 0.8], rot: [0, -a, 0.35], m: { roughness: 0.4 } });
      }
      k.sph(0.022, '#ffd34d', [0, 0.995, 0], { scale: [1, 0.6, 1] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        k.cyl(0.0015, 0.0015, 0.02, '#fff2a8', [Math.cos(a) * 0.01, 1.005, Math.sin(a) * 0.01], { rot: [Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4], seg: 4 });
      }
      k.sph(0.02, shade(c, 0.2), [-0.27, 0.835, 0], { scale: [0.8, 1.2, 0.8] });
      // Face
      for (const s of [-1, 1]) {
        eye(k, k.g, [s * 0.045, 0.66, 0.122], 0.026, { iris: '#2f1e14', lid: skin, rot: [0, s * 0.3, 0] });
        k.sph(0.018, k.M('#f2879a', { transparent: true, opacity: 0.8 }), [s * 0.075, 0.615, 0.115], { scale: [1.2, 0.6, 0.4] });
      }
      k.tube([[-0.03, 0.605, 0.128], [0, 0.592, 0.132], [0.03, 0.605, 0.128]], 0.004, 0.004, '#2a3a1e', { seg: 10, radial: 8 });
      return k.g;
    },
  },

  mrx: {
    name: 'Mr. X', blurb: 'Hands in pockets. Already three moves ahead of your T-bag.',
    build(c) {
      const k = kit();
      const SKIN_FAIR = '#f5e0d2';
      const skin = skinMat(k, SKIN_FAIR, 'skin', 0.4);
      const suit = k.M('#f2f0eb', { map: T.speckle('#f2f0eb', 0.04), bumpMap: T.bump('wrinkle'), bumpScale: 0.2, roughness: 0.6, side: THREE.DoubleSide });
      const shirt = k.M('#fbfbf8', { roughness: 0.5 });
      const red = k.M('#d3172b', { roughness: 0.35 });
      const metal = k.M('#d9dde3', { roughness: 0.15, metalness: 1 });
      const shoe = k.M('#efece6', { roughness: 0.12, metalness: 0.05 });
      const hair = new THREE.MeshPhysicalMaterial({ color: '#f6f7fa', roughness: 0.25, sheen: 1, sheenColor: new THREE.Color('#dfe6f5'), sheenRoughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2 });

      // Weight on the right leg, the left one loose and kicked out a little; polished shoes
      boot(k, k.g, [0.058, 0, 0.005], shoe, { h: 0.035, sole: '#cfcac0', rot: [0, 0.1, 0] });
      boot(k, k.g, [-0.1, 0, 0.012], shoe, { h: 0.035, sole: '#cfcac0', rot: [0, -0.3, 0] });
      k.tube([[0.055, 0.5, 0], [0.057, 0.27, 0.004], [0.058, 0.045, 0.004]], 0.042, 0.037, suit, { seg: 16, radial: 18 });
      k.tube([[-0.055, 0.5, 0], [-0.08, 0.27, 0.035], [-0.1, 0.045, 0.012]], 0.042, 0.037, suit, { seg: 16, radial: 18 });
      k.sph(0.1, suit, [0, 0.475, 0], { scale: [1.05, 0.65, 0.78] });

      // Crisp shirt, slim red tie with a shiny X clip
      k.lathe([[0, 0.44], [0.1, 0.44], [0.102, 0.52], [0.108, 0.6], [0.12, 0.7], [0.124, 0.75], [0.1, 0.785], [0.045, 0.8], [0, 0.805]], shirt, [0, 0, 0], { scale: [1, 1, 0.72] });
      k.cyl(0.035, 0.038, 0.06, skin, [0, 0.83, 0.004]);
      k.tor(0.039, 0.007, shirt, [0, 0.808, 0.004], { rot: [Math.PI / 2, 0, 0], rs: 8, ts: 32 });
      for (const s of [-1, 1]) k.ext([[0, 0], [s * 0.026, 0.006], [s * 0.012, -0.024]], 0.003, shirt, [s * 0.012, 0.8, 0.044], { rot: [-0.3, 0, 0], bevel: 0.001 });
      k.sph(0.011, red, [0, 0.79, 0.05], { scale: [1, 1.15, 0.8], seg: 14 });
      k.ext([[-0.009, 0.77], [0.009, 0.77], [0.014, 0.53], [0, 0.515], [-0.014, 0.53]], 0.003, red, [0, 0, 0.088], { center: false, bevel: 0.001 });
      for (const a of [0.6, -0.6]) k.rbox(0.026, 0.005, 0.003, 0.0015, metal, [0, 0.665, 0.093], { rot: [0, 0, a] });

      // Tailored single-breasted jacket: slim waist, one button done, notched lapels open over the shirt
      const jr = t => {
        const pts = [[0, 0.113], [0.3, 0.108], [0.7, 0.13], [0.9, 0.134], [1, 0.1]];
        for (let i = 1; i < pts.length; i++) {
          if (t <= pts[i][0]) return pts[i - 1][1] + ((t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])) * (pts[i][1] - pts[i - 1][1]);
        }
        return pts[pts.length - 1][1];
      };
      const jg = t => (t < 0.3 ? 0.6 - t * 1.5 : 0.15 + Math.pow((t - 0.3) / 0.7, 1.4) * 1.5);
      const [jy0, jy1] = [0.43, 0.79];
      k.put(openRobeGeo(jy0, jy1, jr, jg), suit);
      const edge = s => [0.3, 0.45, 0.6, 0.75, 0.9, 1].map(t => {
        const a = jg(t) / 2;
        const R = jr(t) + 0.004;
        return [s * Math.sin(a) * R, jy0 + (jy1 - jy0) * t, Math.cos(a) * R * 0.78];
      });
      for (const s of [-1, 1]) {
        k.tube(edge(s), 0.008, 0.01, suit, { seg: 30, radial: 8 });
        // The notch where lapel meets collar
        const [nx, ny, nz] = edge(s)[4];
        k.ext([[0, 0], [s * 0.018, 0.004], [s * 0.012, -0.012]], 0.003, suit, [nx + s * 0.004, ny - 0.01, nz + 0.003], { bevel: 0.001 });
      }
      k.tube([[0.08, 0.78, -0.02], [0, 0.795, -0.06], [-0.08, 0.78, -0.02]], 0.012, 0.012, suit, { seg: 20, radial: 8 });
      k.sph(0.006, '#dcd8d0', [0, 0.53, 0.087], { scale: [1, 1, 0.5], seg: 10 });
      // Pocket square in the rider's colour
      k.ext([[-0.018, 0], [0.018, 0], [0.012, 0.022], [0.002, 0.012], [-0.01, 0.026]], 0.004, k.M(c, { roughness: 0.4 }), [-0.07, 0.705, 0.084], { rot: [0, -0.6, 0], bevel: 0.001 });
      k.rbox(0.04, 0.004, 0.006, 0.002, suit, [-0.07, 0.703, 0.084], { rot: [0, -0.6, 0] });

      // Both hands tucked into the trouser pockets, red cuffs peeking out
      for (const s of [-1, 1]) {
        k.sph(0.05, suit, [s * 0.13, 0.755, -0.005], { seg: 20 });
        arm(k, k.g, [[s * 0.13, 0.76, 0], [s * 0.165, 0.61, -0.035], [s * 0.118, 0.475, 0.03]], 0.034, 0.03, suit, skin, { hand: false });
        k.tor(0.028, 0.008, red, [s * 0.12, 0.485, 0.028], { rot: [Math.PI / 2 + 0.4, s * 0.3, 0], rs: 8, ts: 24 });
      }

      // Angular face, calm smug smile, head tilted
      const r = 0.062;
      const hd = head(k, k.g, [0, 0.9, 0.008], {
        r, skinMat: skin, skin: SKIN_FAIR, rot: [0.03, -0.1, -0.1], scale: [0.9, 1.07, 1], jaw: [0.9, 0.88, 0.98],
        iris: '#3d3f45', lidAmt: 0.42, brows: '#e8eaee', browR: r * 0.04, noseScale: [0.7, 1.05, 1.15], mouth: false,
      });
      k.g.userData.face = hd;
      k.tube([[-r * 0.22, -r * 0.49, r * 0.88], [0, -r * 0.5, r * 0.95], [r * 0.16, -r * 0.47, r * 0.92], [r * 0.25, -r * 0.42, r * 0.85]], r * 0.028, r * 0.022, '#a8625e', { parent: hd, seg: 14, radial: 8 });

      // Square glasses: thin metal frames, tinted orange-gold lenses
      const lens = new THREE.MeshPhysicalMaterial({ color: '#ffa52e', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.6, emissive: '#c46a00', emissiveIntensity: 0.25 });
      const [gx, gy, gz, lw, lh, ft] = [r * 0.4, r * 0.1, r * 1.1, r * 0.36, r * 0.27, r * 0.025];
      for (const s of [-1, 1]) {
        const gl = k.grp([s * gx, gy, gz], { parent: hd, rot: [0, s * 0.15, 0] });
        k.rbox(lw, lh, r * 0.02, r * 0.01, lens, [0, 0, 0], { parent: gl, shadow: false });
        for (const y of [-1, 1]) k.cyl(ft, ft, lw + ft * 2, metal, [0, y * lh / 2, 0], { parent: gl, rot: [0, 0, Math.PI / 2], seg: 6 });
        for (const x of [-1, 1]) k.cyl(ft, ft, lh, metal, [x * lw / 2, 0, 0], { parent: gl, seg: 6 });
        k.tube([[s * (gx + lw / 2 + r * 0.02), gy + lh * 0.3, gz - r * 0.08], [s * r * 0.9, gy + lh * 0.2, r * 0.3], [s * r * 0.92, gy - r * 0.05, -r * 0.2]], ft, ft, metal, { parent: hd, seg: 10, radial: 6 });
      }
      k.cyl(ft, ft, gx * 2 - lw, metal, [0, gy + lh * 0.15, gz + r * 0.02], { parent: hd, rot: [0, 0, Math.PI / 2], seg: 6 });

      // Pure white hair slicked back off the forehead, with a strand or two falling forward
      k.sph(r * 1.07, hair, [0, r * 0.06, -r * 0.05], { parent: hd, tl: Math.PI * 0.55, rot: [-0.7, 0, 0], scale: [1, 1, 1.06] });
      for (const x of [-0.6, -0.3, 0, 0.3, 0.6]) {
        k.tube([[x * r, r * 0.86, r * 0.48], [x * r * 1.05, r * 1.08, -r * 0.1], [x * r * 1.1, r * 0.85, -r * 0.8], [x * r, r * 0.35, -r * 1.12]], r * 0.07, r * 0.05, hair, { parent: hd, seg: 24, radial: 8 });
      }
      k.tube([[r * 0.15, r * 0.88, r * 0.52], [r * 0.24, r * 0.7, r * 0.92], [r * 0.3, r * 0.42, r * 1.06]], r * 0.06, r * 0.012, hair, { parent: hd, seg: 12, radial: 8 });
      k.tube([[r * 0.3, r * 0.86, r * 0.5], [r * 0.4, r * 0.66, r * 0.9], [r * 0.42, r * 0.48, r * 1.0]], r * 0.045, r * 0.01, hair, { parent: hd, seg: 12, radial: 8 });
      return k.g;
    },
  },

  viking: {
    name: 'Torb', blurb: 'Raids your tiles, takes your aura.',
    build(c) {
      const k = kit();
      const skin = skinMat(k, '#e3a885');
      const furM = k.M('#7c7268', { map: T.fur('#7c7268'), bumpMap: T.bump('fur'), bumpScale: 2, roughness: 0.9 });
      const beard = k.M('#b5561f', { map: T.fur('#b5561f', [2, 4]), bumpMap: T.bump('fur'), bumpScale: 2, roughness: 0.8 });
      const tunic = k.M(c, { map: T.speckle(c, 0.12), roughness: 0.8 });
      const steel = k.M(STEEL, { metalness: 0.75, roughness: 0.3 });
      const goldM = k.M(GOLD, { metalness: 0.8, roughness: 0.3 });
      // Boots with fur cuffs and trousers with leg wraps
      for (const s of [-1, 1]) {
        boot(k, k.g, [s * 0.075, 0, 0], k.M(LEATHER, { roughness: 0.7 }), { cuff: furM, h: 0.13 });
        k.tube([[s * 0.075, 0.42, 0], [s * 0.08, 0.27, 0.01], [s * 0.075, 0.14, 0]], 0.058, 0.045, k.M('#4b4a52', { map: T.speckle('#4b4a52', 0.1) }));
        for (let w = 0; w < 4; w++) k.tor(0.05, 0.005, LEATHER, [s * 0.075, 0.18 + w * 0.05, 0], { rot: [Math.PI / 2 + 0.25, 0, 0] });
      }
      // Tunic, belt with buckle and pouch
      k.tube([[0, 0.3, 0], [0, 0.55, 0], [0, 0.74, 0]], 0, 0, tunic, { radial: 48, seg: 16, caps: false, ribs: [8, 0.025], radius: t => 0.17 - t * 0.03 + Math.sin(t * Math.PI) * 0.02 });
      k.cyl(0.14, 0.14, 0.02, tunic, [0, 0.74, 0]);
      k.tor(0.17, 0.018, LEATHER, [0, 0.43, 0], { rot: [Math.PI / 2, 0, 0] });
      k.rbox(0.06, 0.05, 0.015, 0.006, goldM, [0, 0.43, 0.185]);
      k.rbox(0.06, 0.07, 0.035, 0.012, LEATHER, [0.12, 0.38, 0.11], { rot: [0, 0.6, 0] });
      // Cloak around the shoulders and back, fur mantle and a brooch
      k.put(capeGeo(0.55, 0.5, 0.17, 0.08), k.M('#6c4f3a', { map: T.speckle('#6c4f3a', 0.1), side: THREE.DoubleSide, roughness: 0.9 }), [0, 0.5, 0]);
      k.tor(0.16, 0.05, furM, [0, 0.74, 0], { rot: [Math.PI / 2, 0, 0], scale: [1.1, 1, 1] });
      k.cyl(0.028, 0.028, 0.01, goldM, [-0.1, 0.72, 0.15], { rot: [Math.PI / 2 - 0.4, 0, 0] });
      k.tor(0.018, 0.004, DARK, [-0.1, 0.722, 0.156], { rot: [-0.4, 0, 0] });
      // Arms: axe in the right hand, shield on the left
      for (const s of [-1, 1]) k.sph(0.06, tunic, [s * 0.19, 0.7, 0], { seg: 20 });
      arm(k, k.g, [[0.19, 0.69, 0], [0.24, 0.55, 0.03], [0.22, 0.45, 0.12]], 0.05, 0.04, skin, skin, { cuff: LEATHER });
      arm(k, k.g, [[-0.19, 0.69, 0], [-0.25, 0.56, 0.02], [-0.22, 0.47, 0.1]], 0.05, 0.04, skin, skin, { cuff: LEATHER });
      const axe = k.grp([0.22, 0.42, 0.13], { rot: [0.25, 0, -0.15] });
      k.cyl(0.013, 0.015, 0.5, k.M(WOOD, { map: T.wood(WOOD) }), [0, 0.12, 0], { parent: axe });
      for (let w = 0; w < 3; w++) k.tor(0.015, 0.004, LEATHER, [0, 0.02 + w * 0.025, 0], { parent: axe, rot: [Math.PI / 2, 0, 0] });
      k.ext([[0, 0.04], [0.06, 0.07], [0.14, 0.12], [0.15, 0.01], [0.12, -0.08], [0.06, -0.04], [0, -0.02]], 0.012, steel, [0.07, 0.33, 0], { parent: axe, smooth: true, bevel: 0.004 });
      const shield = k.grp([-0.27, 0.48, 0.1], { rot: [0, -1.1, 0.1] });
      const plank = k.M(c, { map: T.vstripes(c, shade(c, -0.25), 6), bumpMap: T.bump('rough'), bumpScale: 1, roughness: 0.8 });
      k.cyl(0.17, 0.17, 0.02, plank, [0, 0, 0], { parent: shield, rot: [Math.PI / 2, 0, 0], seg: 48 });
      k.tor(0.17, 0.012, steel, [0, 0, 0], { parent: shield, ts: 64 });
      k.sph(0.045, steel, [0, 0, 0.01], { parent: shield, tl: Math.PI / 2, rot: [Math.PI / 2, 0, 0] });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * TAU;
        k.sph(0.006, steel, [Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.012], { parent: shield, seg: 8 });
      }
      // Head, braided beard, moustache and horned helmet
      const hd = head(k, k.g, [0, 0.86, 0], { r: 0.115, skinMat: skin, skin: '#e3a885', brows: '#9a4a1a', browR: 0.009, iris: '#3e6a8a', mouth: false, noseScale: [1, 1.1, 1.3] });
      k.sph(0.1, beard, [0, -0.08, 0.06], { parent: hd, scale: [1.05, 1.1, 0.75] });
      for (const s of [-1, 1]) {
        k.tube([[s * 0.005, -0.03, 0.115], [s * 0.05, -0.04, 0.11], [s * 0.08, -0.07, 0.09]], 0.014, 0.006, beard, { parent: hd });
        for (let b = 0; b < 5; b++) k.sph(0.017 - b * 0.0015, beard, [s * 0.04, -0.17 - b * 0.026, 0.08 - b * 0.004], { parent: hd, seg: 14 });
        k.tor(0.015, 0.005, steel, [s * 0.04, -0.29, 0.075], { parent: hd, rot: [Math.PI / 2, 0, 0] });
      }
      const helm = k.grp([0, 0.035, 0], { parent: hd });
      k.sph(0.125, steel, [0, 0, 0], { parent: helm, tl: Math.PI / 2 });
      k.tor(0.123, 0.012, goldM, [0, 0.005, 0], { parent: helm, rot: [Math.PI / 2, 0, 0] });
      for (const a of [0, Math.PI / 2, -Math.PI / 2]) k.rbox(0.014, 0.12, 0.01, 0.004, IRON, [Math.sin(a) * 0.118, 0.065, Math.cos(a) * 0.118], { parent: helm, rot: [Math.cos(a) * -0.55, a, 0] });
      k.rbox(0.018, 0.075, 0.012, 0.005, IRON, [0, -0.03, 0.124], { parent: helm });
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * TAU;
        k.sph(0.005, IRON, [Math.cos(a) * 0.128, 0.005, Math.sin(a) * 0.128], { parent: helm, seg: 8 });
      }
      for (const s of [-1, 1]) {
        k.tube([[s * 0.11, 0.04, 0], [s * 0.19, 0.08, 0.01], [s * 0.23, 0.17, 0.03], [s * 0.21, 0.25, 0.05]], 0.03, 0.004, k.M('#efe5cc', { roughness: 0.4 }), { parent: helm, seg: 30 });
        k.tor(0.032, 0.006, IRON, [s * 0.12, 0.045, 0], { parent: helm, rot: [0, Math.PI / 2, 0.4 * s] });
      }
      return k.g;
    },
  },

  dragon: {
    name: 'Dragunov', blurb: 'Small, but breathes fire in all chat.',
    build(c) {
      const k = kit();
      const scale = k.M(c, { map: T.scales(c), bumpMap: T.bump('rough', [4, 4]), bumpScale: 1.5, roughness: 0.45, metalness: 0.1 });
      const belly = k.M('#f0d9a2', { map: T.stripes('#f0d9a2', '#d9bd80', 16), roughness: 0.6 });
      const horn = k.M('#efe3c4', { roughness: 0.35 });
      const membrane = k.M(shade(c, -0.25), { side: THREE.DoubleSide, roughness: 0.6, transparent: true, opacity: 0.92 });
      // Sitting body, belly plates, neck
      k.sph(0.2, scale, [0, 0.36, 0], { scale: [1, 1.15, 1.05] });
      k.sph(0.16, belly, [0, 0.36, 0.08], { scale: [0.82, 1.2, 0.68] });
      k.tube([[0, 0.55, 0.0], [0, 0.66, 0.05], [0, 0.76, 0.07]], 0.11, 0.075, scale, { seg: 20 });
      k.sph(0.07, belly, [0, 0.62, 0.09], { scale: [0.75, 1.3, 0.5] });
      // Head: skull, snout, jaw with teeth, nostrils, slit-pupil eyes, brow ridges, horns, fins
      const hd = k.grp([0, 0.82, 0.08]);
      const H = { parent: hd };
      k.sph(0.1, scale, [0, 0, 0], { ...H, scale: [1, 0.88, 1.02] });
      k.sph(0.07, scale, [0, -0.025, 0.11], { ...H, scale: [0.88, 0.68, 1.45] });
      k.sph(0.06, belly, [0, -0.07, 0.085], { ...H, scale: [0.82, 0.38, 1.45] });
      for (const s of [-1, 1]) {
        k.sph(0.012, DARK, [s * 0.025, 0.005, 0.205], { ...H, scale: [1, 0.6, 0.6], seg: 10 });
        eye(k, hd, [s * 0.055, 0.025, 0.065], 0.026, { iris: '#ffcc33', slit: true, lid: scale, rot: [0, s * 0.35, 0] });
        k.tube([[s * 0.025, 0.055, 0.08], [s * 0.06, 0.06, 0.075], [s * 0.085, 0.045, 0.05]], 0.012, 0.006, scale, H);
        k.tube([[s * 0.05, 0.06, -0.03], [s * 0.08, 0.13, -0.11], [s * 0.09, 0.15, -0.22]], 0.022, 0.003, horn, { ...H, seg: 24 });
        for (let r = 0; r < 3; r++) k.tor(0.02 - r * 0.004, 0.003, shade('#efe3c4', -0.2), [s * (0.06 + r * 0.01), 0.09 + r * 0.025, -0.06 - r * 0.04], { ...H, rot: [0.9, s * 0.3, 0] });
        k.ext([[0, 0], [0.06, 0.02], [0.03, 0.05], [0.07, 0.07], [0, 0.06]], 0.004, membrane, [s * 0.095, 0.0, -0.04], { ...H, rot: [0, s * Math.PI / 2, 0], bevel: 0.002 });
        for (let t = 0; t < 5; t++) k.cone(0.006, 0.02, WHITE, [s * 0.04, -0.06, 0.17 - t * 0.022], { ...H, rot: [Math.PI, 0, 0], seg: 8 });
      }
      // Back spikes from the head down to the tail
      const spine = new THREE.CatmullRomCurve3([[0, 0.9, 0.02], [0, 0.72, -0.04], [0, 0.55, -0.15], [0, 0.4, -0.2], [0, 0.22, -0.19]].map(p => new THREE.Vector3(...p)));
      for (let i = 0; i < 11; i++) {
        const p = spine.getPointAt(i / 10);
        k.cone(0.022 - i * 0.0012, 0.06 - i * 0.003, horn, [p.x, p.y, p.z - 0.01], { rot: [-1.2 + i * 0.05, 0, 0] });
      }
      // Wings: bones with a scalloped membrane
      for (const s of [-1, 1]) {
        const w = k.grp([s * 0.1, 0.52, -0.12], { rot: [0.1, s * 0.5, s * -0.45], scale: [s, 1, 1] });
        k.ext([[0, 0], [0.12, 0.18], [0.36, 0.28], [0.34, 0.14], [0.3, 0.05], [0.24, 0.03], [0.2, -0.06], [0.13, -0.04], [0.08, -0.11], [0.02, -0.05]], 0.004, membrane, [0, 0, 0], { parent: w, center: false, bevel: 0.002 });
        k.tube([[0, 0, 0.004], [0.12, 0.18, 0.004], [0.36, 0.28, 0.004]], 0.014, 0.004, scale, { parent: w });
        for (const tip of [[0.3, 0.05], [0.2, -0.06], [0.08, -0.11]]) k.tube([[0.12, 0.18, 0.004], [tip[0], tip[1], 0.004]], 0.007, 0.003, scale, { parent: w });
        k.cone(0.008, 0.03, horn, [0.37, 0.3, 0.004], { parent: w, rot: [0, 0, -0.9] });
      }
      // Arms with claws, haunches and three-toed feet
      for (const s of [-1, 1]) {
        k.tube([[s * 0.13, 0.48, 0.07], [s * 0.15, 0.39, 0.13], [s * 0.08, 0.38, 0.19]], 0.032, 0.022, scale);
        for (let t = 0; t < 3; t++) k.cone(0.006, 0.025, horn, [s * (0.07 - t * 0.012), 0.37, 0.21], { rot: [Math.PI / 2 + 0.3, 0, 0], seg: 8 });
        k.sph(0.1, scale, [s * 0.14, 0.2, 0.03], { scale: [0.75, 1, 1.15] });
        k.sph(0.05, scale, [s * 0.15, 0.04, 0.11], { scale: [0.9, 0.55, 1.4] });
        for (let t = 0; t < 3; t++) {
          const tx = s * (0.15 + (t - 1) * 0.03);
          k.cap(0.015, 0.03, scale, [tx, 0.02, 0.17], { rot: [Math.PI / 2, 0, 0], seg: 12 });
          k.cone(0.008, 0.03, horn, [tx, 0.02, 0.205], { rot: [Math.PI / 2, 0, 0], seg: 8 });
        }
      }
      // Tail curling around the feet with a spade tip
      k.tube([[0, 0.22, -0.17], [0.12, 0.08, -0.28], [0.3, 0.05, -0.2], [0.36, 0.05, -0.02], [0.32, 0.07, 0.12]], 0.085, 0.015, scale, { seg: 40 });
      k.ext([[0, 0.05], [0.04, 0], [0, -0.05], [-0.02, 0]], 0.012, horn, [0.31, 0.07, 0.16], { rot: [Math.PI / 2, 0, 0.6], bevel: 0.004 });
      return k.g;
    },
  },

  penguin: {
    name: 'COCK COCK', blurb: 'Lost in the desert. Still farming aura.',
    build(c) {
      const k = kit();
      const black = k.M('#1f2430', { roughness: 0.35, bumpMap: T.bump('fur', [4, 4]), bumpScale: 0.6 });
      const white = k.M(WHITE, { roughness: 0.45, bumpMap: T.bump('fur', [4, 4]), bumpScale: 0.6 });
      const orange = k.M('#f29a2e', { roughness: 0.4 });
      const knit = k.M(c, { map: T.knit(c), bumpMap: T.bump('rough', [6, 6]), bumpScale: 1, roughness: 0.9 });
      // Teardrop body, white belly, head
      k.lathe([[0, 0.05], [0.17, 0.08], [0.24, 0.22], [0.25, 0.38], [0.22, 0.55], [0.17, 0.66], [0.1, 0.73], [0, 0.75]], black, [0, 0, 0], { seg: 64 });
      k.sph(0.22, white, [0, 0.33, 0.085], { scale: [0.9, 1.25, 0.72] });
      k.sph(0.155, black, [0, 0.84, 0], { scale: [1, 0.95, 1] });
      k.sph(0.12, white, [0, 0.8, 0.06], { scale: [0.9, 0.85, 0.75] });
      // Yellow-orange ear patches, beak, eyes with white rings
      for (const s of [-1, 1]) {
        k.sph(0.05, k.M('#ffc94a', { roughness: 0.4 }), [s * 0.12, 0.8, 0.05], { scale: [0.4, 1, 0.65], rot: [0, 0, s * 0.3] });
        k.tor(0.028, 0.006, WHITE, [s * 0.06, 0.875, 0.13], { rot: [0, s * 0.35, 0] });
        eye(k, k.g, [s * 0.06, 0.875, 0.128], 0.025, { iris: '#3a2a1e', rot: [0, s * 0.35, 0] });
      }
      k.tube([[0, 0.835, 0.13], [0, 0.828, 0.2], [0, 0.815, 0.25]], 0.032, 0.006, k.M('#2a2a2f', { roughness: 0.3 }), { seg: 16 });
      k.tube([[0, 0.81, 0.13], [0, 0.805, 0.2], [0, 0.808, 0.23]], 0.022, 0.005, orange, { seg: 16 });
      // Flippers and webbed feet with claws
      for (const s of [-1, 1]) {
        k.sph(0.12, black, [s * 0.24, 0.45, 0.01], { scale: [0.2, 1, 0.45], rot: [0.1, 0, s * 0.28] });
        for (let t = 0; t < 3; t++) {
          const a = (t - 1) * 0.45;
          k.cap(0.018, 0.06, orange, [s * 0.09 + Math.sin(a) * 0.04, 0.018, 0.1 + Math.cos(a) * 0.04], { rot: [Math.PI / 2, 0, -a], seg: 12 });
          k.cone(0.006, 0.02, DARK, [s * 0.09 + Math.sin(a) * 0.08, 0.016, 0.1 + Math.cos(a) * 0.08], { rot: [Math.PI / 2, 0, -a], seg: 8 });
        }
        k.sph(0.04, orange, [s * 0.09, 0.025, 0.08], { scale: [1.1, 0.5, 1] });
      }
      // Knitted scarf with a tail and fringe, and a beanie with a pompom
      k.tor(0.145, 0.04, knit, [0, 0.715, 0.01], { rot: [Math.PI / 2 + 0.1, 0, 0] });
      k.rbox(0.07, 0.24, 0.025, 0.01, knit, [0.08, 0.6, 0.18], { rot: [0.15, 0, 0.18] });
      for (let f = 0; f < 6; f++) k.cyl(0.003, 0.003, 0.035, c, [0.04 + f * 0.009, 0.465, 0.195], { rot: [0.15, 0, 0.18], seg: 6 });
      k.sph(0.16, knit, [0, 0.935, -0.01], { tl: Math.PI * 0.5 });
      k.tor(0.155, 0.025, k.M(shade(c, -0.15), { map: T.knit(shade(c, -0.15)) }), [0, 0.945, -0.01], { rot: [Math.PI / 2, 0, 0] });
      k.sph(0.05, k.M(WHITE, { map: T.fur(WHITE), bumpMap: T.bump('fur'), bumpScale: 3, roughness: 1 }), [0, 1.11, -0.01]);
      return k.g;
    },
  },

  frostking: {
    name: 'Fruit Cake', blurb: 'Rules a frozen server. Nobody duos with him twice.',
    build(c) {
      const k = kit();
      const plate = k.M('#3d4656', { metalness: 0.8, roughness: 0.32 });
      const trim = k.M('#a9c4d8', { metalness: 0.85, roughness: 0.25 });
      const ice = k.M('#cfefff', { emissive: new THREE.Color('#6fd0ff'), emissiveIntensity: 0.5, roughness: 0.1, transparent: true, opacity: 0.9 });
      const glow = basic('#9be7ff');
      // Armoured legs and sabatons
      for (const s of [-1, 1]) {
        boot(k, k.g, [s * 0.075, 0, 0], plate, { h: 0.14, sole: '#22262e' });
        k.tube([[s * 0.075, 0.42, 0], [s * 0.078, 0.28, 0.01], [s * 0.075, 0.15, 0]], 0.055, 0.045, plate);
        k.sph(0.04, trim, [s * 0.078, 0.28, 0.05], { scale: [1, 0.8, 0.6] });
      }
      // Tabard and tassets
      k.ext([[-0.07, 0], [0.07, 0], [0.09, -0.3], [0, -0.34], [-0.09, -0.3]], 0.01, k.M(c, { roughness: 0.7 }), [0, 0.32, 0.15], { bevel: 0.003 });
      for (const s of [-1, 1]) for (let l = 0; l < 3; l++) k.rbox(0.12, 0.05, 0.03, 0.01, plate, [s * 0.1, 0.42 - l * 0.045, 0.06], { rot: [0.1, s * 0.4, 0] });
      // Breastplate with a ridge and glowing runes
      k.lathe([[0, 0.4], [0.15, 0.4], [0.16, 0.5], [0.175, 0.62], [0.16, 0.72], [0.08, 0.78], [0, 0.785]], plate, [0, 0, 0], { seg: 48 });
      k.rbox(0.015, 0.3, 0.02, 0.006, trim, [0, 0.6, 0.165], { rot: [-0.08, 0, 0] });
      for (const s of [-1, 1]) for (let r = 0; r < 3; r++) k.tube([[s * 0.03, 0.66 - r * 0.07, 0.165], [s * 0.07, 0.63 - r * 0.07, 0.158], [s * 0.06, 0.6 - r * 0.07, 0.16]], 0.004, 0.004, glow, { seg: 8, radial: 6 });
      k.tor(0.16, 0.014, trim, [0, 0.45, 0], { rot: [Math.PI / 2, 0, 0] });
      k.sph(0.028, glow, [0, 0.45, 0.165], { scale: [1, 1, 0.5] });
      // Layered spiked pauldrons
      for (const s of [-1, 1]) {
        for (let l = 0; l < 3; l++) k.sph(0.1 - l * 0.012, l === 0 ? plate : trim, [s * (0.2 + l * 0.012), 0.72 - l * 0.04, 0], { tl: Math.PI / 2, scale: [1.1, 0.75, 1], rot: [0, 0, s * 0.35] });
        for (let i = 0; i < 3; i++) k.cone(0.014, 0.09 - i * 0.015, ice, [s * (0.2 + i * 0.03), 0.79 - i * 0.012, -0.02 + i * 0.025], { rot: [0, 0, s * (-0.4 - i * 0.2)], seg: 6 });
      }
      // Long cape with a fur collar
      k.put(capeGeo(0.6, 0.72, 0.19, 0.12, 11), k.M(c, { side: THREE.DoubleSide, roughness: 0.8, map: T.speckle(c, 0.08) }), [0, 0.39, 0]);
      k.tor(0.17, 0.045, k.M('#e6eef4', { map: T.fur('#e6eef4'), bumpMap: T.bump('fur'), bumpScale: 2, roughness: 1 }), [0, 0.77, -0.01], { rot: [Math.PI / 2, 0, 0] });
      // Gauntlets resting on a runed sword planted in front
      arm(k, k.g, [[0.2, 0.69, 0], [0.22, 0.55, 0.06], [0.06, 0.48, 0.16]], 0.045, 0.04, plate, plate, { cuff: trim });
      arm(k, k.g, [[-0.2, 0.69, 0], [-0.22, 0.55, 0.06], [-0.06, 0.5, 0.16]], 0.045, 0.04, plate, plate, { cuff: trim });
      const sw = k.grp([0, 0, 0.18]);
      k.ext([[0, 0], [0.035, 0.05], [0.032, 0.42], [0, 0.44], [-0.032, 0.42], [-0.035, 0.05]], 0.008, k.M('#dff4ff', { map: T.runes('#5fd0ff'), metalness: 0.6, roughness: 0.15, emissive: new THREE.Color('#3aa6d8'), emissiveIntensity: 0.25 }), [0, 0.23, 0], { parent: sw, rot: [0, 0, Math.PI], bevel: 0.006 });
      k.tube([[-0.11, 0.49, 0], [-0.05, 0.45, 0], [0, 0.46, 0], [0.05, 0.45, 0], [0.11, 0.49, 0]], 0.012, 0.012, trim, { parent: sw });
      for (const s of [-1, 1]) k.cone(0.012, 0.05, ice, [s * 0.115, 0.52, 0], { parent: sw, rot: [0, 0, -s * 0.5], seg: 6 });
      k.cyl(0.014, 0.014, 0.1, k.M(LEATHER, { map: T.stripes(LEATHER, '#2e1e14', 12) }), [0, 0.52, 0], { parent: sw });
      k.sph(0.022, glow, [0, 0.585, 0], { parent: sw, scale: [1, 1.3, 1] });
      // Undead face, glowing eyes, hood and an icicle crown
      const hd = head(k, k.g, [0, 0.88, 0], { r: 0.1, skin: '#a8b8c8', bump: 'wrinkle', bumpScale: 1.5, glow: '#9be7ff', lid: false, lips: '#4a5664', frown: true, brows: '#dfe8ef' });
      k.put(new THREE.SphereGeometry(0.125, 40, 20, Math.PI * 0.15, Math.PI * 1.7, 0, Math.PI * 0.7), k.M(shade(c, -0.35), { side: THREE.DoubleSide, roughness: 0.85 }), [0, 0.01, -0.01], { parent: hd, rot: [0, Math.PI, 0] });
      k.tor(0.11, 0.012, trim, [0, 0.07, 0], { parent: hd, rot: [Math.PI / 2 - 0.1, 0, 0] });
      for (let i = 0; i < 11; i++) {
        const a = (i / 11) * TAU;
        const tall = i === 0 ? 0.13 : i % 2 ? 0.06 : 0.09;
        k.cone(0.014, tall, ice, [Math.sin(a) * 0.11, 0.075 + tall / 2, Math.cos(a) * 0.11 - 0.01], { parent: hd, rot: [Math.cos(a) * 0.2, 0, -Math.sin(a) * 0.2], seg: 6 });
      }
      k.sph(0.018, glow, [0, 0.085, 0.11], { parent: hd, seg: 12 });
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
      const dress = k.M('#3d3346', { map: T.speckle('#3d3346', 0.1), roughness: 0.9 });
      const shawl = k.M(c, { map: T.knit(c, [8, 8]), bumpMap: T.bump('rough', [6, 6]), bumpScale: 1, roughness: 0.95, side: THREE.DoubleSide });
      const skin = skinMat(k, '#cdc6a3', 'wrinkle', 2.5);
      // Pointy shoes and a long dress with folds
      for (const s of [-1, 1]) k.tube([[s * 0.06, 0.02, 0.05], [s * 0.065, 0.025, 0.12], [s * 0.06, 0.05, 0.17]], 0.03, 0.006, DARK, { seg: 14 });
      k.tube([[0, 0.02, 0], [0, 0.3, 0.01], [0, 0.55, 0.04]], 0, 0, dress, { ribs: [9, 0.05], radial: 72, seg: 20, caps: false, radius: t => 0.19 - t * 0.07 });
      // Hunched torso leaning forward
      k.tube([[0, 0.5, 0.03], [0, 0.6, 0.02], [0, 0.68, 0.07]], 0.12, 0.1, dress, { seg: 16 });
      k.sph(0.11, dress, [0, 0.66, -0.02], { scale: [1.15, 0.8, 1] });
      // Shawl draped over the back and shoulders, with fringe
      k.put(new THREE.SphereGeometry(0.155, 40, 16, 0, TAU, 0, Math.PI * 0.48), shawl, [0, 0.62, 0.0], { scale: [1.2, 1.1, 1.1], rot: [0.35, 0, 0] });
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU;
        k.cyl(0.003, 0.002, 0.05, c, [Math.cos(a) * 0.185, 0.58 - Math.max(0, Math.sin(a)) * 0.03 - 0.03, Math.sin(a) * 0.17 + 0.03], { seg: 5 });
      }
      for (const s of [-1, 1]) k.cone(0.05, 0.16, shawl, [s * 0.07, 0.56, 0.13], { rot: [0.25, 0, Math.PI + s * 0.15] });
      // Amulet
      k.tube([[-0.05, 0.7, 0.1], [0, 0.6, 0.15], [0.05, 0.7, 0.1]], 0.003, 0.003, GOLD, { caps: false });
      k.sph(0.022, k.M('#4dff88', { emissive: new THREE.Color('#2bd16a'), emissiveIntensity: 0.6, roughness: 0.1 }), [0, 0.595, 0.155]);
      k.tor(0.024, 0.005, GOLD, [0, 0.595, 0.155]);
      // Bony arms: one gripping a gnarled cane, one reaching out with long nails
      arm(k, k.g, [[0.13, 0.66, 0.03], [0.17, 0.55, 0.1], [0.16, 0.5, 0.17]], 0.035, 0.022, shawl, skin, { handScale: 1.2 });
      const r = rng(19);
      const cane = [];
      for (let i = 0; i <= 8; i++) cane.push([0.17 + (r() - 0.5) * 0.02, 0.005 + i * 0.07, 0.2 + (r() - 0.5) * 0.02]);
      cane.push([0.2, 0.6, 0.19], [0.22, 0.57, 0.18]);
      k.tube(cane, 0.012, 0.01, k.M('#5a4130', { map: T.wood('#5a4130'), bumpMap: T.bump('rough'), bumpScale: 2 }), { seg: 50 });
      arm(k, k.g, [[-0.13, 0.66, 0.03], [-0.19, 0.58, 0.14], [-0.15, 0.6, 0.24]], 0.035, 0.022, shawl, skin, { fist: false, handScale: 1.2, handRot: [-1.3, 0, 0] });
      for (let f = 0; f < 4; f++) k.cone(0.004, 0.025, '#3b3a24', [-0.15, 0.6 + (f - 1.5) * 0.02, 0.33], { rot: [Math.PI / 2, 0, 0], seg: 6 });
      // Wrinkled face: hooked nose, warts, one milky eye, sunken mouth with two teeth, wild hair
      const hd = head(k, k.g, [0, 0.78, 0.13], { r: 0.1, skinMat: skin, skin: '#cdc6a3', nose: false, mouth: false, iris: '#2a2a18', glow: '#e6f0ff', glowOne: true, brows: '#bdbdc4', browR: 0.007, jaw: [0.9, 0.95, 0.9] });
      k.tube([[0, 0.01, 0.09], [0, -0.005, 0.135], [0, -0.04, 0.155], [0, -0.07, 0.14]], 0.022, 0.007, skin, { parent: hd, seg: 20 });
      for (const [x, y, z] of [[0.012, -0.03, 0.15], [-0.05, -0.04, 0.085], [0.04, 0.05, 0.085]]) k.sph(0.007, shade('#cdc6a3', -0.2), [x, y, z], { parent: hd, seg: 10 });
      k.tube([[-0.03, -0.075, 0.09], [0, -0.085, 0.095], [0.03, -0.075, 0.09]], 0.007, 0.007, '#3a1e22', { parent: hd, seg: 10 });
      k.rbox(0.008, 0.014, 0.006, 0.002, '#e8dfb0', [-0.01, -0.08, 0.098], { parent: hd });
      k.rbox(0.008, 0.012, 0.006, 0.002, '#e8dfb0', [0.014, -0.079, 0.098], { parent: hd });
      k.sph(0.04, skin, [0, -0.11, 0.07], { parent: hd, scale: [0.7, 0.9, 0.8] });
      const hair = k.M('#a7a7ae', { roughness: 0.9 });
      for (let i = 0; i < 46; i++) {
        const a = r() * TAU;
        const up = r() * 0.8;
        const sx = Math.cos(a) * 0.09;
        const sz = Math.sin(a) * 0.09 - 0.02;
        if (sz > 0.05 && up < 0.5) continue;
        const len = 0.08 + r() * 0.1;
        k.tube([[sx, 0.04 + up * 0.05, sz], [sx * 1.4 + (r() - 0.5) * 0.04, 0.02 + up * 0.08, sz * 1.3], [sx * 1.7 + (r() - 0.5) * 0.06, -len + up * 0.1, sz * 1.5 - 0.02]], 0.006, 0.002, hair, { parent: hd, seg: 10, radial: 6, caps: false });
      }
      return k.g;
    },
  },

  captain: {
    name: 'Cpt. Diff', blurb: 'Sank with the ship. Still collecting taxes.',
    build(c) {
      const k = kit();
      const coat = k.M('#2c4140', { map: T.speckle('#2c4140', 0.12), bumpMap: T.bump('rough'), bumpScale: 1, roughness: 0.85 });
      const gold = k.M(GOLD, { metalness: 0.75, roughness: 0.3 });
      const sea = skinMat(k, '#6f9a8c', 'wrinkle', 2);
      const weed = ['#3f7d4f', '#2f6a44', '#5a8f3c'];
      // Tall boots with folded cuffs and buckles
      for (const s of [-1, 1]) {
        boot(k, k.g, [s * 0.075, 0, 0], k.M('#2a211c', { roughness: 0.5 }), { h: 0.22, cuff: k.M('#3a2d24') });
        k.rbox(0.04, 0.03, 0.01, 0.004, gold, [s * 0.075, 0.14, 0.05]);
        k.tube([[s * 0.075, 0.42, 0], [s * 0.078, 0.3, 0.01]], 0.055, 0.05, k.M('#c8b896', { roughness: 0.8 }));
      }
      // Long flared coat with tails, gold trim and buttons; waistcoat in the rider's colour
      k.tube([[0, 0.12, -0.01], [0, 0.4, 0], [0, 0.72, 0]], 0, 0, coat, { ribs: [7, 0.035], radial: 56, seg: 24, caps: false, radius: t => 0.2 - t * 0.065 });
      k.rbox(0.13, 0.28, 0.03, 0.012, k.M(c, { map: T.speckle(c, 0.1) }), [0, 0.54, 0.135], { rot: [-0.05, 0, 0] });
      for (let b = 0; b < 5; b++) k.sph(0.009, gold, [0, 0.64 - b * 0.05, 0.155], { seg: 10 });
      for (const s of [-1, 1]) {
        k.tube([[s * 0.07, 0.72, 0.12], [s * 0.08, 0.5, 0.155], [s * 0.15, 0.14, 0.12]], 0.008, 0.008, gold, { seg: 24 });
        k.rbox(0.05, 0.05, 0.015, 0.006, k.M('#24302f'), [s * 0.15, 0.32, 0.13], { rot: [0, s * 0.5, 0] });
      }
      k.tor(0.165, 0.016, k.M(LEATHER), [0, 0.42, 0], { rot: [Math.PI / 2, 0, 0] });
      k.rbox(0.05, 0.045, 0.012, 0.006, gold, [0, 0.42, 0.18]);
      // Cutlass on the hip
      const cut = k.grp([-0.19, 0.38, 0.06], { rot: [0.2, 0, 0.25] });
      k.ext([[0, 0], [0.025, 0.02], [0.03, -0.2], [0.0, -0.32], [-0.005, -0.2]], 0.005, k.M(STEEL, { metalness: 0.8, roughness: 0.25 }), [0, -0.15, 0], { parent: cut, bevel: 0.002 });
      k.tor(0.035, 0.006, gold, [0.0, 0.03, 0], { parent: cut, arc: Math.PI, rot: [0, Math.PI / 2, 0] });
      k.cyl(0.012, 0.012, 0.06, LEATHER, [0, 0.06, 0], { parent: cut });
      // Arms: a hook on the right, big gold-braided cuffs
      for (const s of [-1, 1]) k.sph(0.06, coat, [s * 0.18, 0.7, 0], { seg: 20 });
      arm(k, k.g, [[-0.18, 0.69, 0], [-0.22, 0.55, 0.04], [-0.17, 0.46, 0.1]], 0.048, 0.04, coat, sea, { cuff: gold });
      arm(k, k.g, [[0.18, 0.69, 0], [0.23, 0.56, 0.05], [0.2, 0.5, 0.14]], 0.048, 0.04, coat, sea, { cuff: gold, hand: false });
      k.cyl(0.03, 0.035, 0.04, gold, [0.2, 0.48, 0.15], { rot: [0.5, 0, 0] });
      k.tor(0.035, 0.008, k.M(STEEL, { metalness: 0.85, roughness: 0.2 }), [0.2, 0.43, 0.2], { arc: Math.PI * 1.3, rot: [0, Math.PI / 2, 0] });
      k.cone(0.008, 0.02, STEEL, [0.2, 0.44, 0.238], { rot: [0.6, 0, 0], seg: 8 });
      // Coral growing on the shoulder, barnacles on the coat, a starfish
      const coral = (base, col, seed) => {
        const r = rng(seed);
        for (let i = 0; i < 5; i++) {
          const tip = [base[0] + (r() - 0.5) * 0.08, base[1] + 0.05 + r() * 0.06, base[2] + (r() - 0.5) * 0.06];
          k.tube([base, [(base[0] + tip[0]) / 2, base[1] + 0.03, (base[2] + tip[2]) / 2], tip], 0.01, 0.005, col, { seg: 10, radial: 8 });
        }
      };
      coral([0.19, 0.74, 0], '#ff8a7a', 7);
      coral([0.15, 0.73, -0.06], '#ffb36b', 9);
      const bar = rng(13);
      const barnacles = [];
      for (let i = 0; i < 40; i++) {
        const a = -0.6 + bar() * 1.6;
        const y = 0.2 + bar() * 0.45;
        const R = 0.2 - ((y - 0.12) / 0.6) * 0.065;
        barnacles.push([[Math.sin(a) * R, y, Math.cos(a) * R], [Math.PI / 2 - 0.2, 0, -a], [1, 1, 1]]);
      }
      k.inst(new THREE.CylinderGeometry(0.004, 0.009, 0.01, 7), '#d8d2c4', barnacles, { m: { roughness: 0.9 } });
      // Drowned face: green skin, one glowing eye, seaweed beard
      const hd = head(k, k.g, [0, 0.86, 0], { r: 0.105, skinMat: sea, skin: '#6f9a8c', glow: '#d7ff7a', glowOne: true, iris: '#1d2a20', brows: '#2a3a2e', mouth: false });
      for (let i = 0; i < 16; i++) {
        const x = -0.07 + (i / 15) * 0.14;
        const len = 0.12 + Math.sin(i * 1.7) * 0.04 + (1 - Math.abs(x) / 0.07) * 0.06;
        k.tube([[x, -0.06, 0.07 - Math.abs(x) * 0.4], [x * 1.1 + Math.sin(i) * 0.01, -0.06 - len * 0.5, 0.09 - Math.abs(x) * 0.3], [x * 1.15 + Math.cos(i) * 0.015, -0.06 - len, 0.08]], 0.009, 0.002, weed[i % 3], { parent: hd, seg: 12, radial: 8 });
      }
      k.tube([[-0.06, -0.05, 0.09], [0, -0.04, 0.105], [0.06, -0.05, 0.09]], 0.008, 0.008, '#2f6a44', { parent: hd, seg: 12 });
      // Tricorn hat with gold trim, a feather and a starfish
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
      const hat = k.grp([0, 0.08, 0], { parent: hd, rot: [0, Math.PI / 6 + Math.PI, 0] });
      const felt = k.M('#1c1a1e', { side: THREE.DoubleSide, roughness: 0.9, map: T.speckle('#1c1a1e', 0.1) });
      k.put(brim, felt, [0, 0, 0], { parent: hat });
      k.sph(0.105, felt, [0, 0, 0], { parent: hat, tl: Math.PI / 2, scale: [1, 0.85, 1] });
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
      k.ext(star, 0.006, k.M('#ff7a59', { bumpMap: T.bump('rough'), bumpScale: 2 }), [0.08, 0.1, 0.09], { parent: hd, rot: [-0.4, 0.4, 0], bevel: 0.004 });
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
      // Little gloved arms and legs with sneakers in the rider's colour
      const glove = k.M(WHITE, { roughness: 0.5 });
      for (const s of [-1, 1]) {
        k.tube([[-0.04, 0.58, s * 0.04], [-0.02, 0.5, s * 0.1], [0.04, 0.46, s * 0.12]], 0.012, 0.012, DARK, G);
        hand(k, gun, [0.05, 0.46, s * 0.12], 1.1, glove, { fist: true });
        k.tor(0.022, 0.009, glove, [0.035, 0.465, s * 0.12], { ...G, rot: [0, Math.PI / 2, 0] });
        k.tube([[-0.2, 0.27, s * 0.03], [-0.2, 0.14, s * 0.06], [-0.19, 0.06, s * 0.07]], 0.014, 0.012, DARK, G);
        const shoe = k.grp([-0.18, 0, s * 0.07], G);
        k.sph(0.045, k.M(c, { roughness: 0.5 }), [0.02, 0.035, 0], { parent: shoe, scale: [1.6, 0.8, 0.9] });
        k.rbox(0.15, 0.018, 0.085, 0.008, WHITE, [0.02, 0.009, 0], { parent: shoe });
        for (let l = 0; l < 3; l++) k.cyl(0.002, 0.002, 0.05, WHITE, [0.01 + l * 0.018, 0.064, 0], { parent: shoe, rot: [Math.PI / 2, 0, 0], seg: 4 });
      }
      return k.g;
    },
  },

  buzzsaw: {
    name: 'CockSaw Man', blurb: 'Revs up before every T-bag.',
    build(c) {
      const k = kit();
      const skin = skinMat(k, '#dba27f');
      const denim = k.M('#3b5578', { map: T.speckle('#3b5578', 0.15), bumpMap: T.bump('rough'), bumpScale: 1, roughness: 0.85 });
      const flannel = k.M(c, { map: T.plaid(c), roughness: 0.85 });
      const steel = k.M(STEEL, { metalness: 0.85, roughness: 0.25 });
      const bolt = k.M('#d6dbe2', { metalness: 0.9, roughness: 0.2 });
      // Work boots with laces, jeans
      for (const s of [-1, 1]) {
        boot(k, k.g, [s * 0.085, 0, 0], k.M('#6b4628', { roughness: 0.6 }), { h: 0.12, sole: '#1c1814' });
        for (let l = 0; l < 3; l++) k.tor(0.03, 0.003, '#d8c9a0', [s * 0.085, 0.07 + l * 0.022, 0.035], { rot: [Math.PI / 2, 0, 0], arc: Math.PI, ts: 12 });
        k.tube([[s * 0.085, 0.42, 0], [s * 0.09, 0.27, 0.01], [s * 0.085, 0.12, 0]], 0.065, 0.055, denim);
      }
      // Chunky torso in flannel, overalls bib with straps, clips and a pocket
      k.tube([[0, 0.38, 0], [0, 0.58, 0], [0, 0.76, 0]], 0, 0, flannel, { radial: 40, seg: 12, caps: false, radius: t => 0.17 + Math.sin(t * Math.PI) * 0.03 });
      k.cyl(0.15, 0.15, 0.02, flannel, [0, 0.76, 0]);
      k.tube([[0, 0.36, 0], [0, 0.46, 0]], 0.18, 0.185, denim, { seg: 4, caps: false });
      k.rbox(0.2, 0.2, 0.03, 0.012, denim, [0, 0.55, 0.17]);
      k.rbox(0.08, 0.06, 0.008, 0.006, shade('#3b5578', -0.15), [0, 0.57, 0.19]);
      for (const s of [-1, 1]) {
        k.tube([[s * 0.08, 0.64, 0.18], [s * 0.12, 0.76, 0.1], [s * 0.1, 0.76, -0.12], [s * 0.08, 0.5, -0.18]], 0.012, 0.012, denim, { seg: 20, radial: 8 });
        k.rbox(0.035, 0.03, 0.012, 0.005, steel, [s * 0.08, 0.64, 0.19]);
      }
      // Arms, and a chainsaw held in both hands
      for (const s of [-1, 1]) k.sph(0.07, flannel, [s * 0.2, 0.71, 0], { seg: 20 });
      arm(k, k.g, [[-0.21, 0.7, 0], [-0.26, 0.56, 0.06], [-0.12, 0.5, 0.17]], 0.058, 0.045, flannel, skin);
      arm(k, k.g, [[0.21, 0.7, 0], [0.26, 0.56, 0.04], [0.14, 0.58, 0.16]], 0.058, 0.045, flannel, skin);
      const saw = k.grp([0.02, 0.53, 0.2], { rot: [0, -0.15, 0.15] });
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
      // Rugged head: stubble, goggles on the forehead, and a circular saw blade crest
      const hd = head(k, k.g, [0, 0.9, 0], { r: 0.12, skinMat: skin, skin: '#dba27f', brows: '#3a2618', browR: 0.01, iris: '#3e5a2a', frown: true, jaw: [1.15, 0.9, 1] });
      k.sph(0.097, k.M('#5a463a', { map: T.speckle('#5a463a', 0.3, [4, 4]), transparent: true, opacity: 0.55, roughness: 1 }), [0, -0.045, 0.02], { parent: hd, scale: [1.05, 0.82, 0.98] });
      k.tor(0.122, 0.012, DARK, [0, 0.06, 0], { parent: hd, rot: [Math.PI / 2 - 0.3, 0, 0] });
      for (const s of [-1, 1]) {
        k.cyl(0.028, 0.028, 0.025, IRON, [s * 0.035, 0.085, 0.1], { parent: hd, rot: [Math.PI / 2 - 0.5, 0, 0] });
        k.cyl(0.022, 0.022, 0.006, k.M('#ffb347', { metalness: 0.3, roughness: 0.05, transparent: true, opacity: 0.8 }), [s * 0.035, 0.092, 0.111], { parent: hd, rot: [Math.PI / 2 - 0.5, 0, 0] });
      }
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
        k.cyl(0.006, 0.006, 0.02, bolt, [Math.cos(a) * 0.02, Math.sin(a) * 0.02, 0], { parent: bl, rot: [Math.PI / 2, 0, 0], seg: 6 });
      }
      return k.g;
    },
  },

  dog: {
    name: 'Amigo', blurb: 'Fetches aura. Brings it back. Keeps it.',
    build(c) {
      const k = kit();
      const tan = '#d48a3f';
      const fur = k.M(tan, { map: T.fur(tan), bumpMap: T.bump('fur'), bumpScale: 2, roughness: 0.85 });
      const cream = k.M('#f5e6cc', { map: T.fur('#f5e6cc'), bumpMap: T.bump('fur'), bumpScale: 2, roughness: 0.85 });
      const goldM = k.M(GOLD, { metalness: 0.8, roughness: 0.25 });
      const dog = k.grp([0, 0, 0], { rot: [0, -0.6, 0] });
      const D = { parent: dog };
      // Body, chest, belly and haunches
      k.sph(0.2, fur, [0, 0.4, 0], { ...D, scale: [1.45, 0.82, 0.85] });
      k.sph(0.14, cream, [0.18, 0.4, 0], { ...D, scale: [0.9, 1.05, 0.95] });
      k.sph(0.16, cream, [0, 0.33, 0], { ...D, scale: [1.3, 0.55, 0.75] });
      k.sph(0.12, fur, [-0.2, 0.42, 0], D);
      // Legs and paws with toes
      for (const [x, z, back] of [[0.18, 0.09, 0], [0.18, -0.09, 0], [-0.2, 0.1, 1], [-0.2, -0.1, 1]]) {
        if (back) k.sph(0.075, fur, [x, 0.35, z * 1.2], { ...D, scale: [1.1, 1.2, 0.8] });
        k.tube([[x, 0.36, z], [x + (back ? -0.03 : 0.01), 0.2, z], [x + 0.01, 0.05, z]], 0.045, 0.035, back ? fur : cream, D);
        k.sph(0.04, cream, [x + 0.025, 0.025, z], { ...D, scale: [1.35, 0.65, 1.05] });
        for (let t = 0; t < 3; t++) k.sph(0.014, cream, [x + 0.065, 0.02, z + (t - 1) * 0.018], { ...D, seg: 10 });
      }
      // Curled tail over the back
      k.tube([[-0.3, 0.46, 0], [-0.36, 0.56, 0], [-0.3, 0.64, 0.02], [-0.22, 0.6, 0.03]], 0.04, 0.02, fur, { ...D, seg: 30 });
      k.sph(0.028, cream, [-0.22, 0.6, 0.03], D);
      // Head turned toward the viewer: cheeks, muzzle, glossy nose, open mouth with tongue
      const hd = k.grp([0.3, 0.6, 0.0], { ...D, rot: [0, 0.6, 0] });
      k.g.userData.face = hd;
      const H = { parent: hd };
      k.sph(0.12, fur, [0, 0, 0], { ...H, scale: [1, 0.95, 1] });
      k.sph(0.08, cream, [0, -0.035, 0.07], { ...H, scale: [1.2, 0.85, 1] });
      k.sph(0.055, cream, [0, -0.035, 0.14], { ...H, scale: [1, 0.78, 1.15] });
      k.sph(0.02, k.M('#151316', { roughness: 0.15 }), [0, -0.015, 0.2], { ...H, scale: [1.3, 0.9, 1] });
      k.sph(0.04, '#5a2a2a', [0, -0.07, 0.15], { ...H, scale: [1, 0.45, 0.9] });
      k.ext([[-0.02, 0], [0.02, 0], [0.022, -0.035], [0, -0.045], [-0.022, -0.035]], 0.006, k.M('#ef7f8f', { roughness: 0.3 }), [0, -0.095, 0.17], { ...H, rot: [-0.4, 0, 0], smooth: true, bevel: 0.004 });
      k.tube([[-0.035, -0.055, 0.17], [0, -0.06, 0.18], [0.035, -0.055, 0.17]], 0.005, 0.005, '#3a2020', { ...H, seg: 10 });
      // Big eyes, brow dots, pointy ears with pink insides
      for (const s of [-1, 1]) {
        eye(k, hd, [s * 0.045, 0.025, 0.095], 0.026, { iris: '#4a2a14', lid: fur, rot: [0, s * 0.3, 0] });
        k.sph(0.012, cream, [s * 0.045, 0.065, 0.1], { ...H, scale: [1.3, 0.8, 0.6] });
        const ear = k.grp([s * 0.07, 0.09, -0.01], { ...H, rot: [-0.15, 0, s * -0.3] });
        k.ext([[-0.035, 0], [0.035, 0], [0.005, 0.1], [-0.005, 0.1]], 0.02, fur, [0, 0.04, 0], { parent: ear, bevel: 0.008 });
        k.ext([[-0.02, 0], [0.02, 0], [0, 0.07]], 0.004, k.M('#f2a6a6'), [0, 0.035, 0.017], { parent: ear, bevel: 0.002 });
      }
      // Collar with studs and a gold bone-shaped tag
      k.tor(0.085, 0.016, k.M(c, { roughness: 0.4 }), [0.24, 0.53, 0], { ...D, rot: [0, Math.PI / 2, 0.5] });
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * TAU;
        k.sph(0.006, k.M(STEEL, { metalness: 0.8 }), [0.24 + Math.sin(a) * 0.04, 0.53 + Math.cos(a) * 0.075, Math.sin(a) * 0.08], { ...D, seg: 8 });
      }
      const tag = k.grp([0.31, 0.45, 0], { ...D, rot: [0, Math.PI / 2, 0] });
      k.rbox(0.04, 0.014, 0.004, 0.003, goldM, [0, 0, 0], { parent: tag });
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) k.sph(0.008, goldM, [sx * 0.02, sy * 0.006, 0], { parent: tag, scale: [1, 1, 0.4], seg: 10 });
      return k.g;
    },
  },

  jetpack: {
    name: 'Mr CockMan', blurb: 'Never touches the ground. Never touches grass either.',
    build(c) {
      const k = kit();
      const suit = k.M('#2b2f38', { map: T.panels('#2b2f38'), roughness: 0.6 });
      const armor = k.M(c, { metalness: 0.45, roughness: 0.3, map: T.panels(c, [1, 1]) });
      const metal = k.M('#8b929d', { metalness: 0.85, roughness: 0.25 });
      const visor = k.M('#5fe1ff', { emissive: new THREE.Color('#2fb8e0'), emissiveIntensity: 0.6, metalness: 0.4, roughness: 0.05 });
      const flame = (col, op) => new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false });
      const body = k.grp([0, 0.14, 0]); // hovering
      const B = { parent: body };
      // Legs: undersuit, thigh plates, knee pads, shin guards, armored boots with vents
      for (const s of [-1, 1]) {
        k.tube([[s * 0.07, 0.4, 0], [s * 0.075, 0.24, 0.03], [s * 0.07, 0.08, -0.01]], 0.05, 0.04, suit, B);
        k.rbox(0.09, 0.11, 0.05, 0.02, armor, [s * 0.075, 0.33, 0.035], { ...B, rot: [0.1, 0, 0] });
        k.sph(0.035, metal, [s * 0.076, 0.24, 0.06], { ...B, scale: [1, 1, 0.7] });
        k.rbox(0.08, 0.13, 0.04, 0.018, armor, [s * 0.072, 0.15, 0.03], { ...B, rot: [-0.08, 0, 0] });
        const b = boot(k, body, [s * 0.07, -0.04, -0.01], metal, { h: 0.08, sole: '#1a1c20', rot: [0.35, 0, 0] });
        k.cyl(0.02, 0.016, 0.02, '#22252b', [0, 0.005, -0.03], { parent: b });
        k.cone(0.018, 0.12, flame('#ffb347', 0.8), [s * 0.07, -0.1, -0.03], { ...B, rot: [Math.PI, 0, 0], shadow: false });
      }
      // Torso: undersuit, sculpted chest plate, belt with pouches, abdomen plates
      k.lathe([[0, 0.38], [0.14, 0.38], [0.13, 0.48], [0.155, 0.6], [0.16, 0.68], [0.11, 0.74], [0, 0.75]], suit, [0, 0, 0], B);
      k.lathe([[0.1, 0.56], [0.16, 0.57], [0.17, 0.64], [0.15, 0.71], [0.1, 0.735]], armor, [0, 0, 0.012], { ...B, scale: [1.02, 1, 1.08] });
      k.rbox(0.07, 0.07, 0.02, 0.01, visor, [0, 0.64, 0.17], B);
      for (let i = 0; i < 3; i++) k.rbox(0.11 - i * 0.01, 0.03, 0.02, 0.01, armor, [0, 0.52 - i * 0.04, 0.13], B);
      k.tor(0.14, 0.014, '#1d2026', [0, 0.4, 0], { ...B, rot: [Math.PI / 2, 0, 0] });
      for (const s of [-1, 1]) k.rbox(0.05, 0.05, 0.03, 0.01, '#3a3f49', [s * 0.11, 0.39, 0.1], { ...B, rot: [0, s * 0.5, 0] });
      // Shoulder pads with trim, arms with gauntlets, a blaster in the right hand
      for (const s of [-1, 1]) {
        k.sph(0.075, armor, [s * 0.2, 0.71, 0], { ...B, tl: Math.PI / 2, scale: [1.1, 0.8, 1], rot: [0, 0, s * 0.3] });
        k.tor(0.074, 0.008, metal, [s * 0.2, 0.705, 0], { ...B, rot: [Math.PI / 2, s * 0.3, 0], scale: [1.1, 1, 1] });
      }
      arm(k, body, [[-0.2, 0.68, 0], [-0.24, 0.55, 0.02], [-0.23, 0.44, 0.06]], 0.04, 0.034, suit, armor, { cuff: metal });
      arm(k, body, [[0.2, 0.68, 0], [0.25, 0.57, 0.06], [0.2, 0.55, 0.17]], 0.04, 0.034, suit, armor, { cuff: metal });
      k.rbox(0.05, 0.06, 0.12, 0.012, '#30343d', [0.2, 0.57, 0.22], B);
      k.cyl(0.014, 0.014, 0.1, metal, [0.2, 0.585, 0.3], { ...B, rot: [Math.PI / 2, 0, 0] });
      k.rbox(0.008, 0.01, 0.1, 0.003, visor, [0.226, 0.57, 0.22], B);
      // Helmet: rounded shell, glowing visor, jaw guard with vents, ear modules with lights, antenna
      const hd = k.grp([0, 0.86, 0], B);
      const H = { parent: hd };
      k.sph(0.115, armor, [0, 0, 0], { ...H, scale: [0.95, 1.02, 1.05] });
      k.put(new THREE.SphereGeometry(0.118, 40, 20, -Math.PI * 0.32, Math.PI * 0.64, Math.PI * 0.32, Math.PI * 0.3), visor, [0, 0, 0.004], { ...H, scale: [0.96, 1.02, 1.05] });
      k.rbox(0.09, 0.05, 0.04, 0.015, '#30343d', [0, -0.08, 0.06], H);
      for (let i = 0; i < 4; i++) k.rbox(0.05, 0.004, 0.005, 0.0015, metal, [0, -0.07 - i * 0.01, 0.082], H);
      for (const s of [-1, 1]) {
        k.cyl(0.035, 0.035, 0.03, metal, [s * 0.11, 0, 0], { ...H, rot: [0, 0, Math.PI / 2] });
        k.cyl(0.015, 0.015, 0.008, basic('#ff5a5a'), [s * 0.127, 0, 0], { ...H, rot: [0, 0, Math.PI / 2], seg: 12 });
      }
      k.cyl(0.003, 0.003, 0.08, metal, [0.11, 0.06, -0.02], { ...H, seg: 6 });
      k.sph(0.006, basic('#ff5a5a'), [0.11, 0.1, -0.02], { ...H, seg: 8 });
      // Jetpack: rounded housing, fins, twin thrusters with layered flames
      k.rbox(0.24, 0.26, 0.1, 0.035, k.M('#3a3f49', { metalness: 0.6, roughness: 0.35 }), [0, 0.6, -0.17], B);
      k.rbox(0.16, 0.06, 0.02, 0.01, armor, [0, 0.67, -0.225], B);
      for (const s of [-1, 1]) {
        k.ext([[0, 0], [0.07, -0.02], [0.07, -0.1], [0, -0.05]], 0.008, armor, [s * 0.16, 0.65, -0.17], { ...B, rot: [0, s > 0 ? 0 : Math.PI, 0], bevel: 0.003 });
        const th = k.grp([s * 0.08, 0.47, -0.2], B);
        k.cyl(0.045, 0.05, 0.14, metal, [0, 0.03, 0], { parent: th });
        k.cyl(0.055, 0.04, 0.05, '#2a2d33', [0, -0.06, 0], { parent: th, open: true });
        k.tor(0.05, 0.006, armor, [0, 0.07, 0], { parent: th, rot: [Math.PI / 2, 0, 0] });
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
      const bun = k.M('#e2a75e', { map: T.bun(), bumpMap: T.bump('rough'), bumpScale: 1.5, roughness: 0.75 });
      const sausage = k.M('#b5502f', { map: T.speckle('#b5502f', 0.12), roughness: 0.35, bumpMap: T.bump('skin'), bumpScale: 0.6 });
      const skin = skinMat(k, SKIN);
      const denim = k.M('#3b5578', { map: T.speckle('#3b5578', 0.15), roughness: 0.85 });
      // Jeans and sneakers in the rider's colour
      for (const s of [-1, 1]) {
        k.tube([[s * 0.07, 0.3, 0], [s * 0.075, 0.18, 0.01], [s * 0.072, 0.07, 0]], 0.05, 0.045, denim);
        const shoe = k.grp([s * 0.075, 0, 0.02]);
        k.sph(0.05, k.M(c, { roughness: 0.45 }), [0, 0.04, 0.02], { parent: shoe, scale: [1, 0.75, 1.55] });
        k.rbox(0.1, 0.022, 0.17, 0.009, WHITE, [0, 0.011, 0.02], { parent: shoe });
        for (let l = 0; l < 3; l++) k.cyl(0.002, 0.002, 0.06, WHITE, [0, 0.075, 0.04 + l * 0.018], { parent: shoe, rot: [0, 0, Math.PI / 2], seg: 4 });
      }
      // The costume: a long sausage wrapped in two bun halves, from the knees to above the head
      k.cap(0.13, 0.72, sausage, [0, 0.66, 0.0], { seg: 40 });
      for (const s of [-1, 1]) {
        k.cap(0.1, 0.62, bun, [s * 0.13, 0.62, -0.02], { scale: [1, 1, 1.35], seg: 40 });
        for (let i = 0; i < 4; i++) k.sph(0.022, k.M('#b8732f', { roughness: 0.7 }), [s * 0.2, 0.42 + i * 0.13, 0.03], { scale: [0.4, 1.4, 0.8], seg: 12 });
      }
      // Mustard zigzag and a ketchup squiggle in the rider's colour down the front
      const zig = [];
      for (let i = 0; i <= 12; i++) zig.push([(i % 2 ? 1 : -1) * 0.05, 1.0 - i * 0.055, 0.128 - Math.abs(0.55 - i / 12) * 0.01]);
      k.tube(zig, 0.011, 0.011, k.M('#ffd23f', { roughness: 0.3 }), { seg: 80, radial: 10 });
      const sq = [];
      for (let i = 0; i <= 20; i++) sq.push([Math.sin(i * 0.9) * 0.03, 0.98 - i * 0.033, 0.135]);
      k.tube(sq, 0.007, 0.007, k.M(c, { roughness: 0.25 }), { seg: 90, radial: 8 });
      // Face poking out of a hole in the sausage
      k.tor(0.085, 0.016, sausage, [0, 0.83, 0.1], { rot: [0.1, 0, 0] });
      const hd = head(k, k.g, [0, 0.83, 0.05], { r: 0.075, skinMat: skin, ears: false, brows: '#4a3020', iris: '#3a5a8a' });
      hd.scale.setScalar(1.05);
      // Arms out of the bun, in a hoodie in the rider's colour
      for (const s of [-1, 1]) {
        arm(k, k.g, [[s * 0.2, 0.68, 0], [s * 0.28, 0.56, 0.04], [s * 0.27, 0.45, 0.1]], 0.04, 0.035, k.M(c, { map: T.speckle(c, 0.1), roughness: 0.8 }), skin, { cuff: shade(c, -0.2) });
      }
      return k.g;
    },
  },

  sensei: {
    name: 'Sensei', blurb: "Blindfolded, hands in pockets, smirking. Your T-bag never even touched him.",
    build(c) {
      const k = kit();
      const SKIN_FAIR = '#f6e2d4';
      const skin = skinMat(k, SKIN_FAIR, 'skin', 0.4);
      const navy = k.M('#171b2c', { map: T.speckle('#171b2c', 0.1), bumpMap: T.bump('wrinkle'), bumpScale: 0.35, roughness: 0.85 });
      const navyDark = k.M('#10131f', { roughness: 0.8 });
      const shoe = k.M('#0d0d10', { roughness: 0.3, metalness: 0.1 });
      const band = k.M('#0b0b0f', { roughness: 0.32, side: THREE.DoubleSide });
      const hair = new THREE.MeshPhysicalMaterial({ color: '#f5f7fb', roughness: 0.38, sheen: 1, sheenColor: new THREE.Color('#c4d6ff'), sheenRoughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.35 });

      // Plain black shoes under loose, straight trousers
      for (const s of [-1, 1]) {
        boot(k, k.g, [s * 0.058, 0, 0.005], shoe, { h: 0.035, sole: '#08080a', rot: [0, s * 0.12, 0] });
        k.tube([[s * 0.058, 0.5, 0], [s * 0.059, 0.27, 0.004], [s * 0.06, 0.045, 0.004]], 0.046, 0.043, navy, { seg: 16, radial: 18 });
      }
      // Long jacket, fitted at broad shoulders, loose through the body, seamless front
      k.lathe([[0, 0.43], [0.108, 0.43], [0.112, 0.5], [0.113, 0.6], [0.12, 0.7], [0.134, 0.765], [0.118, 0.795], [0.06, 0.808], [0, 0.812]], navy, [0, 0, 0], { scale: [1, 1, 0.68] });
      k.tor(0.108, 0.006, navyDark, [0, 0.432, 0], { rot: [Math.PI / 2, 0, 0], scale: [1, 0.68, 1], rs: 8, ts: 48 });
      // Tall stiff collar right up under the jaw
      k.cyl(0.046, 0.05, 0.075, navy, [0, 0.832, 0.004], { seg: 32 });
      k.tor(0.046, 0.004, navyDark, [0, 0.869, 0.004], { rot: [Math.PI / 2, 0, 0], rs: 8, ts: 32 });

      // Left hand shoved in the pocket
      arm(k, k.g, [[-0.128, 0.765, 0], [-0.152, 0.63, -0.02], [-0.118, 0.51, 0.035]], 0.036, 0.034, navy, skin, { hand: false });
      k.tube([[-0.1, 0.545, 0.05], [-0.112, 0.5, 0.045], [-0.118, 0.47, 0.03]], 0.004, 0.004, navyDark, { seg: 8, radial: 6 });
      // Right hand raised lazily, palm up, with a little orb of aura in the rider's colour
      arm(k, k.g, [[0.128, 0.765, 0], [0.205, 0.67, 0.05], [0.17, 0.79, 0.125]], 0.036, 0.033, navy, skin, { handScale: 1.15, fist: false, handRot: [0.25, 0, Math.PI - 0.35], cuff: navyDark, cuffRot: [0.6, 0, 0.3] });
      k.sph(0.026, k.M(c, { emissive: c, emissiveIntensity: 1.6, roughness: 0.2 }), [0.158, 0.885, 0.135], { seg: 24 });
      k.sph(0.04, k.M(c, { emissive: c, emissiveIntensity: 0.6, transparent: true, opacity: 0.25 }), [0.158, 0.885, 0.135], { seg: 24, shadow: false });

      // Handsome sharp-jawed face, head tilted, a cocky smirk
      const r = 0.062;
      const hd = head(k, k.g, [0, 0.9, 0.008], {
        r, skinMat: skin, skin: SKIN_FAIR, rot: [0.06, 0.1, 0.13], scale: [0.92, 1.06, 1], jaw: [0.92, 0.88, 0.98],
        eyeR: r * 0.12, lid: false, noseScale: [0.7, 1.05, 1.15], mouth: false,
      });
      k.g.userData.face = hd;
      k.tube([[-r * 0.22, -r * 0.5, r * 0.88], [0, -r * 0.52, r * 0.95], [r * 0.18, -r * 0.47, r * 0.92], [r * 0.27, -r * 0.39, r * 0.84]], r * 0.04, r * 0.03, '#b86f6c', { parent: hd, seg: 14, radial: 8 });

      // Black blindfold wrapped temple to temple, knotted at the back
      const ey = r * 0.1;
      k.cyl(r, r, r * 0.4, band, [0, ey, 0], { parent: hd, open: true, scale: [1.0, 1, 1.13], seg: 40 });
      k.sph(r * 0.16, band, [0, ey, -r * 1.12], { parent: hd, scale: [1.2, 0.9, 0.7] });
      for (const s of [-1, 1]) k.tube([[s * r * 0.05, ey, -r * 1.12], [s * r * 0.2, ey - r * 0.4, -r * 1.2], [s * r * 0.25, ey - r * 0.8, -r * 1.15]], r * 0.1, r * 0.07, band, { parent: hd, seg: 10, radial: 8, scale: [1, 1, 1] });

      // Snow-white spiky hair pushed up by the band like a crown
      k.sph(r * 1.08, hair, [0, r * 0.08, -r * 0.03], { parent: hd, tl: Math.PI * 0.52, rot: [-0.38, 0, 0] });
      const rand = rng(77);
      const up = new THREE.Vector3(0, 1, 0);
      const ctr = new THREE.Vector3(0, r * 0.12, -r * 0.04);
      for (let i = 0; i < 52; i++) {
        const phi = rand() * TAU;
        const th = 0.1 + Math.pow(rand(), 0.75) * 1.3;
        const d = new THREE.Vector3(Math.sin(th) * Math.sin(phi), Math.cos(th), Math.sin(th) * Math.cos(phi));
        if (d.z > 0.2) d.y += 0.6; // the band pushes the front up
        d.z -= 0.1;
        d.normalize();
        const len = r * (0.8 + rand() * 1.0) * (d.y > 0.7 ? 1.25 : 1);
        const rad = r * (0.2 + rand() * 0.12);
        const base = ctr.clone().addScaledVector(d, r * 0.85);
        const m = k.cone(rad, len, hair, base.addScaledVector(d, len * 0.42).toArray(), { parent: hd, seg: 10 });
        m.quaternion.setFromUnitVectors(up, d);
      }
      // A few strands falling over the top edge of the band
      for (const x of [-0.45, -0.12, 0.2, 0.5]) {
        k.tube([[x * r, r * 0.62, r * 0.78], [x * r + r * 0.06, r * 0.42, r * 1.1], [x * r + r * 0.1, r * 0.22, r * 1.17]], r * 0.11, r * 0.02, hair, { parent: hd, seg: 10, radial: 8 });
      }
      return k.g;
    },
  },

  leech: {
    name: 'Merry', blurb: 'Latches on and drains. Never lets go.',
    build(c) {
      const k = kit();
      const slime = k.M('#3d2e2a', { map: T.stripes('#3d2e2a', '#4a3832', 24, [1, 1]), roughness: 0.12, metalness: 0.15, bumpMap: T.bump('skin', [3, 3]), bumpScale: 0.8 });
      const stripe = k.M(c, { roughness: 0.15, metalness: 0.1 });
      // Segmented body rearing up from a coil on the ground, ringed like a real leech
      const path = [[-0.18, 0.06, -0.12], [0.05, 0.07, -0.2], [0.2, 0.07, -0.05], [0.12, 0.1, 0.12], [-0.02, 0.25, 0.08], [0.0, 0.48, 0.02], [0.05, 0.68, 0.06], [0.06, 0.8, 0.13]];
      const radius = t => 0.05 + Math.sin(Math.min(1, t * 1.15) * Math.PI) * 0.06 + (t > 0.85 ? (t - 0.85) * 0.25 : 0);
      k.tube(path, 0, 0, slime, { seg: 120, radial: 28, radius: t => radius(t) * (1 + 0.06 * Math.cos(t * 160)) });
      // Two stripes in the rider's colour running down its back, and spots
      const curve = new THREE.CatmullRomCurve3(path.map(p => new THREE.Vector3(...p)));
      for (const off of [-0.6, 0.6]) {
        const pts = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          const p = curve.getPointAt(t);
          const r = radius(t) * 0.98;
          pts.push([p.x + Math.sin(off) * r * 0.6, p.y + r * 0.55, p.z - Math.cos(off) * r * 0.3]);
        }
        k.tube(pts, 0.008, 0.008, stripe, { seg: 80, radial: 8 });
      }
      const spots = [];
      for (let i = 0; i < 26; i++) {
        const t = 0.08 + (i / 26) * 0.8;
        const p = curve.getPointAt(t);
        const r = radius(t);
        spots.push([[p.x + (i % 2 ? 1 : -1) * r * 0.85, p.y + r * 0.2, p.z], [0, 0, 0], [1, 0.6, 1]]);
      }
      k.inst(new THREE.SphereGeometry(0.012, 10, 8), k.M('#e8c34a', { roughness: 0.2 }), spots);
      // Head: flared oral sucker with three jaws and rings of tiny teeth, little eyespots
      const end = curve.getPointAt(1);
      const hd = k.grp([end.x, end.y + 0.02, end.z + 0.02], { rot: [-0.9, 0, 0] });
      k.g.userData.face = hd;
      k.cyl(0.1, 0.085, 0.04, slime, [0, 0, 0], { parent: hd, seg: 48 });
      k.tor(0.09, 0.016, k.M(shade(c, -0.1), { roughness: 0.2 }), [0, 0.02, 0], { parent: hd, rot: [Math.PI / 2, 0, 0], ts: 64 });
      k.cyl(0.07, 0.05, 0.03, '#5a1e24', [0, 0.012, 0], { parent: hd, seg: 40 });
      const teeth = [];
      for (const [R, n, y] of [[0.062, 24, 0.028], [0.045, 18, 0.024], [0.028, 12, 0.02]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          teeth.push([[Math.cos(a) * R, y, Math.sin(a) * R], [Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6], [1, 1, 1]]);
        }
      }
      k.inst(new THREE.ConeGeometry(0.0045, 0.016, 5), k.M('#f3ead2', { roughness: 0.3 }), teeth, { parent: hd });
      for (let j = 0; j < 3; j++) {
        const a = (j / 3) * TAU + Math.PI / 2;
        k.rbox(0.03, 0.012, 0.012, 0.005, '#f3ead2', [Math.cos(a) * 0.015, 0.03, Math.sin(a) * 0.015], { parent: hd, rot: [0, -a, 0] });
      }
      for (let e = 0; e < 5; e++) {
        const a = Math.PI * 1.2 + (e / 4) * Math.PI * 0.6;
        k.sph(0.008, '#0b0a0e', [Math.cos(a) * 0.075, -0.01, Math.sin(a) * 0.075], { parent: hd, seg: 10 });
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
      const brown = k.M('#7a4a26', { roughness: 0.28, metalness: 0.05, bumpMap: T.bump('skin', [3, 3]), bumpScale: 0.5 });
      // Three stacked coils, each a fat ring, getting smaller toward the top
      [[0.3, 0.13, 0.13], [0.23, 0.115, 0.35], [0.15, 0.1, 0.54]].forEach(([R, t, y]) => {
        k.tor(R - t * 0.55, t, brown, [0, y, 0], { rot: [Math.PI / 2, 0, 0], rs: 28, ts: 64 });
        k.cyl(R - t * 0.9, R - t * 0.9, t * 1.6, brown, [0, y, 0], { seg: 48 });
      });
      // Curled tip
      k.tube([[0, 0.6, 0.02], [0.02, 0.72, 0.03], [-0.03, 0.8, 0.0], [-0.08, 0.8, -0.02]], 0.08, 0.018, brown, { seg: 30, radial: 24 });
      // Big eyes with lids and highlights
      for (const s of [-1, 1]) eye(k, k.g, [s * 0.09, 0.4, 0.27], 0.065, { iris: '#2b1a10', rot: [0, s * 0.25, 0] });
      // Wide open smile with teeth and a tongue
      const mouth = k.grp([0, 0.2, 0.36], { rot: [-0.15, 0, 0] });
      k.put(new THREE.SphereGeometry(0.12, 40, 20, 0, TAU, Math.PI / 2, Math.PI / 2), k.M('#3a1418', { roughness: 0.5, side: THREE.DoubleSide }), [0, 0.03, 0], { parent: mouth, scale: [1.1, 0.75, 0.35] });
      k.rbox(0.2, 0.03, 0.02, 0.008, '#fbf7ef', [0, 0.015, 0.012], { parent: mouth });
      k.sph(0.05, k.M('#e8616d', { roughness: 0.4 }), [0, -0.045, 0.012], { parent: mouth, scale: [1.2, 0.55, 0.6] });
      return k.g;
    },
  },
  ronin: {
    name: 'Sausage', blurb: 'Blade at his back, never says a word. Gone before you see the T-bag.',
    build(c) {
      const k = kit();
      const SKIN_PALE = '#f3e2d6';
      const skin = skinMat(k, SKIN_PALE, 'skin', 0.5);
      const kimono = k.M('#ebe5d9', { map: T.speckle('#ebe5d9', 0.06), bumpMap: T.bump('wrinkle'), bumpScale: 0.6, roughness: 0.85, side: THREE.DoubleSide });
      const navy = k.M('#1d2438', { map: T.speckle('#1d2438', 0.12), roughness: 0.85 });
      const apron = k.M('#26304c', { map: T.speckle('#26304c', 0.12), roughness: 0.9, side: THREE.DoubleSide });
      const wraps = k.M('#1d2438', { map: T.stripes('#1d2438', '#2a3352', 14), roughness: 0.9 });
      const trousers = k.M('#2a3a5e', { map: T.speckle('#2a3a5e', 0.12), roughness: 0.85 });
      const rope = k.M('#4b2a6e', { map: T.checker('#4b2a6e', [6, 1]), bumpMap: T.bump('rough'), bumpScale: 1, roughness: 0.8 });
      const hair = new THREE.MeshPhysicalMaterial({ color: '#101219', roughness: 0.38, sheen: 1, sheenColor: new THREE.Color('#3d5aa8'), sheenRoughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.4 });
      const sheath = k.M('#1a1820', { roughness: 0.3, metalness: 0.15 });

      // Open-toed sandals, leg wraps from ankle to knee, loose tapering trousers
      for (const s of [-1, 1]) {
        const b = k.grp([s * 0.075, 0, 0.01]);
        k.rbox(0.07, 0.016, 0.14, 0.006, '#1a2236', [0, 0.008, 0.03], { parent: b });
        k.sph(0.034, skin, [0, 0.03, 0.03], { parent: b, scale: [0.95, 0.6, 1.8] });
        for (let i = 0; i < 4; i++) k.sph(0.008, skin, [(i - 1.5) * 0.013, 0.022, 0.088 - Math.abs(i - 1.5) * 0.005], { parent: b, seg: 8 });
        k.cyl(0.036, 0.034, 0.04, navy, [0, 0.035, -0.01], { parent: b });
        for (const z of [0.03, 0.062]) k.rbox(0.072, 0.008, 0.012, 0.003, navy, [0, 0.045 - z * 0.25, z], { parent: b });
        k.tube([[s * 0.072, 0.27, 0.01], [s * 0.074, 0.15, 0], [s * 0.075, 0.05, 0.002]], 0.042, 0.03, wraps, { seg: 14 });
        for (let w = 0; w < 4; w++) k.tor(0.04 - w * 0.0025, 0.005, navy, [s * 0.073, 0.24 - w * 0.05, 0.006], { rot: [Math.PI / 2 + (w % 2 ? 0.2 : -0.2), 0, 0], rs: 8, ts: 28 });
        k.tube([[s * 0.06, 0.48, 0], [s * 0.07, 0.37, 0.012], [s * 0.072, 0.27, 0.01]], 0, 0, trousers, { radius: t => 0.064 - 0.02 * t });
      }
      k.sph(0.1, trousers, [0, 0.47, 0], { scale: [1.05, 0.7, 0.8] });

      // Lean torso: chest, a hint of pecs and abs
      k.lathe([[0, 0.45], [0.098, 0.45], [0.1, 0.52], [0.104, 0.58], [0.122, 0.68], [0.128, 0.73], [0.1, 0.77], [0.045, 0.79], [0, 0.795]], skin, [0, 0, 0], { scale: [1, 1, 0.72] });
      for (const s of [-1, 1]) {
        k.sph(0.045, skin, [s * 0.045, 0.672, 0.07], { scale: [1.15, 0.6, 0.25] });
        for (const y of [0.535, 0.572, 0.61]) k.sph(0.02, skin, [s * 0.022, y, 0.067], { scale: [1.1, 0.8, 0.4], seg: 14 });
      }
      k.cyl(0.036, 0.04, 0.09, skin, [0, 0.81, 0.005]);

      // Kimono shirt hanging open in a deep V, with a wide rolled collar
      const robeR = t => {
        const pts = [[0, 0.112], [0.35, 0.115], [0.7, 0.135], [0.88, 0.142], [1, 0.11]];
        for (let i = 1; i < pts.length; i++) {
          if (t <= pts[i][0]) return pts[i - 1][1] + ((t - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0])) * (pts[i][1] - pts[i - 1][1]);
        }
        return pts[pts.length - 1][1];
      };
      const robeGap = t => 0.55 + 1.3 * Math.pow(t, 1.3);
      const [ry0, ry1] = [0.46, 0.775];
      k.put(openRobeGeo(ry0, ry1, robeR, robeGap), kimono);
      const edge = s => [0, 0.25, 0.5, 0.75, 1].map(t => {
        const a = robeGap(t) / 2;
        const R = robeR(t) + 0.006;
        return [s * Math.sin(a) * R, ry0 + (ry1 - ry0) * t, Math.cos(a) * R * 0.78];
      });
      k.tube([...edge(1), [0.065, 0.788, -0.02], [0, 0.792, -0.055], [-0.065, 0.788, -0.02], ...edge(-1).reverse()], 0.013, 0.013, kimono, { seg: 70, radial: 10 });
      // Red-and-white paper fan on the upper back
      const fan = k.grp([0, 0.67, -0.107], { rot: [0, Math.PI, 0] });
      const half = (start, col, z) => k.put(new THREE.CylinderGeometry(0.03, 0.03, 0.003, 32, 1, false, start, Math.PI), col, [0, 0.006, z], { parent: fan, rot: [Math.PI / 2, 0, 0] });
      half(Math.PI / 2, k.M('#b3262e', { roughness: 0.6 }), 0.001);
      half(-Math.PI / 2, k.M('#f2eee6', { roughness: 0.6 }), 0.001);
      k.rbox(0.008, 0.03, 0.003, 0.0015, '#f2eee6', [0, -0.034, 0.001], { parent: fan });

      // Thick braided rope belt, looped three times, sitting low and loose
      [[0.475, 0.12, 0.06], [0.5, 0.118, -0.04], [0.523, 0.116, 0.03]].forEach(([y, R, tilt]) => {
        k.tor(R, 0.015, rope, [0, y, 0], { rot: [Math.PI / 2 + 0.1 + tilt, 0, 0], scale: [1, 0.8, 1], rs: 12, ts: 56 });
      });
      // Big bow at the back: two heavy loops, a knot and short hanging ends
      k.sph(0.025, rope, [0, 0.495, -0.115], { scale: [1, 0.9, 0.7] });
      for (const s of [-1, 1]) {
        k.tor(0.038, 0.014, rope, [s * 0.048, 0.5, -0.118], { rot: [0, 0, s * 0.3], scale: [1.25, 0.75, 1], rs: 10, ts: 32 });
        k.tube([[s * 0.008, 0.485, -0.12], [s * 0.022, 0.44, -0.125], [s * 0.028, 0.405, -0.118]], 0.013, 0.011, rope, { seg: 10 });
      }
      // Navy waist cloth hanging front and back, split at the sides
      for (const z of [0.098, -0.1]) {
        k.ext([[-0.07, 0], [0.07, 0], [0.08, -0.16], [-0.08, -0.16]], 0.003, apron, [0, 0.4, z], { rot: [z > 0 ? -0.1 : 0.1, 0, 0], bevel: 0.001 });
      }

      // Straight katana slid through the belt at the small of the back, hilt out to his right
      const sw = k.grp([0.02, 0.45, -0.14], { rot: [0, 0, -0.1] });
      k.tube([[0.2, 0, 0], [0.05, 0, 0], [-0.14, 0, 0]], 0.014, 0.014, sheath, { parent: sw, seg: 10 });
      k.cyl(0.016, 0.016, 0.012, '#2b2832', [-0.145, 0, 0], { parent: sw, rot: [0, 0, Math.PI / 2] });
      k.tube([[-0.152, 0, 0], [-0.3, 0, 0]], 0.012, 0.012, k.M(c, { map: T.checker(c, [4, 1]), roughness: 0.7 }), { parent: sw, seg: 8 });
      k.sph(0.014, '#2b2832', [-0.305, 0, 0], { parent: sw, scale: [0.6, 1, 1] });

      // Baggy sleeves to mid-forearm over navy arm warmers; right hand rests by the hilt
      for (const s of [-1, 1]) k.sph(0.055, kimono, [s * 0.145, 0.725, -0.005], { seg: 20 });
      arm(k, k.g, [[0.15, 0.72, 0], [0.19, 0.585, -0.01], [0.2, 0.44, 0.03]], 0.032, 0.025, navy, skin, { handScale: 1.1 });
      arm(k, k.g, [[-0.15, 0.72, 0], [-0.205, 0.6, -0.06], [-0.235, 0.49, -0.12]], 0.032, 0.025, navy, skin, { handScale: 1.1, fist: false, handRot: [0.3, 0, -0.2] });
      k.tube([[0.15, 0.725, 0], [0.18, 0.62, -0.005], [0.195, 0.53, 0.01]], 0, 0, kimono, { caps: false, radial: 20, radius: t => 0.05 + 0.014 * t });
      k.tube([[-0.15, 0.725, 0], [-0.19, 0.63, -0.04], [-0.215, 0.55, -0.085]], 0, 0, kimono, { caps: false, radial: 20, radius: t => 0.05 + 0.014 * t });

      // Narrow, angular face: sharp black eyes, low brows, flat mouth, pointed chin
      const r = 0.08;
      const hd = head(k, k.g, [0, 0.905, 0.01], {
        r, skinMat: skin, skin: SKIN_PALE, scale: [0.86, 1.06, 0.98], jaw: [0.8, 0.9, 0.92], eyeR: r * 0.145, eyeWhite: '#ebe6de', nose: false,
        lidAmt: 0.39, brows: '#14161f', browR: r * 0.045, liner: '#15151b', mouth: false,
      });
      k.g.userData.face = hd;
      // Deep black irises on the front of each eye (same spots the head puts the eyes)
      const [eg, ey, er] = [r * 0.38, r * 0.1, r * 0.145];
      const ez = Math.sqrt(r * r - eg * eg - ey * ey) * 0.92;
      for (const s of [-1, 1]) {
        const e = k.grp([s * eg, ey, ez], { parent: hd, rot: [0, s * 0.12, 0] });
        k.sph(er * 0.7, k.M('#08080b', { roughness: 0.15 }), [0, -er * 0.12, er * 0.8], { parent: e, scale: [1.05, 0.62, 0.35], seg: 16 });
        k.sph(er * 0.09, basic('#ffffff'), [-er * 0.25, er * 0.02, er * 1.0], { parent: e, seg: 8 });
        // Heavy upper lid line, slanting up at the outer corner
        k.tube([[-s * er * 0.75, er * 0.1, er * 0.75], [0, er * 0.38, er * 0.95], [s * er * 1.0, er * 0.42, er * 0.45]], er * 0.13, er * 0.07, '#15151b', { parent: e, seg: 10, radial: 8 });
      }
      // Lips pressed in a flat line
      k.tube([[-r * 0.14, -r * 0.5, r * 0.84], [0, -r * 0.5, r * 0.88], [r * 0.14, -r * 0.5, r * 0.84]], r * 0.028, r * 0.028, '#b5837c', { parent: hd, seg: 10, radial: 8 });
      // A fine, straight nose
      k.tube([[0, r * 0.05, r * 0.93], [0, -r * 0.1, r * 1.04], [0, -r * 0.17, r * 1.06]], r * 0.05, r * 0.08, skin, { parent: hd, seg: 10, radial: 12 });

      // Jet-black hair: a cap, jagged spikes swept back off the crown like tail feathers,
      // long bangs framing the face to the jaw and a few strands between the eyes
      const spike = (pts, w) => k.tube(pts, 0, 0, hair, { parent: hd, seg: 14, radial: 10, radius: t => w * Math.pow(1 - t, 0.9) });
      k.put(new THREE.SphereGeometry(r * 1.08, 40, 20, 0, TAU, 0, Math.PI * 0.6), hair, [0, r * 0.06, -r * 0.05], { parent: hd, rot: [-0.45, 0, 0], scale: [0.92, 1, 1] });
      k.sph(r * 0.95, hair, [0, r * 0.15, -r * 0.38], { parent: hd, scale: [0.95, 1, 1] });
      for (const [elev, n, len] of [[0.75, 4, 1.25], [0.35, 5, 1.55], [-0.05, 4, 1.3]]) {
        for (let i = 0; i < n; i++) {
          const a = (i / (n - 1) - 0.5) * 1.5;
          const base = new THREE.Vector3(Math.sin(a) * r * 0.55, r * (0.25 + elev * 0.45), -r * 0.6);
          const dir = new THREE.Vector3(Math.sin(a) * 0.8, elev, -1).normalize().multiplyScalar(len * r);
          const mid = base.clone().addScaledVector(dir, 0.5).add(new THREE.Vector3(0, r * 0.1, 0));
          spike([base.toArray(), mid.toArray(), base.clone().add(dir).toArray()], r * 0.24);
        }
      }
      for (const x of [-0.4, -0.1, 0.2, 0.5]) spike([[x * r, r * 0.95, r * 0.35], [x * r * 1.1, r * 1.15, -r * 0.2], [x * r * 1.3, r * 1.05, -r * 0.85]], r * 0.2);
      for (const x of [-0.5, -0.2, 0.15, 0.45]) spike([[x * r, r, r * 0.35], [x * r * 1.05, r * 0.85, r * 0.82], [x * r * 1.15, r * 0.52, r * 0.98]], r * 0.16);
      for (const s of [-1, 1]) {
        spike([[s * r * 0.3, r * 0.95, r * 0.55], [s * r * 0.72, r * 0.45, r * 0.86], [s * r * 0.86, -r * 0.25, r * 0.72], [s * r * 0.8, -r * 0.95, r * 0.5]], r * 0.2);
        spike([[s * r * 0.55, r * 0.9, r * 0.3], [s * r * 0.92, r * 0.25, r * 0.58], [s * r, -r * 0.5, r * 0.4], [s * r * 0.92, -r, r * 0.22]], r * 0.22);
      }
      spike([[-r * 0.05, r * 0.9, r * 0.72], [-r * 0.1, r * 0.5, r], [-r * 0.03, r * 0.08, r * 1.06]], r * 0.06);
      spike([[r * 0.08, r * 0.88, r * 0.7], [r * 0.06, r * 0.45, r], [r * 0.12, r * 0.15, r * 1.05]], r * 0.05);
      return k.g;
    },
  },
};

export const CHAMPION_IDS = Object.keys(CHAMPIONS);

// Build a champion scaled to fit on a tile: about 0.55 tall, never too wide for its spot.
export function buildChampion(id, color) {
  const def = CHAMPIONS[id] || CHAMPIONS.camel;
  const model = def.build(color);
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
const spin = { renderer: null, scene: null, cam: null, color: null, models: new Map(), canvases: new Map(), last: 0 };

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
    m.rotation.y = (t / 1000) * SPIN + n * 0.4;
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
  }
  if (!spin.models.has(id)) spin.models.set(id, buildChampion(id, color));
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
export function championPortrait(id, color) {
  const key = `${id}|${color}`;
  if (portraits.has(key)) return portraits.get(key);
  if (!spin.renderer) setupSpin();
  const m = buildChampion(id, color);
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
  const url = spin.renderer.domElement.toDataURL();
  portraits.set(key, url);
  return url;
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
      if (model) scene.remove(model);
      model = buildChampion(id, color);
      model.traverse(o => { if (o.isMesh && !o.userData.glow) o.castShadow = true; });
      scene.add(model);
      const hgt = model.userData.height;
      cam.position.set(0, hgt * 0.75, hgt * 2.6);
      cam.lookAt(0, hgt * 0.48, 0);
      t0 = performance.now();
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      cancelAnimationFrame(raf);
      raf = 0;
      if (model) scene.remove(model);
      model = null;
    },
  };
}
