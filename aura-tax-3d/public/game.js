import { createBoard, createMotes, DICE_STYLE_IDS, diceStyleName, dicePreview } from './board3d.js';
import { createAttract } from './attract.js';
import { pixelLogo } from './pixel-logo.js';
import { CHAMPIONS, championCanvas, championPortrait, createZoomView, setChampionFocus } from './champions.js';

const socket = io();
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const wait = ms => new Promise(r => setTimeout(r, ms));

const STEP_MS = 230;
const FOLLOW_MS = 2500; // how long the camera stays on a rider after they land
const TARGETS = [100, 150, 200, 300];
const ROUNDS = [6, 10, 14, 20];
// Material Symbols names, one per card kind.
const KINDS = {
  move: { icon: 'directions_run', label: 'Move' },
  steal: { icon: 'bolt', label: 'Steal' },
  react: { icon: 'shield', label: 'Reaction' },
  social: { icon: 'groups', label: 'Social' },
  legend: { icon: 'star', label: 'Legendary' },
  boost: { icon: 'trending_up', label: 'Boost' },
};
// Sticker reactions. Each one's optional GIF lives in sounds/stickers/<id>/ (see stickerFiles).
const STICKERS = {
  sleep: { icon: 'bedtime', label: 'Zzz', c: 'var(--muted)' },
  lel: { icon: 'sentiment_satisfied', label: 'lel', c: 'var(--cyan)' },
  zulul: { icon: 'sentiment_excited', label: 'ZULUL', c: 'var(--orange)' },
  c9: { icon: 'sports_esports', label: 'c9 LOL', c: 'var(--blue)' },
  gulp: { icon: 'water_drop', label: '*gulp*', c: 'var(--blue)' },
  haha: { icon: 'mood', label: 'HAHAHAHAHAH', c: 'var(--accent)' },
  ez: { icon: 'check_circle', label: 'ez', c: 'var(--good)' },
  pants: { icon: 'search', label: '*stares at pants*', c: 'var(--purple)' },
};
const STICKER_MS = 2600;
const STICKER_GIF_MS = 5500; // stickers with a GIF stay up longer so it can play through
const BANNER_MS = 4500;
const CARD_POP_MS = 3800;

let S = null; // latest server state
let myId = null;
let boardBuilt = false;
let board3d = null;
let overDismissed = false;
let selecting = null; // desktop: uid of the card I'm about to play (its targets show in the dock)
let picking = false; // pressed Play card: the playable cards bob
let lastAct = null; // { kind, at }: what I just asked the server to do, so the dock can say "Rolling..."
const displayPos = {};
const animating = {};

// Layouts (see the GAME SCREEN notes in style.css)
const desktop = matchMedia('(min-width: 1001px)');
const sideways = matchMedia('(max-width: 1000px) and (max-height: 520px) and (orientation: landscape)');
const hoverable = matchMedia('(hover: hover)');
// Phones and tablets: tap a card to see it big in a sheet, with its buttons. A mouse hovers to read and clicks to pick.
const tapCards = () => !desktop.matches || !hoverable.matches;

// ---------------------------------------------------------------------------
// Storage (wrapped: private mode can throw)
// ---------------------------------------------------------------------------
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
let token = store.get('auraTax.token');
if (!token) {
  token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  store.set('auraTax.token', token);
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
// replaceChildren() would print null as the word "null": drop empty slots first, like h() does.
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));
const ms = name => h('span', { class: 'ms', 'aria-hidden': 'true' }, name);
const initial = name => (name || '?').trim().charAt(0) || '?';
// A player's picture: their champion's portrait in their colour, or their initial if they have none.
const avatar = p => (p.champion
  ? h('div', { class: 'avatar pic', style: `--c:${p.color}` }, h('img', { src: championPortrait(p.champion, p.color), alt: '', 'data-pk': `${p.champion}|${p.color}` }))
  : h('div', { class: 'avatar', style: `--c:${p.color}` }, initial(p.name)));
const player = id => S && S.players.find(p => p.id === id);
const spectating = () => !!S && S.spectators.some(s => s.id === myId);
const hand = () => (S && S.me ? S.me.hand : []);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Restart a CSS animation class on an element
function replay(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), ms);
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  attract.setScreen(name);
  if (name !== 'game') { closeMenu(); closeSheet(); setExpanded(false); }
  measureHud();
}

// A yes/no question in our own dialog (the browser's confirm() looks out of place, and is clumsy on phones).
function ask({ title, text = '', yes = 'OK', no = 'Cancel', icon = 'help', danger = false }) {
  const box = $('#confirm');
  return new Promise(resolve => {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-icon').replaceChildren(ms(icon));
    const yesBtn = $('#confirm-yes');
    const noBtn = $('#confirm-no');
    yesBtn.textContent = yes;
    noBtn.textContent = no;
    yesBtn.className = `btn ${danger ? 'danger' : 'primary'}`;
    box.classList.toggle('danger', danger);
    box.classList.remove('hidden');
    const done = v => {
      box.classList.add('hidden');
      box.removeEventListener('click', onBg);
      document.removeEventListener('keydown', onKey, true);
      yesBtn.onclick = noBtn.onclick = null;
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };
    const onBg = e => { if (e.target === box) done(false); };
    yesBtn.onclick = () => done(true);
    noBtn.onclick = () => done(false);
    box.addEventListener('click', onBg);
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => yesBtn.focus(), 40);
  });
}

// ---------------------------------------------------------------------------
// Home / lobby actions
// ---------------------------------------------------------------------------
const nameInput = $('#name');
nameInput.value = store.get('auraTax.name') || '';

function myName() {
  const n = nameInput.value.trim();
  store.set('auraTax.name', n);
  return n;
}

function enterRoom(res) {
  if (!res || !res.ok) {
    $('#home-err').textContent = (res && res.error) || 'Something went wrong.';
    store.del('auraTax.joined');
    return;
  }
  $('#home-err').textContent = '';
  myId = res.playerId;
  store.set('auraTax.joined', '1');
}

let joining = false;
function enter() {
  if (joining) return;
  if (!nameInput.value.trim()) {
    nameInput.focus();
    $('#home-err').textContent = 'Pick a name first.';
    replay($('#home-form'), 'shake');
    return;
  }
  joining = true;
  const btn = $('#btn-enter');
  const label = btn.querySelector('.btn-label');
  btn.classList.add('loading');
  // The free server sleeps when nobody's around: say so if it takes a moment to answer.
  const slow = setTimeout(() => { label.textContent = 'Waking up the server'; }, 1500);
  socket.emit('join', { name: myName(), token }, res => {
    joining = false;
    clearTimeout(slow);
    btn.classList.remove('loading');
    label.textContent = 'Join';
    enterRoom(res);
  });
}
$('#home-form').addEventListener('submit', e => { e.preventDefault(); nameInput.blur(); enter(); });

function leave() {
  socket.emit('leave');
  store.del('auraTax.joined');
  S = null;
  myId = null;
  resetHand();
  keepAwake(false);
  $('#over').classList.add('hidden');
  $('#react-bar').classList.add('hidden');
  showScreen('home');
}
$('#btn-leave-lobby').addEventListener('click', leave);
$('#btn-leave-over').addEventListener('click', leave);

async function confirmEndGame() {
  closeMenu();
  const ok = await ask({ title: 'End the game?', text: 'It ends for everyone, and whoever has the most aura right now wins.', yes: 'End game', icon: 'flag', danger: true });
  if (ok) socket.emit('endgame');
}
async function confirmLeave() {
  closeMenu();
  const watching = spectating() || (player(myId) && player(myId).out);
  const ok = await ask(watching
    ? { title: 'Stop watching?', text: 'You can come back any time.', yes: 'Leave', icon: 'logout' }
    : { title: 'Leave the game?', text: 'Your camel goes on autopilot. Open the site again in this browser to take back over.', yes: 'Leave', icon: 'logout', danger: true });
  if (ok) leave();
}
$('#btn-end-game').addEventListener('click', confirmEndGame);
$('#m-end-game').addEventListener('click', confirmEndGame);
$('#btn-leave-game').addEventListener('click', confirmLeave);
$('#m-leave-game').addEventListener('click', confirmLeave);

$('#btn-start').addEventListener('click', () => socket.emit('start'));
$('#btn-roll').addEventListener('click', roll);
$('#btn-end').addEventListener('click', endTurn);
$('#btn-play').addEventListener('click', pickCard);
$('#btn-again').addEventListener('click', () => socket.emit('lobby'));
$$('.deck-btn').forEach(d => d.addEventListener('click', () => drawFrom(d.dataset.deck)));
$('#btn-view-board').addEventListener('click', () => { overDismissed = true; $('#over').classList.add('hidden'); renderGame(); });

function roll() {
  if (!S || !canAct() || S.rolled) return;
  $('#btn-roll').disabled = true;
  lastAct = { kind: 'roll', at: Date.now() };
  socket.emit('roll');
}
function endTurn() {
  if (!S || !myTurn() || blocked()) return;
  selecting = null;
  picking = false;
  closeSheet();
  $('#btn-end').disabled = true;
  lastAct = { kind: 'end', at: Date.now() };
  socket.emit('end');
}
function drawFrom(deck) {
  const next = owed()[0];
  if (!S || !myTurn() || !next || (next !== 'any' && next !== deck)) return;
  socket.emit('draw', deck);
}
// "Play card": on phones, open the first card you can play; with a mouse, make the playable cards bob.
function pickCard() {
  if (!canPlayCard()) return;
  if (tapCards()) {
    const first = hand().find(c => c.playable);
    if (first) openSheet(first.uid);
    return;
  }
  picking = !picking;
  renderGame();
}

for (const [sel, list, key] of [['#set-target', TARGETS, 'target'], ['#set-rounds', ROUNDS, 'rounds']]) {
  const el = $(sel);
  list.forEach(v => el.append(h('option', { value: v }, key === 'target' ? `${v} aura` : `${v} rounds`)));
  el.addEventListener('change', () => socket.emit('settings', {
    target: $('#set-target').value, rounds: $('#set-rounds').value,
  }));
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (sheet.uid) { closeSheet(); renderGame(); return; }
    if ($('#screen-game').classList.contains('menu-open')) { closeMenu(); return; }
    if ($('#players-panel').classList.contains('expanded')) { setExpanded(false); return; }
    if (selecting || picking) { selecting = null; picking = false; if (S) renderGame(); }
    return;
  }
  const typing = e.target.closest && e.target.closest('input, textarea, select');
  if ((e.key === ' ' || e.key === 'Enter') && !typing && (document.activeElement === document.body || document.activeElement === $('#stage canvas'))
    && $('#screen-game').classList.contains('active') && S && canAct() && !S.rolled) {
    e.preventDefault();
    roll();
  }
});

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------
let netTimer = 0;
function showNet(on) {
  let el = $('#net');
  if (on && !el && store.get('auraTax.joined')) {
    el = h('div', { id: 'net', class: 'net', role: 'status' }, 'Reconnecting');
    document.body.append(el);
  } else if (!on && el) el.remove();
}
socket.on('disconnect', () => {
  clearTimeout(netTimer);
  netTimer = setTimeout(() => showNet(true), 900); // a quick blip isn't worth a warning
});
socket.on('connect', () => {
  clearTimeout(netTimer);
  showNet(false);
  if (store.get('auraTax.joined')) {
    socket.emit('join', { name: myName(), token }, res => {
      if (res && res.ok) enterRoom(res);
      else { store.del('auraTax.joined'); showScreen('home'); }
    });
  }
  // The debug button only shows on the machine running the server (the ` key works everywhere).
  if (!debug.checked) {
    debug.checked = true;
    socket.emit('debug:info', info => {
      debug.info = info;
      if (info && info.allowed) document.body.append(debugFab());
    });
  }
});

socket.on('state', s => {
  const prev = S;
  S = s;
  syncMusic();
  if (!myId || (!player(myId) && !spectating())) return;
  if (s.phase === 'lobby') {
    overDismissed = false;
    selecting = null;
    picking = false;
    resetHand();
    keepAwake(false);
    $('#over').classList.add('hidden');
    $('#react-bar').classList.add('hidden');
    showScreen('lobby');
    renderLobby();
    notifyTitle();
    return;
  }
  if (!boardBuilt) buildBoard();
  if (s.phase === 'play' && (!prev || prev.phase !== 'play')) {
    for (const k of Object.keys(displayPos)) delete displayPos[k];
    overDismissed = false;
    resetHand();
  }
  closeZoom();
  if (!$('#screen-game').classList.contains('active')) showScreen('game');
  keepAwake(s.phase === 'play');
  renderGame();
  const meNow = player(myId);
  const meBefore = prev && prev.players.find(p => p.id === myId);
  if (s.phase === 'play' && meNow && meNow.out && meBefore && !meBefore.out) {
    showBanner({ title: "You're out", sub: 'Your aura went negative. You can keep watching the game.', kind: 'bad', pid: myId });
    sfxUi('out');
  }
  if (s.phase === 'play' && s.currentId === myId && prev && (prev.currentId !== myId || prev.phase !== 'play')) yourTurn();
  if (s.currentId !== (prev && prev.currentId)) scrollStripTo(s.currentId);
  if (s.phase === 'over' && prev && prev.phase === 'play') sfxUi(s.winnerId === myId ? 'win' : 'over');
  notifyTitle();
});

socket.on('fx', f => {
  if (f.type === 'toast') { toast(f.text, 3600); return; }
  if (!S || !boardBuilt) return;
  switch (f.type) {
    case 'dice': rollDie(f.value, f.value2, (player(f.pid) || {}).dice); break;
    case 'move': animateMove(f.pid, f.path); break;
    case 'teleport': teleportToken(f.pid, f.to); break;
    case 'float':
      floatText(f.pid, f.text, f.good);
      if (f.pid === myId && /^[+-]?\d+$/.test(f.text)) sfxUi(f.good ? 'gain' : 'loss');
      break;
    case 'banner': showBanner(f); break;
    case 'tbag': tbagFx(f.thief, f.victim); break;
    case 'card': showCard(f); break;
    case 'duel': duelFx(f); break;
    case 'confetti': confetti(); break;
    case 'sticker': showSticker(f.pid, f.id, f.gif); break;
  }
});

// ---------------------------------------------------------------------------
// Lobby render
// ---------------------------------------------------------------------------
function renderLobby() {
  if (zoom.id && !S.champions.includes(zoom.id)) closeZoom();
  attract.setCast(S.players);
  const me = player(myId);
  $('#lobby-count').textContent = `${S.players.length}/8`;

  const list = $('#lobby-players');
  list.replaceChildren();
  S.players.forEach(p => list.append(h('li', { class: [p.bot ? 'bot' : '', p.id === myId ? 'me' : ''].join(' ').trim() || null },
    avatar(p),
    h('span', { class: 'nm' }, p.name),
    p.id === myId ? h('span', { class: 'tag tag-you' }, 'you') : null,
    p.bot ? h('span', { class: 'tag' }, 'bot') : null,
    p.bot && me ? h('button', { class: 'icon-btn bot-x', type: 'button', title: 'Remove bot', 'aria-label': `Remove ${p.name}`, onclick: () => socket.emit('removeBot', p.id) }, ms('close')) : null,
  )));
  const full = S.players.length >= 8;
  for (let i = S.players.length; i < Math.max(2, Math.min(8, S.players.length + 1)); i++) {
    list.append(me && !full
      ? h('li', { class: 'empty add-bot' }, h('button', { class: 'btn ghost', type: 'button', onclick: () => socket.emit('addBot') }, ms('smart_toy'), 'Add bot'))
      : h('li', { class: 'empty' }, 'Waiting for a player'));
  }
  $('#lobby-specs').textContent = S.spectators.length
    ? `Waiting for a seat: ${S.spectators.map(s => s.name).join(', ')}`
    : '';

  const picker = $('#color-picker');
  picker.replaceChildren();
  S.colors.forEach(c => {
    const owner = S.players.find(p => p.color === c);
    picker.append(h('button', {
      class: 'swatch' + (me && me.color === c ? ' sel' : ''),
      type: 'button',
      style: `--c:${c}`,
      disabled: !me || (owner && owner.id !== myId),
      title: owner ? owner.name : 'Free',
      'aria-label': owner ? `Taken by ${owner.name}` : 'Free colour',
      onclick: () => socket.emit('color', c),
    }));
  });

  const champs = $('#champ-picker');
  const tint = me ? me.color : S.colors[0];
  const mine = me && me.champion;
  $('#champ-name').textContent = mine ? CHAMPIONS[mine].name : '';
  setChampionFocus(mine);
  champs.replaceChildren(...S.champions.map(id => h('button', {
    class: 'champ' + (mine === id ? ' sel' : '') + (CHAMPIONS[id].mythic ? ' mythic' : ''),
    type: 'button',
    disabled: !me,
    'data-id': id,
    'aria-label': CHAMPIONS[id].name,
    'aria-pressed': mine === id ? 'true' : 'false',
    onclick: e => {
      if (zoom.held) { e.preventDefault(); zoom.held = false; return; } // a press-and-hold preview doesn't pick
      socket.emit('champion', id);
    },
  }, championCanvas(id, tint))));

  // Dice styles: each rider rolls with their own
  const myDice = (me && me.dice) || 'marble';
  $('#dice-name').textContent = diceStyleName(myDice);
  $('#dice-picker').replaceChildren(...DICE_STYLE_IDS.map(id => h('button', {
    class: 'dice-opt' + (myDice === id ? ' sel' : ''), type: 'button', disabled: !me, title: diceStyleName(id),
    'aria-label': diceStyleName(id), 'aria-pressed': myDice === id ? 'true' : 'false', 'data-style': id,
    onclick: () => socket.emit('dice', id),
  }, h('img', { src: dicePreview(id), alt: '' }), h('span', null, diceStyleName(id)))));

  $('#set-target').value = S.settings.target;
  $('#set-rounds').value = S.settings.rounds;
  $('#set-target').disabled = !me;
  $('#set-rounds').disabled = !me;

  const start = $('#btn-start');
  const enough = S.players.length >= 2;
  start.classList.toggle('hidden', !me);
  start.disabled = !enough;
  start.classList.toggle('cta', enough);
  $('#start-label').textContent = enough ? `Start game · ${S.players.length} riders` : 'Need 2 riders to start';
  $('#lobby-wait').textContent = !me ? 'The lobby is full. You get the next free seat.'
    : enough ? '' : 'Add a bot, or send the link to a friend.';
}

// ---------------------------------------------------------------------------
// Board (3D, see board3d.js)
// ---------------------------------------------------------------------------

// The bot match behind the home and lobby screens. On wide screens their UI is a column on the left, so the board is
// framed in the space to its right; on a phone the home UI sits at the bottom and the board plays above it.
const attract = createAttract($('#backdrop'), {
  insets: () => {
    const none = { top: 0, right: 0, bottom: 0, left: 0 };
    const col = $('.screen.active .home, .screen.active .lobby');
    if (!col) return none;
    const r = col.getBoundingClientRect();
    if (desktop.matches) return { ...none, left: r.right };
    return col.matches('.home') ? { ...none, bottom: innerHeight - r.top } : none;
  },
  watch: [$('.home'), $('.lobby')],
});
attract.setScreen('home');
pixelLogo($('#logo'), { text: 'AURA TAX', width: () => $('.logo-wrap').clientWidth * 0.9 });

// How much of the screen the HUD covers, as CSS variables, so pop-ups, toasts and the sticker button stay clear of it.
function measureHud() {
  const rs = document.documentElement.style;
  if (!$('#screen-game').classList.contains('active')) {
    rs.setProperty('--hud-h', '0px');
    rs.setProperty('--top-h', '0px');
    return;
  }
  const hud = $('#hud-bottom').getBoundingClientRect();
  rs.setProperty('--hud-h', `${Math.max(0, Math.round(innerHeight - hud.top))}px`);
  if (!desktop.matches && !$('#players-panel').classList.contains('expanded')) {
    rs.setProperty('--top-h', `${Math.round($('#side').getBoundingClientRect().bottom)}px`);
  }
}
new ResizeObserver(measureHud).observe($('#hud-bottom'));
new ResizeObserver(measureHud).observe($('#side'));
addEventListener('resize', measureHud);

// The parts of the stage covered by HUD panels, so the camera frames the board in the free space.
let topInset = 0;
function hudInsets() {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  const stage = $('#stage').getBoundingClientRect();
  const hud = $('#hud-bottom').getBoundingClientRect();
  const side = $('#side').getBoundingClientRect();
  if (desktop.matches) {
    // Keep the same space free on both sides so the board sits in the middle of the screen.
    const sideW = stage.right - side.left;
    return { top: 0, right: sideW, bottom: stage.bottom - hud.top, left: sideW };
  }
  if (sideways.matches) return { ...none, right: stage.right - Math.min(hud.left, side.left) };
  // The expanded players list drops over the board; it doesn't move it.
  if (!$('#players-panel').classList.contains('expanded')) topInset = side.bottom - stage.top - 8;
  return { ...none, top: Math.max(0, topInset), bottom: Math.max(0, stage.bottom - hud.top - 12) };
}

// One tip for board tiles and for anything with a data-tip attribute. A mouse hovers; a finger taps (and it fades).
function showTip(t) {
  const tip = $('#tip');
  clearTimeout(showTip.t);
  if (!t) { tip.classList.add('hidden'); return; }
  tip.classList.remove('hidden');
  tip.replaceChildren(t.title ? h('b', null, t.title) : '', h('div', null, t.text));
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, t.x + 14)) + 'px';
  tip.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, t.touch ? t.y - r.height - 18 : t.y + 14)) + 'px';
  if (t.touch) showTip.t = setTimeout(() => tip.classList.add('hidden'), 2800);
}
let tipEl = null;
document.addEventListener('pointerover', e => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (el === tipEl) return;
  tipEl = el;
  if (!el) { showTip(null); return; }
  const r = el.getBoundingClientRect();
  showTip({ title: el.dataset.tipTitle, text: el.dataset.tip, x: r.left - 14, y: r.bottom - 6 });
});
document.addEventListener('click', e => {
  const el = e.target.closest && e.target.closest('[data-tip]');
  if (!el || hoverable.matches) return;
  const r = el.getBoundingClientRect();
  showTip({ title: el.dataset.tipTitle, text: el.dataset.tip, x: r.left, y: r.top, touch: true });
});

// While a rider or tile is being picked, the board shows the choices and takes clicks on them too.
let choice = { pawn: new Map(), tile: new Map() };
function applyChoices() {
  if (!board3d) return;
  board3d.setTargets([...choice.pawn.keys()]);
  board3d.setTileTargets([...choice.tile.keys()]);
}

function buildBoard() {
  board3d = createBoard($('#stage'), {
    insets: hudInsets,
    watch: [$('#hud-bottom'), $('#side')],
    onDeck: drawFrom,
    onHover: hv => { if (!tipEl) showTip(hv && { title: hv.tile.name, text: hv.tile.desc, x: hv.x, y: hv.y }); },
    onTileTap: hit => {
      const pickTile = hit && choice.tile.get(hit.index);
      if (pickTile) { pickTile(); return; }
      showTip(hit && hit.touch ? { title: hit.tile.name, text: hit.tile.desc, x: hit.x, y: hit.y, touch: true } : null);
    },
    onPawn: id => { const fn = choice.pawn.get(id); if (fn) fn(); },
    onPawnHover: id => $$('[data-pid]').forEach(b => b.classList.toggle('hot', b.dataset.pid === id)),
  });
  board3d.build(S.board);
  board3d.scene.add(createMotes()); // the gold dust from the intro, in the game too
  boardBuilt = true;
  if (debug.info && debug.info.allowed) window.auraBoard = board3d; // for poking at the camera from the console

}

function leaderId() {
  const top = S.players.filter(p => !p.out).sort((a, b) => b.aura - a.aura);
  return top.length > 1 && top[0].aura > top[1].aura ? top[0].id : null;
}

// Tax counters: one disc per owner, in their colour, on the tile.
function renderTaxDots() {
  const map = {};
  for (const [i, ids] of Object.entries(S.taxTiles || {})) map[i] = ids.map(player).filter(Boolean).map(o => o.color);
  board3d.setTax(map);
}

function renderTokens() {
  const lead = leaderId();
  board3d.setPlayers(S.players.map(p => ({
    id: p.id, color: p.color, champion: p.champion, letter: initial(p.name), lead: p.id === lead,
    current: p.id === S.currentId, faded: !p.connected || p.smurf || p.out,
  })));
  const groups = {};
  for (const p of S.players) {
    if (displayPos[p.id] == null) displayPos[p.id] = p.pos;
    if (!animating[p.id]) (groups[displayPos[p.id]] = groups[displayPos[p.id]] || []).push(p.id);
  }
  for (const [pos, list] of Object.entries(groups)) {
    list.forEach((pid, k) => board3d.place(pid, Number(pos), k, list.length));
  }
  const c = player(S.currentId);
  board3d.setLit(c && !animating[c.id] ? displayPos[c.id] : null);
}

async function animateMove(pid, path) {
  animating[pid] = true;
  board3d.setLit(null);
  board3d.follow(pid);
  for (const pos of path) {
    displayPos[pid] = pos;
    board3d.hop(pid, pos);
    await wait(STEP_MS);
  }
  animating[pid] = false;
  if (S) renderTokens();
  clearTimeout(animateMove.unfollow);
  animateMove.unfollow = setTimeout(() => {
    if (!Object.values(animating).some(Boolean)) board3d.follow(null);
  }, FOLLOW_MS);
}

function teleportToken(pid, to) {
  displayPos[pid] = to;
  board3d.poof(pid);
  renderTokens();
}

// ---------------------------------------------------------------------------
// Game render
// ---------------------------------------------------------------------------
function renderGame() {
  if (!S || S.phase === 'lobby') return;
  $('#stickers').classList.toggle('hidden', !player(myId) || S.phase !== 'play');
  tidyLocalState();
  choice = { pawn: new Map(), tile: new Map() };
  renderTokens();
  renderTaxDots();
  renderDecks();
  renderActions();
  renderHand();
  renderSheet();
  renderReaction();
  renderPlayers();
  renderMenu();
  renderOver();
  applyChoices();
  const inPlay = !!player(myId) && S.phase === 'play';
  $('#btn-end-game').classList.toggle('hidden', !inPlay);
  $('#m-end-game').classList.toggle('hidden', !inPlay);
}

const myTurn = () => !!S && S.phase === 'play' && S.currentId === myId;
const owed = () => (S.me ? S.me.draws : []);
// Holding more than the limit: you must throw cards away first.
const tooMany = () => hand().length - S.handLimit;
const blocked = () => S.busy || !!S.pending || !!S.reaction || !!S.vote;
const canAct = () => myTurn() && !owed().length && tooMany() <= 0 && !blocked() && S.actionsLeft > 0;
// Cards come after the roll: Draw -> Roll -> Play card -> End turn.
const canPlayCard = () => canAct() && S.rolled && hand().some(c => c.playable);
const tossing = () => !!S && S.phase === 'play' && !owed().length && tooMany() > 0;

// Which of the 3 steps the current rider is on (null when it isn't your turn).
function currentStep() {
  if (!myTurn()) return null;
  if (owed().length || tooMany() > 0) return 'draw';
  return S.rolled ? 'play' : 'roll';
}

// Drop a half-picked card when it's no longer possible.
function tidyLocalState() {
  if (!canPlayCard()) { selecting = null; picking = false; }
  const uids = new Set(hand().map(c => c.uid));
  if (selecting && (!uids.has(selecting) || tapCards())) selecting = null;
  if (lastAct && !S.busy && Date.now() - lastAct.at > 1200) lastAct = null;
}

// Why a card can't be played right now, in words.
function whyNot(cd) {
  if (cd.kind === 'react') return 'Reaction card: you get to play it when someone comes for you.';
  if (S.phase !== 'play') return 'The game is over.';
  if (!myTurn()) {
    const c = player(S.currentId);
    return c ? `It's ${c.name}'s turn. Play it on yours.` : 'Wait for your turn to play it.';
  }
  if (owed().length) return 'Draw your card first.';
  if (tooMany() > 0) return 'Throw a card away first.';
  if (blocked()) return 'Hang on, something is still happening.';
  if (!S.rolled) return 'Roll first, then play cards.';
  if (S.actionsLeft <= 0) return 'No moves left this turn.';
  if (!cd.playable) return `${cd.title} has no valid target right now.`;
  return '';
}

const playerLabel = p => [avatar(p), h('span', null, p.name), h('span', { class: 'opt-aura' }, p.aura)];

function optionLabel(card, v) {
  if (card.target === 'player') {
    const p = player(v);
    return p ? playerLabel(p) : ['?'];
  }
  if (card.target === 'tile') {
    const here = S.players.filter(p => !p.out && p.pos === v).map(p => p.name).join(', ');
    return [S.board[v].name, h('small', null, ` · ${here}`)];
  }
  if (card.target === 'steps') return [ms('undo'), `${v} back`];
  if (card.target === 'ahead') return [`${plural(v, 'tile')}`];
  return [String(v)];
}

// The ways to play a card: one button per target, or a single Play.
function cardChoices(card) {
  if (!card.options) return [{ label: [ms('play_arrow'), 'Play'], primary: true, value: null }];
  return card.options.map(v => ({
    label: optionLabel(card, v), value: v,
    pid: card.target === 'player' ? v : null,
    tile: card.target === 'tile' ? v : null,
  }));
}

function playCard(card, arg) {
  handFx.set(card.uid, 'play');
  lastAct = { kind: 'play', at: Date.now(), title: card.title };
  socket.emit('play', { uid: card.uid, arg });
  selecting = null;
  picking = false;
  closeSheet();
  renderGame();
}

// One chooser in the dock, used for every "pick something" moment. Rebuilt only when what it shows changes.
let chooserKey = '';
let chooserPicks = [];
function showChooser({ title, text, icon, kind, buttons, urgent }) {
  const ch = $('#choose');
  ch.classList.remove('hidden');
  ch.className = `choose${kind ? ` ${kind}` : ''}`;
  $('#action-panel').classList.toggle('urgent', !!urgent);
  const key = JSON.stringify([title, text, icon, buttons.map(b => [b.pid, b.tile, b.value, b.disabled, b.primary, b.ghost, b.key || $txt(b.label)])]);
  if (key !== chooserKey) {
    chooserKey = key;
    $('#choose-title').replaceChildren(icon ? ms(icon) : '', title);
    $('#choose-text').textContent = text || '';
    $('#choose-list').replaceChildren(...buttons.map(b => h('button', {
      class: `btn${b.primary ? ' primary' : ''}${b.ghost ? ' ghost' : ''}`,
      type: 'button',
      disabled: b.disabled,
      'data-pid': b.pid || null,
      onclick: b.onclick,
      onpointerenter: b.pid && board3d ? () => board3d.setHot(b.pid) : null,
      onpointerleave: b.pid && board3d ? () => board3d.setHot(null) : null,
    }, ...[].concat(b.label))));
  }
  // The latest handlers win (they close over the latest state), whether or not the buttons were rebuilt.
  chooserPicks = buttons;
  [...$('#choose-list').children].forEach((el, i) => { el.onclick = buttons[i].onclick; });
  for (const b of buttons) {
    if (b.pid) choice.pawn.set(b.pid, b.onclick);
    if (b.tile != null) choice.tile.set(b.tile, b.onclick);
  }
}
const $txt = label => [].concat(label).map(x => (x && x.nodeType ? x.textContent : String(x))).join('');
function hideChooser() {
  $('#choose').classList.add('hidden');
  chooserKey = '';
  chooserPicks = [];
}

// Everything you can do lives in the dock: steps, what to do now, picks and buttons.
let waitKey = '';
function setWaiting(key, build, step = false) {
  const el = $('#waiting');
  el.classList.toggle('step', step);
  if (key === waitKey) return;
  waitKey = key;
  fill(el, build());
}
const roundChip = () => h('span', { class: 'round-chip' }, `R${Math.min(S.round, S.settings.rounds)}/${S.settings.rounds}`);

function renderActions() {
  const dock = $('#action-panel');
  const c = player(S.currentId);
  const isMe = myTurn();
  const btns = $('#turn-btns');
  btns.classList.add('hidden');
  dock.classList.toggle('mine', isMe);
  dock.classList.remove('urgent');
  renderSteps();

  const pend = S.pending;
  const v = S.vote;
  const myCards = hand();
  let chose = false;

  if (S.phase === 'over') {
    setWaiting('over', () => h('button', { class: 'btn small', type: 'button', onclick: () => { overDismissed = false; renderOver(); } }, ms('emoji_events'), 'Show results'));
  } else if (v && v.voters.includes(myId) && !v.voted.includes(myId)) {
    setWaiting('', () => []);
    chose = true;
    showChooser({
      title: 'Server vote', text: 'Who gets sent to the Booster Ambush? Tap a rider here or on the board.', icon: 'how_to_vote', urgent: true,
      buttons: S.players.filter(p => p.id !== myId && !p.out).map(p => ({ label: playerLabel(p), pid: p.id, onclick: () => socket.emit('vote', p.id) })),
    });
  } else if (v) {
    setWaiting(`vote${v.voted.length}/${v.voters.length}`, () => [ms('how_to_vote'), `Server vote: ${v.voted.length} of ${v.voters.length} voted`, h('span', { class: 'dots' })]);
  } else if (pend && pend.pid === myId) {
    setWaiting('', () => []);
    chose = true;
    const choose = id => { socket.emit('choose', id); hideChooser(); };
    if (pend.kind === 'arena') {
      showChooser({
        title: 'Ranked 1v1', text: `Pick who to fight. You both roll, the higher roll steals 12 aura.`, icon: 'swords', urgent: true,
        buttons: pend.options.map(id => {
          const p = player(id);
          return { label: p ? playerLabel(p) : '?', pid: id, onclick: () => choose(id) };
        }),
      });
    } else if (pend.kind === 'gloat') {
      showChooser({
        title: 'You won the 1v1', text: 'T-bag them for 3 more aura?', icon: 'emoji_events', urgent: true,
        buttons: [
          { label: 'T-bag (+3)', primary: true, onclick: () => choose('tbag') },
          { label: 'Let them go', onclick: () => choose('spare') },
        ],
      });
    } else if (pend.kind === 'shop') {
      const me = player(myId);
      const price = { guard: 15, attack: 15, legend: 40, skip: 0 };
      const labels = {
        guard: [ms('shield'), 'Guard card', h('small', null, ' · 15')],
        attack: [ms('bolt'), 'Attack card', h('small', null, ' · 15')],
        legend: [ms('star'), 'Legendary', h('small', null, ' · 40')],
        skip: 'No thanks',
      };
      showChooser({
        title: 'Card shop', text: me ? `You have ${me.aura} aura.` : '', icon: 'storefront', urgent: true,
        buttons: pend.options.map(o => ({ label: labels[o], key: o, ghost: o === 'skip', primary: o === 'legend', disabled: me && me.aura < price[o], onclick: () => choose(o) })),
      });
    } else if (pend.kind === 'snitch') {
      const peek = (S.me && S.me.peek) || [];
      showChooser({
        title: 'Snitch', text: 'This is their hand. Take one card.', icon: 'visibility', urgent: true,
        buttons: peek.map(cd => ({ label: [ms(KINDS[cd.kind].icon), cd.title], key: cd.uid, onclick: () => choose(cd.uid) })),
      });
    }
  } else if (pend) {
    const p = player(pend.pid);
    const what = { arena: 'is picking a 1v1 opponent', gloat: 'is deciding whether to T-bag', shop: 'is in the card shop', snitch: 'is looking through a hand' }[pend.kind] || 'is deciding';
    setWaiting(`pend${pend.pid}${pend.kind}`, () => [p ? avatar(p) : null, h('b', null, p ? p.name : 'Someone'), ` ${what}`, h('span', { class: 'dots' })]);
  } else if (S.reaction) {
    setWaiting(`react${S.reaction.desc}`, () => [ms('shield'), `${S.reaction.desc}. Waiting for reactions`, h('span', { class: 'dots' })]);
  } else if (isMe && selecting) {
    const card = myCards.find(x => x.uid === selecting);
    setWaiting('', () => []);
    chose = true;
    const cancel = { label: 'Cancel', ghost: true, onclick: () => { selecting = null; renderGame(); } };
    const opts = cardChoices(card);
    showChooser({
      title: card.title, text: card.text, icon: KINDS[card.kind].icon, kind: `k-${card.kind}`,
      buttons: [...opts.map(o => ({ ...o, primary: o.primary || opts.length === 1, onclick: () => playCard(card, o.value) })), cancel],
    });
  } else if (isMe) {
    renderTurn();
  } else if (spectating()) {
    setWaiting('spec', () => [ms('visibility'), "You're watching. You'll get a seat next game."]);
  } else if (player(myId) && player(myId).out) {
    setWaiting(`out${c ? c.id : ''}`, () => [ms('visibility'), "You're out. ", c ? h('span', null, `${c.name}'s turn`) : '', roundChip()]);
  } else if (c && !c.connected) {
    setWaiting(`away${c.id}`, () => [avatar(c), h('b', null, c.name), ' is away. Autopilot is playing for them', h('span', { class: 'dots' })]);
  } else if (c) {
    setWaiting(`wait${c.id}${S.round}`, () => [avatar(c), 'Waiting for ', h('b', null, c.name), h('span', { class: 'dots' }), roundChip()]);
  }
  if (!chose) hideChooser();
}

// Your turn: say exactly what to do next and light up only the button for it.
function renderTurn() {
  const step = currentStep();
  const roll = $('#btn-roll');
  const play = $('#btn-play');
  const end = $('#btn-end');
  const rollOk = canAct() && !S.rolled;
  const playOk = canPlayCard();
  const endOk = !blocked() && step === 'play';
  const busy = blocked() || (lastAct && lastAct.kind !== 'end' && Date.now() - lastAct.at < 600);
  $('#turn-btns').classList.toggle('hidden', step === 'draw');
  roll.disabled = !rollOk;
  play.disabled = !playOk;
  end.disabled = !endOk;
  // Exactly one main button: roll when you can roll, else play a card if you can, else end the turn.
  const main = rollOk ? roll : playOk ? play : endOk ? end : null;
  for (const b of [roll, play, end]) {
    b.classList.toggle('primary', b === main);
    b.classList.toggle('cta', b === main && b !== play);
  }
  play.classList.toggle('picking', picking);

  const n = owed().length;
  let key;
  let text;
  if (S.busy) {
    const what = lastAct && lastAct.kind === 'roll' ? 'Rolling' : lastAct && lastAct.kind === 'play' ? `Playing ${lastAct.title || 'your card'}` : 'Resolving';
    key = `busy${what}`;
    text = [what, h('span', { class: 'dots' })];
  } else if (tooMany() > 0 && !n) {
    key = `toss${hand().length}`;
    text = `Too many cards (${hand().length}/${S.handLimit}). ${tapCards() ? 'Tap' : 'Click'} one to throw it away.`;
  } else if (step === 'draw') {
    const only = n && owed()[0] !== 'any' ? owed()[0] : null;
    key = `draw${n}${only}`;
    text = only ? `Draw a card from the ${only === 'guard' ? 'Guard' : 'Attack'} deck` : n > 1 ? `Draw ${n} cards` : 'Draw a card';
  } else if (step === 'roll') {
    key = 'roll';
    text = 'Roll the die';
  } else if (rollOk) {
    key = 'again';
    text = 'Camel Zoomies! Roll again, or play a card';
  } else if (playOk) {
    key = `play${picking}`;
    text = picking ? `${tapCards() ? 'Tap' : 'Click'} a glowing card to play it` : 'Play a card, or end your turn';
  } else if (S.actionsLeft <= 0) {
    key = 'nomoves';
    text = 'No moves left. End your turn.';
  } else {
    key = 'noplay';
    text = "Nothing you can play right now. End your turn.";
  }
  if (busy && !S.busy) key += 'wait';
  setWaiting(`turn${key}`, () => [].concat(text), true);
}

const STEP_ICONS = ['style', 'casino', 'playing_cards'];
function renderSteps() {
  const at = ['draw', 'roll', 'play'].indexOf(currentStep());
  $('#steps').classList.toggle('hidden', at < 0);
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('now', i === at);
    li.classList.toggle('done', at > -1 && i < at);
    const icon = at > -1 && i < at ? 'check_circle' : STEP_ICONS[i];
    const el = li.querySelector('.ms');
    if (el.textContent !== icon) el.textContent = icon;
  });
  // Moves left this turn: rolling and playing a card each use one.
  const moves = $('#moves');
  const show = myTurn() && at > 0 && S.phase === 'play';
  moves.classList.toggle('hidden', !show);
  if (!show) return;
  const left = Math.max(0, S.actionsLeft);
  const total = Math.max(2, left);
  const key = `${left}/${total}`;
  if (moves.dataset.key === key) return;
  moves.dataset.key = key;
  moves.dataset.tipTitle = 'Moves';
  moves.dataset.tip = 'Rolling and playing a card each use a move. Some cards and tiles give you more.';
  moves.replaceChildren(...Array.from({ length: total }, (_, i) => h('i', { class: i < left ? null : 'used' })), h('span', null, `${left} move${left === 1 ? '' : 's'} left`));
}

// The decks on the table glow when you can draw; the buttons in the dock do the same thing.
function renderDecks() {
  const next = owed()[0];
  let any = false;
  for (const k of ['guard', 'attack']) {
    const ready = myTurn() && !!next && (next === 'any' || next === k);
    any = any || ready;
    board3d.setDeck(k, ready, S.decks[k]);
    $(`#deck-${k}`).disabled = !ready;
    $(`#count-${k}`).textContent = S.decks[k];
  }
  $('#draw-btns').classList.toggle('hidden', !any || S.phase !== 'play');
}

function setTimer(bar, left, total) {
  bar.style.transition = 'none';
  if (left > 0 && total > 0) {
    bar.style.width = (left / total) * 100 + '%';
    void bar.offsetWidth;
    bar.style.transition = `width ${left}ms linear`;
    bar.style.width = '0%';
  } else {
    bar.style.width = '0%';
  }
}

// ---------------------------------------------------------------------------
// Your hand. Cards keep their element between updates (keyed by uid), so they can slide into place when the hand
// changes, deal in when drawn and fly out when played or thrown away.
// ---------------------------------------------------------------------------
// Small circle in the top-right corner of a card: how strong it is, 1 to 4.
const POWER_TIPS = ['', 'Weak card', 'Solid card', 'Strong card', 'Legendary: the strongest cards'];
const powerDot = n => (n ? h('span', { class: `pw pw-${n}`, 'data-tip': `Power ${n} of 4. ${POWER_TIPS[n]}` }, String(n)) : null);
const faceParts = cd => [
  powerDot(cd.power),
  h('span', { class: 'ms hi', 'aria-hidden': 'true' }, KINDS[cd.kind].icon),
  h('div', { class: 'ht' }, cd.title),
  h('div', { class: 'hx' }, cd.text),
  h('div', { class: 'hk' }, KINDS[cd.kind].label),
];

const handEls = new Map(); // uid -> slot element
const handFx = new Map(); // uid -> how it left my hand: 'play' or 'toss'
let handDealt = false; // the opening hand is dealt in one card at a time

function resetHand() {
  for (const el of handEls.values()) el.remove();
  handEls.clear();
  handFx.clear();
  handDealt = false;
  closeSheet();
}

function fanLayout(n) {
  const wide = desktop.matches;
  const sample = $('#hand .hcard');
  const cardW = (sample && sample.offsetWidth) || (wide ? 168 : sideways.matches ? 60 : 72); // CSS sets the size per screen
  const avail = Math.max(120, $('#hand-wrap').clientWidth - 8);
  let gap = wide ? -18 : -5;
  // Squeeze them together so any number of cards fits
  if (n * (cardW + 2 * gap) > avail) gap = Math.min(gap, (avail / n - cardW) / 2);
  const squeeze = Math.min(1, avail / Math.max(1, n * cardW * 0.8));
  return { gap, rot: (wide ? 6 : 4) * squeeze, drop: (wide ? 5 : 2.4) * squeeze };
}

function renderHand() {
  const wrap = $('#hand-wrap');
  const me = player(myId);
  const show = !!me && !me.out && S.phase === 'play';
  wrap.classList.toggle('hidden', !show);
  if (!show) { if (handEls.size) resetHand(); return; }
  const cards = hand();
  const ok = canPlayCard();
  const toss = tossing();
  const box = $('#hand');
  const before = new Map();
  for (const [uid, el] of handEls) before.set(uid, el.getBoundingClientRect().left);
  const fan = fanLayout(cards.length);
  const mid = (cards.length - 1) / 2;
  const deal = !handDealt;
  let drew = false;
  const empty = box.querySelector('.empty');
  if (empty && cards.length) empty.remove();

  cards.forEach((cd, i) => {
    let el = handEls.get(cd.uid);
    const fresh = !el;
    if (fresh) {
      el = h('button', { class: 'hcard', type: 'button', role: 'listitem', onclick: () => onCardClick(cd.uid) }, h('div', { class: 'hface' }, ...faceParts(cd)));
      handEls.set(cd.uid, el);
      if (deal) el.style.setProperty('--delay', `${0.15 + i * 0.12}s`);
      else drew = true;
    }
    const off = i - mid;
    el.classList.toggle(`k-${cd.kind}`, true);
    el.classList.toggle('sel', selecting === cd.uid);
    el.classList.toggle('toss', toss);
    el.classList.toggle('usable', !toss && ok && cd.playable);
    el.classList.toggle('pick', !toss && ok && cd.playable && picking);
    el.classList.toggle('react', cd.kind === 'react');
    el.style.setProperty('--rot', `${off * fan.rot}deg`);
    el.style.setProperty('--drop', `${Math.abs(off) * Math.abs(off) * fan.drop}px`);
    el.style.setProperty('--gap', `${fan.gap}px`);
    el.style.zIndex = String(i + 1);
    el.setAttribute('aria-label', `${cd.title}. ${cd.text}`);
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
    if (fresh) {
      el.classList.add('enter');
      el.addEventListener('animationend', () => { el.classList.remove('enter'); el.style.removeProperty('--delay'); }, { once: true });
    }
  });
  for (const [uid, el] of [...handEls]) {
    if (cards.some(c => c.uid === uid)) continue;
    handEls.delete(uid);
    cardLeaves(el, handFx.get(uid) || 'lost');
    handFx.delete(uid);
  }
  if (!cards.length && !box.querySelector('.empty')) box.append(h('div', { class: 'empty' }, 'No cards'));
  if (cards.length) handDealt = true;
  if (drew) sfxUi('draw');
  if (deal && cards.length) cards.forEach((_, i) => setTimeout(() => sfxUi('draw'), 150 + i * 120));

  // Slide the cards that stayed from where they were to where they are now
  for (const [uid, el] of handEls) {
    const was = before.get(uid);
    if (was == null) continue;
    const dx = was - el.getBoundingClientRect().left;
    if (Math.abs(dx) > 1 && el.animate) el.animate([{ translate: `${dx}px 0` }, { translate: '0 0' }], { duration: 340, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
  }
}

// A card leaves: a copy flies off (to the middle of the screen when played, down when thrown away) while the hand closes up.
function cardLeaves(el, how) {
  const face = el.querySelector('.hface');
  const r = el.getBoundingClientRect();
  if (!face || !r.width) { el.remove(); return; }
  const w = el.offsetWidth;
  const hgt = el.offsetHeight;
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const rot = el.style.getPropertyValue('--rot') || '0deg';
  const ghost = face.cloneNode(true);
  ghost.className = `ghost-card hface ${[...el.classList].find(c => c.startsWith('k-')) || ''} exit-${how}`;
  const pop = $('#card-pop').getBoundingClientRect();
  const toX = (pop.width ? pop.left + pop.width / 2 : innerWidth / 2) - cx;
  const toY = (pop.height ? pop.top + pop.height / 2 : innerHeight * 0.42) - cy;
  Object.assign(ghost.style, {
    left: `${cx - w / 2}px`, top: `${cy - hgt / 2}px`, width: `${w}px`, height: `${hgt}px`, transform: `rotate(${rot})`,
  });
  ghost.style.setProperty('--r0', rot);
  ghost.style.setProperty('--tx', `${how === 'play' ? toX : (Math.random() - 0.5) * 80}px`);
  ghost.style.setProperty('--ty', `${toY}px`);
  document.body.append(ghost);
  ghost.addEventListener('animationend', () => ghost.remove(), { once: true });
  setTimeout(() => ghost.remove(), 1200);
  el.remove();
}

function onCardClick(uid) {
  const cd = hand().find(c => c.uid === uid);
  const el = handEls.get(uid);
  if (!cd || !el) return;
  if (tapCards()) { openSheet(uid); return; }
  if (tossing()) { handFx.set(uid, 'toss'); socket.emit('discard', uid); return; }
  if (!canPlayCard() || !cd.playable) {
    replay(el, 'nope');
    toast(whyNot(cd));
    return;
  }
  selecting = selecting === uid ? null : uid;
  picking = false;
  renderGame();
}

// ---------------------------------------------------------------------------
// Card sheet (phones and tablets): the card big, what it does, and the buttons to play or throw it away.
// Swipe or use the arrows to look through your hand.
// ---------------------------------------------------------------------------
const sheet = { uid: null, shown: null, dir: null, key: '' };
function openSheet(uid) {
  sheet.uid = uid;
  sheet.shown = null;
  sheet.dir = null;
  sheet.key = '';
  const el = $('#card-sheet');
  clearTimeout(sheet.t);
  el.classList.remove('hidden', 'leaving');
  renderGame();
}
function closeSheet() {
  if (!sheet.uid) return;
  sheet.uid = null;
  sheet.shown = null;
  const el = $('#card-sheet');
  el.classList.add('leaving');
  clearTimeout(sheet.t);
  sheet.t = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('leaving'); }, 220);
}
function stepSheet(d) {
  const cards = hand();
  const i = cards.findIndex(c => c.uid === sheet.uid);
  const next = cards[i + d];
  if (!next) return;
  sheet.uid = next.uid;
  sheet.dir = d > 0 ? 'from-right' : 'from-left';
  renderGame();
}
$('#card-sheet').addEventListener('click', e => { if (e.target.closest('[data-close]')) { closeSheet(); renderGame(); } });
$('#sheet-prev').addEventListener('click', () => stepSheet(-1));
$('#sheet-next').addEventListener('click', () => stepSheet(1));
{
  let sx = null;
  const area = $('#sheet-card');
  area.addEventListener('pointerdown', e => { sx = { x: e.clientX, y: e.clientY }; });
  area.addEventListener('pointerup', e => {
    if (!sx) return;
    const dx = e.clientX - sx.x;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - sx.y)) stepSheet(dx < 0 ? 1 : -1);
    sx = null;
  });
}

function renderSheet() {
  if (!sheet.uid) return;
  const cards = hand();
  const i = cards.findIndex(c => c.uid === sheet.uid);
  if (i < 0 || S.phase !== 'play' || !player(myId) || player(myId).out) { closeSheet(); return; }
  const cd = cards[i];
  if (sheet.shown !== cd.uid) {
    sheet.shown = cd.uid;
    $('#sheet-card').replaceChildren(h('div', { class: `bigcard k-${cd.kind}${sheet.dir ? ` ${sheet.dir}` : ''}` }, ...faceParts(cd)));
  }
  $('#sheet-prev').disabled = i === 0;
  $('#sheet-next').disabled = i === cards.length - 1;
  const dots = $('#sheet-dots');
  if (dots.childElementCount !== cards.length) fill(dots, cards.map(() => h('i')));
  [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i));

  const acts = [];
  let note = '';
  let noteIcon = 'info';
  const close = { label: 'Close', ghost: true, wide: true, onclick: () => { closeSheet(); renderGame(); } };
  if (tossing()) {
    noteIcon = 'delete';
    note = `You have ${cards.length} cards and can hold ${S.handLimit}. Throw one away.`;
    acts.push({ label: [ms('delete'), 'Throw this away'], danger: true, wide: true, onclick: () => { handFx.set(cd.uid, 'toss'); socket.emit('discard', cd.uid); closeSheet(); } });
    acts.push({ ...close, label: 'Keep it' });
  } else if (canPlayCard() && cd.playable) {
    noteIcon = 'touch_app';
    const opts = cardChoices(cd);
    note = cd.target === 'player' ? 'Pick who to play it on (or tap them on the board).'
      : cd.target === 'tile' ? 'Pick a tile.'
        : cd.target ? 'Pick one.' : '';
    for (const o of opts) {
      const fn = () => playCard(cd, o.value);
      acts.push({ ...o, primary: o.primary || opts.length === 1, wide: opts.length === 1, onclick: fn });
      if (o.pid) choice.pawn.set(o.pid, fn);
      if (o.tile != null) choice.tile.set(o.tile, fn);
    }
    acts.push({ ...close, label: 'Cancel' });
  } else {
    note = whyNot(cd);
    acts.push(close);
  }
  const noteEl = $('#sheet-note');
  noteEl.replaceChildren(...(note ? [ms(noteIcon), note] : []));
  const key = JSON.stringify([cd.uid, acts.map(a => [a.value, a.danger, a.primary, $txt(a.label)])]);
  if (key !== sheet.key) {
    sheet.key = key;
    $('#sheet-actions').replaceChildren(...acts.map(a => h('button', {
      class: `btn${a.primary ? ' primary' : ''}${a.ghost ? ' ghost' : ''}${a.danger ? ' danger' : ''}${a.wide ? ' wide' : ''}`, type: 'button',
    }, ...[].concat(a.label))));
  }
  [...$('#sheet-actions').children].forEach((el, k) => { el.onclick = acts[k].onclick; });
}

// ---------------------------------------------------------------------------
// Reactions: when someone comes for you (or plays a card you can Report), you get a few seconds to answer.
// ---------------------------------------------------------------------------
let reactKey = '';
function renderReaction() {
  const bar = $('#react-bar');
  const r = S.reaction;
  const mine = S.me && S.me.react;
  const key = r && mine && mine.length ? `${r.desc}|${mine.join()}` : '';
  if (!key) { bar.classList.add('hidden'); reactKey = ''; return; }
  if (key !== reactKey) {
    reactKey = key;
    sfxUi('alarm');
    buzz([70, 50, 70]);
    bar.classList.remove('hidden');
    $('#react-desc').textContent = `${r.desc}.`;
    const cards = hand().filter(c => mine.includes(c.uid));
    $('#react-list').replaceChildren(
      ...cards.map(c => h('button', {
        class: 'btn primary', type: 'button',
        onclick: () => { handFx.set(c.uid, 'play'); socket.emit('react', c.uid); bar.classList.add('hidden'); },
      }, h('span', { class: 'rl-t' }, ms(KINDS.react.icon), c.title), h('small', null, c.text.replace(/^Reaction:\s*/, '')))),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { socket.emit('react', null); bar.classList.add('hidden'); } }, 'Skip'));
    setTimer($('#react-timer'), r.timeLeft, r.timeTotal);
  }
}

// ---------------------------------------------------------------------------
// Players: one row per rider, kept between updates so aura can count up or down and flash.
// On phones the rows are chips in a strip across the top; tap it to see the full list.
// ---------------------------------------------------------------------------
// Small icon + text pairs under a player's name. Only shows what's actually going on.
function statusOf(p) {
  const owner = player(p.owner);
  const hostages = S.players.filter(o => o.owner === p.id).length;
  const duo = player(p.duoWith);
  const cover = player(p.coverId);
  const st = (icon, text, cls, title, tip) => h('span', { class: cls || null, 'data-tip-title': title, 'data-tip': tip }, ms(icon), text);
  return [
    st('style', p.handCount, null, 'Cards', `${plural(p.handCount, 'card')} in hand.`),
    owner ? st('link', `pays ${owner.name}`, 'bad', 'Aura tax', `Pays ${owner.name} aura tax every turn, until they steal back or play Betrayal.`) : null,
    hostages ? st('payments', `taxing ${hostages}`, 'good', 'Collecting tax', `Collects aura tax from ${plural(hostages, 'rider')} every turn.`) : null,
    duo ? st('group', `with ${duo.name}`, null, 'Duo', `Dragging ${duo.name} along: they land wherever this rider lands.`) : null,
    p.deathnote ? st('menu_book', p.deathnote, 'bad', 'Deathnote', `In Osoka's Deathnote: loses aura every turn for ${plural(p.deathnote, 'more turn')}.`) : null,
    p.marked ? st('photo_camera', '', 'bad', 'Screenshotted', 'The next attack on them does double.') : null,
    p.smurf ? st('visibility_off', '', null, 'Smurf account', 'Nobody can target them until their next turn.') : null,
    p.booster ? st('sports_martial_arts', 'booster', 'good', 'Booster', 'Has the booster: their T-bags hit double.') : null,
    p.hunted ? st('my_location', 'hunted', 'bad', 'Hunted', 'In the Deathnote hunt: T-bags on them hit x3.') : null,
    cover ? st('handshake', 'covered by ' + cover.name, 'good', 'Covered', `${cover.name} takes every bit of aura this rider would lose.`) : null,
    !p.connected ? st('bedtime', 'away', null, 'Away', 'Disconnected. Autopilot is playing for them.') : null,
  ];
}

const rows = new Map(); // pid -> { el, ... }
function makeRow() {
  const r = {
    el: h('div', { class: 'prow', role: 'listitem' }),
    av: h('div', { class: 'avatar' }),
    avKey: '',
    pname: h('div', { class: 'pname' }),
    stat: h('div', { class: 'pstat' }),
    bar: h('i'),
    aura: h('div', { class: 'paura' }),
    shown: null,
    target: null,
    raf: 0,
  };
  r.el.append(r.av, h('div', { class: 'pinfo' }, r.pname, r.stat, h('div', { class: 'pbar' }, r.bar)), r.aura);
  return r;
}
function tweenAura(r, to) {
  const from = r.shown == null ? to : r.shown;
  r.target = to;
  cancelAnimationFrame(r.raf);
  if (from === to) { r.shown = to; r.aura.textContent = String(to); return; }
  const t0 = performance.now();
  const dur = Math.min(900, 280 + Math.abs(to - from) * 14);
  const step = t => {
    const k = Math.min(1, (t - t0) / dur);
    r.shown = Math.round(from + (to - from) * (1 - (1 - k) ** 3));
    r.aura.textContent = String(r.shown);
    if (k < 1) r.raf = requestAnimationFrame(step);
  };
  r.raf = requestAnimationFrame(step);
  replay(r.el, to > from ? 'gain' : 'loss');
  r.el.classList.remove(to > from ? 'loss' : 'gain');
}

function renderPlayers() {
  const box = $('#players');
  const lead = leaderId();
  S.players.forEach((p, i) => {
    let r = rows.get(p.id);
    if (!r) { r = makeRow(); rows.set(p.id, r); }
    const el = r.el;
    el.style.setProperty('--c', p.color);
    el.classList.toggle('current', p.id === S.currentId && S.phase === 'play');
    el.classList.toggle('afk', !p.connected);
    el.classList.toggle('out', !!p.out);
    el.classList.toggle('me', p.id === myId);
    const avKey = `${p.champion}|${p.color}|${p.name}`;
    if (avKey !== r.avKey) {
      r.avKey = avKey;
      const av = avatar(p);
      r.av.replaceWith(av);
      r.av = av;
    }
    fill(r.pname,
      h('span', { class: 'n' }, p.name),
      p.id === lead ? h('span', { class: 'ms', 'data-tip-title': 'Leader', 'data-tip': 'Has the most aura right now.' }, 'workspace_premium') : null,
      p.id === myId ? h('span', { class: 'tag tag-you' }, 'you') : null,
      p.bot ? h('span', { class: 'tag' }, 'bot') : null,
      p.out ? h('span', { class: 'tag tag-out', 'data-tip': 'Went below 0 aura. Out of the game, watching.' }, 'out') : null);
    fill(r.stat, p.out ? [] : statusOf(p));
    r.bar.style.width = `${Math.max(0, Math.min(100, (p.aura / S.settings.target) * 100))}%`;
    r.aura.classList.toggle('neg', p.aura < 0);
    if (r.target !== p.aura) tweenAura(r, p.aura);
    el.title = `${p.name}: ${p.aura} aura`;
    if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null);
  });
  for (const [id, r] of rows) {
    if (!S.players.some(p => p.id === id)) { r.el.remove(); rows.delete(id); }
  }
  let specs = box.querySelector('.specs');
  if (S.spectators.length) {
    if (!specs) { specs = h('div', { class: 'specs muted' }); box.append(specs); }
    specs.textContent = `Watching: ${S.spectators.map(s => s.name).join(', ')}`;
  } else if (specs) specs.remove();
  const round = Math.min(S.round, S.settings.rounds);
  $('#round-info').replaceChildren('Round ', h('b', null, round), `/${S.settings.rounds} · `, h('b', null, S.settings.target), ' to win');
}

// Phones: keep the rider whose turn it is in view in the strip.
function scrollStripTo(id) {
  const r = rows.get(id);
  const strip = $('#players');
  if (!r || desktop.matches || $('#players-panel').classList.contains('expanded')) return;
  strip.scrollTo({ left: r.el.offsetLeft - (strip.clientWidth - r.el.offsetWidth) / 2, behavior: 'smooth' });
}
function setExpanded(on) {
  const panel = $('#players-panel');
  if (panel.classList.contains('expanded') === on) return;
  panel.classList.toggle('expanded', on);
  $('#pp-toggle').setAttribute('aria-expanded', String(on));
  $('#pp-toggle').setAttribute('aria-label', on ? 'Show fewer' : 'Show all players');
  if (on) closeMenu();
}
$('#pp-toggle').addEventListener('click', () => setExpanded(!$('#players-panel').classList.contains('expanded')));
$('#players').addEventListener('click', e => {
  if (desktop.matches || $('#players-panel').classList.contains('expanded') || e.target.closest('[data-tip]')) return;
  setExpanded(true);
});

// ---------------------------------------------------------------------------
// Phone menu: music, sound, end game, leave
// ---------------------------------------------------------------------------
function closeMenu() {
  $('#screen-game').classList.remove('menu-open');
  $('#btn-menu').setAttribute('aria-expanded', 'false');
}
$('#btn-menu').addEventListener('click', () => {
  const open = !$('#screen-game').classList.contains('menu-open');
  $('#screen-game').classList.toggle('menu-open', open);
  $('#btn-menu').setAttribute('aria-expanded', String(open));
  if (open) { setExpanded(false); renderMenu(); }
});
$('#m-sound').addEventListener('click', () => toggleMute());
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#game-menu, #btn-menu')) closeMenu();
  if (!e.target.closest('#players-panel') && !e.target.closest('#tip')) setExpanded(false);
});
function renderMenu() {
  if (!S) return;
  const round = Math.min(S.round, S.settings.rounds);
  $('#menu-info').replaceChildren('Round ', h('b', null, round), ` of ${S.settings.rounds} · first to `, h('b', null, `${S.settings.target} aura`), ' wins');
  $('#m-sound .ms').textContent = sfx.muted ? 'volume_off' : 'volume_up';
  $('#m-sound span:last-child').textContent = sfx.muted ? 'Sounds off' : 'Sounds on';
}

function renderOver() {
  const over = $('#over');
  if (S.phase !== 'over' || overDismissed) { over.classList.add('hidden'); return; }
  const w = player(S.winnerId);
  const key = `${S.winnerId}|${S.players.map(p => `${p.id}:${p.aura}`).join()}`;
  if (!over.classList.contains('hidden') && over.dataset.key === key) return;
  over.dataset.key = key;
  over.classList.remove('hidden');
  $('#over-hero').replaceChildren(...(w ? [avatar(w), ms('crown')] : [ms('emoji_events')]));
  const crown = $('#over-hero .ms');
  if (crown) crown.classList.add('crown');
  if (w) $('#over-hero').style.setProperty('--c', w.color);
  $('#over-winner').textContent = w ? (w.id === myId ? 'You win!' : w.name) : '?';
  $('#over-sub').textContent = w && w.id === myId ? `${w.aura} aura. Absolute champ smurf camel rider.` : 'wins the game';
  const ranks = $('#over-ranks');
  ranks.replaceChildren();
  [...S.players].sort((a, b) => (a.id === S.winnerId ? -1 : b.id === S.winnerId ? 1 : b.aura - a.aura)).forEach((p, i) => ranks.append(h('li', { class: p.id === myId ? 'me' : null, style: `animation-delay:${0.15 + i * 0.06}s` },
    h('span', { class: 'rk' }, String(i + 1)),
    avatar(p),
    h('div', { class: 'nm' }, p.name, p.out ? h('span', { class: 'tag tag-out', style: 'margin-left:6px' }, 'out') : null,
      h('div', { class: 'st' }, `${plural(p.stats.tbags, 'T-bag')} · ${p.stats.stolen} stolen · ${plural(p.stats.cards, 'card')}`)),
    h('span', { class: 'au' }, String(p.aura)))));
  const watching = spectating();
  $('#btn-again').classList.toggle('hidden', watching);
  $('#over-wait').textContent = watching ? "You'll get a seat once someone goes back to the lobby." : '';
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
function rollDie(value, value2, style) {
  sfxUi('dice');
  board3d.roll(value2 ? Math.max(value, value2) : value, undefined, style).then(() => {
    sfxUi('land');
    if (value2) showBanner({ title: `${value} + ${value2}`, sub: `Zoomies: ${value + value2} tiles`, kind: 'good' });
  });
}

function floatText(pid, text, good) {
  const { x, y } = board3d.screenPos(pid, displayPos[pid]);
  const n = Math.abs(parseInt(text, 10));
  const el = h('div', { class: `float ${good ? 'good' : 'bad'}${n >= 20 ? ' big' : ''}`, style: `left:${x}px;top:${y}px` }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1700);
}

// Pop-ups slide in at the top and leave on their own (or when tapped). A few stack, tinted with the player's colour.
function showBanner(b) {
  const box = $('#banners');
  const p = player(b.pid);
  const el = h('div', { class: 'banner', role: 'status', style: `${p ? `--c:${p.color};` : ''}--life:${BANNER_MS}ms` },
    h('button', { class: 'icon-btn x', type: 'button', 'aria-label': 'Close' }, ms('close')),
    h('div', { class: 'bt' }, b.title), b.sub ? h('div', { class: 'bs' }, b.sub) : null);
  const dismiss = () => {
    if (el.classList.contains('leaving')) return;
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener('click', dismiss);
  box.append(el);
  const max = desktop.matches ? 3 : 2;
  const live = [...box.children].filter(c => !c.classList.contains('leaving'));
  live.slice(0, Math.max(0, live.length - max)).forEach(c => c.remove());
  setTimeout(dismiss, BANNER_MS);
}

// "Your turn": big in the middle of the screen, a chime, and a buzz on phones.
function yourTurn() {
  const el = $('#splash');
  el.replaceChildren(h('div', { class: 'sp-t' }, 'Your turn'), h('div', { class: 'sp-s' }, 'Draw, roll, then play a card or end your turn'));
  el.classList.remove('hidden');
  replay(el, 'show');
  clearTimeout(yourTurn.t);
  yourTurn.t = setTimeout(() => el.classList.add('hidden'), 1800);
  sfxUi('turn');
  buzz(45);
}

function tbagFx(thief, victim) {
  board3d.tbag(thief);
  board3d.shake(victim);
  const p = player(thief);
  if (!p) return;
  playTbagSound(p.champion);
  const gif = tbagGif(p.champion);
  if (gif) showSticker(thief, null, gif);
  if (victim === myId) buzz([30, 40, 30]);
}

function showCard(f) {
  const p = player(f.pid);
  const t = player(f.target);
  const k = KINDS[f.kind] || KINDS.social;
  const pop = $('#card-pop');
  const hide = () => {
    if (pop.classList.contains('hidden')) return;
    pop.classList.add('leaving');
    clearTimeout(showCard.t2);
    showCard.t2 = setTimeout(() => { pop.classList.add('hidden'); pop.classList.remove('leaving'); }, 300);
  };
  pop.className = `card-pop k-${f.kind}`;
  pop.style.cssText = p ? `--c:${p.color}` : '';
  pop.onclick = hide;
  fill(pop,
    h('button', { class: 'icon-btn x', type: 'button', 'aria-label': 'Close' }, ms('close')),
    powerDot(f.power),
    h('div', { class: 'ck' }, ms(k.icon), f.label || k.label),
    h('div', { class: 'ct' }, f.title),
    h('div', { class: 'cx' }, f.text),
    p ? h('div', { class: 'cw' }, avatar(p), p.name, t ? [ms('arrow_forward'), avatar(t), t.name] : null) : null);
  sfxUi('card');
  clearTimeout(showCard.t);
  clearTimeout(showCard.t2);
  showCard.t = setTimeout(hide, CARD_POP_MS);
}

function duelFx(f) {
  const a = player(f.a);
  const b = player(f.b);
  if (!a || !b) return;
  sfxUi('dice');
  showBanner({ title: `${f.ra} vs ${f.rb}`, sub: `${a.name} vs ${b.name}`, kind: 'tbag', pid: f.ra >= f.rb ? a.id : b.id });
}

function confetti() {
  const colors = ['#f5b942', '#4cc38a', '#5aa9f0', '#9b7cf5', '#ef5d6c'];
  for (let i = 0; i < 100; i++) {
    const c = h('div', { class: 'confetti' });
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.5 + Math.random() * 2.5 + 's';
    c.style.animationDelay = Math.random() * 0.8 + 's';
    c.style.setProperty('--dx', (Math.random() - 0.5) * 300 + 'px');
    c.style.setProperty('--rot', Math.random() * 1080 + 'deg');
    document.body.append(c);
    setTimeout(() => c.remove(), 6000);
  }
}

// ---------------------------------------------------------------------------
// Phones: buzz, keep the screen on during a game, and flag the tab when it's your move
// ---------------------------------------------------------------------------
const buzz = pattern => { try { if (!sfx.muted && navigator.vibrate) navigator.vibrate(pattern); } catch { /* not allowed */ } };

const baseTitle = document.title;
function notifyTitle() {
  const react = !!(S && S.me && S.me.react && S.me.react.length && S.reaction);
  const mine = !!S && myTurn();
  document.title = document.hidden && (react || mine) ? (react ? '⚠ React! · Aura Tax' : '● Your turn · Aura Tax') : baseTitle;
}

const wake = { lock: null, want: false, busy: false };
async function keepAwake(on) {
  wake.want = on;
  if (wake.busy || !('wakeLock' in navigator)) return;
  wake.busy = true;
  const goal = on;
  try {
    if (on && !wake.lock && !document.hidden) {
      wake.lock = await navigator.wakeLock.request('screen');
      wake.lock.addEventListener('release', () => { wake.lock = null; });
    } else if (!on && wake.lock) {
      await wake.lock.release();
      wake.lock = null;
    }
  } catch { wake.lock = null; }
  wake.busy = false;
  // Only try again if someone asked for something else while we were waiting (a refused lock isn't retried in a loop).
  if (wake.want !== goal) keepAwake(wake.want);
}
document.addEventListener('visibilitychange', () => {
  notifyTitle();
  if (!document.hidden) keepAwake(wake.want);
});

// ---------------------------------------------------------------------------
// Sound: T-bag effects, small game sounds and the game's music. The mute button and sliders live in the sticker panel.
// ---------------------------------------------------------------------------
const storedVol = (k, d) => { const v = parseFloat(store.get(k)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d; };
const sfx = {
  muted: store.get('auraTax.mute') === '1',
  vol: storedVol('auraTax.sfxVol', 0.6),
  musicVol: storedVol('auraTax.musicVol', 0.35),
};
// Every effect is levelled to this loudness (RMS of its loud part) before the volume slider, so a whisper
// recorded quietly and a screaming air horn come out about the same. The limiter catches what's left.
const SFX_TARGET = 0.1;
const SFX_MAX_GAIN = 16;
const MUSIC_SCALE = 0.5; // the music slider at 100% is still well under the effects

const audio = { ctx: null, out: null, sounds: new Map() };
function audioCtx() {
  if (!audio.ctx) {
    const ctx = audio.ctx = new AudioContext();
    const limiter = ctx.createDynamicsCompressor();
    Object.entries({ threshold: -12, knee: 4, ratio: 20, attack: 0.002, release: 0.25 }).forEach(([k, v]) => (limiter[k].value = v));
    audio.out = ctx.createGain();
    audio.out.connect(limiter).connect(ctx.destination);
  }
  audio.out.gain.value = sfx.vol;
  if (audio.ctx.state === 'suspended') audio.ctx.resume().catch(() => {});
  return audio.ctx;
}
// Phones only let a page make sound after a tap: wake the audio up on the first one.
const unlockAudio = () => { try { audioCtx(); } catch { /* no audio */ } };
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
document.addEventListener('keydown', unlockAudio, { once: true, capture: true });

// Loudness of a sound: RMS of its loudest 50 ms windows (90th percentile), so silence at either end doesn't count.
function loudness(buf) {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, c) => buf.getChannelData(c));
  const win = Math.max(1, Math.floor(buf.sampleRate * 0.05));
  const levels = [];
  let peak = 0;
  for (let i = 0; i + win <= buf.length; i += win) {
    let sum = 0;
    for (const d of chans) {
      for (let j = i; j < i + win; j++) { sum += d[j] * d[j]; peak = Math.max(peak, Math.abs(d[j])); }
    }
    levels.push(Math.sqrt(sum / (win * chans.length)));
  }
  levels.sort((a, b) => a - b);
  return { rms: levels.length ? levels[Math.floor(levels.length * 0.9)] : 0, peak };
}

function loadSound(url) {
  if (!audio.sounds.has(url)) {
    const p = fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(b => audioCtx().decodeAudioData(b))
      .then(buf => {
        const { rms, peak } = loudness(buf);
        // Level it, but never boost the peaks more than ~2x past full scale (the limiter handles that much).
        const gain = Math.min(SFX_MAX_GAIN, SFX_TARGET / Math.max(rms, 1e-4), 2 / Math.max(peak, 1e-4));
        return { buf, gain };
      });
    p.catch(() => audio.sounds.delete(url)); // let a missing file be retried later
    audio.sounds.set(url, p);
  }
  return audio.sounds.get(url);
}

async function playLevelled(url) {
  try {
    const { buf, gain } = await loadSound(url);
    const ctx = audioCtx();
    const src = ctx.createBufferSource();
    const g = ctx.createGain();
    src.buffer = buf;
    g.gain.value = gain;
    src.connect(g).connect(audio.out);
    src.start();
  } catch { /* blocked or missing */ }
}

// Small synthesized game sounds: short and quiet, under the T-bag sounds, on the same volume slider and mute.
function tone({ type = 'sine', f0, f1 = f0, dur = 0.12, vol = 0.15, delay = 0 }) {
  const ctx = audioCtx();
  const t = ctx.currentTime + 0.01 + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(audio.out);
  o.start(t);
  o.stop(t + dur + 0.03);
}
let noiseBuf = null;
function hiss({ dur = 0.1, vol = 0.2, freq = 2000, q = 1, delay = 0 }) {
  const ctx = audioCtx();
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + 0.01 + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(audio.out);
  src.start(t, Math.random() * 0.5, dur + 0.02);
}
const UI_SOUNDS = {
  turn: () => { tone({ type: 'triangle', f0: 659, dur: 0.16, vol: 0.16 }); tone({ type: 'triangle', f0: 988, dur: 0.34, vol: 0.14, delay: 0.1 }); },
  draw: () => hiss({ dur: 0.13, vol: 0.2, freq: 3400, q: 0.7 }),
  card: () => { hiss({ dur: 0.08, vol: 0.22, freq: 1800, q: 0.6 }); tone({ f0: 150, f1: 70, dur: 0.15, vol: 0.22, delay: 0.02 }); },
  gain: () => [784, 988, 1319].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: 0.11, vol: 0.1, delay: i * 0.055 })),
  loss: () => { tone({ type: 'square', f0: 330, f1: 230, dur: 0.14, vol: 0.045 }); tone({ type: 'square', f0: 220, f1: 150, dur: 0.2, vol: 0.045, delay: 0.09 }); },
  alarm: () => [0, 0.15].forEach(d => tone({ type: 'square', f0: 880, dur: 0.08, vol: 0.06, delay: d })),
  dice: () => { for (let i = 0; i < 6; i++) hiss({ dur: 0.035, vol: 0.16 * (1 - i / 8), freq: 2200 + Math.random() * 2000, q: 5, delay: i * 0.08 + Math.random() * 0.03 }); },
  land: () => { tone({ f0: 180, f1: 90, dur: 0.12, vol: 0.2 }); hiss({ dur: 0.05, vol: 0.12, freq: 1500, q: 2 }); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: i === 3 ? 0.6 : 0.15, vol: 0.13, delay: i * 0.12 })),
  over: () => [523, 440, 392].forEach((f, i) => tone({ type: 'triangle', f0: f, dur: i === 2 ? 0.5 : 0.16, vol: 0.1, delay: i * 0.14 })),
  out: () => tone({ type: 'sawtooth', f0: 300, f1: 60, dur: 0.7, vol: 0.06 }),
};
function sfxUi(name) {
  if (sfx.muted || sfx.vol <= 0 || !audio.ctx || audio.ctx.state !== 'running') return;
  try { UI_SOUNDS[name](); } catch { /* no audio */ }
}

// Music: everything in sounds/music/, shuffled and looped, only while a game is being played.
// The player in the top-left of the game screen (the menu on phones) shows the track and lets you pause, mute and seek.
const music = { el: null, list: null, queue: [], want: false, title: '', paused: false, muted: store.get('auraTax.musicMute') === '1' };
async function nextTrack() {
  if (!music.list) {
    try { music.list = await (await fetch('music.json')).json(); } catch { music.list = []; }
  }
  if (!music.list.length) return null;
  if (!music.queue.length) music.queue = [...music.list].sort(() => Math.random() - 0.5);
  const file = music.queue.shift();
  music.title = file.replace(/\.[^.]+$/, '');
  return `sounds/music/${encodeURIComponent(file)}`;
}
async function syncMusic() {
  const inGame = !!S && S.phase === 'play';
  music.want = inGame && !sfx.muted && sfx.musicVol > 0 && !music.paused;
  if (inGame && !music.el) {
    if (music.loading) return;
    music.loading = true;
    const src = await nextTrack();
    music.loading = false;
    if (!src || music.el) { renderMusic(); return; }
    music.el = new Audio(src);
    music.el.addEventListener('ended', async () => {
      const next = await nextTrack();
      if (next) { music.el.src = next; syncMusic(); }
    });
    ['timeupdate', 'play', 'pause', 'loadedmetadata'].forEach(ev => music.el.addEventListener(ev, renderMusic));
  }
  if (music.el) {
    music.el.volume = sfx.musicVol * MUSIC_SCALE;
    music.el.muted = music.muted;
    if (!music.want) music.el.pause();
    else if (music.el.paused) music.el.play().catch(() => { /* autoplay blocked: retried on the next click */ });
  }
  renderMusic();
}
document.addEventListener('pointerdown', () => { if (music.want && music.el && music.el.paused) syncMusic(); });

const clock = sec => (Number.isFinite(sec) ? `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}` : '0:00');
function renderMusic() {
  const box = $('#now-playing');
  const show = !!S && S.phase === 'play' && !!music.el;
  box.classList.toggle('hidden', !show);
  if (!show) return;
  const el = music.el;
  const playing = !el.paused;
  box.classList.toggle('playing', playing && !music.muted);
  if ($('#np-title').textContent !== music.title) $('#np-title').textContent = music.title;
  $('#np-fill').style.width = el.duration ? `${(el.currentTime / el.duration) * 100}%` : '0%';
  $('#np-time').textContent = `${clock(el.currentTime)} / ${clock(el.duration)}`;
  $('#np-play .ms').textContent = playing ? 'pause' : 'play_arrow';
  $('#np-play').setAttribute('aria-label', playing ? 'Pause music' : 'Play music');
  $('#np-mute .ms').textContent = music.muted ? 'volume_off' : 'volume_up';
  $('#np-mute').setAttribute('aria-label', music.muted ? 'Unmute music' : 'Mute music');
}
$('#np-play').addEventListener('click', () => {
  music.paused = !!music.el && !music.el.paused;
  if (!music.paused && sfx.muted) { sfx.muted = false; store.set('auraTax.mute', '0'); renderMute(); }
  syncMusic();
});
$('#np-mute').addEventListener('click', () => {
  music.muted = !music.muted;
  store.set('auraTax.musicMute', music.muted ? '1' : '0');
  syncMusic();
});
// Click or drag along the bar to jump in the song.
$('#np-bar').addEventListener('pointerdown', e => {
  const bar = e.currentTarget;
  const seek = ev => {
    const r = bar.getBoundingClientRect();
    if (music.el && music.el.duration) music.el.currentTime = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * music.el.duration;
    renderMusic();
  };
  seek(e);
  bar.setPointerCapture(e.pointerId);
  bar.onpointermove = seek;
  bar.onpointerup = () => { bar.onpointermove = null; };
});

function renderMute() {
  $('#btn-mute .ms').textContent = sfx.muted ? 'volume_off' : 'volume_up';
  $('#btn-mute').title = sfx.muted ? 'Sound off' : 'Sound on';
  $('#btn-mute').setAttribute('aria-label', sfx.muted ? 'Unmute sounds' : 'Mute sounds');
  $('#vol-sfx').value = Math.round(sfx.vol * 100);
  $('#vol-music').value = Math.round(sfx.musicVol * 100);
  renderMenu();
}
renderMute();
function toggleMute() {
  sfx.muted = !sfx.muted;
  store.set('auraTax.mute', sfx.muted ? '1' : '0');
  renderMute();
  syncMusic();
}
$('#btn-mute').addEventListener('click', toggleMute);
$('#vol-sfx').addEventListener('input', e => {
  sfx.vol = e.target.value / 100;
  store.set('auraTax.sfxVol', String(sfx.vol));
  if (audio.out) audio.out.gain.value = sfx.vol;
});
$('#vol-sfx').addEventListener('change', () => playTbagSound((player(myId) || {}).champion, true)); // a sample at the new level
$('#vol-music').addEventListener('input', e => {
  sfx.musicVol = e.target.value / 100;
  store.set('auraTax.musicVol', String(sfx.musicVol));
  syncMusic();
});

// ---------------------------------------------------------------------------
// Stickers (silent)
// ---------------------------------------------------------------------------

// Sticker pictures live in sounds/stickers/<id>/: the first one there (a GIF, PNG, WebP or JPG) shows instead of the icon.
const stickerFiles = {
  images: {},
  load: () => fetch('sticker-files.json').then(r => r.json())
    .then(l => { stickerFiles.images = l.images || {}; renderStickerGrid(); })
    .catch(() => {}),
};
const stickerUrl = (id, file) => `sounds/stickers/${encodeURIComponent(id)}/${encodeURIComponent(file)}`;
const stickerImage = id => (stickerFiles.images[id] ? stickerUrl(id, stickerFiles.images[id][0]) : null);
// The sticker's picture if it has one, otherwise its icon.
const stickerArt = id => {
  const src = stickerImage(id);
  return src ? h('img', { class: 'sticker-img', src, alt: '' }) : ms(STICKERS[id].icon);
};

function closeStickers() {
  $('#sticker-panel').classList.add('hidden');
  $('#btn-stickers').setAttribute('aria-expanded', 'false');
  showGifPicker(false);
}

function renderStickerGrid() {
  $('#sticker-grid').replaceChildren(...Object.entries(STICKERS).map(([id, st]) => h('button', {
    class: 'sticker', type: 'button', style: `--k:${st.c}`, title: st.label,
    onclick: () => { socket.emit('sticker', id); closeStickers(); },
  }, stickerArt(id), h('span', null, st.label))),
  h('button', { class: 'sticker gif-tile', type: 'button', style: '--k:var(--purple)', title: 'Pick any GIF', onclick: () => showGifPicker(true) },
    ms('gif_box'), h('span', null, 'Your GIF')));
}
renderStickerGrid();
stickerFiles.load();

// Opening the panel re-reads the folders, so new files show up without a reload.
$('#btn-stickers').addEventListener('click', () => {
  const open = $('#sticker-panel').classList.toggle('hidden') === false;
  $('#btn-stickers').setAttribute('aria-expanded', String(open));
  if (open) stickerFiles.load();
  else showGifPicker(false);
});
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#stickers')) closeStickers();
});

// ---------------------------------------------------------------------------
// Custom GIF stickers: search (when the server has a GIPHY/Tenor key), recent picks, or a pasted link
// ---------------------------------------------------------------------------
const GIF_RECENT_MAX = 12;
// Same hosts the server accepts; the server has the final say.
const GIF_HOSTS = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com|i\.imgur\.com|media\.discordapp\.net|cdn\.discordapp\.com)\/[^\s"'<>]+$/i;
function cleanGifUrl(raw) {
  let url = String(raw || '').trim();
  const page = url.match(/^https:\/\/giphy\.com\/(?:gifs|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
  if (page) url = `https://media.giphy.com/media/${page[1]}/giphy.gif`;
  url = url.replace(/^(https:\/\/i\.imgur\.com\/\w+)\.gifv$/i, '$1.gif');
  return GIF_HOSTS.test(url) ? url : null;
}
const recentGifs = () => { try { return JSON.parse(store.get('auraTax.recentGifs') || '[]').filter(cleanGifUrl); } catch { return []; } };

function sendGif(url) {
  socket.emit('sticker', { gif: url });
  store.set('auraTax.recentGifs', JSON.stringify([url, ...recentGifs().filter(u => u !== url)].slice(0, GIF_RECENT_MAX)));
  closeStickers();
}

const gifTile = (preview, url) => h('button', { class: 'gif-res', type: 'button', onclick: () => sendGif(url) },
  h('img', { src: preview, alt: '', loading: 'lazy' }));

let gifSearchSeq = 0;
async function gifSearch(q) {
  const seq = ++gifSearchSeq;
  const note = $('#gif-note');
  let res = { enabled: false, results: [] };
  try { res = await (await fetch(`gifs?q=${encodeURIComponent(q)}`)).json(); } catch { res.error = 'GIF search failed'; }
  if (seq !== gifSearchSeq) return; // a newer search already started
  const recent = q ? [] : recentGifs();
  const box = $('#gif-results');
  fill(box,
    recent.length ? h('div', { class: 'gif-label' }, 'Recent') : null, ...recent.map(u => gifTile(u, u)),
    res.results.length ? h('div', { class: 'gif-label' }, q ? 'Results' : 'Trending') : null, ...res.results.map(g => gifTile(g.preview, g.url)));
  note.textContent = !res.enabled ? 'Search is off on this server. Paste a GIF link below instead.'
    : res.error ? res.error
      : q && !res.results.length ? 'No GIFs found.' : '';
}

function showGifPicker(on) {
  $('#sticker-grid').classList.toggle('hidden', on);
  $('#gif-picker').classList.toggle('hidden', !on);
  if (!on) return;
  $('#gif-q').value = '';
  $('#gif-url').value = '';
  gifSearch('');
  if (hoverable.matches) $('#gif-q').focus(); // on phones the keyboard would cover the results
}
$('#gif-back').addEventListener('click', () => showGifPicker(false));
let gifTyping = 0;
$('#gif-q').addEventListener('input', e => {
  clearTimeout(gifTyping);
  gifTyping = setTimeout(() => gifSearch(e.target.value.trim()), 350);
});
$('#gif-link').addEventListener('submit', e => {
  e.preventDefault();
  const url = cleanGifUrl($('#gif-url').value);
  if (url) sendGif(url);
  else $('#gif-note').textContent = 'That link isn\'t a GIF from Giphy, Tenor, Imgur or Discord. Use the direct GIF link (right-click the GIF, Copy image address).';
});

// A sticker pops up over the rider who sent it and follows them for a moment.
// id is one of STICKERS, or gif is a custom GIF link (no label).
function showSticker(pid, id, gif) {
  const st = STICKERS[id];
  const p = player(pid);
  if ((!st && !gif) || !p || !board3d) return;
  document.querySelectorAll(`.sticker-pop[data-pid="${pid}"]`).forEach(el => el.remove());
  const hasImg = !!gif || !!stickerImage(id);
  const el = gif
    ? h('div', { class: 'sticker-pop has-img', 'data-pid': pid, style: `--c:${p.color}` }, h('img', { class: 'sticker-img', src: gif, alt: '' }))
    : h('div', { class: 'sticker-pop' + (hasImg ? ' has-img' : ''), 'data-pid': pid, style: `--k:${st.c};--c:${p.color}` },
      stickerArt(id), h('span', null, st.label));
  document.body.append(el);
  const t0 = performance.now();
  const follow = () => {
    if (!el.isConnected) return;
    const { x, y } = board3d.screenPos(pid, displayPos[pid]);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    const left = (hasImg ? STICKER_GIF_MS : STICKER_MS) - (performance.now() - t0);
    if (left > 0) { el.classList.toggle('leaving', left < 300); requestAnimationFrame(follow); } else el.remove();
  };
  follow();
}

// ---------------------------------------------------------------------------
// T-bag sounds: a random file from sounds/tbag/<champion>/, or from sounds/tbag/default/ if it has none
// ---------------------------------------------------------------------------
const tbagSounds = {
  list: {},
  images: {},
  load: () => fetch('tbag-sounds.json').then(r => r.json())
    .then(l => { tbagSounds.list = l.sounds || {}; tbagSounds.images = l.images || {}; })
    .catch(() => {}),
};
tbagSounds.load();

function playSoundFile(dir, file) {
  playLevelled(`sounds/tbag/${encodeURIComponent(dir)}/${encodeURIComponent(file)}`);
}

// The champion's own T-bag GIF, if its folder has one (no fallback to default/).
const tbagGif = champ => (tbagSounds.images[champ] ? `sounds/tbag/${encodeURIComponent(champ)}/${encodeURIComponent(tbagSounds.images[champ][0])}` : null);

function playTbagSound(champ, force = false) {
  if (sfx.muted && !force) return;
  const dir = tbagSounds.list[champ] ? champ : 'default';
  const files = tbagSounds.list[dir] || [];
  if (files.length) playSoundFile(dir, files[Math.floor(Math.random() * files.length)]);
}

// ---------------------------------------------------------------------------
// Debug menu: press ` (backquote) to open. Server cheats only work for players on the host machine.
// ---------------------------------------------------------------------------
const debug = { el: null, info: null, champ: null, checked: false };

function debugCall(action, args = {}) {
  socket.emit('debug', { action, ...args }, res => toast(res && res.ok ? `Debug: ${action} done` : `Debug: ${(res && res.error) || 'failed'}`));
}

async function renderDebug() {
  await Promise.all([tbagSounds.load(), stickerFiles.load()]);
  if (!debug.info) debug.info = await new Promise(r => socket.emit('debug:info', r));
  const me = player(myId);
  const inGame = !!S && S.phase === 'play' && boardBuilt;
  debug.champ = debug.champ || (me && me.champion) || Object.keys(CHAMPIONS)[0];
  const sel = (options, value, onchange) => h('select', { onchange: e => onchange(e.target.value) },
    options.map(([v, label]) => { const o = h('option', { value: v }, label); o.selected = String(v) === String(value); return o; }));
  const btn = (label, onclick, o = {}) => h('button', { class: 'btn' + (o.primary ? ' primary' : ''), type: 'button', disabled: o.disabled, onclick }, label);
  const row = (...kids) => h('div', { class: 'dbg-row' }, ...kids);

  // T-bag sounds
  const own = tbagSounds.list[debug.champ];
  const dir = own ? debug.champ : 'default';
  const files = tbagSounds.list[dir] || [];
  const soundSec = [
    h('h3', null, 'T-bag sounds'),
    row(sel(Object.keys(CHAMPIONS).map(id => [id, `${CHAMPIONS[id].name} (${(tbagSounds.list[id] || []).length})`]), debug.champ, v => { debug.champ = v; renderDebug(); }),
      btn('Random', () => playTbagSound(debug.champ, true), { primary: true })),
    h('p', { class: 'dbg-hint' }, own ? `public/sounds/tbag/${dir}/` : `No sounds for "${debug.champ}" yet, so default/ plays. Add files to public/sounds/tbag/${debug.champ}/`),
    h('div', { class: 'dbg-files' }, files.length ? files.map(f => btn(h('span', null, ms('play_arrow'), f), () => playSoundFile(dir, f))) : h('span', { class: 'dbg-hint' }, 'No files found')),
    tbagGif(debug.champ)
      ? row(h('img', { class: 'dbg-gif', src: tbagGif(debug.champ), alt: '' }),
        btn('Show GIF on me', () => showSticker(myId, null, tbagGif(debug.champ)), { disabled: !inGame || !me }))
      : h('p', { class: 'dbg-hint' }, 'No T-bag GIF for this champion (put a .gif or .webp in its folder).'),
    row(btn('Reload folders', renderDebug)),
  ];

  // Stickers
  const stickerSec = [
    h('h3', null, 'Stickers'),
    h('p', { class: 'dbg-hint' }, 'Put a GIF/PNG in public/sounds/stickers/<sticker>/ to show it instead of the icon. With GIF: '
      + (Object.keys(STICKERS).filter(id => stickerFiles.images[id]).map(id => STICKERS[id].label).join(', ') || 'none')),
    row(h('span', { class: 'dbg-label' }, 'Send'), sel(Object.entries(STICKERS).map(([id, st]) => [id, st.label]), debug.sticker || Object.keys(STICKERS)[0], v => (debug.sticker = v)),
      btn('Send sticker', () => socket.emit('sticker', debug.sticker || Object.keys(STICKERS)[0]), { disabled: !inGame || !me })),
  ];

  // Client-only effects
  const others = S ? S.players.filter(p => p.id !== myId) : [];
  const fxSec = [
    h('h3', null, 'Effects (only on your screen)'),
    row(btn('T-bag animation', () => tbagFx(myId, (others[0] || {}).id), { disabled: !inGame || !me }),
      btn('Confetti', confetti),
      btn('Banner', () => showBanner({ title: 'TEST BANNER', sub: 'This is what a pop-up looks like', kind: 'tbag', pid: myId })),
      btn('Your turn', yourTurn),
      ...['gain', 'loss', 'turn', 'alarm', 'card', 'dice'].map(s => btn(s, () => { unlockAudio(); setTimeout(() => sfxUi(s), 30); }))),
  ];

  // Server cheats
  let srvSec;
  if (!debug.info || !debug.info.allowed) {
    srvSec = [h('h3', null, 'Cheats'), h('p', { class: 'dbg-hint' }, 'Off: only for players on the machine running the server (or start it with AURA_DEBUG=1).')];
  } else {
    const st = { card: debug.info.cards[0].key, tile: 0, victim: (others[0] || {}).id };
    srvSec = [
      h('h3', null, 'Cheats (real, everyone sees them)'),
      row(h('span', { class: 'dbg-label' }, 'Champion'), sel(Object.keys(CHAMPIONS).map(id => [id, CHAMPIONS[id].name]), me && me.champion, v => debugCall('champion', { id: v }))),
      row(h('span', { class: 'dbg-label' }, 'Aura'), ...[-50, -10, 10, 50].map(n => btn(n > 0 ? `+${n}` : String(n), () => debugCall('aura', { amount: n }), { disabled: !inGame }))),
      row(h('span', { class: 'dbg-label' }, 'Next roll'), ...[1, 2, 3, 4, 5, 6].map(n => btn(String(n), () => debugCall('roll', { value: n }), { disabled: !inGame }))),
      row(sel(debug.info.cards.map(c => [c.key, `${c.title} (${c.kind})`]), st.card, v => (st.card = v)), btn('Give card', () => debugCall('card', { key: st.card }), { disabled: !inGame })),
      row(sel(debug.info.tiles.map(t => [t.i, `${t.i}: ${t.name}`]), st.tile, v => (st.tile = v)), btn('Teleport', () => debugCall('teleport', { tile: st.tile }), { disabled: !inGame })),
      row(sel(others.map(p => [p.id, p.name]), st.victim, v => (st.victim = v)), btn('T-bag them', () => debugCall('tbag', { victim: st.victim }), { disabled: !inGame || !others.length })),
      inGame ? null : h('p', { class: 'dbg-hint' }, 'Most cheats need a game in progress.'),
    ];
  }

  fill(debug.el,
    h('div', { class: 'row-between' }, h('strong', null, ms('bug_report'), ' Debug'),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', onclick: toggleDebug }, ms('close'))),
    ...soundSec, ...stickerSec, ...fxSec, ...srvSec);
}

function toggleDebug() {
  if (!debug.el) {
    debug.el = h('div', { class: 'panel debug-panel hidden', role: 'dialog', 'aria-label': 'Debug menu' });
    document.body.append(debug.el);
  }
  const open = debug.el.classList.toggle('hidden') === false;
  if (open) renderDebug();
}

// The key left of 1 (any keyboard layout), or Ctrl+Shift+D. On the server's own machine there's also a bug button.
document.addEventListener('keydown', e => {
  const hit = e.code === 'Backquote' || e.key === '`' || (e.ctrlKey && e.shiftKey && e.code === 'KeyD');
  if (!hit || e.target.closest('input, textarea, select')) return;
  e.preventDefault();
  toggleDebug();
});
const debugFab = () => h('button', { class: 'debug-fab icon-btn', type: 'button', title: 'Debug menu (` or Ctrl+Shift+D)', 'aria-label': 'Debug menu', onclick: toggleDebug }, ms('bug_report'));

// ---------------------------------------------------------------------------
// Champion close-up: rest the mouse on a champion for a second (or press and hold one) to see it big
// ---------------------------------------------------------------------------
const ZOOM_DELAY_MS = 1000;
const HOLD_MS = 420;
const zoom = { view: null, timer: 0, id: null, held: false, hold: null };

function openZoom(id) {
  const me = player(myId);
  const color = me ? me.color : S.colors[0];
  zoom.view = zoom.view || createZoomView($('#champ-zoom-canvas'));
  zoom.id = id;
  $('#champ-zoom-name').textContent = CHAMPIONS[id].name;
  $('#champ-zoom-name').classList.toggle('mythic', !!CHAMPIONS[id].mythic);
  $('#champ-zoom-blurb').textContent = CHAMPIONS[id].blurb;
  $('#champ-zoom').classList.remove('hidden');
  zoom.view.show(id, color);
}

function closeZoom() {
  clearTimeout(zoom.timer);
  zoom.id = null;
  $('#champ-zoom').classList.add('hidden');
  if (zoom.view) zoom.view.stop();
}

// The picker re-renders on every lobby update, so listen on the grid rather than each button.
const champPicker = $('#champ-picker');
champPicker.addEventListener('pointerover', e => {
  const b = e.target.closest('.champ');
  if (!b || e.pointerType !== 'mouse') return;
  if (zoom.id === b.dataset.id) return;
  closeZoom();
  zoom.timer = setTimeout(() => openZoom(b.dataset.id), ZOOM_DELAY_MS);
});
champPicker.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') closeZoom(); });
// Touch: press and hold for the close-up, let go to close it (a hold doesn't pick the champion).
champPicker.addEventListener('pointerdown', e => {
  const b = e.target.closest('.champ');
  if (e.pointerType === 'mouse') { closeZoom(); return; }
  if (!b) return;
  zoom.held = false;
  zoom.hold = { x: e.clientX, y: e.clientY };
  clearTimeout(zoom.timer);
  zoom.timer = setTimeout(() => { zoom.held = true; openZoom(b.dataset.id); buzz(15); }, HOLD_MS);
});
champPicker.addEventListener('pointermove', e => {
  if (!zoom.hold || e.pointerType === 'mouse') return;
  if (Math.hypot(e.clientX - zoom.hold.x, e.clientY - zoom.hold.y) > 12) { clearTimeout(zoom.timer); zoom.hold = null; } // scrolling
});
for (const ev of ['pointerup', 'pointercancel']) {
  champPicker.addEventListener(ev, e => {
    if (e.pointerType === 'mouse') return;
    clearTimeout(zoom.timer);
    zoom.hold = null;
    if (zoom.id) closeZoom();
  });
}
champPicker.addEventListener('contextmenu', e => e.preventDefault());

// Switching between the phone and desktop layouts (rotating a tablet, resizing a window): redraw for the new one.
for (const mq of [desktop, sideways, hoverable]) {
  mq.addEventListener('change', () => {
    selecting = null;
    picking = false;
    closeSheet();
    setExpanded(false);
    closeMenu();
    if (S && S.phase !== 'lobby') renderGame();
    measureHud();
  });
}
