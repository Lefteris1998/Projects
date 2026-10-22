'use strict';
// ---------------------------------------------------------------------------
// UI: rendering, input, previews, screens. All rules live in engine.js.
// ---------------------------------------------------------------------------

const $ = sel => document.querySelector(sel);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STORE_KEY = 'buckshot-gambit.v1';

function loadStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
}
function saveStore() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify({ progress: G.progress, opts: G.opts })); } catch (e) { /* storage unavailable */ }
}

const stored = loadStore();
const G = {
  mode: 'single',          // 'single' (level select) | 'run' (campaign with cards)
  levelIdx: 0,
  state: null,
  history: [],
  takebacks: 0,
  run: null,
  busy: false,
  pointer: null,
  intent: null,
  shift: false,
  soulArmed: -1,
  lastEnemy: [],
  spawned: new Set(),
  hoverSq: null,
  ghost: null,
  pendingTouch: null,
  squares: [],
  modalDismissable: true,
  progress: Object.assign({ unlocked: 1, stars: {}, seenHelp: false }, stored.progress || {}),
  opts: Object.assign({ danger: true, predict: false, aim: false, sound: true }, stored.opts || {}),
};
SFX.enabled = G.opts.sound;

const pieceEls = new Map();
const pieceImg = (type, white) => `assets/pieces/${white ? 'w' : 'b'}${type}.svg`;
const placeEl = (el, x, y) => { el.style.transform = `translate(${x * 100}%, ${y * 100}%)`; };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function screenOpen() {
  return !$('#screen-home').classList.contains('hidden') || !$('#screen-levels').classList.contains('hidden');
}
function modalOpen() { return !$('#modal').classList.contains('hidden'); }
function canAct() {
  return !!G.state && G.state.status === 'play' && !G.busy && !modalOpen() && !screenOpen();
}

// ---------- board DOM ----------

function buildBoardDom() {
  const b = $('#board');
  b.innerHTML = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const d = document.createElement('div');
      d.className = 'sq ' + ((x + y) % 2 ? 'd' : 'l');
      if (x === 0) d.insertAdjacentHTML('beforeend', `<span class="co rank">${8 - y}</span>`);
      if (y === 7) d.insertAdjacentHTML('beforeend', `<span class="co file">${FILES[x]}</span>`);
      b.appendChild(d);
    }
  }
  G.squares = [...b.children];
}

function resetPieceLayer() {
  $('#pieces').innerHTML = '';
  pieceEls.clear();
  G.ghost = null;
}

function makePieceEl(key, x, y) {
  const el = document.createElement('div');
  el.className = 'pc';
  el.style.transition = 'none';
  placeEl(el, x, y);
  $('#pieces').appendChild(el);
  void el.offsetWidth;
  el.style.transition = '';
  pieceEls.set(key, el);
  return el;
}

// ---------- rendering ----------

function render() {
  if (!G.state) return;
  renderSquares();
  renderPieces();
  renderPanel();
  renderStrips();
}

function renderSquares() {
  const s = G.state;
  if (!s) return;
  const map = attackMap(s);
  const act = canAct();
  const dots = act ? (G.soulArmed >= 0 ? soulMoves(s, s.souls[G.soulArmed]) : kingMoves(s)) : [];
  const dotSet = new Set(dots.map(m => m.y * 8 + m.x));
  const hl = new Set((s.lastMove || []).map(p => p.y * 8 + p.x));
  const hle = new Set();
  for (const e of G.lastEnemy) { hle.add(e.from.y * 8 + e.from.x); hle.add(e.to.y * 8 + e.to.x); }
  const spawn = nextSpawnPreview(s);
  G.squares.forEach((el, i) => {
    const x = i % 8, y = (i / 8) | 0;
    let c = 'sq ' + ((x + y) % 2 ? 'd' : 'l');
    if (hl.has(i)) c += ' hl'; else if (hle.has(i)) c += ' hl-enemy';
    if (G.opts.danger && map[i]) c += ' danger';
    if (s.check && s.king.x === x && s.king.y === y) c += ' check';
    if (dotSet.has(i)) c += ' dot' + (G.soulArmed >= 0 ? ' soul' : '');
    if (spawn && spawn.x === x && spawn.y === y) c += ' spawn';
    if (G.hoverSq && G.hoverSq.i === i) c += ' ' + G.hoverSq.cls;
    if (el.className !== c) el.className = c;
  });
}

function renderPieces() {
  const s = G.state;
  const seen = new Set();
  let k = pieceEls.get('bk');
  if (!k) {
    k = makePieceEl('bk', s.king.x, s.king.y);
    k.classList.add('king');
    k.innerHTML = `<img src="${pieceImg('K', false)}" alt="Black King">`;
  }
  placeEl(k, s.king.x, s.king.y);
  seen.add('bk');

  for (const p of s.pieces) {
    let el = pieceEls.get(p.id);
    if (!el) {
      el = makePieceEl(p.id, p.x, p.y);
      if (G.spawned.has(p.id)) el.classList.add('spawned');
    }
    if (el._type !== p.type) {
      el.innerHTML = `<img src="${pieceImg(p.type, true)}" alt="${PIECES[p.type].name}"><div class="hp"></div><div class="wait"></div><div class="dmgp"></div>`;
      el._type = p.type;
      el._hpKey = '';
    }
    const hpKey = p.hp + '/' + p.maxHp;
    if (el._hpKey !== hpKey) {
      el.querySelector('.hp').innerHTML = Array.from({ length: p.maxHp }, (_, i) => `<i class="${i < p.hp ? '' : 'off'}"></i>`).join('');
      el._hpKey = hpKey;
    }
    const w = el.querySelector('.wait');
    w.textContent = p.wait;
    w.title = p.wait === 1 ? 'Moves right after your action' : `Moves in ${p.wait} turns`;
    el.classList.toggle('ready', p.wait === 1 && s.status === 'play');
    el.classList.toggle('target-king', p.type === 'K' && s.objective === 'king');
    placeEl(el, p.x, p.y);
    seen.add(p.id);
  }
  for (const [id, el] of [...pieceEls]) {
    if (seen.has(id)) continue;
    pieceEls.delete(id);
    el.classList.add('dying');
    setTimeout(() => el.remove(), 520);
  }
}

function hintFor(s) {
  const lv = LEVELS[G.levelIdx];
  if (s.status === 'won') return ['Level cleared!', ''];
  if (s.status === 'lost') return [`${esc(s.lostReason)}. Take back a move or restart.`, 'bad'];
  if (G.busy) return ['White is moving…', ''];
  if (!s.canAct) return ['No legal moves — you must wait a turn.', 'warn'];
  if (s.check) return ['<b>Check!</b> Step out of the line of fire, or blast the attacker.', 'bad'];
  if (G.soulArmed >= 0) return [`Soul armed: move once like a <b>${PIECES[s.souls[G.soulArmed]].name}</b>. Click a purple dot (Esc to cancel).`, 'warn'];
  if (s.turn === 0) return ['💡 ' + esc(lv.tip), ''];
  if (s.loaded === 0) return ['Chamber empty — move to reload a shell.', 'warn'];
  const ready = s.pieces.filter(p => p.wait === 1).length;
  return [`Click a dot to move (reloads). Click anywhere else to fire.${ready ? ` <b>${ready}</b> piece${ready > 1 ? 's' : ''} will move after your turn.` : ''}`, ''];
}

function renderPanel() {
  const s = G.state, lv = LEVELS[G.levelIdx];
  $('#mode-label').textContent = (G.mode === 'run' ? 'Run · ' : '') + `Level ${G.levelIdx + 1} of ${LEVELS.length}`;
  $('#level-name').textContent = lv.name;
  $('#objective').innerHTML = 'Objective: ' + (s.objective === 'king'
    ? '<b>Kill the White King</b>'
    : '<b>Destroy every white piece</b>' + (s.reinf ? ' — reinforcements included' : ''));
  const [hint, cls] = hintFor(s);
  const h = $('#hint');
  h.innerHTML = hint;
  h.className = 'hint' + (cls ? ' ' + cls : '');

  $('#st-turn').textContent = s.turn;
  $('#st-turn').className = s.turn > s.par ? 'over' : '';
  $('#st-par').textContent = s.par;
  $('#st-shields').textContent = s.shields ? '🛡'.repeat(Math.min(3, s.shields)) + (s.shields > 3 ? s.shields : '') : '0';
  $('#st-enemies').textContent = s.pieces.length;

  const souls = $('#souls');
  souls.innerHTML = '';
  for (let i = 0; i < s.stats.soulSlots; i++) {
    const t = s.souls[i];
    const b = document.createElement('button');
    b.className = 'soul-slot' + (t ? ' full' : '') + (G.soulArmed === i ? ' armed' : '');
    b.title = t ? `${PIECES[t].name} soul — click (or press ${i + 1}) to move like a ${PIECES[t].name} once` : 'Empty soul slot — kill a knight, bishop, rook or queen';
    if (t) b.innerHTML = `<img src="${pieceImg(t, false)}" alt="">`;
    b.onclick = () => armSoul(i);
    souls.appendChild(b);
  }

  const ml = $('#movelist');
  ml.innerHTML = s.log.length
    ? s.log.map(l => `<div class="mv-row"><span class="n">${l.n}.</span><span class="you">${esc(l.you)}</span><span class="them">${l.them.map(esc).join(', ') || '—'}${l.check ? ' <span class="chk">+ check</span>' : ''}</span></div>`).join('')
    : '<div class="mv-empty">Your move. The White Army waits…</div>';
  ml.scrollTop = ml.scrollHeight;

  if (G.mode === 'run' && G.run) {
    $('#cards-owned').innerHTML =
      G.run.black.map(id => BLACK_CARDS.find(c => c.id === id)).map(c => `<span class="chip b" title="${esc(c.text)}">${c.icon} ${esc(c.name)}</span>`).join('') +
      G.run.white.map(id => WHITE_CARDS.find(c => c.id === id)).map(c => `<span class="chip w" title="${esc(c.text)}">${c.icon} ${esc(c.name)}</span>`).join('') ||
      '<span class="sub">None yet — win a level to draft.</span>';
  }

  $('#btn-wait').classList.toggle('hidden', !(s.status === 'play' && !s.canAct && !G.busy));
  $('#btn-undo').disabled = G.busy || !G.history.length;
  $('#btn-danger').classList.toggle('on', G.opts.danger);
  $('#btn-predict').classList.toggle('on', G.opts.predict);
  $('#btn-aim').classList.toggle('on', G.opts.aim);
  updateInspector();
}

function renderStrips() {
  const s = G.state;
  let sub = `${s.pieces.length} piece${s.pieces.length === 1 ? '' : 's'} on board`;
  if (s.reinf && s.reinf.idx < s.reinf.pool.length) {
    const left = s.reinf.pool.length - s.reinf.idx;
    sub += s.reinf.timer === 1
      ? ` · <span class="warn">reinforcement next turn!</span> (${left} left)`
      : ` · reinforcements in ${s.reinf.timer} turns (${left} left)`;
  }
  $('#enemy-sub').innerHTML = sub;
  $('#captured').innerHTML = s.captured.map(t => `<img src="${pieceImg(t, true)}" alt="">`).join('');
  const st = s.stats;
  $('#you-sub').textContent = `${st.pellets} pellets · ${st.spread}° spread · range ${st.range.toFixed(1)}${st.damage > 1 ? ` · ${st.damage} dmg` : ''}`;
  let ammo = '';
  for (let i = 0; i < st.capacity; i++) ammo += `<div class="shell${i < s.loaded ? '' : ' empty'}" title="Loaded shells"></div>`;
  ammo += `<span class="reserve" title="Reserve shells — moving reloads">+${s.reserve}</span>`;
  $('#ammo').innerHTML = ammo;
}

function updateInspector() {
  const box = $('#inspector'), s = G.state;
  if (!s) return;
  const pt = G.pointer;
  const cx = pt ? Math.floor(pt.fx) : -1, cy = pt ? Math.floor(pt.fy) : -1;
  const p = s.pieces.find(q => q.x === cx && q.y === cy);
  if (p) {
    const d = PIECES[p.type];
    box.innerHTML = `<img src="${pieceImg(p.type, true)}" alt=""><div><b>${d.name}</b> · HP ${p.hp}/${p.maxHp} · moves every ${p.speed === 1 ? 'turn' : p.speed + ' turns'}<br>` +
      (p.wait === 1 ? '<span style="color:var(--red);font-weight:700">Moves right after your action</span>' : `Next move in ${p.wait} turns`) +
      (d.soul ? ' · drops a soul' : '') + (p.type === 'K' && s.objective === 'king' ? ' · <b>your target</b>' : '') + '</div>';
  } else if (s.king.x === cx && s.king.y === cy) {
    box.innerHTML = `<img src="${pieceImg('K', false)}" alt=""><div><b>You</b> · ${s.loaded}/${s.stats.capacity} loaded, ${s.reserve} in reserve<br>Moving reloads ${s.stats.reloadPerMove} shell${s.stats.reloadPerMove > 1 ? 's' : ''}. You cannot capture by moving.</div>`;
  } else {
    box.innerHTML = '<div>Hover a piece to inspect it. The red badge shows turns until it moves.</div>';
  }
}

// ---------- intents & previews ----------

function boardPoint(e) {
  const r = $('#board-wrap').getBoundingClientRect();
  return { fx: (e.clientX - r.left) / r.width * 8, fy: (e.clientY - r.top) / r.height * 8 };
}

function computeIntent(forceAim) {
  if (!canAct() || !G.pointer) return null;
  const s = G.state, { fx, fy } = G.pointer;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  if (!inBoard(cx, cy)) return null;
  if (G.soulArmed >= 0) {
    const ok = soulMoves(s, s.souls[G.soulArmed]).some(m => m.x === cx && m.y === cy);
    return ok ? { type: 'move', x: cx, y: cy, soulIdx: G.soulArmed } : { type: 'none' };
  }
  const aim = forceAim || G.shift || G.opts.aim;
  if (!aim) {
    if (cx === s.king.x && cy === s.king.y) return { type: 'none' };
    if (cheb(cx, cy, s.king.x, s.king.y) === 1) {
      if (kingMoves(s).some(m => m.x === cx && m.y === cy)) return { type: 'move', x: cx, y: cy, soulIdx: -1 };
      if (!s.pieces.some(p => p.x === cx && p.y === cy)) return { type: 'blocked', x: cx, y: cy };
      // an adjacent enemy: fall through and shoot it point-blank
    }
  }
  if (s.loaded <= 0) return { type: 'noammo' };
  return { type: 'shoot', angle: Math.atan2(fy - (s.king.y + 0.5), fx - (s.king.x + 0.5)) };
}

let hoverQueued = false;
function queueHover() {
  if (hoverQueued) return;
  hoverQueued = true;
  requestAnimationFrame(updateHover);
}

function warn(msg, cls) {
  const w = $('#aim-warn');
  w.innerHTML = msg;
  w.className = 'aim-warn show' + (cls ? ' ' + cls : '');
}

function clearPreview() {
  $('#g-aim').innerHTML = '';
  $('#g-arrows').innerHTML = '';
  $('#aim-warn').className = 'aim-warn';
  G.hoverSq = null;
  if (G.ghost) G.ghost.style.display = 'none';
  document.querySelectorAll('.dmgp.show').forEach(d => { d.className = 'dmgp'; });
}

function updateHover() {
  hoverQueued = false;
  if (!G.state) return;
  clearPreview();
  updateInspector();
  const it = computeIntent(false);
  G.intent = it;
  const wrap = $('#board-wrap');
  wrap.style.cursor = !it || it.type === 'none' ? 'default' : it.type === 'move' ? 'pointer' : it.type === 'shoot' ? 'crosshair' : 'not-allowed';
  let bad = false;
  if (it && it.type === 'move') {
    G.hoverSq = { i: it.y * 8 + it.x, cls: 'hover-move' };
    showGhost(it.x, it.y);
  } else if (it && it.type === 'blocked') {
    G.hoverSq = { i: it.y * 8 + it.x, cls: 'blocked' };
    warn('Attacked square — your king can\'t stand here', 'info');
  } else if (it && it.type === 'noammo') {
    warn('Chamber empty — move to reload', 'info');
  } else if (it && it.type === 'shoot') {
    bad = drawAim(it.angle);
  }
  renderSquares();
  if (G.opts.predict && !bad && it && (it.type === 'move' || it.type === 'shoot')) drawPrediction(it);
}

function showGhost(x, y) {
  if (!G.ghost) {
    G.ghost = document.createElement('div');
    G.ghost.className = 'pc ghost';
    G.ghost.style.transition = 'none';
    G.ghost.innerHTML = `<img src="${pieceImg('K', false)}" alt="">`;
    $('#pieces').appendChild(G.ghost);
  }
  G.ghost.style.display = '';
  placeEl(G.ghost, x, y);
}

const svgNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(svgNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent.appendChild(e);
  return e;
}

// Draws the cone + exact pellet paths + damage tags. Returns true if the shot is illegal.
function drawAim(angle) {
  const s = G.state, st = s.stats, g = $('#g-aim');
  const ox = s.king.x + 0.5, oy = s.king.y + 0.5, half = st.spread / 2 * DEG;
  const tr = traceShot(s, angle);
  const test = playerAct(s, { type: 'shoot', angle });
  const bad = !test.ok;
  const pts = [`${ox},${oy}`];
  for (let k = 0; k <= 14; k++) {
    const a = angle - half + 2 * half * k / 14;
    pts.push(`${ox + Math.cos(a) * st.range},${oy + Math.sin(a) * st.range}`);
  }
  svgEl('polygon', { points: pts.join(' '), class: 'cone' + (bad ? ' bad' : '') }, g);
  for (const p of tr.pellets) svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, class: 'pellet' + (p.hit ? ' hit' : '') }, g);
  for (const [id, d] of tr.dmg) {
    const el = pieceEls.get(id), p = s.pieces.find(q => q.id === id);
    if (!el || !p) continue;
    const tag = el.querySelector('.dmgp');
    const kill = d >= p.hp;
    tag.textContent = kill ? `☠ ${d}` : `−${d}`;
    tag.className = 'dmgp show' + (kill ? ' kill' : '');
  }
  if (bad) warn('⚠ ' + esc(test.reason));
  else if (test.state.status === 'won') warn('✓ This shot wins the level!', 'info');
  else if (test.state.status === 'lost') warn('⚠ Your last shell — this ends the level', 'info');
  else if (!tr.dmg.size) warn('This shot hits nothing', 'info');
  return bad;
}

function drawPrediction(it) {
  const r = playerAct(G.state, it);
  if (!r.ok || r.state.status !== 'play') return;
  const e = enemyPhase(r.state);
  const g = $('#g-arrows');
  for (const ev of e.events) {
    if (ev.type === 'move') {
      const x1 = ev.from.x + 0.5, y1 = ev.from.y + 0.5, x2 = ev.to.x + 0.5, y2 = ev.to.y + 0.5;
      const len = Math.hypot(x2 - x1, y2 - y1), sh = 0.28 / len;
      svgEl('line', { x1, y1, x2: x2 - (x2 - x1) * sh, y2: y2 - (y2 - y1) * sh, class: 'arrow', 'marker-end': 'url(#ah)' }, g);
    } else if (ev.type === 'spawn') {
      svgEl('circle', { cx: ev.x + 0.5, cy: ev.y + 0.5, r: 0.38, class: 'arrow' }, g);
    }
  }
  if (e.state.status === 'lost') warn('☠ Predicted: checkmate — this loses');
  else if (e.state.check) warn('Predicted: White puts you in check', 'info');
}

// ---------- actions ----------

async function doAction(it) {
  if (!it || !canAct() || it.type === 'none') return;
  if (it.type === 'blocked') { SFX.error(); toast('That square is attacked — your king would be captured.', true); return; }
  if (it.type === 'noammo') { SFX.error(); toast('Chamber empty — move to reload a shell.', true); return; }
  const res = playerAct(G.state, it);
  if (!res.ok) { SFX.error(); toast(res.reason, true); return; }

  G.busy = true;
  G.history.push(G.state);
  G.soulArmed = -1;
  G.pendingTouch = null;
  clearPreview();
  G.state = res.state;
  G.lastEnemy = [];
  G.spawned = new Set();
  render();
  await playEvents(res.events);

  if (G.state.status !== 'play') {
    await sleep(350);
    G.busy = false;
    render();
    return G.state.status === 'won' ? onWin() : onLose();
  }

  await sleep(200);
  const er = enemyPhase(G.state);
  G.state = er.state;
  G.lastEnemy = er.events.filter(e => e.type === 'move');
  G.spawned = new Set(er.events.filter(e => e.type === 'spawn').map(e => e.id));
  render();
  await playEvents(er.events);
  G.busy = false;
  render();
  queueHover();
  if (G.state.status === 'won') return onWin();
  if (G.state.status === 'lost') return onLose();
  if (G.state.check) SFX.check();
}

function floatAt(x, y, text, cls) {
  const f = document.createElement('div');
  f.className = 'float' + (cls ? ' ' + cls : '');
  f.textContent = text;
  f.style.left = ((x + 0.5) / 8 * 100) + '%';
  f.style.top = ((y + 0.35) / 8 * 100) + '%';
  $('#floats').appendChild(f);
  setTimeout(() => f.remove(), 1000);
}

function shake() {
  const w = $('#board-wrap');
  w.classList.remove('shake');
  void w.offsetWidth;
  w.classList.add('shake');
}

function drawTracers(ev) {
  const g = $('#g-tracers');
  const made = [];
  for (const p of ev.pellets) made.push(svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, class: 'tracer' }, g));
  made.push(svgEl('circle', { cx: ev.pellets[0].x1, cy: ev.pellets[0].y1, r: 0.42, class: 'flash' }, g));
  setTimeout(() => made.forEach(m => m.remove()), 420);
}

async function playEvents(events) {
  let moved = false;
  const s = G.state;
  for (const ev of events) {
    if (ev.type === 'kmove') {
      SFX.move();
      if (ev.reload) { setTimeout(SFX.reload, 120); floatAt(ev.to.x, ev.to.y, `+${ev.reload} shell${ev.reload > 1 ? 's' : ''}`); }
      if (ev.soul) floatAt(ev.to.x, ev.to.y - 0.4, `${PIECES[ev.soul].name} soul!`, 'soul');
    } else if (ev.type === 'shot') {
      SFX.boom();
      drawTracers(ev);
      shake();
      for (const h of ev.hits) {
        const el = pieceEls.get(h.id);
        if (el && !h.killed) { el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
        floatAt(h.x, h.y, h.killed ? '☠' : `−${h.dmg}`);
        if (h.killed) setTimeout(SFX.capture, 90);
        if (h.soul) setTimeout(() => floatAt(h.x, h.y - 0.4, `+${PIECES[h.type].name} soul`, 'soul'), 250);
        if (h.killed && h.type === 'K') floatAt(h.x, h.y - 0.6, 'REGICIDE!', 'big');
      }
    } else if (ev.type === 'move') {
      moved = true;
      if (ev.promo) floatAt(ev.to.x, ev.to.y, '♛ Promoted!', 'big');
    } else if (ev.type === 'spawn') {
      floatAt(ev.x, ev.y, 'Reinforcement!');
    } else if (ev.type === 'smite') {
      SFX.notify();
      shake();
      for (const h of ev.hits) floatAt(h.x, h.y, '⚡');
      floatAt(s.king.x, s.king.y - 0.5, 'Divine Shield!', 'big');
    } else if (ev.type === 'pass') {
      floatAt(s.king.x, s.king.y, 'Wait…');
    }
  }
  if (moved) SFX.move();
  await sleep(events.some(e => e.type === 'shot') ? 380 : 260);
}

function armSoul(i) {
  if (!canAct() || !G.state.souls[i]) return;
  G.soulArmed = G.soulArmed === i ? -1 : i;
  if (G.soulArmed >= 0 && !soulMoves(G.state, G.state.souls[i]).length) {
    toast(`No safe square for the ${PIECES[G.state.souls[i]].name} soul right now.`, true);
    G.soulArmed = -1;
  }
  render();
  queueHover();
}

function takeback() {
  if (G.busy || !G.history.length) return;
  closeModal();
  G.state = G.history.pop();
  G.takebacks++;
  G.lastEnemy = [];
  G.soulArmed = -1;
  render();
  queueHover();
  SFX.move();
}

function toggleOpt(k) {
  G.opts[k] = !G.opts[k];
  saveStore();
  render();
  queueHover();
}

// ---------- levels, runs, modals ----------

function startLevel(idx) {
  G.levelIdx = idx;
  G.state = buildLevel(LEVELS[idx], G.mode === 'run' ? G.run : null);
  G.history = [];
  G.takebacks = 0;
  G.soulArmed = -1;
  G.lastEnemy = [];
  G.spawned = new Set();
  G.busy = false;
  resetPieceLayer();
  clearPreview();
  closeModal();
  showScreen(null);
  document.querySelectorAll('.run-only').forEach(e => e.classList.toggle('hidden', G.mode !== 'run'));
  render();
  queueHover();
  if (!G.progress.seenHelp) { G.progress.seenHelp = true; saveStore(); openHelp(); }
}

function startRun() {
  G.mode = 'run';
  G.run = { black: [], white: [], rerolls: 1, offers: null };
  startLevel(0);
}

function playSingle(idx) {
  G.mode = 'single';
  G.run = null;
  startLevel(idx);
}

function starsHtml(n) {
  return [1, 2, 3].map(i => `<span class="${i <= n ? '' : 'off'}">★</span>`).join('');
}

function onWin() {
  SFX.notify();
  const s = G.state, lv = LEVELS[G.levelIdx];
  const underPar = s.turn <= lv.par;
  const stars = 1 + (underPar ? 1 : 0) + (underPar && G.takebacks === 0 && !s.usedShield ? 1 : 0);
  if (stars > (G.progress.stars[lv.id] || 0)) G.progress.stars[lv.id] = stars;
  G.progress.unlocked = Math.max(G.progress.unlocked, Math.min(LEVELS.length, G.levelIdx + 2));
  saveStore();
  const last = G.levelIdx === LEVELS.length - 1;
  let buttons;
  if (G.mode === 'run') {
    buttons = last
      ? '<button class="btn-green" data-act="runDone">Finish the run ▶</button>'
      : '<button class="btn-green" data-act="draft">Choose your cards ▶</button>';
  } else {
    buttons = (last ? '' : '<button class="btn-green" data-act="next">Next level ▶</button>') +
      '<button class="btn-dark" data-act="retry">Replay</button><button class="btn-dark" data-act="levels">Levels</button>';
  }
  openModal(`
    <h2>${s.kingDead ? 'Regicide!' : 'Board cleared!'}</h2>
    <p class="lead">${esc(lv.name)}</p>
    <div class="big-stars">${starsHtml(stars)}</div>
    <div class="result-stats">
      <div><span>Turns</span><b>${s.turn}</b> / ${lv.par}</div>
      <div><span>Shells fired</span><b>${s.shots}</b></div>
      <div><span>Takebacks</span><b>${G.takebacks}</b></div>
    </div>
    <div class="star-rules">★ clear · ★★ within par · ★★★ within par with no takebacks and no shield used</div>
    <div class="row">${buttons}</div>`, false);
}

function onLose() {
  SFX.error();
  const s = G.state;
  const checkmate = s.lostReason === 'Checkmate';
  openModal(`
    <h2>${checkmate ? 'Checkmate' : 'Out of shells'}</h2>
    <p class="lead">${checkmate
      ? 'The White Army trapped your king — every square was covered and no shot could save you.'
      : 'Your last shell is spent and the White Army still stands.'}</p>
    <div class="row">
      ${G.history.length ? '<button class="btn-green" data-act="takeback">↶ Take back last move</button>' : ''}
      <button class="btn-dark" data-act="retry">⟲ Retry level</button>
      ${G.mode === 'run' ? '<button class="btn-dark" data-act="home">Abandon run</button>' : '<button class="btn-dark" data-act="levels">Levels</button>'}
    </div>`, false);
}

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function makeOffers() {
  const b = shuffle(BLACK_CARDS.filter(c => !G.run.black.includes(c.id)));
  const w = shuffle(WHITE_CARDS.filter(c => !G.run.white.includes(c.id)));
  return [0, 1].map(i => ({ b: b[i], w: w[i] })).filter(o => o.b && o.w);
}

function cardHtml(c, side) {
  return `<div class="card ${side}"><div class="tag">${side === 'b' ? 'For you' : 'For White'}</div><div class="ttl">${c.icon} ${esc(c.name)}</div><div class="txt">${esc(c.text)}</div></div>`;
}

function openDraft() {
  if (!G.run.offers) G.run.offers = makeOffers();
  const offers = G.run.offers;
  if (!offers.length) return startLevel(G.levelIdx + 1);
  openModal(`
    <h2>Choose your deal</h2>
    <p class="lead">Each deal gives you a black card — and the White Army a white card. Both last for the rest of the run.</p>
    <div class="offers">${offers.map((o, i) => `<button class="offer" data-act="pick" data-i="${i}">${cardHtml(o.b, 'b')}${cardHtml(o.w, 'w')}</button>`).join('')}</div>
    <div class="row"><button class="btn-dark" data-act="reroll" ${G.run.rerolls ? '' : 'disabled'}>🎲 Reroll (${G.run.rerolls} left)</button></div>`, false);
}

function runDone() {
  const cards = G.run.black.map(id => BLACK_CARDS.find(c => c.id === id)).map(c => cardHtml(c, 'b')).join('') +
    G.run.white.map(id => WHITE_CARDS.find(c => c.id === id)).map(c => cardHtml(c, 'w')).join('');
  openModal(`
    <h2>Run complete! 👑</h2>
    <p class="lead">The White King is dead. Long live the Black King.</p>
    <div class="offers">${cards}</div>
    <div class="row"><button class="btn-green" data-act="newRun">New run</button><button class="btn-dark" data-act="home">Home</button></div>`, false);
}

function openHelp() {
  openModal(`
    <div class="help">
      <h2>How to play</h2>
      <p class="lead">You are the Black King. You carry a shotgun. That's your only way to capture.</p>
      <h3>Your turn</h3>
      <ul>
        <li><b>Move</b> one square (click a grey dot). Moving reloads a shell from your reserve.</li>
        <li><b>or Fire</b>: point anywhere and click. Pellets fan out evenly across the cone — the preview shows the <b>exact</b> damage each piece takes. Point-blank = every pellet hits.</li>
        <li>You can never stand on an attacked square, and you can't fire a shot that would leave your king in check (for example by killing a pawn that was blocking a bishop).</li>
      </ul>
      <h3>The White Army</h3>
      <ul>
        <li>Pieces move like chess pieces, but slowly: the badge shows how many turns until each one moves. A <b style="color:var(--red)">red, shaking</b> piece moves right after your action.</li>
        <li>White pawns march <b>down</b> the board and promote to queens on your back rank.</li>
        <li>If White checks you, you get one turn to escape. No escape = <b>checkmate</b>.</li>
        <li>A <b>Divine Shield</b> saves you from one checkmate by smiting the attackers.</li>
      </ul>
      <h3>Souls & cards</h3>
      <ul>
        <li>Killing a knight, bishop, rook or queen drops its <b>soul</b>. Use it to move once like that piece.</li>
        <li>In a <b>Run</b>, every win lets you draft a deal: a buff for you and a buff for White.</li>
      </ul>
      <h3>Controls</h3>
      <ul>
        <li><kbd>Shift</kbd> or <kbd>Right-click</kbd> force a shot (even toward a square next to you) · <kbd>F</kbd> aim lock</li>
        <li><kbd>Z</kbd> takeback · <kbd>R</kbd> restart · <kbd>V</kbd> danger squares · <kbd>P</kbd> predict replies · <kbd>1</kbd>–<kbd>3</kbd> souls · <kbd>Space</kbd> act at cursor</li>
        <li>Touch: tap once to preview, tap again to confirm.</li>
      </ul>
      <div class="row"><button class="btn-green" data-act="close">Let's play</button></div>
    </div>`, true);
}

function openModal(html, dismissable) {
  $('#modal-body').innerHTML = html;
  $('#modal').classList.remove('hidden');
  G.modalDismissable = dismissable;
  clearPreview();
}
function closeModal() {
  $('#modal').classList.add('hidden');
}

const ACTIONS = {
  close: () => { closeModal(); render(); },
  next: () => playSingle(G.levelIdx + 1),
  retry: () => startLevel(G.levelIdx),
  levels: () => { closeModal(); showScreen('levels'); },
  home: () => { closeModal(); showScreen('home'); },
  takeback: () => takeback(),
  draft: () => openDraft(),
  pick: d => {
    const o = G.run.offers[+d.i];
    G.run.black.push(o.b.id);
    G.run.white.push(o.w.id);
    G.run.offers = null;
    startLevel(G.levelIdx + 1);
  },
  reroll: () => {
    if (!G.run.rerolls) return;
    G.run.rerolls--;
    G.run.offers = null;
    openDraft();
  },
  runDone: () => runDone(),
  newRun: () => startRun(),
};

function showScreen(name) {
  $('#screen-home').classList.toggle('hidden', name !== 'home');
  $('#screen-levels').classList.toggle('hidden', name !== 'levels');
  if (name === 'levels') renderLevels();
  if (name) clearPreview();
}

function miniSquares(board) {
  let h = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const ch = board[y][x];
      const img = ch === '@' ? pieceImg('K', false) : PIECES[ch] ? pieceImg(ch, true) : null;
      h += `<div class="${(x + y) % 2 ? 'd' : 'l'}">${img ? `<img src="${img}" alt="">` : ''}</div>`;
    }
  }
  return h;
}

function renderLevels() {
  const grid = $('#level-grid');
  let total = 0;
  grid.innerHTML = '';
  LEVELS.forEach((lv, i) => {
    const stars = G.progress.stars[lv.id] || 0;
    total += stars;
    const locked = i + 1 > G.progress.unlocked;
    const b = document.createElement('button');
    b.className = 'lvl' + (locked ? ' locked' : '');
    b.innerHTML = `<div class="mini">${miniSquares(lv.board)}</div>
      <div class="meta"><span class="nm">${locked ? '🔒 ' : ''}${esc(lv.name)}</span><span class="num">#${lv.id}</span></div>
      <div class="obj">${lv.objective === 'king' ? 'Kill the King' : 'Clear the board'}${lv.reinforce ? ' · reinforcements' : ''} · par ${lv.par}</div>
      <div class="stars">${starsHtml(stars)}</div>`;
    b.onclick = () => { if (locked) toast('Beat the previous level to unlock this one.', true); else playSingle(i); };
    grid.appendChild(b);
  });
  $('#star-total').textContent = `★ ${total} / ${LEVELS.length * 3}`;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'show' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = ''; }, 1900);
}

// ---------- input ----------

function bindInput() {
  const wrap = $('#board-wrap');
  wrap.addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    G.pointer = boardPoint(e);
    queueHover();
  });
  wrap.addEventListener('pointerleave', e => {
    if (e.pointerType !== 'mouse') return;
    G.pointer = null;
    queueHover();
  });
  wrap.addEventListener('contextmenu', e => e.preventDefault());
  wrap.addEventListener('pointerdown', e => {
    SFX.unlock();
    if (!canAct()) return;
    G.pointer = boardPoint(e);
    if (e.pointerType !== 'mouse') {
      // Touch: first tap previews, second tap on the same spot confirms.
      const p = G.pendingTouch;
      if (p && Math.hypot(p.fx - G.pointer.fx, p.fy - G.pointer.fy) < 0.5) {
        G.pendingTouch = null;
        doAction(computeIntent(false));
      } else {
        G.pendingTouch = G.pointer;
        updateHover();
        if (G.intent && G.intent.type !== 'none') toast('Tap again to confirm');
      }
      return;
    }
    doAction(computeIntent(e.button === 2));
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Shift') { if (!G.shift) { G.shift = true; queueHover(); } return; }
    if (modalOpen()) {
      if (e.key === 'Escape' && G.modalDismissable) closeModal();
      return;
    }
    if (screenOpen() || !G.state) return;
    const k = e.key.toLowerCase();
    if (k === 'z' || k === 'backspace') { e.preventDefault(); takeback(); }
    else if (k === 'r') startLevel(G.levelIdx);
    else if (k === 'v') toggleOpt('danger');
    else if (k === 'p') toggleOpt('predict');
    else if (k === 'f') toggleOpt('aim');
    else if (k === '1' || k === '2' || k === '3') armSoul(+k - 1);
    else if (k === ' ') { e.preventDefault(); doAction(G.intent); }
    else if (k === 'escape') { G.soulArmed = -1; render(); queueHover(); }
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Shift') { G.shift = false; queueHover(); }
  });
  window.addEventListener('blur', () => { G.shift = false; });

  $('#btn-undo').onclick = takeback;
  $('#btn-restart').onclick = () => { if (G.state && !G.busy) { startLevel(G.levelIdx); toast('Level restarted'); } };
  $('#btn-danger').onclick = () => toggleOpt('danger');
  $('#btn-predict').onclick = () => toggleOpt('predict');
  $('#btn-aim').onclick = () => toggleOpt('aim');
  $('#btn-wait').onclick = () => {
    if (G.state && !G.state.canAct) doAction({ type: 'wait' });
  };

  $('#modal-body').addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (b && !b.disabled) ACTIONS[b.dataset.act](b.dataset);
  });
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal' && G.modalDismissable) closeModal(); });

  $('#nav-home').onclick = () => { closeModal(); showScreen('home'); };
  $('#nav-levels').onclick = () => { closeModal(); showScreen('levels'); };
  $('#nav-help').onclick = openHelp;
  $('#nav-sound').onclick = () => {
    G.opts.sound = !G.opts.sound;
    SFX.enabled = G.opts.sound;
    $('#nav-sound').textContent = G.opts.sound ? '🔊' : '🔇';
    saveStore();
  };
  $('#nav-sound').textContent = G.opts.sound ? '🔊' : '🔇';
  $('#home-run').onclick = () => { SFX.unlock(); startRun(); };
  $('#home-levels').onclick = () => showScreen('levels');
  $('#home-help').onclick = openHelp;
  $('#levels-back').onclick = () => showScreen('home');
}

// ---------- boot ----------

buildBoardDom();
$('#home-art').innerHTML = miniSquares(LEVELS[LEVELS.length - 1].board);
bindInput();
showScreen('home');
