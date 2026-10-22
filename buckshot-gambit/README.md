# Buckshot Gambit — prototype

A turn-based chess-tactics prototype inspired by *Shotgun King: The Final Checkmate*.
You are the Black King with a shotgun. Each turn you either **move one square (which reloads)** or **fire**.
White pieces move like chess pieces, but each one only acts every N turns. Clear the board (or kill the White King) before they swarm and checkmate you.

## Run it
Double-click `index.html`. No build step or server is needed; it runs on plain HTML, CSS and JS.

## Files
| File | What's in it |
|---|---|
| `js/data.js` | **All tuning lives here**: piece HP/speed, shotgun stats, the 8 levels (ASCII boards), black/white cards |
| `js/engine.js` | Pure rules engine: legal moves, deterministic pellet ray-casting, enemy AI, win/lose |
| `js/ui.js` | Rendering, aim/damage preview, prediction arrows, input, screens, saving |
| `js/audio.js` | Chess sounds from `assets/sounds` + a synthesized shotgun blast |
| `css/style.css` | chess.com-style theme |
| `assets/` | Pieces and sounds copied from the `blindfold` project |

## Adding a level
Add an entry to `LEVELS` in `js/data.js`:
```js
{ id: 9, name: 'My Level', objective: 'all' /* or 'king' */, par: 12, reserve: 10,
  tip: 'Shown on turn 0.',
  board: ['........', '..PNP...', '........', '........', '........', '........', '........', '....@...'],
  reinforce: { every: 4, pool: ['P', 'N'], cols: [3, 4] } }  // optional
```
`@` = you, `P N B R Q K` = white pieces. White pawns move **down** and promote on rank 1.

## Rules as implemented
- **Shotgun**: 5 pellets fanned *evenly* across a 44° cone, range 3.2 squares, 1 damage each. There's no RNG, so the preview shows exact damage.
- **Ammo**: 2 loaded shells. Moving reloads 1 from reserve. Running out of all shells loses the level.
- **Check**: you can never step onto an attacked square or fire a shot that exposes your king (discovered check is blocked, not punished). When White checks you, you get one turn to escape. If you can't, it's checkmate.
- **Divine Shield** (1 per level): when you'd be checkmated, it destroys the attackers instead.
- **Souls**: killing a knight, bishop, rook or queen fills a soul slot. Use it to move once like that piece.
- **Enemy AI**: deterministic greedy. It prefers moves that give check, cover your escape squares and close distance. The White King keeps away from you.
- **Stars**: ★ clear · ★★ within par · ★★★ within par with no takebacks and no shield.
