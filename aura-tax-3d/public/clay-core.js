// Clay core: the maths behind clay.js, with no dependencies so it runs in a worker as well as on the page.
// A recipe is a list of plain shapes (numbers only). mesh() turns it into a smooth mesh, one set of buffers per
// material channel: { channel: { pos, nor, col, idx } } as typed arrays.

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------
function hash3(i, j, k) {
  let h = Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function noise3(x, y, z) {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const h000 = hash3(i, j, k);
  const h100 = hash3(i + 1, j, k);
  const h010 = hash3(i, j + 1, k);
  const h110 = hash3(i + 1, j + 1, k);
  const h001 = hash3(i, j, k + 1);
  const h101 = hash3(i + 1, j, k + 1);
  const h011 = hash3(i, j + 1, k + 1);
  const h111 = hash3(i + 1, j + 1, k + 1);
  const a = h000 + (h100 - h000) * u;
  const b = h010 + (h110 - h010) * u;
  const c = h001 + (h101 - h001) * u;
  const d = h011 + (h111 - h011) * u;
  const e = a + (b - a) * v;
  return e + ((c + (d - c) * v) - e) * w; // 0..1
}
export function fbm(x, y, z, oct = 2) {
  let s = 0;
  let amp = 0.5;
  let f = 1;
  let norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * noise3(x * f + o * 17.3, y * f, z * f);
    norm += amp;
    amp *= 0.5;
    f *= 2.03;
  }
  return s / norm;
}

const len3 = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth01 = t => t * t * (3 - 2 * t);

// Shape kinds (numbers are faster to switch on than strings)
export const BALL = 0;
export const CONE = 1;
export const ELL = 2;
export const BOX = 3;
export const TORUS = 4;
export const CYL = 5;
export const PLANE = 6;
export const OP_ADD = 0;
export const OP_SUB = 1;
export const OP_AND = 2;

// ---------------------------------------------------------------------------
// One shape: distance in world units, plus its surface pattern (disp)
// Every shape: { t, op, k, col: [r,g,b], mat, bump: [amp, freq] | null, tint, disp, inv: 16 numbers | null, s, ... }
// ---------------------------------------------------------------------------
function dist(p, x, y, z) {
  let lx = x;
  let ly = y;
  let lz = z;
  const e = p.inv;
  if (e) {
    lx = e[0] * x + e[4] * y + e[8] * z + e[12];
    ly = e[1] * x + e[5] * y + e[9] * z + e[13];
    lz = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  let r;
  switch (p.t) {
    case BALL: r = len3(lx - p.x, ly - p.y, lz - p.z) - p.r; break;
    case CONE: {
      // Rounded cone between two points with two radii (exact, after Inigo Quilez)
      const pax = lx - p.ax;
      const pay = ly - p.ay;
      const paz = lz - p.az;
      const yy = pax * p.bx + pay * p.by + paz * p.bz;
      const zz = yy - p.l2;
      const xx = pax * p.l2 - p.bx * yy;
      const xy = pay * p.l2 - p.by * yy;
      const xz = paz * p.l2 - p.bz * yy;
      const x2 = xx * xx + xy * xy + xz * xz;
      const y2 = yy * yy * p.l2;
      const z2 = zz * zz * p.l2;
      const k = Math.sign(p.rr) * p.rr * p.rr * x2;
      if (Math.sign(zz) * p.a2 * z2 > k) r = Math.sqrt(x2 + z2) * p.il2 - p.rb;
      else if (Math.sign(yy) * p.a2 * y2 < k) r = Math.sqrt(x2 + y2) * p.il2 - p.ra;
      else r = (Math.sqrt(x2 * p.a2 * p.il2) + yy * p.rr) * p.il2 - p.ra;
      break;
    }
    case ELL: {
      const k0 = len3(lx / p.rx, ly / p.ry, lz / p.rz);
      const k1 = len3(lx / (p.rx * p.rx), ly / (p.ry * p.ry), lz / (p.rz * p.rz));
      r = k1 > 1e-9 ? (k0 * (k0 - 1)) / k1 : -Math.min(p.rx, p.ry, p.rz);
      break;
    }
    case BOX: {
      const qx = Math.abs(lx) - p.bx + p.r;
      const qy = Math.abs(ly) - p.by + p.r;
      const qz = Math.abs(lz) - p.bz + p.r;
      r = len3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0) - p.r;
      break;
    }
    case TORUS: r = Math.hypot(Math.hypot(lx, lz) - p.R, ly) - p.r; break;
    case CYL: {
      const dx = Math.hypot(lx, lz) - p.r + p.rd;
      const dy = Math.abs(ly) - p.h + p.rd;
      r = Math.min(Math.max(dx, dy), 0) + Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) - p.rd;
      break;
    }
    case PLANE: r = lx * p.nx + ly * p.ny + lz * p.nz - p.d; break;
    default: r = 1e9;
  }
  if (p.disp) r += displace(p, p.disp, lx, ly, lz);
  if (e) r *= p.s;
  // Optional clip: keep only the side of a plane (world space) where n.p < d, edge softened by c[4]
  const c = p.clip;
  if (c) {
    const q = x * c[0] + y * c[1] + z * c[2] - c[3];
    if (c[4] > 0) {
      const h = clamp(0.5 - 0.5 * (q - r) / c[4], 0, 1);
      r = q + (r - q) * h + c[4] * h * (1 - h);
    } else if (q > r) r = q;
  }
  return r;
}

// Surface patterns pushed in and out of a shape, in its local space
function displace(p, d, x, y, z) {
  switch (d.t) {
    // Vertical ridges around the local y axis (cactus ribs, pleats, folds). shape > 1 makes them sharper valleys.
    case 'ribs': {
      const a = Math.atan2(z, x) * d.n + (d.ph || 0) + (d.twist || 0) * y;
      const c = Math.cos(a);
      const w = d.fade ? clamp((y - d.fade[0]) / (d.fade[1] - d.fade[0]), 0, 1) : 1;
      return -d.a * (d.sharp ? Math.sign(c) * Math.pow(Math.abs(c), d.sharp) : c) * w;
    }
    // Rings around a cone's axis (leech segments, sleeve gathers): by length along the shape
    case 'rings': {
      let s;
      if (p.t === CONE) s = ((x - p.ax) * p.bx + (y - p.ay) * p.by + (z - p.az) * p.bz) / Math.sqrt(p.l2) + (d.s0 || 0);
      else s = y;
      return -d.a * Math.abs(Math.sin(s * d.f * Math.PI));
    }
    // Soft fabric folds: waves along one axis, wobbling with height
    case 'folds': {
      const a = x * d.ax[0] + y * d.ax[1] + z * d.ax[2];
      return d.a * Math.sin(a * d.f + Math.sin(y * d.f * 0.37 + (d.ph || 0)) * 1.4);
    }
    default: return 0;
  }
}

// Colour patterns, evaluated only for the final vertices
function tintAt(p, x, y, z, out) {
  let r = p.col[0];
  let g = p.col[1];
  let b = p.col[2];
  for (const t of p.tint) {
    let lx = x;
    let ly = y;
    let lz = z;
    if (t.local && p.inv) {
      const e = p.inv;
      lx = e[0] * x + e[4] * y + e[8] * z + e[12];
      ly = e[1] * x + e[5] * y + e[9] * z + e[13];
      lz = e[2] * x + e[6] * y + e[10] * z + e[14];
    }
    let m = 0;
    switch (t.t) {
      case 'noise': { // brightness variation
        const n = (fbm(lx * t.f, ly * t.f, lz * t.f, 2) - 0.5) * 2 * t.a;
        r *= 1 + n; g *= 1 + n; b *= 1 + n;
        continue;
      }
      case 'mix': m = smooth01(clamp((fbm(lx * t.f, ly * t.f, lz * t.f, 3) - t.th) / (t.soft || 0.08) + 0.5, 0, 1)); break;
      case 'stripes': {
        const s = Math.sin((lx * t.ax[0] + ly * t.ax[1] + lz * t.ax[2]) * t.f * Math.PI * 2);
        m = smooth01(clamp((s - (t.w ?? 0)) / (t.soft || 0.3) + 0.5, 0, 1));
        break;
      }
      case 'plaid': {
        const u = Math.sin(lx * t.f * Math.PI * 2);
        const v = Math.sin(ly * t.f * Math.PI * 2);
        m = (smooth01(clamp(u * 3 - 1.2, 0, 1)) + smooth01(clamp(v * 3 - 1.2, 0, 1))) * 0.5;
        break;
      }
      case 'grad': {
        const s = lx * t.ax[0] + ly * t.ax[1] + lz * t.ax[2];
        m = smooth01(clamp((s - t.a0) / (t.a1 - t.a0), 0, 1));
        break;
      }
      case 'spots': m = smooth01(clamp((noise3(lx * t.f, ly * t.f, lz * t.f) - t.th) / 0.05, 0, 1)); break;
      default: continue;
    }
    const k = m * (t.amt ?? 1);
    r += (t.c[0] - r) * k;
    g += (t.c[1] - g) * k;
    b += (t.c[2] - b) * k;
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
}

// ---------------------------------------------------------------------------
// The field: shapes combined in order with smooth union / subtraction / intersection
// ---------------------------------------------------------------------------
const tcol = [0, 0, 0];
function field(prims, list, x, y, z, out) {
  let D = 1e9;
  let cr = 0.5;
  let cg = 0.5;
  let cb = 0.5;
  let mat = -1;
  let ba = 0;
  let bf = 0;
  for (let n = 0; n < list.length; n++) {
    const p = prims[list[n]];
    const k = p.k;
    // A shape that can't reach within k of the surface so far changes nothing (distance or colour): skip it. Its bound
    // sphere gives a lower limit on its distance for one square root, instead of the full shape.
    if (p.op !== OP_AND) {
      const b = p.bound;
      const lb = len3(x - b[0], y - b[1], z - b[2]) - b[3];
      if (p.op === OP_ADD ? D < 1e8 && lb >= D + k : lb >= k - D) continue;
    }
    const d = dist(p, x, y, z);
    let h;
    if (p.op === OP_ADD) {
      if (D >= 1e8) { D = d; h = 0; } else if (k <= 0) { h = d < D ? 0 : 1; if (d < D) D = d; } else {
        h = clamp(0.5 + 0.5 * (d - D) / k, 0, 1);
        D = d + (D - d) * h - k * h * (1 - h);
      }
      if (h < 1) {
        const pa = p.bump ? p.bump[0] : 0;
        ba = pa + (ba - pa) * h;
        if (p.bump && (h < 0.5 || !bf)) bf = p.bump[1];
      }
    } else if (p.op === OP_SUB) {
      let hh;
      if (k <= 0) { hh = -d > D ? 1 : 0; if (-d > D) D = -d; } else {
        hh = clamp(0.5 - 0.5 * (D + d) / k, 0, 1);
        D = D + (-d - D) * hh + k * hh * (1 - hh);
      }
      h = p.paint ? 1 - hh : 1;
    } else {
      if (k <= 0) { if (d > D) D = d; } else {
        const hh = clamp(0.5 - 0.5 * (D - d) / k, 0, 1);
        D = D + (d - D) * hh + k * hh * (1 - hh);
      }
      h = 1;
    }
    if (out && h < 1) {
      let r0 = p.col[0];
      let g0 = p.col[1];
      let b0 = p.col[2];
      if (p.tint) { tintAt(p, x, y, z, tcol); r0 = tcol[0]; g0 = tcol[1]; b0 = tcol[2]; }
      cr = r0 + (cr - r0) * h;
      cg = g0 + (cg - g0) * h;
      cb = b0 + (cb - b0) * h;
      if (h < 0.5 || mat < 0) mat = p.mat;
    }
  }
  if (ba > 1e-6 && D < ba * 3 && D > -ba * 3) D += (fbm(x * bf, y * bf, z * bf, 2) - 0.5) * 2 * ba;
  if (out) { out[0] = cr; out[1] = cg; out[2] = cb; out[3] = mat < 0 ? 0 : mat; }
  return D;
}

// ---------------------------------------------------------------------------
// Meshing: sparse surface nets. Coarse cells far from the surface are skipped; each fine cell the surface crosses
// gets one vertex, pulled onto the surface along the field's gradient (which is also its normal).
// ---------------------------------------------------------------------------
export function mesh(prims, voxel) {
  let x0 = Infinity; let y0 = Infinity; let z0 = Infinity;
  let x1 = -Infinity; let y1 = -Infinity; let z1 = -Infinity;
  for (const p of prims) {
    if (p.op !== OP_ADD) continue;
    const b = p.bound;
    x0 = Math.min(x0, b[0] - b[3]); y0 = Math.min(y0, b[1] - b[3]); z0 = Math.min(z0, b[2] - b[3]);
    x1 = Math.max(x1, b[0] + b[3]); y1 = Math.max(y1, b[1] + b[3]); z1 = Math.max(z1, b[2] + b[3]);
  }
  const S = 4;
  let v = voxel;
  const pad = v * 2;
  x0 -= pad; y0 -= pad; z0 -= pad; x1 += pad; y1 += pad; z1 += pad;
  while (((x1 - x0) / v) * ((y1 - y0) / v) * ((z1 - z0) / v) > 7e6) v *= 1.12;
  const cs = v * S;
  const ncx = Math.max(1, Math.ceil((x1 - x0) / cs));
  const ncy = Math.max(1, Math.ceil((y1 - y0) / cs));
  const ncz = Math.max(1, Math.ceil((z1 - z0) / cs));
  const nx = ncx * S;
  const ny = ncy * S;
  const nz = ncz * S;
  const px = nx + 1;
  const py = ny + 1;
  const vals = new Float32Array(px * py * (nz + 1)).fill(NaN);

  // Which shapes can matter in each coarse cell: each shape is stamped into the cells its bounds reach (a capsule for
  // limbs, a sphere for the rest), in order, so every list keeps the shapes' order.
  const halfDiag = cs * 0.8660254;
  const ncell = ncx * ncy * ncz;
  const lists = new Array(ncell).fill(null);
  const adds = new Uint8Array(ncell);
  for (let n = 0; n < prims.length; n++) {
    const p = prims[n];
    const b = p.bound;
    const m = halfDiag + p.k + v * 2;
    const R = Math.min(b[3], 1e3) + m;
    const capsule = p.t === CONE && !p.inv;
    const segR = capsule ? b[3] - Math.sqrt(p.l2) / 2 + m : 0; // the limb's thickest radius plus extras, plus the margin
    const i0 = clamp(Math.floor((b[0] - R - x0) / cs), 0, ncx - 1);
    const i1 = clamp(Math.floor((b[0] + R - x0) / cs), 0, ncx - 1);
    const j0 = clamp(Math.floor((b[1] - R - y0) / cs), 0, ncy - 1);
    const j1 = clamp(Math.floor((b[1] + R - y0) / cs), 0, ncy - 1);
    const k0 = clamp(Math.floor((b[2] - R - z0) / cs), 0, ncz - 1);
    const k1 = clamp(Math.floor((b[2] + R - z0) / cs), 0, ncz - 1);
    for (let k = k0; k <= k1; k++) {
      const cz = z0 + (k + 0.5) * cs;
      for (let j = j0; j <= j1; j++) {
        const cy = y0 + (j + 0.5) * cs;
        for (let i = i0; i <= i1; i++) {
          const cx = x0 + (i + 0.5) * cs;
          if (capsule) {
            const t = clamp(((cx - p.ax) * p.bx + (cy - p.ay) * p.by + (cz - p.az) * p.bz) * p.il2, 0, 1);
            if (len3(cx - p.ax - p.bx * t, cy - p.ay - p.by * t, cz - p.az - p.bz * t) > segR) continue;
          } else if (len3(cx - b[0], cy - b[1], cz - b[2]) > R) continue;
          const id = i + ncx * (j + ncy * k);
          (lists[id] || (lists[id] = [])).push(n);
          if (p.op === OP_ADD) adds[id] = 1;
        }
      }
    }
  }
  for (let id = 0; id < ncell; id++) if (!adds[id]) lists[id] = null;
  const listAt = (x, y, z) => {
    const i = clamp(Math.floor((x - x0) / cs), 0, ncx - 1);
    const j = clamp(Math.floor((y - y0) / cs), 0, ncy - 1);
    const k = clamp(Math.floor((z - z0) / cs), 0, ncz - 1);
    return lists[i + ncx * (j + ncy * k)];
  };
  const evalPt = (i, j, k) => {
    const id = i + px * (j + py * k);
    let d = vals[id];
    if (d === d) return d;
    const x = x0 + i * v;
    const y = y0 + j * v;
    const z = z0 + k * v;
    const ci = Math.min(ncx - 1, Math.floor(i / S));
    const cj = Math.min(ncy - 1, Math.floor(j / S));
    const ck = Math.min(ncz - 1, Math.floor(k / S));
    const l = lists[ci + ncx * (cj + ncy * ck)];
    d = l ? field(prims, l, x, y, z) : cs;
    vals[id] = d;
    return d;
  };

  // Coarse pass
  const active = [];
  const reach = halfDiag * 1.3 + v;
  for (let k = 0; k < ncz; k++) {
    for (let j = 0; j < ncy; j++) {
      for (let i = 0; i < ncx; i++) {
        if (!lists[i + ncx * (j + ncy * k)]) continue;
        let near = false;
        let neg = false;
        let pos = false;
        for (let c = 0; c < 8; c++) {
          const d = evalPt((i + (c & 1)) * S, (j + ((c >> 1) & 1)) * S, (k + ((c >> 2) & 1)) * S);
          if (d < reach && d > -reach) { near = true; break; }
          if (d < 0) neg = true; else pos = true;
        }
        if (near || (neg && pos)) active.push(i, j, k);
      }
    }
  }

  // Fine pass: a vertex in each crossed cell (average of the crossings on its edges). Vertex numbers are kept in one
  // 4x4x4 block per active coarse cell.
  const blockOf = new Int32Array(ncell).fill(-1);
  for (let a = 0; a < active.length; a += 3) blockOf[active[a] + ncx * (active[a + 1] + ncy * active[a + 2])] = a / 3;
  const vertOf = new Int32Array((active.length / 3) * 64).fill(-1);
  const cellVert = (i, j, k) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) return -1;
    const bl = blockOf[(i >> 2) + ncx * ((j >> 2) + ncy * (k >> 2))];
    return bl < 0 ? -1 : vertOf[bl * 64 + (i & 3) + 4 * ((j & 3) + 4 * (k & 3))];
  };
  const crossed = []; // i, j, k of every cell that got a vertex
  const vx = [];
  const cn = new Float32Array(8);
  const E0 = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3];
  const E1 = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7];
  for (let a = 0; a < active.length; a += 3) {
    const ci = active[a] * S;
    const cj = active[a + 1] * S;
    const ck = active[a + 2] * S;
    for (let k = ck; k < ck + S; k++) {
      for (let j = cj; j < cj + S; j++) {
        for (let i = ci; i < ci + S; i++) {
          let mask = 0;
          for (let c = 0; c < 8; c++) {
            const d = evalPt(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1));
            cn[c] = d;
            if (d < 0) mask |= 1 << c;
          }
          if (mask === 0 || mask === 255) continue;
          let sx = 0; let sy = 0; let sz = 0; let n = 0;
          for (let q = 0; q < 12; q++) {
            const e0 = E0[q];
            const e1 = E1[q];
            const d0 = cn[e0];
            const d1 = cn[e1];
            if ((d0 < 0) === (d1 < 0)) continue;
            const t = d0 / (d0 - d1);
            sx += (e0 & 1) + ((e1 & 1) - (e0 & 1)) * t;
            sy += ((e0 >> 1) & 1) + (((e1 >> 1) & 1) - ((e0 >> 1) & 1)) * t;
            sz += ((e0 >> 2) & 1) + (((e1 >> 2) & 1) - ((e0 >> 2) & 1)) * t;
            n++;
          }
          vertOf[(a / 3) * 64 + (i & 3) + 4 * ((j & 3) + 4 * (k & 3))] = vx.length / 3;
          crossed.push(i, j, k);
          vx.push(x0 + (i + sx / n) * v, y0 + (j + sy / n) * v, z0 + (k + sz / n) * v);
        }
      }
    }
  }

  // Faces: a quad around every crossed grid edge
  const tris = [];
  const Q = [
    [[0, 0, 0], [0, -1, 0], [0, -1, -1], [0, 0, -1]],
    [[0, 0, 0], [0, 0, -1], [-1, 0, -1], [-1, 0, 0]],
    [[0, 0, 0], [-1, 0, 0], [-1, -1, 0], [0, -1, 0]],
  ];
  const q = [0, 0, 0, 0];
  for (let cv = 0; cv < crossed.length; cv += 3) {
    const i = crossed[cv];
    const j = crossed[cv + 1];
    const k = crossed[cv + 2];
    const d0 = evalPt(i, j, k);
    for (let ax = 0; ax < 3; ax++) {
      const d1 = ax === 0 ? evalPt(i + 1, j, k) : ax === 1 ? evalPt(i, j + 1, k) : evalPt(i, j, k + 1);
      if ((d0 < 0) === (d1 < 0)) continue;
      let ok = true;
      for (let c = 0; c < 4; c++) {
        const [di, dj, dk] = Q[ax][c];
        const a = i + di;
        const b = j + dj;
        const cc = k + dk;
        const id = cellVert(a, b, cc);
        if (id < 0) { ok = false; break; }
        q[c] = id;
      }
      if (!ok) continue;
      if (d0 < 0) tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      else tris.push(q[0], q[2], q[1], q[0], q[3], q[2]);
    }
  }

  // Each vertex: one Newton step onto the surface, normal from the gradient, colour and channel
  const nv = vx.length / 3;
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const mat = new Uint8Array(nv);
  const out = [0, 0, 0, 0];
  const e = v * 0.5;
  const empty = [];
  for (let n = 0; n < nv; n++) {
    let x = vx[n * 3];
    let y = vx[n * 3 + 1];
    let z = vx[n * 3 + 2];
    const l = listAt(x, y, z) || empty;
    const a = field(prims, l, x + e, y - e, z - e);
    const b = field(prims, l, x - e, y - e, z + e);
    const c = field(prims, l, x - e, y + e, z - e);
    const d = field(prims, l, x + e, y + e, z + e);
    let gx = a - b - c + d;
    let gy = -a - b + c + d;
    let gz = -a + b - c + d;
    const gl = len3(gx, gy, gz) || 1;
    gx /= gl; gy /= gl; gz /= gl;
    const f = (a + b + c + d) * 0.25; // the field at the centre, near enough
    const step = clamp(f, -v, v);
    x -= gx * step; y -= gy * step; z -= gz * step;
    field(prims, l, x, y, z, out);
    pos[n * 3] = x; pos[n * 3 + 1] = y; pos[n * 3 + 2] = z;
    nor[n * 3] = gx; nor[n * 3 + 1] = gy; nor[n * 3 + 2] = gz;
    col[n * 3] = out[0]; col[n * 3 + 1] = out[1]; col[n * 3 + 2] = out[2];
    mat[n] = out[3];
  }

  // Split by material channel
  const byMat = new Map();
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t];
    const b = tris[t + 1];
    const c = tris[t + 2];
    const m = mat[a] === mat[b] || mat[a] === mat[c] ? mat[a] : mat[b];
    let arr = byMat.get(m);
    if (!arr) byMat.set(m, (arr = []));
    arr.push(a, b, c);
  }
  const res = {};
  for (const [m, idx] of byMat) {
    const remap = new Int32Array(nv).fill(-1);
    let count = 0;
    for (const vi of idx) if (remap[vi] < 0) remap[vi] = count++;
    const P = new Float32Array(count * 3);
    const N = new Float32Array(count * 3);
    const C = new Float32Array(count * 3);
    for (let vi = 0; vi < nv; vi++) {
      const ni = remap[vi];
      if (ni < 0) continue;
      for (let c = 0; c < 3; c++) {
        P[ni * 3 + c] = pos[vi * 3 + c];
        N[ni * 3 + c] = nor[vi * 3 + c];
        C[ni * 3 + c] = col[vi * 3 + c];
      }
    }
    const I = count > 65535 ? new Uint32Array(idx.length) : new Uint16Array(idx.length);
    for (let t = 0; t < idx.length; t++) I[t] = remap[idx[t]];
    res[m] = { pos: P, nor: N, col: C, idx: I };
  }
  return res;
}

// Colours for vertices that are already on the surface (a mesh made earlier from the same shapes in other colours).
// Only the shapes near each vertex are evaluated. Fills res[channel].col.
export function recolor(prims, res) {
  const out = [0, 0, 0, 0];
  const list = [];
  for (const m of Object.values(res)) {
    const P = m.pos;
    const n = P.length / 3;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const x = P[i * 3];
      const y = P[i * 3 + 1];
      const z = P[i * 3 + 2];
      list.length = 0;
      for (let q = 0; q < prims.length; q++) {
        const b = prims[q].bound;
        const dx = x - b[0];
        const dy = y - b[1];
        const dz = z - b[2];
        const r = b[3] + prims[q].k * 2 + 0.002;
        if (dx * dx + dy * dy + dz * dz < r * r) list.push(q);
      }
      field(prims, list, x, y, z, out);
      col[i * 3] = out[0];
      col[i * 3 + 1] = out[1];
      col[i * 3 + 2] = out[2];
    }
    m.col = col;
  }
  return res;
}
