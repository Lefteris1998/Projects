// Puzzle sources. Every puzzle is a real Lichess puzzle:
//  - the live Racer/Storm set from https://lichess.org/api/storm
//  - the pack in data/, built from the official Lichess puzzle database (tools/build-pack.js)
// A puzzle here is { id, fen, moves: [uci...], rating, themes: [names] }.
// `fen` is the position before the opponent's first move; moves[0] is that move.

const Pool = (() => {
  let index = null;
  const bands = {};

  async function loadIndex() {
    if (!index) index = await (await fetch('data/index.json')).json();
    return index;
  }

  async function loadBand(b) {
    if (!bands[b]) bands[b] = fetch(`data/p-${b}.json`).then(r => r.json()).then(list => {
      const ix = index;
      return list.map(([id, fen, moves, rating, th, op]) => ({
        id, fen, moves: moves.split(' '), rating,
        themes: th.map(i => ix.themes[i]),
        opening: op >= 0 ? ix.openings[op] : '',
      }));
    });
    return bands[b];
  }

  // The colour the solver plays: the side NOT to move in the starting FEN
  const solverColor = p => (p.fen.split(' ')[1] === 'w' ? 'b' : 'w');

  async function filtered(cfg) {
    await loadIndex();
    const lists = await Promise.all(cfg.bands.map(loadBand));
    const themes = new Set(cfg.themes);
    return lists.flat().filter(p =>
      (!themes.size || p.themes.some(t => themes.has(t))) &&
      (!cfg.opening || p.opening === cfg.opening) &&
      (cfg.color === 'both' || solverColor(p) === cfg.color));
  }

  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // An endless picker over the filtered pack. Unseen puzzles come first.
  // Progressive: split the pool into rating steps and climb one step per puzzle, like Storm.
  async function packQueue(cfg, seen, opts = {}) {
    let list = await filtered(cfg);
    if (opts.minRating) list = list.filter(p => p.rating >= opts.minRating);
    if (!list.length) return null;
    const fresh = list.filter(p => !seen.has(p.id));
    const base = fresh.length >= 60 ? fresh : list;
    const used = new Set();
    let k = 0;
    if (!cfg.progressive) {
      let order = shuffle(base.slice()), i = 0;
      return { size: list.length, next() { if (i >= order.length) { order = shuffle(list.slice()); i = 0; } return order[i++]; } };
    }
    const sorted = base.slice().sort((a, b) => a.rating - b.rating);
    const STEPS = Math.min(45, sorted.length);
    const slices = Array.from({ length: STEPS }, (_, s) => sorted.slice(Math.floor(s * sorted.length / STEPS), Math.floor((s + 1) * sorted.length / STEPS)));
    return {
      size: list.length,
      next() {
        const s = Math.min(k++, STEPS - 1);
        // Pick an unused puzzle from this step, or the nearest step that still has one
        for (let d = 0; d < STEPS; d++) for (const t of [s + d, s - d]) {
          const slice = slices[t];
          if (!slice) continue;
          const left = slice.filter(p => !used.has(p.id));
          if (left.length) { const p = left[Math.floor(Math.random() * left.length)]; used.add(p.id); return p; }
        }
        used.clear();
        return sorted[Math.floor(Math.random() * sorted.length)];
      },
    };
  }

  // Live Lichess Storm set: ~140 puzzles ordered from ~1000 to ~2500, all the same colour.
  // Racer uses every second Storm puzzle, so difficulty climbs twice as fast.
  async function stormSet() {
    const res = await fetch('https://lichess.org/api/storm', { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status === 429 ? 'Lichess is rate-limiting, try again in a minute' : 'Lichess returned ' + res.status);
    const data = await res.json();
    return data.puzzles.map(p => ({ id: p.id, fen: p.fen, moves: p.line.split(' '), rating: p.rating, themes: [] }));
  }

  async function racerQueue(racerStyle) {
    const set = await stormSet();
    const order = racerStyle ? set.filter((_, i) => i % 2 === 0).concat(set.filter((_, i) => i % 2)) : set;
    let i = 0;
    return { size: order.length, color: solverColor(order[0]), last: () => order[order.length - 1], next: () => order[i++] || null };
  }

  return { loadIndex, filtered, packQueue, racerQueue, solverColor, get index() { return index; } };
})();
