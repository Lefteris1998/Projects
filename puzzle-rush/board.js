// Lichess-style board: tap/click or drag to move, premoves, sliding pieces.
// The app owns the chess.js game; the board only draws it and reports moves.
const PIECES = 'pieces/cburnett/';
const FILES = 'abcdefgh';

function createBoard(root, { onMove }) {
  const ghost = document.createElement('img');
  ghost.className = 'ghost';
  ghost.alt = '';
  document.body.appendChild(ghost);

  const st = {
    game: null,         // chess.js instance being shown
    orient: 'w',
    last: null,         // { from, to }
    mover: null,        // colour that may move now, or null
    premoveFor: null,   // colour that may queue a premove while waiting
    marks: {},          // square -> css class (e.g. 'miss', 'good')
  };
  let selected = null, drag = null, premove = null, builtFor = null;
  const cells = {};

  function build() {
    root.innerHTML = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const flip = st.orient === 'b';
      const f = flip ? 7 - c : c, rank = flip ? r + 1 : 8 - r;
      const sq = FILES[f] + rank;
      const el = document.createElement('div');
      el.dataset.sq = sq;
      el.dataset.base = 'sq ' + ((f + rank) % 2 ? 'dark' : 'light'); // a1 is dark
      el.className = el.dataset.base;
      const img = document.createElement('img');
      img.className = 'pc';
      img.alt = '';
      img.draggable = false;
      el.appendChild(img);
      if (c === 0) el.insertAdjacentHTML('beforeend', `<span class="coord r">${rank}</span>`);
      if (r === 7) el.insertAdjacentHTML('beforeend', `<span class="coord f">${FILES[f]}</span>`);
      root.appendChild(el);
      cells[sq] = { el, img, src: '' };
    }
    builtFor = st.orient;
  }

  // Squares a piece could reach on an empty board, like lichess premove targets
  function premoveDests(sq) {
    const p = st.game.get(sq);
    if (!p) return [];
    const f = sq.charCodeAt(0) - 97, r = +sq[1] - 1, out = [];
    const add = (df, dr) => { const x = f + df, y = r + dr; if (x >= 0 && x < 8 && y >= 0 && y < 8) out.push(FILES[x] + (y + 1)); };
    const ray = dirs => { for (const [a, b] of dirs) for (let i = 1; i < 8; i++) add(a * i, b * i); };
    const fwd = p.color === 'w' ? 1 : -1, home = p.color === 'w' ? 0 : 7;
    if (p.type === 'p') { add(0, fwd); if (r === home + fwd) add(0, 2 * fwd); add(-1, fwd); add(1, fwd); }
    if (p.type === 'n') for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(a, b);
    if (p.type === 'k') {
      for (const a of [-1, 0, 1]) for (const b of [-1, 0, 1]) if (a || b) add(a, b);
      if (f === 4 && r === home) { add(2, 0); add(-2, 0); }
    }
    if ('rq'.includes(p.type)) ray([[1, 0], [-1, 0], [0, 1], [0, -1]]);
    if ('bq'.includes(p.type)) ray([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
    return out;
  }

  const liveTurn = () => st.mover && st.game && st.game.turn() === st.mover;
  const preTurn = () => !liveTurn() && st.premoveFor && st.game && st.game.turn() !== st.premoveFor;
  const myColor = () => liveTurn() ? st.mover : preTurn() ? st.premoveFor : null;

  function dests(sq) {
    if (liveTurn()) return st.game.moves({ square: sq, verbose: true }).map(m => m.to);
    if (preTurn()) return premoveDests(sq);
    return [];
  }

  function render() {
    if (!st.game) return;
    if (builtFor !== st.orient) build();
    const targets = selected ? dests(selected) : [];
    const pre = preTurn();
    const inCheck = st.game.in_check(), turn = st.game.turn();
    root.classList.toggle('mine', !!myColor());
    for (const sq in cells) {
      const cell = cells[sq], p = st.game.get(sq);
      const cls = [cell.el.dataset.base];
      if (st.last && (sq === st.last.from || sq === st.last.to)) cls.push('last');
      if (sq === selected) cls.push(pre ? 'pre' : 'sel');
      if (premove && (sq === premove.from || sq === premove.to)) cls.push('pre');
      if (st.marks[sq]) cls.push(st.marks[sq]);
      if (p && p.type === 'k' && p.color === turn && inCheck) cls.push('check');
      if (targets.includes(sq)) cls.push(pre ? 'pdot' : p ? 'cap' : 'dot');
      const name = cls.join(' ');
      if (cell.el.className !== name) cell.el.className = name;
      const src = p ? PIECES + p.color + p.type.toUpperCase() + '.svg' : '';
      if (cell.src !== src) { cell.src = src; if (src) cell.img.src = src; else cell.img.removeAttribute('src'); }
      cell.img.style.visibility = src ? '' : 'hidden';
      cell.img.classList.toggle('lifted', !!(drag && drag.moved && drag.from === sq));
    }
  }

  // Slide the piece now standing on `to` in from `from` (plus the rook when castling)
  function animate(move, ms = 140) {
    const slide = (from, to) => {
      const c = cells[to];
      if (!c) return;
      const flip = st.orient === 'b' ? -1 : 1;
      const dx = (from.charCodeAt(0) - to.charCodeAt(0)) * 100 * flip;
      const dy = (to[1] - from[1]) * 100 * flip;
      c.img.animate([{ transform: `translate(${dx}%, ${dy}%)` }, { transform: 'none' }], { duration: ms, easing: 'cubic-bezier(.25,.6,.3,1)' });
    };
    slide(move.from, move.to);
    if (move.flags && /[kq]/.test(move.flags)) {
      const rank = move.to[1], k = move.flags.includes('k');
      slide((k ? 'h' : 'a') + rank, (k ? 'f' : 'd') + rank);
    }
  }

  function attempt(from, to, dragged) {
    selected = null;
    if (liveTurn()) {
      if (dests(from).includes(to)) onMove(from, to, dragged);
      else render();
    } else if (preTurn()) {
      if (premoveDests(from).includes(to)) premove = { from, to };
      render();
    } else render();
  }

  // ---- input ----
  const sqAt = (x, y) => { const el = document.elementFromPoint(x, y); const s = el && el.closest('.sq'); return s && root.contains(s) ? s.dataset.sq : null; };
  const placeGhost = e => { ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px'; };

  root.addEventListener('contextmenu', e => e.preventDefault());
  root.addEventListener('pointerdown', e => {
    const el = e.target.closest('.sq');
    if (!el || !st.game) return;
    if (e.button === 2) { premove = null; selected = null; render(); return; }
    if (e.button !== 0) return;
    const sq = el.dataset.sq, color = myColor();
    if (!color) return;
    const p = st.game.get(sq);
    if (p && p.color === color) {
      if (selected && selected !== sq && liveTurn() && dests(selected).includes(sq)) return attempt(selected, sq);
      drag = { from: sq, x: e.clientX, y: e.clientY, moved: false, was: selected === sq, size: el.offsetWidth };
      selected = sq;
      try { root.setPointerCapture(e.pointerId); } catch {}
      ghost.src = PIECES + p.color + p.type.toUpperCase() + '.svg';
      ghost.style.width = ghost.style.height = el.offsetWidth + 'px';
      placeGhost(e);
      render();
      e.preventDefault();
    } else if (selected) {
      attempt(selected, sq);
    } else if (premove) {
      premove = null; render();
    }
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < drag.size / 8) return;
    if (!drag.moved) { drag.moved = true; ghost.style.display = 'block'; render(); }
    placeGhost(e);
  });
  root.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null; ghost.style.display = 'none';
    const to = sqAt(e.clientX, e.clientY);
    if (d.moved && to && to !== d.from) return attempt(d.from, to, true);
    if (!d.moved && d.was && !preTurn()) selected = null;
    render();
  });
  root.addEventListener('pointercancel', () => { drag = null; ghost.style.display = 'none'; render(); });

  return {
    set(opts) {
      Object.assign(st, opts);
      if ('game' in opts || 'mover' in opts) { if (!myColor()) selected = null; }
      render();
    },
    animate,
    render,
    clearPremove() { premove = null; selected = null; render(); },
    // Called once the opponent has moved: play the queued premove if it's legal now
    playPremove() {
      const p = premove;
      premove = null;
      if (p && liveTurn() && dests(p.from).includes(p.to)) { selected = null; onMove(p.from, p.to, false); return true; }
      render();
      return false;
    },
    get orient() { return st.orient; },
  };
}
