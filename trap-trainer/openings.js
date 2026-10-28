// Saved openings. Paste a lichess study's PGN as-is (all chapters and variations work).
// Your side comes from each chapter's [Orientation "black"] header, or `color` if set here.
window.OPENINGS = [
  {
    name: 'Légal Trap',
    color: 'white',
    pgn: `1. e4 e5 2. Nf3 d6 3. Bc4 Bg4 4. Nc3 g6 (4... Nc6 5. h3 Bh5 6. Nxe5 Bxd1 (6... dxe5 7. Qxh5) 7. Bxf7+ Ke7 8. Nd5#) 5. Nxe5 Bxd1 (5... dxe5 6. Qxg4) 6. Bxf7+ Ke7 7. Nd5#`,
  },
  {
    name: 'Englund Gambit Trap',
    color: 'black',
    pgn: `1. d4 e5 2. dxe5 Nc6 3. Nf3 Qe7 4. Bf4 Qb4+ 5. Bd2 (5. Qd2 Qxb2 6. Qc3 Bb4 7. Qxb4 Nxb4) 5... Qxb2 6. Bc3 Bb4 7. Qd2 Bxc3 8. Qxc3 Qc1#`,
  },
  {
    name: 'Stafford Gambit Traps',
    color: 'black',
    // https://lichess.org/study/whCVdUeM (Eric Rosen)
    pgn: `[Event "Stafford Gambit Traps: Introduction"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Introduction"]
[ChapterURL "https://lichess.org/study/whCVdUeM/1qG3NOtV"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "23:49:11"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 *

[Event "Stafford Gambit Traps: Oh no my queen!"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Oh no my queen!"]
[ChapterURL "https://lichess.org/study/whCVdUeM/Ue5KaLXB"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "05:38:56"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. d3 Bc5 6. Bg5 Nxe4 7. Bxd8 (7. dxe4 Bxf2+ 8. Kxf2 (8. Ke2 Bg4+) 8... Qxd1) (7. Qe2 Qxg5 8. Qxe4+ Kd8 9. Be2 Qc1+ ) 7... Bxf2+ 8. Ke2 Bg4# *

[Event "Stafford Gambit Traps: Oh no my knight!"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Oh no my knight!"]
[ChapterURL "https://lichess.org/study/whCVdUeM/ErOZL7WH"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "05:43:51"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. e5 Ne4 6. d3 (6. d4 6... Qh4 7. g3 Nxg3 8. fxg3 Qe4+ ) 6... Bc5 7. dxe4 (7. Be3 Bxe3 8. fxe3 Qh4+ 9. g3 (9. Ke2 Qf2#) 9... Nxg3 10. hxg3 Qxh1) 7... Bxf2+ 8. Kxf2 (8. Ke2 Bg4+) 8... Qxd1 *

[Event "Stafford Gambit Traps: Take my knight, but I'll take your rook..."]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Take my knight, but I'll take your rook..."]
[ChapterURL "https://lichess.org/study/whCVdUeM/m7MYFQfB"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "06:10:12"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. e5 Ne4 6. d4 Qh4 7. g3 Nxg3 8. fxg3 Qe4+ *

[Event "Stafford Gambit Traps: Most common trap"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Most common trap"]
[ChapterURL "https://lichess.org/study/whCVdUeM/tNFnGGP6"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "05:41:40"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. Nc3 (5. d3 Bc5 6. Nc3 ) 5... Bc5 6. d3 Ng4 7. Be3 Nxe3 8. fxe3 Bxe3 *

[Event "Stafford Gambit Traps: Punishing Natural Development"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Punishing Natural Development"]
[ChapterURL "https://lichess.org/study/whCVdUeM/RADiAxPW"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "05:45:53"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. Nc3 Bc5 6. Bc4 6... Ng4 7. O-O (7. Qf3 7... Ne5 8. Qe2 Qh4 9. d3 (9. g3 Qh3 ) 9... Bg4 10. Qf1 Nxc4 11. dxc4 O-O-O) 7... Qh4 8. h3 Nxf2 9. Qf3 Nxh3+ 10. Kh1 Nf2+ 11. Kg1 Qh1# *

[Event "Stafford Gambit Traps: My Favorite Trap (Sometimes works against GMs!)"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "My Favorite Trap (Sometimes works against GMs!)"]
[ChapterURL "https://lichess.org/study/whCVdUeM/hIqxvePK"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "06:01:06"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. Nc3 Bc5 6. Be2 h5 7. h3 7... Qd4 8. O-O Ng4 9. hxg4 hxg4 10. g3 (10. d3 10... Qe5 11. g3 Qxg3#) (10. Bxg4 Qe5 11. Bh3 Bxh3) 10... Qe5 11. Kg2 Bxf2 12. Kxf2 (12. Rxf2 Qh5 13. Rf4 Qh2+ 14. Kf1 Qxg3 ) 12... Rh2+ 13. Ke3 Qxg3+ 14. Kd4 Be6 *

[Event "Stafford Gambit Traps: Everyone falls for this trap 😁"]
[Date "2020.08.04"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Everyone falls for this trap 😁"]
[ChapterURL "https://lichess.org/study/whCVdUeM/SogzMBTz"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.04"]
[UTCTime "06:06:04"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. d3 Bc5 6. Be2 h5 7. O-O Ng4 8. h3 Qd6 9. hxg4 (9. g3 Qxg3+ 10. Kh1 Qh2#) (9. e5 9... Nxe5 ) (9. Bxg4 hxg4 ) 9... hxg4 *

[Event "Stafford Gambit Traps: Miscellaneous Lines"]
[Date "2020.08.17"]
[Result "*"]
[Variant "Standard"]
[ECO "C42"]
[Opening "Petrov's Defense: Stafford Gambit"]
[StudyName "Stafford Gambit Traps"]
[ChapterName "Miscellaneous Lines"]
[ChapterURL "https://lichess.org/study/whCVdUeM/g8inMN8c"]
[Annotator "https://lichess.org/@/EricRosen"]
[UTCDate "2020.08.17"]
[UTCTime "07:13:07"]

1. e4 e5 2. Nf3 Nf6 3. Nxe5 Nc6 4. Nxc6 dxc6 5. d3 Bc5 6. Be3 Bxe3 7. fxe3 Ng4 8. Qf3 Qg5 9. Qf4 Qc5 10. Kd2 *`,
  },
];
