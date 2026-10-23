# Research notes & suggestions

## What Shotgun King actually does (research summary)
- Made by PUNKCAKE Délicieux (2022). You play the Black King with a shotgun. Each turn you **move or shoot**, and moving reloads.
- The default gun holds **2 shells** plus a reserve. Shots fan out into a cone: a close target takes heavy damage, distant targets take light damage spread across several pieces.
- The Black King **can't capture by moving**. Stepping into a capture range ends the run immediately.
- White pieces have **speed ratings** (turns to wait between moves). Several can move at once, and a piece about to move **quivers**.
- Kill the **White King** to clear a floor. Throne Mode has 12 floors and a boss on floor 12. Endless and Chase modes unlock later. In Chase mode, backup pieces arrive every 2–5 turns.
- **Souls**: killing a non-pawn, non-king piece gives a one-time move as that piece. You start with 1 slot.
- **Folly Shields** (2 per floor) block a move that would get you captured. They do **not** stop a discovered check caused by your own shot.
- **Cards**: after each floor you pick one of two pairs, each a black buff for you plus a white buff for the enemy. There are ~55 of each. Examples: extra barrels, blunderbuss and sniper builds, grenades, knockback, extra lives, "The Moat", and white cards like Theocracy (bishops +2 HP) or a king who is immortal while knights live.
- Difficulty scales mostly through **enemy HP**: at high ranks knights have ~4 HP and rooks ~8–9.

## What players complain about (and how this prototype answers it)
| Complaint | Source | In this prototype |
|---|---|---|
| Discovered check feels like an unfair instant loss; shields don't cover it | Steam threads | Illegal shots are **blocked** with a warning, like an illegal chess move |
| Missing at point-blank feels bad (RNG spread) | itch.io comment | **Deterministic** pellets with an exact damage preview |
| Two bad card choices can ruin a run; players want rerolls or more choices | Steam "gripes" thread | 1 reroll per run (expand to 3 choices or a separate black/white reroll) |
| Card text only appears on hover | Steam thread | Card text is always visible |
| No restart without dying; the intro can't be skipped | Steam thread | Restart (R) and takeback (Z) are always available |
| Players want the danger-square view back | Steam thread | Danger toggle (V) |
| Keyboard shortcuts and controller support requested | Steam threads | Keyboard shortcuts done; controller support not yet |
| Requires chess knowledge; some card text is unclear | Reviews (GameSpew, Turn Based Lovers) | Inspector panel, help screen, per-level tips |
| Thin story; one main mode; a run feels luck-dependent | Reviews | See ideas below |

## Suggestions for your own game

### Make the "calculation" fantasy stronger
1. **Hand-made puzzle levels with a "mate in N" goal**, e.g. "Kill the king in 4 turns, 3 shells." This is chess.com's puzzle loop with a shotgun.
2. **Daily puzzle and daily seeded run**, with a shared leaderboard by turns or shells used.
3. **Replay and analysis board** after a loss: step through the move list and see the checkmate pattern, like chess.com game review ("Brilliant!", "Blunder: opened the bishop's line").
4. **A hint button** that costs a star: it shows the best action using the same engine, since prediction is already cheap.
5. **Intent preview tiers** as a difficulty setting: Easy shows all enemy replies, Normal shows only ready pieces, Hard shows nothing.

### Mechanics to add
6. **Board terrain**: walls that block pellets and lines, crates (cover you can shoot to break), pits, ammo pickups, explosive barrels.
7. **Pellet ricochet off walls** for bank-shot puzzles.
8. **Knockback into pieces** for chain damage (SK's most fun but most frustrating mechanic; make it deterministic).
9. **Multiple guns** with distinct shapes: sniper (1 pellet, long range), blunderbuss (wide), slug (pierce line), grenade (area, can hurt you). The engine's `stats` object already supports most of these.
10. **Enemy variety beyond chess**: archers that fire every 2 turns, shield-bearers that block frontal pellets, necromancer bishops that revive pawns, a king who teleports at half HP.
11. **Bosses** with patterns, such as a Queen who duplicates or a giant 2×2 rook.
12. **Promotion pressure**: pawns reaching rank 1 become queens (already in). Add a visible "promotion in N" warning.

### Meta and roguelite
13. **3-choice drafts plus a separate black/white reroll**, the most requested fix.
14. **Unlockable starting kits** (different guns and soul types) and an ascension ladder that adds HP and speed per rank, as SK does.
15. **Endless and Chase modes** for score.
16. **A level editor** with share codes. The ASCII board format in `data.js` already serializes, so a URL like `#board=...` is easy.

### UX (chess.com polish)
17. Move-by-move animation of enemy turns, with an option for "simultaneous" or "one at a time".
18. Premoves (queue your next move while White animates).
19. Board themes and piece sets, coordinate toggle, colorblind palette for danger squares.
20. Controller and Steam Deck support (Steam users requested it).

## Sources
- Steam store: https://store.steampowered.com/app/1972440/Shotgun_King_The_Final_Checkmate/
- Wikipedia: https://en.wikipedia.org/wiki/Shotgun_King:_The_Final_Checkmate
- Turn Based Lovers review: https://turnbasedlovers.com/review/shotgun-king-the-final-checkmate-review/
- GameSpew review: https://www.gamespew.com/2023/08/shotgun-king-the-final-checkmate-review/
- Card guide (gamepretty): https://gamepretty.com/shotgun-king-the-final-checkmate-card-review-and-enemy-guide/
- Steam: "A few gripes": https://steamcommunity.com/app/1972440/discussions/0/3551679689850940322/
- Steam: "Discovered check is the worst thing": https://steamcommunity.com/app/1972440/discussions/0/595147404010875097/
- Steam: danger visualization: https://steamcommunity.com/app/1972440/discussions/0/844005195821217937/
- Steam: keyboard buttons: https://steamcommunity.com/app/1972440/discussions/0/4827307257586945984/
- itch.io comment (point-blank misses): https://itch.io/post/5769984
- OpenCritic: https://opencritic.com/game/14838/shotgun-king-the-final-checkmate
- Fandom modes page: https://shotgun-king.fandom.com/wiki/Modes
- TrueAchievements card-pool thread: https://www.trueachievements.com/forum/viewthread.aspx?tid=1638657
- GamingOnLinux (controller support): https://www.gamingonlinux.com/2022/05/bad-at-chess-bring-a-shotgun-in-this-roguelike-spin/
