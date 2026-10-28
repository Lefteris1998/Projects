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
      if (t[0] === '{') { if (g && !g.ended) g.toks.push(t); continue; }
      if (';$'.includes(t[0]) || /^\d+\.+$/.test(t)) continue;
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
      const start = ch.fen(), edges = [], notes = [], shapes = [], stack = [];
      // cur.edge: index of the move that led here, so a comment can flag it as a wrong answer
      let cur = { fen: start, prev: null, edge: -1 };
      for (const t of g.toks) {
        if (t[0] === '{') {
          const c = parseComment(t.slice(1, -1));
          if (!cur.fen) continue;
          if (c.wrong) { if (cur.edge >= 0) edges[cur.edge][2] = c.text || ' '; continue; }
          if (c.text) notes.push([key(cur.fen), c.text]);
          if (c.shapes.length) shapes.push([key(cur.fen), c.shapes]);
          continue;
        }
        if (t === '(') { stack.push(cur); cur = { fen: cur.prev, prev: null, edge: -1 }; continue; }
        if (t === ')') { if (stack.length) cur = stack.pop(); continue; }
        if (!cur.fen) continue;
        ch.load(cur.fen);
        const san = (/^0-0/.test(t) ? t.replace(/0/g, 'O') : t).replace(/[!?]+$/, '');
        const mv = ch.move(san, { sloppy: true });
        if (!mv) { errors.push(`${name}: ${t}`); cur = { fen: null, prev: null, edge: -1 }; continue; }
        edges.push([key(cur.fen), mv.san]);
        cur = { fen: ch.fen(), prev: cur.fen, edge: edges.length - 1 };
      }
      if (edges.length) chapters.push({ name, side, start, edges, notes, shapes });
    }
    const first = games[0] ? games[0].h : {};
    const study = first.StudyName || (first.Event || '').split(': ')[0] || '';
    return { chapters, errors, study };
  }

  // Lichess comment: text plus [%cal Ge2e4,...] arrows, [%csl Gd4,...] circles, and our [%wrong] flag
  const BRUSH = { G: 'g', R: 'r', B: 'b', Y: 'y' };
  function parseComment(raw) {
    const shapes = [];
    for (const [, kind, list] of raw.matchAll(/\[%(cal|csl)\s+([^\]]*)\]/g)) {
      for (const s of list.split(',').map(x => x.trim()).filter(Boolean)) {
        const from = s.slice(1, 3), to = kind === 'cal' ? s.slice(3, 5) : from;
        if (/^[a-h][1-8]$/.test(from) && /^[a-h][1-8]$/.test(to)) shapes.push({ from, to, brush: BRUSH[s[0]] || 'g' });
      }
    }
    const wrong = raw.includes('[%wrong]');
    const text = raw.replace(/\[%[^\]]*\]/g, '').replace(/[ \t]+\n/g, '\n').trim();
    return { text, shapes, wrong };
  }

  // Per side: moves[pos] = book moves, notes[pos] = comments, shapes[pos] = study arrows,
  // wrong['pos san'] = explanation for a gamebook wrong answer (those moves aren't accepted)
  function buildBook(chapters) {
    const empty = () => ({ moves: {}, starts: new Set(), notes: {}, shapes: {}, wrong: {} });
    const book = { w: empty(), b: empty() };
    for (const c of chapters) {
      for (const s of c.side === 'both' ? ['w', 'b'] : [c.side]) {
        const b = book[s];
        b.starts.add(c.start);
        for (const [k, san, wrong] of c.edges) {
          if (wrong) b.wrong[k + ' ' + san] = wrong.trim();
          else (b.moves[k] ||= new Set()).add(san);
        }
        for (const [k, text] of c.notes || []) (b.notes[k] ||= new Set()).add(text);
        for (const [k, list] of c.shapes || []) {
          const have = (b.shapes[k] ||= []);
          for (const sh of list) if (!have.some(h => h.from === sh.from && h.to === sh.to)) have.push(sh);
        }
      }
    }
    return book;
  }

  const api = { parsePGN, buildBook, key };
  if (typeof module !== 'undefined') module.exports = api;
  else root.Book = api;
})(typeof window !== 'undefined' ? window : globalThis);
