// Depth maps: AI estimation (Depth Anything V2, runs locally in the browser via
// transformers.js), simple non-AI fallbacks, and the image-processing helpers
// used to turn a depth map into a clean mesh.
// All depth arrays are Float32Array(w*h), 0 = far, 1 = near.

const TF_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2';
const MODEL = 'onnx-community/depth-anything-v2-small';

let pipePromise = null;
let progressHandler = null;

async function getPipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const tf = await import(TF_URL);
      tf.env.allowLocalModels = false;
      const opts = device => ({ device, progress_callback: p => progressHandler && progressHandler(p) });
      let gpuOk = false;
      if (navigator.gpu) {
        try { gpuOk = !!(await navigator.gpu.requestAdapter()); } catch (e) { gpuOk = false; }
      }
      if (gpuOk) {
        try { return { pipe: await tf.pipeline('depth-estimation', MODEL, opts('webgpu')), device: 'webgpu' }; }
        catch (e) { console.warn('WebGPU depth failed, falling back to WASM', e); }
      }
      return { pipe: await tf.pipeline('depth-estimation', MODEL, opts('wasm')), device: 'wasm' };
    })().catch(e => { pipePromise = null; throw e; });
  }
  return pipePromise;
}

export async function runAIDepth(canvas, onProgress) {
  progressHandler = onProgress;
  const { pipe, device } = await getPipe();
  onProgress && onProgress({ status: 'infer', device });
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  try {
    const out = await pipe(url);
    const img = out.depth;
    const gray = resampleGray(img.data, img.width, img.height, img.channels || 1, canvas.width, canvas.height);
    return normalize(gray);
  } finally {
    URL.revokeObjectURL(url);
    progressHandler = null;
  }
}

function resampleGray(src, sw, sh, ch, tw, th) {
  const out = new Float32Array(tw * th);
  for (let y = 0; y < th; y++) {
    const fy = th > 1 ? y * (sh - 1) / (th - 1) : 0;
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = tw > 1 ? x * (sw - 1) / (tw - 1) : 0;
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      const a = src[(y0 * sw + x0) * ch], b = src[(y0 * sw + x1) * ch];
      const c = src[(y1 * sw + x0) * ch], d = src[(y1 * sw + x1) * ch];
      out[y * tw + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return out;
}

export function normalize(d) {
  let mn = Infinity, mx = -Infinity;
  for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const r = mx - mn || 1;
  for (let i = 0; i < d.length; i++) d[i] = (d[i] - mn) / r;
  return d;
}

// ---- fallbacks (no AI) ----

export function brightnessDepth(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = (0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2]) / 255;
  return normalize(blur(d, w, h, 3));
}

// "Pillow" inflate of a silhouette: thick in the middle, thin at the edges.
export function inflateDepth(mask, w, h) {
  const m = mask || new Float32Array(w * h).fill(1);
  const keep = new Uint8Array(w * h);
  for (let i = 0; i < keep.length; i++) keep[i] = m[i] > 0.5 ? 1 : 0;
  const dist = distanceTransform(keep, w, h);
  let mx = 0;
  for (const v of dist) if (v > mx) mx = v;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = mx ? Math.sqrt(dist[i] / mx) : 0;
  return d;
}

// ---- helpers ----

export function extractAlpha(canvas) {
  const { width: w, height: h } = canvas;
  const px = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const a = new Float32Array(w * h);
  let transparent = 0;
  for (let i = 0; i < a.length; i++) {
    a[i] = px[i * 4 + 3] / 255;
    if (a[i] < 0.5) transparent++;
  }
  return transparent > a.length * 0.01 ? a : null;
}

// Separable box blur, two passes ≈ gaussian.
export function blur(src, w, h, r) {
  r = Math.round(r);
  if (r <= 0) return src;
  let a = Float32Array.from(src), b = new Float32Array(src.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < h; y++) {
      let acc = 0;
      for (let x = -r; x <= r; x++) acc += a[y * w + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        b[y * w + x] = acc / (2 * r + 1);
        acc += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += b[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        a[y * w + x] = acc / (2 * r + 1);
        acc += b[Math.min(h - 1, y + r + 1) * w + x] - b[Math.max(0, y - r) * w + x];
      }
    }
  }
  return a;
}

// Chamfer distance (in pixels) from each kept pixel to the nearest removed pixel / border.
export function distanceTransform(keep, w, h) {
  const INF = 1e9, d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = keep[i] ? INF : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    }
  }
  return d;
}

// Otsu threshold: best split between "background" and "subject" depths.
export function otsu(d, mask) {
  const hist = new Float64Array(256);
  let n = 0;
  for (let i = 0; i < d.length; i++) {
    if (mask && mask[i] < 0.5) continue;
    hist[Math.min(255, Math.max(0, Math.floor(d[i] * 255)))]++;
    n++;
  }
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, bestT = 0;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; bestT = t; }
  }
  return bestT / 255;
}

export async function depthFromImage(url, w, h) {
  const img = await loadImage(url);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = px[i * 4] / 255;
  return d;
}

export function depthToCanvas(d, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const id = ctx.createImageData(w, h);
  for (let i = 0; i < d.length; i++) {
    const v = Math.round(Math.min(1, Math.max(0, d[i])) * 255);
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v;
    id.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(id, 0, 0);
  return c;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}
