import { createBoard, createMotes, DICE_STYLE_IDS, diceStyleName, dicePreview } from './board3d.js';
import { createAttract } from './attract.js';
import { pixelLogo } from './pixel-logo.js';
import { CHAMPIONS, championCanvas, championPortrait, createZoomView } from './champions.js';

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

let S = null; // latest server state
let myId = null;
let boardBuilt = false;
let board3d = null;
let overDismissed = false;
let selecting = null; // uid of the card I'm about to play
let picking = false; // pressed Play card: the playable cards are highlighted
const displayPos = {};
const animating = {};

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
const ms = name => h('span', { class: 'ms', 'aria-hidden': 'true' }, name);
const initial = name => (name || '?').trim().charAt(0) || '?';
// A player's picture: their champion's portrait in their colour, or their initial if they have none.
const avatar = p => (p.champion
  ? h('div', { class: 'avatar pic', style: `--c:${p.color}` }, h('img', { src: championPortrait(p.champion, p.color), alt: '' }))
  : h('div', { class: 'avatar', style: `--c:${p.color}` }, initial(p.name)));
const player = id => S && S.players.find(p => p.id === id);
const spectating = () => !!S && S.spectators.some(s => s.id === myId);
const hand = () => (S && S.me ? S.me.hand : []);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

function showScreen(name) {
  $$('.screen').forEach(s => s.classList.toggle('active', s.id === `screen-${name}`));
  attract.setScreen(name);
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

function enter() {
  if (!nameInput.value.trim()) { nameInput.focus(); $('#home-err').textContent = 'Pick a name first.'; return; }
  socket.emit('join', { name: myName(), token }, enterRoom);
}
$('#btn-enter').addEventListener('click', enter);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });

function leave() {
  socket.emit('leave');
  store.del('auraTax.joined');
  S = null;
  myId = null;
  $('#over').classList.add('hidden');
  $('#react-bar').classList.add('hidden');
  showScreen('home');
}
$('#btn-leave-lobby').addEventListener('click', leave);
$('#btn-leave-over').addEventListener('click', leave);
$('#btn-end-game').addEventListener('click', () => {
  if (confirm('End the game for everyone? Whoever has the most aura wins.')) socket.emit('endgame');
});
$('#btn-leave-game').addEventListener('click', () => {
  if (confirm(spectating() ? 'Stop watching?' : 'Leave the game? Your camel goes on autopilot.')) leave();
});

$('#btn-start').addEventListener('click', () => socket.emit('start'));
$('#btn-roll').addEventListener('click', () => { $('#btn-roll').disabled = true; socket.emit('roll'); });
$('#btn-end').addEventListener('click', () => { selecting = null; picking = false; socket.emit('end'); });
$('#btn-play').addEventListener('click', () => { picking = true; renderGame(); });
$('#btn-again').addEventListener('click', () => socket.emit('lobby'));
$$('.deck-btn').forEach(d => d.addEventListener('click', () => socket.emit('draw', d.dataset.deck)));
$('#btn-view-board').addEventListener('click', () => { overDismissed = true; $('#over').classList.add('hidden'); renderCenter(); });

for (const [sel, list, key] of [['#set-target', TARGETS, 'target'], ['#set-rounds', ROUNDS, 'rounds']]) {
  const el = $(sel);
  list.forEach(v => el.append(h('option', { value: v }, key === 'target' ? `${v} aura` : `${v} rounds`)));
  el.addEventListener('change', () => socket.emit('settings', {
    target: $('#set-target').value, rounds: $('#set-rounds').value,
  }));
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (selecting) { selecting = null; if (S) renderGame(); }
  }
  const roll = $('#btn-roll');
  if ((e.key === ' ' || e.key === 'Enter') && document.activeElement === document.body && !roll.disabled
    && !roll.closest('.hidden') && $('#screen-game').classList.contains('active')) {
    e.preventDefault();
    roll.click();
  }
});

// ---------------------------------------------------------------------------
// Socket events
// ---------------------------------------------------------------------------
socket.on('connect', () => {
  if (store.get('auraTax.joined')) socket.emit('join', { name: myName(), token }, res => {
    if (res && res.ok) enterRoom(res);
    else { store.del('auraTax.joined'); showScreen('home'); }
  });
});

socket.on('state', s => {
  const prev = S;
  S = s;
  syncMusic();
  if (!myId || (!player(myId) && !spectating())) return;
  if (s.phase === 'lobby') {
    overDismissed = false;
    selecting = null;
    $('#over').classList.add('hidden');
    $('#react-bar').classList.add('hidden');
    showScreen('lobby');
    renderLobby();
    return;
  }
  if (!boardBuilt) buildBoard();
  if (s.phase === 'play' && (!prev || prev.phase !== 'play')) {
    for (const k of Object.keys(displayPos)) delete displayPos[k];
    overDismissed = false;
  }
  closeZoom();
  showScreen('game');
  renderGame();
  if (s.phase === 'play' && s.currentId === myId && prev && prev.currentId !== myId) {
    showBanner({ title: 'Your turn', sub: 'Draw, roll, play a card, end your turn', kind: 'turn', pid: myId });
  }
});

socket.on('fx', f => {
  if (f.type === 'toast') { toast(f.text); return; }
  if (!S || !boardBuilt) return;
  switch (f.type) {
    case 'dice': rollDie(f.value, f.value2, (player(f.pid) || {}).dice); break;
    case 'move': animateMove(f.pid, f.path); break;
    case 'teleport': teleportToken(f.pid, f.to); break;
    case 'float': floatText(f.pid, f.text, f.good); break;
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
  S.players.forEach(p => list.append(h('li', p.bot ? { class: 'bot' } : null,
    avatar(p),
    h('span', { class: 'nm' }, p.name),
    p.id === myId ? h('span', { class: 'tag' }, 'you') : null,
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
  champs.replaceChildren(...S.champions.map(id => h('button', {
    class: 'champ' + (mine === id ? ' sel' : '') + (CHAMPIONS[id].mythic ? ' mythic' : ''),
    type: 'button',
    disabled: !me,
    'data-id': id,
    'aria-label': CHAMPIONS[id].name,
    onclick: () => socket.emit('champion', id),
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
  start.classList.toggle('hidden', !me);
  start.disabled = S.players.length < 2;
  $('#lobby-wait').textContent = me ? '' : 'The lobby is full. You get the next free seat.';
}

// ---------------------------------------------------------------------------
// Board (3D, see board3d.js)
// ---------------------------------------------------------------------------
const desktop = matchMedia('(min-width: 1001px)');

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

// The parts of the stage covered by HUD panels, so the camera frames the board in the free space.
function hudInsets() {
  if (!desktop.matches) return { top: 0, right: 0, bottom: 0, left: 0 };
  const stage = $('#stage').getBoundingClientRect();
  const side = $('.side').getBoundingClientRect();
  const bottom = $('#hud-bottom').getBoundingClientRect();
  // Keep the same space free on both sides so the board sits in the middle of the screen.
  const sideW = stage.right - side.left;
  return {
    top: 0,
    right: sideW,
    bottom: stage.bottom - bottom.top,
    left: sideW,
  };
}

// One hover tip for board tiles and for anything with a data-tip attribute.
function showTip(t) {
  const tip = $('#tip');
  if (!t) { tip.classList.add('hidden'); return; }
  tip.classList.remove('hidden');
  tip.replaceChildren(t.title ? h('b', null, t.title) : '', h('div', null, t.text));
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(innerWidth - r.width - 8, t.x + 14)) + 'px';
  tip.style.top = Math.max(8, Math.min(innerHeight - r.height - 8, t.y + 14)) + 'px';
}
let tipEl = null;
document.addEventListener('mouseover', e => {
  const el = e.target.closest ? e.target.closest('[data-tip]') : null;
  if (el === tipEl) return;
  tipEl = el;
  if (!el) { showTip(null); return; }
  const r = el.getBoundingClientRect();
  showTip({ title: el.dataset.tipTitle, text: el.dataset.tip, x: r.left - 14, y: r.bottom - 6 });
});

function buildBoard() {
  board3d = createBoard($('#stage'), {
    insets: hudInsets,
    watch: [$('#hud-bottom'), $('.side')],
    onDeck: k => socket.emit('draw', k),
    onHover: hv => { if (!tipEl) showTip(hv && { title: hv.tile.name, text: hv.tile.desc, x: hv.x, y: hv.y }); },
  });
  board3d.build(S.board);
  board3d.scene.add(createMotes()); // the gold dust from the intro, in the game too
  boardBuilt = true;
}

function leaderId() {
  const top = [...S.players].sort((a, b) => b.aura - a.aura);
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
    current: p.id === S.currentId, faded: !p.connected || p.smurf,
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
  renderTokens();
  renderTaxDots();
  renderCenter();
  renderHand();
  renderReaction();
  renderPlayers();
  renderOver();
  $('#btn-end-game').classList.toggle('hidden', !player(myId) || S.phase !== 'play');
}

const myTurn = () => S.phase === 'play' && S.currentId === myId;
const owed = () => (S.me ? S.me.draws : []);
// Holding more than the limit: you must throw cards away first.
const tooMany = () => hand().length - S.handLimit;
const canAct = () => myTurn() && !owed().length && tooMany() <= 0 && !S.busy && !S.pending && !S.reaction && !S.vote && S.actionsLeft > 0;
// Cards come after the roll: Draw -> Roll -> Play card -> End turn.
const canPlayCard = () => canAct() && S.rolled && hand().some(c => c.playable);
const blocked = () => S.busy || !!S.pending || !!S.reaction || !!S.vote;

// Which of the 3 steps the current rider is on (null when it isn't your turn).
function currentStep() {
  if (!myTurn()) return null;
  if (owed().length || tooMany() > 0) return 'draw';
  return S.rolled ? 'play' : 'roll';
}

// Drop a half-picked card when it's no longer possible.
function tidyLocalState() {
  if (!canPlayCard()) { selecting = null; picking = false; return; }
  const uids = new Set(hand().map(c => c.uid));
  if (selecting && !uids.has(selecting)) selecting = null;
}

const playerLabel = p => [avatar(p), `${p.name} · ${p.aura}`];

function optionLabel(card, v) {
  if (card.target === 'player') {
    const p = player(v);
    return p ? playerLabel(p) : ['?'];
  }
  if (card.target === 'tile') {
    const here = S.players.filter(p => p.pos === v).map(p => p.name).join(', ');
    return [S.board[v].name, h('small', null, ` · ${here}`)];
  }
  if (card.target === 'steps') return [`${v} back`];
  if (card.target === 'ahead') return [`${v} tile${v === 1 ? '' : 's'}`];
  return [String(v)];
}

// One chooser in the center of the board, used for every "pick something" moment.
function showChooser(title, text, buttons, icon) {
  $('#choose').classList.remove('hidden');
  $('#choose-title').replaceChildren(icon ? ms(icon) : '', title);
  $('#choose-text').textContent = text || '';
  $('#choose-list').replaceChildren(...buttons.map(b => h('button', {
    class: `btn${b.primary ? ' primary' : ''}${b.ghost ? ' ghost' : ''}`,
    disabled: b.disabled,
    onclick: b.onclick,
  }, ...[].concat(b.label))));
}

function renderCenter() {
  renderDecks();
  renderActions();
}

// Everything you can do lives in the action panel: steps, instructions, picks and buttons.
function renderActions() {
  const c = player(S.currentId);
  const isMe = myTurn();
  const ch = $('#choose');
  const waitEl = $('#waiting');
  const btns = $('#turn-btns');
  ch.classList.add('hidden');
  btns.classList.add('hidden');
  waitEl.replaceChildren();
  waitEl.classList.remove('step');
  renderSteps();

  const pend = S.pending;
  const v = S.vote;
  const myCards = hand();

  if (S.phase === 'over') {
    waitEl.append(h('button', { class: 'btn small', onclick: () => { overDismissed = false; renderOver(); } }, 'Show results'));
  } else if (v && v.voters.includes(myId) && !v.voted.includes(myId)) {
    showChooser('Server vote', 'Who gets sent to the Booster Ambush?', S.players.filter(p => p.id !== myId).map(p => ({
      label: playerLabel(p),
      onclick: () => socket.emit('vote', p.id),
    })), 'how_to_vote');
  } else if (v) {
    waitEl.textContent = `Server vote: ${v.voted.length} of ${v.voters.length} voted`;
  } else if (pend && pend.pid === myId) {
    const choose = id => { socket.emit('choose', id); ch.classList.add('hidden'); };
    if (pend.kind === 'arena') {
      showChooser('1v1', 'Pick who to fight. You both roll, the higher roll steals 12 aura.', pend.options.map(id => {
        const p = player(id);
        return { label: p ? playerLabel(p) : '?', onclick: () => choose(id) };
      }), 'swords');
    } else if (pend.kind === 'gloat') {
      showChooser('You won the 1v1', 'T-bag them for 3 more aura?', [
        { label: 'T-bag (+3)', primary: true, onclick: () => choose('tbag') },
        { label: 'Let them go', onclick: () => choose('spare') },
      ], 'emoji_events');
    } else if (pend.kind === 'shop') {
      const labels = { guard: 'Guard card · 15', attack: 'Attack card · 15', legend: 'Legendary · 40', skip: 'No thanks' };
      showChooser('Card shop', '', pend.options.map(o => ({ label: labels[o], onclick: () => choose(o) })), 'storefront');
    } else if (pend.kind === 'snitch') {
      const peek = (S.me && S.me.peek) || [];
      showChooser('Snitch', 'This is their hand. Take one card.', peek.map(cd => ({
        label: [ms(KINDS[cd.kind].icon), cd.title], onclick: () => choose(cd.uid),
      })), 'visibility');
    }
  } else if (pend) {
    const p = player(pend.pid);
    const what = { arena: 'picking a 1v1 opponent', gloat: 'deciding whether to T-bag', shop: 'in the card shop', snitch: 'looking through a hand' }[pend.kind] || 'deciding';
    waitEl.textContent = `${p ? p.name : 'Someone'} is ${what}`;
  } else if (S.reaction) {
    waitEl.textContent = `${S.reaction.desc}. Waiting for reactions.`;
  } else if (isMe && selecting) {
    const card = myCards.find(x => x.uid === selecting);
    const play = arg => { socket.emit('play', { uid: card.uid, arg }); selecting = null; picking = false; ch.classList.add('hidden'); };
    const cancel = { label: 'Cancel', onclick: () => { selecting = null; renderGame(); } };
    showChooser(card.title, card.text, card.options
      ? [...card.options.map(o => ({ label: optionLabel(card, o), onclick: () => play(o) })), cancel]
      : [{ label: 'Play', primary: true, onclick: () => play(null) }, cancel],
    KINDS[card.kind].icon);
  } else if (isMe && S.phase === 'play') {
    const step = currentStep();
    btns.classList.remove('hidden');
    const roll = $('#btn-roll');
    const playBtn = $('#btn-play');
    const end = $('#btn-end');
    // One flow: step 2 lights up Roll, step 3 lights up both Play card and End turn.
    roll.classList.toggle('primary', step === 'roll');
    playBtn.classList.toggle('primary', step === 'play');
    end.classList.toggle('primary', step === 'play');
    roll.disabled = !(canAct() && !S.rolled);
    playBtn.disabled = !canPlayCard();
    end.disabled = blocked() || step !== 'play';
    waitEl.classList.add('step');
    waitEl.textContent = tooMany() > 0 ? 'Too many cards: tap one in your hand to throw it away'
      : { draw: 'Draw from a glowing deck on the table', roll: 'Roll the die', play: 'Play a card or end your turn' }[step];
  } else if (spectating()) {
    waitEl.textContent = "You're watching. You'll get a seat next game.";
  } else if (c && !c.connected) {
    waitEl.textContent = `${c.name} is away. Autopilot is playing for them.`;
  } else if (c) {
    waitEl.textContent = `Waiting for ${c.name}`;
  }
}

const STEP_ICONS = ['style', 'casino', 'playing_cards'];
function renderSteps() {
  const at = ['draw', 'roll', 'play'].indexOf(currentStep());
  $('#steps').classList.toggle('hidden', !myTurn());
  $$('#steps li').forEach((li, i) => {
    li.classList.toggle('now', i === at);
    li.classList.toggle('done', at > -1 && i < at);
    li.querySelector('.ms').textContent = at > -1 && i < at ? 'check_circle' : STEP_ICONS[i];
  });
}

// The decks on the table glow when you can draw; the buttons in the action panel do the same thing.
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
  $('#draw-btns').classList.toggle('hidden', !any);
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

// Small circle in the top-right corner of a card: how strong it is, 1 to 4.
const POWER_TIPS = ['', 'Weak card', 'Solid card', 'Strong card', 'Legendary: the strongest cards'];
const powerDot = n => (n ? h('span', { class: `pw pw-${n}`, 'data-tip': `Power ${n} of 4. ${POWER_TIPS[n]}` }, String(n)) : null);

function renderHand() {
  const wrap = $('#hand-wrap');
  const isRider = !!player(myId);
  wrap.classList.toggle('hidden', !isRider || S.phase !== 'play');
  if (!isRider) return;
  const cards = hand();
  const ok = canPlayCard();
  const n = owed().length;
  const toss = !n && tooMany() > 0;
  $('#hand-hint').textContent = toss ? 'Tap a card to throw it away' : '';
  const box = $('#hand');
  // Fan the cards out in an arc, like holding them: tilt by distance from the middle, outer cards sit lower.
  const mid = (cards.length - 1) / 2;
  box.replaceChildren(...cards.map((cd, i) => {
    const off = i - mid;
    return h('button', {
      class: `hcard k-${cd.kind}${selecting === cd.uid ? ' sel' : ''}${toss ? ' toss' : ok && cd.playable ? ` usable${picking ? ' pick' : ''}` : ''}`,
      type: 'button',
      style: `--rot:${off * 6}deg;--drop:${Math.abs(off) * Math.abs(off) * 5}px;z-index:${i + 1}`,
      onclick: () => {
        if (toss) {
          socket.emit('discard', cd.uid);
        } else if (!canPlayCard()) {
          return;
        } else if (cd.kind === 'react') {
          return toast('Reactions are played when someone comes for you');
        } else if (!cd.playable) {
          return toast(`${cd.title} has no valid target right now`);
        } else {
          selecting = selecting === cd.uid ? null : cd.uid;
        }
        renderGame();
      },
    },
    powerDot(cd.power),
    h('span', { class: 'ms hi', 'aria-hidden': 'true' }, KINDS[cd.kind].icon),
    h('div', { class: 'ht' }, cd.title),
    h('div', { class: 'hx' }, cd.text),
    h('div', { class: 'hk' }, KINDS[cd.kind].label));
  }));
  if (!cards.length) box.append(h('div', { class: 'empty' }, 'No cards'));
}

function renderReaction() {
  const bar = $('#react-bar');
  const r = S.reaction;
  const mine = S.me && S.me.react;
  if (!r || !mine || !mine.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  $('#react-desc').textContent = `${r.desc}. React?`;
  const cards = hand().filter(c => mine.includes(c.uid));
  $('#react-list').replaceChildren(
    ...cards.map(c => h('button', { class: 'btn primary', title: c.text, onclick: () => { socket.emit('react', c.uid); bar.classList.add('hidden'); } }, ms('shield'), c.title)),
    h('button', { class: 'btn ghost', onclick: () => { socket.emit('react', null); bar.classList.add('hidden'); } }, 'Skip'));
  setTimer($('#react-timer'), r.timeLeft, r.timeTotal);
}

// Small icon + text pairs under a player's name. Only shows what's actually going on.
function statusOf(p) {
  const owner = player(p.owner);
  const hostages = S.players.filter(o => o.owner === p.id).length;
  const duo = player(p.duoWith);
  const cover = player(p.coverId);
  const st = (icon, text, cls, title, tip) => h('span', { class: cls || null, 'data-tip-title': title, 'data-tip': tip }, ms(icon), text);
  return [
    st('style', p.handCount, null, 'Cards', `${p.handCount} card${p.handCount === 1 ? '' : 's'} in hand.`),
    owner ? st('link', `pays ${owner.name}`, 'bad', 'Aura tax', `Pays ${owner.name} aura tax every turn, until they steal back or play Betrayal.`) : null,
    hostages ? st('payments', `taxing ${hostages}`, 'good', 'Collecting tax', `Collects aura tax from ${hostages} rider${hostages === 1 ? '' : 's'} every turn.`) : null,
    duo ? st('group', `with ${duo.name}`, null, 'Duo', `Dragging ${duo.name} along: they land wherever this rider lands.`) : null,
    p.deathnote ? st('menu_book', p.deathnote, 'bad', 'Deathnote', `In Osoka's Deathnote: loses aura every turn for ${p.deathnote} more turn${p.deathnote === 1 ? '' : 's'}.`) : null,
    p.marked ? st('photo_camera', '', 'bad', 'Screenshotted', 'The next attack on them does double.') : null,
    p.smurf ? st('visibility_off', '', null, 'Smurf account', 'Nobody can target them until their next turn.') : null,
    p.booster ? st('sports_martial_arts', 'booster', 'good', 'Booster', 'Has the booster: their T-bags hit double.') : null,
    p.hunted ? st('my_location', 'hunted', 'bad', 'Hunted', 'In the Deathnote hunt: T-bags on them hit x3.') : null,
    cover ? st('handshake', 'covered by ' + cover.name, 'good', 'Covered', `${cover.name} takes every bit of aura this rider would lose.`) : null,
    !p.connected ? st('bedtime', 'away', null, 'Away', 'Disconnected. Autopilot is playing for them.') : null,
  ];
}

function renderPlayers() {
  const box = $('#players');
  box.replaceChildren();
  const lead = leaderId();
  for (const p of S.players) {
    box.append(h('div', { class: `prow${p.id === S.currentId ? ' current' : ''}${p.connected ? '' : ' afk'}` },
      avatar(p),
      h('div', { class: 'pinfo' },
        h('div', { class: 'pname' },
          h('span', { class: 'n' }, p.name),
          p.id === lead ? h('span', { class: 'ms', 'data-tip-title': 'Leader', 'data-tip': 'Has the most aura right now.' }, 'workspace_premium') : null,
          p.id === myId ? h('span', { class: 'tag' }, 'you') : null,
          p.bot ? h('span', { class: 'tag' }, 'bot') : null),
        h('div', { class: 'pstat' }, statusOf(p))),
      h('div', { class: `paura${p.aura < 0 ? ' neg' : ''}` }, String(p.aura))));
  }
  if (S.spectators.length) {
    box.append(h('div', { class: 'specs muted' }, `Watching: ${S.spectators.map(s => s.name).join(', ')}`));
  }
}

function renderOver() {
  const over = $('#over');
  if (S.phase !== 'over' || overDismissed) { over.classList.add('hidden'); return; }
  over.classList.remove('hidden');
  const w = player(S.winnerId);
  $('#over-winner').textContent = w ? w.name : '?';
  const ranks = $('#over-ranks');
  ranks.replaceChildren();
  [...S.players].sort((a, b) => b.aura - a.aura).forEach((p, i) => ranks.append(h('li', null,
    h('span', { class: 'rk' }, String(i + 1)),
    avatar(p),
    h('div', { class: 'nm' }, p.name,
      h('div', { class: 'st' }, `${p.stats.tbags} T-bags · ${p.stats.stolen} stolen · ${p.stats.cards} cards`)),
    h('span', { class: 'au' }, String(p.aura)))));
  const watching = spectating();
  $('#btn-again').classList.toggle('hidden', watching);
  $('#over-wait').textContent = watching ? "You'll get a seat once someone goes back to the lobby." : '';
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------
function rollDie(value, value2, style) {
  board3d.roll(value2 ? Math.max(value, value2) : value, undefined, style).then(() => {
    if (value2) showBanner({ title: `${value} + ${value2}`, sub: `Zoomies: ${value + value2} tiles`, kind: 'good' });
  });
}

function floatText(pid, text, good) {
  const { x, y } = board3d.screenPos(pid, displayPos[pid]);
  const el = h('div', { class: `float ${good ? 'good' : 'bad'}`, style: `left:${x}px;top:${y}px` }, text);
  document.body.append(el);
  setTimeout(() => el.remove(), 1600);
}

const POPUP_MS = 5000;

// Pop-ups stay for 5 seconds (or until you press X). Up to 3 stack at once, tinted with the player's colour.
function showBanner(b) {
  const box = $('#banners');
  const p = player(b.pid);
  const el = h('div', { class: 'banner', role: 'status', style: p ? `--c:${p.color}` : null },
    h('button', { class: 'icon-btn x', type: 'button', 'aria-label': 'Close', onclick: () => el.remove() }, ms('close')),
    h('div', { class: 'bt' }, b.title), b.sub ? h('div', { class: 'bs' }, b.sub) : null);
  box.append(el);
  while (box.childElementCount > 3) box.firstElementChild.remove();
  setTimeout(() => el.remove(), POPUP_MS);
}

function tbagFx(thief, victim) {
  board3d.tbag(thief);
  board3d.shake(victim);
  const p = player(thief);
  if (!p) return;
  playTbagSound(p.champion);
  const gif = tbagGif(p.champion);
  if (gif) showSticker(thief, null, gif);
}

function showCard(f) {
  const p = player(f.pid);
  const t = player(f.target);
  const k = KINDS[f.kind] || KINDS.social;
  const pop = $('#card-pop');
  pop.className = `card-pop k-${f.kind}`;
  pop.style.cssText = p ? `--c:${p.color}` : '';
  pop.replaceChildren(
    h('button', { class: 'icon-btn x', type: 'button', 'aria-label': 'Close', onclick: () => pop.classList.add('hidden') }, ms('close')),
    powerDot(f.power),
    h('div', { class: 'ck' }, ms(k.icon), f.label || k.label),
    h('div', { class: 'ct' }, f.title),
    h('div', { class: 'cx' }, f.text),
    p ? h('div', { class: 'cw' }, `${p.name}${t ? ` → ${t.name}` : ''}`) : null);
  clearTimeout(showCard.t);
  showCard.t = setTimeout(() => pop.classList.add('hidden'), POPUP_MS);
}

function duelFx(f) {
  const a = player(f.a);
  const b = player(f.b);
  if (!a || !b) return;
  showBanner({ title: `${f.ra} vs ${f.rb}`, sub: `${a.name} vs ${b.name}`, kind: 'tbag' });
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
// Sound: T-bag effects and the game's music. The mute button and sliders live in the sticker panel.
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

// Music: everything in sounds/music/, shuffled and looped, only while a game is being played.
// The player in the top-left of the game screen shows the track and lets you pause, mute and seek.
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
    const src = await nextTrack();
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
  $('#np-title').textContent = music.title;
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
  $('#vol-sfx').value = Math.round(sfx.vol * 100);
  $('#vol-music').value = Math.round(sfx.musicVol * 100);
}
renderMute();
$('#btn-mute').addEventListener('click', () => {
  sfx.muted = !sfx.muted;
  store.set('auraTax.mute', sfx.muted ? '1' : '0');
  renderMute();
  syncMusic();
});
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
  if ($('#sticker-panel').classList.toggle('hidden') === false) stickerFiles.load();
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
  box.replaceChildren(
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
  $('#gif-q').focus();
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
const debug = { el: null, info: null, champ: null };

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
      btn('Banner', () => showBanner({ title: 'TEST BANNER', sub: 'This is what a pop-up looks like', kind: 'tbag', pid: myId }))),
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

  debug.el.replaceChildren(
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

// The key left of 1 (any keyboard layout), or Ctrl+Shift+D. There's also a bug button in the corner.
document.addEventListener('keydown', e => {
  const hit = e.code === 'Backquote' || e.key === '`' || (e.ctrlKey && e.shiftKey && e.code === 'KeyD');
  if (!hit || e.target.closest('input, textarea, select')) return;
  e.preventDefault();
  toggleDebug();
});
document.body.append(h('button', { class: 'debug-fab icon-btn', type: 'button', title: 'Debug menu (` or Ctrl+Shift+D)', 'aria-label': 'Debug menu', onclick: toggleDebug }, ms('bug_report')));

// ---------------------------------------------------------------------------
// Champion close-up: rest the mouse on a champion for a second to see it big
// ---------------------------------------------------------------------------
const ZOOM_DELAY_MS = 1000;
const zoom = { view: null, timer: 0, id: null };

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
$('#champ-picker').addEventListener('pointerover', e => {
  const b = e.target.closest('.champ');
  if (!b || e.pointerType === 'touch') return;
  if (zoom.id === b.dataset.id) return;
  closeZoom();
  zoom.timer = setTimeout(() => openZoom(b.dataset.id), ZOOM_DELAY_MS);
});
$('#champ-picker').addEventListener('pointerleave', closeZoom);
$('#champ-picker').addEventListener('pointerdown', closeZoom);
