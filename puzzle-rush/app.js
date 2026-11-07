// Puzzle Rush: timed practice on real Lichess puzzles (Racer, Storm, Rush and Survival rules).
const $ = s => document.querySelector(s);
const STORE = 'puzzle-rush';

// ---- Modes ----
// Racer and Storm copy the Lichess rules (lichess.org/page/racer, lichess.org/page/storm);
// Rush and Survival copy chess.com Puzzle Rush (3 strikes).
const MODES = {
  racer:    { label: 'Racer',    time: 90,  per: 'move',   bonus: 'points', skips: 1, desc: '90 s · a point per correct move · combos give bonus points · 1 skip' },
  storm:    { label: 'Storm',    time: 180, per: 'puzzle', bonus: 'time', penalty: 10, desc: '3 min · a point per puzzle · combos add time · a mistake costs 10 s' },
  rush3:    { label: 'Rush 3',   time: 180, per: 'puzzle', strikes: 3, desc: '3 min · a point per puzzle · 3 mistakes and you are out' },
  rush5:    { label: 'Rush 5',   time: 300, per: 'puzzle', strikes: 3, desc: '5 min · a point per puzzle · 3 mistakes and you are out' },
  survival: { label: 'Survival', time: 0,   per: 'puzzle', strikes: 3, desc: 'No clock · a point per puzzle · 3 mistakes and you are out' },
  custom:   { label: 'Custom',   per: 'puzzle', desc: 'Your own clock and mistake limit · a point per puzzle' },
};
// Combo bonuses: at 5, 12, 20, 30 correct moves in a row, then every 10 more
const COMBO_AT = [5, 12, 20, 30];
const BONUS = { points: [1, 2, 3, 4], time: [3, 5, 7, 10] };
const BANDS = [600, 800, 1000, 1200, 1400, 1600, 1800];

const DEFAULTS = {
  mode: 'racer', source: 'racer', bands: [1000, 1200], progressive: true, color: 'both', themes: [], opening: '',
  autoQueen: true, sound: true, minutes: 3, strikes: 0, goal: 90, sort: 'order',
};
const data = (() => {
  let d = {};
  try { d = JSON.parse(localStorage.getItem(STORE)) || {}; } catch {}
  return { settings: { ...DEFAULTS, ...(d.settings || {}) }, runs: d.runs || [], best: d.best || {}, seen: d.seen || [] };
})();
const S = data.settings;
const seen = new Set(data.seen);
function save() {
  data.seen = [...seen].slice(-30000);
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch {}
}

function modeCfg() {
  const m = { ...MODES[S.mode] };
  if (S.mode === 'custom') { m.time = S.minutes * 60; m.strikes = S.strikes; }
  return m;
}
function configKey() {
  const m = S.mode === 'custom' ? `custom${S.minutes}x${S.strikes}` : S.mode;
  if (S.source === 'racer') return m + '|racer';
  return [m, 'pack', S.bands.join('+'), S.progressive ? 'p' : 'r', S.color, [...S.themes].sort().join('+'), S.opening].join('|');
}

// ---- Sounds (Lichess standard set) ----
const SOUNDS = {};
for (const n of ['Move', 'Capture', 'Error', 'GenericNotify']) { const a = new Audio(`sounds/${n}.ogg`); a.preload = 'auto'; SOUNDS[n] = a; }
function sound(n) {
  if (!S.sound) return;
  const a = SOUNDS[n].cloneNode();
  a.volume = 0.7;
  a.play().catch(() => {});
}
const moveSound = m => sound(m.captured ? 'Capture' : 'Move');

// ---- Theme names ----
const THEME_NAMES = { attackingF2F7: 'Attacking f2/f7', xRayAttack: 'X-ray attack', enPassant: 'En passant', mateIn1: 'Mate in 1', mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5', queenRookEndgame: 'Queen and rook', underPromotion: 'Underpromotion',
  middlegame: 'Middlegame', mate: 'Checkmate', crushing: 'Crushing', advantage: 'Advantage', equality: 'Equality', backRankMate: 'Back rank mate',
  doubleBishopMate: 'Double bishop mate', killBoxMate: 'Kill box mate', quietMove: 'Quiet move', hangingPiece: 'Hanging piece' };
const themeName = t => THEME_NAMES[t] || (t.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, c => c.toUpperCase()));
const openingName = o => o.replace(/_/g, ' ');
function themeGroup(t) {
  if (['mate', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'mateIn5', 'advantage', 'crushing', 'equality'].includes(t)) return 'Goal';
  if (/Mate$/.test(t)) return 'Mating patterns';
  if (/Endgame$/.test(t) || ['opening', 'middlegame', 'endgame'].includes(t)) return 'Phase';
  return 'Motifs';
}

// ---- Board ----
const boardEl = $('#board');
const board = createBoard(boardEl, { onMove: (f, t, d) => state === 'review' ? reviewMove(f, t) : playerMove(f, t, d) });
board.set({ game: new Chess(), orient: 'w' });

let state = 'setup';
function setState(s) {
  state = s;
  document.body.className = 's-' + s;
}

// ---- Setup screen ----
function renderSetup() {
  const modes = $('#modes');
  modes.innerHTML = '';
  for (const [k, m] of Object.entries(MODES)) {
    const b = document.createElement('button');
    b.textContent = m.label;
    b.setAttribute('aria-pressed', k === S.mode);
    b.onclick = () => { S.mode = k; save(); renderSetup(); };
    modes.appendChild(b);
  }
  $('#modeDesc').textContent = MODES[S.mode].desc;
  $('#customRow').style.display = S.mode === 'custom' ? '' : 'none';
  $('#minutes').textContent = S.minutes;
  const ss = $('#strikeSeg');
  ss.innerHTML = '';
  for (const n of [0, 1, 3, 5]) {
    const b = document.createElement('button');
    b.textContent = n ? n : 'Off';
    b.setAttribute('aria-pressed', S.strikes === n);
    b.onclick = () => { S.strikes = n; save(); renderSetup(); };
    ss.appendChild(b);
  }
  for (const b of $('#sourceSeg').children) b.setAttribute('aria-pressed', b.dataset.v === S.source);
  $('#pack').style.display = S.source === 'pack' ? '' : 'none';

  const bands = $('#bands');
  bands.innerHTML = '';
  for (const v of BANDS) {
    const b = document.createElement('button');
    b.textContent = `${v}–${v + 200}`;
    b.setAttribute('aria-pressed', S.bands.includes(v));
    b.onclick = () => {
      const on = S.bands.includes(v);
      if (on && S.bands.length === 1) return;
      S.bands = on ? S.bands.filter(x => x !== v) : [...S.bands, v].sort((a, z) => a - z);
      save(); renderSetup();
    };
    bands.appendChild(b);
  }
  $('#progressive').checked = S.progressive;
  for (const b of $('#colorSeg').children) b.setAttribute('aria-pressed', b.dataset.v === S.color);
  $('#themesLabel').textContent = S.themes.length ? S.themes.map(themeName).join(', ') : 'All themes';
  $('#opening').value = S.opening;
  $('#autoQueen').checked = S.autoQueen;

  const best = data.best[configKey()];
  $('#bestLine').innerHTML = (best != null ? `<span>Best <b>${best}</b></span>` : '<span>No runs yet</span>') +
    (S.mode === 'racer' ? `<span>Goal <b>${S.goal}</b></span>` : '');
  updateCount();
}

let countTok = 0;
async function updateCount() {
  if (S.source !== 'pack') { $('#startBtn').disabled = false; return; }
  const tok = ++countTok;
  $('#poolCount').textContent = '…';
  try {
    const list = await Pool.filtered(packCfg());
    if (tok !== countTok) return;
    $('#poolCount').textContent = list.length ? `${list.length.toLocaleString()} puzzles` : 'No puzzles match these filters';
    $('#startBtn').disabled = !list.length;
  } catch (e) {
    $('#poolCount').textContent = 'Could not load the puzzle pack';
  }
}
const packCfg = () => ({ bands: S.bands, themes: S.themes, opening: S.opening, color: S.color, progressive: S.progressive });

$('#sourceSeg').onclick = e => { const b = e.target.closest('button'); if (b) { S.source = b.dataset.v; save(); renderSetup(); } };
$('#colorSeg').onclick = e => { const b = e.target.closest('button'); if (b) { S.color = b.dataset.v; save(); renderSetup(); } };
$('#progressive').onchange = e => { S.progressive = e.target.checked; save(); renderSetup(); };
$('#autoQueen').onchange = e => { S.autoQueen = e.target.checked; save(); };
$('#opening').onchange = e => { S.opening = e.target.value; save(); renderSetup(); };
document.querySelectorAll('[data-step]').forEach(b => b.onclick = e => {
  e.preventDefault();
  S.minutes = Math.max(1, Math.min(10, S.minutes + +b.dataset.step));
  save(); renderSetup();
});
$('#soundBtn').onclick = () => { S.sound = !S.sound; save(); renderSound(); };
function renderSound() { $('#soundBtn .ms').textContent = S.sound ? 'volume_up' : 'volume_off'; }

// Themes dialog
let pickThemes = new Set();
$('#themesBtn').onclick = () => {
  pickThemes = new Set(S.themes);
  $('#themeSearch').value = '';
  renderThemes();
  $('#themesDlg').showModal();
};
$('#themeSearch').oninput = renderThemes;
$('#themesClear').onclick = () => { pickThemes.clear(); renderThemes(); };
$('#themesDone').onclick = () => { S.themes = [...pickThemes]; save(); $('#themesDlg').close(); renderSetup(); };
function renderThemes() {
  const q = $('#themeSearch').value.trim().toLowerCase();
  const groups = {};
  for (const t of Pool.index.themes) {
    if (q && !themeName(t).toLowerCase().includes(q)) continue;
    (groups[themeGroup(t)] = groups[themeGroup(t)] || []).push(t);
  }
  const box = $('#themeGroups');
  box.innerHTML = '';
  for (const g of ['Motifs', 'Goal', 'Mating patterns', 'Phase']) {
    if (!groups[g]) continue;
    box.insertAdjacentHTML('beforeend', `<h2>${g}</h2>`);
    const chips = document.createElement('div');
    chips.className = 'chips';
    for (const t of groups[g].sort((a, z) => themeName(a).localeCompare(themeName(z)))) {
      const b = document.createElement('button');
      b.textContent = themeName(t);
      b.setAttribute('aria-pressed', pickThemes.has(t));
      b.onclick = () => { pickThemes.has(t) ? pickThemes.delete(t) : pickThemes.add(t); b.setAttribute('aria-pressed', pickThemes.has(t)); };
      chips.appendChild(b);
    }
    box.appendChild(chips);
  }
}

// ---- A run ----
let run = null, runId = 0, tickTimer = null;
const later = (fn, ms) => { const id = run.id; setTimeout(() => { if (run && run.id === id && !run.over) fn(); }, ms); };
// Like later(), but dropped if another puzzle has been shown in the meantime
const laterHere = (fn, ms) => { const seq = run.seq; later(() => { if (run.seq === seq) fn(); }, ms); };

async function start() {
  $('#setupMsg').textContent = '';
  const m = modeCfg();
  setState('run');
  veil('Loading puzzles…');
  let queue, fallback = null, fixedColor = null;
  try {
    if (S.source === 'racer') {
      queue = await Pool.racerQueue(S.mode === 'racer');
      fixedColor = queue.color;
      // If the set runs out, carry on with hard pack puzzles of the same colour
      fallback = Pool.packQueue({ bands: [1600, 1800], themes: [], opening: '', color: fixedColor, progressive: true }, seen);
    } else {
      await Pool.loadIndex();
      queue = await Pool.packQueue(packCfg(), seen);
      if (!queue) throw new Error('No puzzles match these filters');
    }
  } catch (e) {
    veil(null);
    setState('setup');
    renderSetup();
    $('#setupMsg').textContent = (e && e.message) || 'Could not load puzzles';
    return;
  }
  veil(null);
  run = {
    id: ++runId, mode: S.mode, m, key: configKey(), queue, fallback, fixedColor,
    seq: 0, accepting: false, score: 0, combo: 0, maxCombo: 0, moves: 0, solved: 0, failed: 0, skipped: 0, strikesUsed: 0,
    skipsLeft: m.skips || 0, started: 0, deadline: 0, endedAt: 0, history: [], over: false,
  };
  $('#history').innerHTML = '';
  renderHud();
  clearInterval(tickTimer);
  tickTimer = setInterval(tick, 100);
  nextPuzzle(true);
}

async function nextPuzzle(first) {
  run.accepting = false;
  run.seq++;
  board.set({ mover: null, premoveFor: null, marks: {} });
  let p = run.queue.next();
  if (!p && run.fallback) {
    run.queue = await run.fallback;
    run.fallback = null;
    p = run.queue && run.queue.next();
  }
  if (!p) return endRun(false);
  seen.add(p.id);
  showPuzzle(p, first);
}

function showPuzzle(p, first) {
  const color = Pool.solverColor(p);
  run.seq++;
  Object.assign(run, { p, ply: 0, game: new Chess(p.fen), color, pStart: 0, accepting: false });
  board.set({ game: run.game, orient: run.fixedColor || color, last: null, mover: null, premoveFor: color, marks: {} });
  renderHint();
  laterHere(() => opponentMove(), first ? 450 : 200);
}

const toMove = u => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });

function opponentMove() {
  const m = run.game.move(toMove(run.p.moves[run.ply]));
  run.ply++;
  run.accepting = true;
  if (!run.pStart) run.pStart = performance.now();
  board.set({ game: run.game, last: { from: m.from, to: m.to }, mover: run.color, premoveFor: run.color });
  board.animate(m);
  moveSound(m);
  board.playPremove();
}

function playerMove(from, to, dragged) {
  if (!run || run.over || !run.accepting || run.game.turn() !== run.color) return;
  const piece = run.game.get(from);
  if (piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1')) {
    const exp = run.p.moves[run.ply] || '';
    // Auto-queen, unless the answer is an underpromotion on this very square
    if (S.autoQueen && !(exp.slice(0, 4) === from + to && exp[4] && exp[4] !== 'q')) return judge(from, to, 'q', dragged);
    return askPromotion(from, to, run.color, pc => judge(from, to, pc, dragged));
  }
  judge(from, to, '', dragged);
}

function judge(from, to, promo, dragged) {
  const exp = run.p.moves[run.ply];
  const m = run.game.move({ from, to, promotion: promo || 'q' });
  if (!m) return board.render();
  startClock();
  // Any checkmate solves the puzzle, as on Lichess
  if (from + to + promo === exp || run.game.in_checkmate()) {
    run.ply++;
    run.moves++;
    run.accepting = false;
    board.set({ game: run.game, last: { from, to }, mover: null, premoveFor: run.color });
    if (!dragged) board.animate(m);
    moveSound(m);
    gainCombo();
    if (run.m.per === 'move') addScore(1);
    if (run.game.in_checkmate() || run.ply >= run.p.moves.length) return solved();
    laterHere(() => opponentMove(), 60);
  } else {
    run.game.undo();
    wrong(from, to);
  }
  renderHud();
}

function startClock() {
  if (run.started) return;
  run.started = performance.now();
  if (run.m.time) run.deadline = run.started + run.m.time * 1000;
  renderHint();
}

function gainCombo() {
  run.combo++;
  run.maxCombo = Math.max(run.maxCombo, run.combo);
  const i = comboIndex(run.combo);
  if (i < 0 || !run.m.bonus) return;
  const v = BONUS[run.m.bonus][Math.min(i, 3)];
  if (run.m.bonus === 'points') { run.score += v; pop('.score', '+' + v); }
  else { run.deadline += v * 1000; pop('#clock', `+${v}s`); }
}
// Which bonus step this combo count lands on, or -1
function comboIndex(c) {
  const i = COMBO_AT.indexOf(c);
  if (i >= 0) return i;
  return c > 30 && c % 10 === 0 ? 3 + (c - 30) / 10 : -1;
}
function comboRange(c) {
  const steps = [0, ...COMBO_AT];
  while (steps[steps.length - 1] <= c) steps.push(steps[steps.length - 1] + 10);
  const next = steps.find(s => s > c), prev = steps[steps.indexOf(next) - 1];
  return { prev, next, idx: steps.indexOf(next) - 1 };
}

function addScore(n) { run.score += n; }

function solved() {
  run.solved++;
  if (run.m.per === 'puzzle') addScore(1);
  record('ok');
  renderHud();
  laterHere(() => nextPuzzle(), 220);
}

function wrong(from, to) {
  run.accepting = false;
  run.failed++;
  run.combo = 0;
  record('bad');
  board.clearPremove();
  board.set({ mover: null, premoveFor: null, marks: { [from]: 'miss', [to]: 'miss' } });
  boardEl.classList.remove('nudge'); void boardEl.offsetWidth; boardEl.classList.add('nudge');
  sound('Error');
  if (run.m.penalty) { run.deadline -= run.m.penalty * 1000; pop('#clock', `-${run.m.penalty}s`, true); }
  if (run.m.strikes) {
    run.strikesUsed++;
    if (run.strikesUsed >= run.m.strikes) { renderHud(); return later(() => endRun(false), 600); }
  }
  laterHere(() => nextPuzzle(), 500);
}

function skip() {
  if (!run || run.over || !run.skipsLeft || !run.accepting) return;
  run.skipsLeft--;
  run.skipped++;
  record('skip');
  board.clearPremove();
  nextPuzzle();
  renderHud();
}

function record(result) {
  const ms = run.pStart ? Math.round(performance.now() - run.pStart) : 0;
  run.history.push({ p: run.p, result, ms });
  const t = document.createElement('span');
  t.className = 'tile ' + (result === 'ok' ? '' : result);
  t.textContent = run.p.rating;
  $('#history').appendChild(t);
  $('#history').scrollTop = $('#history').scrollHeight;
}

function tick() {
  if (!run || run.over) return;
  const now = performance.now();
  if (run.deadline && now >= run.deadline) return endRun(false);
  renderClock();
}

function endRun(abandoned) {
  if (!run || run.over) return;
  run.over = true;
  run.endedAt = performance.now();
  clearInterval(tickTimer);
  board.clearPremove();
  board.set({ mover: null, premoveFor: null });
  renderClock();
  if (abandoned && !run.history.length) { setState('setup'); renderSetup(); return; }
  sound('GenericNotify');
  let newBest = false;
  if (!abandoned) {
    const prev = data.best[run.key];
    newBest = prev == null || run.score > prev;
    if (newBest) data.best[run.key] = run.score;
    data.runs.push({ key: run.key, mode: run.mode, score: run.score, solved: run.solved, failed: run.failed, at: Date.now() });
    if (data.runs.length > 2000) data.runs = data.runs.slice(-2000);
  }
  save();
  showResult(newBest && !abandoned && run.history.length > 0, abandoned);
}

// ---- HUD ----
function renderHud() {
  if (!run) return;
  $('#score').textContent = run.score;
  $('#scoreLabel').textContent = run.m.per === 'move' ? 'points' : 'solved';
  const combo = document.querySelector('.combo');
  combo.style.display = run.m.bonus ? '' : 'none';
  if (run.m.bonus) {
    const r = comboRange(run.combo);
    $('#comboFill').style.width = ((run.combo - r.prev) / (r.next - r.prev) * 100) + '%';
    $('#comboCount').textContent = run.combo;
    const v = BONUS[run.m.bonus][Math.min(r.idx, 3)];
    $('#comboNext').textContent = run.m.bonus === 'points' ? `+${v} at ${r.next}` : `+${v}s at ${r.next}`;
  }
  const st = $('#strikes');
  st.innerHTML = '';
  for (let i = 0; i < (run.m.strikes || 0); i++) st.insertAdjacentHTML('beforeend', `<span class="ms${i < run.strikesUsed ? ' used' : ''}">close</span>`);
  const sk = $('#skipBtn');
  sk.style.display = run.m.skips ? '' : 'none';
  sk.disabled = !run.skipsLeft;
  renderClock();
}
function renderClock() {
  const c = $('#clock');
  let ms;
  if (!run.m.time) ms = run.started ? (run.endedAt || performance.now()) - run.started : 0;
  else ms = run.started ? Math.max(0, run.deadline - (run.endedAt || performance.now())) : run.m.time * 1000;
  const s = run.m.time ? Math.ceil(ms / 1000) : Math.floor(ms / 1000);
  const text = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (c.firstChild && c.firstChild.nodeType === 3) c.firstChild.nodeValue = text; else c.prepend(document.createTextNode(text));
  c.classList.toggle('idle', !run.started);
  c.classList.toggle('low', !!run.m.time && run.started && ms < 10000 && !run.over);
}
function renderHint() {
  const side = `<b>${run.color === 'w' ? 'White' : 'Black'}</b> to move`;
  $('#hint').innerHTML = run.started ? side : `${side} · first move starts the clock`;
}
function pop(sel, text, neg) {
  const el = document.querySelector(sel);
  const p = document.createElement('span');
  p.className = 'pop' + (neg ? ' neg' : '');
  p.textContent = text;
  el.appendChild(p);
  setTimeout(() => p.remove(), 1200);
}
function veil(text) {
  $('#veil').hidden = !text;
  $('#veilText').textContent = text || '';
}

// ---- Promotion picker ----
function askPromotion(from, to, color, done) {
  const box = $('#promo');
  const flip = board.orient === 'b';
  const f = to.charCodeAt(0) - 97;
  const col = flip ? 7 - f : f;
  const top = (to[1] === '8') !== flip;
  box.style.left = col * 12.5 + '%';
  box.style.top = top ? '0' : 'auto';
  box.style.bottom = top ? 'auto' : '0';
  box.style.flexDirection = top ? 'column' : 'column-reverse';
  box.innerHTML = '';
  for (const t of ['q', 'n', 'r', 'b']) {
    const img = document.createElement('img');
    img.src = `pieces/cburnett/${color}${t.toUpperCase()}.svg`;
    img.onclick = () => { box.hidden = true; done(t); };
    box.appendChild(img);
  }
  box.hidden = false;
}

// ---- Results ----
let lastResult = null;
function showResult(newBest, abandoned) {
  setState('over');
  lastResult = run;
  const r = run;
  $('#resScore').textContent = r.score;
  $('#resLabel').textContent = `${r.m.per === 'move' ? 'points' : 'solved'} · ${MODES[r.mode].label}${S.source === 'racer' ? ' · Racer set' : ''}${abandoned ? ' · ended early' : ''}`;
  $('#newBest').hidden = !newBest;
  const dur = Math.max(1 / 60, ((r.endedAt || performance.now()) - (r.started || r.endedAt)) / 60000);
  const solvedTimes = r.history.filter(h => h.result === 'ok').map(h => h.ms);
  const avg = solvedTimes.length ? solvedTimes.reduce((a, b) => a + b, 0) / solvedTimes.length / 1000 : 0;
  const top = Math.max(0, ...r.history.filter(h => h.result === 'ok').map(h => h.p.rating));
  const stats = [
    ['Solved', r.solved], ['Mistakes', r.failed], ['Correct moves', r.moves], ['Best combo', r.maxCombo],
    ['Moves / min', r.started ? (r.moves / dur).toFixed(1) : '–'], ['Avg per puzzle', avg ? avg.toFixed(1) + 's' : '–'],
    ['Top rating', top || '–'], ['Best ever', data.best[r.key] ?? '–'],
  ];
  if (r.skipped) stats.splice(2, 0, ['Skipped', r.skipped]);
  $('#resStats').innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
  $('.goal').style.display = r.mode === 'racer' ? '' : 'none';
  $('#goal').value = S.goal;
  for (const b of $('#sortSeg').children) b.setAttribute('aria-pressed', b.dataset.v === S.sort);
  renderChart();
  renderList();
}

function renderChart() {
  const r = lastResult;
  const runs = data.runs.filter(x => x.key === r.key).slice(-40);
  const box = $('#chart');
  if (!runs.length) { box.innerHTML = '<div class="empty">Finish a run to start your chart</div>'; return; }
  const W = 312, H = 120, P = 6;
  const goal = r.mode === 'racer' ? S.goal : null;
  const max = Math.max(10, goal || 0, ...runs.map(x => x.score)) * 1.1;
  const x = i => runs.length === 1 ? W / 2 : P + i * (W - 2 * P) / (runs.length - 1);
  const y = v => H - P - v / max * (H - 2 * P);
  const pts = runs.map((u, i) => `${x(i).toFixed(1)},${y(u.score).toFixed(1)}`).join(' ');
  const best = Math.max(...runs.map(u => u.score));
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores of your last ${runs.length} runs">`;
  svg += `<line x1="0" x2="${W}" y1="${H - P}" y2="${H - P}" stroke="#3d3a37"/>`;
  if (goal) svg += `<line x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}" stroke="#629924" stroke-dasharray="4 4"/><text x="${W - 2}" y="${y(goal) - 4}" fill="#629924" font-size="11" text-anchor="end" font-family="Roboto Mono">goal ${goal}</text>`;
  svg += `<polyline points="${pts}" fill="none" stroke="#3692e7" stroke-width="2" stroke-linejoin="round"/>`;
  runs.forEach((u, i) => { svg += `<circle cx="${x(i)}" cy="${y(u.score)}" r="${i === runs.length - 1 ? 4 : 2.5}" fill="${u.score === best ? '#fff' : '#3692e7'}"><title>${u.score}</title></circle>`; });
  svg += `<text x="2" y="12" fill="#999" font-size="11" font-family="Roboto Mono">best ${best}</text></svg>`;
  box.innerHTML = svg;
}

function renderList() {
  const r = lastResult;
  let items = r.history.map((h, i) => ({ ...h, i }));
  if (S.sort === 'slow') items = items.filter(h => h.result === 'ok').sort((a, b) => b.ms - a.ms);
  if (S.sort === 'miss') items = items.filter(h => h.result !== 'ok');
  const box = $('#resList');
  box.innerHTML = items.length ? '' : '<div class="desc">Nothing here</div>';
  for (const h of items) {
    const b = document.createElement('button');
    b.className = 'prow ' + (h.result === 'ok' ? '' : h.result);
    const themes = h.p.themes.filter(t => !['middlegame', 'endgame', 'opening', 'advantage', 'crushing'].includes(t)).slice(0, 2).map(themeName).join(', ');
    b.innerHTML = `<span class="n">${h.i + 1}</span><span class="r">${h.p.rating}</span><span class="t"></span><span class="s">${h.ms ? (h.ms / 1000).toFixed(1) + 's' : ''}</span><span class="ms">${h.result === 'ok' ? 'check' : h.result === 'bad' ? 'close' : 'skip_next'}</span>`;
    b.querySelector('.t').textContent = themes;
    b.onclick = () => openReview(h);
    box.appendChild(b);
  }
}
$('#sortSeg').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.sort = b.dataset.v; save(); for (const x of $('#sortSeg').children) x.setAttribute('aria-pressed', x === b); renderList(); };
$('#goal').onchange = e => { const v = Math.round(+e.target.value); if (v > 0) { S.goal = v; save(); renderChart(); } };

// ---- Review a puzzle from the results ----
let rev = null;
function openReview(h) {
  setState('review');
  rev = { h, token: 0 };
  $('#revRating').textContent = h.p.rating;
  $('#revThemes').textContent = h.p.themes.map(themeName).join(' · ');
  $('#revLink').href = `https://lichess.org/training/${h.p.id}`;
  resetReview();
}
function resetReview() {
  const p = rev.h.p, tok = ++rev.token;
  rev.game = new Chess(p.fen);
  rev.ply = 0;
  rev.color = Pool.solverColor(p);
  revStatus(rev.h.result === 'ok' ? 'Solved in the run' : rev.h.result === 'bad' ? 'Missed in the run' : 'Skipped in the run', '');
  board.set({ game: rev.game, orient: rev.color, last: null, mover: null, premoveFor: null, marks: {} });
  setTimeout(() => { if (rev && rev.token === tok && state === 'review') revOpponent(); }, 350);
}
function revOpponent() {
  const m = rev.game.move(toMove(rev.h.p.moves[rev.ply]));
  rev.ply++;
  board.set({ game: rev.game, last: { from: m.from, to: m.to }, mover: rev.ply < rev.h.p.moves.length ? rev.color : null, premoveFor: null });
  board.animate(m);
  moveSound(m);
}
function reviewMove(from, to) {
  const exp = rev.h.p.moves[rev.ply] || '';
  const piece = rev.game.get(from);
  const promo = piece && piece.type === 'p' && (to[1] === '8' || to[1] === '1') ? (exp.slice(0, 4) === from + to && exp[4] ? exp[4] : 'q') : '';
  const m = rev.game.move({ from, to, promotion: promo || 'q' });
  if (!m) return board.render();
  if (from + to + promo === exp || rev.game.in_checkmate()) {
    rev.ply++;
    board.set({ game: rev.game, last: { from, to }, mover: null, marks: {} });
    board.animate(m);
    moveSound(m);
    if (rev.game.in_checkmate() || rev.ply >= rev.h.p.moves.length) return revStatus('Solved', 'good');
    const tok = rev.token;
    setTimeout(() => { if (rev && rev.token === tok) revOpponent(); }, 300);
  } else {
    rev.game.undo();
    sound('Error');
    revStatus('Not the move', 'bad');
    board.set({ marks: { [from]: 'miss', [to]: 'miss' } });
  }
}
function revStatus(t, cls) { const s = $('#revStatus'); s.textContent = t; s.className = cls; }
$('#revRetry').onclick = () => resetReview();
$('#revSolution').onclick = () => {
  const tok = ++rev.token;
  board.set({ mover: null, marks: {} });
  const step = () => {
    if (!rev || rev.token !== tok || state !== 'review') return;
    if (rev.ply >= rev.h.p.moves.length) return revStatus('Solution', '');
    const m = rev.game.move(toMove(rev.h.p.moves[rev.ply]));
    rev.ply++;
    board.set({ game: rev.game, last: { from: m.from, to: m.to } });
    board.animate(m, 220);
    moveSound(m);
    setTimeout(step, 700);
  };
  step();
};
$('#revBack').onclick = () => { rev.token++; rev = null; showResultAgain(); };
function showResultAgain() {
  setState('over');
  const r = lastResult;
  if (r.game) board.set({ game: r.game, orient: r.fixedColor || r.color, mover: null, premoveFor: null, marks: {} });
}

// ---- Buttons and keys ----
$('#startBtn').onclick = start;
$('#againBtn').onclick = start;
$('#setupBtn').onclick = () => { setState('setup'); renderSetup(); };
$('#skipBtn').onclick = skip;
$('#endBtn').onclick = () => endRun(true);
document.addEventListener('keydown', e => {
  if (e.target.closest('input, select, dialog')) return;
  if (state === 'run' && e.code === 'Space') { e.preventDefault(); skip(); }
  if (state === 'run' && e.key === 'Escape') endRun(true);
  if ((state === 'setup' || state === 'over') && e.key === 'Enter' && !e.target.closest('button')) start();
});

// ---- Init ----
(async () => {
  renderSound();
  try {
    const ix = await Pool.loadIndex();
    const sel = $('#opening');
    sel.innerHTML = '<option value="">Any opening</option>' + ix.openings.map(o => `<option value="${o}">${openingName(o)}</option>`).join('');
  } catch {}
  renderSetup();
})();
