// Turns PGN (lichess study exports included, variations and all) into an opening book:
// for each position, the set of moves the study has from there.
(function (root) {
  const Chess = root.Chess || require('./chess.js').Chess;

  // headers | comments | NAGs | brackets | results | move numbers | SAN
  const TOKEN = /\[\s*(\w+)\s+"((?:[^"\\]|\\.)*)"\s*\]|\{[^}]*\}|;[^\n]*|\$\d+|\(|\)|1-0|0-1|1\/2-1\/2|\*|\d+\.+|[KQRBNPa-hO0][A-Za-z0-9+#=\-]*[!?]*/g;

  // Position identity without the move counters, so transpositions merge
  const key = fen => fen.split(' ').slice(0, 4).join(' ');

  // color: 'white' | 'black' forces the side; otherwise each chapter's [Orientation] decides,
  // and a chapter with neither can be drilled from both sides
  function parsePGN(text, color) {
    const games = [];
    let g = null, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      const t = m[0];
      if (m[1]) {
        if (!g || g.toks.length || g.ended) games.push(g = { h: {}, toks: [] });
        g.h[m[1]] = m[2];
        continue;
      }
      if ('{;$'.includes(t[0]) || /^\d+\.+$/.test(t)) continue;
      if (t === '1-0' || t === '0-1' || t === '1/2-1/2' || t === '*') { if (g) g.ended = true; continue; }
      if (!g || g.ended) games.push(g = { h: {}, toks: [] });
      g.toks.push(t);
    }

    const chapters = [], errors = [];
    for (const g of games) {
      const event = g.h.Event || '';
      const name = g.h.ChapterName || event.split(': ').slice(1).join(': ') || event || 'Line';
      const o = color || g.h.Orientation;
      const side = !o ? 'both' : /^b/i.test(o) ? 'b' : 'w';
      const ch = new Chess();
      if (g.h.FEN && !ch.load(g.h.FEN)) { errors.push(`${name}: bad FEN`); continue; }
      const start = ch.fen(), edges = [], stack = [];
      let cur = { fen: start, prev: null };
      for (const t of g.toks) {
        if (t === '(') { stack.push(cur); cur = { fen: cur.prev, prev: null }; continue; }
        if (t === ')') { if (stack.length) cur = stack.pop(); continue; }
        if (!cur.fen) continue;
        ch.load(cur.fen);
        const san = (/^0-0/.test(t) ? t.replace(/0/g, 'O') : t).replace(/[!?]+$/, '');
        const mv = ch.move(san, { sloppy: true });
        if (!mv) { errors.push(`${name}: ${t}`); cur = { fen: null, prev: null }; continue; }
        edges.push([key(cur.fen), mv.san]);
        cur = { fen: ch.fen(), prev: cur.fen };
      }
      if (edges.length) chapters.push({ name, side, start, edges });
    }
    const first = games[0] ? games[0].h : {};
    const study = first.StudyName || (first.Event || '').split(': ')[0] || '';
    return { chapters, errors, study };
  }

  function buildBook(chapters) {
    const book = { w: { moves: {}, starts: new Set() }, b: { moves: {}, starts: new Set() } };
    for (const c of chapters) {
      for (const s of c.side === 'both' ? ['w', 'b'] : [c.side]) {
        const b = book[s];
        b.starts.add(c.start);
        for (const [k, san] of c.edges) (b.moves[k] ||= new Set()).add(san);
      }
    }
    return book;
  }

  const api = { parsePGN, buildBook, key };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Book = api;
})(typeof window !== 'undefined' ? window : globalThis);
