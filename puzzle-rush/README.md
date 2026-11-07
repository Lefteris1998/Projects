# Puzzle Rush

Timed practice on real Lichess puzzles, to get faster at Lichess Puzzle Racer.

## Modes
- **Racer:** 90 s, a point per correct move, combo bonus points (+1 at 5, +2 at 12, +3 at 20, +4 at 30, then +4 every 10), 1 skip. Same rules as lichess.org/racer.
- **Storm:** 3 min, a point per puzzle, combos add time (+3/+5/+7/+10 s), a mistake costs 10 s. Same rules as lichess.org/storm.
- **Rush 3 / Rush 5:** 3 or 5 min, out after 3 mistakes (chess.com Puzzle Rush rules).
- **Survival:** no clock, out after 3 mistakes.
- **Custom:** 1–10 minutes and 0/1/3/5 strikes.

The clock starts on your first move. Space skips (Racer), Esc ends the run.

## Puzzles
- **Lichess Racer set:** fetched live from `https://lichess.org/api/storm`, rated about 1000 to 2500 and getting harder as you go. Racer mode uses every second puzzle, like the real Racer.
- **Pick puzzles:** filter by rating band, theme, opening and colour, with optional "get harder as you go". These come from `data/`, a sample of 88k well-tested puzzles rated 600–2000 from the official Lichess puzzle database (CC0). Puzzles you've already seen are served last.

The Lichess API only allows a few anonymous requests at a time, so the pack is what lets you play many custom runs in a row.

To rebuild the pack with newer puzzles, download `lichess_db_puzzle.csv.zst` from https://database.lichess.org/#puzzles and run:

```
node tools/build-pack.js path/to/lichess_db_puzzle.csv.zst
```

## Saved in the browser
Settings, best score per setup, run history (for the progress chart) and seen puzzles are kept in localStorage.

Pieces: cburnett (CC BY-SA). Sounds: Lichess standard set.
