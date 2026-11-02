# Twinfold

A 2D portal puzzle game prototype. Open `index.html` in a browser. Add `?all` to the URL to unlock every chamber.

## Controls

| Input | Action |
| --- | --- |
| A / D (or arrows) | move |
| W / Space | jump (hold for a higher jump) |
| Left click | mint portal |
| Right click | violet portal |
| E | grab / drop a cube |
| R | restart chamber |
| Esc | pause |
| M | mute |

## Timer and tries

- The HUD shows the clock for the current run and which try you are on.
- A run restarts with the chamber: pressing R, or dying before you've lit a brazier. Dying after lighting one keeps the clock running.
- Every death and every restart counts as a try.
- The stats card shows this run's time, your best time, tries, total time spent in the chamber, portals against par, and deaths.
- The chamber screen lists each chamber's best time and, once all fifteen are cleared, the sum of your best times.
- Progress is stored under `twinfold.save.v2`. The old 40-chamber save is ignored.

## Files

- `js/engine.js` holds the simulation: physics, portals, lasers, switches. It doesn't touch the DOM, so it runs in Node too.
- `js/chambers.js` holds all fifteen chambers, each painted by hand with a small map builder (`G`). No section is shared or stamped between chambers.
- `js/render.js` is the pixel renderer. It draws a 640×352 view that scrolls over bigger maps, and it re-skins the tile set for the volcano theme, redder the deeper the chamber (`deep`).
- `js/audio.js` synthesizes every sound with WebAudio, so there are no audio files.
- `js/main.js` is the shell: game loop, input, menus, save data, the run timer, and the title-screen demo.
- `tools/sim.js` replays the scripted solution for each chamber headlessly: `node tools/sim.js [n] [-v] [-t]`. It fails any shot the player couldn't aim at, and it reports how close the rising lava came. `-t` prints the player's path.
- `tools/show.js` prints a chamber's map with coordinate rulers: `node tools/show.js <n>`.
- `tools/shot.js` takes headless Chrome screenshots with audio muted.
- `_backup_40_chambers/` is the previous 40-chamber version, kept locally for reference and not committed.

## Rules to carry over when porting

**World**
- Tiles are 16 px. A map is at least 40×22 and can be any size beyond that.
- The camera follows the player and leans 45% of the way toward the cursor, so you can aim further in the direction you're looking.
- The simulation runs at a fixed 1/240 s step.

**Player**
- Hitbox is 10×18.
- Gravity is 1100, run speed 100, jump velocity 290 (about 2.4 tiles high).
- Releasing jump early cuts the rise: gravity is multiplied by 2.4 while rising.
- Coyote time is 0.09 s and jump buffering is 0.12 s.
- Maximum fall speed is 760.
- Air control can't add speed past the run speed, so momentum from a fling is kept. With no input there is light air drag.

**Portals**
- A portal covers 2 cells on the face of a light panel (`=`).
- The cells in front of the portal must be empty.
- The two colors can't overlap.
- The game counts each portal that gets placed. Shots that miss or are rejected don't count.

**Passing through**
- A body can enter a portal when it is fully inside the portal's span and in front of it.
- It teleports when its center crosses the portal's plane.
- Its position and velocity are rotated by the transform that maps −n(in) to n(out).
- After exiting, a minimum speed along the exit normal applies: 110 for wall portals, 230 for floor portals.

**Lasers**
- Beams travel only in the four grid directions.
- They pass through grates, fizzlers and portals, using the same rotation as bodies.
- Cubes block them, and they kill the player.
- A beam that hits a receiver powers that receiver's channel.

**Fizzlers (`!`)**
- They clear both of the player's non-fixed portals when the player passes through.
- They destroy cubes, which then respawn.
- They block portal shots.

**Grates (`%`)**
- They block bodies but let shots and lasers through.
- Catwalks are made from grates so you can aim down through them.

**Switches**
- Buttons and receivers each power a channel.
- A channel is on only when all of its switches are on.
- Doors with letters a–d open with channels 1–4.
- A level's `exit` field can lock the exit to a channel.

## Level format

Each map is a list of equal-length strings, at least 40×22.

| Char | Meaning |
| --- | --- |
| `#` | metal |
| `=` | panel |
| `%` | grate |
| `~` | acid |
| `!` | fizzler |
| `P` | start |
| `X` | exit |
| `o` | cube |
| `1`–`4` | button for channels 1–4 |
| `5`–`8` | receiver for channels 1–4 |
| `a`–`d` | door for channels 1–4 |
| `> < ^ v` | laser emitter facing that way |
| `:` | crumbling rock: falls 0.5 s after anything stands on it and re-forms 3.2 s later. A laser touching it brings down the whole connected formation |
| `V` `W` | fire vent: erupts on a cycle, and `W` is half a cycle behind `V`. The fire burns the player, cubes and stalkers, but lasers pass through it |
| `Y` | stalactite: drops when you or a stalker pass beneath it, and regrows. A stalker freezes to stare up at one that is cracking |
| `S` | lava shark: hunts beneath you, lines up in open lava near you and lunges up to 3 tiles sideways. It can't bite through rock or grates, and dies if it lands somewhere it can't flop back from. Sharks ride rising lava |
| `M` | stalker: chases on sight, walks through portals and presses buttons. It stops at a drop unless you're below it, and never steps toward lava. Lava, lasers, fizzlers, vents and stalactites kill it |
| `F` | checkpoint brazier: dying restores the chamber exactly as it was when you lit it. R restarts the whole chamber |
| `G` | portal device: adds a colour to the gun (none, then mint, then both). Any fixed portals close, and the chamber's `gunPre[newGun]` places the next fixed ones |

Volcano chambers set `theme: 'volcano'`. A chamber can also have:
- `rise: { from, to, speed, delay, at2, speed2 }`: lava rising in tiles per second after `delay` seconds. It switches to `speed2` once it passes row `at2`, and it closes any portal it covers.
- `vent: [period, onTime]` for vent timing.
- `sky: rows`, the number of open-sky rows at the top.
- `gunPre: { 1: [...], 2: [...] }`: fixed portals that appear when the device pickup raises the gun to that level, and `gunHint` for the hint shown then.
- `deep`: 0–1, how far down the volcano the chamber is (background tint).

`gun` is 0 for no gun, 1 for mint only, or 2 for both colors. `pre` lists fixed portals. `par` is the portal count of the reference solution in `sol`.

## Chambers

Every chamber is built from its own puzzles. No setup is repeated from one chamber to another.

| # | Name | Par | What it asks of you |
|---|------|-----|------|
| 1 | Threshold | 1 | No device: a fixed pair carries you up a stair to it. Then shoot the floor of a pit through a grate and fall into it to geyser up the tower |
| 2 | Underfoot | 5 | Mint only, a fixed violet in the ceiling. Find violet on the catwalk, fling west, rise backwards through your own floor, then shoot the bottom of a well in mid-fall |
| 3 | Weight | 6 | Fetch a caged cube, catapult it onto a far button, drop down the shaft, then use a second cube as a step and send it through a tunnel only a cube fits through |
| 4 | Beam | 6 | Bend a beam into a ceiling receiver, plug a floor beam with a falling cube, walk it backwards as a shield, then turn the last beam on from the right side of it |
| 5 | Static | 6 | Hold a door open just long enough to shoot through it, rain the cube past a fizzler onto its button, then loop in free fall and re-aim mid-drop to clear the lake |
| 6 | Cave Mouth | 3 | The ground gives way under the stars. A beam melts a rock wall, the stairs crumble behind you, and the rock swallows the cube onto a button below |
| 7 | Magma Pools | 2 | Bait a shark through a hole in the grate. Stand too high to be bitten so it leaps into a pit it cannot leave, then cross its lake |
| 8 | Vent Hall | 2 | Carry the cube up a stair whose every step is a vent, then drop back down and fly over a fire field in the half-second it is quiet |
| 9 | Stalker | 10 | Move your exit portal so the stalker following you lands in lava, give a second one a portal out of its pit onto a button, and drop a beam on the third |
| 10 | Dripstone | 2 | Sprint a stalactite gallery, lure the stalker back under it, land on a ledge that is already shaking, and cross a top walk where roof and floor both let go |
| 11 | Undertow | 4 | A stalker in a pit holds the hatch open until the rising lava reaches it. Shoot through in time, then climb ahead of the tide |
| 12 | Ember Den | 4 | Let a hunter charge you across a vent field, bend light through a fizzler your shots cannot pass, then let the static have the second hunter |
| 13 | Pursuit | 2 | Two stalkers wake with you. Cross the bridge that only holds once, then fly: you can steer in the air and they cannot |
| 14 | Leviathan | 5 | Wake on a rock in a rising shark sea. Escape upward, save the cube from the tide before the sea keeps it, and carry it out |
| 15 | Caldera | 3 | Melt the plug above you with a borrowed beam and look through the hole, then climb four flights of crumbling stairs ahead of the lava to the stars |
