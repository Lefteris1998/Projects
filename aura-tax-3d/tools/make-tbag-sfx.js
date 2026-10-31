'use strict';
// Synthesizes the starter T-bag sounds into public/sounds/tbag/<champion>/.
// Run: node tools/make-tbag-sfx.js   (only writes files that don't exist yet, so your own sounds are safe)

const fs = require('fs');
const path = require('path');

const RATE = 22050;
const OUT = path.join(__dirname, '..', 'public', 'sounds', 'tbag');
const TAU = Math.PI * 2;

let seed = 1234;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const noise = () => rnd() * 2 - 1;

// ---------------------------------------------------------------------------
// Tiny synth kit: everything works on Float32Arrays of samples
// ---------------------------------------------------------------------------
const buf = sec => new Float32Array(Math.ceil(sec * RATE));
const env = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));

// Oscillator with a time-varying frequency: f(t) in Hz, wave 'sine' | 'saw' | 'square' | 'tri'
function osc(sec, f, wave = 'sine', amp = t => 1) {
  const out = buf(sec);
  let ph = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / RATE;
    ph += f(t) / RATE;
    const p = ph % 1;
    const v = wave === 'saw' ? 2 * p - 1 : wave === 'square' ? (p < 0.5 ? 1 : -1) : wave === 'tri' ? 4 * Math.abs(p - 0.5) - 1 : Math.sin(TAU * p);
    out[i] = v * amp(t);
  }
  return out;
}

function noiseBuf(sec, amp = t => 1) {
  const out = buf(sec);
  for (let i = 0; i < out.length; i++) out[i] = noise() * amp(i / RATE);
  return out;
}

// RBJ biquad; freq can be a number or f(t) for sweeps.
function biquad(x, type, freq, q = 0.707) {
  const out = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  const fAt = typeof freq === 'function' ? freq : () => freq;
  for (let i = 0; i < x.length; i++) {
    const w = (TAU * Math.min(fAt(i / RATE), RATE * 0.45)) / RATE;
    const cs = Math.cos(w);
    const al = Math.sin(w) / (2 * q);
    let b0, b1, b2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // band-pass
    const a0 = 1 + al;
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 + 2 * cs * y1 - (1 - al) * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

// Mix several buffers, each optionally offset in seconds: mix(sec, [buf, at, gain], ...)
function mix(sec, ...parts) {
  const out = buf(sec);
  for (const [b, at = 0, g = 1] of parts) {
    const o = Math.floor(at * RATE);
    for (let i = 0; i < b.length && i + o < out.length; i++) out[i + o] += b[i] * g;
  }
  return out;
}

const shape = (x, drive = 2) => x.map(v => Math.tanh(v * drive));

// A small Schroeder reverb so dry synth blips sound like they're in a room.
function verb(x, wet = 0.3, size = 1) {
  const tail = Math.floor(RATE * 0.8 * size);
  const out = new Float32Array(x.length + tail);
  out.set(x);
  const combs = [1557, 1617, 1491, 1422].map(n => ({ d: new Float32Array(Math.floor(n * size)), i: 0 }));
  const wetBuf = new Float32Array(out.length);
  for (let i = 0; i < out.length; i++) {
    const inp = i < x.length ? x[i] : 0;
    let s = 0;
    for (const c of combs) {
      const y = c.d[c.i];
      c.d[c.i] = inp + y * 0.78;
      c.i = (c.i + 1) % c.d.length;
      s += y;
    }
    wetBuf[i] = s / combs.length;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i] * (1 - wet) + wetBuf[i] * wet * 1.6;
  return out;
}

function writeWav(file, x) {
  let peak = 1e-6;
  for (const v of x) peak = Math.max(peak, Math.abs(v));
  const fadeN = Math.floor(RATE * 0.01);
  const data = Buffer.alloc(x.length * 2);
  for (let i = 0; i < x.length; i++) {
    const fade = Math.min(1, (x.length - i) / fadeN);
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (x[i] / peak) * 0.89 * fade)) * 32767), i * 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.writeFileSync(file, Buffer.concat([h, data]));
}

// ---------------------------------------------------------------------------
// The sounds
// ---------------------------------------------------------------------------
function bark(pitch = 1) {
  const one = len => {
    const tone = osc(len, t => (620 - t * 1800) * pitch, 'saw', t => env(t, 0.008, 0.06));
    const n = noiseBuf(len, t => env(t, 0.004, 0.04) * 0.6);
    return shape(biquad(mix(len, [tone], [n]), 'bp', 1100 * pitch, 1.4), 3);
  };
  return verb(mix(0.5, [one(0.16)], [one(0.18), 0.22, 0.9]), 0.15);
}

const SOUNDS = {
  dog: { 'bark.wav': () => bark(1), 'yap.wav': () => bark(1.5) },
  camel: {
    'grunt.wav': () => {
      const len = 0.8;
      const v = osc(len, t => 105 - t * 30 + Math.sin(TAU * 7 * t) * 6, 'saw', t => env(t, 0.06, 0.3));
      const n = noiseBuf(len, t => env(t, 0.05, 0.2) * 0.4);
      return verb(shape(biquad(mix(len, [v], [n]), 'bp', 520, 1.2), 2.5), 0.2);
    },
  },
  cactus: {
    'boing.wav': () => osc(0.9, t => 260 * (1 + 0.45 * Math.sin(TAU * 14 * t) * Math.exp(-3 * t)) + t * 120, 'sine', t => env(t, 0.005, 0.3)),
  },
  mrx: {
    'snap.wav': () => {
      const click = biquad(noiseBuf(0.03, t => env(t, 0.0005, 0.006)), 'hp', 2200);
      const body = osc(0.05, t => 1800, 'sine', t => env(t, 0.0005, 0.008));
      return verb(mix(0.05, [click], [body, 0, 0.4]), 0.35, 0.9);
    },
  },
  viking: {
    'war-horn.wav': () => {
      const len = 1.5;
      const amp = t => Math.min(1, t / 0.18) * (t > 1.2 ? Math.max(0, (len - t) / 0.3) : 1);
      const f = t => 146 * (0.94 + 0.06 * Math.min(1, t / 0.2)) + Math.sin(TAU * 5 * t) * 1.2;
      const v = mix(len, [osc(len, f, 'saw', amp)], [osc(len, t => f(t) * 1.502, 'saw', amp), 0, 0.5]);
      return verb(biquad(v, 'lp', 900), 0.35, 1.3);
    },
  },
  dragon: {
    'roar.wav': () => {
      const len = 1.4;
      const amp = t => Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - 0.6) * 3);
      const growl = osc(len, t => 70 + rnd() * 25 - t * 15, 'saw', amp);
      const breath = biquad(noiseBuf(len, amp), 'lp', t => 300 + 900 * Math.exp(-t * 2));
      return verb(shape(mix(len, [growl, 0, 0.8], [breath, 0, 1.2]), 3), 0.3, 1.2);
    },
  },
  penguin: {
    'squeak.wav': () => {
      const sq = () => osc(0.22, t => 1300 + Math.sin(Math.min(1, t / 0.22) * Math.PI) * 700, 'tri', t => env(t, 0.01, 0.08));
      return mix(0.55, [sq()], [sq(), 0.27, 0.8]);
    },
  },
  frostking: {
    'ice-shatter.wav': () => {
      const len = 1.4;
      const parts = [[biquad(noiseBuf(0.5, t => env(t, 0.001, 0.08)), 'hp', 3000), 0, 1]];
      for (let i = 0; i < 9; i++) {
        const f = 2200 + rnd() * 3500;
        parts.push([osc(0.9, () => f, 'sine', t => env(t, 0.001, 0.15 + rnd() * 0.0)), 0.02 + rnd() * 0.3, 0.25]);
        parts.push([biquad(noiseBuf(0.08, t => env(t, 0.001, 0.02)), 'hp', 4000), 0.05 + rnd() * 0.5, 0.5]);
      }
      return verb(mix(len, ...parts), 0.3);
    },
  },
  crone: {
    'cackle.wav': () => {
      const parts = [];
      for (let i = 0; i < 7; i++) {
        const base = 380 + i * 18 + (i % 2) * 30;
        const ha = osc(0.1, t => base + Math.sin(TAU * 30 * t) * 25, 'saw', t => env(t, 0.008, 0.035));
        parts.push([biquad(ha, 'bp', 1000, 1.5), i * 0.12]);
      }
      return verb(mix(0.95, ...parts), 0.35, 1.2);
    },
  },
  captain: {
    'ship-horn.wav': () => {
      const len = 1.7;
      const amp = t => Math.min(1, t / 0.12) * (t > 1.3 ? Math.max(0, (len - t) / 0.4) : 1);
      const v = mix(len, [osc(len, () => 92, 'saw', amp)], [osc(len, () => 138.5, 'saw', amp), 0, 0.7]);
      return verb(shape(biquad(v, 'lp', 500), 1.5), 0.45, 1.5);
    },
  },
  pistol: {
    'gunshot.wav': () => {
      const blast = biquad(noiseBuf(0.3, t => env(t, 0.0005, 0.05)), 'lp', 3500);
      const thump = osc(0.2, t => 90 - t * 200, 'sine', t => env(t, 0.001, 0.05));
      const ric = osc(0.45, t => 3200 - t * 3800, 'sine', t => env(t, 0.01, 0.2) * 0.35);
      return verb(mix(0.9, [blast], [thump, 0, 0.8], [ric, 0.25]), 0.3, 1.3);
    },
  },
  buzzsaw: {
    'whirr.wav': () => {
      const len = 1.1;
      const amp = t => Math.min(1, t / 0.15) * (t > 0.85 ? (len - t) / 0.25 : 1) * (0.7 + 0.3 * Math.sin(TAU * 32 * t));
      const saw = osc(len, t => 160 + t * 120, 'saw', amp);
      const grind = biquad(noiseBuf(len, amp), 'hp', 2500);
      return shape(mix(len, [saw], [grind, 0, 0.4]), 2);
    },
  },
  jetpack: {
    'thrust.wav': () => {
      const len = 1.3;
      const amp = t => Math.min(1, t / 0.1) * (t > 0.9 ? Math.max(0, (len - t) / 0.4) : 1) * (0.8 + 0.2 * Math.sin(TAU * 18 * t));
      return shape(biquad(noiseBuf(len, amp), 'lp', t => 400 + t * 1400, 0.9), 1.5);
    },
  },
  hotdog: {
    'sizzle.wav': () => {
      const len = 1.2;
      let crackle = 0;
      const amp = t => {
        if (rnd() < 0.004) crackle = 1;
        crackle *= 0.995;
        return Math.min(1, t / 0.05) * (t > 0.9 ? (len - t) / 0.3 : 1) * (0.35 + crackle);
      };
      return biquad(noiseBuf(len, amp), 'hp', 3800);
    },
  },
  sensei: {
    'infinity.wav': () => {
      const len = 1.8;
      const swell = biquad(noiseBuf(len, t => Math.min(1, t / 0.5) * Math.exp(-Math.max(0, t - 0.5) * 4) * 0.4), 'bp', t => 300 + t * 2600, 2);
      const parts = [[swell]];
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
        parts.push([osc(1.4, t => f * (1 + Math.sin(TAU * 0.7 * t + i) * 0.003), 'sine', t => env(t, 0.02, 0.5) * 0.35), 0.35 + i * 0.04]);
      });
      return verb(mix(len, ...parts), 0.5, 1.5);
    },
  },
  leech: {
    'slurp.wav': () => {
      const len = 0.7;
      const amp = t => Math.sin(Math.PI * t / len) * (0.6 + 0.4 * Math.sin(TAU * 24 * t));
      return shape(biquad(noiseBuf(len, amp), 'bp', t => 300 + (t / len) * 1400, 6), 2);
    },
  },
  ronin: {
    'shing.wav': () => {
      const len = 1.2;
      const swish = biquad(noiseBuf(0.18, t => Math.sin(Math.PI * t / 0.18)), 'bp', t => 2000 + t * 15000, 1.5);
      const ring = [2093, 3170, 4430, 5250, 6720].map((f, i) => [osc(1.0, () => f, 'sine', t => env(t, 0.002, 0.35 - i * 0.04)), 0.13, 0.25]);
      return verb(mix(len, [swish, 0, 0.8], ...ring), 0.25);
    },
  },
  poop: {
    'fart.wav': () => {
      const len = 0.9;
      let f = 85;
      const amp = t => Math.min(1, t / 0.03) * (t > 0.6 ? Math.max(0, (len - t) / 0.3) : 1) * (0.6 + 0.4 * Math.sin(TAU * 11 * t));
      const v = osc(len, t => (f += (rnd() - 0.5) * 6, f = Math.max(60, Math.min(130, f)), f + Math.sin(TAU * 3 * t) * 10), 'saw', amp);
      return shape(biquad(v, 'lp', 450, 1.2), 2.5);
    },
  },
  default: {
    'air-horn.wav': () => {
      const blast = sec => {
        const amp = t => Math.min(1, t / 0.01) * (t > sec - 0.03 ? Math.max(0, (sec - t) / 0.03) : 1);
        return mix(sec, [osc(sec, () => 415, 'square', amp)], [osc(sec, () => 523, 'square', amp)], [osc(sec, () => 622, 'square', amp), 0, 0.7]);
      };
      return verb(shape(biquad(mix(1.3, [blast(0.18)], [blast(0.18), 0.24], [blast(0.6), 0.48]), 'lp', 2600), 1.5), 0.2);
    },
    'boom.wav': () => {
      const len = 1.8;
      const sub = osc(len, t => 45 + 70 * Math.exp(-t * 8), 'sine', t => env(t, 0.003, 0.6));
      const hit = biquad(noiseBuf(0.15, t => env(t, 0.001, 0.03)), 'lp', 1200);
      return verb(shape(mix(len, [sub], [hit, 0, 0.6]), 2), 0.3, 1.4);
    },
  },
};

let made = 0;
for (const [champ, files] of Object.entries(SOUNDS)) {
  const dir = path.join(OUT, champ);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, make] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) continue;
    writeWav(file, make());
    made++;
  }
}
console.log(`Wrote ${made} sound(s) to ${OUT}`);
