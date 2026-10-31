// Sculpted body parts for the champions, built with clay (see clay.js). Each one works in its own local frame, so a
// champion places it with C.at(position, rotation, () => part(C, options)).
//
// Heads face +z with the centre of the skull at the origin; hands hang along -y from the wrist with the palm facing
// +x (pass side: -1 to mirror). Sizes are in the champion's 1-unit-tall modelling space.

export const SKIN = '#e9b48c';

// Material settings for each clay channel. Vertex colours carry the colour; these carry the finish.
export const MATS = {
  skin: { physical: true, roughness: 0.55, sheen: 0.35, sheenRoughness: 0.55, sheenColor: '#ffd6c4' },
  lips: { physical: true, roughness: 0.38, sheen: 0.3, sheenRoughness: 0.4, sheenColor: '#ffd0d0' },
  cloth: { physical: true, roughness: 0.88, sheen: 0.22, sheenRoughness: 0.6, sheenColor: '#d8d8d8' },
  knit: { physical: true, roughness: 1, sheen: 0.8, sheenRoughness: 0.8, sheenColor: '#ffffff' },
  fur: { physical: true, roughness: 0.92, sheen: 0.7, sheenRoughness: 0.7, sheenColor: '#fff2dc' },
  hair: { physical: true, roughness: 0.42, sheen: 1, sheenRoughness: 0.35, sheenColor: '#ffffff', clearcoat: 0.25, clearcoatRoughness: 0.5 },
  scale: { physical: true, roughness: 0.4, clearcoat: 0.45, clearcoatRoughness: 0.3 },
  gloss: { physical: true, roughness: 0.22, clearcoat: 0.7, clearcoatRoughness: 0.12 },
  slime: { physical: true, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 },
  leather: { physical: true, roughness: 0.5, clearcoat: 0.2, clearcoatRoughness: 0.5 },
  horn: { physical: true, roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.3 },
  plant: { physical: true, roughness: 0.5, sheen: 0.3, sheenRoughness: 0.5, sheenColor: '#e8ffd8', clearcoat: 0.15, clearcoatRoughness: 0.5 },
  clayPot: { roughness: 0.85 },
  metal: { metalness: 0.85, roughness: 0.3 },
  dark: { roughness: 0.6 },
  base: { roughness: 0.6 },
};

const mixHex = (a, b, t) => {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = s => Math.round(((pa >> s) & 255) + ((((pb >> s) & 255) - ((pa >> s) & 255)) * t));
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
};
export const darken = (c, t) => mixHex(c, '#000000', t);
export const lighten = (c, t) => mixHex(c, '#ffffff', t);

// ---------------------------------------------------------------------------
// Head
// ---------------------------------------------------------------------------
// o: r (head radius), skin, lips, brows (hair colour or false), browR, nose ('normal' | 'fine' | 'broad' | 'hook' |
// false), mouth ('smile' | 'smirk' | 'flat' | 'frown' | 'grin' | false), jaw (width), chin (size), cheeks, brow (ridge
// size), ears, eyeGap, eyeY, eyeR, lids (upper lid cover 0..1), lowerLid, age (wrinkle strength), neck, mat
// Returns { eyes: [[x, y, z], [x, y, z]], er } for eyeMeshes().
export function sHead(C, o = {}) {
  const r = o.r || 0.1;
  const skin = o.skin || SKIN;
  const age = o.age || 0;
  const S = { color: skin, mat: o.mat || 'skin', bump: [r * (0.006 + age * 0.025), (8 + age * 6) / r] };
  const jw = o.jaw ?? 1;
  const er = o.eyeR ?? r * 0.18;
  const gap = o.eyeGap ?? r * 0.36;
  const ey = o.eyeY ?? r * 0.06;
  const ez = o.eyeZ ?? r * 0.71;

  // Skull, the face block, jaw and chin
  C.ell([0, r * 0.12, -r * 0.08], [r * 0.9, r * 0.98, r * 0.98], { ...S, k: 0 });
  C.ell([0, -r * 0.2, r * 0.2], [r * 0.76, r * 0.76, r * 0.74], { ...S, k: r * 0.3 });
  C.ell([0, -r * 0.6, r * 0.32], [r * 0.52 * jw, r * 0.3, r * 0.46], { ...S, k: r * 0.32 });
  C.ball([0, -r * 0.8, r * 0.56], r * 0.15 * (o.chin ?? 1), { ...S, k: r * 0.22 });
  // Cheekbones and brow ridge
  for (const s of [-1, 1]) C.ell([s * r * 0.48, -r * 0.1, r * 0.56], [r * 0.25, r * 0.16, r * 0.2], { ...S, k: r * 0.2 });
  C.ell([0, ey + er * 1.45, r * 0.7], [r * 0.64, r * 0.12 * (o.brow ?? 1), r * 0.2], { ...S, k: r * 0.2 });
  // Eye sockets, then upper and lower lids wrapped around where the eyeballs sit
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = [s * gap, ey, ez];
    eyes.push(e);
    C.ball(e, er * 1.04, { ...S, op: 'sub', k: r * 0.035 });
    const lid = o.lids ?? 0.18; // how far the upper lid comes down over the eye
    C.ball(e, er * 1.13, { ...S, k: r * 0.03, clip: [[e[0], e[1] + er * (0.75 - lid * 1.3), e[2]], [s * 0.08, -1, -0.28], er * 0.06] });
    if (o.lowerLid !== false) C.ball(e, er * 1.09, { ...S, k: r * 0.03, clip: [[e[0], e[1] - er * 0.7, e[2]], [0, 1, -0.45], er * 0.06] });
  }
  // Nose
  const nose = o.nose ?? 'normal';
  if (nose) {
    const ns = o.noseSize || 1;
    const nz = r * 0.98;
    if (nose === 'hook') {
      C.limb([[0, ey + er * 0.6, nz - r * 0.1], [0, -r * 0.02, nz + r * 0.22 * ns], [0, -r * 0.22, nz + r * 0.32 * ns], [0, -r * 0.36, nz + r * 0.2 * ns]], [r * 0.07, r * 0.1, r * 0.09, r * 0.05], { ...S, k: r * 0.08 });
      for (const s of [-1, 1]) C.ell([s * r * 0.1, -r * 0.24, nz + r * 0.04], [r * 0.07, r * 0.06, r * 0.07], { ...S, k: r * 0.05 });
    } else {
      const w = nose === 'broad' ? 1.35 : nose === 'fine' ? 0.8 : 1;
      C.cone([0, ey + er * 0.5, nz - r * 0.12], [0, -r * 0.12, nz + r * 0.06 * ns], r * 0.055 * w, r * 0.085 * w, { ...S, k: r * 0.08 });
      C.ball([0, -r * 0.15, nz + r * 0.08 * ns], r * 0.095 * w * ns, { ...S, k: r * 0.06 });
      for (const s of [-1, 1]) C.ell([s * r * 0.105 * w, -r * 0.2, nz - r * 0.02], [r * 0.06 * w, r * 0.05, r * 0.06], { ...S, k: r * 0.05 });
    }
    for (const s of [-1, 1]) C.ball([s * r * 0.055, -r * 0.255, nz + r * 0.01], r * 0.028, { ...S, op: 'sub', k: r * 0.02, color: darken(skin, 0.45), paint: true });
  }
  // Mouth: a carved line along a curve, with lips above and below it
  const mouth = o.mouth ?? 'smile';
  if (mouth) {
    const lips = o.lips || darken(mixHex(skin, '#b8505a', 0.32), 0.06);
    const my = -r * 0.47;
    const mz = r * 0.9;
    const curve = { smile: [0.06, 0.06], grin: [0.1, 0.1], flat: [0, 0], frown: [-0.05, -0.05], smirk: [-0.01, 0.09] }[mouth] || [0, 0];
    const w = r * (mouth === 'grin' ? 0.27 : 0.22);
    const line = [[-w, my + curve[0] * r, mz - r * 0.12], [-w * 0.45, my, mz - r * 0.02], [0, my - r * 0.01, mz], [w * 0.45, my, mz - r * 0.02], [w, my + curve[1] * r, mz - r * 0.12]];
    const L = { color: lips, mat: 'lips', k: r * 0.035 };
    C.limb(line.map(([x, y, z]) => [x * 0.9, y + r * 0.032, z - r * 0.01]), [r * 0.018, r * 0.034, r * 0.038, r * 0.034, r * 0.018], L);
    C.limb(line.map(([x, y, z]) => [x * 0.8, y - r * 0.045, z - r * 0.015]), [r * 0.016, r * 0.036, r * 0.044, r * 0.036, r * 0.016], L);
    C.limb(line.map(([x, y, z]) => [x * 1.04, y, z + r * 0.03]), [r * 0.016, r * 0.026, r * 0.03, r * 0.026, r * 0.016], { op: 'sub', k: r * 0.014, color: darken(lips, 0.7), paint: true });
  }
  // Ears with a hollow and a lobe
  if (o.ears !== false) {
    for (const s of [-1, 1]) {
      C.ell([s * r * 0.92, -r * 0.06, -r * 0.04], [r * 0.09, r * 0.26, r * 0.17], { ...S, k: r * 0.06, rot: [0, s * 0.3, s * 0.08] });
      C.ell([s * r * 0.99, -r * 0.04, -r * 0.0], [r * 0.05, r * 0.16, r * 0.09], { ...S, op: 'sub', k: r * 0.03, rot: [0, s * 0.3, 0], color: darken(skin, 0.25), paint: true });
      C.ball([s * r * 0.92, -r * 0.27, r * 0.0], r * 0.07, { ...S, k: r * 0.04 });
    }
  }
  // Eyebrows: hair laid on the brow ridge
  if (o.brows) {
    const bR = o.browR || r * 0.045;
    for (const s of [-1, 1]) {
      const by = ey + er * 1.38 + (o.browLift || 0) * r;
      C.limb([[s * gap * 0.3, by - r * 0.02, r * 0.93], [s * gap * 0.95, by + r * 0.035 * (o.browArch ?? 1), r * 0.9], [s * gap * 1.6, by - r * 0.035, r * 0.74]], [bR, bR * 1.1, bR * 0.55], { color: o.brows, mat: 'hair', k: r * 0.008 });
    }
  }
  if (o.neck !== false) C.cone([0, -r * 0.55, -r * 0.18], [0, -r * 1.35, -r * 0.2], r * 0.4 * (o.neck || 1), r * 0.46 * (o.neck || 1), { ...S, k: r * 0.25 });
  return { eyes, er };
}

// ---------------------------------------------------------------------------
// Hands, arms, legs, shoes
// ---------------------------------------------------------------------------
// o: s (scale, 1 = adult), skin, mat, fist, side (1 = palm faces +x, -1 mirrored), spread, curl (0..1 for open hands)
export function sHand(C, o = {}) {
  const s = o.s || 1;
  const X = x => x * (o.side || 1);
  const m = { color: o.skin || SKIN, mat: o.mat || 'skin', k: 0.005 * s, bump: o.bump };
  C.cone([0, 0.012 * s, 0], [0, -0.012 * s, 0], 0.016 * s, 0.019 * s, { ...m, k: 0.01 * s });
  C.box([X(0.001 * s), -0.03 * s, 0], [0.022 * s, 0.044 * s, 0.05 * s], 0.009 * s, { ...m, k: 0.009 * s });
  const lens = [0.9, 1, 0.94, 0.76];
  const curl = o.fist ? 1 : (o.curl ?? 0.25);
  for (let i = 0; i < 4; i++) {
    const z = (i - 1.5) * 0.0136 * s * (1 + (o.spread || 0));
    const L = lens[i] * s;
    const y0 = -0.05 * s;
    if (o.fist) {
      const fk = { ...m, k: 0.0012 * s };
      C.ball([X(0.002 * s), y0, z], 0.0066 * s, fk); // knuckle
      C.limb([[X(0.002 * s), y0, z], [X(0.014 * s), y0 - 0.006 * s, z], [X(0.019 * s), y0 + 0.006 * s, z]], [0.0062 * s, 0.006 * s, 0.0055 * s], fk);
    } else {
      const c = curl * 0.6;
      C.limb([[X(0), y0, z], [X(0.004 * s + c * 0.01 * s), y0 - 0.018 * L, z * 1.05], [X(0.008 * s + c * 0.022 * s), y0 - 0.032 * L, z * 1.09], [X(0.01 * s + c * 0.03 * s), y0 - 0.041 * L + c * 0.006 * s, z * 1.12]], [0.0058 * s, 0.0053 * s, 0.0048 * s, 0.0041 * s], { ...m, k: 0.0012 * s });
    }
  }
  if (o.fist) C.limb([[X(0.006 * s), -0.012 * s, 0.022 * s], [X(0.019 * s), -0.026 * s, 0.024 * s], [X(0.026 * s), -0.04 * s, 0.012 * s]], [0.008 * s, 0.007 * s, 0.006 * s], { ...m, k: 0.004 * s });
  else C.limb([[X(0.006 * s), -0.012 * s, 0.022 * s], [X(0.014 * s), -0.028 * s, 0.032 * s], [X(0.018 * s), -0.042 * s, 0.034 * s]], [0.0085 * s, 0.007 * s, 0.0055 * s], { ...m, k: 0.004 * s });
}

// An arm through shoulder, elbow and wrist. r: [shoulder, elbow, wrist]; muscle adds a bicep/forearm swell.
export function sArm(C, pts, r, o = {}) {
  const m = { color: o.color, mat: o.mat || 'cloth', k: o.k ?? 0.012, bump: o.bump, tint: o.tint, disp: o.disp };
  C.limb(pts, r, { ...m, seg: 8 });
  if (o.muscle) {
    const [a, b, c] = pts;
    const mid = (p, q, t) => p.map((v, i) => v + (q[i] - v) * t);
    C.ball(mid(a, b, 0.45), r[0] * 1.08 * o.muscle, { ...m, k: r[1] * 0.8 });
    C.ball(mid(b, c, 0.3), r[1] * 1.05 * o.muscle, { ...m, k: r[2] * 0.8 });
  }
}

// A leg from hip through knee to ankle, radii [hip, knee, ankle], with a knee bump
export function sLeg(C, pts, r, o = {}) {
  const m = { color: o.color, mat: o.mat || 'cloth', k: o.k ?? 0.012, bump: o.bump, tint: o.tint, disp: o.disp };
  C.limb(pts, r, { ...m, seg: 8 });
  if (o.knee !== false) C.ball([pts[1][0], pts[1][1], pts[1][2] + r[1] * 0.35], r[1] * 0.85, { ...m, k: r[1] * 0.6 });
}

// A shoe or boot standing at the origin, toe toward +z. o: color, sole, h (shaft height), w (width), toe, mat
export function sShoe(C, o = {}) {
  const w = o.w || 1;
  const m = { color: o.color || '#3a2a20', mat: o.mat || 'leather', k: 0.012 };
  C.ell([0, 0.032, 0.035 * (o.toe || 1)], [0.043 * w, 0.03, 0.068 * (o.toe || 1)], m);
  C.ell([0, 0.04, -0.03], [0.04 * w, 0.038, 0.04], m);
  if (o.h) C.cone([0, 0.04, -0.008], [0, o.h, -0.005], 0.042 * w, 0.046 * w, { ...m, k: 0.02 });
  C.box([0, 0.009, 0.02 * (o.toe || 1)], [0.092 * w, 0.018, 0.16 * (o.toe || 1)], 0.008, { color: o.sole || '#1e1a17', mat: 'dark', k: 0.002 });
}
