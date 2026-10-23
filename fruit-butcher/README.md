# Fruit Butcher — prototype

Fruit Ninja, but every fruit is a ham steak inside and has organs. Blood splatters onto the
screen, drips, and slowly dries, so the longer you play the less you can see. Lemons trigger a
windshield wiper that clears it.

## Run it
Open `index.html`, or run `start.bat` in the parent folder and pick it from the index. No build step.

## Files
| File | What's in it |
|---|---|
| `game.js` | Everything: `LEVELS` and `FRUITS` tuning at the top, then physics, gore, drawing, input |
| `style.css` | HUD, menus, the chopping-board background |

## Tuning (top of `game.js`)
- `LEVELS[i]`: `target` (slices to win), `speed` (time scale), `wave` [start, end] seconds between
  throws, `maxPer` fruit per throw, `bomb` / `lemon` chance per fruit, `fade` (how fast screen
  blood dries; `0` = never), `gore` (multiplier on blood, splats and organ drops), `pool` of fruit.
- `FRUITS[type]`: `gore` is the list of organs it can drop (`eye tooth worm heart brain bone`
  fly loose; `guts spine` are ropes that trail from a half), `blood` scales the splatter.

## Gore cheat sheet
| Fruit | Drops |
|---|---|
| Apple | worms, an eyeball |
| Orange | eyeballs, a tooth |
| Strawberry | teeth |
| Watermelon | intestines, a beating heart |
| Banana | a spine, a bone |
| Coconut | a brain, eyeballs |
| Pineapple | heart, guts, bone |
| Lemon | nothing; it's the wiper |
| Bomb | −1 life, but kills every fruit on screen (points count) and clears all blood |

Organs can be sliced again for +1 each, and so can the intestines (they split). That's extra
points but also extra blood on the screen.

## Weapons (`swords/`, picked on the menu, saved per browser)
Images are background-removed, rotated to point top-right and shrunk to 256px. Originals are in `swords/_originals`. Tuning is in `WEAPONS` in `game.js`.
| Weapon | Effect |
|---|---|
| Pocket Knife | Thin silver trail and sparks. 40% less blood on the screen, slightly shorter reach |
| Butcher Knife | Heavy trail. 1.6x organs and blood, big screen shake, 2 damage to the boss |
| Katana | Longest reach. Fruit freeze, a slash line crosses the screen, then they burst |
| Ea | Every cut sends out a shockwave that slices nearby fruit (not bombs). 1.5x blood on the screen |
| Shadowmourne | The WoW legendary axe. Every fruit kill (bomb kills too) frees a little ghost that flies into the **SOULS x/10** counter at the top. The 10th soul unleashes **Chaos Bane**: the screen goes dark and the 10 souls burst out as an angry ghost army. Each ghost hunts down one fruit (never bombs) or, with no fruit around, dives at the boss for 1.5. Ghost-army kills don't give souls back. All kill messages turn blue and WoW-flavoured (`MOURNE_WORDS`, `MOURNE_GIB`, `ARMY_WORDS`), and the result screen shows souls reaped. Tuning is in `MOURNE` |

## Boss (level 5)
Reaching 100 on level 5 summons THE GREAT GOURD and switches to `Boss music.mp3`. Normal waves stop and it spits volleys of fruit (sometimes a bomb or a lemon). Below half health it fires faster. It has 40 HP; damage per hit depends on the weapon. Killing it gives +25 and wins the level. Tuning is in `BOSS` in `game.js`. Pressing `]` on level 5 summons the boss straight away.

## Audio (`ost/`, local testing only, not licensed for publishing)
All files are normalized to -16 LUFS with the silence trimmed off both ends. The songs (`Main screen`, `Boss music`, `music1-4`) are re-encoded as ~100 kbps VBR MP3 to keep the folder small. The full-quality originals are in `../_backup/fruit-butcher-ost-originals`. They're wired up in `TRACKS` / `CLIPS` near the top of `game.js`.
- `Main screen.mp3` loops on the menu. It starts on the first click, because browsers block autoplay.
- Level N plays `musicN.mp3`. If that file is missing it falls back to `music4.mp3`.
- `Hit1-8`: about 30% of fruit kills, at least 1.6 s apart, never the same clip twice in a row, cut off after 2.2 s.
- `sfx-sword`: always at the start of level 1, 50% chance on other levels.
- `Success1-3` / `Defeat1-3`: random pick on win/lose, while the level music fades out.

## Playtest keys
`P` / `Esc` pause, `M` mute, `]` skip the current level (counts as a win), `B` throw a bomb, `S` +1 soul (Shadowmourne only).
