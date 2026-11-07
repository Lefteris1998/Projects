// Builds puzzle-rush/data/*.json from the official Lichess puzzle database (CC0).
// Download https://database.lichess.org/lichess_db_puzzle.csv.zst, then:
//   node tools/build-pack.js path/to/lichess_db_puzzle.csv.zst
// Keeps well-tested, popular puzzles rated 600-2000, sampled so every rating step
// and every theme is covered, and writes one file per 200-point band.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const readline = require('readline');

const src = process.argv[2];
if (!src) { console.error('usage: node tools/build-pack.js lichess_db_puzzle.csv.zst'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'data');

const MIN = 600, MAX = 2000;
const PER_STEP = 1400;       // puzzles kept per 50-point rating step
const PER_THEME_BAND = 120;  // extra puzzles kept per theme in each 200-point band, so rare themes still have enough

// Tags that describe the puzzle source rather than its content
const SKIP = new Set(['master', 'masterVsMaster', 'superGM', 'short', 'long', 'veryLong', 'oneMove', 'mix']);

const steps = new Map();   // step -> reservoir
const themed = new Map();  // theme|band -> reservoir
let seen = 0, kept = 0;
let rng = 12345;
const rand = () => ((rng = (rng * 1103515245 + 12345) >>> 0) / 4294967296);

function add(map, key, cap, row, count) {
  let r = map.get(key);
  if (!r) map.set(key, r = { n: 0, items: [] });
  r.n++;
  if (r.items.length < cap) r.items.push(row);
  else { const j = Math.floor(rand() * r.n); if (j < cap) r.items[j] = row; }
}

// The Lichess file opens with a zstd "skippable frame" (magic 0x184D2A5?), which Node's decoder rejects; start after it
// The file is written by pzstd: many zstd frames, each preceded by a skippable frame
// holding the next frame's compressed size. Node's stream decoder stops at the first
// skippable frame after data, so decode the frames one by one.
async function* zstdFrames(file) {
  const fd = fs.openSync(file, 'r'), head = Buffer.alloc(12), size = fs.fstatSync(fd).size;
  let pos = 0;
  while (pos < size) {
    fs.readSync(fd, head, 0, 12, pos);
    if (head.readUInt32LE(0) !== 0x184D2A50 || head.readUInt32LE(4) !== 4) throw new Error('unexpected frame at ' + pos);
    const len = head.readUInt32LE(8);
    const frame = Buffer.alloc(len);
    fs.readSync(fd, frame, 0, len, pos + 12);
    pos += 12 + len;
    yield zlib.zstdDecompressSync(frame, { params: { [zlib.constants.ZSTD_d_windowLogMax]: 31 } });
  }
  fs.closeSync(fd);
}
const input = src.endsWith('.zst') ? require('stream').Readable.from(zstdFrames(src)) : fs.createReadStream(src);
const rl = readline.createInterface({ input, crlfDelay: Infinity });
let header = true;
rl.on('line', line => {
  if (header) { header = false; return; }
  seen++;
  // PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
  const c = line.split(',');
  if (c.length < 10) return;
  const rating = +c[3], dev = +c[4], pop = +c[5], plays = +c[6];
  if (rating < MIN || rating >= MAX || dev > 90 || pop < 85 || plays < 300) return;
  kept++;
  const themes = c[7].split(' ').filter(t => t && !SKIP.has(t));
  const opening = (c[9] || '').split(' ')[0] || '';
  const row = [c[0], c[1], c[2], rating, themes, opening];
  add(steps, Math.floor(rating / 50), PER_STEP, row);
  const band = Math.floor(rating / 200) * 200;
  for (const t of themes) add(themed, t + '|' + band, PER_THEME_BAND, row);
  if (seen % 500000 === 0) console.log(`${(seen / 1e6).toFixed(1)}M rows read`);
});

rl.on('close', () => {
  const all = new Map();
  for (const r of steps.values()) for (const p of r.items) all.set(p[0], p);
  for (const r of themed.values()) for (const p of r.items) all.set(p[0], p);

  const themeList = [...new Set([...all.values()].flatMap(p => p[4]))].sort();
  const themeIdx = new Map(themeList.map((t, i) => [t, i]));
  const openList = [...new Set([...all.values()].map(p => p[5]).filter(Boolean))].sort();
  const openIdx = new Map(openList.map((t, i) => [t, i]));

  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (/^p-\d+\.json$/.test(f)) fs.unlinkSync(path.join(OUT, f));
  const bands = new Map();
  for (const p of all.values()) {
    const b = Math.floor(p[3] / 200) * 200;
    if (!bands.has(b)) bands.set(b, []);
    // [id, fen, moves, rating, theme indexes, opening index or -1]
    bands.get(b).push([p[0], p[1], p[2], p[3], p[4].map(t => themeIdx.get(t)), p[5] ? openIdx.get(p[5]) : -1]);
  }
  const index = { source: 'https://database.lichess.org/#puzzles (CC0)', built: new Date().toISOString().slice(0, 10), themes: themeList, openings: openList, bands: {} };
  for (const [b, list] of [...bands].sort((a, z) => a[0] - z[0])) {
    list.sort((a, z) => a[3] - z[3]);
    fs.writeFileSync(path.join(OUT, `p-${b}.json`), JSON.stringify(list));
    index.bands[b] = list.length;
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index));
  console.log(`read ${seen} rows, ${kept} passed filters, packed ${all.size} puzzles`, index.bands);
});
