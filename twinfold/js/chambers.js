/* TWINFOLD — the fifteen chambers.
   Legend
   #  metal (no portals)      =  light panel (portals stick)   %  grate (blocks bodies, not shots)
   ~  acid / lava             !  fizzler (clears portals, destroys cubes, eats shots)
   P  start                   X  exit (bottom cell)            o  cube
   1-4 floor button (channel) 5-8 laser receiver (channel 1-4) a-d door (channel 1-4)
   > < ^ v  laser emitter     G  portal device (gun +1; fixed portals hand over to def.gunPre[newGun])
   :  crumbling rock (falls 0.5 s after anything stands on it or a laser touches it, re-forms 3.2 s later)
   V W fire vent (W is half a cycle behind V)     Y stalactite       S lava shark
   M  stalker                 F  checkpoint brazier
   Every chamber carries `sol`, a scripted run that tools/sim.js replays to prove it can be finished.
   No two chambers share a puzzle: each section is drawn by hand for the chamber it lives in. */
(function (root) {
  'use strict';
  const L = [];

  // ---- map builder ----
  function G(w, h, fill) {
    const g = [];
    for (let y = 0; y < h; y++) g.push(new Array(w).fill(fill || '#'));
    const api = {
      r(x0, y0, x1, y1, ch) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = ch; return api; },
      p(x, y, str) { for (let i = 0; i < str.length; i++) if (str[i] !== ' ') g[y][x + i] = str[i]; return api; },
      v(x, y, str) { for (let i = 0; i < str.length; i++) if (str[i] !== ' ') g[y + i][x] = str[i]; return api; },
      rows() { return g.map(r => r.join('')); }
    };
    return api;
  }
  const VOL = (o) => Object.assign({ theme: 'volcano', gun: 2 }, o);

  /* 1 — Threshold. No device yet: the fixed pair carries you up. Find the device, then fall to rise. */
  {
    const g = G(52, 31);
    // the floor you wake on: a step, a wall, a pit, then a portal in the wall
    g.r(1, 24, 33, 27, '.'); g.p(2, 27, 'P');
    g.p(8, 27, '#'); g.r(13, 26, 14, 27, '#');
    g.r(19, 28, 20, 29, '~');
    g.v(34, 26, '==');
    // the hall above: a staircase up and to the right
    g.r(1, 7, 29, 15, '.'); g.v(0, 14, '==');
    g.r(12, 14, 15, 15, '#'); g.r(16, 12, 19, 15, '#'); g.r(20, 10, 26, 15, '#'); g.r(27, 8, 29, 15, '#');
    g.r(26, 6, 29, 7, '.');
    // the top walk: a grate catwalk over a deep pit, and the device waiting on it
    g.r(22, 2, 39, 5, '.'); g.p(33, 5, 'G');
    g.r(31, 7, 39, 18, '.'); g.r(31, 6, 36, 6, '%'); g.r(37, 6, 39, 6, '.'); g.p(38, 19, '==');
    // the tower: its floor is where the violet portal moves to
    g.r(42, 9, 47, 27, '.'); g.p(44, 28, '==');
    g.r(48, 13, 50, 16, '.'); g.p(50, 16, 'X');
    L.push({
      name: 'Threshold', gun: 0, par: 1,
      hint: 'A D  MOVE     W  JUMP',
      gunHint: { 1: 'CLICK  FIRE     LOOK DOWN BEFORE YOU LEAP' },
      pre: [{ c: 0, x: 34, y: 26, f: 'l' }, { c: 1, x: 0, y: 14, f: 'r' }],
      gunPre: { 1: [{ c: 1, x: 44, y: 28, f: 'u' }] },
      map: g.rows(),
      sol: [['to', 5.5], ['r', 0.1], ['rj', 0.5], ['to', 11.0], ['r', 0.1], ['rj', 0.5], ['to', 17.8], ['r', 0.1], ['rj', 0.6], ['to', 36],
        ['wg'], ['to', 10.6], ['rj', 0.5], ['to', 14.8], ['rj', 0.5], ['to', 18.8], ['rj', 0.5], ['to', 25.8], ['rj', 0.4], ['to', 28.9], ['rj', 0.5],
        ['to', 35.5], ['s', 0, 38, 19, 'u', 0.75], ['to', 39], ['wtp'], ['r', 1.2], ['to', 50.5]]
    });
  }

  /* 2 — Underfoot. Mint alone gets you onto the catwalk; violet waits there. Fling left, rise backwards
     through your own floor, then jump into the well and fix your landing on the way down. */
  {
    const g = G(49, 42);
    // the hall: start on its floor, the fixed violet hangs in its ceiling above the catwalk
    g.r(30, 4, 46, 31, '.'); g.p(44, 31, 'P');
    g.p(30, 32, '==');                                  // the floor panel that does all the work
    g.p(41, 3, '=='); g.r(30, 4, 30, 8, '#');            // fixed violet ceiling, and the lip at the catwalk's end
    g.r(32, 7, 46, 7, '%'); g.p(45, 6, 'G');             // grate catwalk with the violet device
    g.v(47, 11, '==');                                   // the hall's far wall
    // the ledge to the west, under the top walk
    g.r(13, 7, 29, 17, '.'); g.p(22, 18, '==');
    // the top walk, with a hole down to the ledge, ending at the well
    g.r(8, 3, 28, 5, '.'); g.r(18, 6, 24, 6, '.');
    g.r(8, 6, 11, 39, '.'); g.r(8, 40, 11, 41, '~'); g.p(9, 40, '=='); g.r(9, 41, 10, 41, '#');
    // the exit room, seen only through a grate
    g.r(1, 3, 6, 5, '.'); g.v(7, 3, '%%%'); g.v(0, 4, '=='); g.p(4, 5, 'X');
    L.push({
      name: 'Underfoot', gun: 1, par: 5,
      gunHint: { 2: 'RIGHT CLICK  VIOLET' },
      hint: 'CLICK  FIRE     THE FLOOR IS A DOOR TOO',
      pre: [{ c: 1, x: 41, y: 3, f: 'd' }],
      map: g.rows(),
      sol: [['s', 0, 30, 32, 'u', 0.5], ['to', 31], ['wtp'], ['wg'], ['to', 45.5],
        ['s', 1, 47, 11, 'l', 0.5], ['to', 33], ['l', 0.3], ['wtp'], ['wg'], ['w', 0.3],
        ['to', 27], ['s', 1, 22, 18, 'u', 0.5], ['to', 31], ['wtp'], ['l', 0.9], ['wg'],
        ['to', 13], ['s', 1, 0, 4, 'r', 0.75], ['to', 9.8], ['wyd', 24], ['s', 0, 9, 40, 'u', 0.5], ['to', 10], ['wtp'], ['w', 1.5]]
    });
  }

  /* 3 — Weight. A caged cube, a cube thrown across the room, a long drop, and a cube that is both
     your step and your key, sent through a tunnel only it can fit through. */
  {
    const g = G(46, 38);
    // A: the start room and the cage
    g.r(1, 6, 14, 11, '.'); g.p(8, 11, 'P');
    g.r(1, 8, 5, 8, '%'); g.v(5, 9, '%%%'); g.v(0, 10, '=='); g.p(2, 11, 'o');
    g.p(10, 12, '==');
    // B: the throwing hall
    g.r(15, 1, 44, 11, '.'); g.v(14, 3, '==');
    g.r(19, 12, 20, 21, '.'); g.p(19, 22, '==');                      // the throwing pit
    g.r(22, 12, 33, 17, '.'); g.r(22, 18, 33, 19, '~');               // the moat
    g.r(41, 12, 41, 14, '.'); g.r(34, 12, 40, 14, '.'); g.r(35, 15, 38, 15, '.'); g.p(35, 15, '1111');
    g.v(41, 11, 'aaaa'); g.r(42, 11, 44, 14, '.'); g.r(41, 1, 44, 10, '#');
    // C: the drop
    g.r(43, 15, 44, 35, '.');
    // D: the step
    g.r(13, 27, 44, 35, '.'); g.p(30, 35, 'o'); g.p(13, 36, '==');
    g.r(5, 27, 12, 32, '.'); g.p(6, 32, 'X');
    g.p(1, 31, '.'); g.p(1, 32, '2...'); g.v(0, 31, '==');            // the mouth and the cube-sized tunnel
    L.push({
      name: 'Weight', par: 6, exit: 2,
      hint: 'E  GRAB / DROP',
      map: g.rows(),
      sol: [['s', 1, 0, 10, 'r', 0.5], ['s', 0, 10, 12, 'u', 0.5], ['to', 11], ['wtp'], ['wg'], ['to', 2.6], ['e'], ['to', -1], ['r', 0.45], ['wg'],
        ['to', 17.5], ['s', 1, 14, 3, 'r', 0.5], ['to', 19.1], ['s', 0, 19, 22, 'u', 0.5], ['aim', 25, 10], ['e'], ['w', 2.0],
        ['to', 21], ['wtp'], ['wg'], ['to', 39.5], ['rj', 0.5], ['to', 43.6], ['wyd', 30], ['wg'],
        ['to', 30.5], ['e'], ['to', 14], ['e'], ['w', 0.3], ['r', 0.2], ['w', 0.2], ['lj', 0.25], ['wg'], ['lj', 0.5], ['wg'],
        ['to', 13.2], ['s', 1, 0, 32, 'r', 0.75], ['s', 0, 13, 36, 'u', 0.5], ['w', 1.0], ['to', 6.5]]
    });
  }

  /* 4 — Beam. Bend light up into the ceiling, plug a beam with a falling cube, walk it backwards as a
     shield, then turn one beam into a key — from the right side of it. */
  {
    const g = G(48, 48);
    // A: the top hall; a beam runs high along it
    g.r(1, 3, 30, 8, '.'); g.p(2, 8, 'P'); g.p(0, 5, '>');
    g.v(31, 4, '=='); g.v(31, 6, 'aaa'); g.p(20, 9, '=='); g.p(21, 2, '5');
    // B: the deep room; the beam along its floor guards the hole
    g.r(32, 3, 46, 36, '.'); g.r(32, 9, 40, 9, '%');
    g.r(43, 14, 46, 14, '#'); g.p(44, 14, '=='); g.p(44, 13, 'o');
    g.v(31, 22, '=='); g.p(31, 36, '>');
    g.r(44, 37, 45, 38, '.');
    // C: the lock that needs a cube and a beam
    g.r(1, 39, 46, 45, '.'); g.p(0, 40, '>');
    g.r(30, 39, 30, 40, '#'); g.v(30, 39, '==');           // the hanging pillar the beam strikes
    g.p(12, 38, '='); g.p(13, 38, '='); g.p(12, 46, '7');
    g.v(8, 43, 'ccc'); g.p(3, 45, 'X'); g.p(36, 45, '3');
    L.push({
      name: 'Beam', par: 6, exit: 3,
      hint: 'LIGHT GOES WHERE YOU SEND IT',
      map: g.rows(),
      sol: [['to', 24], ['s', 1, 31, 4, 'l', 0.5], ['s', 0, 20, 9, 'u', 0.5], ['w', 0.5], ['to', 36],
        ['s', 1, 31, 22, 'r', 0.5], ['s', 0, 44, 14, 'u', 0.5], ['w', 2.5], ['to', 41.4], ['wg'],
        ['toa', 37.9, 20, 36], ['e'], ['toa', 44.6, 20, 36], ['wyd', 40], ['wg'],
        ['to', 35.8], ['aim', 45, 45], ['e'], ['w', 0.3], ['to', 10], ['s', 1, 30, 39, 'l', 0.5], ['s', 0, 12, 38, 'd', 0.5], ['w', 0.5], ['to', 3.5]]
    });
  }

  /* 5 — Static. Hold a door open long enough to shoot through it. Rain the cube down past a fizzler.
     Then fall in a loop until you are fast enough, and change your mind halfway down. */
  {
    const g = G(62, 50);
    // A: the door you can only look through
    g.r(1, 40, 14, 46, '.'); g.p(4, 46, 'P'); g.p(2, 46, 'o'); g.p(9, 46, '1');
    g.v(0, 45, '=='); g.v(15, 44, 'aaa');
    // B: a curtain of static splits the room; the button waits on the far side
    g.r(16, 30, 34, 46, '.'); g.p(20, 47, '=='); g.v(25, 41, '!!!!!!');
    g.p(30, 29, '=='); g.p(30, 47, '22'); g.v(35, 44, 'bbb');
    // C: the loop, the wall you turn to, and the lake behind a second curtain
    g.r(36, 26, 60, 46, '.'); g.v(35, 41, '==');
    g.r(38, 38, 39, 40, '#'); g.p(38, 40, '=='); g.p(38, 47, '==');
    g.r(43, 47, 50, 48, '~'); g.v(47, 28, '!!!!!!!!!!!!!!!!!!!'); g.p(57, 46, 'X');
    L.push({
      name: 'Static', par: 6,
      hint: 'STATIC EATS PORTALS AND SHOTS',
      map: g.rows(),
      sol: [['to', 9.5], ['s', 0, 20, 47, 'u', 0.5], ['to', 3.2], ['e'], ['s', 1, 0, 45, 'r', 0.5], ['to', -1], ['l', 0.4], ['wg'],
        ['to', 17], ['s', 1, 30, 29, 'd', 0.5], ['to', 19.8], ['aim', 25, 46], ['e'], ['w', 2.0],
        ['rj', 0.5], ['to', 29.3], ['rj', 0.5], ['to', 37], ['s', 0, 38, 47, 'u', 0.5], ['s', 1, 38, 40, 'd', 0.5], ['to', 38.9], ['wtp'], ['wtp'], ['wtp'], ['wtp'], ['wtp'], ['wyd', 43],
        ['s', 1, 35, 41, 'r', 0.75], ['wtp'], ['w', 1.5], ['to', 57.5]]
    });
  }

  /* 6 — Cave Mouth. The ground gives way under the stars. Heat a rock wall with a borrowed beam until it falls,
     run a staircase that will not wait for you, and let the rock swallow the cube instead of you. */
  {
    const g = G(60, 30);
    g.r(0, 0, 59, 7, '.'); g.p(2, 7, 'P'); g.r(20, 8, 24, 8, ':');          // the night above, the false ground
    // A: the first cave; a beam hums across its roof
    g.r(10, 9, 24, 26, '.'); g.p(9, 15, '>'); g.r(16, 9, 16, 15, '#'); g.v(16, 14, '==');
    g.v(9, 21, '=='); g.r(25, 22, 25, 26, ':');
    // B: the stairs over the lava
    g.r(26, 9, 45, 25, '.'); g.r(26, 26, 28, 26, '.'); g.r(29, 26, 45, 27, '~'); g.p(30, 8, '==');
    g.p(30, 25, ':::'); g.p(34, 23, ':::'); g.p(38, 21, ':::'); g.p(42, 19, ':::');
    // C: the ledge, a cube, and a hole that is not there yet
    g.r(46, 9, 58, 16, '.'); g.p(48, 16, 'o'); g.p(51, 17, '::'); g.r(51, 18, 52, 25, '.'); g.p(51, 26, '11');
    g.r(55, 9, 55, 13, '#'); g.v(55, 14, 'aaa'); g.p(57, 16, 'X');
    L.push(VOL({
      name: 'Cave Mouth', par: 3, sky: 8,
      hint: 'THE ROCK REMEMBERS YOUR WEIGHT',
      map: g.rows(),
      sol: [['to', 22], ['wyd', 20], ['wg'], ['to', 12], ['s', 1, 16, 14, 'l', 0.5], ['s', 0, 9, 21, 'r', 0.5], ['w', 0.8], ['to', 27.5],
        ['s', 1, 30, 8, 'd', 0.5], ['w', 0.3], ['to', 28.2], ['rj', 0.4], ['to', 32.5], ['rj', 0.4], ['to', 36.5], ['rj', 0.4], ['to', 40.5], ['rj', 0.4], ['to', 44.5], ['rj', 0.45], ['wg'],
        ['to', 48.6], ['e'], ['to', 49], ['he', 'r', 0.22], ['w', 1.5], ['to', 50.1], ['rj', 0.5], ['to', 57.5]]
    }));
  }

  /* 7 — Magma Pools. Bait a shark through a hole in the grate. Stand too high to be bitten and let the
     hunter jump into a pit it cannot leave. Then the lake is only lava. */
  {
    const g = G(72, 32);
    // A: the grate over the first pool, with a hole in it
    g.r(1, 3, 25, 6, '.'); g.p(2, 6, 'P'); g.r(1, 7, 22, 7, '%'); g.r(11, 7, 12, 7, '.');
    g.r(1, 8, 22, 9, '.'); g.r(1, 10, 22, 12, '~'); g.p(6, 11, 'S');
    g.r(23, 7, 25, 16, '.');                                            // the shaft down
    // B: the overhang, the trap, the lake and its stones
    g.r(23, 18, 60, 25, '.'); g.r(23, 17, 25, 17, '#');                  // the overhang you land on
    g.r(26, 15, 60, 17, '.');
    g.r(25, 26, 26, 27, '.');                                            // the pit beside the pool
    g.r(28, 26, 53, 28, '~'); g.p(40, 27, 'S');
    for (const sx of [30, 34, 38, 42, 46, 50]) g.r(sx, 25, sx + 1, 25, '#');   // thin slabs: the lava runs on underneath
    // C: up to the ledge on the far wall and out
    g.r(58, 18, 60, 25, '#'); g.p(58, 14, '=='); g.v(58, 24, '==');
    g.r(61, 15, 70, 17, '.'); g.p(68, 17, 'X');
    L.push(VOL({
      name: 'Magma Pools', par: 2,
      hint: 'TOO HIGH TO BITE IS TOO HIGH TO MISS',
      map: g.rows(),
      sol: [['to', 9.6], ['w', 1.6], ['to', 10.2], ['w', 0.05], ['wsh', 0], ['rj', 0.45], ['to', 24.5], ['wyd', 16], ['wg'],
        ['to', 26.1], ['wshd', 1], ['w', 0.5],
        ['to', 26.8], ['wg'], ['to', 27.3], ['rj', 0.5], ['wg'],
        ['to', 31.5], ['rj', 0.5], ['to', 35.5], ['rj', 0.5], ['to', 39.5], ['rj', 0.5], ['to', 43.5], ['rj', 0.5], ['to', 47.5], ['rj', 0.5], ['to', 51.5], ['rj', 0.5], ['wg'],
        ['to', 56], ['s', 1, 58, 14, 'd', 0.5], ['s', 0, 58, 24, 'l', 0.5], ['to', 59], ['wg'], ['to', 68.5]]
    }));
  }

  /* 8 — Vent Hall. Every step of the stair is a vent, breathing out of step with its neighbours.
     At the top, drop back down the way you came and fly over a field that is only ever quiet for a moment. */
  {
    const g = G(50, 40);
    // A: the breathing stair, with the cube in your arms
    g.r(1, 22, 30, 36, '.'); g.p(2, 36, 'P'); g.p(4, 36, 'o');
    [[8, 35, 'VV'], [11, 33, 'WW'], [14, 31, 'VV'], [17, 29, 'WW'], [20, 27, 'VV'], [23, 25, 'WW']].forEach(([x, y, v]) => { g.p(x, y, v); g.r(x, y + 1, x + 1, 36, '#'); });
    g.r(26, 23, 31, 23, '#'); g.r(29, 23, 30, 23, '.'); g.p(29, 37, '==');           // the top ledge and the hole in it
    // B: the hall above, its field of fire, and the far shore
    g.r(26, 4, 48, 22, '.'); g.v(25, 14, '=='); g.r(20, 18, 25, 21, '.');
    for (let x = 33; x <= 44; x++) g.p(x, 23, x % 2 ? 'W' : 'V');
    g.p(45, 22, '1'); g.p(48, 22, 'X');
    L.push(VOL({
      name: 'Vent Hall', par: 2, exit: 1, vent: [3.2, 1.0],
      hint: 'COUNT THE BREATHS',
      map: g.rows(),
      sol: [['to', 4.6], ['e'], ['to', 6.5],
        ...[8, 11, 14, 17, 20, 23].flatMap(x => [['wvx', x, 1], ['wvx', x, 0], ['rj', 0.4], ['to', x + 1.5]]), ['rj', 0.45], ['wg'],
        ['s', 1, 25, 14, 'r', 0.5], ['to', 29.1], ['s', 0, 29, 37, 'u', 0.5], ['wvx', 34, 1], ['wvx', 33, 1], ['w', 0.2], ['to', 29.5], ['wtp'], ['w', 1.0],
        ['to', 46.6], ['aim', 40, 22], ['e'], ['w', 0.3], ['to', 48.5]]
    }));
  }

  /* 9 — Stalker. It follows you through your own portals, so move the door after you walk through.
     Give the second one a way out of its pit and onto a button. Let the third run into the light. */
  {
    const g = G(60, 43);
    // A: the hall where the first one wakes
    g.r(5, 26, 34, 40, '.'); g.p(20, 40, 'P'); g.p(32, 40, 'M');
    g.r(9, 33, 12, 34, '#'); g.p(10, 41, '==');                                // the ledge, and the floor under it
    g.r(26, 30, 33, 31, '#'); g.p(26, 29, '#'); g.r(27, 29, 32, 29, '~'); g.p(33, 29, '#'); g.p(29, 25, '=='); // the basin
    // the chimney up from the ledge
    g.r(1, 19, 12, 32, '.'); g.r(5, 18, 12, 18, '.'); [[7, 31], [5, 29], [3, 27], [1, 25], [4, 23], [7, 21], [10, 19]].forEach(([x, y]) => g.p(x, y, '##'));
    g.p(11, 27, '==');                                                         // a panel lip over the ledge
    // B: the pit, the moat, the button ledge
    g.r(5, 9, 30, 17, '.'); g.r(17, 18, 21, 20, '.'); g.p(17, 21, '=='); g.p(19, 20, 'M');
    g.r(24, 18, 27, 19, '~'); g.p(28, 17, '2'); g.v(31, 16, '=='); g.p(14, 18, '==');
    g.p(14, 8, 'bb'); g.p(14, 7, '%%');                                       // a hatch in the roof, held by whoever stands on the button
    // C: the corridor above; a short beam hums by the pillar, the third one waits at the end
    g.r(1, 3, 57, 6, '.'); g.p(14, 2, '=='); g.p(30, 2, '==');
    g.p(37, 3, '>'); g.r(40, 3, 40, 4, '#'); g.v(40, 3, '=='); g.p(48, 2, '==');
    g.p(54, 6, 'M'); g.p(57, 6, 'X');
    L.push(VOL({
      name: 'Stalker', par: 10,
      hint: 'IT FOLLOWS WHERE YOU GO',
      map: g.rows(),
      sol: [['s', 1, 11, 27, 'd', 0.5], ['s', 0, 10, 41, 'u', 0.5], ['to', 11], ['wg'], ['s', 1, 29, 25, 'd', 0.5], ['wmdx', 32], ['w', 0.5],
        ['to', 9.4], ['lj', 0.4], ['wg'], ['to', 7.2], ['lj', 0.4], ['wg'], ['to', 5.2], ['lj', 0.4], ['wg'], ['to', 3.3], ['lj', 0.4], ['wg'], ['to', 2.6], ['rj', 0.4], ['wg'], ['to', 5.6], ['rj', 0.4], ['wg'], ['to', 8.6], ['rj', 0.4], ['wg'], ['to', 11.6], ['rj', 0.4], ['wg'],
        ['to', 17.1], ['s', 1, 31, 16, 'l', 0.5], ['s', 0, 17, 21, 'u', 0.5], ['to', 13.6], ['wmx', 19, 28.0], ['w', 0.5],
        ['s', 1, 14, 2, 'd', 0.5], ['s', 0, 14, 18, 'u', 0.5], ['to', 15], ['wg'],
        ['to', 36], ['s', 0, 40, 3, 'l', 0.5], ['to', 42.5], ['s', 1, 48, 2, 'd', 0.5], ['wmdx', 54], ['s', 0, 30, 2, 'd', 0.5], ['to', 57.5]]
    }));
  }

  /* 10 — Dripstone. Run under the drip, then run back under it with something chasing you.
     Drop onto a ledge that is already shaking, and cross a top walk where the roof and the floor both let go. */
  {
    const g = G(48, 36);
    // the low gallery
    g.r(6, 27, 46, 28, '.'); g.p(7, 28, 'P');
    for (let x = 10; x <= 32; x += 2) g.p(x, 27, 'Y');
    // the tall end room, its sleeper, and the ledge high on its wall
    g.r(36, 14, 46, 26, '.'); g.r(43, 18, 46, 26, '#'); g.p(44, 28, 'M');
    g.p(43, 13, '=='); g.p(38, 29, '=='); g.p(43, 14, 'Y'); g.p(46, 14, 'Y');
    // the top walk back west: drip above, rotten floor over lava below
    g.r(1, 14, 42, 17, '.'); g.r(36, 18, 42, 18, '%');                       // a grate bridge over the tall room
    for (const [a, b] of [[14, 16], [24, 26], [31, 33]]) { g.r(a, 18, b, 18, ':'); g.r(a, 19, b, 20, '~'); }
    for (const x of [9, 19, 28, 34]) g.p(x, 14, 'Y');
    // and the long fall home
    g.r(1, 18, 4, 33, '.'); g.p(2, 33, 'X');
    L.push(VOL({
      name: 'Dripstone', par: 2,
      hint: 'NEVER STAND STILL UNDER STONE',
      map: g.rows(),
      sol: [['to', 34.5], ['w', 0.6], ['wmx', 44, 37], ['to', 7.5], ['wmdx', 44], ['w', 3.2],
        ['to', 37], ['s', 1, 43, 13, 'd', 0.5], ['s', 0, 38, 29, 'u', 0.5], ['to', 38.9], ['wg'],
        ['to', 18], ['to', 2.5], ['wg'], ['to', 2.6]]
    }));
  }

  /* 11 — Undertow. A stalker in a pit holds the hatch open for you, until the tide reaches it.
     Shoot through while it lives. Then climb through the grates before the lava closes your floor. */
  {
    const g = G(44, 56);
    // F0: the keeper's floor
    g.r(1, 46, 42, 51, '.'); g.p(20, 51, 'P'); g.v(0, 50, '==');
    g.p(24, 52, '%%'); g.p(24, 53, '1'); g.p(25, 53, 'M');                    // the keeper's pit under a grate lid
    g.p(10, 45, 'aaaa'); g.p(10, 44, '%%%%');                                   // the hatch, and the grate above it
    // F1
    g.r(1, 38, 42, 43, '.'); g.p(11, 37, '=='); g.p(34, 44, '=='); g.r(34, 36, 37, 37, '%');
    // F2: the last run, over the old lava pits
    g.r(1, 29, 42, 35, '.'); g.p(35, 28, '==');
    for (const a of [26, 19, 12]) g.r(a, 36, a + 1, 36, '~');
    g.p(3, 35, 'X');
    L.push(VOL({
      name: 'Undertow', par: 4,
      hint: 'IT HOLDS THE DOOR UNTIL THE TIDE HOLDS IT',
      rise: { from: 55, to: 1, speed: 0.35, delay: 2, at: [0, 46, 18, 51] },
      map: g.rows(),
      sol: [['to', 24.5], ['w', 0.5], ['to', 15], ['s', 1, 11, 37, 'd', 0.5], ['s', 0, 0, 50, 'r', 0.5], ['to', -1], ['wg'],
        ['to', 34.9], ['s', 1, 35, 28, 'd', 0.5], ['s', 0, 34, 44, 'u', 0.5], ['wtp'], ['wg'],
        ['to', 28.6], ['lj', 0.5], ['to', 21.6], ['lj', 0.5], ['to', 14.6], ['lj', 0.5], ['to', 3.5]]
    }));
  }

  /* 12 — Ember Den. Let the first hunter charge you across a floor of fire. Send light where your shots cannot go:
     through the static. Then let the static have the second hunter. */
  {
    const g = G(60, 41);
    // A: the fire floor, and the hunter on the far side of it
    g.r(1, 18, 21, 26, '.'); g.p(2, 26, 'P'); g.p(20, 26, 'M');
    g.p(8, 27, 'VVVV'); g.p(13, 27, 'WWWW');                                  // a safe stone between two breaths
    // B: a beam along the roof, a curtain of static, a receiver beyond it
    g.r(22, 24, 22, 26, '.'); g.v(22, 21, '==');
    g.r(23, 18, 40, 26, '.'); g.p(22, 19, '>'); g.r(29, 18, 29, 20, '#'); g.v(29, 19, '==');
    g.v(33, 18, '!!!!!!!!!'); g.p(41, 21, '5'); g.p(30, 27, 'aa'); g.p(30, 28, '..');   // the receiver opens a hatch on this side
    // C: below. The last hunter, the last curtain, and a ledge you can only reach by portal
    g.r(23, 29, 58, 38, '.'); g.v(40, 29, '!!!!!!!!!!'); g.p(52, 38, 'M');
    g.r(54, 33, 58, 38, '#'); g.p(55, 28, '=='); g.v(54, 37, '=='); g.p(57, 32, 'X');
    L.push(VOL({
      name: 'Ember Den', par: 4, vent: [3.2, 1.0],
      hint: 'LIGHT PASSES STATIC',
      map: g.rows(),
      sol: [['to', 6], ['wmdx', 20], ['w', 0.5],
        ['to', 7.3], ['wvx', 8, 1], ['wvx', 8, 0], ['to', 12.5], ['wvx', 13, 1], ['wvx', 13, 0], ['to', 18],
        ['to', 24], ['s', 0, 29, 19, 'l', 0.5], ['s', 1, 22, 21, 'r', 0.5], ['w', 0.5], ['to', 30.8], ['wyd', 32], ['wg'],
        ['to', 38.5], ['wmdx', 52], ['w', 0.3], ['to', 48], ['s', 1, 55, 28, 'd', 0.5], ['s', 0, 54, 37, 'l', 0.5], ['to', 55], ['wg'], ['to', 57.5]]
    }));
  }

  /* 13 — Pursuit. They wake when you do. The bridge only holds the first pair of feet. Then fly: you can
     steer in the air, they cannot, and they will follow you through anything you open. */
  {
    const g = G(64, 44);
    g.r(1, 18, 40, 28, '.'); g.p(8, 28, 'P'); g.p(3, 28, 'M'); g.p(6, 28, 'M');
    g.r(17, 29, 30, 29, ':'); g.r(17, 30, 30, 31, '~');                     // the bridge
    g.r(31, 18, 31, 23, '#'); g.v(31, 21, '==');                                // the pillar you fly out of
    g.r(39, 29, 40, 40, '.'); g.p(39, 41, '==');                                // the pit you fall into
    g.r(42, 18, 62, 31, '.'); g.r(41, 18, 41, 24, '.'); g.r(42, 32, 62, 33, '~'); g.r(47, 31, 50, 33, '#'); g.p(50, 30, 'X');
    L.push(VOL({
      name: 'Pursuit', par: 2,
      hint: 'THEY WAKE WHEN YOU DO',
      map: g.rows(),
      sol: [['to', 38.95], ['s', 1, 31, 21, 'r', 0.5], ['s', 0, 39, 41, 'u', 0.5], ['to', 40], ['wtp'], ['w', 0.1], ['l', 0.4], ['wg'], ['to', 48], ['wmdx', 3], ['wmdx', 6], ['to', 50.5]]
    }));
  }

  /* 14 — Leviathan. You wake on a rock in a sea that has teeth and is rising. Leave before it takes your floor,
     walk the grate while they hammer at it from below, and climb out before the sea reaches the grate. */
  {
    const g = G(50, 48);
    g.r(1, 12, 48, 40, '.'); g.r(1, 41, 48, 47, '~');
    for (const sx of [8, 16, 29, 37, 45]) g.p(sx, 44, 'S');
    g.r(20, 39, 23, 47, '#'); g.p(21, 39, '=='); g.p(20, 38, 'P');               // the rock you wake on
    g.r(1, 30, 10, 32, '#'); g.p(8, 25, '==');                                   // the west ledge and the panel over it
    g.r(11, 30, 40, 30, '%');                                                    // the grate walk over the sea
    g.r(30, 38, 31, 47, '#'); g.p(30, 38, '=='); g.p(30, 37, 'o');              // the cube, on a rock the sea will take
    g.r(41, 30, 48, 32, '#'); g.v(49, 28, '==');                                 // the east ledge
    g.r(30, 19, 37, 19, '#'); g.p(36, 14, '=='); g.p(31, 18, 'X'); g.p(33, 18, '1');               // the high ledge and the way out
    L.push(VOL({
      name: 'Leviathan', par: 5, deep: 0.85, exit: 1,
      hint: 'THE SEA KEEPS WHAT IT TAKES',
      rise: { from: 41, to: 31, speed: 0.22, delay: 3 },
      map: g.rows(),
      sol: [['s', 1, 8, 25, 'd', 0.5], ['to', 21.5], ['s', 0, 21, 39, 'u', 0.5], ['wtp'], ['wg'],
        ['to', 32], ['s', 1, 49, 28, 'l', 0.5], ['s', 0, 30, 38, 'u', 0.5], ['to', 46], ['wcube', 0], ['e'],
        ['s', 0, 36, 14, 'd', 0.75], ['to', 50], ['wg'], ['to', 32.6], ['aim', 40, 17], ['e'], ['w', 0.3], ['to', 31.5]]
    }));
  }

  /* 15 — Caldera. Melt the stone above you with a borrowed beam and look through the hole you made.
     Then climb out of the volcano on stairs that crumble, under stone that drips, ahead of the lava, to the stars. */
  {
    const g = G(41, 60);
    g.r(0, 0, 40, 7, '.');                                                       // the night above the crater
    // S1: the lava hall, its beam, and the plug in its roof
    g.r(1, 50, 38, 55, '.'); g.p(3, 55, 'P'); g.p(39, 52, '<'); g.v(0, 51, '==');
    g.r(18, 48, 21, 49, ':'); g.p(19, 56, '==');
    // U: the room above the plug
    g.r(1, 42, 38, 47, '.'); g.p(15, 41, '==');
    // the shaft: four flights of rotten stairs, landings of good stone between them
    g.r(19, 8, 39, 41, '.');
    const flights = [[[27, 46], [30, 44], [33, 42], [36, 40]], [[34, 36], [31, 34], [28, 32], [25, 30]],
      [[26, 26], [29, 24], [32, 22], [35, 20]], [[34, 16], [31, 14], [28, 12], [25, 10]]];
    for (const f of flights) for (const [x, y] of f) g.p(x, y, '::');
    g.p(37, 38, '###'); g.p(22, 28, '###'); g.p(37, 18, '###');                   // the landings
    for (const [x, y] of [[37, 33], [23, 23], [29, 9], [33, 9]]) g.p(x, y, 'Y');
    g.r(19, 8, 23, 8, '#'); g.p(21, 7, 'X');
    L.push(VOL({
      name: 'Caldera', par: 3, sky: 8, deep: 1,
      hint: 'THE WAY OUT IS UP',
      rise: { from: 57, to: 9, speed: 0.8, delay: 3, at: [1, 42, 18, 47] },
      map: g.rows(),
      sol: [['to', 22], ['s', 0, 0, 51, 'r', 0.5], ['s', 1, 19, 56, 'u', 0.5], ['w', 0.9], ['s', 0, 15, 41, 'd', 0.75], ['to', 19.5], ['wg'], ['wc', 18, 48, 0], ['w', 0.2],
        ['to', 25.5], ['rj', 0.4], ...[28.5, 31.5, 34.5].flatMap(x => [['to', x], ['rj', 0.4]]), ['to', 36.2], ['rj', 0.4], ['wg'],
        ...[37.4, 34.4, 31.4, 28.4, 25.4].flatMap(x => [['to', x], ['lj', 0.4]]), ['wg'],
        ...[24.6, 27.6, 30.6, 33.6, 36.6].flatMap(x => [['to', x], ['rj', 0.4]]), ['wg'],
        ...[37.4, 34.4, 31.4, 28.4, 25.4].flatMap(x => [['to', x], ['lj', 0.4]]), ['wg'], ['to', 21.5]]
    }));
  }

  // the volcano darkens and reddens the deeper you go
  L.forEach((d, i) => { if (d.theme === 'volcano' && d.deep == null) d.deep = Math.min(1, (i - 5) / 9); });

  if (typeof module !== 'undefined' && module.exports) module.exports = L;
  else root.LEVELS = L;
})(typeof window !== 'undefined' ? window : globalThis);
