'use strict';
// ---------------------------------------------------------------------------
// Static game data: piece stats, player gun stats, levels and cards.
// Tweak numbers here to rebalance the game — no engine changes needed.
// ---------------------------------------------------------------------------

// hp: hit points, speed: moves once every N enemy turns, soul: drops a soul on death
const PIECES = {
  P: { name: 'Pawn',   hp: 2, speed: 2, soul: false },
  N: { name: 'Knight', hp: 3, speed: 2, soul: true  },
  B: { name: 'Bishop', hp: 3, speed: 2, soul: true  },
  R: { name: 'Rook',   hp: 5, speed: 2, soul: true  },
  Q: { name: 'Queen',  hp: 6, speed: 2, soul: true  },
  K: { name: 'King',   hp: 5, speed: 3, soul: false },
};

// The Black King's shotgun. Spread is in degrees, range in squares.
const BASE_STATS = {
  pellets: 5,
  spread: 44,
  range: 3.2,
  damage: 1,
  pierce: 0,
  capacity: 2,
  reserveBonus: 0,
  reloadPerMove: 1,
  shields: 1,
  soulSlots: 1,
  knockback: false,
  scavenger: 0,
  startSoul: null,
};

// Board legend: '@' = you (Black King), P N B R Q K = white pieces, '.' = empty.
// Row 0 is the top of the board (rank 8). White pawns march DOWN toward you.
const LEVELS = [
  {
    id: 1, name: 'First Blood', objective: 'all', par: 7, reserve: 6,
    tip: 'Pawns only attack diagonally downward. Walk up close — a point-blank shot hits with every pellet.',
    board: [
      '........',
      '........',
      '..P...P.',
      '........',
      '....P...',
      '........',
      '........',
      '....@...',
    ],
  },
  {
    id: 2, name: 'Horse Play', objective: 'all', par: 10, reserve: 8,
    tip: 'Knights jump in an L and move every 2 turns. Turn on Danger squares (V) to see exactly where you can stand.',
    board: [
      '........',
      '.N....N.',
      '........',
      '...PP...',
      '........',
      '........',
      '........',
      '...@....',
    ],
  },
  {
    id: 3, name: 'Diagonal Danger', objective: 'all', par: 10, reserve: 8,
    tip: 'Bishops slide across the whole board. Killing a pawn can open a bishop line — the game stops any shot that would expose your king.',
    board: [
      '..B..B..',
      '........',
      '.P....P.',
      '........',
      '........',
      '........',
      '........',
      '....@...',
    ],
  },
  {
    id: 4, name: 'Castle Walls', objective: 'all', par: 13, reserve: 10,
    tip: 'Rooks have 5 HP. Soften them from range, then finish them point-blank. Grab a rook soul to dash across the board.',
    board: [
      'R......R',
      '...PP...',
      '........',
      '........',
      '........',
      '........',
      '........',
      '...@....',
    ],
  },
  {
    id: 5, name: 'Regicide', objective: 'king', par: 11, reserve: 10,
    tip: 'Kill the White King to win — the rest of his army falls with him.',
    board: [
      '...K....',
      '..PPP...',
      '........',
      '.N....N.',
      '........',
      '........',
      '........',
      '....@...',
    ],
  },
  {
    id: 6, name: 'The Swarm', objective: 'all', par: 18, reserve: 14,
    tip: 'Reinforcements march in from the top every 3 turns. Clear the board AND every reinforcement.',
    board: [
      '........',
      'P.....P.',
      '...PP...',
      '........',
      '........',
      '........',
      '........',
      '...@....',
    ],
    reinforce: { every: 3, pool: ['P', 'P', 'N', 'P', 'P', 'N'], cols: [1, 6, 3, 4, 0, 7] },
  },
  {
    id: 7, name: 'Her Majesty', objective: 'all', par: 13, reserve: 12,
    tip: 'The Queen checks from anywhere. Keep pawns between you and her until you can take her apart.',
    board: [
      '....Q...',
      '........',
      '.P.P.P..',
      '........',
      '........',
      '........',
      '........',
      '...@....',
    ],
  },
  {
    id: 8, name: 'The Final Checkmate', objective: 'king', par: 20, reserve: 16,
    tip: 'The full army. Kill the White King — reinforcements keep coming until you do.',
    board: [
      'R..QK..R',
      '.PP..PP.',
      '..N..B..',
      '........',
      '........',
      '........',
      '........',
      '....@...',
    ],
    reinforce: { every: 5, pool: ['P', 'P', 'P', 'P', 'N', 'P', 'P', 'B'], cols: [3, 4, 2, 5, 1, 6] },
  },
];

// Black cards buff you (modify gun stats). White cards buff the enemy (modify s.mods).
const BLACK_CARDS = [
  { id: 'barrel',     name: 'Third Barrel',   icon: '🛢', text: '+1 shell capacity.',                         apply: st => { st.capacity += 1; } },
  { id: 'bandolier',  name: 'Bandolier',      icon: '🎒', text: '+4 reserve shells every level.',             apply: st => { st.reserveBonus += 4; } },
  { id: 'buckshot',   name: 'Buckshot',       icon: '💥', text: '+2 pellets, spread +8°.',                    apply: st => { st.pellets += 2; st.spread += 8; } },
  { id: 'choke',      name: 'Full Choke',     icon: '🎯', text: 'Spread −14°, range +0.8.',                   apply: st => { st.spread = Math.max(8, st.spread - 14); st.range += 0.8; } },
  { id: 'longbarrel', name: 'Long Barrel',    icon: '📏', text: 'Range +1 square.',                           apply: st => { st.range += 1; } },
  { id: 'slugs',      name: 'Heavy Slugs',    icon: '🔩', text: 'Pellets deal +1 damage, but −2 pellets.',    apply: st => { st.damage += 1; st.pellets = Math.max(1, st.pellets - 2); } },
  { id: 'needle',     name: 'Needle Shot',    icon: '🪡', text: 'Pellets pierce through 1 extra piece.',      apply: st => { st.pierce += 1; } },
  { id: 'kick',       name: 'Kickback Shells',icon: '🦶', text: 'Pieces that survive a hit are knocked back 1 square.', apply: st => { st.knockback = true; } },
  { id: 'quick',      name: 'Quick Hands',    icon: '✋', text: 'Moving reloads 2 shells instead of 1.',      apply: st => { st.reloadPerMove = 2; } },
  { id: 'scavenger',  name: 'Scavenger',      icon: '🦴', text: 'Every kill adds +1 reserve shell.',          apply: st => { st.scavenger += 1; } },
  { id: 'halo',       name: 'Second Halo',    icon: '😇', text: '+1 Divine Shield every level.',              apply: st => { st.shields += 1; } },
  { id: 'soul_jar',   name: 'Soul Jar',       icon: '🏺', text: '+1 soul slot.',                              apply: st => { st.soulSlots += 1; } },
  { id: 'vow',        name: "Knight's Vow",   icon: '🐴', text: 'Start every level holding a Knight soul.',   apply: st => { st.startSoul = 'N'; } },
];

const WHITE_CARDS = [
  { id: 'chainmail',  name: 'Chainmail',       icon: '⛓', text: 'Pawns +1 HP.',                     mods: m => { m.hp.P = (m.hp.P || 0) + 1; } },
  { id: 'holy',       name: 'Holy Order',      icon: '✝', text: 'Bishops +2 HP.',                   mods: m => { m.hp.B = (m.hp.B || 0) + 2; } },
  { id: 'towers',     name: 'Stone Towers',    icon: '🏰', text: 'Rooks +2 HP.',                     mods: m => { m.hp.R = (m.hp.R || 0) + 2; } },
  { id: 'bodyguard',  name: 'Royal Bodyguard', icon: '👑', text: 'White King +3 HP.',                mods: m => { m.hp.K = (m.hp.K || 0) + 3; } },
  { id: 'veterans',   name: 'Veterans',        icon: '🎖', text: 'All enemies +1 HP.',               mods: m => { m.hp.all = (m.hp.all || 0) + 1; } },
  { id: 'cavalry',    name: 'Cavalry Charge',  icon: '🏇', text: 'Knights move every turn.',         mods: m => { m.speedSet.N = 1; } },
  { id: 'zealots',    name: 'Zealots',         icon: '🔥', text: 'Pawns move every turn.',           mods: m => { m.speedSet.P = 1; } },
  { id: 'conscripts', name: 'Conscription',    icon: '📜', text: '+2 extra pawns every level.',      mods: m => { m.extra.push('P', 'P'); } },
  { id: 'crusade',    name: 'Crusade',         icon: '⚔', text: '+1 extra Bishop every level.',     mods: m => { m.extra.push('B'); } },
  { id: 'rationing',  name: 'Rationing',       icon: '📉', text: '−2 reserve shells every level.',   mods: m => { m.reserve -= 2; } },
  { id: 'ambush',     name: 'Ambush',          icon: '🌑', text: 'Every enemy acts on the first turn.', mods: m => { m.ambush = true; } },
  { id: 'drums',      name: 'War Drums',       icon: '🥁', text: 'Reinforcements arrive 1 turn sooner. Quiet levels get a pawn every 6 turns.', mods: m => { m.drums = true; } },
];
