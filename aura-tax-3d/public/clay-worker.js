// Meshes clay recipes off the main thread (see clay.js). Shapes already meshed in another colour are only recoloured.
import { mesh, recolor } from './clay-core.js';

const geo = new Map(); // shape key -> { channel: { pos, nor, idx } } (copies kept here)
const copy = res => Object.fromEntries(Object.entries(res).map(([m, b]) => [m, { pos: b.pos.slice(), nor: b.nor.slice(), idx: b.idx.slice() }]));

self.onmessage = e => {
  const { id, prims, voxel, geoKey } = e.data;
  try {
    let res;
    const known = geo.get(geoKey);
    if (known) {
      res = recolor(prims, copy(known));
    } else {
      res = mesh(prims, voxel);
      geo.set(geoKey, copy(res));
    }
    const transfer = [];
    for (const m of Object.values(res)) transfer.push(m.pos.buffer, m.nor.buffer, m.col.buffer, m.idx.buffer);
    self.postMessage({ id, res }, transfer);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.message) || err) });
  }
};
