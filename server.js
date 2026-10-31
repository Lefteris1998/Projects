'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Server } = require('socket.io');

// Optional .env next to this file (KEY=value lines). Real environment variables win, so Render's settings apply there.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch { /* no .env */ }

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000 });

app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules/three/build')));
app.get('/health', (req, res) => res.send('ok'));

// Media folders: public/sounds/tbag/<champion>/ (default/ for champions with none) holds sounds;
// public/sounds/stickers/<sticker>/ optionally holds a picture (a GIF shows instead of the icon).
// Read fresh on every request so dropped-in files work without a restart.
const AUDIO = /\.(mp3|wav|ogg|m4a)$/i;
const IMAGE = /\.(gif|png|webp|jpe?g)$/i;
function mediaFolders(dir, ext) {
  const out = {};
  try {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const files = fs.readdirSync(path.join(dir, d.name)).filter(f => ext.test(f)).sort();
      if (files.length) out[d.name] = files;
    }
  } catch { /* no folder yet */ }
  return out;
}
const SOUND_DIR = path.join(__dirname, 'public', 'sounds');
// T-bag folders: sounds play on every T-bag; a picture (GIF/WebP) there pops up over the T-bagger too.
app.get('/tbag-sounds.json', (req, res) => {
  const dir = path.join(SOUND_DIR, 'tbag');
  res.set('Cache-Control', 'no-store').json({ sounds: mediaFolders(dir, AUDIO), images: mediaFolders(dir, IMAGE) });
});
// Custom GIF stickers. Search goes through the server so the API key stays secret; set GIPHY_API_KEY or
// TENOR_API_KEY (in .env or the environment). Without a key, players can still paste a GIF link.
const GIF_HOSTS = /^https:\/\/(media\d*\.giphy\.com|i\.giphy\.com|media\.tenor\.com|c\.tenor\.com|i\.imgur\.com|media\.discordapp\.net|cdn\.discordapp\.com)\/[^\s"'<>]+$/i;
function cleanGifUrl(raw) {
  let url = String(raw || '').trim().slice(0, 600);
  // A giphy.com page link → its GIF file; imgur .gifv → .gif
  const page = url.match(/^https:\/\/giphy\.com\/(?:gifs|stickers)\/(?:[\w-]*-)?([A-Za-z0-9]+)\/?(?:[?#].*)?$/);
  if (page) url = `https://media.giphy.com/media/${page[1]}/giphy.gif`;
  url = url.replace(/^(https:\/\/i\.imgur\.com\/\w+)\.gifv$/i, '$1.gif');
  return GIF_HOSTS.test(url) ? url : null;
}
async function searchGifs(q) {
  const giphy = process.env.GIPHY_API_KEY;
  const tenor = process.env.TENOR_API_KEY;
  if (giphy) {
    const u = new URL(`https://api.giphy.com/v1/gifs/${q ? 'search' : 'trending'}`);
    Object.entries({ api_key: giphy, q, limit: 24, rating: 'pg-13' }).forEach(([k, v]) => v && u.searchParams.set(k, v));
    const j = await (await fetch(u)).json();
    return (j.data || []).map(g => ({ preview: g.images.fixed_height_small.url, url: g.images.fixed_height.url }));
  }
  if (tenor) {
    const u = new URL(`https://tenor.googleapis.com/v2/${q ? 'search' : 'featured'}`);
    Object.entries({ key: tenor, client_key: 'aura-tax', q, limit: 24, contentfilter: 'medium', media_filter: 'gif,tinygif' }).forEach(([k, v]) => v && u.searchParams.set(k, v));
    const j = await (await fetch(u)).json();
    return (j.results || []).map(g => ({ preview: g.media_formats.tinygif.url, url: g.media_formats.gif.url }));
  }
  return null;
}
app.get('/gifs', async (req, res) => {
  try {
    const results = await searchGifs(String(req.query.q || '').trim().slice(0, 80));
    res.json(results ? { enabled: true, results: results.filter(g => cleanGifUrl(g.url)) } : { enabled: false, results: [] });
  } catch {
    res.json({ enabled: true, error: 'GIF search failed', results: [] });
  }
});

// Background music for games: every audio file in public/sounds/music/, played in a shuffled loop.
app.get('/music.json', (req, res) => {
  let files = [];
  try { files = fs.readdirSync(path.join(SOUND_DIR, 'music')).filter(f => AUDIO.test(f)).sort(); } catch { /* no folder */ }
  res.set('Cache-Control', 'no-store').json(files);
});

app.get('/sticker-files.json', (req, res) => {
  const dir = path.join(SOUND_DIR, 'stickers');
  res.set('Cache-Control', 'no-store').json({ images: mediaFolders(dir, IMAGE) });
});

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const START_AURA = 50;
const TBAG_STEAL = 15;
const ARENA_STEAL = 12;
const ARENA_TBAG = 3; // extra aura when the 1v1 winner chooses to T-bag
const TAX_THRESHOLD = 40; // aura stolen from one rider before they owe you aura tax
const TAX_PER_TURN = 6;
const TAX_OFFICE_COLLECT = 8;
const DEATHNOTE_TURNS = 3;
const DEATHNOTE_DRAIN = 4;
const SPAWN_PASS = 20;
const START_HAND = 3;
const HAND_LIMIT = 5; // you can go over, but must throw cards away before your next move
const ACTIONS_PER_TURN = 2;
const SHOP_PRICE = 15;
const LEGEND_PRICE = 40;
const BOOSTER_PRICE = 20;
const COVER_PRICE = 10;
const COVER_TURNS = 3; // Duo Q with Booster
const HUNT_TURNS = 4; // Deathnote Entry: T-bags on you hit x3
const TAX_FEE = 5; // paid to each tax counter's owner on the tile you land on
const DUO_TURNS = 2; // a duo lasts for the rest of this turn and the inviter's next one
const REACT_MS = 6000;
const VOTE_MS = 12000;
const AFK_MS = 1800; // disconnected riders go on camel autopilot
// Bots: lobby players run by the server. Deliberately weak: they roll, sometimes play a random card at a
// random target, never react to anything, and pick randomly whenever they're asked to choose.
const BOT_THINK_MS = 1100;
const BOT_CARD_CHANCE = 0.45;
const BOT_NAMES = ['NPC Bex', 'NPC Sonic', 'NPC MrCockMan', 'NPC DoctorPotato', 'NPC RiicoDiff'];
const STEP_MS = 230;
const TARGETS = [100, 150, 200, 300];
const ROUNDS = [6, 10, 14, 20];
const COLORS = ['#ff4d6d', '#ffb703', '#3ddc97', '#4cc9f0', '#b388ff', '#ff8fab', '#f77f00', '#e9e4f5'];
// The 3D figure each rider plays as. The client (board3d.js) has a model per id.
const CHAMPIONS = [
  'camel', 'cactus', 'mrx', 'viking', 'dragon', 'penguin', 'frostking', 'crone',
  'captain', 'pistol', 'buzzsaw', 'dog', 'jetpack', 'hotdog', 'sensei', 'leech', 'ronin', 'poop',
];

// Dice styles players can pick in the lobby (the client draws them; see DICE_STYLES in board3d.js).
const DICE = ['marble', 'lava', 'ice', 'bone', 'neon'];

const BOARD = [
  { type: 'spawn', name: 'Smurf Queue', icon: 'sports_esports', desc: `Start. +${SPAWN_PASS} aura every time you ride past it.` },
  { type: 'aura', name: 'Aura Farm', icon: 'grass', amount: 15, desc: 'Honest work.' },
  { type: 'card', name: 'Patch Notes', icon: 'description', desc: 'Draw 2 cards.' },
  { type: 'cringe', name: 'Missed the Emote', icon: 'sentiment_dissatisfied', amount: 6, desc: 'Everyone saw.' },
  { type: 'arena', name: 'Ranked 1v1', icon: 'swords', desc: `Pick a rider. Both roll. Winner steals ${ARENA_STEAL} aura.` },
  { type: 'aura', name: 'Camel Spa', icon: 'spa', amount: 18, desc: 'Self care arc.' },
  { type: 'deathnote', name: "Osoka's Server", icon: 'menu_book', desc: `Your name goes in the Deathnote (-${DEATHNOTE_DRAIN} aura for ${DEATHNOTE_TURNS} turns) and she leaks your hand: discard a random card.` },
  { type: 'card', name: 'Patch Notes', icon: 'description', desc: 'Draw 2 cards.' },
  { type: 'aura', name: 'Clip Went Viral', icon: 'videocam', amount: 25, desc: 'The montage hit the algorithm.' },
  { type: 'cringe', name: 'Caught Tryharding and Lost', icon: 'local_fire_department', amount: 8, desc: 'Sweaty.' },
  { type: 'oasis', name: 'Oasis', icon: 'beach_access', desc: 'Draw a reaction card.' },
  { type: 'card', name: 'Patch Notes', icon: 'description', desc: 'Draw 2 cards.' },
  { type: 'booster', name: 'Booster Ambush', icon: 'skull', desc: 'A booster on the enemy team destroys you: -15. If you have duo hostages, it happens in front of them: -35, they escape, and you get Deathnoted.' },
  { type: 'aura', name: 'Desert Drip', icon: 'checkroom', amount: 15, desc: 'Fit check passed.' },
  { type: 'arena', name: 'Ranked 1v1', icon: 'swords', desc: `Pick a rider. Both roll. Winner steals ${ARENA_STEAL} aura.` },
  { type: 'shop', name: 'Card Shop', icon: 'storefront', desc: `Buy a random card for ${SHOP_PRICE} aura, or a legendary for ${LEGEND_PRICE}.` },
  { type: 'cringe', name: 'Typed in All Chat', icon: 'keyboard', amount: 10, desc: 'Nobody asked.' },
  { type: 'storm', name: 'Sandstorm', icon: 'cyclone', desc: 'Get blown to a random tile.' },
  { type: 'tax', name: 'Aura Tax Office', icon: 'account_balance', desc: `Collect ${TAX_OFFICE_COLLECT} from each of your duo hostages. No hostages? Pay 10% aura tax (min 5).` },
  { type: 'aura', name: 'Sunset Ride', icon: 'wb_twilight', amount: 18, desc: 'Main character moment.' },
  { type: 'card', name: 'Patch Notes', icon: 'description', desc: 'Draw 2 cards.' },
  { type: 'arena', name: 'Ranked 1v1', icon: 'swords', desc: `Pick a rider. Both roll. Winner steals ${ARENA_STEAL} aura.` },
  { type: 'sprint', name: 'Camel Zoomies', icon: 'speed', desc: '+1 action, and you can roll again.' },
  { type: 'cringe', name: 'Lost to a Silver', icon: 'military_tech', amount: 8, desc: 'Unforgivable.' },
];
const BOOSTER_TILE = BOARD.findIndex(t => t.type === 'booster');
const STORM_TILE = BOARD.findIndex(t => t.type === 'storm');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ROOM = 'desert'; // there is only one lobby: everyone who opens the site lands in it
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rand = n => Math.floor(Math.random() * n);
const now = () => Date.now();
const human = p => p.connected && !p.bot;
const byId = (room, id) => (id ? room.players.find(p => p.id === id) : null);
const cur = room => room.players[room.turn];
const others = (room, p) => room.players.filter(o => o !== p && !o.out);
const inGame = room => room.players.filter(p => !p.out);
const hostagesOf = (room, p) => room.players.filter(o => o.owner === p.id);
const alive = (room, gen) => room.gen === gen && room.phase === 'play';
const ids = list => list.map(o => o.id);
const dist = (a, b) => { const d = Math.abs(a - b) % BOARD.length; return Math.min(d, BOARD.length - d); };
// Smurf Account makes you untargetable until your next turn.
const targetable = (room, p) => others(room, p).filter(o => !o.smurf);
const inRange = (room, p, n) => ids(targetable(room, p).filter(o => dist(o.pos, p.pos) <= n));
const anyone = (room, p) => ids(targetable(room, p));
const duoLinked = (a, b) => a.duoWith === b.id || b.duoWith === a.id;
const linked = (a, b) => duoLinked(a, b) || a.owner === b.id || b.owner === a.id;

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cleanName(s) {
  return String(s || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || 'Lil Bro';
}

// ---------------------------------------------------------------------------
// Cards
// run(room, actor, target, arg, gen). After an Uno Reverse, actor and target are swapped.
// ---------------------------------------------------------------------------
const CARDS = {
  // Movement
  ride2: { kind: 'move', copies: 1, title: 'Ride 2', text: 'Move exactly 2 tiles.', run: (room, p, t, arg, gen) => ride(room, p, 2, gen) },
  ride3: { kind: 'move', copies: 1, title: 'Ride 3', text: 'Move exactly 3 tiles.', run: (room, p, t, arg, gen) => ride(room, p, 3, gen) },
  ride4: { kind: 'move', copies: 1, title: 'Ride 4', text: 'Move exactly 4 tiles.', run: (room, p, t, arg, gen) => ride(room, p, 4, gen) },
  zoomies: {
    kind: 'move', copies: 1, title: 'Zoomies', text: 'Roll 2 dice and move by the total.',
    run: async (room, p, t, arg, gen) => {
      const a = 1 + rand(6);
      const b = 1 + rand(6);
      fx(room, { type: 'dice', pid: p.id, value: a, value2: b });
      log(room, `${p.name} rolled ${a} + ${b}.`);
      await sleep(1300);
      if (alive(room, gen)) await ride(room, p, a + b, gen);
    },
  },
  retreat: {
    kind: 'move', copies: 1, title: 'Retreat', text: 'Move backward 1 to 3 tiles. Great for running away.',
    target: 'steps', options: () => [1, 2, 3],
    run: (room, p, t, n, gen) => ride(room, p, -n, gen),
  },
  charge: {
    kind: 'move', copies: 1, title: 'Camel Charge', text: 'Jump onto any rider within 5 tiles and T-bag them.',
    target: 'player', options: (room, p) => inRange(room, p, 5),
    run: async (room, p, t, arg, gen) => {
      await teleport(room, p, t.pos);
      if (alive(room, gen)) await afterMove(room, p, gen);
    },
  },
  spawn: {
    kind: 'move', copies: 1, title: 'Back to Spawn', text: `Teleport to the Smurf Queue and collect +${SPAWN_PASS}.`,
    run: async (room, p, t, arg, gen) => {
      await teleport(room, p, 0);
      adj(room, p, SPAWN_PASS);
      if (alive(room, gen)) await afterMove(room, p, gen);
    },
  },

  // Steal
  emote: {
    kind: 'steal', copies: 1, title: 'Emote Spam', text: 'Steal 10 aura from a rider within 2 tiles.',
    target: 'player', reversible: true, options: (room, p) => inRange(room, p, 2),
    run: (room, p, t) => steal(room, p, t, 10, '', 'spammed emotes at'),
  },
  clip: {
    kind: 'steal', copies: 1, title: 'Clip It', text: 'Steal 15 from a rider who lost aura in the last round. Kick them while they are down.',
    target: 'player', reversible: true,
    options: (room, p) => ids(targetable(room, p).filter(o => room.turnCount - o.hurtTurn < room.players.length)),
    run: (room, p, t) => steal(room, p, t, 15, '', 'clipped'),
  },
  ratio: {
    kind: 'steal', copies: 1, title: 'Diffed', text: "Take 10% of any rider's aura (min 5).",
    target: 'player', reversible: true, options: anyone,
    run: (room, p, t) => steal(room, p, t, Math.max(5, Math.floor(t.aura * 0.1)), '', 'diffed'),
  },
  audit: {
    kind: 'steal', copies: 1, title: 'Tax Audit', text: `Put your tax counter on the tile you're on. Everyone else who lands there pays you ${TAX_FEE} aura.`,
    can: (room, p) => !(room.taxTiles[p.pos] || []).includes(p.id),
    run: async (room, p) => {
      (room.taxTiles[p.pos] = room.taxTiles[p.pos] || []).push(p.id);
      log(room, `${p.name} put a tax counter on ${BOARD[p.pos].name}.`, 'tax');
      banner(room, 'TAX COUNTER', `Landing on ${BOARD[p.pos].name} now costs ${TAX_FEE} aura, paid to ${p.name}`, 'tax', p.id);
      await sleep(1000);
    },
  },
  booster: {
    kind: 'steal', copies: 1, title: 'Hire a Booster', text: `Pay ${BOOSTER_PRICE} aura for help. From now on your T-bags hit double: you and your booster. If someone else has the booster, you steal it from them.`,
    run: (room, p) => hireBooster(room, p),
  },

  kick: {
    kind: 'steal', copies: 1, title: 'Camel Kick', text: 'Kick a rider within 3 tiles 3 tiles backward. They land on that tile.',
    target: 'player', reversible: true, options: (room, p) => inRange(room, p, 3),
    run: async (room, p, t, arg, gen) => {
      log(room, `${p.name} camel kicked ${t.name} 3 tiles back.`, 'tbag');
      await moveSteps(room, t, -3);
      if (alive(room, gen)) await resolveTile(room, t, 2, gen);
    },
  },
  ping: {
    kind: 'steal', copies: 1, title: 'Spam Ping', text: 'Everyone else loses 5 aura.',
    run: async (room, p) => {
      for (const o of others(room, p)) adj(room, o, -5);
      log(room, `${p.name} spam pinged everyone. -5 aura each.`, 'bad');
      banner(room, 'SPAM PING', 'Everyone else loses 5 aura', 'bad');
      await sleep(1000);
    },
  },
  leak: {
    kind: 'steal', copies: 1, title: 'Leak DMs', text: 'A rider throws away a random card.',
    target: 'player', reversible: true, options: (room, p) => ids(targetable(room, p).filter(o => o.hand.length)),
    run: async (room, p, t) => {
      if (!t.hand.length) return;
      const c = t.hand.splice(rand(t.hand.length), 1)[0];
      discard(room, c);
      log(room, `${p.name} leaked ${t.name}'s DMs. They lost ${CARDS[c.key].title}.`, 'bad');
      whisper(t, `Your DMs got leaked: you lost ${CARDS[c.key].title}`);
      await sleep(900);
    },
  },
  ghost: {
    kind: 'steal', copies: 1, title: 'Ghost Ping', text: 'Pull any rider onto your tile and T-bag them.',
    target: 'player', reversible: true, options: anyone,
    run: async (room, p, t, arg, gen) => {
      await teleport(room, t, p.pos);
      if (alive(room, gen)) await tbag(room, p, t, gen);
    },
  },
  flame: {
    kind: 'steal', copies: 1, title: 'Flame', text: 'A rider loses 15 aura.',
    target: 'player', reversible: true, options: anyone,
    run: async (room, p, t) => {
      adj(room, t, -15);
      log(room, `${p.name} flamed ${t.name}. -15 aura.`, 'bad');
      await sleep(900);
    },
  },

  // Boosts: help yourself
  touch: {
    kind: 'boost', copies: 1, title: 'Touch Grass', text: '+15 aura.',
    run: async (room, p) => { adj(room, p, 15); log(room, `${p.name} touched grass. +15 aura.`, 'good'); await sleep(700); },
  },
  mmr: {
    kind: 'boost', copies: 1, title: 'Hidden MMR', text: '+25 aura. Turns out you were a smurf all along.',
    run: async (room, p) => { adj(room, p, 25); log(room, `${p.name} revealed their hidden MMR. +25 aura.`, 'good'); await sleep(700); },
  },
  wind: {
    kind: 'boost', copies: 1, title: 'Second Wind', text: '+2 moves this turn.',
    run: async (room, p) => {
      if (cur(room) === p) room.actionsLeft += 2;
      log(room, `${p.name} got a second wind. +2 moves.`, 'good');
      await sleep(500);
    },
  },
  lag: {
    kind: 'move', copies: 1, title: 'Lag Switch', text: 'Ride forward 1 to 6 tiles. You pick how far.',
    target: 'ahead', options: () => [1, 2, 3, 4, 5, 6],
    run: (room, p, t, n, gen) => ride(room, p, n, gen),
  },

  // Reactions: only playable when the server asks you
  dodge: { kind: 'react', copies: 1, title: 'Dodge', text: 'Reaction: cancel a T-bag on you.' },
  uno: { kind: 'react', copies: 1, title: 'Uno Reverse', text: 'Reaction: a steal or social card played on you hits the person who played it instead.' },
  report: { kind: 'react', copies: 1, title: 'Report', text: 'Reaction: cancel any card another rider just played.' },
  smurf: { kind: 'react', copies: 1, title: 'Smurf Account', text: 'Reaction: when someone targets or T-bags you, cancel it. Nobody can target you until your next turn.' },
  screenshot: { kind: 'react', copies: 1, title: 'Screenshot', text: 'Reaction: when someone hits you, take it, but they get marked. The next attack on them does double.' },

  // Social
  duo: {
    kind: 'social', copies: 1, title: 'Duo Invite', text: 'Force a rider to duo with you until the end of your next turn. They get dragged wherever you ride and land on whatever you land on.',
    target: 'player', reversible: true, options: anyone,
    run: async (room, p, t) => {
      endDuo(room, p);
      p.duoWith = t.id;
      p.duoTurns = DUO_TURNS;
      log(room, `${t.name} got forced into a duo with ${p.name}. Wherever ${p.name} rides, they ride.`, 'tax');
      banner(room, 'DUO Q', `${t.name} is stuck riding with ${p.name}`, 'tax', p.id);
      await teleport(room, t, p.pos);
    },
  },
  betray: {
    kind: 'social', copies: 1, title: 'Betrayal', text: 'Backstab your duo, the rider taxing you, or one of your hostages: steal half their aura (max 40) and the link breaks.',
    target: 'player', reversible: true, options: (room, p) => ids(targetable(room, p).filter(o => linked(p, o))),
    run: (room, p, t) => betray(room, p, t),
  },
  deathnote: {
    kind: 'social', copies: 1, title: 'Deathnote Entry', text: `Osoka has written their name in the Deathnote. Now all her white knights T-bag them every time they find them: T-bags on them hit x3 for their next ${HUNT_TURNS} turns.`,
    target: 'player', reversible: true, options: anyone,
    run: async (room, p, t) => {
      t.hunted = HUNT_TURNS + 1; // ticks down at the start of their turn, so N + 1 covers N full turns
      log(room, `${p.name} got ${t.name} written in Osoka's Deathnote. Her white knights are hunting them.`, 'bad');
      banner(room, 'DEATHNOTE', `Osoka has written ${t.name}'s name. T-bags on them hit x3`, 'bad', p.id);
      await sleep(1000);
    },
  },
  swap: {
    kind: 'social', copies: 1, title: 'Swap Places', text: 'Swap board positions with any rider. You get the tile they were on.',
    target: 'player', options: anyone,
    run: async (room, p, t, arg, gen) => {
      const mine = p.pos;
      const theirs = t.pos;
      log(room, `${p.name} swapped places with ${t.name}.`);
      await teleport(room, t, mine);
      await teleport(room, p, theirs);
      if (alive(room, gen)) await afterMove(room, p, gen);
    },
  },
  snitch: {
    kind: 'social', copies: 1, title: 'Snitch', text: "Look at a rider's hand and steal 1 card of your choice.",
    target: 'player', reversible: true, options: (room, p) => ids(targetable(room, p).filter(o => o.hand.length)),
    run: (room, p, t, arg, gen) => snitch(room, p, t, gen),
  },
  vote: {
    kind: 'social', copies: 1, title: 'Server Vote', text: 'Everyone secretly votes for a rider to get sent to the Booster Ambush.',
    run: (room, p, t, arg, gen) => serverVote(room, gen),
  },

  // Legendary: 1 copy each
  ascend: {
    kind: 'legend', copies: 1, title: 'Champ Smurf Ascension', text: 'Every other rider pays you 10 aura.',
    run: async (room, p) => {
      for (const o of others(room, p)) afterSteal(room, p, o, stealAura(room, o, p, 10));
      log(room, `${p.name} ascended. Everyone paid them 10 aura.`, 'tax');
      banner(room, 'ASCENSION', `Everyone pays ${p.name} 10 aura`, 'tax', p.id);
      await sleep(1200);
    },
  },
  bankrupt: {
    kind: 'legend', copies: 1, title: 'Duo Q with Booster', text: `Pay ${COVER_PRICE} aura and glue yourself to a rider. For your next ${COVER_TURNS} turns, every bit of aura you would lose, they lose instead.`,
    target: 'player', options: anyone,
    run: async (room, p, t) => {
      adj(room, p, -COVER_PRICE);
      p.coverId = t.id;
      p.coverTurns = COVER_TURNS + 1; // ticks down at the start of your turn
      log(room, `${p.name} duo queued with ${t.name}. ${t.name} takes all of ${p.name}'s losses for ${COVER_TURNS} turns.`, 'tax');
      banner(room, 'DUO Q WITH BOOSTER', `${t.name} takes every loss ${p.name} would take`, 'tax', p.id);
      await sleep(1200);
    },
  },
  massreport: {
    kind: 'legend', copies: 1, title: 'Mass Report', text: 'Every other rider discards all their reaction cards.',
    run: async (room, p) => {
      let n = 0;
      for (const o of others(room, p)) {
        const gone = o.hand.filter(c => CARDS[c.key].kind === 'react');
        o.hand = o.hand.filter(c => !gone.includes(c));
        discard(room, ...gone);
        n += gone.length;
      }
      log(room, `MASS REPORT. ${p.name} got ${n} reaction card${n === 1 ? '' : 's'} banned.`, 'bad');
      banner(room, 'MASS REPORT', `${n} reaction card${n === 1 ? '' : 's'} deleted`, 'bad');
      await sleep(1200);
    },
  },
  himself: {
    kind: 'legend', copies: 1, title: 'The Booster Himself', text: 'Teleport to any tile with riders on it and T-bag all of them.',
    target: 'tile', options: (room, p) => [...new Set(targetable(room, p).map(o => o.pos))],
    run: async (room, p, t, tile, gen) => {
      banner(room, 'THE BOOSTER HIMSELF', `${p.name} is coming for ${BOARD[tile].name}`, 'tbag', p.id);
      await teleport(room, p, tile);
      if (alive(room, gen)) await afterMove(room, p, gen);
    },
  },
};

// Two decks on the board. Guard: defensive / utility. Attack: offensive / undermining (legendaries live here).
const GUARD_CARDS = new Set(['ride2', 'ride3', 'ride4', 'zoomies', 'retreat', 'spawn', 'swap', 'lag', 'touch', 'mmr', 'wind', 'dodge', 'uno', 'report', 'smurf', 'screenshot']);
const DECKS = ['guard', 'attack'];
const deckOf = key => (GUARD_CARDS.has(key) ? 'guard' : 'attack');

function buildDecks(room) {
  const mult = room.players.length > 4 ? 2 : 1;
  room.decks = { guard: [], attack: [] };
  room.discards = { guard: [], attack: [] };
  for (const [key, d] of Object.entries(CARDS)) {
    const n = d.kind === 'legend' ? d.copies : d.copies * mult;
    for (let i = 0; i < n; i++) room.decks[deckOf(key)].push({ uid: ++room.uid, key });
  }
  DECKS.forEach(k => shuffle(room.decks[k]));
}

function discard(room, ...cards) {
  for (const c of cards) room.discards[deckOf(c.key)].push(c);
}

function takeFromDeck(room, deck, filter = () => true) {
  let i = room.decks[deck].findLastIndex(c => filter(CARDS[c.key]));
  if (i < 0) {
    room.decks[deck] = shuffle([...room.decks[deck], ...room.discards[deck]]);
    room.discards[deck] = [];
    i = room.decks[deck].findLastIndex(c => filter(CARDS[c.key]));
  }
  return i < 0 ? null : room.decks[deck].splice(i, 1)[0];
}

function drawCards(room, p, n, deck, filter) {
  let got = 0;
  while (got < n) {
    const c = takeFromDeck(room, deck, filter);
    if (!c) break;
    p.hand.push(c);
    got++;
  }
  return got;
}

// Draws are never automatic: the rider is owed them and clicks a deck. Each entry is 'any' or a deck name.
function grantDraws(room, p, n, from = 'any') {
  for (let i = 0; i < n; i++) p.draws.push(from);
  return n;
}

function drawOne(room, p, deck) {
  const from = p.draws[0];
  if (!from || !DECKS.includes(deck) || (from !== 'any' && from !== deck)) return false;
  p.draws.shift();
  drawCards(room, p, 1, deck);
  return true;
}

// Autopilot / end of turn: take any draws the rider still has coming, then throw away random cards down to the limit.
function autoDraw(room, p) {
  while (p.draws.length) drawOne(room, p, p.draws[0] === 'any' ? DECKS[rand(2)] : p.draws[0]);
  while (p.hand.length > HAND_LIMIT) discard(room, p.hand.splice(rand(p.hand.length), 1)[0]);
}

// Over the hand limit? You must throw a card away (one at a time, your pick) before doing anything else.
const overLimit = p => p.hand.length > HAND_LIMIT;

const hasLegend = room => [...room.decks.attack, ...room.discards.attack].some(c => CARDS[c.key].kind === 'legend');

function cardOptions(room, p, d) {
  return d.options ? d.options(room, p) : null;
}

// Sticker reactions riders can throw on the board. The client has the icon, label and sound for each id.
const STICKERS = ['sleep', 'lel', 'zulul', 'c9', 'gulp', 'haha', 'ez', 'pants'];
const STICKER_COOLDOWN_MS = 1500;

// How strong each card is, 1 to 4, shown in the corner of the card. Legendaries are always 4.
const POWER = {
  ride2: 1, ride3: 1, ride4: 1, retreat: 1, zoomies: 2, lag: 2, charge: 2, spawn: 2,
  emote: 1, ratio: 1, kick: 1, leak: 1, clip: 2, audit: 2, ping: 2, ghost: 2, flame: 2, booster: 3,
  touch: 1, wind: 1, mmr: 2,
  dodge: 1, screenshot: 1, uno: 2, report: 2, smurf: 2,
  duo: 2, deathnote: 2, swap: 2, snitch: 2, vote: 2, betray: 3,
};
const powerOf = key => (CARDS[key].kind === 'legend' ? 4 : POWER[key] || 1);

function cardView(room, p, c) {
  const d = CARDS[c.key];
  const options = cardOptions(room, p, d);
  return {
    uid: c.uid, key: c.key, kind: d.kind, title: d.title, text: d.text, target: d.target || null, options, power: powerOf(c.key),
    playable: d.kind !== 'react' && (options ? options.length > 0 : (d.can ? d.can(room, p) : true)),
  };
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------
function resetPlayer(p) {
  Object.assign(p, {
    pos: 0, aura: START_AURA, owner: null, deathnote: 0, out: false, hand: [], draws: [],
    duoWith: null, duoTurns: 0, marked: false, smurf: false, hurtTurn: -99, hunted: 0, coverId: null, coverTurns: 0,
    stats: { tbags: 0, stolen: 0, taxed: 0, cards: 0 },
  });
}

const desert = {
  players: [], spectators: [], phase: 'lobby',
  settings: { target: 150, rounds: 10 },
  turn: 0, round: 1, turnCount: 0, log: [], logId: 0, stolen: {},
  decks: { guard: [], attack: [] }, discards: { guard: [], attack: [] }, boosterId: null, taxTiles: {}, uid: 0, actionsLeft: 0, rolled: false,
  busy: false, pending: null, choose: null, choiceFallback: null, reaction: null, reactTimer: null, vote: null, voteTimer: null,
  gen: 0, deadline: 0, deadlineTotal: 0, timer: null, paused: false, winnerId: null, emptySince: 0,
};

function makePlayer(room, { id, token, socketId, name, bot = false }) {
  const used = new Set(room.players.map(p => p.color));
  const p = {
    id: id || crypto.randomBytes(6).toString('hex'),
    token, socketId, name,
    color: COLORS.find(c => !used.has(c)) || COLORS[0],
    champion: CHAMPIONS[Math.floor(Math.random() * CHAMPIONS.length)],
    connected: true,
    bot,
    dice: bot ? DICE[rand(DICE.length)] : 'marble',
  };
  resetPlayer(p);
  room.players.push(p);
  return p;
}

// Spectators waiting in the lobby take any free seats (keeping their id, so their client keeps working).
function promoteSpectators(room) {
  while (room.phase === 'lobby' && room.players.length < MAX_PLAYERS && room.spectators.length) {
    makePlayer(room, room.spectators.shift());
  }
}

// The few words printed on each tile, so the board explains itself.
function tileEffect(type, amount) {
  switch (type) {
    case 'spawn': return `+${SPAWN_PASS} aura when you pass`;
    case 'aura': return `+${amount} aura`;
    case 'cringe': return `-${amount} aura`;
    case 'card': return 'Draw 2 cards';
    case 'shop': return 'Buy a card';
    case 'oasis': return 'Draw 1 Guard card';
    case 'arena': return `Dice duel: win ${ARENA_STEAL} aura`;
    case 'deathnote': return `-${DEATHNOTE_DRAIN} aura for ${DEATHNOTE_TURNS} turns, lose a card`;
    case 'booster': return '-15 aura';
    case 'storm': return 'Go to a random tile';
    case 'tax': return 'Collect tax, or pay 10%';
    case 'sprint': return '+1 move, roll again';
    default: return '';
  }
}

function publicBoard() {
  return BOARD.map(({ type, name, icon, amount, desc }) => ({
    type, name, icon, amount, effect: tileEffect(type, amount),
    desc: type === 'aura' ? `+${amount} aura. ${desc}` : type === 'cringe' ? `-${amount} aura. ${desc}` : desc,
  }));
}

// The board and the cast for the bot match that plays behind the home screen, before you've joined.
app.get('/intro.json', (req, res) => res.json({ board: publicBoard(), colors: COLORS, champions: CHAMPIONS }));

function publicState(room) {
  const c = room.phase === 'play' ? cur(room) : null;
  const r = room.reaction;
  const v = room.vote;
  return {
    phase: room.phase,
    settings: room.settings,
    round: room.round,
    currentId: c ? c.id : null,
    busy: room.busy,
    actionsLeft: room.actionsLeft,
    rolled: room.rolled,
    pending: room.pending && { pid: room.pending.pid, kind: room.pending.kind, options: room.pending.options },
    reaction: r && { desc: r.desc, waiting: Object.keys(r.ask), timeLeft: Math.max(0, r.deadline - now()), timeTotal: REACT_MS },
    vote: v && { voters: v.voters, voted: Object.keys(v.votes), timeLeft: Math.max(0, v.deadline - now()), timeTotal: VOTE_MS },
    timeLeft: room.deadline ? Math.max(0, room.deadline - now()) : 0,
    timeTotal: room.deadlineTotal,
    winnerId: room.winnerId,
    board: publicBoard(),
    colors: COLORS,
    champions: CHAMPIONS,
    taxThreshold: TAX_THRESHOLD,
    handLimit: HAND_LIMIT,
    decks: { guard: room.decks.guard.length + room.discards.guard.length, attack: room.decks.attack.length + room.discards.attack.length },
    stolen: room.stolen,
    taxTiles: room.taxTiles,
    players: room.players.map(p => ({
      id: p.id, name: p.name, color: p.color, champion: p.champion, pos: p.pos, aura: p.aura, owner: p.owner,
      deathnote: p.deathnote, connected: p.connected, bot: !!p.bot, out: !!p.out, dice: p.dice, stats: p.stats,
      handCount: p.hand.length, draws: p.draws.length, duoWith: p.duoWith, marked: p.marked, smurf: p.smurf,
      booster: room.boosterId === p.id, hunted: p.hunted > 0, coverId: p.coverTurns > 0 ? p.coverId : null,
    })),
    spectators: room.spectators.map(s => ({ id: s.id, name: s.name })),
    log: room.log.slice(-50),
  };
}

// What only this rider gets to see: their hand, a Snitch peek, and which reactions they can play right now.
function privateState(room, p) {
  return {
    hand: p.hand.map(c => cardView(room, p, c)),
    draws: p.draws,
    peek: (room.pending && room.pending.pid === p.id && room.pending.peek) || null,
    react: (room.reaction && room.reaction.ask[p.id]) || null,
  };
}

function broadcast(room) {
  const pub = publicState(room);
  for (const p of room.players) {
    if (p.socketId) io.to(p.socketId).emit('state', { ...pub, me: room.phase === 'lobby' ? null : privateState(room, p) });
  }
  for (const s of room.spectators) {
    if (s.socketId) io.to(s.socketId).emit('state', pub);
  }
}
const fx = (room, data) => io.to(ROOM).emit('fx', data);
// pid: whose colour the pop-up takes. Defaults to the rider whose turn it is.
const banner = (room, title, sub, kind = 'info', pid = room.phase === 'play' ? cur(room).id : null) => fx(room, { type: 'banner', title, sub, kind, pid });
const whisper = (p, text) => { if (p.socketId) io.to(p.socketId).emit('fx', { type: 'toast', text }); };

function log(room, text, kind = 'info', extra = {}) {
  room.log.push({ id: ++room.logId, text, kind, ...extra });
  if (room.log.length > 80) room.log.splice(0, room.log.length - 80);
}

function setDeadline(room, ms, fn) {
  clearTimeout(room.timer);
  room.deadline = now() + ms;
  room.deadlineTotal = ms;
  room.timer = setTimeout(fn, ms);
}

function clearDeadline(room) {
  clearTimeout(room.timer);
  room.timer = null;
  room.deadline = 0;
}

// ---------------------------------------------------------------------------
// Aura economy
// ---------------------------------------------------------------------------
// Duo Q with Booster: the rider glued to you takes your losses (one hop only).
const coverOf = (room, p) => (p.coverTurns > 0 ? byId(room, p.coverId) : null);

function adj(room, p, delta) {
  if (!delta) return;
  if (delta < 0) p = coverOf(room, p) || p;
  p.aura += delta;
  if (delta < 0) p.hurtTurn = room.turnCount;
  fx(room, { type: 'float', pid: p.id, text: (delta > 0 ? '+' : '') + delta, good: delta > 0 });
  if (p.aura < 0 && !p.out) eliminate(room, p);
}

// Below 0 aura you're out: you stay at the table as a spectator. Every link to you is cut (duos, taxes,
// the booster, tax counters) and your cards go back to the discard pile. checkWin ends the game when one is left.
function eliminate(room, p) {
  p.out = true;
  log(room, `${p.name} went negative and is OUT. Spectating from the dunes now.`, 'bad');
  banner(room, 'ELIMINATED', `${p.name} has negative aura and is out of the game`, 'bad', p.id);
  discard(room, ...p.hand);
  p.hand = [];
  p.draws = [];
  p.owner = null;
  p.marked = false;
  p.smurf = false;
  p.hunted = 0;
  p.deathnote = 0;
  endDuo(room, p);
  p.coverTurns = 0;
  for (const o of room.players) {
    if (o.duoWith === p.id) endDuo(room, o);
    if (o.owner === p.id) o.owner = null;
    if (o.coverId === p.id) o.coverTurns = 0;
  }
  if (room.boosterId === p.id) room.boosterId = null;
  for (const tile of Object.keys(room.taxTiles)) {
    room.taxTiles[tile] = room.taxTiles[tile].filter(id => id !== p.id);
    if (!room.taxTiles[tile].length) delete room.taxTiles[tile];
  }
  if (room.reaction && room.reaction.ask[p.id]) room.reaction.respond(p.id, null);
  if (room.vote && room.vote.voters.includes(p.id)) {
    room.vote.voters = room.vote.voters.filter(id => id !== p.id);
    checkVoteDone(room);
  }
  if (room.pending && room.pending.pid === p.id && room.choiceFallback) room.choiceFallback();
}

// Screenshot marks a rider: the next attack on them hits double.
function marked(room, p, amount) {
  if (!p.marked) return amount;
  p.marked = false;
  log(room, `The screenshot of ${p.name} resurfaced. Double damage.`, 'bad');
  return amount * 2;
}

// Victim loses the full amount, but you can't take much from someone who is broke.
function stealAura(room, from, to, amount) {
  amount = marked(room, from, amount);
  const payer = coverOf(room, from) || from;
  const gained = payer.aura > 0 ? Math.min(amount, payer.aura) : Math.ceil(amount / 3);
  adj(room, from, -amount);
  adj(room, to, gained);
  to.stats.stolen += gained;
  return gained;
}

function afterSteal(room, thief, victim, gained) {
  if (thief.owner === victim.id) {
    thief.owner = null;
    log(room, `${thief.name} broke free from ${victim.name}'s aura tax!`, 'good');
    banner(room, 'FREEDOM', `${thief.name} no longer has to pay ${victim.name} to duo q`, 'good', thief.id);
    return;
  }
  const key = `${thief.id}>${victim.id}`;
  room.stolen[key] = (room.stolen[key] || 0) + gained;
  if (room.stolen[key] >= TAX_THRESHOLD && victim.owner !== thief.id) {
    room.stolen[key] = 0;
    const prev = byId(room, victim.owner);
    victim.owner = thief.id;
    const stolenFrom = prev ? ` (sniped from ${prev.name})` : '';
    log(room, `AURA TAX! ${victim.name} now has to duo q with ${thief.name} and pay ${TAX_PER_TURN} aura every turn${stolenFrom}.`, 'tax');
    banner(room, 'AURA TAX', `${victim.name} must duo q with ${thief.name}... and PAY for it`, 'tax', thief.id);
  }
}

async function steal(room, p, t, amount, icon, verb) {
  const got = stealAura(room, t, p, amount);
  log(room, `${p.name} ${verb} ${t.name} and stole ${got} aura.`, 'tbag');
  afterSteal(room, p, t, got);
  broadcast(room);
  await sleep(900);
}

function collectTax(room, p) {
  const hostages = hostagesOf(room, p);
  for (const h of hostages) {
    adj(room, h, -TAX_OFFICE_COLLECT);
    adj(room, p, TAX_OFFICE_COLLECT);
    p.stats.taxed += TAX_OFFICE_COLLECT;
  }
  log(room, `${p.name} collected ${TAX_OFFICE_COLLECT} aura from each hostage: ${hostages.map(h => h.name).join(', ')}.`, 'tax');
  banner(room, 'TAX SEASON', `${p.name} collects from ${hostages.length} duo hostage${hostages.length > 1 ? 's' : ''}`, 'tax', p.id);
}

// There is one booster in the game: hiring it takes it from whoever had it.
async function hireBooster(room, p) {
  const prev = byId(room, room.boosterId);
  adj(room, p, -BOOSTER_PRICE);
  room.boosterId = p.id;
  if (prev && prev !== p) {
    log(room, `${p.name} stole the booster from ${prev.name}.`, 'tbag');
    banner(room, 'BOOSTER STOLEN', `${p.name} paid more. The booster plays for them now`, 'tbag', p.id);
  } else {
    log(room, `${p.name} hired a booster. Their T-bags hit double now.`, 'tbag');
    banner(room, 'BOOSTER HIRED', `${p.name}'s T-bags hit double`, 'tbag', p.id);
  }
  await sleep(1300);
}

function endDuo(room, p) {
  p.duoWith = null;
  p.duoTurns = 0;
}

async function betray(room, p, t) {
  if (p.duoWith === t.id) endDuo(room, p);
  if (t.duoWith === p.id) endDuo(room, t);
  if (p.owner === t.id) p.owner = null;
  if (t.owner === p.id) t.owner = null;
  const amount = Math.min(40, Math.max(0, Math.floor(t.aura / 2)));
  const got = amount ? stealAura(room, t, p, amount) : 0;
  log(room, `BETRAYAL. ${p.name} backstabbed ${t.name}, took ${got} aura and walked out.`, 'bad');
  banner(room, 'BETRAYAL', `${p.name} backstabbed ${t.name} for ${got} aura`, 'bad', p.id);
  broadcast(room);
  await sleep(1400);
}

// ---------------------------------------------------------------------------
// Reactions: when a card or T-bag targets someone, riders holding a matching reaction get a few seconds to play it.
// ---------------------------------------------------------------------------
function reactionWindow(room, { actor, target, card, tbag }) {
  const ask = {};
  for (const o of room.players) {
    if (o === actor || !human(o) || o.out) continue;
    const allowed = new Set();
    if (o === target) {
      allowed.add('smurf');
      allowed.add('screenshot');
      if (tbag) allowed.add('dodge');
      if (card && CARDS[card].reversible) allowed.add('uno');
    }
    if (card) allowed.add('report');
    const opts = o.hand.filter(c => allowed.has(c.key)).map(c => c.uid);
    if (opts.length) ask[o.id] = opts;
  }
  if (!Object.keys(ask).length) return Promise.resolve({ kind: 'go' });

  const desc = tbag
    ? `${actor.name} is about to T-bag ${target.name}`
    : `${actor.name} played ${CARDS[card].title}${target ? ` on ${target.name}` : ''}`;
  return new Promise(resolve => {
    let settled = false;
    const finish = res => {
      if (settled) return;
      settled = true;
      clearTimeout(room.reactTimer);
      room.reaction = null;
      resolve(res);
    };
    room.reaction = {
      desc, ask, deadline: now() + REACT_MS,
      cancel: () => finish({ kind: 'go' }),
      respond: (pid, uid) => {
        const mine = ask[pid];
        if (!mine) return;
        if (uid == null) {
          delete ask[pid];
          if (!Object.keys(ask).length) finish({ kind: 'go' });
          else broadcast(room);
          return;
        }
        if (!mine.includes(uid)) return;
        const o = byId(room, pid);
        const c = o.hand.find(x => x.uid === uid);
        o.hand = o.hand.filter(x => x !== c);
        discard(room, c);
        finish({ kind: c.key, by: o });
      },
    };
    room.reactTimer = setTimeout(() => finish({ kind: 'go' }), REACT_MS);
    broadcast(room);
  });
}

// Runs the reaction window and applies the reaction. Returns 'go', 'cancel' or 'reverse'.
async function contest(room, ctx, gen) {
  const r = await reactionWindow(room, ctx);
  if (!alive(room, gen)) return 'cancel';
  if (r.kind === 'go') return 'go';
  const { actor, target } = ctx;
  const by = r.by;
  const d = CARDS[r.kind];
  fx(room, { type: 'card', pid: by.id, title: d.title, text: d.text, kind: 'react', label: 'REACTION' });
  let res = 'cancel';
  switch (r.kind) {
    case 'dodge':
      log(room, `${by.name} dodged ${actor.name}'s T-bag.`, 'good');
      banner(room, 'DODGED', `${by.name} dodged ${actor.name}`, 'good', by.id);
      break;
    case 'report':
      log(room, `${by.name} reported ${actor.name}'s ${CARDS[ctx.card].title}. Cancelled.`, 'good');
      banner(room, 'REPORTED', `${actor.name}'s ${CARDS[ctx.card].title} got taken down`, 'good', by.id);
      break;
    case 'smurf':
      by.smurf = true;
      log(room, `${by.name} logged onto a Smurf Account. Untargetable until their next turn.`, 'good');
      banner(room, 'SMURF ACCOUNT', `${by.name} vanished`, 'good', by.id);
      break;
    case 'uno':
      res = 'reverse';
      log(room, `${by.name} pulled an UNO REVERSE on ${actor.name}.`, 'tbag');
      banner(room, 'UNO REVERSE', `${actor.name}'s ${CARDS[ctx.card].title} bounces back`, 'tbag', by.id);
      break;
    case 'screenshot':
      res = 'go';
      actor.marked = true;
      log(room, `${by.name} screenshotted ${actor.name}. The next attack on ${actor.name} does double.`, 'bad');
      banner(room, 'SCREENSHOTTED', `${actor.name} is marked. Next hit on them does double`, 'bad', by.id);
      break;
  }
  broadcast(room);
  await sleep(1800);
  if (!alive(room, gen)) return 'cancel';
  if (res === 'reverse' && !target) return 'cancel';
  return res;
}

// ---------------------------------------------------------------------------
// Turn flow: draw 1, then up to 2 actions (roll once, play a card, or mulligan)
// ---------------------------------------------------------------------------
async function startTurn(room, gen) {
  if (!alive(room, gen)) return;
  const p = cur(room);
  room.busy = true;
  room.turnCount++;
  room.actionsLeft = ACTIONS_PER_TURN;
  room.rolled = false;
  clearDeadline(room);
  if (!room.players.some(human)) {
    room.paused = true;
    room.busy = false;
    return;
  }
  if (p.smurf) p.smurf = false;
  if (p.hunted > 0 && --p.hunted === 0) log(room, `Osoka's white knights stopped hunting ${p.name}.`);
  if (p.coverTurns > 0 && --p.coverTurns === 0) log(room, `${p.name}'s duo q with booster is over.`);
  if (p.duoWith && --p.duoTurns <= 0) {
    const d = byId(room, p.duoWith);
    endDuo(room, p);
    if (d) log(room, `${d.name} is free from ${p.name}'s duo.`);
  }
  broadcast(room);

  if (p.deathnote > 0) {
    p.deathnote--;
    adj(room, p, -DEATHNOTE_DRAIN);
    log(room, `${p.name} is still in Osoka's Deathnote. -${DEATHNOTE_DRAIN} aura.`, 'bad');
    broadcast(room);
    await sleep(800);
    if (!alive(room, gen)) return;
  }
  const owner = byId(room, p.owner);
  if (owner) {
    adj(room, p, -TAX_PER_TURN);
    adj(room, owner, TAX_PER_TURN);
    owner.stats.taxed += TAX_PER_TURN;
    log(room, `${p.name} paid ${owner.name} ${TAX_PER_TURN} aura to keep duo queueing.`, 'tax');
    broadcast(room);
    await sleep(800);
    if (!alive(room, gen)) return;
  } else {
    p.owner = null;
  }
  if (checkWin(room)) return;
  if (p.out) {
    room.busy = false;
    return endTurn(room, p.id, gen);
  }

  grantDraws(room, p, 1);
  room.busy = false;
  armTurnTimer(room);
  broadcast(room);
}

// No turn timer: a connected rider takes as long as they like. Only disconnected riders get autopiloted,
// and bots take their turn after a short think (unless botTurn is already driving it).
function armTurnTimer(room) {
  const p = cur(room);
  const gen = room.gen;
  if (p.bot) {
    if (room.botDriving !== p.id) setDeadline(room, BOT_THINK_MS, () => botTurn(room, p.id, gen));
    return;
  }
  if (p.connected) return clearDeadline(room);
  setDeadline(room, AFK_MS, () => autopilot(room, p.id, gen));
}

// Time ran out (or the rider is AFK): roll if they haven't moved yet, then end the turn.
async function autopilot(room, pid, gen) {
  if (!alive(room, gen) || room.busy || room.pending || room.reaction) return;
  if (cur(room).id !== pid) return;
  autoDraw(room, cur(room));
  if (!room.rolled && room.actionsLeft > 0) {
    await doRoll(room, pid, gen);
    if (!alive(room, gen) || cur(room).id !== pid) return;
  }
  endTurn(room, pid, gen);
}

async function botTurn(room, pid, gen) {
  const ok = () => alive(room, gen) && cur(room).id === pid && !room.busy && !room.pending && !room.reaction && !room.vote;
  if (!ok()) return;
  const p = cur(room);
  room.botDriving = pid;
  try {
    autoDraw(room, p);
    broadcast(room);
    if (!room.rolled && room.actionsLeft > 0) await doRoll(room, pid, gen);
    if (!ok()) return;
    if (room.actionsLeft > 0 && Math.random() < BOT_CARD_CHANCE) {
      autoDraw(room, p);
      const playable = p.hand.filter(c => cardView(room, p, c).playable);
      if (playable.length) {
        const c = playable[rand(playable.length)];
        const opts = cardOptions(room, p, CARDS[c.key]);
        await sleep(BOT_THINK_MS);
        if (!ok()) return;
        await runAction(room, pid, gen, q => playCard(room, q, c, opts ? opts[rand(opts.length)] : undefined, gen));
        if (!ok()) return;
      }
    }
    await sleep(BOT_THINK_MS / 2);
    if (!ok()) return;
    room.botDriving = null;
    endTurn(room, pid, gen);
  } finally {
    if (room.botDriving === pid) {
      room.botDriving = null;
      // Bailed out mid-turn with nothing else running: pick the turn back up later.
      if (alive(room, gen) && cur(room).id === pid && !room.busy && !room.pending && !room.reaction && !room.vote) armTurnTimer(room);
    }
  }
}

async function runAction(room, pid, gen, fn) {
  if (!alive(room, gen) || room.busy || room.pending || room.reaction || room.vote) return;
  const p = cur(room);
  // You have to take the cards you're owed (click a deck) before doing anything else.
  if (p.id !== pid || room.actionsLeft <= 0 || p.draws.length || overLimit(p)) return;
  room.busy = true;
  clearDeadline(room);
  room.actionsLeft--;
  await fn(p);
  if (!alive(room, gen) || checkWin(room)) return;
  room.busy = false;
  if (p.out) return endTurn(room, p.id, gen);
  armTurnTimer(room);
  broadcast(room);
}

function endTurn(room, pid, gen) {
  if (!alive(room, gen) || room.busy || room.pending || room.reaction || room.vote) return;
  if (cur(room).id !== pid) return;
  clearDeadline(room);
  autoDraw(room, cur(room));
  room.busy = true;
  nextTurn(room, gen);
}

function doRoll(room, pid, gen) {
  if (room.rolled) return Promise.resolve();
  return runAction(room, pid, gen, async p => {
    room.rolled = true;
    const value = p.rigRoll || 1 + rand(6);
    p.rigRoll = 0;
    fx(room, { type: 'dice', pid: p.id, value });
    log(room, `${p.name} rolled a ${value}.`);
    broadcast(room);
    await sleep(1100);
    if (!alive(room, gen)) return;
    await moveSteps(room, p, value);
    if (alive(room, gen)) await afterMove(room, p, gen);
  });
}

async function playCard(room, p, c, arg, gen) {
  const d = CARDS[c.key];
  p.hand = p.hand.filter(x => x !== c);
  discard(room, c);
  p.stats.cards++;
  const t = d.target === 'player' ? byId(room, arg) : null;
  fx(room, { type: 'card', pid: p.id, title: d.title, text: d.text, kind: d.kind, power: powerOf(c.key), target: t ? t.id : null });
  log(room, `${p.name} played ${d.title}${t ? ` on ${t.name}` : ''}.`, 'card');
  broadcast(room);
  await sleep(1600);
  if (!alive(room, gen)) return;
  const res = await contest(room, { actor: p, target: t, card: c.key }, gen);
  if (res === 'cancel' || !alive(room, gen)) return;
  const [a, b] = res === 'reverse' ? [t, p] : [p, t];
  await d.run(room, a, b, arg, gen);
  broadcast(room);
  await sleep(400);
}

async function mulligan(room, p, cards) {
  p.hand = p.hand.filter(c => !cards.includes(c));
  discard(room, ...cards);
  const got = grantDraws(room, p, cards.length - 1);
  log(room, `${p.name} threw away ${cards.length} card${cards.length > 1 ? 's' : ''} and gets to draw ${got}.`);
  broadcast(room);
  await sleep(600);
}

function nextTurn(room, gen) {
  if (checkWin(room)) return;
  do {
    room.turn = (room.turn + 1) % room.players.length;
    if (room.turn === 0) {
      room.round++;
      if (room.round > room.settings.rounds) {
        const leader = inGame(room).sort((a, b) => b.aura - a.aura)[0];
        log(room, `The final round is over.`);
        return endGame(room, leader);
      }
      log(room, `— Round ${room.round} —`, 'round');
    }
  } while (cur(room).out);
  startTurn(room, gen);
}

async function moveSteps(room, p, n) {
  const dir = Math.sign(n);
  const path = [];
  let passed = false;
  for (let i = 1; i <= Math.abs(n); i++) {
    p.pos = (p.pos + dir + BOARD.length) % BOARD.length;
    path.push(p.pos);
    if (dir > 0 && p.pos === 0) passed = true;
  }
  fx(room, { type: 'move', pid: p.id, path });
  broadcast(room);
  await sleep(Math.abs(n) * STEP_MS + 300);
  if (passed) {
    adj(room, p, SPAWN_PASS);
    log(room, `${p.name} rode past the Smurf Queue. +${SPAWN_PASS} aura.`, 'good');
  }
}

async function ride(room, p, n, gen) {
  await moveSteps(room, p, n);
  if (alive(room, gen)) await afterMove(room, p, gen);
}

async function teleport(room, p, to) {
  p.pos = to;
  fx(room, { type: 'teleport', pid: p.id, to });
  broadcast(room);
  await sleep(800);
}

// After the rider moves: drag their duo along, resolve the landing, then the duo gets the same tile.
async function afterMove(room, p, gen) {
  const partner = byId(room, p.duoWith);
  if (partner && partner.pos !== p.pos) await teleport(room, partner, p.pos);
  if (!alive(room, gen)) return;
  await resolveLanding(room, p, 0, gen);
  if (partner && alive(room, gen) && partner.pos === p.pos) {
    log(room, `${partner.name} got dragged along by their duo.`);
    await resolveTile(room, partner, 2, gen);
  }
}

async function resolveLanding(room, p, depth, gen) {
  for (const v of room.players.filter(o => o !== p && !o.out && o.pos === p.pos && !duoLinked(p, o))) {
    await tbag(room, p, v, gen);
    if (!alive(room, gen)) return;
  }
  await resolveTile(room, p, depth, gen);
}

async function resolveTile(room, p, depth, gen) {
  const tile = BOARD[p.pos];
  for (const owner of (room.taxTiles[p.pos] || []).map(id => byId(room, id))) {
    if (!owner || owner === p) continue;
    adj(room, p, -TAX_FEE);
    adj(room, owner, TAX_FEE);
    owner.stats.taxed += TAX_FEE;
    log(room, `${p.name} paid ${owner.name} a ${TAX_FEE} aura fee for landing on their tax counter.`, 'tax');
  }
  switch (tile.type) {
    case 'aura':
      adj(room, p, tile.amount);
      log(room, `${p.name}: ${tile.name}. +${tile.amount} aura.`, 'good');
      break;
    case 'cringe':
      adj(room, p, -tile.amount);
      log(room, `${p.name}: ${tile.name}. -${tile.amount} aura.`, 'bad');
      break;
    case 'card': {
      const n = grantDraws(room, p, 2);
      fx(room, { type: 'float', pid: p.id, text: `+${n} draws`, good: true });
      log(room, `${p.name} read the Patch Notes and gets to draw ${n} card${n === 1 ? '' : 's'}.`, 'card');
      break;
    }
    case 'shop':
      await shop(room, p, gen);
      break;
    case 'arena':
      await arena(room, p, gen);
      break;
    case 'deathnote': {
      p.deathnote = DEATHNOTE_TURNS;
      log(room, `${p.name}'s name was written in the Deathnote in Osoka's server.`, 'bad');
      banner(room, 'DEATHNOTE', `${p.name} got written in Osoka's server. -${DEATHNOTE_DRAIN} aura for ${DEATHNOTE_TURNS} turns`, 'bad', p.id);
      if (p.hand.length) {
        const c = p.hand.splice(rand(p.hand.length), 1)[0];
        discard(room, c);
        log(room, `Osoka leaked ${p.name}'s hand. They had to discard ${CARDS[c.key].title}.`, 'bad');
      }
      await sleep(1200);
      break;
    }
    case 'oasis': {
      const n = grantDraws(room, p, 1, 'guard');
      fx(room, { type: 'float', pid: p.id, text: '+1 guard draw', good: true });
      log(room, `${p.name} chilled at the Oasis${n ? ' and gets a draw from the Guard deck' : ''}.`, 'good');
      break;
    }
    case 'booster':
      await booster(room, p, 15);
      break;
    case 'storm': {
      let to;
      do { to = rand(BOARD.length); } while (to === STORM_TILE);
      log(room, `A sandstorm blew ${p.name} to ${BOARD[to].name}.`);
      banner(room, 'SANDSTORM', `${p.name} got yeeted across the desert`, 'info', p.id);
      await sleep(600);
      await teleport(room, p, to);
      if (alive(room, gen) && depth < 2) await resolveLanding(room, p, depth + 1, gen);
      break;
    }
    case 'tax':
      if (hostagesOf(room, p).length) {
        collectTax(room, p);
      } else {
        const t = Math.max(5, Math.floor(p.aura * 0.1));
        adj(room, p, -t);
        log(room, `${p.name} has no hostages, so they paid ${t} aura tax to the government.`, 'bad');
      }
      break;
    case 'sprint':
      if (p === cur(room)) {
        room.actionsLeft++;
        room.rolled = false;
        banner(room, 'CAMEL ZOOMIES', `${p.name} gets +1 action and can roll again`, 'good', p.id);
      }
      break;
  }
  broadcast(room);
  await sleep(600);
}

async function tbag(room, thief, victim, gen) {
  if (victim.smurf) {
    log(room, `${thief.name} tried to T-bag ${victim.name}, but they're on a smurf account.`);
    return;
  }
  const res = await contest(room, { actor: thief, target: victim, tbag: true }, gen);
  if (res !== 'go') return;
  const mult = (room.boosterId === thief.id ? 2 : 1) * (victim.hunted > 0 ? 3 : 1);
  const got = stealAura(room, victim, thief, TBAG_STEAL * mult);
  thief.stats.tbags++;
  fx(room, { type: 'tbag', thief: thief.id, victim: victim.id });
  banner(room, 'T-BAGGED', `${thief.name} stole ${got} aura from ${victim.name}`, 'tbag', thief.id);
  log(room, `${thief.name} T-bagged ${victim.name} and stole ${got} aura.`, 'tbag');
  afterSteal(room, thief, victim, got);
  broadcast(room);
  await sleep(1900);
}

async function booster(room, p, base) {
  const hostages = hostagesOf(room, p);
  if (hostages.length) {
    const names = hostages.map(h => h.name).join(' & ');
    adj(room, p, -marked(room, p, 35));
    hostages.forEach(h => { h.owner = null; });
    p.deathnote = DEATHNOTE_TURNS;
    log(room, `A booster on the enemy team destroyed ${p.name} right in front of ${names}. They screenshotted it and put ${p.name} in the Deathnote. Hostages escaped.`, 'bad');
    banner(room, 'DESTROYED', `${p.name} got clapped by a booster in front of ${names}. Screenshotted. Deathnoted.`, 'bad', p.id);
  } else {
    const n = marked(room, p, base);
    adj(room, p, -n);
    log(room, `A booster on the enemy team destroyed ${p.name}. -${n} aura.`, 'bad');
    banner(room, 'BOOSTER AMBUSH', `${p.name} got destroyed by a booster`, 'bad', p.id);
  }
  broadcast(room);
  await sleep(1800);
}

async function shop(room, p, gen) {
  const opts = [];
  if (p.aura >= SHOP_PRICE) opts.push('guard', 'attack');
  if (p.aura >= LEGEND_PRICE && hasLegend(room)) opts.push('legend');
  if (!opts.length) {
    log(room, `${p.name} window-shopped at the Card Shop. Too broke.`);
    return;
  }
  opts.push('skip');
  const pick = await awaitChoice(room, p, opts, 'shop', 'skip');
  if (!alive(room, gen) || pick === 'skip') return;
  const legend = pick === 'legend';
  const got = drawCards(room, p, 1, legend ? 'attack' : pick, legend ? d => d.kind === 'legend' : undefined);
  if (!got) return;
  adj(room, p, -(legend ? LEGEND_PRICE : SHOP_PRICE));
  log(room, legend ? `${p.name} bought a LEGENDARY card. Be afraid.` : `${p.name} bought a card.`, 'card');
  if (legend) banner(room, 'LEGENDARY', `${p.name} bought a legendary card`, 'tax', p.id);
}

async function snitch(room, p, t, gen) {
  if (!t.hand.length) return;
  const peek = t.hand.map(c => ({ uid: c.uid, key: c.key, kind: CARDS[c.key].kind, title: CARDS[c.key].title, text: CARDS[c.key].text }));
  const uid = await awaitChoice(room, p, peek.map(c => c.uid), 'snitch', null, peek);
  if (!alive(room, gen)) return;
  const c = t.hand.find(x => x.uid === uid);
  if (!c) return;
  t.hand = t.hand.filter(x => x !== c);
  p.hand.push(c);
  log(room, `${p.name} snitched on ${t.name} and stole a card.`, 'bad');
  whisper(t, `${p.name} stole your ${CARDS[c.key].title}`);
  broadcast(room);
  await sleep(800);
}

async function serverVote(room, gen) {
  const voters = ids(room.players.filter(o => human(o) && !o.out));
  banner(room, 'SERVER VOTE', 'Vote who gets sent to the Booster Ambush');
  log(room, 'SERVER VOTE. Everyone votes who gets sent to the Booster Ambush.', 'card');
  await new Promise(resolve => {
    room.vote = { voters, votes: {}, deadline: now() + VOTE_MS, done: resolve };
    room.voteTimer = setTimeout(resolve, VOTE_MS);
    broadcast(room);
  });
  clearTimeout(room.voteTimer);
  const votes = room.vote ? room.vote.votes : {};
  room.vote = null;
  if (!alive(room, gen)) return;
  const tally = {};
  for (const id of Object.values(votes)) tally[id] = (tally[id] || 0) + 1;
  const top = Math.max(0, ...Object.values(tally));
  const leaders = top ? Object.keys(tally).filter(id => tally[id] === top) : ids(inGame(room));
  const v = byId(room, leaders[rand(leaders.length)]);
  if (!v) return;
  log(room, `The server voted ${v.name}${top ? ` (${top} vote${top > 1 ? 's' : ''})` : ' (nobody voted, so it was random)'}. Off to the Booster Ambush.`, 'bad');
  banner(room, 'VOTED OUT', `${v.name} gets sent to the booster`, 'bad', v.id);
  await sleep(1200);
  await teleport(room, v, BOOSTER_TILE);
  if (alive(room, gen)) await booster(room, v, 15);
}

function checkVoteDone(room) {
  const v = room.vote;
  if (v && v.voters.every(id => v.votes[id])) v.done();
}

function awaitChoice(room, p, options, kind, fallback = null, peek = null) {
  return new Promise(resolve => {
    let settled = false;
    const done = id => {
      if (settled) return;
      settled = true;
      clearDeadline(room);
      room.pending = null;
      room.choose = null;
      room.choiceFallback = null;
      resolve(id);
    };
    room.pending = { pid: p.id, kind, options, peek };
    room.choose = done;
    room.choiceFallback = () => done(fallback != null ? fallback : options[rand(options.length)]);
    if (p.bot) setDeadline(room, BOT_THINK_MS, room.choiceFallback);
    else if (p.connected) clearDeadline(room);
    else setDeadline(room, AFK_MS, room.choiceFallback);
    broadcast(room);
  });
}

async function arena(room, p, gen) {
  const opts = others(room, p).map(o => o.id);
  if (!opts.length) return;
  banner(room, 'RANKED 1v1', `${p.name} is picking a victim...`);
  const targetId = await awaitChoice(room, p, opts, 'arena');
  if (!alive(room, gen)) return;
  const t = byId(room, targetId);
  if (!t) return;

  const ra = 1 + rand(6);
  const rb = 1 + rand(6);
  fx(room, { type: 'duel', a: p.id, b: t.id, ra, rb });
  broadcast(room);
  await sleep(2000);
  if (!alive(room, gen)) return;

  if (ra === rb) {
    adj(room, p, -3);
    adj(room, t, -3);
    log(room, `${p.name} vs ${t.name}: ${ra}-${rb}. A draw. Everyone loses 3 aura for wasting time.`);
    banner(room, 'DRAW', 'Both riders lose 3 aura for wasting everyone\'s time');
  } else {
    const [w, l] = ra > rb ? [p, t] : [t, p];
    const got = stealAura(room, l, w, ARENA_STEAL);
    log(room, `${p.name} vs ${t.name}: ${ra}-${rb}. ${w.name} won and stole ${got} aura. GG EZ.`, 'tbag');
    banner(room, 'GG EZ', `${w.name} diffed ${l.name} (${Math.max(ra, rb)}-${Math.min(ra, rb)})`, 'tbag', w.id);
    afterSteal(room, w, l, got);
    broadcast(room);
    await sleep(1500);
    if (!alive(room, gen)) return;
    // The winner decides whether to rub it in.
    const gloat = await awaitChoice(room, w, ['tbag', 'spare'], 'gloat', 'tbag');
    if (!alive(room, gen)) return;
    if (gloat === 'tbag') {
      const extra = stealAura(room, l, w, ARENA_TBAG);
      w.stats.tbags++;
      fx(room, { type: 'tbag', thief: w.id, victim: l.id });
      banner(room, 'T-BAGGED', `${w.name} T-bagged ${l.name} after the 1v1 for ${extra} more aura`, 'tbag', w.id);
      log(room, `${w.name} T-bagged ${l.name} after the 1v1. +${extra} aura.`, 'tbag');
      afterSteal(room, w, l, extra);
    } else {
      log(room, `${w.name} let ${l.name} go. Respectful.`);
    }
  }
  broadcast(room);
  await sleep(1500);
}

function checkWin(room) {
  if (room.phase !== 'play') return false;
  const left = inGame(room);
  if (left.length <= 1) {
    const w = left[0] || [...room.players].sort((a, b) => b.aura - a.aura)[0];
    log(room, `Everyone else is out. ${w.name} is the last rider standing.`, 'win');
    endGame(room, w);
    return true;
  }
  const w = left
    .filter(p => p.aura >= room.settings.target)
    .sort((a, b) => b.aura - a.aura)[0];
  if (!w) return false;
  endGame(room, w);
  return true;
}

// Stop every timer and open prompt (turn, choice, reaction, vote).
function stopEverything(room) {
  clearDeadline(room);
  if (room.reaction) room.reaction.cancel();
  if (room.vote) room.vote.done();
  clearTimeout(room.voteTimer);
  room.vote = null;
  room.pending = null;
}

function endGame(room, winner) {
  room.phase = 'over';
  room.winnerId = winner.id;
  room.busy = false;
  stopEverything(room);
  log(room, `${winner.name} wins with ${winner.aura} aura. Absolute champ smurf camel rider.`, 'win');
  fx(room, { type: 'confetti' });
  broadcast(room);
}

function startGame(room) {
  room.gen++;
  room.players = room.players.filter(p => p.connected);
  shuffle(room.players);
  room.players.forEach(resetPlayer);
  Object.assign(room, {
    phase: 'play', turn: 0, round: 1, turnCount: 0, stolen: {}, log: [], winnerId: null, boosterId: null, taxTiles: {},
    busy: false, pending: null, reaction: null, vote: null, paused: false, emptySince: 0,
  });
  buildDecks(room);
  // The starting hand is dealt: 2 from Guard, the rest from Attack. Every draw after that is picked by hand.
  room.players.forEach(p => {
    drawCards(room, p, 2, 'guard');
    drawCards(room, p, START_HAND - 2, 'attack');
  });
  log(room, `The ride begins. First to ${room.settings.target} aura wins. ${room.players[0].name} goes first.`, 'round');
  startTurn(room, room.gen);
}

function backToLobby(room) {
  room.gen++;
  stopEverything(room);
  room.players = room.players.filter(p => p.connected);
  room.players.forEach(resetPlayer);
  Object.assign(room, { phase: 'lobby', busy: false, winnerId: null, log: [], stolen: {}, emptySince: 0 });
  promoteSpectators(room);
  broadcast(room);
}

// A rider went AFK: skip any prompt waiting on them and hurry their turn along.
function onRiderGone(room, p) {
  if (room.phase !== 'play') return;
  if (room.reaction && room.reaction.ask[p.id]) room.reaction.respond(p.id, null);
  if (room.vote && room.vote.voters.includes(p.id)) {
    room.vote.voters = room.vote.voters.filter(id => id !== p.id);
    checkVoteDone(room);
  }
  if (room.pending && room.pending.pid === p.id) setDeadline(room, AFK_MS, room.choiceFallback);
  else if (cur(room) === p && !room.busy && !room.reaction && !room.vote) armTurnTimer(room);
}

// ---------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------
io.on('connection', socket => {
  const room = desert;
  let me = null; // a rider, or a spectator who joined mid-game
  const reply = (cb, data) => { if (typeof cb === 'function') cb(data); };
  const isRider = () => !!me && room.players.includes(me);
  const myTurn = () => isRider() && room.phase === 'play' && cur(room) === me;

  function leaveCurrent() {
    if (!me) return;
    const p = me;
    me = null;
    socket.leave(ROOM);
    if (room.spectators.includes(p)) {
      room.spectators = room.spectators.filter(x => x !== p);
    } else if (room.phase === 'lobby') {
      room.players = room.players.filter(x => x !== p);
      promoteSpectators(room);
    } else {
      p.connected = false;
      p.socketId = null;
      onRiderGone(room, p);
      if (!room.players.some(human)) room.emptySince = now();
    }
    broadcast(room);
  }

  socket.on('join', ({ name, token } = {}, cb) => {
    token = String(token || crypto.randomBytes(8).toString('hex')).slice(0, 64);
    const existing = room.players.find(p => p.token === token);
    if (existing) {
      if (me !== existing) leaveCurrent();
      me = existing;
      me.socketId = socket.id;
      me.connected = true;
      room.emptySince = 0;
      socket.join(ROOM);
      reply(cb, { ok: true, playerId: me.id });
      if (room.phase === 'play') {
        if (room.paused) {
          room.paused = false;
          startTurn(room, room.gen);
        } else if (room.pending && room.pending.pid === me.id) {
          clearDeadline(room); // back in time: the autopilot pick is cancelled
        } else if (cur(room) === me && !room.busy && !room.reaction && !room.vote) {
          armTurnTimer(room);
        }
      }
      broadcast(room);
      return;
    }

    leaveCurrent();
    room.spectators = room.spectators.filter(s => s.token !== token);
    const info = { id: crypto.randomBytes(6).toString('hex'), token, socketId: socket.id, name: cleanName(name) };
    if (room.phase === 'lobby' && room.players.length < MAX_PLAYERS) {
      me = makePlayer(room, info);
    } else {
      me = info;
      room.spectators.push(me);
    }
    socket.join(ROOM);
    reply(cb, { ok: true, playerId: me.id });
    broadcast(room);
  });

  // Bots are added and removed from the lobby by any rider there.
  socket.on('addBot', () => {
    if (!isRider() || room.phase !== 'lobby' || room.players.length >= MAX_PLAYERS) return;
    const taken = new Set(room.players.map(p => p.name));
    const name = BOT_NAMES.find(n => !taken.has(n)) || `NPC ${room.players.length + 1}`;
    makePlayer(room, { name, bot: true });
    broadcast(room);
  });
  socket.on('removeBot', id => {
    if (!isRider() || room.phase !== 'lobby') return;
    const bot = id ? room.players.find(p => p.bot && p.id === id) : [...room.players].reverse().find(p => p.bot);
    if (!bot) return;
    room.players = room.players.filter(p => p !== bot);
    promoteSpectators(room);
    broadcast(room);
  });

  socket.on('color', color => {
    if (!isRider() || room.phase !== 'lobby' || !COLORS.includes(color)) return;
    if (room.players.some(p => p !== me && p.color === color)) return;
    me.color = color;
    broadcast(room);
  });

  // A sticker id, or { gif: url } for a custom GIF from search or a pasted link.
  socket.on('sticker', id => {
    if (!isRider() || room.phase === 'lobby') return;
    const gif = id && typeof id === 'object' ? cleanGifUrl(id.gif) : null;
    if (!gif && !STICKERS.includes(id)) return;
    if (now() - (me.lastSticker || 0) < STICKER_COOLDOWN_MS) return;
    me.lastSticker = now();
    fx(room, gif ? { type: 'sticker', pid: me.id, gif } : { type: 'sticker', pid: me.id, id });
  });

  socket.on('dice', id => {
    if (!isRider() || room.phase !== 'lobby' || !DICE.includes(id)) return;
    me.dice = id;
    broadcast(room);
  });

  socket.on('champion', champ => {
    if (!isRider() || room.phase !== 'lobby' || !CHAMPIONS.includes(champ)) return;
    me.champion = champ;
    broadcast(room);
  });

  socket.on('settings', ({ target, rounds } = {}) => {
    if (!isRider() || room.phase !== 'lobby') return;
    if (TARGETS.includes(Number(target))) room.settings.target = Number(target);
    if (ROUNDS.includes(Number(rounds))) room.settings.rounds = Number(rounds);
    broadcast(room);
  });

  socket.on('start', () => {
    if (!isRider() || room.phase !== 'lobby') return;
    if (room.players.filter(p => p.connected).length < MIN_PLAYERS) return;
    startGame(room);
  });

  socket.on('roll', () => {
    if (!myTurn()) return;
    doRoll(room, me.id, room.gen);
  });

  socket.on('play', ({ uid, arg } = {}) => {
    if (!myTurn() || room.busy || !room.rolled) return;
    const c = me.hand.find(x => x.uid === uid);
    if (!c) return;
    const d = CARDS[c.key];
    if (d.kind === 'react') return;
    const opts = cardOptions(room, me, d);
    if (opts ? !opts.includes(arg) : (d.can && !d.can(room, me))) return;
    const gen = room.gen;
    runAction(room, me.id, gen, p => playCard(room, p, c, arg, gen));
  });

  socket.on('draw', deck => {
    if (!isRider() || room.phase !== 'play') return;
    if (!drawOne(room, me, deck)) return;
    broadcast(room);
  });

  socket.on('discard', uid => {
    if (!isRider() || room.phase !== 'play' || !overLimit(me)) return;
    const c = me.hand.find(x => x.uid === uid);
    if (!c) return;
    me.hand = me.hand.filter(x => x !== c);
    discard(room, c);
    broadcast(room);
  });

  socket.on('mulligan', uids => {
    if (!myTurn() || room.busy || !Array.isArray(uids)) return;
    const cards = me.hand.filter(c => uids.includes(c.uid));
    if (!cards.length) return;
    runAction(room, me.id, room.gen, p => mulligan(room, p, cards));
  });

  socket.on('end', () => {
    if (!myTurn()) return;
    endTurn(room, me.id, room.gen);
  });

  socket.on('choose', id => {
    if (!isRider() || !room.pending || room.pending.pid !== me.id) return;
    if (!room.pending.options.includes(id)) return;
    room.choose(id);
  });

  socket.on('react', uid => {
    if (!isRider() || !room.reaction) return;
    room.reaction.respond(me.id, uid == null ? null : uid);
  });

  socket.on('vote', id => {
    const v = room.vote;
    if (!isRider() || !v || !v.voters.includes(me.id) || v.votes[me.id]) return;
    if (id === me.id || !byId(room, id) || byId(room, id).out) return;
    v.votes[me.id] = id;
    broadcast(room);
    checkVoteDone(room);
  });

  // Anyone in the game can end it early. Whoever has the most aura right then wins.
  socket.on('endgame', () => {
    if (!isRider() || room.phase !== 'play') return;
    room.gen++; // stops a turn that is still running
    const winner = (inGame(room).length ? inGame(room) : [...room.players]).sort((a, b) => b.aura - a.aura)[0];
    banner(room, 'Game ended', `${me.name} ended the game`, 'info', me.id);
    endGame(room, winner);
  });

  socket.on('lobby', () => {
    if (!isRider() || room.phase !== 'over') return;
    backToLobby(room);
  });

  socket.on('leave', () => leaveCurrent());

  // Debug menu (backquote key on the client). Only for players on this machine, or anyone when AURA_DEBUG=1.
  const debugAllowed = process.env.AURA_DEBUG === '1' || /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(socket.handshake.address);
  socket.on('debug:info', cb => reply(cb, {
    allowed: debugAllowed,
    cards: Object.entries(CARDS).map(([key, d]) => ({ key, title: d.title, kind: d.kind })),
    tiles: BOARD.map((t, i) => ({ i, name: t.name })),
  }));
  socket.on('debug', ({ action, ...a } = {}, cb) => {
    if (!debugAllowed || !isRider()) return reply(cb, { ok: false, error: 'Debug is off, or you are not a rider' });
    if (action === 'champion') {
      if (!CHAMPIONS.includes(a.id)) return reply(cb, { ok: false, error: 'Unknown champion' });
      me.champion = a.id;
      broadcast(room);
      return reply(cb, { ok: true });
    }
    if (room.phase !== 'play') return reply(cb, { ok: false, error: 'Start a game first' });
    switch (action) {
      case 'aura':
        adj(room, me, Math.round(Number(a.amount) || 0));
        break;
      case 'card':
        if (!CARDS[a.key]) return reply(cb, { ok: false, error: 'Unknown card' });
        me.hand.push({ uid: ++room.uid, key: a.key });
        break;
      case 'roll':
        me.rigRoll = Math.max(1, Math.min(6, Math.round(Number(a.value)) || 1));
        break;
      case 'teleport': {
        const to = Math.round(Number(a.tile));
        if (!(to >= 0 && to < BOARD.length)) return reply(cb, { ok: false, error: 'Bad tile' });
        me.pos = to;
        fx(room, { type: 'teleport', pid: me.id, to });
        break;
      }
      case 'tbag': {
        // A straight T-bag on someone: no reactions, no tile effects. For testing sounds and animations.
        const v = byId(room, a.victim);
        if (!v || v === me) return reply(cb, { ok: false, error: 'Pick another rider' });
        const got = stealAura(room, v, me, TBAG_STEAL);
        me.stats.tbags++;
        fx(room, { type: 'tbag', thief: me.id, victim: v.id });
        banner(room, 'T-BAGGED', `${me.name} stole ${got} aura from ${v.name} (debug)`, 'tbag', me.id);
        log(room, `[debug] ${me.name} T-bagged ${v.name} and stole ${got} aura.`, 'tbag');
        break;
      }
      default:
        return reply(cb, { ok: false, error: 'Unknown action' });
    }
    broadcast(room);
    reply(cb, { ok: true });
    // A cheat can knock someone out: end the game if one rider is left, or pass the turn if it was theirs.
    if (!checkWin(room) && cur(room).out && !room.busy && !room.pending && !room.reaction && !room.vote) endTurn(room, cur(room).id, room.gen);
  });

  socket.on('disconnect', () => {
    if (!me || me.socketId !== socket.id) return;
    if (!isRider() || room.phase === 'lobby') return leaveCurrent();
    me.connected = false;
    me.socketId = null;
    onRiderGone(room, me);
    if (!room.players.some(human)) room.emptySince = now();
    broadcast(room);
  });
});

// If every rider has been gone for 10 minutes, scrap the game and reopen the lobby.
setInterval(() => {
  if (desert.phase !== 'lobby' && desert.emptySince && now() - desert.emptySince > 10 * 60 * 1000) {
    backToLobby(desert);
  }
}, 60 * 1000);

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Aura Tax running on http://localhost:${PORT}`));
