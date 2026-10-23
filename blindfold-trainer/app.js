// ===== Blindfold Chess – app.js =====

const PIECE_SVG = key => `pieces/cburnett/${key}.svg`;

const DIFFICULTIES = [
  { skill: 0,  movetime: 20  },
  { skill: 0,  movetime: 50  },
  { skill: 1,  movetime: 75  },
  { skill: 2,  movetime: 100 },
  { skill: 4,  movetime: 150 },
  { skill: 6,  movetime: 250 },
  { skill: 8,  movetime: 400 },
  { skill: 10, movetime: 600 },
  { skill: 13, movetime: 900 },
  { skill: 16, movetime: 1200},
];

// Min display delay before showing engine move (feels human)
const THINK_MIN_MS = 1000;
const THINK_MAX_MS = 3000;

// ===== Sound =====

const SFX = {
  move:    new Audio('sounds/Move.ogg'),
  capture: new Audio('sounds/Capture.ogg'),
  check:   new Audio('sounds/Check.ogg'),
  notify:  new Audio('sounds/GenericNotify.ogg'),
};

function playSound(name) {
  const sfx = SFX[name];
  if (!sfx) return;
  sfx.currentTime = 0;
  sfx.play().catch(() => {}); // silently ignore autoplay restrictions
}

// ===== ELO System =====

const DIFFICULTY_ELO = [800, 950, 1100, 1250, 1400, 1550, 1700, 1850, 2000, 2150];
const ELO_K = 32;

function loadElo() { return parseInt(localStorage.getItem('bca_elo') || '1200'); }
function saveElo(elo) { localStorage.setItem('bca_elo', Math.round(elo).toString()); }

function calcEloChange(playerElo, opponentElo, score) {
  const expected = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  return Math.round(ELO_K * (score - expected));
}

function updateEloBadge() {
  const elo = loadElo();
  const badge = document.getElementById('player-elo-badge');
  if (badge) badge.textContent = '(' + elo + ')';
  const homeEl = document.getElementById('home-elo-value');
  if (homeEl) homeEl.textContent = elo;
}

// ===== Board Themes =====

const BOARD_THEMES = {
  classic: { light: '#f0d9b5', dark: '#b58863', hlLight: '#cdd16f', hlDark: '#aaa23a' },
  ocean:   { light: '#dee3e6', dark: '#8ca2ad', hlLight: '#a8d4e6', hlDark: '#5f9ab7' },
  forest:  { light: '#ffffdd', dark: '#86a666', hlLight: '#d4e88c', hlDark: '#7a9e44' },
  coral:   { light: '#f0e9c5', dark: '#b85c38', hlLight: '#e8c97a', hlDark: '#c48030' },
  purple:  { light: '#e8d8f0', dark: '#7b5ea7', hlLight: '#c8a8e8', hlDark: '#9966cc' },
  slate:   { light: '#d9d9d9', dark: '#6e7f8a', hlLight: '#b8c8d0', hlDark: '#5a6f7a' },
};

let boardTheme = localStorage.getItem('bca_theme') || 'classic';

function applyBoardTheme(theme) {
  boardTheme = theme;
  localStorage.setItem('bca_theme', theme);
  const t = BOARD_THEMES[theme];
  if (!t) return;
  const root = document.documentElement;
  root.style.setProperty('--light',  t.light);
  root.style.setProperty('--dark',   t.dark);
  root.style.setProperty('--hl-l',   t.hlLight);
  root.style.setProperty('--hl-d',   t.hlDark);
}

// ===== Chess Clock =====

const TIME_PRESETS = {
  '0':   { seconds: 0,   inc: 0  },
  '60':  { seconds: 60,  inc: 0  },
  '180': { seconds: 180, inc: 2  },
  '300': { seconds: 300, inc: 3  },
  '600': { seconds: 600, inc: 5  },
  '900': { seconds: 900, inc: 10 },
};

let selectedTimeKey = '0';  // '0' = no limit
let clockWhite      = 0;    // seconds remaining
let clockBlack      = 0;
let clockInterval   = null;

function clockActive() { return selectedTimeKey !== '0'; }

function formatClock(sec) {
  if (sec <= 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m + ':' + String(s).padStart(2, '0');
}

function updateClockDisplay() {
  const playerClockEl   = document.getElementById('player-clock');
  const opponentClockEl = document.getElementById('opponent-clock');

  const playerSec   = playerColor === 'w' ? clockWhite : clockBlack;
  const opponentSec = playerColor === 'w' ? clockBlack : clockWhite;

  playerClockEl.textContent   = formatClock(playerSec);
  opponentClockEl.textContent = formatClock(opponentSec);

  const isPlayerTurn = gameActive && chess.turn() === playerColor && !waitingForEngine;
  playerClockEl.classList.toggle('active-clock', isPlayerTurn);
  opponentClockEl.classList.toggle('active-clock', !isPlayerTurn && gameActive);
  playerClockEl.classList.toggle('low-time', playerSec > 0 && playerSec <= 10);
  opponentClockEl.classList.toggle('low-time', opponentSec > 0 && opponentSec <= 10);
}

function startClock() {
  if (!clockActive()) return;
  stopClock();
  clockInterval = setInterval(() => {
    if (!gameActive) { stopClock(); return; }
    const turn = chess.turn();
    if (turn === 'w') clockWhite = Math.max(0, clockWhite - 1);
    else              clockBlack = Math.max(0, clockBlack - 1);

    updateClockDisplay();

    if ((turn === 'w' && clockWhite === 0) || (turn === 'b' && clockBlack === 0)) {
      stopClock();
      const flaggedColor = turn;
      const result = flaggedColor === playerColor ? 'lose' : 'win';
      showGameOver(result, 'Time forfeit');
      gameActive = false;
    }
  }, 1000);
}

function stopClock() {
  if (clockInterval) { clearInterval(clockInterval); clockInterval = null; }
}

function addIncrement(color) {
  const preset = TIME_PRESETS[selectedTimeKey];
  if (!preset || !preset.inc) return;
  if (color === 'w') clockWhite = Math.min(clockWhite + preset.inc, 9999);
  else               clockBlack = Math.min(clockBlack + preset.inc, 9999);
}

function showClocks() {
  document.getElementById('player-clock').style.display   = clockActive() ? '' : 'none';
  document.getElementById('opponent-clock').style.display = clockActive() ? '' : 'none';
}

// ===== Opening Names (compact ECO table) =====

const ECO_TABLE = [
  [['e4','e5','Nf3','Nc6','Bb5'],           "Ruy López"],
  [['e4','e5','Nf3','Nc6','Bc4'],           "Italian Game"],
  [['e4','e5','Nf3','Nc6','d4'],            "Scotch Game"],
  [['e4','e5','Nf3','Nc6','Bc4','Bc5'],     "Giuoco Piano"],
  [['e4','e5','Nf3','Nf6'],                 "Petrov's Defense"],
  [['e4','e5','Nc3'],                       "Vienna Game"],
  [['e4','e5','f4'],                        "King's Gambit"],
  [['e4','c5'],                             "Sicilian Defense"],
  [['e4','c5','Nf3','d6','d4'],             "Sicilian — Open"],
  [['e4','c5','Nc3'],                       "Sicilian — Closed"],
  [['e4','e6'],                             "French Defense"],
  [['e4','c6'],                             "Caro-Kann Defense"],
  [['e4','d5'],                             "Scandinavian Defense"],
  [['e4','Nf6'],                            "Alekhine's Defense"],
  [['e4','g6'],                             "Modern Defense"],
  [['e4','d6'],                             "Pirc Defense"],
  [['d4','d5'],                             "Queen's Pawn Game"],
  [['d4','d5','c4'],                        "Queen's Gambit"],
  [['d4','d5','c4','e6'],                   "Queen's Gambit Declined"],
  [['d4','d5','c4','c6'],                   "Slav Defense"],
  [['d4','d5','c4','dxc4'],                 "Queen's Gambit Accepted"],
  [['d4','Nf6','c4','e6'],                  "Nimzo-Indian / QID"],
  [['d4','Nf6','c4','e6','Nc3','Bb4'],      "Nimzo-Indian Defense"],
  [['d4','Nf6','c4','g6'],                  "King's Indian Defense"],
  [['d4','Nf6','c4','g6','Nc3','Bg7','e4'], "King's Indian — Classical"],
  [['d4','Nf6','c4','c5'],                  "Benoni Defense"],
  [['d4','f5'],                             "Dutch Defense"],
  [['d4','Nf6','Nf3','g6'],                 "King's Indian Attack"],
  [['Nf3'],                                 "Réti Opening"],
  [['Nf3','d5','c4'],                       "English — Reversed Sicilian"],
  [['c4'],                                  "English Opening"],
  [['c4','e5'],                             "English — King's English"],
  [['b3'],                                  "Nimzovich-Larsen Attack"],
  [['g3'],                                  "King's Fianchetto"],
  [['e4','e5','Nf3','Nc6','Bb5','a6','Ba4','Nf6','O-O'], "Ruy López — Open"],
];

function getCurrentOpening(moves) {
  if (!moves.length) return '';
  let bestName = '';
  let bestLen  = 0;
  for (const [seq, name] of ECO_TABLE) {
    if (seq.length > moves.length) continue;
    let match = true;
    for (let i = 0; i < seq.length; i++) {
      const mv = moves[i].replace(/[+#x]/g, '');
      const sq = seq[i].replace(/[+#x]/g, '');
      if (mv !== sq) { match = false; break; }
    }
    if (match && seq.length > bestLen) {
      bestLen  = seq.length;
      bestName = name;
    }
  }
  return bestName;
}

function updateOpeningDisplay() {
  const el = document.getElementById('opening-name');
  if (!el) return;
  if (moveList.length < 2 || moveList.length > 20) { el.textContent = ''; return; }
  const name = getCurrentOpening(moveList);
  el.textContent = name;
}

// ===== Confetti =====

function launchConfetti() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;
  canvas.style.display = 'block';
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx     = canvas.getContext('2d');
  const colors  = ['#ffd600','#4caf50','#2196f3','#e91e63','#ff5722','#9c27b0','#00bcd4'];
  const pieces  = Array.from({ length: 120 }, () => ({
    x:    Math.random() * canvas.width,
    y:    -Math.random() * canvas.height * 0.5,
    w:    6 + Math.random() * 8,
    h:    10 + Math.random() * 6,
    r:    Math.random() * Math.PI * 2,
    dr:   (Math.random() - 0.5) * 0.2,
    vx:   (Math.random() - 0.5) * 2,
    vy:   2 + Math.random() * 3,
    color: colors[Math.floor(Math.random() * colors.length)],
    alpha: 1,
  }));

  let frame;
  const startTime = Date.now();

  function draw() {
    const elapsed = Date.now() - startTime;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    let alive = false;
    for (const p of pieces) {
      p.x  += p.vx;
      p.y  += p.vy;
      p.r  += p.dr;
      p.vy += 0.05; // gravity
      if (elapsed > 2000) p.alpha -= 0.012;
      if (p.alpha <= 0 || p.y > canvas.height + 20) continue;
      alive = true;
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.alpha);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (alive && elapsed < 4500) {
      frame = requestAnimationFrame(draw);
    } else {
      canvas.style.display = 'none';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  if (frame) cancelAnimationFrame(frame);
  draw();
}

// ===== Move Accuracy =====
// Judged like Lichess: by how much a move drops the mover's winning chances.

// {key, label, symbol, color, lossCp, drop} per ply (index matches moveList)
let moveAccuracy = [];

const ACCURACY_CLASSES = [
  { key: 'best',       label: 'Best',       symbol: '★',  color: '#4e9ff5', maxDrop: 0     },
  { key: 'excellent',  label: 'Excellent',  symbol: '!',  color: '#4caf50', maxDrop: 0.025 },
  { key: 'good',       label: 'Good',       symbol: '',   color: '#8bc34a', maxDrop: 0.1   },
  { key: 'inaccuracy', label: 'Inaccuracy', symbol: '?!', color: '#56b4e9', maxDrop: 0.2   },
  { key: 'mistake',    label: 'Mistake',    symbol: '?',  color: '#e69f00', maxDrop: 0.3   },
  { key: 'blunder',    label: 'Blunder',    symbol: '??', color: '#db3031', maxDrop: Infinity },
];

// Returns raw centipawns from white's perspective for a cached FEN (null if not cached)
function fenWhiteCp(fen) {
  const cached = analysisCache[fen];
  if (!cached?.mvs?.[0]) return null;
  const mv   = cached.mvs[0];
  const turn = fen.split(' ')[1];
  if (mv.mate !== null) {
    const whiteMate = turn === 'w' ? mv.mate : -mv.mate;
    return whiteMate > 0 ? 10000 : -10000;
  }
  if (mv.cp !== null) return turn === 'w' ? mv.cp : -mv.cp;
  return null;
}

// Like fenWhiteCp, but scores finished positions (the engine returns no lines for them)
function positionWhiteCp(fen) {
  const tmp = new Chess(fen);
  if (tmp.in_checkmate()) return tmp.turn() === 'w' ? -10000 : 10000;
  if (tmp.game_over())    return 0;
  return fenWhiteCp(fen);
}

// Judges ply i (the move from fenHistory[i] to fenHistory[i + 1]); null until both sides are analyzed
function judgeMove(i) {
  const preFen  = fenHistory[i];
  const postFen = fenHistory[i + 1];
  const preCp   = positionWhiteCp(preFen);
  const postCp  = positionWhiteCp(postFen);
  if (preCp === null || postCp === null) return null;

  const white  = preFen.split(' ')[1] === 'w';
  const pov    = cp => white ? cp : -cp;
  const drop   = winningChances(pov(preCp)) - winningChances(pov(postCp));
  const lossCp = Math.max(0, pov(preCp) - pov(postCp));

  const bestUci   = analysisCache[preFen]?.mvs?.[0]?.pv?.[0];
  const playedUci = moveFromTo[i] ? moveFromTo[i].from + moveFromTo[i].to : '';
  const isBest    = bestUci && bestUci.slice(0, 4) === playedUci;

  const cls = isBest ? ACCURACY_CLASSES[0]
    : ACCURACY_CLASSES.slice(1).find(c => drop < c.maxDrop) || ACCURACY_CLASSES[ACCURACY_CLASSES.length - 1];
  return { ...cls, drop, lossCp };
}

function computeMoveAccuracy() {
  moveAccuracy = [];
  for (let i = 0; i < moveList.length; i++) moveAccuracy.push(judgeMove(i));
}

// ===== State =====

let chess            = new Chess();
let engine           = null;
let engineReady      = false;
let gameActive       = false;
let waitingForEngine = false;
let playerColor      = 'w';
let chosenColor      = 'w';
let gameMode         = 'normal'; // 'normal' | 'checkers' | 'void'
let viewMode         = 'normal'; // 'normal' | 'checkers' | 'void' (in-game toggle)
let manualFlip       = false; // user-toggled board flip (F key)
let selectedSq       = null;
let legalTargets     = [];
let pendingPromotion = null;
let lastMove         = null;
let moveList         = [];
let premove          = null; // { from, to, promo }

// Annotation state
let annotations    = []; // { type: 'arrow'|'circle', from, to, color }
let arrowDrawStart = null;

// Engine game-ID: prevents stale bestmove from a previous game being applied
let gameId              = 0;
let engineGameId        = -1;
let engineMoveStartTime = 0;
let pendingEngineTimeout = null;

// History / review
let fenHistory   = [];
let boardHistory = []; // chess.board() snapshots — avoids new Chess() on every render
let checkHistory = []; // { inCheck, turn } snapshots for check highlight
let moveFromTo   = [];
let viewIndex    = 0;

// Drag state
let mouseDownData = null;
let isDragging    = false;
let dragEl        = null;

// Voice state
let voiceEnabled  = false; // speech synthesis for engine move announcements

// Voice input state (see Voice System)
let awaitingResignConfirmation = false;
let recognition   = null; // active Web Speech API session
let micAlwaysOn   = false;

// Auth state
let currentUser = null;

// Analysis engine state
let stockfishBlobUrl     = null;   // reused for both workers (no double-download)
let analysisEngine       = null;
let analysisEngineReady  = false;
let analysisMode         = false;
let homeArchivePage      = 0;
let homeArchiveCache     = [];
let analysisFen          = '';              // FEN currently being analyzed by engine
let analysisMvs          = Array(10).fill(null); // in-progress multipv results
let analysisCache        = {};             // fen → { mvs: [...] } — pre-computed results
let analysisQueue        = [];             // array of FENs to analyze in batch
let analysisQueuePos     = 0;             // index into analysisQueue
let batchAnalyzing       = false;
let analysisPhase        = 1;             // 1 = fast initial pass, 2 = background refinement
let analysisArrows       = [];            // { from, to, color, opacity, width } — engine arrows on the board
let reviewNames          = null;          // { you, opponent } labels for an imported game, null = vs engine

// ===== Firebase =====

// Config lives in firebase-config.js (gitignored). Without it, sign-in is hidden.
const firebaseConfig = window.FIREBASE_CONFIG || null;
let fbAuth = null;
let fbDb   = null;

if (firebaseConfig) {
  firebase.initializeApp(firebaseConfig);
  fbAuth = firebase.auth();
  fbDb   = firebase.database();
  fbAuth.onAuthStateChanged(user => {
    currentUser = user;
    updateAuthUI(user);
  });
} else {
  document.getElementById('auth-bar').style.display = 'none';
}

function updateAuthUI(user) {
  const signedInEl = document.getElementById('auth-signed-in');
  const signInBtn  = document.getElementById('auth-signin-btn');
  if (user) {
    const avatar = document.getElementById('auth-avatar');
    avatar.src = user.photoURL || '';
    avatar.style.display = user.photoURL ? 'block' : 'none';
    document.getElementById('auth-display-name').textContent = user.displayName || user.email;
    signedInEl.style.display = 'flex';
    signInBtn.style.display  = 'none';
  } else {
    signedInEl.style.display = 'none';
    signInBtn.style.display  = 'flex';
  }
}

document.getElementById('auth-signin-btn').addEventListener('click', () => {
  const provider = new firebase.auth.GoogleAuthProvider();
  fbAuth.signInWithPopup(provider).catch(err => console.error('[Auth] Sign-in failed:', err));
});

document.getElementById('auth-signout-btn').addEventListener('click', () => {
  fbAuth.signOut().catch(err => console.error('[Auth] Sign-out failed:', err));
});

// Returns the best supported MediaRecorder MIME type for this browser/OS
function getSupportedMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg',
  ];
  return candidates.find(t => MediaRecorder.isTypeSupported(t)) || '';
}

// ===== Engine =====

async function initEngine() {
  setStatus('Loading Stockfish engine...');
  try {
    const resp = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
    if (!resp.ok) throw new Error('fetch failed');
    const blob = new Blob([await resp.text()], { type: 'text/javascript' });
    stockfishBlobUrl = URL.createObjectURL(blob);
    engine = new Worker(stockfishBlobUrl);
    engine.onmessage = onEngineMessage;
    engine.postMessage('uci');
    engine.postMessage('isready');
  } catch {
    setStatus('Failed to load engine. Check your internet connection.');
  }
}

function onEngineMessage(e) {
  const line = e.data;

  if (line === 'readyok' && !engineReady) {
    engineReady = true;
    setStatus('Engine ready. Select a difficulty and start a new game.');
  }

  // BUG FIX 3: ignore bestmove from a previous game via engineGameId check
  if (line.startsWith('bestmove') && waitingForEngine && engineGameId === gameId) {
    waitingForEngine = false;
    const move = line.split(' ')[1];
    if (!move || move === '(none)') return;

    const elapsed  = Date.now() - engineMoveStartTime;
    const target   = THINK_MIN_MS + Math.random() * (THINK_MAX_MS - THINK_MIN_MS);
    const delay    = Math.max(0, target - elapsed);

    pendingEngineTimeout = setTimeout(() => applyEngineMove(move), delay);
  }
}

function applyEngineMove(move) {
    const from  = move.slice(0, 2);
    const to    = move.slice(2, 4);
    const promo = move[4] || undefined;

    const result = chess.move({ from, to, promotion: promo });
    if (!result) { console.error('Engine played illegal move:', move); return; }

    moveList.push(result.san);
    lastMove = { from, to };
    moveFromTo.push({ from, to });
    boardHistory.push(chess.board());
    checkHistory.push({ inCheck: chess.in_check(), turn: chess.turn() });
    fenHistory.push(chess.fen());
    viewIndex = fenHistory.length - 1;

    // Clock: add increment for engine, start player's clock
    if (clockActive()) {
      addIncrement(result.color);
      startClock();
      updateClockDisplay();
    }

    // Opening name
    updateOpeningDisplay();

    // Sound
    if (chess.in_check())    playSound('check');
    else if (result.captured) playSound('capture');
    else                      playSound('move');

    renderBoard();
    renderMoveHistory();
    updateNavButtons();

    if (chess.game_over()) { handleGameOver(); return; }

    // Execute premove if queued
    if (premove) {
      const pm = premove;
      premove = null;
      const pmResult = chess.move({ from: pm.from, to: pm.to, promotion: pm.promo || 'q' });
      if (pmResult) {
        moveList.push(pmResult.san);
        lastMove = { from: pm.from, to: pm.to };
        moveFromTo.push({ from: pm.from, to: pm.to });
        boardHistory.push(chess.board());
        checkHistory.push({ inCheck: chess.in_check(), turn: chess.turn() });
        fenHistory.push(chess.fen());
        viewIndex = fenHistory.length - 1;
        if (clockActive()) { addIncrement(pmResult.color); startClock(); updateClockDisplay(); }
        updateOpeningDisplay();
        if (chess.in_check())      playSound('check');
        else if (pmResult.captured) playSound('capture');
        else                        playSound('move');
        renderBoard();
        renderMoveHistory();
        updateNavButtons();
        if (chess.game_over()) { handleGameOver(); return; }
        if (voiceEnabled) speakMove(pmResult.san, false);
        setStatus(`Premove: ${pmResult.san}. Engine is thinking…`);
        requestEngineMove();
        return;
      }
    }

    if (voiceEnabled) speakMove(result.san, true);
    setStatus(`Engine played ${result.san}. Your move.`);
    if (micAlwaysOn) setTimeout(() => autoStartListening(), voiceEnabled ? 1800 : 400);
}

function sendCmd(cmd) { if (engine) engine.postMessage(cmd); }

// ===== Engine move request =====

function requestEngineMove() {
  const diff = DIFFICULTIES[parseInt(document.getElementById('difficulty-select').value)];
  engineGameId        = gameId; // tie this request to the current game
  waitingForEngine    = true;
  engineMoveStartTime = Date.now();
  setStatus('Engine is thinking…');
  sendCmd('position fen ' + chess.fen());
  sendCmd('go movetime ' + diff.movetime);
}

// ===== Analysis Engine =====

async function initAnalysisEngine() {
  if (analysisEngine) return;
  try {
    if (!stockfishBlobUrl) {
      const resp = await fetch('https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js');
      if (!resp.ok) throw new Error('fetch failed');
      const blob = new Blob([await resp.text()], { type: 'text/javascript' });
      stockfishBlobUrl = URL.createObjectURL(blob);
    }
    analysisEngine = new Worker(stockfishBlobUrl);
    analysisEngine.onmessage = onAnalysisMessage;
    analysisEngine.postMessage('uci');
    analysisEngine.postMessage('setoption name MultiPV value 10');
    analysisEngine.postMessage('isready');
  } catch (e) {
    console.error('[Analysis] Failed to init engine:', e);
    setStatus('Analysis engine failed to load. Check your internet connection.');
  }
}

function onAnalysisMessage(e) {
  const line = e.data;

  if (line === 'readyok' && !analysisEngineReady) {
    analysisEngineReady = true;
    if (batchAnalyzing) analyzeNextInQueue();
    return;
  }

  if (line.startsWith('info') && line.includes(' pv ') && line.includes('multipv')) {
    parseAnalysisInfo(line);
    // Live-update panel only when viewing the position currently being analyzed
    if (analysisFen === fenHistory[viewIndex]) {
      renderAnalysisPanel(analysisFen, analysisMvs);
    }
  }

  if (line.startsWith('bestmove')) {
    if (analysisFen) {
      analysisCache[analysisFen] = { mvs: analysisMvs.map(m => m ? { ...m, pv: [...m.pv] } : null) };
    }
    renderAnalysisForCurrentPos();
    renderEvalGraph();
    // Refinement pass: keep move glyphs/evals/variations current (not while hovering a preview)
    if (analysisPhase === 2 && !document.getElementById('moves-list').matches(':hover')) {
      computeMoveAccuracy();
      renderMoveHistory();
    }
    if (batchAnalyzing) {
      analysisQueuePos++;
      if (analysisQueuePos >= analysisQueue.length && analysisPhase === 1) {
        // Phase 1 done — compute accuracy, then start silent background refinement
        computeMoveAccuracy();
        renderMoveHistory();
        setStatus('Analysis ready — use ← → to review. Refining in background…');
        analysisPhase    = 2;
        analysisQueuePos = 0;
      }
      analyzeNextInQueue();
    }
  }
}

function parseAnalysisInfo(line) {
  const depthM = line.match(/\bdepth (\d+)/);
  const depth  = depthM ? parseInt(depthM[1]) : 0;
  if (depth < 8) return;

  const mpvM = line.match(/\bmultipv (\d+)/);
  const mpv  = mpvM ? parseInt(mpvM[1]) : 0;
  if (mpv < 1 || mpv > 10) return;

  let cp = null, mate = null;
  const mateM = line.match(/\bscore mate (-?\d+)/);
  const cpM   = line.match(/\bscore cp (-?\d+)/);
  if (mateM)    mate = parseInt(mateM[1]);
  else if (cpM) cp   = parseInt(cpM[1]);
  else return;

  const pvM = line.match(/\bpv (.+)/);
  const pv  = pvM ? pvM[1].trim().split(' ').filter(Boolean) : [];
  if (!pv.length) return;

  analysisMvs[mpv - 1] = { depth, cp, mate, pv };
}

function startBatchAnalysis() {
  if (!analysisMode) return;
  // Build queue: every unique FEN in the game history
  const seen = new Set();
  analysisQueue = [];
  fenHistory.forEach(fen => {
    if (!seen.has(fen)) { seen.add(fen); analysisQueue.push(fen); }
  });
  analysisQueuePos = 0;
  batchAnalyzing   = true;
  analysisPhase    = 1;
  analysisCache    = {};
  analysisMvs      = Array(10).fill(null);
  renderAnalysisPanelLoading();

  if (!analysisEngine) {
    initAnalysisEngine(); // analyzeNextInQueue called from readyok
    return;
  }
  if (!analysisEngineReady) return;
  analyzeNextInQueue();
}

function analyzeNextInQueue() {
  if (!batchAnalyzing) return;
  if (analysisQueuePos >= analysisQueue.length) {
    batchAnalyzing = false;
    setStatus('Analysis complete — navigate moves with ← → to review.');
    computeMoveAccuracy();
    renderMoveHistory();
    renderAnalysisForCurrentPos();
    return;
  }
  const fen   = analysisQueue[analysisQueuePos];
  const done  = analysisQueuePos + 1;
  const total = analysisQueue.length;
  analysisFen = fen;
  analysisMvs = [null, null, null];
  if (analysisPhase === 1) setStatus(`Analyzing position ${done} / ${total}…`);
  runAnalysis(fen);
}

function renderAnalysisForCurrentPos() {
  if (!analysisMode) return;
  const fen    = fenHistory[viewIndex];
  const cached = analysisCache[fen];
  if (cached && cached.mvs.some(Boolean)) {
    renderAnalysisPanel(fen, cached.mvs);
  } else {
    analysisArrows = [];
    renderAnnotations();
    if (batchAnalyzing) {
      const done  = analysisQueuePos;
      const total = analysisQueue.length;
      const linesEl = document.getElementById('analysis-lines');
      setCevalHeader('', `Analyzing ${done}/${total}`, 0);
      if (linesEl) linesEl.innerHTML = cevalShown && cevalLines > 0
        ? `<div class="analysis-loading">Analyzing… (${done}/${total})</div>` : '';
    } else {
      renderAnalysisPanelLoading();
    }
  }
  refreshCoach();
}

function runAnalysis(fen) {
  if (!analysisEngine) return;
  analysisEngine.postMessage('stop');
  analysisEngine.postMessage('position fen ' + fen);
  analysisEngine.postMessage(analysisPhase === 1 ? 'go movetime 250' : 'go movetime 2000');
}

function stopAnalysis() {
  if (analysisEngine) analysisEngine.postMessage('stop');
  batchAnalyzing = false;
  analysisPhase  = 1;
  analysisFen    = '';
  analysisMvs    = Array(10).fill(null);
  analysisCache  = {};
  analysisQueue  = [];
  analysisArrows = [];
  renderAnnotations();
}

function enterAnalysisMode() {
  analysisMode = true;
  // Make sure side panel is visible (it might not be if no game has been started)
  document.getElementById('side-panel').style.display     = 'flex';
  document.getElementById('main').style.justifyContent    = '';
  document.getElementById('eval-bar').style.display       = 'flex';
  document.getElementById('analysis-panel').style.display = 'flex';
  document.getElementById('eval-graph-wrap').style.display = 'block';
  document.getElementById('analysis-toggle-btn').classList.add('active');
  showCoachPanel(true);
  setStatus('Starting analysis…');
  // Defer first graph paint so browser can lay out the newly-shown canvas
  requestAnimationFrame(() => { renderEvalGraph(); renderGraphMoves(); });
  startBatchAnalysis();
}

function exitAnalysisMode() {
  analysisMode = false;
  moveAccuracy = [];
  stopAnalysis();
  showCoachPanel(false);
  document.getElementById('eval-bar').style.display        = 'none';
  document.getElementById('analysis-panel').style.display  = 'none';
  document.getElementById('eval-graph-wrap').style.display = 'none';
  document.getElementById('analysis-toggle-btn').classList.remove('active');
  document.getElementById('eval-fill').style.height        = '50%';
  document.getElementById('eval-text-top').textContent     = '';
  document.getElementById('eval-text-bot').textContent     = '';
  const canvas = document.getElementById('eval-graph');
  if (canvas) { const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height); }
  analysisArrows = [];
  renderAnnotations();
  const strip = document.getElementById('graph-moves-strip');
  if (strip) strip.innerHTML = '';
}

// Lichess-style winning chances: maps centipawns to [-1, 1] (white's perspective)
function winningChances(whiteCp) {
  const cp = Math.max(-1000, Math.min(1000, whiteCp));
  return 2 / (1 + Math.exp(-0.00368208 * cp)) - 1;
}

// Winning chances for a cached FEN (white's perspective), or null if not analyzed yet
function fenWinChances(fen) {
  const cp = fenWhiteCp(fen);
  return cp === null ? null : winningChances(cp);
}

// Lichess judgement thresholds (drop in winning chances on the [-1, 1] scale)
const GRAPH_JUDGEMENTS = [
  { min: 0.3, color: '#db3031' }, // blunder
  { min: 0.2, color: '#e69f00' }, // mistake
  { min: 0.1, color: '#56b4e9' }, // inaccuracy
];

function renderEvalGraph() {
  const wrap   = document.getElementById('eval-graph-wrap');
  const canvas = document.getElementById('eval-graph');
  if (!canvas || !wrap || wrap.style.display === 'none') return;

  const boardEl = document.getElementById('board');
  const W   = wrap.offsetWidth || (boardEl ? boardEl.offsetWidth : 0) || 300;
  const H   = 90;
  const dpr = window.devicePixelRatio || 1;
  // Render at device resolution so lines stay crisp on HiDPI screens
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = fenHistory.length;
  if (n === 0) return;

  const evals = fenHistory.map(fenWinChances);

  // Terminal positions: the engine returns nothing useful, so force the real result
  const tmp = new Chess(fenHistory[n - 1]);
  if (tmp.in_checkmate())  evals[n - 1] = tmp.turn() === 'w' ? -1 : 1;
  else if (tmp.game_over()) evals[n - 1] = 0;

  // Carry the previous value forward over not-yet-analyzed positions
  for (let i = 0; i < n; i++) if (evals[i] === null) evals[i] = i > 0 ? evals[i - 1] : 0;

  const pad = 3;
  const mid = H / 2;
  const xs  = evals.map((_, i) => n === 1 ? W / 2 : i * (W / (n - 1)));
  const ys  = evals.map(ev => mid - ev * (mid - pad));

  // Background
  ctx.fillStyle = '#262421';
  ctx.fillRect(0, 0, W, H);

  // Area between the line and the zero line: white above, black below (clipped halves)
  function tracePolyline() {
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < n; i++) ctx.lineTo(xs[i], ys[i]);
  }
  function fillArea(clipY, clipH, color) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, clipY, W, clipH);
    ctx.clip();
    ctx.beginPath();
    tracePolyline();
    ctx.lineTo(xs[n - 1], mid);
    ctx.lineTo(xs[0], mid);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }
  fillArea(0, mid, 'rgba(255,255,255,0.75)');
  fillArea(mid, H - mid, 'rgba(0,0,0,0.6)');

  // Zero line
  ctx.beginPath();
  ctx.moveTo(0, mid); ctx.lineTo(W, mid);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Eval line — straight segments, no smoothing
  ctx.beginPath();
  tracePolyline();
  ctx.strokeStyle = '#d85000';
  ctx.lineWidth   = 1.5;
  ctx.lineJoin    = 'miter';
  ctx.stroke();

  // Inaccuracy / mistake / blunder markers
  for (let i = 1; i < n; i++) {
    if (fenWinChances(fenHistory[i - 1]) === null) continue;
    const moverIsWhite = fenHistory[i - 1].split(' ')[1] === 'w';
    const drop = moverIsWhite ? evals[i - 1] - evals[i] : evals[i] - evals[i - 1];
    const j = GRAPH_JUDGEMENTS.find(g => drop >= g.min);
    if (!j) continue;
    ctx.beginPath();
    ctx.arc(xs[i], ys[i], 3, 0, Math.PI * 2);
    ctx.fillStyle = j.color;
    ctx.fill();
  }

  // Current position: thin vertical line + dot
  if (viewIndex >= 0 && viewIndex < n) {
    const cx = Math.round(xs[viewIndex]) + 0.5;
    ctx.beginPath();
    ctx.moveTo(cx, 0); ctx.lineTo(cx, H);
    ctx.strokeStyle = 'rgba(78,159,245,0.9)';
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(xs[viewIndex], ys[viewIndex], 3.5, 0, Math.PI * 2);
    ctx.fillStyle   = '#4e9ff5';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }
}

function renderGraphMoves() {
  const strip = document.getElementById('graph-moves-strip');
  if (!strip) return;
  strip.innerHTML = '';
  if (!analysisMode || moveList.length === 0) return;
  const lastMoveNum = Math.ceil(moveList.length / 2);
  const left  = document.createElement('span');
  left.className   = 'gm-edge-label';
  left.textContent = 'Move 1';
  const right = document.createElement('span');
  right.className   = 'gm-edge-label';
  right.textContent = 'Move ' + lastMoveNum;
  strip.appendChild(left);
  strip.appendChild(right);
}

// Click eval graph to navigate to that move
document.getElementById('eval-graph').addEventListener('click', e => {
  if (!analysisMode || fenHistory.length < 2) return;
  const rect = e.currentTarget.getBoundingClientRect();
  const frac = (e.clientX - rect.left) / rect.width;
  const idx  = Math.round(frac * (fenHistory.length - 1));
  setViewIndex(Math.max(0, Math.min(idx, fenHistory.length - 1)));
});

// Hover tooltip on eval graph
(function() {
  let tooltip = null;
  function getTooltip() {
    if (!tooltip) {
      tooltip = document.createElement('div');
      tooltip.id = 'graph-tooltip';
      document.getElementById('eval-graph-wrap').appendChild(tooltip);
    }
    return tooltip;
  }
  document.getElementById('eval-graph').addEventListener('mousemove', e => {
    if (!analysisMode || fenHistory.length < 2) return;
    const canvas = e.currentTarget;
    const rect   = canvas.getBoundingClientRect();
    const frac   = (e.clientX - rect.left) / rect.width;
    const idx    = Math.round(frac * (fenHistory.length - 1));
    const safeIdx = Math.max(0, Math.min(idx, fenHistory.length - 1));
    const cached = analysisCache[fenHistory[safeIdx]];
    if (!cached?.mvs?.[0]) return;
    const mv  = cached.mvs[0];
    const turn = fenHistory[safeIdx].split(' ')[1];
    const tt  = getTooltip();
    tt.textContent = formatScore(mv.cp, mv.mate, turn);
    tt.style.display = 'block';
    const xPx = e.clientX - rect.left;
    tt.style.left = Math.max(2, Math.min(rect.width - 48, xPx - 22)) + 'px';
  });
  document.getElementById('eval-graph').addEventListener('mouseleave', () => {
    if (tooltip) tooltip.style.display = 'none';
  });
})();

function uciToSan(uciMove, fen) {
  const temp   = new Chess(fen);
  const result = temp.move({ from: uciMove.slice(0, 2), to: uciMove.slice(2, 4), promotion: uciMove[4] || undefined });
  return result ? result.san : uciMove;
}


function formatScore(cp, mate, turn) {
  if (mate !== null) {
    // engine reports score from side-to-move perspective; convert to white's POV
    const whiteMate = turn === 'w' ? mate : -mate;
    return (whiteMate > 0 ? '+' : '') + 'M' + Math.abs(mate);
  }
  const whiteCp = turn === 'w' ? cp : -cp;
  return (whiteCp >= 0 ? '+' : '-') + (Math.abs(whiteCp) / 100).toFixed(1);
}

function updateEvalBar(cp, mate, turn) {
  const fill    = document.getElementById('eval-fill');
  const textTop = document.getElementById('eval-text-top');
  const textBot = document.getElementById('eval-text-bot');

  let whiteCp;
  if (mate !== null) {
    whiteCp = (turn === 'w' ? mate : -mate) > 0 ? 10000 : -10000;
  } else {
    whiteCp = turn === 'w' ? cp : -cp;
  }

  // Smooth sigmoid: 50% = equal
  const pct = Math.max(2, Math.min(98, 50 + 50 * Math.tanh(whiteCp / 300)));
  fill.style.height = pct + '%';

  let label = '';
  if (mate !== null) {
    label = 'M' + Math.abs(mate);
  } else {
    const abs = Math.abs(whiteCp);
    if (abs >= 10) label = (abs / 100).toFixed(1);
  }

  if (whiteCp >= 0) {
    textTop.textContent = '';
    textBot.textContent = label;
  } else {
    textTop.textContent = label;
    textBot.textContent = '';
  }
}

// ===== Engine lines panel (Lichess "ceval" box) =====

const CEVAL_TARGET_DEPTH = 22; // progress bar is full at this depth

function loadCevalSetting(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function saveCevalSetting(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

let cevalShown  = loadCevalSetting('bca_ceval_on', true);
let cevalLines  = loadCevalSetting('bca_ceval_lines', 3);   // 0–5, like Lichess
let cevalArrows = loadCevalSetting('bca_ceval_arrows', true);
let cevalHoverUci = null; // first move of the PV row under the mouse

// Lichess score format, white's perspective: +0.3, -1.2, #3, #-3
function cevalScore(cp, mate, turn) {
  if (mate !== null) return '#' + (turn === 'w' ? mate : -mate);
  const whiteCp = turn === 'w' ? cp : -cp;
  return (whiteCp > 0 ? '+' : '') + (whiteCp / 100).toFixed(1);
}

function setCevalHeader(pearl, depthText, depth) {
  document.getElementById('ceval-pearl').textContent  = pearl;
  document.getElementById('analysis-depth').textContent = depthText;
  const fill = document.getElementById('ceval-progress-fill');
  if (fill) fill.style.width = Math.min(100, (depth || 0) / CEVAL_TARGET_DEPTH * 100) + '%';
}

function renderAnalysisPanelLoading() {
  const linesEl = document.getElementById('analysis-lines');
  if (!linesEl) return;
  setCevalHeader('', 'Loading…', 0);
  linesEl.innerHTML = cevalShown && cevalLines > 0 ? '<div class="analysis-loading">Analyzing…</div>' : '';
}

// Build PV tokens: [{type:'num',text:'15.'}, {type:'mv',san:'Nf3',color:'w',fen,uci}, ...]
function buildPvTokens(fen, uciMoves) {
  const temp = new Chess(fen);
  let moveNum = parseInt(fen.split(' ')[5]);
  let isWhite = fen.split(' ')[1] === 'w';
  const tokens = [];
  let firstMove = true;
  for (const uci of uciMoves) {
    const r = temp.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    if (!r) break;
    if (isWhite) {
      tokens.push({ type: 'num', text: moveNum + '.' });
    } else if (firstMove) {
      tokens.push({ type: 'num', text: moveNum + '...' });
    }
    tokens.push({ type: 'mv', san: r.san, color: isWhite ? 'w' : 'b', fen: temp.fen(), uci });
    firstMove = false;
    if (!isWhite) moveNum++;
    isWhite = !isWhite;
  }
  return tokens;
}

// Engine arrows, Lichess-style: best line pale blue, close alternatives pale grey,
// thinner the worse they are. Hovering a row shows only that row's move.
function updateCevalArrows(fen, mvs) {
  analysisArrows = [];
  if (cevalShown && cevalArrows && cevalLines > 0 && mvs.length) {
    const arrow = (uci, color, opacity, width) =>
      ({ from: uci.slice(0, 2), to: uci.slice(2, 4), color, opacity, width });
    if (cevalHoverUci) {
      analysisArrows.push(arrow(cevalHoverUci, '#003088', 0.4, 15 / 64));
    } else {
      const povWc = mv => {
        const cp = mv.mate !== null ? (mv.mate > 0 ? 10000 : -10000) : mv.cp;
        return winningChances(cp); // side-to-move perspective
      };
      const best = povWc(mvs[0]);
      mvs.slice(1, cevalLines).forEach(mv => {
        const shift = best - povWc(mv);
        if (shift < 0.2 && mv.pv[0] !== mvs[0].pv[0]) {
          analysisArrows.push(arrow(mv.pv[0], '#4a4a4a', 0.35, Math.max(2, Math.round(12 - shift * 50)) / 64));
        }
      });
      analysisArrows.unshift(arrow(mvs[0].pv[0], '#003088', 0.4, 15 / 64));
    }
  }
  renderAnnotations();
}

function renderAnalysisPanel(fen, mvs) {
  const linesEl = document.getElementById('analysis-lines');
  if (!linesEl) return;

  const validMvs = (mvs || []).filter(Boolean);
  const turn     = fen.split(' ')[1];

  if (!validMvs.length) {
    setCevalHeader('', 'Loading…', 0);
    linesEl.innerHTML = cevalShown && cevalLines > 0 ? '<div class="analysis-loading">Analyzing…</div>' : '';
    return;
  }

  const best     = validMvs[0];
  const maxDepth = Math.max(...validMvs.map(m => m.depth));
  updateEvalBar(best.cp, best.mate, turn);
  setCevalHeader(
    cevalShown ? cevalScore(best.cp, best.mate, turn) : '',
    cevalShown ? 'Depth ' + maxDepth : 'Off',
    cevalShown ? maxDepth : 0
  );

  linesEl.innerHTML = '';
  if (cevalShown) {
    validMvs.slice(0, cevalLines).forEach(mv => {
      const row = document.createElement('div');
      row.className = 'pv-row';

      const score = document.createElement('strong');
      score.className   = 'pv-score';
      score.textContent = cevalScore(mv.cp, mv.mate, turn);
      row.appendChild(score);

      const movesEl = document.createElement('span');
      movesEl.className = 'pv-moves';
      buildPvTokens(fen, mv.pv).forEach(t => {
        const s = document.createElement('span');
        if (t.type === 'num') {
          s.className   = 'pv-num';
          s.textContent = t.text;
        } else {
          s.className   = 'pv-san';
          s.textContent = t.san;
          s.dataset.fen = t.fen;
          s.dataset.uci = t.uci;
        }
        movesEl.appendChild(s);
      });
      row.appendChild(movesEl);

      row.addEventListener('mouseenter', () => {
        cevalHoverUci = mv.pv[0];
        updateCevalArrows(fen, validMvs);
      });
      row.addEventListener('mouseleave', () => {
        cevalHoverUci = null;
        hidePvBoard();
        updateCevalArrows(fen, validMvs);
      });
      movesEl.addEventListener('mouseover', e => {
        const san = e.target.closest('.pv-san');
        if (san) showPvBoard(san.dataset.fen, san.dataset.uci, row);
      });

      linesEl.appendChild(row);
    });
  }
  updateCevalArrows(fen, validMvs);

  // Accuracy summary (shown after analysis completes)
  if (moveAccuracy.length && !batchAnalyzing) {
    const summaryEl = renderAccuracySummary();
    if (summaryEl) linesEl.appendChild(summaryEl);
  }
}

// Mini board shown while hovering a move in a PV line
function showPvBoard(fen, uci, rowEl) {
  const el = document.getElementById('pv-board-preview');
  if (!el || !fen) return;
  if (el.parentElement !== document.body) document.body.appendChild(el); // escape transformed ancestors
  const board   = new Chess(fen).board(); // board[0] = rank 8
  const flipped = (playerColor === 'b') !== manualFlip;
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  el.innerHTML = '';
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const rank = flipped ? r : 7 - r;
      const file = flipped ? 7 - c : c;
      const sq   = String.fromCharCode(97 + file) + (rank + 1);
      const cell = document.createElement('div');
      const light = (file + rank) % 2 === 1;
      cell.className = 'pvb-sq ' + (light ? 'pvb-light' : 'pvb-dark') + (sq === from || sq === to ? ' pvb-last' : '');
      const piece = board[7 - rank][file];
      if (piece) {
        const img = document.createElement('img');
        img.src = PIECE_SVG(piece.color + piece.type.toUpperCase());
        img.draggable = false;
        cell.appendChild(img);
      }
      el.appendChild(cell);
    }
  }
  // Fixed positioning so the panel's scroll area doesn't clip it; flip above the row near the bottom
  const rect = rowEl.getBoundingClientRect();
  const h    = 176;
  const top  = rect.bottom + h > window.innerHeight ? rect.top - h : rect.bottom;
  el.style.top  = Math.max(0, top) + 'px';
  el.style.left = (rect.left + 52) + 'px';
  el.style.display = 'grid';
}

function hidePvBoard() {
  const el = document.getElementById('pv-board-preview');
  if (el) el.style.display = 'none';
}

function initCevalControls() {
  const toggle   = document.getElementById('ceval-toggle');
  const settings = document.getElementById('ceval-modal');
  const multipv  = document.getElementById('ceval-multipv');
  const mpvValue = document.getElementById('ceval-multipv-value');
  const arrows   = document.getElementById('ceval-arrows');

  toggle.checked = cevalShown;
  multipv.value  = cevalLines;
  mpvValue.textContent = cevalLines + ' / 5';
  arrows.checked = cevalArrows;

  toggle.addEventListener('change', () => {
    cevalShown = toggle.checked;
    saveCevalSetting('bca_ceval_on', cevalShown);
    renderAnalysisForCurrentPos();
  });
  document.getElementById('ceval-settings-btn').addEventListener('click', () => {
    settings.style.display = 'flex';
  });
  document.getElementById('ceval-close').addEventListener('click', () => { settings.style.display = 'none'; });
  settings.addEventListener('click', e => { if (e.target === settings) settings.style.display = 'none'; });
  multipv.addEventListener('input', () => {
    cevalLines = parseInt(multipv.value);
    mpvValue.textContent = cevalLines + ' / 5';
    saveCevalSetting('bca_ceval_lines', cevalLines);
    renderAnalysisForCurrentPos();
  });
  arrows.addEventListener('change', () => {
    cevalArrows = arrows.checked;
    saveCevalSetting('bca_ceval_arrows', cevalArrows);
    renderAnalysisForCurrentPos();
  });
}

function renderAccuracySummary() {
  if (!moveAccuracy.length) return null;

  // Separate white and black moves
  const wAcc = moveAccuracy.filter((_, i) => i % 2 === 0).filter(Boolean);
  const bAcc = moveAccuracy.filter((_, i) => i % 2 === 1).filter(Boolean);
  if (!wAcc.length && !bAcc.length) return null;

  const keys = ['best', 'excellent', 'good', 'inaccuracy', 'mistake', 'blunder'];

  function countByKey(accArr) {
    const c = {};
    for (const k of keys) c[k] = 0;
    for (const a of accArr) if (a) c[a.key] = (c[a.key] || 0) + 1;
    return c;
  }

  const wCounts = countByKey(wAcc);
  const bCounts = countByKey(bAcc);

  // Who is the player? (white = playerColor === 'w')
  const playerIsWhite = playerColor === 'w';
  const youCounts = playerIsWhite ? wCounts : bCounts;
  const opCounts  = playerIsWhite ? bCounts : wCounts;

  const wrap = document.createElement('div');
  wrap.className = 'accuracy-summary';

  const LABELS = Object.fromEntries(ACCURACY_CLASSES.map(c => [c.key, c.label]));
  const COLORS = Object.fromEntries(ACCURACY_CLASSES.map(c => [c.key, c.color]));

  function buildCol(title, counts, isPlayer) {
    const col = document.createElement('div');
    col.className = 'accuracy-col';
    const hdr = document.createElement('div');
    hdr.className = 'accuracy-col-title';
    hdr.textContent = title;
    col.appendChild(hdr);
    for (const k of keys) {
      if (!counts[k]) continue;
      const row = document.createElement('div');
      row.className = 'accuracy-row';
      const sym = document.createElement('span');
      sym.className = 'accuracy-sym';
      sym.style.color = COLORS[k];
      const cls = ACCURACY_CLASSES.find(c => c.key === k);
      sym.textContent = cls ? cls.symbol : k;
      const lbl = document.createElement('span');
      lbl.className = 'accuracy-lbl';
      lbl.textContent = LABELS[k];
      const cnt = document.createElement('span');
      cnt.className = 'accuracy-cnt';
      cnt.textContent = counts[k];
      row.appendChild(sym);
      row.appendChild(lbl);
      row.appendChild(cnt);
      col.appendChild(row);
    }
    return col;
  }

  const title = document.createElement('div');
  title.className = 'accuracy-title';
  title.textContent = 'Move Accuracy';
  wrap.appendChild(title);

  const cols = document.createElement('div');
  cols.className = 'accuracy-cols';
  cols.appendChild(buildCol(reviewNames ? reviewNames.you : 'You', youCounts, true));
  cols.appendChild(buildCol(reviewNames ? reviewNames.opponent : 'Engine', opCounts, false));
  wrap.appendChild(cols);

  return wrap;
}

// ===== Coach =====
// Explains the move that led to the current position, chess.com "Game Review" style.
// Facts come from the engine lines + chess.js (always available); if a Groq key is saved,
// an LLM rewrites those facts into a friendlier explanation, restricted to the same moves.

const COACH_MODELS = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'];
const PIECE_VALUE  = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_WORD   = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SIDE_NAME    = { w: 'White', b: 'Black' };

const coachLlmCache = {};   // fact key → explanation text
let coachLlmTimer   = null;
let coachShownKey   = '';   // what the panel currently shows (avoids needless re-renders)
let coachSpeechText = '';

function materialBalance(c) { // white minus black
  let sum = 0;
  for (const row of c.board()) for (const p of row) {
    if (p) sum += (p.color === 'w' ? 1 : -1) * PIECE_VALUE[p.type];
  }
  return sum;
}

function applyUci(c, uci) {
  return c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || 'q' });
}

// Plays a line and reports the material won by the side to move at `fen`.
// Stops once an exchange has finished (back to the same side, last move not a capture).
function lineOutcome(fen, uciLine, maxPlies = 8) {
  const c     = new Chess(fen);
  const pov   = fen.split(' ')[1] === 'w' ? 1 : -1;
  const start = materialBalance(c);
  const moves = [];
  for (const uci of uciLine.slice(0, maxPlies)) {
    const r = applyUci(c, uci);
    if (!r) break;
    moves.push(r);
    if (moves.length >= 2 && moves.length % 2 === 0 && !r.captured) break;
  }
  return { gain: (materialBalance(c) - start) * pov, moves };
}

function materialWord(n, capturedType) {
  if (capturedType && PIECE_VALUE[capturedType] >= 3 && n >= PIECE_VALUE[capturedType] - 0.5) {
    return 'the ' + PIECE_WORD[capturedType];
  }
  if (n >= 8) return "a queen's worth of material";
  if (n >= 5) return "a rook's worth of material";
  if (n >= 3) return 'a piece';
  if (n >= 2) return 'two pawns';
  return 'a pawn';
}

function evalPhrase(whiteCp) {
  if (Math.abs(whiteCp) >= 9000) return whiteCp > 0 ? 'White is winning' : 'Black is winning';
  const wc   = winningChances(whiteCp);
  const side = wc > 0 ? 'White' : 'Black';
  const a    = Math.abs(wc);
  const num  = (whiteCp > 0 ? '+' : '') + (whiteCp / 100).toFixed(1);
  if (a < 0.1)  return `the position is roughly equal (${num})`;
  if (a < 0.25) return `${side} is slightly better (${num})`;
  if (a < 0.5)  return `${side} is clearly better (${num})`;
  return `${side} is winning (${num})`;
}

// What does a move do? Short verb phrases, e.g. "develops the knight", "attacks the queen on d8".
function moveIdeas(preFen, r, plyIndex) {
  const ideas = [];
  const san   = r.san;
  const early = plyIndex < 24;

  if (san.startsWith('O-O')) ideas.push('castles, tucking the king away and connecting the rooks');
  if (r.promotion) ideas.push(`promotes to a ${PIECE_WORD[r.promotion]}`);
  if (r.captured) {
    const prev = plyIndex > 0 ? moveFromTo[plyIndex - 1] : null;
    const recapture = prev && prev.to === r.to && plyIndex > 0 && moveList[plyIndex - 1]?.includes('x');
    ideas.push(recapture ? `recaptures on ${r.to}` : `captures the ${PIECE_WORD[r.captured]} on ${r.to}`);
  }
  if (san.includes('#')) ideas.push('delivers checkmate');
  else if (san.includes('+')) ideas.push('gives check');

  const backRank = r.color === 'w' ? '1' : '8';
  if (early && (r.piece === 'n' || r.piece === 'b') && r.from[1] === backRank) {
    ideas.push(`develops the ${PIECE_WORD[r.piece]}`);
  }
  if (early && r.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(r.to) && !r.captured) {
    ideas.push('fights for the center');
  }

  // Threats: what could the moved piece capture next if the opponent did nothing?
  if (!san.includes('+') && !san.includes('#')) {
    const parts = new Chess(preFen);
    parts.move(san);
    const f = parts.fen().split(' ');
    f[1] = f[1] === 'w' ? 'b' : 'w';
    f[3] = '-';
    const nullPos = new Chess();
    if (nullPos.load(f.join(' '))) {
      const targets = [];
      for (const m of nullPos.moves({ verbose: true })) {
        if (m.from !== r.to || !m.captured || m.captured === 'k') continue;
        const after = new Chess(nullPos.fen());
        after.move(m);
        const defended = after.moves({ verbose: true }).some(x => x.to === m.to);
        if (!defended || PIECE_VALUE[m.captured] > PIECE_VALUE[r.piece]) targets.push({ m, defended });
      }
      // Biggest targets first; only real pieces make a fork
      targets.sort((a, b) => PIECE_VALUE[b.m.captured] - PIECE_VALUE[a.m.captured]);
      const big = targets.filter(t => PIECE_VALUE[t.m.captured] >= 3);
      const describe = t => `${t.defended ? '' : 'undefended '}${PIECE_WORD[t.m.captured]} on ${t.m.to}`;
      if (big.length >= 2) {
        ideas.push(`forks the ${PIECE_WORD[big[0].m.captured]} and the ${PIECE_WORD[big[1].m.captured]}`);
      } else if (targets.length >= 2) {
        ideas.push(`attacks the ${describe(targets[0])} and the ${describe(targets[1])}`);
      } else if (targets.length === 1) {
        const t = targets[0];
        ideas.push(t.defended ? `attacks the ${describe(t)}` : `threatens the ${describe(t)}`);
      }
    }
  }
  return ideas;
}

function joinIdeas(ideas) {
  if (ideas.length <= 1) return ideas[0] || '';
  return ideas.slice(0, -1).join(', ') + ' and ' + ideas[ideas.length - 1];
}

// Gathers everything the coach knows about ply i. Returns null while the engine is still working.
function buildCoachFacts(i) {
  const preFen  = fenHistory[i];
  const postFen = fenHistory[i + 1];
  const pre     = (analysisCache[preFen]?.mvs || []).filter(Boolean);
  const post    = (analysisCache[postFen]?.mvs || []).filter(Boolean);
  const judged  = judgeMove(i);
  if (!judged || !pre.length) return null;

  const mover    = preFen.split(' ')[1];
  const opp      = mover === 'w' ? 'b' : 'w';
  const tmp      = new Chess(preFen);
  const played   = tmp.move(moveList[i]);
  if (!played) return null;
  const terminal = tmp.game_over();

  const facts = {
    ply: i,
    moveNo: Math.floor(i / 2) + 1,
    mover, opp,
    san: played.san,
    judgement: judged,
    ideas: moveIdeas(preFen, played, i),
    evalAfter: positionWhiteCp(postFen),
    preFen, postFen,
  };

  // Opening name, when this move completes a known line
  if (i < 20) {
    const name = getCurrentOpening(moveList.slice(0, i + 1));
    if (name && name !== getCurrentOpening(moveList.slice(0, i))) facts.opening = name;
  }

  // Engine's preferred move and what it achieves
  const best = pre[0];
  const bestRes = new Chess(preFen).move({ from: best.pv[0].slice(0, 2), to: best.pv[0].slice(2, 4), promotion: best.pv[0][4] || 'q' });
  if (bestRes && judged.key !== 'best') {
    const bestLine = lineOutcome(preFen, best.pv);
    const playedLine = lineOutcome(preFen, [played.from + played.to + (played.promotion || ''), ...(post[0]?.pv || [])]);
    facts.best = {
      san: bestRes.san,
      uci: best.pv[0],
      fenAfter: (() => { const c = new Chess(preFen); applyUci(c, best.pv[0]); return c.fen(); })(),
      mate: best.mate !== null && best.mate > 0 ? best.mate : null,
      gain: bestLine.gain,
      gainVsPlayed: bestLine.gain - playedLine.gain,
      capturedType: bestLine.moves.find(m => m.color === mover && m.captured)?.captured || null,
      ideas: moveIdeas(preFen, bestRes, i),
      line: bestLine.moves.slice(0, 4).map(m => m.san),
    };
  }

  // Opponent's best reply — the threat this move allowed (or ran into)
  if (!terminal && post.length) {
    const reply = post[0];
    const c = new Chess(postFen);
    const r = applyUci(c, reply.pv[0]);
    if (r) {
      const outcome = lineOutcome(postFen, reply.pv);
      facts.reply = {
        san: r.san,
        uci: reply.pv[0],
        fenAfter: c.fen(),
        mate: reply.mate !== null && reply.mate > 0 ? reply.mate : null,
        gain: outcome.gain,
        capturedType: outcome.moves.find(m => m.color === opp && m.captured)?.captured || null,
        line: outcome.moves.slice(0, 4).map(m => m.san),
      };
    }
  }

  // Missed mate: the mover had a forced mate and this move doesn't keep it
  if (best.mate !== null && best.mate > 0 && judged.key !== 'best') facts.missedMate = best.mate;
  return facts;
}

const VERDICT_PHRASE = {
  best: 'the best move', excellent: 'an excellent move', good: 'a good move',
  inaccuracy: 'an inaccuracy', mistake: 'a mistake', blunder: 'a blunder',
};

// Plain-language explanation built only from the facts
function coachRuleText(f) {
  const sideMover = SIDE_NAME[f.mover], sideOpp = SIDE_NAME[f.opp];
  const key = f.judgement.key;
  const bad = key === 'inaccuracy' || key === 'mistake' || key === 'blunder';
  const out = [];

  if (f.opening) out.push(`This is the ${f.opening}.`);
  if (f.ideas.length) out.push(`${f.san} ${joinIdeas(f.ideas)}.`);

  if (f.san.includes('#')) {
    out.push(`Checkmate — ${sideMover} wins.`);
    return out.join(' ');
  }

  if (bad && f.reply) {
    const r = f.reply;
    if (r.mate) {
      out.push(`But it allows ${r.san}, and ${sideOpp} has a forced mate in ${r.mate}.`);
    } else if (r.gain >= 1) {
      out.push(`The problem is ${r.san}${r.line.length > 1 ? ` (${r.line.join(' ')})` : ''}, and ${sideOpp} wins ${materialWord(r.gain, r.capturedType)}.`);
    } else {
      out.push(`After ${r.san}, ${sideOpp} takes over the initiative.`);
    }
  }

  if (f.missedMate) {
    out.push(`${sideMover} missed a forced mate in ${f.missedMate} starting with ${f.best.san}.`);
  } else if (f.best) {
    const b = f.best;
    let why = '';
    if (b.gainVsPlayed >= 1 && b.gain >= 1) why = `, winning ${materialWord(b.gain, b.capturedType)}`;
    else if (b.ideas.length) why = `, which ${joinIdeas(b.ideas)}`;
    if (bad) out.push(`Better was ${b.san}${why}.`);
    else if (key !== 'best') out.push(`${b.san} was slightly more precise${why}.`);
  } else if (key === 'best') {
    out.push(`This is the engine's top choice.`);
    if (!bad && f.reply && f.reply.gain >= 1) {
      out.push(`${sideOpp} can't avoid losing material after ${f.reply.san}.`);
    }
  }

  out.push(`Now ${evalPhrase(f.evalAfter)}.`);
  return out.join(' ');
}

// ── LLM explanation (optional) ──

function coachFactKey(f) {
  return [f.preFen, f.san, f.judgement.key, f.best?.san, f.reply?.san].join('|');
}

async function fetchCoachExplanation(f, ruleText) {
  const sideMover = SIDE_NAME[f.mover];
  const facts = {
    move: `${f.moveNo}${f.mover === 'w' ? '.' : '...'} ${f.san} (played by ${sideMover})`,
    verdict: f.judgement.label,
    what_the_move_does: f.ideas,
    opening: f.opening || null,
    opponent_best_reply: f.reply ? { move: f.reply.san, line: f.reply.line, mate_in: f.reply.mate, material_won_by_opponent: f.reply.gain } : null,
    engine_best_move: f.best ? { move: f.best.san, line: f.best.line, mate_in: f.best.mate, what_it_does: f.best.ideas, material_won: f.best.gain } : null,
    missed_mate_in: f.missedMate || null,
    evaluation_after: evalPhrase(f.evalAfter),
    position_fen_before: f.preFen,
  };
  const system = `You are a friendly, encouraging chess coach reviewing a game, like the coach on chess.com Game Review.
Explain in 2-4 short sentences, plain English, no markdown:
1. what the played move was trying to do,
2. why it is ${f.judgement.label.toLowerCase()} (the concrete threat or idea, using the opponent's best reply if relevant),
3. if there was a better move, what it does and why it is better.
STRICT RULES: only mention moves that appear in the facts (in SAN exactly as given). Never invent moves, pieces or squares. Do not mention engines, evaluations numbers or centipawns.`;
  const user = `Facts (JSON):\n${JSON.stringify(facts)}\n\nA plain draft you can improve on:\n${ruleText}`;

  for (const model of COACH_MODELS) {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${getApiKey()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.4,
        max_tokens: 220,
      }),
    });
    if (resp.ok) return (await resp.json()).choices[0].message.content.trim();
    if (resp.status === 401) throw new Error('401');
    // Model retired or unavailable → try the next one
    if (resp.status !== 400 && resp.status !== 404) {
      const e = await resp.json().catch(() => ({}));
      throw new Error(`${resp.status} ${e.error?.message || ''}`);
    }
  }
  throw new Error('no available model');
}

function scheduleCoachLlm(f, ruleText) {
  clearTimeout(coachLlmTimer);
  const key = coachFactKey(f);
  if (coachLlmCache[key] || !getApiKey()) return;
  setCoachSource('thinking');
  coachLlmTimer = setTimeout(async () => {
    try {
      coachLlmCache[key] = await fetchCoachExplanation(f, ruleText);
      if (coachShownKey.startsWith(key)) refreshCoach(true);
    } catch (err) {
      if (!coachShownKey.startsWith(key)) return;
      setCoachSource(err.message === '401' ? 'badkey' : 'error');
    }
  }, 600); // debounce while stepping quickly through moves
}

// ── Panel rendering ──

function setCoachSource(state) {
  const el = document.getElementById('coach-source');
  if (!el) return;
  el.innerHTML = '';
  if (state === 'ai')            el.textContent = 'Explained by AI from the engine lines';
  else if (state === 'thinking') el.textContent = 'Coach is thinking…';
  else if (state === 'error')    el.textContent = 'AI explanation unavailable — showing engine summary';
  else if (state === 'badkey' || state === 'nokey') {
    const link = document.createElement('button');
    link.className = 'coach-link';
    link.textContent = state === 'badkey' ? 'Groq key rejected — update it' : 'Add a free Groq key for AI explanations';
    link.addEventListener('click', showKeySetup);
    el.appendChild(link);
  } else el.textContent = 'Engine summary';
}

function coachChip(label, san, fen, uci, arrowColor) {
  const chip = document.createElement('span');
  chip.className = 'coach-chip';
  chip.innerHTML = `<span class="coach-chip-label">${label}</span>`;
  const mv = document.createElement('span');
  mv.className = 'coach-chip-move';
  mv.textContent = san;
  chip.appendChild(mv);
  chip.addEventListener('mouseenter', () => {
    showPvBoard(fen, uci, chip);
    if (arrowColor) {
      coachArrow = { from: uci.slice(0, 2), to: uci.slice(2, 4), color: arrowColor, opacity: 0.8, width: 12 / 64 };
      renderAnnotations();
    }
  });
  chip.addEventListener('mouseleave', () => {
    hidePvBoard();
    if (coachArrow) { coachArrow = null; renderAnnotations(); }
  });
  return chip;
}

let coachArrow = null; // threat arrow shown while hovering the coach's "Threat" chip

function refreshCoach(force = false) {
  const panel = document.getElementById('coach-panel');
  if (!panel || !analysisMode) return;
  const verdictEl = document.getElementById('coach-verdict');
  const textEl    = document.getElementById('coach-text');
  const chipsEl   = document.getElementById('coach-lines');
  const i = viewIndex - 1;

  if (i < 0) {
    if (coachShownKey === 'start') return;
    coachShownKey = 'start';
    verdictEl.innerHTML = '';
    textEl.textContent = moveList.length
      ? 'Step through the game with → and I will explain every move: what it does, what it allows, and what was better.'
      : 'Play or import a game and I will review it with you.';
    chipsEl.innerHTML = '';
    coachSpeechText = textEl.textContent;
    setCoachSource(getApiKey() ? 'engine' : 'nokey');
    return;
  }

  const f = buildCoachFacts(i);
  if (!f) {
    if (coachShownKey === 'wait' + i) return;
    coachShownKey = 'wait' + i;
    verdictEl.innerHTML = '';
    textEl.textContent = 'Waiting for the engine to analyse this move…';
    chipsEl.innerHTML = '';
    coachSpeechText = '';
    return;
  }

  const key      = coachFactKey(f);
  const ruleText = coachRuleText(f);
  const llmText  = coachLlmCache[key];
  const showKey  = key + '|' + (llmText ? 'ai' : ruleText);
  if (!force && showKey === coachShownKey) return;
  coachShownKey = showKey;

  const j = f.judgement;
  verdictEl.innerHTML = '';
  const badge = document.createElement('span');
  badge.className = 'coach-badge';
  badge.style.background = j.color;
  badge.textContent = j.symbol || '✓';
  const title = document.createElement('span');
  title.className = 'coach-verdict-text';
  title.textContent = `${f.moveNo}${f.mover === 'w' ? '.' : '...'} ${f.san} is ${VERDICT_PHRASE[j.key]}`;
  verdictEl.append(badge, title);

  textEl.textContent = llmText || ruleText;
  coachSpeechText = `${title.textContent}. ${textEl.textContent}`;

  chipsEl.innerHTML = '';
  if (f.best) chipsEl.appendChild(coachChip('Best', f.best.san, f.best.fenAfter, f.best.uci, null));
  if (f.reply && j.key !== 'best') chipsEl.appendChild(coachChip('Threat', f.reply.san, f.reply.fenAfter, f.reply.uci, '#882020'));

  if (llmText) setCoachSource('ai');
  else if (!getApiKey()) setCoachSource('nokey');
  else { setCoachSource('engine'); scheduleCoachLlm(f, ruleText); }
}

function showCoachPanel(show) {
  const panel = document.getElementById('coach-panel');
  if (!panel) return;
  panel.style.display = show ? 'flex' : 'none';
  coachShownKey = '';
  coachArrow = null;
  if (show) refreshCoach();
}

// Turns SAN inside prose into words for the speech engine: "12... Nxe5+" → "12, knight takes E 5, check"
function speakableChess(text) {
  return text
    .replace(/\b(\d+)\.(\.\.)?\s(?=O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8])/g, '$1, ')
    .replace(/\b(O-O-O|O-O|[KQRBN]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?)(?=[\s,.;:!?)]|$)/g,
      san => /^[a-h][1-8]$/.test(san) && !/[x+#=]/.test(san) ? san[0].toUpperCase() + ' ' + san[1] : sanToSpeech(san));
}

document.getElementById('coach-speak-btn').addEventListener('click', () => {
  if (ttsBusy()) { stopSpeaking(); return; }
  if (coachSpeechText) speak(speakableChess(coachSpeechText), { force: true, rate: 1 });
});

// ===== Game setup =====

// ===== Setup UI visibility =====

function showNewGameModal() {
  document.getElementById('newgame-modal').style.display = 'flex';
}

function hideNewGameModal() {
  document.getElementById('newgame-modal').style.display = 'none';
}

function hideSetupForGame() {
  hideHomeScreen();
  document.getElementById('side-panel').style.display  = 'flex';
  document.getElementById('main').style.justifyContent = '';
  document.getElementById('resign-btn').classList.add('visible');
  document.getElementById('top-new-game-btn').classList.add('in-game');
  document.getElementById('player-box').classList.add('player-box-hidden');
  document.getElementById('opponent-box').classList.add('player-box-hidden');
}

function restoreSetupUI() {
  document.getElementById('side-panel').style.display  = 'flex';
  document.getElementById('main').style.justifyContent = '';
  document.getElementById('resign-btn').classList.remove('visible');
  document.getElementById('top-new-game-btn').classList.remove('in-game');
  showHomeScreen();
}

function showHomeScreen() {
  document.getElementById('player-box').classList.remove('player-box-hidden');
  document.getElementById('opponent-box').classList.remove('player-box-hidden');
  // Hide game-only UI
  document.getElementById('status').style.display          = 'none';
  document.getElementById('move-history').style.display    = 'none';
  document.getElementById('nav-controls').style.display    = 'none';
  document.getElementById('analysis-panel').style.display  = 'none';
  showCoachPanel(false);
  document.getElementById('eval-bar').style.display        = 'none';
  document.getElementById('eval-graph-wrap').style.display = 'none';
  document.getElementById('analysis-toggle-btn').classList.remove('active');
  // Show home panel
  document.getElementById('home-panel').style.display = 'flex';
  const eloEl = document.getElementById('home-elo-value');
  if (eloEl) eloEl.textContent = loadElo();
  renderHomeArchive();
}

function hideHomeScreen() {
  document.getElementById('home-panel').style.display   = 'none';
  document.getElementById('status').style.display       = '';
  document.getElementById('move-history').style.display = '';
  document.getElementById('nav-controls').style.display = '';
}

function renderHomeArchive() {
  const list = document.getElementById('home-games-list');

  function renderPage() {
    list.innerHTML = '';
    const archive = homeArchiveCache;
    if (!archive.length) {
      list.innerHTML = '<div class="home-archive-empty">No games yet — start your first game!</div>';
      return;
    }

    const PAGE = 10;
    const totalPages = Math.ceil(archive.length / PAGE);
    const start = homeArchivePage * PAGE;
    const page  = archive.slice(start, start + PAGE);

    const iconMap  = { win: 'emoji_events', lose: 'trending_down', draw: 'handshake' };
    const colorMap = { win: '#ffd600', lose: '#e65100', draw: 'var(--text-lo)' };

    page.forEach(entry => {
      const item = document.createElement('div');
      item.className = 'home-archive-item';
      item.innerHTML =
        `<span class="material-symbols-outlined archive-result-icon" style="color:${colorMap[entry.result]}">${iconMap[entry.result]}</span>` +
        `<span class="archive-info">` +
          `<span class="archive-date">${entry.date}</span>` +
          `<span class="archive-detail">${entry.difficulty} · ${Math.ceil(entry.moveCount / 2)} moves · ${entry.reason}</span>` +
        `</span>`;
      item.addEventListener('click', () => {
        if (loadPGN(entry.pgn)) setViewIndex(0);
      });
      list.appendChild(item);
    });

    if (totalPages > 1) {
      const pag = document.createElement('div');
      pag.className = 'home-pagination';
      pag.innerHTML =
        `<button class="home-pag-btn" id="home-pag-prev" ${homeArchivePage === 0 ? 'disabled' : ''}>` +
          `<span class="material-symbols-outlined">chevron_left</span>` +
        `</button>` +
        `<span class="home-pag-label">${homeArchivePage + 1} / ${totalPages}</span>` +
        `<button class="home-pag-btn" id="home-pag-next" ${homeArchivePage >= totalPages - 1 ? 'disabled' : ''}>` +
          `<span class="material-symbols-outlined">chevron_right</span>` +
        `</button>`;
      pag.querySelector('#home-pag-prev').addEventListener('click', () => {
        homeArchivePage--;
        renderPage();
      });
      pag.querySelector('#home-pag-next').addEventListener('click', () => {
        homeArchivePage++;
        renderPage();
      });
      list.appendChild(pag);
    }
  }

  if (currentUser) {
    list.innerHTML = '<div class="home-archive-empty">Loading…</div>';
  }
  fetchMergedArchive(archive => {
    homeArchiveCache = archive;
    homeArchivePage  = 0;
    renderPage();
  });
}

function startNewGame() {
  if (!engineReady) { setStatus('Engine not ready yet. Please wait…'); return; }

  if (analysisMode) exitAnalysisMode();

  // BUG FIX 3: cancel any in-flight engine calculation for the old game
  sendCmd('stop');
  gameId++;

  const idx      = parseInt(document.getElementById('difficulty-select').value);
  const diffName = document.getElementById('difficulty-select').options[idx].text;
  const diff     = DIFFICULTIES[idx];

  playerColor = chosenColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : chosenColor;
  reviewNames = null;

  chess            = new Chess();
  gameActive       = true;
  waitingForEngine = false;
  viewMode         = gameMode;
  manualFlip       = false;
  selectedSq       = null;
  legalTargets     = [];
  pendingPromotion = null;
  lastMove         = null;
  moveList         = [];
  moveAccuracy     = [];
  premove          = null;
  fenHistory       = [chess.fen()];
  boardHistory     = [chess.board()];
  checkHistory     = [{ inCheck: false, turn: 'w' }];
  moveFromTo       = [];
  viewIndex        = 0;

  document.getElementById('gameover-overlay').style.display = 'none';
  document.getElementById('resign-btn').disabled   = false;
  document.getElementById('takeback-btn').disabled = true; // re-enabled after first move

  // Clock
  stopClock();
  const preset = TIME_PRESETS[selectedTimeKey];
  clockWhite = preset ? preset.seconds : 0;
  clockBlack = preset ? preset.seconds : 0;
  showClocks();
  if (clockActive()) updateClockDisplay();

  sendCmd('ucinewgame');
  sendCmd('setoption name Hash value 16');
  sendCmd('setoption name Skill Level value ' + diff.skill);

  updatePlayerBoxes(diffName);
  applyViewMode(viewMode);
  renderMoveHistory();
  updateNavButtons();
  updateOpeningDisplay();

  hideSetupForGame();
  playSound('notify');
  setStatus(`${diffName} — You play ${playerColor === 'w' ? 'White' : 'Black'}. Click or drag to move.`);

  if (playerColor === 'b') requestEngineMove();
}

function updatePlayerBoxes(diffName) {
  const label = diffName || document.getElementById('difficulty-select')
    .options[parseInt(document.getElementById('difficulty-select').value)].text;

  document.getElementById('engine-level').textContent       = label;
  document.getElementById('player-color-label').textContent = playerColor === 'w' ? 'White' : 'Black';
}

// ===== Board rendering =====

function renderBoard() {
  const boardEl  = document.getElementById('board');
  const fragment = document.createDocumentFragment();

  const reviewing  = inReviewMode();
  // PERF: use pre-stored snapshots instead of instantiating new Chess()
  const boardState = reviewing ? boardHistory[viewIndex] : chess.board();
  const chkInfo    = reviewing ? checkHistory[viewIndex]
                               : { inCheck: chess.in_check(), turn: chess.turn() };
  const hlMove     = reviewing ? (viewIndex > 0 ? moveFromTo[viewIndex - 1] : null) : lastMove;
  const flipped    = (playerColor === 'b') !== manualFlip;
  const myTurn     = gameActive && !waitingForEngine && !reviewing && chess.turn() === playerColor;

  boardEl.classList.toggle('my-turn',   myTurn);
  boardEl.classList.toggle('reviewing', reviewing);

  for (let vRow = 0; vRow < 8; vRow++) {
    for (let vCol = 0; vCol < 8; vCol++) {
      const row   = flipped ? 7 - vRow : vRow;
      const col   = flipped ? 7 - vCol : vCol;
      const sq    = coordsToSquare(row, col);
      const piece = boardState[row][col];

      const sqEl = document.createElement('div');
      sqEl.classList.add('square', (row + col) % 2 === 0 ? 'light' : 'dark');
      sqEl.dataset.sq = sq;

      if (hlMove && (sq === hlMove.from || sq === hlMove.to)) sqEl.classList.add('last-move');

      if (!reviewing) {
        if (selectedSq === sq)                               sqEl.classList.add('selected');
        if (isDragging && mouseDownData?.sq === sq)          sqEl.classList.add('dragging-from');
        if (legalTargets.includes(sq)) sqEl.classList.add(piece ? 'capture' : 'highlight');
      }

      if (premove && sq === premove.from) sqEl.classList.add('premove-from');
      if (premove && sq === premove.to)   sqEl.classList.add('premove-to');

      if (chkInfo.inCheck && piece?.type === 'k' && piece.color === chkInfo.turn) {
        sqEl.classList.add('in-check');
      }

      if (vCol === 0) {
        const lbl = document.createElement('span');
        lbl.classList.add('coord', 'coord-rank');
        lbl.textContent = String(8 - row);
        sqEl.appendChild(lbl);
      }
      if (vRow === 7) {
        const lbl = document.createElement('span');
        lbl.classList.add('coord', 'coord-file');
        lbl.textContent = String.fromCharCode(97 + col);
        sqEl.appendChild(lbl);
      }

      if (piece && viewMode !== 'void') {
        if (viewMode === 'checkers') {
          const circle = document.createElement('div');
          circle.classList.add('checker-piece', piece.color === 'w' ? 'checker-white' : 'checker-black');
          sqEl.appendChild(circle);
        } else {
          const img = document.createElement('img');
          img.classList.add('piece');
          img.src = PIECE_SVG(piece.color + piece.type.toUpperCase());
          img.draggable = false;
          sqEl.appendChild(img);
        }
      }

      fragment.appendChild(sqEl);
    }
  }
  boardEl.replaceChildren(fragment);
  if (typeof renderAnnotations === 'function') renderAnnotations();
}

function coordsToSquare(row, col) { return String.fromCharCode(97 + col) + (8 - row); }

// ===== Move history =====

// Lichess-style move list: index column, two move columns, and — during analysis —
// an "interrupt" box under every inaccuracy/mistake/blunder with the engine's better line.
function renderMoveHistory() {
  const list = document.getElementById('moves-list');
  list.innerHTML = '';
  const activeMoveIdx = viewIndex - 1;

  const indexEl = n => {
    const el = document.createElement('span');
    el.className = 'mv-index';
    el.textContent = n;
    return el;
  };
  const emptyEl = () => {
    const el = document.createElement('span');
    el.className = 'mv-move mv-empty';
    el.textContent = '…';
    return el;
  };
  const moveEl = i => {
    const el = document.createElement('span');
    el.className = 'mv-move' + (i === activeMoveIdx ? ' active' : '');
    el.appendChild(document.createTextNode(moveList[i]));
    const acc = analysisMode ? moveAccuracy[i] : null;
    if (acc && acc.symbol && acc.key !== 'best') {
      const g = document.createElement('span');
      g.className = 'mv-glyph';
      g.textContent = acc.symbol;
      g.style.color = acc.color;
      g.title = acc.label;
      el.appendChild(g);
    }
    if (analysisMode) {
      const cp = positionWhiteCp(fenHistory[i + 1]);
      if (cp !== null) {
        const ev = document.createElement('span');
        ev.className = 'mv-eval';
        ev.textContent = Math.abs(cp) >= 9000 ? (cp > 0 ? '#' : '-#') : (cp / 100).toFixed(1);
        el.appendChild(ev);
      }
    }
    el.addEventListener('click', () => setViewIndex(i + 1));
    return el;
  };
  const interruptEl = i => {
    const acc = analysisMode ? moveAccuracy[i] : null;
    if (!acc || !['inaccuracy', 'mistake', 'blunder'].includes(acc.key)) return null;
    const preFen = fenHistory[i];
    const best   = analysisCache[preFen]?.mvs?.[0];
    if (!best?.pv?.length) return null;
    const tokens = buildPvTokens(preFen, best.pv.slice(0, 10));
    const bestSan = tokens.find(t => t.type === 'mv')?.san;
    if (!bestSan) return null;

    const box = document.createElement('div');
    box.className = 'mv-interrupt';
    const comment = document.createElement('div');
    comment.className = 'mv-comment';
    const label = document.createElement('span');
    label.style.color = acc.color;
    label.textContent = acc.label + '.';
    comment.append(label, ` ${bestSan} was best.`);
    box.appendChild(comment);

    const line = document.createElement('div');
    line.className = 'mv-variation';
    tokens.forEach(t => {
      const s = document.createElement('span');
      if (t.type === 'num') {
        s.className = 'mv-var-num';
        s.textContent = t.text;
      } else {
        s.className = 'mv-var-move';
        s.textContent = t.san;
        s.addEventListener('mouseenter', () => showPvBoard(t.fen, t.uci, s));
        s.addEventListener('mouseleave', hidePvBoard);
      }
      line.appendChild(s);
    });
    box.appendChild(line);
    return box;
  };

  for (let i = 0; i < moveList.length; i += 2) {
    const n = Math.floor(i / 2) + 1;
    list.appendChild(indexEl(n));
    list.appendChild(moveEl(i));

    const whiteInterrupt = interruptEl(i);
    if (whiteInterrupt) {
      list.appendChild(emptyEl());
      list.appendChild(whiteInterrupt);
      if (i + 1 < moveList.length) {
        list.appendChild(indexEl(n));
        list.appendChild(emptyEl());
      }
    }
    if (i + 1 < moveList.length) {
      list.appendChild(moveEl(i + 1));
      const blackInterrupt = interruptEl(i + 1);
      if (blackInterrupt) list.appendChild(blackInterrupt);
    } else if (!whiteInterrupt) {
      list.appendChild(document.createElement('span'));
    }
  }

  // Keep the active move in view without scrolling the page
  const activeEl = list.querySelector('.mv-move.active');
  if (activeEl) {
    const top = activeEl.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top + activeEl.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  } else if (viewIndex === 0) {
    list.scrollTop = 0;
  }

  document.getElementById('takeback-btn').disabled = !gameActive || moveList.length === 0;
}

// ===== Game over =====

function handleGameOver() {
  gameActive = false;
  document.getElementById('resign-btn').disabled = true;

  let reason;
  if      (chess.in_checkmate())          reason = ['lose_or_win', 'Checkmate'];
  else if (chess.in_stalemate())          reason = ['draw',        'Stalemate'];
  else if (chess.in_threefold_repetition()) reason = ['draw',     'Threefold Repetition'];
  else if (chess.insufficient_material()) reason = ['draw',        'Insufficient Material'];
  else if (chess.in_draw())               reason = ['draw',        '50-Move Rule']; // BUG FIX 4

  if (!reason) return;
  const [kind, label] = reason;

  if (kind === 'lose_or_win') {
    showGameOver(chess.turn() === playerColor ? 'lose' : 'win', label);
  } else {
    showGameOver('draw', label);
  }

  playSound('notify');
}

function showGameOver(result, reason) {
  stopClock();
  gameActive = false;

  const icon  = document.getElementById('gameover-icon');
  const title = document.getElementById('gameover-title');

  // ELO update
  const idx         = parseInt(document.getElementById('difficulty-select').value);
  const opponentElo = DIFFICULTY_ELO[idx] || 1200;
  const playerElo   = loadElo();
  const score       = result === 'win' ? 1 : result === 'lose' ? 0 : 0.5;
  const delta       = calcEloChange(playerElo, opponentElo, score);
  saveElo(playerElo + delta);
  updateEloBadge();

  const eloText = (delta >= 0 ? '+' : '') + delta + ' ELO';

  if (result === 'win') {
    icon.innerHTML = '<span class="material-symbols-outlined gameover-icon-symbol" style="color:#ffd600">emoji_events</span>';
    title.textContent = 'You Win!'; title.className = 'result-win';
    launchConfetti();
  } else if (result === 'lose') {
    icon.innerHTML = '<span class="material-symbols-outlined gameover-icon-symbol" style="color:#c62828">sentiment_dissatisfied</span>';
    title.textContent = 'You Lose'; title.className = 'result-lose';
  } else {
    icon.innerHTML = '<span class="material-symbols-outlined gameover-icon-symbol" style="color:var(--text-lo)">handshake</span>';
    title.textContent = 'Draw'; title.className = 'result-draw';
  }

  document.getElementById('gameover-subtitle').textContent = reason + '  ·  ' + eloText;
  document.getElementById('gameover-overlay').style.display = 'flex';

  if (voiceEnabled) {
    const resultText = result === 'win' ? 'You win!' : result === 'lose' ? 'You lose.' : 'Draw.';
    setTimeout(() => speak(`${resultText} ${reason}.`), 600);
  }

  saveGameToArchive(result, reason);
}

// ===== Game Archive =====

function buildPGN(date, diffName, resultStr) {
  const white = playerColor === 'w' ? 'You' : 'Stockfish';
  const black = playerColor === 'b' ? 'You' : 'Stockfish';
  let pgn = `[Event "Blindfold Chess"]\n`;
  pgn += `[Date "${date.replace(/-/g, '.')}"]\n`;
  pgn += `[White "${white}"]\n`;
  pgn += `[Black "${black}"]\n`;
  pgn += `[Result "${resultStr}"]\n`;
  pgn += `[Difficulty "${diffName}"]\n\n`;

  const tokens = [];
  for (let i = 0; i < moveList.length; i++) {
    if (i % 2 === 0) tokens.push(`${Math.floor(i / 2) + 1}.`);
    tokens.push(moveList[i]);
  }
  pgn += tokens.join(' ') + ' ' + resultStr;
  return pgn;
}

function saveGameToArchive(result, reason) {
  if (!moveList.length) return; // don't archive empty games

  const idx      = parseInt(document.getElementById('difficulty-select').value);
  const diffName = document.getElementById('difficulty-select').options[idx].text;
  const today    = new Date().toISOString().slice(0, 10);
  const resultStr = result === 'win'
    ? (playerColor === 'w' ? '1-0' : '0-1')
    : result === 'lose'
    ? (playerColor === 'w' ? '0-1' : '1-0')
    : '1/2-1/2';

  const pgn   = buildPGN(today, diffName, resultStr);
  const entry = {
    id:         Date.now(),
    date:       today,
    result,
    reason,
    difficulty: diffName,
    playerColor,
    moveCount:  moveList.length,
    pgn,
  };

  // Always save locally (works offline / when not signed in)
  const archive = JSON.parse(localStorage.getItem('bca_archive') || '[]');
  archive.unshift(entry);
  if (archive.length > 100) archive.length = 100;
  localStorage.setItem('bca_archive', JSON.stringify(archive));

  // If signed in, sync to Firebase under this user's account
  if (currentUser) {
    fbDb.ref(`users/${currentUser.uid}/games/${entry.id}`)
      .set(entry)
      .catch(err => console.error('[Firebase] Save failed:', err));
  }
}

// Fetch games from Firebase (if signed in) merged with localStorage.
// Also migrates any localStorage-only games up to Firebase silently.
function fetchMergedArchive(callback) {
  const local = JSON.parse(localStorage.getItem('bca_archive') || '[]');

  if (!currentUser) {
    callback(local);
    return;
  }

  fbDb.ref(`users/${currentUser.uid}/games`)
    .once('value')
    .then(snapshot => {
      const remote = [];
      snapshot.forEach(child => remote.push(child.val()));

      // Merge: add localStorage games that Firebase doesn't have yet
      const remoteIds = new Set(remote.map(g => g.id));
      for (const g of local) {
        if (!remoteIds.has(g.id)) {
          remote.push(g);
          // Migrate to Firebase so future fetches are complete
          fbDb.ref(`users/${currentUser.uid}/games/${g.id}`).set(g).catch(() => {});
        }
      }

      remote.sort((a, b) => b.id - a.id);
      callback(remote);
    })
    .catch(() => callback(local));
}

function resetToEntry() {
  restoreSetupUI();
  document.getElementById('gameover-overlay').style.display = 'none';
  chess        = new Chess();
  gameActive   = false;
  selectedSq   = null;
  legalTargets = [];
  lastMove     = null;
  moveList     = [];
  premove      = null;
  fenHistory   = [chess.fen()];
  boardHistory = [chess.board()];
  checkHistory = [{ inCheck: false, turn: 'w' }];
  moveFromTo   = [];
  viewIndex    = 0;
  manualFlip   = false;
  applyViewMode('normal');
  document.getElementById('resign-btn').disabled = true;
  renderBoard();
  renderMoveHistory();
  updateNavButtons();
  setStatus('Engine ready. Select a difficulty and start a new game.');
}

// ===== Resign =====

function showResignModal() {
  document.getElementById('resign-modal').style.display = 'flex';
}

function hideResignModal() {
  document.getElementById('resign-modal').style.display = 'none';
}

function confirmResign() {
  hideResignModal();
  sendCmd('stop');
  gameActive       = false;
  waitingForEngine = false;
  document.getElementById('resign-btn').disabled = true;
  showGameOver('lose', 'Resignation');
  playSound('notify');
  if (voiceEnabled) setTimeout(() => speak('You resigned.'), 600);
}

// ===== Takeback =====

function doTakeback() {
  if (!gameActive || moveList.length === 0) return;

  premove = null;
  sendCmd('stop');
  waitingForEngine = false;
  if (pendingEngineTimeout) { clearTimeout(pendingEngineTimeout); pendingEngineTimeout = null; }

  // Undo 2 plies (engine reply + player move) if it's player's turn, else 1
  const plies = Math.min(chess.turn() === playerColor ? 2 : 1, moveList.length);

  for (let i = 0; i < plies; i++) {
    chess.undo();
    moveList.pop();
    fenHistory.pop();
    boardHistory.pop();
    checkHistory.pop();
    moveFromTo.pop();
  }

  viewIndex    = fenHistory.length - 1;
  lastMove     = moveFromTo.length > 0 ? moveFromTo[moveFromTo.length - 1] : null;
  selectedSq   = null;
  legalTargets = [];

  renderBoard();
  renderMoveHistory();
  updateNavButtons();
  setStatus('Takeback granted. Your move.');
  if (micAlwaysOn) setTimeout(() => autoStartListening(), 400);
}

document.getElementById('takeback-btn').addEventListener('click', doTakeback);

// ===== Player move =====

function handleSquareClick(sq) {
  if (!gameActive || inReviewMode()) return;

  // During engine's turn: allow setting a premove
  if (chess.turn() !== playerColor) {
    const piece = chess.get(sq);
    if (!premove || premove.to) {
      // Start a new premove selection: must pick own piece
      if (piece && piece.color === playerColor) {
        premove = { from: sq, to: null };
        renderBoard();
      }
    } else {
      // premove.from is set, waiting for destination
      if (sq === premove.from) { premove = null; renderBoard(); }
      else { premove = { from: premove.from, to: sq }; renderBoard(); }
    }
    return;
  }

  if (waitingForEngine) return;
  const piece = chess.get(sq);

  if (selectedSq === sq) { // click same piece = deselect
    selectedSq = null; legalTargets = []; renderBoard(); return;
  }

  if (selectedSq && legalTargets.includes(sq)) { attemptMove(selectedSq, sq); return; }

  if (piece && piece.color === playerColor) {
    selectedSq   = sq;
    legalTargets = chess.moves({ square: sq, verbose: true }).map(m => m.to);
  } else {
    selectedSq = null; legalTargets = [];
  }
  renderBoard();
}

function attemptMove(from, to) {
  const piece  = chess.get(from);
  const toRank = parseInt(to[1]);
  const isPromo = piece?.type === 'p' &&
    ((piece.color === 'w' && toRank === 8) || (piece.color === 'b' && toRank === 1));

  if (isPromo) {
    pendingPromotion = { from, to };
    selectedSq = null; legalTargets = [];
    renderBoard();
    updatePromoModal(piece.color);
    document.getElementById('promotion-modal').style.display = 'flex';
    return;
  }
  executeMove(from, to, null);
}

function updatePromoModal(color) {
  document.querySelectorAll('.promo-btn').forEach(btn => {
    btn.querySelector('img').src = PIECE_SVG(color + btn.dataset.piece.toUpperCase());
  });
}

function executeMove(from, to, promotion) {
  const result = chess.move({ from, to, promotion: promotion || 'q' });
  if (!result) return;

  moveList.push(result.san);
  lastMove = { from, to };
  moveFromTo.push({ from, to });
  boardHistory.push(chess.board());
  checkHistory.push({ inCheck: chess.in_check(), turn: chess.turn() });
  fenHistory.push(chess.fen());
  viewIndex    = fenHistory.length - 1;
  selectedSq   = null;
  legalTargets = [];

  // Clock: add increment for the side that just moved, then start opponent's clock
  if (clockActive()) {
    addIncrement(result.color);
    startClock();
    updateClockDisplay();
  }

  // Opening name
  updateOpeningDisplay();

  // Sound
  if (chess.in_check())    playSound('check');
  else if (result.captured) playSound('capture');
  else                      playSound('move');

  if (voiceEnabled) speakMove(result.san, false);

  renderBoard();
  renderMoveHistory();
  updateNavButtons();

  if (chess.game_over()) { handleGameOver(); return; }

  requestEngineMove();
}

// ===== Helpers =====

function setStatus(msg) { document.getElementById('status').textContent = msg; }
function squareFromEl(el) { const s = el?.closest('[data-sq]'); return s ? s.dataset.sq : null; }

// ===== Drag helpers =====

function spawnDragEl(piece, x, y) {
  if (viewMode === 'checkers') {
    dragEl = document.createElement('div');
    dragEl.id = 'drag-piece';
    dragEl.classList.add('checker-piece', piece.color === 'w' ? 'checker-white' : 'checker-black');
    dragEl.style.width = dragEl.style.height = 'var(--sq)';
  } else {
    dragEl = document.createElement('img');
    dragEl.id = 'drag-piece';
    dragEl.src = PIECE_SVG(piece.color + piece.type.toUpperCase());
    dragEl.draggable = false;
  }
  document.body.appendChild(dragEl);
  document.body.classList.add('is-dragging');
  moveDragEl(x, y);
}

function moveDragEl(x, y) { if (dragEl) { dragEl.style.left = x + 'px'; dragEl.style.top = y + 'px'; } }

function destroyDragEl() {
  dragEl?.remove(); dragEl = null;
  document.body.classList.remove('is-dragging');
}

// ===== Cancel drag (shared by mouse & touch) =====

function cancelDrag() {
  if (!mouseDownData) return;
  if (isDragging) { destroyDragEl(); selectedSq = null; legalTargets = []; renderBoard(); }
  mouseDownData = null;
  isDragging    = false;
}

// ===== Mouse events =====

document.getElementById('board').addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  const sq = squareFromEl(e.target);
  if (!sq || !gameActive || inReviewMode()) return;
  e.preventDefault();
  mouseDownData = { sq, x: e.clientX, y: e.clientY };
  isDragging = false;
});

document.addEventListener('mousemove', e => {
  if (!mouseDownData || e.buttons !== 1) return;
  const piece = chess.get(mouseDownData.sq);
  if (!piece || piece.color !== playerColor) return;
  const dx = e.clientX - mouseDownData.x, dy = e.clientY - mouseDownData.y;
  if (!isDragging && Math.hypot(dx, dy) > 5) {
    isDragging   = true;
    selectedSq   = mouseDownData.sq;
    legalTargets = chess.moves({ square: mouseDownData.sq, verbose: true }).map(m => m.to);
    spawnDragEl(piece, e.clientX, e.clientY);
    renderBoard();
  }
  if (isDragging) moveDragEl(e.clientX, e.clientY);
});

document.addEventListener('mouseup', e => {
  if (e.button !== 0 || !mouseDownData) return;
  if (isDragging) {
    destroyDragEl();
    const toSq   = squareFromEl(document.elementFromPoint(e.clientX, e.clientY));
    const fromSq = mouseDownData.sq;
    // Drag during engine's turn = set premove
    if (chess.turn() !== playerColor) {
      if (toSq && toSq !== fromSq) {
        premove = { from: fromSq, to: toSq };
      }
      selectedSq = null; legalTargets = []; renderBoard();
    } else if (toSq && legalTargets.includes(toSq) && toSq !== fromSq) {
      mouseDownData = null; isDragging = false;
      attemptMove(fromSq, toSq); return;
    } else {
      selectedSq = null; legalTargets = []; renderBoard();
    }
  } else {
    handleSquareClick(mouseDownData.sq);
  }
  mouseDownData = null; isDragging = false;
});

// Cancel drag on right-click, window blur, or mouse leaving the page
document.addEventListener('contextmenu', cancelDrag);
document.addEventListener('mouseleave',  cancelDrag);
window.addEventListener('blur',          cancelDrag);

// Prevent right-click context menu on the board
document.getElementById('board').addEventListener('contextmenu', e => e.preventDefault());
document.getElementById('board-wrap').addEventListener('contextmenu', e => e.preventDefault());

// ===== Touch events =====

document.getElementById('board').addEventListener('touchstart', e => {
  const t  = e.touches[0];
  const sq = squareFromEl(t.target);
  // BUG FIX 2: also guard inReviewMode() on touch
  if (!sq || !gameActive || waitingForEngine || chess.turn() !== playerColor || inReviewMode()) return;
  e.preventDefault();
  mouseDownData = { sq, x: t.clientX, y: t.clientY };
  isDragging = false;
}, { passive: false });

document.addEventListener('touchmove', e => {
  if (!mouseDownData) return;
  const piece = chess.get(mouseDownData.sq);
  if (!piece || piece.color !== playerColor) return;
  const t = e.touches[0];
  const dx = t.clientX - mouseDownData.x, dy = t.clientY - mouseDownData.y;
  if (!isDragging && Math.hypot(dx, dy) > 5) {
    isDragging   = true;
    selectedSq   = mouseDownData.sq;
    legalTargets = chess.moves({ square: mouseDownData.sq, verbose: true }).map(m => m.to);
    spawnDragEl(piece, t.clientX, t.clientY);
    renderBoard();
  }
  if (isDragging) { e.preventDefault(); moveDragEl(t.clientX, t.clientY); }
}, { passive: false });

document.addEventListener('touchend', e => {
  if (!mouseDownData) return;
  const t = e.changedTouches[0];
  if (isDragging) {
    destroyDragEl();
    const toSq   = squareFromEl(document.elementFromPoint(t.clientX, t.clientY));
    const fromSq = mouseDownData.sq;
    if (toSq && legalTargets.includes(toSq) && toSq !== fromSq) {
      mouseDownData = null; isDragging = false;
      attemptMove(fromSq, toSq); return;
    }
    selectedSq = null; legalTargets = []; renderBoard();
  } else {
    handleSquareClick(mouseDownData.sq);
  }
  mouseDownData = null; isDragging = false;
});

// BUG FIX 1: cancel touch drag when OS interrupts (notification, call, etc.)
document.addEventListener('touchcancel', cancelDrag);

// ===== Modal event listeners =====

document.querySelectorAll('.promo-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.getElementById('promotion-modal').style.display = 'none';
    if (pendingPromotion) {
      const { from, to } = pendingPromotion;
      pendingPromotion = null;
      executeMove(from, to, btn.dataset.piece);
    }
  });
});

document.getElementById('resign-btn').addEventListener('click', () => {
  if (!gameActive) return;
  showResignModal();
});
document.getElementById('resign-confirm-btn').addEventListener('click', confirmResign);
document.getElementById('resign-cancel-btn').addEventListener('click',  hideResignModal);

// ── Custom difficulty dropdown ──
(function() {
  const wrap    = document.getElementById('difficulty-select-wrap');
  const trigger = document.getElementById('difficulty-trigger');
  const options = document.querySelectorAll('#difficulty-options .custom-select-option');
  const select  = document.getElementById('difficulty-select');

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    wrap.classList.toggle('open');
  });

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      trigger.querySelector('.custom-select-value').textContent = opt.textContent;
      select.value = opt.dataset.value;
      wrap.classList.remove('open');
    });
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) wrap.classList.remove('open');
  });
})();

document.querySelectorAll('.color-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    chosenColor = btn.dataset.color;
  });
});

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    gameMode = btn.dataset.mode;
  });
});

document.querySelectorAll('.time-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.time-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedTimeKey = btn.dataset.time;
  });
});

document.querySelectorAll('.theme-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyBoardTheme(btn.dataset.theme);
  });
});

// Restore saved theme button selection
(function () {
  const saved = boardTheme;
  document.querySelectorAll('.theme-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.theme === saved);
  });
})();

document.getElementById('top-new-game-btn').addEventListener('click', showNewGameModal);
document.getElementById('newgame-confirm-btn').addEventListener('click', () => {
  hideNewGameModal();
  startNewGame();
});
document.getElementById('newgame-cancel-btn').addEventListener('click', hideNewGameModal);
document.getElementById('newgame-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('newgame-modal')) hideNewGameModal();
});
document.getElementById('gameover-btn').addEventListener('click', () => {
  document.getElementById('gameover-overlay').style.display = 'none';
  showNewGameModal();
});
document.getElementById('gameover-close').addEventListener('click', () => {
  document.getElementById('gameover-overlay').style.display = 'none';
  // Keep side panel visible so user can review history — just reset button states
  document.getElementById('resign-btn').classList.remove('visible');
  document.getElementById('top-new-game-btn').classList.remove('in-game');
});

document.getElementById('toggle-vision-btn').addEventListener('click', () => {
  const next = VIEW_MODE_CYCLE[(VIEW_MODE_CYCLE.indexOf(viewMode) + 1) % VIEW_MODE_CYCLE.length];
  applyViewMode(next);
});

// ===== View mode (eye button) =====

const VIEW_MODE_CYCLE = ['normal', 'checkers', 'void'];
const VIEW_MODE_ICON  = { normal: 'visibility', checkers: 'grid_on', void: 'visibility_off' };
const VIEW_MODE_LABEL = { normal: 'Normal', checkers: 'Checkers', void: 'Void' };

function applyViewMode(mode) {
  viewMode = mode;
  const btn = document.getElementById('toggle-vision-btn');
  btn.querySelector('.btn-icon').textContent = VIEW_MODE_ICON[mode];
  btn.querySelector('.btn-label').textContent = VIEW_MODE_LABEL[mode];
  renderBoard();
}

// ===== History navigation =====

function inReviewMode() { return viewIndex < fenHistory.length - 1; }

function setViewIndex(idx) {
  const prevIndex = viewIndex;
  viewIndex    = Math.max(0, Math.min(idx, fenHistory.length - 1));
  if (viewIndex !== prevIndex) announcePosition(viewIndex);
  selectedSq   = null;
  legalTargets = [];
  renderBoard();
  renderMoveHistory();
  updateNavButtons();
  if (analysisMode) { renderAnalysisForCurrentPos(); renderEvalGraph(); renderGraphMoves(); }
}

function updateNavButtons() {
  const atStart = viewIndex === 0;
  const atEnd   = viewIndex === fenHistory.length - 1;
  document.getElementById('nav-first').disabled = atStart;
  document.getElementById('nav-prev').disabled  = atStart;
  document.getElementById('nav-next').disabled  = atEnd;
  document.getElementById('nav-last').disabled  = atEnd;
  document.getElementById('review-label').style.display = inReviewMode() ? 'inline' : 'none';
}

document.getElementById('nav-first').addEventListener('click', () => setViewIndex(0));
document.getElementById('nav-prev').addEventListener('click',  () => setViewIndex(viewIndex - 1));
document.getElementById('nav-next').addEventListener('click',  () => setViewIndex(viewIndex + 1));
document.getElementById('nav-last').addEventListener('click',  () => setViewIndex(fenHistory.length - 1));

// ===== Keyboard shortcuts =====

document.addEventListener('keydown', e => {
  // Don't fire shortcuts when typing in an input
  if (e.target.tagName === 'SELECT' || e.target.tagName === 'INPUT') return;

  switch (e.key) {
    case 'ArrowLeft':  e.preventDefault(); setViewIndex(viewIndex - 1); break;
    case 'ArrowRight': e.preventDefault(); setViewIndex(viewIndex + 1); break;
    case 'ArrowUp':    e.preventDefault(); setViewIndex(0);                        break;
    case 'ArrowDown':  e.preventDefault(); setViewIndex(fenHistory.length - 1);    break;

    case 'f': case 'F':
      manualFlip = !manualFlip;
      renderBoard();
      break;

    case 'b': case 'B': {
      const next = VIEW_MODE_CYCLE[(VIEW_MODE_CYCLE.indexOf(viewMode) + 1) % VIEW_MODE_CYCLE.length];
      applyViewMode(next);
      break;
    }

    case 'n': case 'N':
      startNewGame();
      break;

    case 'm': case 'M':
      toggleMic();
      break;

    case 'Escape':
      if (document.getElementById('ceval-modal').style.display === 'flex') {
        document.getElementById('ceval-modal').style.display = 'none'; break;
      }
      if (document.getElementById('resign-modal').style.display === 'flex') {
        hideResignModal(); break;
      }
      if (document.getElementById('promotion-modal').style.display === 'flex') {
        document.getElementById('promotion-modal').style.display = 'none';
        pendingPromotion = null; renderBoard(); break;
      }
      if (selectedSq) { selectedSq = null; legalTargets = []; renderBoard(); }
      break;
  }
});

// ===== Voice System =====

// ── Speech output (announcer) ──
// Works around Chrome quirks: speak() straight after cancel() is silently dropped, an
// unreferenced utterance can be garbage-collected mid-speech (onend never fires), and
// long utterances stall after ~15s unless nudged.

const synth = window.speechSynthesis || null;
let ttsVoice     = null;
let ttsActive    = null;  // utterance being spoken (or 'starting' during the cancel gap)
let ttsKeepAlive = null;
const ttsIdleWaiters = [];

function pickTtsVoice() {
  if (!synth) return;
  const voices = synth.getVoices();
  const en = voices.filter(v => /^en[-_]/i.test(v.lang));
  ttsVoice = en.find(v => /^en[-_]US/i.test(v.lang) && /natural|google|aria|jenny|guy/i.test(v.name))
          || en.find(v => /^en[-_]US/i.test(v.lang))
          || en[0] || null;
}
if (synth) {
  pickTtsVoice();
  synth.addEventListener('voiceschanged', pickTtsVoice);
}

function ttsBusy() { return !!synth && (ttsActive !== null || synth.speaking || synth.pending); }

// Resolves once nothing is being spoken — the mic waits on this so it doesn't hear the announcer
function whenSpeechIdle() {
  return ttsBusy() ? new Promise(resolve => ttsIdleWaiters.push(resolve)) : Promise.resolve();
}

function ttsFinished(utt) {
  if (ttsActive !== utt) return; // a newer utterance replaced this one
  ttsActive = null;
  clearInterval(ttsKeepAlive);
  while (ttsIdleWaiters.length) ttsIdleWaiters.shift()();
}

// opts.force: speak even when announcements are off (e.g. the coach's read-aloud button)
function speak(text, opts = {}) {
  if (!synth || !text) return;
  if (!voiceEnabled && !opts.force) return;

  const start = () => {
    const utt = new SpeechSynthesisUtterance(text);
    if (ttsVoice) utt.voice = ttsVoice;
    utt.lang = ttsVoice ? ttsVoice.lang : 'en-US';
    utt.rate = opts.rate || 1.05;
    utt.onend   = () => ttsFinished(utt);
    utt.onerror = () => ttsFinished(utt);
    ttsActive = utt;
    clearInterval(ttsKeepAlive);
    ttsKeepAlive = setInterval(() => {
      if (synth.speaking && !synth.paused) { synth.pause(); synth.resume(); }
    }, 10000);
    synth.speak(utt);
  };

  if (synth.speaking || synth.pending) {
    ttsActive = 'starting';
    synth.cancel();
    setTimeout(start, 80);
  } else {
    start();
  }
}

function stopSpeaking() {
  if (!synth) return;
  synth.cancel();
  ttsFinished(ttsActive);
}

function speakMove(san, isEngine) {
  const text = sanToSpeech(san);
  speak(isEngine ? `Stockfish plays ${text}` : text);
}

function sanToSpeech(san) {
  const pieceNames = { N: 'knight', B: 'bishop', R: 'rook', Q: 'queen', K: 'king' };
  let s = san;
  let suffix = '';
  if      (s.endsWith('#')) { suffix = ', checkmate'; s = s.slice(0, -1); }
  else if (s.endsWith('+')) { suffix = ', check';     s = s.slice(0, -1); }

  if (s === 'O-O')   return 'kingside castle' + suffix;
  if (s === 'O-O-O') return 'queenside castle' + suffix;

  let promoText = '';
  const promoMatch = s.match(/=([NBRQ])$/);
  if (promoMatch) { promoText = `, promotes to ${pieceNames[promoMatch[1]]}`; s = s.slice(0, -2); }

  const isCapture = s.includes('x');
  s = s.replace('x', '');
  const target = s.slice(-2);
  const prefix = s.slice(0, -2);
  let pieceName = 'pawn';
  if (prefix.length > 0 && pieceNames[prefix[0]]) pieceName = pieceNames[prefix[0]];

  // Spell the square so the voice says "e 4", not "e-four" mashed together
  const sq = target[0].toUpperCase() + ' ' + target[1];
  return `${pieceName} ${isCapture ? 'takes' : 'to'} ${sq}${promoText}${suffix}`;
}

// Announce the move that led to position `idx` (used while stepping through a game)
function announcePosition(idx) {
  if (!voiceEnabled || idx < 1 || idx > moveList.length) return;
  const moveNo = Math.ceil(idx / 2);
  const side   = idx % 2 === 1 ? 'White' : 'Black';
  speak(`${moveNo}, ${side}, ${sanToSpeech(moveList[idx - 1])}`);
}

// ── Speech input ──
// 'browser' = Web Speech API (free, no key; Chrome/Edge). 'whisper' = Groq Whisper (needs a key).

let voiceEngine = (() => {
  try { const v = localStorage.getItem('bca_voice_engine'); if (v) return v; } catch {}
  return 'browser';
})();
let listening    = false; // mic is open
let processing   = false; // waiting on transcription
let listenAuto   = false; // current session was started hands-free
let whisperStop  = null;  // ends the current Whisper recording: whisperStop(keepAudio)

function setVoiceEngine(engine) {
  voiceEngine = engine;
  try { localStorage.setItem('bca_voice_engine', engine); } catch {}
  const btn = document.getElementById('voice-mode-btn');
  btn.querySelector('.material-symbols-outlined').textContent = engine === 'whisper' ? 'graphic_eq' : 'record_voice_over';
  btn.classList.toggle('offline-mode', engine !== 'whisper');
  btn.title = engine === 'whisper'
    ? 'Voice input: Groq Whisper (click for browser recognition)'
    : 'Voice input: browser recognition (click for Groq Whisper)';
}
setVoiceEngine(voiceEngine);

document.getElementById('voice-mode-btn').addEventListener('click', () => {
  cancelListening();
  setVoiceEngine(voiceEngine === 'whisper' ? 'browser' : 'whisper');
  showVoicePanel();
  addChatMessage('ai', voiceEngine === 'whisper'
    ? 'Using Groq Whisper for voice input.' + (getApiKey() ? '' : ' Add your free Groq key below.')
    : 'Using the browser for voice input.');
  if (voiceEngine === 'whisper' && !getApiKey()) showKeySetup();
});

function canAutoListen() {
  return micAlwaysOn && gameActive && !waitingForEngine && chess.turn() === playerColor && !inReviewMode();
}

async function autoStartListening() {
  if (!canAutoListen() || listening || processing) return;
  await whenSpeechIdle();
  await new Promise(r => setTimeout(r, 250)); // let the speaker's tail die out
  if (!canAutoListen() || listening || processing) return;
  startListening(true);
}

let fileOriginWarned = false;

function startListening(auto = false) {
  if (listening || processing) return;
  listenAuto = auto;
  showVoicePanel();
  if (location.protocol === 'file:' && !fileOriginWarned) {
    fileOriginWarned = true;
    addChatMessage('ai', 'The app is open as a file, so the browser asks for the mic every time. ' +
      'Start it with start.bat (http://localhost:8080) and pick "Allow while visiting the site" once.');
  }
  if (voiceEngine === 'whisper') {
    if (!getApiKey()) { showKeySetup(); return; }
    startWhisperListening();
  } else {
    startBrowserListening();
  }
}

// Tap while listening: stop and use what was heard
function finishListening() {
  if (recognition) recognition.stop();
  if (whisperStop) whisperStop(true);
}

// Abort without processing (Auto switched off, engine changed…)
function cancelListening() {
  if (recognition) { recognition.onresult = null; recognition.abort(); }
  if (whisperStop) whisperStop(false);
}

function micBlocked(msg) {
  micAlwaysOn = false;
  document.getElementById('mic-auto-btn').checked = false;
  addChatMessage('ai', msg);
}

function startBrowserListening() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    addChatMessage('ai', 'This browser has no speech recognition. Use Chrome or Edge, or switch the voice button to Whisper.');
    return;
  }
  const rec = new SR();
  recognition = rec;
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = false;
  rec.maxAlternatives = 5;

  let gotResult = false;
  rec.onresult = e => {
    gotResult = true;
    const alts = Array.from(e.results[0]).map(a => normalizeChessTranscript(a.transcript));
    // Prefer the first alternative that actually sounds like a chess command
    processTranscript(alts.find(looksLikeChessInput) || alts[0]);
  };
  rec.onerror = e => {
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
      micBlocked('Microphone access is blocked. Allow it from the icon in the address bar, then try again.');
    } else if (e.error === 'network') {
      addChatMessage('ai', 'Browser speech recognition needs an internet connection.');
    } else if (e.error !== 'no-speech' && e.error !== 'aborted') {
      addChatMessage('ai', 'Speech error: ' + e.error);
    }
  };
  rec.onend = () => {
    if (recognition === rec) recognition = null;
    listening = false;
    updateMicUI();
    if (!gotResult) setTimeout(autoStartListening, 300);
  };

  listening = true;
  updateMicUI();
  try {
    rec.start();
  } catch (err) {
    recognition = null;
    listening = false;
    updateMicUI();
    addChatMessage('ai', 'Could not start the microphone: ' + err.message);
  }
}

// One mic stream per session: asking again for every move re-prompts on file:// pages.
// Released after a couple of idle minutes so the browser's recording indicator goes away.
let micStream = null;
let micReleaseTimer = null;

async function getMicStream() {
  clearTimeout(micReleaseTimer);
  if (micStream && micStream.getAudioTracks().some(t => t.readyState === 'live')) return micStream;
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  return micStream;
}

function releaseMicStreamSoon() {
  clearTimeout(micReleaseTimer);
  micReleaseTimer = setTimeout(() => {
    if (micStream && !listening) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  }, 120000);
}

async function startWhisperListening() {
  listening = true; // set before awaiting permission so a second tap can't double-start
  updateMicUI();

  let stream;
  try {
    stream = await getMicStream();
  } catch (err) {
    listening = false;
    updateMicUI();
    micBlocked('Microphone error: ' + err.message);
    return;
  }
  if (!listening) { releaseMicStreamSoon(); return; } // cancelled meanwhile

  const mimeType = getSupportedMimeType();
  const rec      = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks   = [];
  rec.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  // Voice activity detection: stop after a pause once speech has been heard
  const actx = new AudioContext();
  await actx.resume().catch(() => {});
  const analyser = actx.createAnalyser();
  analyser.fftSize = 512;
  actx.createMediaStreamSource(stream).connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);

  const THRESHOLD = 18, MIN_SPEECH_MS = 300, SILENCE_MS = 1200;
  const t0 = performance.now();
  let last = t0, speechMs = 0, silenceSince = 0, heard = false, finished = false;

  const finish = keep => {
    if (finished) return;
    finished = true;
    whisperStop = null;
    rec.onstop = async () => {
      releaseMicStreamSoon(); // keep the stream for the next move
      actx.close().catch(() => {});
      listening = false;
      if (!keep || !chunks.length) { updateMicUI(); setTimeout(autoStartListening, 300); return; }
      processing = true;
      updateMicUI();
      try {
        const text = await transcribeAudio(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
        processing = false;
        updateMicUI();
        processTranscript(normalizeChessTranscript(text || ''));
      } catch (err) {
        processing = false;
        updateMicUI();
        if (err.message.includes('401')) {
          addChatMessage('ai', 'Your Groq key was rejected. Paste a new one below.');
          showKeySetup();
        } else {
          addChatMessage('ai', 'Transcription failed: ' + err.message);
        }
      }
    };
    try { rec.stop(); } catch { rec.onstop(); }
  };
  whisperStop = finish;
  rec.start(100);

  const tick = () => {
    if (finished) return;
    const now = performance.now();
    analyser.getByteFrequencyData(data);
    const rms = Math.sqrt(data.reduce((s, v) => s + v * v, 0) / data.length);
    if (rms > THRESHOLD) {
      speechMs += now - last;
      silenceSince = 0;
      if (speechMs >= MIN_SPEECH_MS) heard = true;
    } else if (heard) {
      silenceSince = silenceSince || now;
      if (now - silenceSince > SILENCE_MS) { finish(true); return; }
    }
    last = now;
    if (now - t0 > (heard ? 12000 : 8000)) { finish(heard); return; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Single entry point for anything the mic heard
function processTranscript(text) {
  text = (text || '').trim();
  const isCommand = awaitingResignConfirmation || looksLikeChessInput(text) || /\btake\s*back\b|\bundo\b/i.test(text);
  if (!text || (!isCommand && listenAuto)) {
    // Hands-free: ignore background noise silently and keep listening
    setTimeout(autoStartListening, 300);
    return;
  }
  addChatMessage('user', text);
  if (isCommand) {
    handleTranscript(text);
  } else {
    const reply = "I didn't catch a move. Say a piece and a square, like knight f3.";
    addChatMessage('ai', reply);
    speak(reply);
  }
  setTimeout(autoStartListening, 300);
}

// ── Mic button: tap to talk, tap again to stop ──
const micBtn = document.getElementById('mic-btn');
micBtn.addEventListener('click', toggleMic);
micBtn.addEventListener('contextmenu', e => e.preventDefault());

function toggleMic() {
  if (processing) return;
  if (listening) { finishListening(); return; }
  stopSpeaking(); // you're about to talk — don't let the announcer bleed into the mic
  startListening(false);
}

// ── Auto (hands-free) toggle ──
document.getElementById('mic-auto-btn').addEventListener('change', e => {
  micAlwaysOn = e.target.checked;
  if (micAlwaysOn) {
    showVoicePanel();
    if (voiceEngine === 'whisper' && !getApiKey()) { showKeySetup(); return; }
    addChatMessage('ai', canAutoListen() ? 'Hands-free on. Say your move.' : 'Hands-free on. I will listen on your turn.');
    autoStartListening();
  } else {
    cancelListening();
  }
});

// ── Flip board button ──
document.getElementById('flip-board-btn').addEventListener('click', () => {
  manualFlip = !manualFlip;
  renderBoard();
});

// ── Speaker toggle ──
document.getElementById('speaker-btn').addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  const btn = document.getElementById('speaker-btn');
  btn.classList.toggle('active', voiceEnabled);
  btn.querySelector('.material-symbols-outlined').textContent = voiceEnabled ? 'volume_up' : 'volume_off';
  btn.title = voiceEnabled ? 'Announcements on (click to mute)' : 'Announcements off (click to enable)';
  if (voiceEnabled) speak('Announcements on');
  else stopSpeaking();
});

// ── Groq API key (Whisper voice input + coach explanations) ──

function getApiKey() { try { return localStorage.getItem('groq_api_key') || ''; } catch { return ''; } }
function saveApiKey(k) { try { localStorage.setItem('groq_api_key', k.trim()); } catch {} }

function showKeySetup() {
  const setup = document.getElementById('ai-setup');
  setup.style.display = 'flex';
  document.getElementById('api-key-input').focus();
}

document.getElementById('api-key-save').addEventListener('click', () => {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key) return;
  saveApiKey(key);
  document.getElementById('ai-setup').style.display = 'none';
  showVoicePanel();
  addChatMessage('ai', 'Groq key saved.');
  if (typeof refreshCoach === 'function') refreshCoach();
});

document.getElementById('api-key-input').value = getApiKey();

// ── Groq Whisper transcription ──

async function transcribeAudio(blob) {
  const ext  = blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('file', blob, `recording.${ext}`);
  form.append('model', 'whisper-large-v3-turbo');
  form.append('language', 'en');
  form.append('prompt', 'Chess moves: knight f3, bishop takes e5, pawn d4, queen h5, rook a1, castle kingside.');
  const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${getApiKey()}` },
    body: form,
  });
  if (!resp.ok) {
    const e = await resp.json().catch(() => ({}));
    throw new Error(`Whisper ${resp.status}: ${e.error?.message || ''}`);
  }
  return (await resp.json()).text?.trim();
}

// Converts phonetic Whisper output to standard chess notation before sending to AI.
// e.g. "Night Sea Three" → "knight c3", "Bee Four" → "b4"
function normalizeChessTranscript(text) {
  // Strip accents first so "Rúk"→"Ruk", "Pón"→"Pon", etc.
  let t = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  t = t.toLowerCase().replace(/[''.,!?\-]/g, ' ');

  // Piece name mishearings
  t = t.replace(/\b(nights|night|nite|nigt|knite|naight)\b/g,                    'knight');
  t = t.replace(/\bb\s*(sup|sap|sub|supp|sop|sab|zap|sep|sob)\b/g,               'bishop');
  t = t.replace(/\b(bsup|bisup|bischop|bishup|bsab|bsop|bsupp|bisop|bicep|psap|bsep|pisop)\b/g, 'bishop');
  t = t.replace(/\b(ruke|ruk|rug|rúk|rúg|roog)\b/g,                              'rook');
  t = t.replace(/\b(pwn|bone|porn|pan|pond|pone|pony|pound|pawn|pon)\b/g,        'pawn');

  // File letters spoken phonetically
  t = t.replace(/\b(aye|ay|alpha|alfa)\b/g,        'a');
  t = t.replace(/\b(bee|bravo)\b/g,                'b');
  t = t.replace(/\b(sea|see|si|charlie)\b/g,       'c');
  t = t.replace(/\b(dee|delta)\b/g,                'd');
  t = t.replace(/\b(ee|echo)\b/g,                  'e');
  t = t.replace(/\b(eff|ef|foxtrot)\b/g,           'f');
  t = t.replace(/\b(gee|jee|golf)\b/g,             'g');
  t = t.replace(/\b(aitch|ach|each|hotel|age)\b/g, 'h'); // 'age' sounds like 'h' in Whisper

  // Numbers spoken as words
  t = t.replace(/\bone\b/g,               '1');
  t = t.replace(/\btwo\b/g,               '2');
  t = t.replace(/\b(three|tree|free)\b/g, '3');
  t = t.replace(/\b(four|for|fore)\b/g,   '4');
  t = t.replace(/\bfive\b/g,              '5');
  t = t.replace(/\bsix\b/g,               '6');
  t = t.replace(/\bseven\b/g,             '7');
  t = t.replace(/\b(eight|ate)\b/g,       '8');

  // Merged file+rank spoken as one word: "efive"→"e5", "dtwo"→"d2", etc.
  const _rw = { one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',ate:'8',for:'4',fore:'4',tree:'3',free:'3' };
  t = t.replace(/\b([a-h])(one|two|three|fore|four|for|five|six|seven|eight|ate|tree|free)\b/g,
    (_, file, rank) => file + (_rw[rank] || rank));

  // Merge spaced file+rank: "c 3" → "c3"
  t = t.replace(/\b([a-h])\s+([1-8])\b/g, '$1$2');

  return t.replace(/\s+/g, ' ').trim();
}

// Returns true only if the transcript contains recognisable chess intent.
// Prevents random words / background noise from reaching the AI.
function looksLikeChessInput(text) {
  const t = text.toLowerCase();
  // includes common Whisper mishearings: bsup/bisup=bishop, nite/nigt=knight, ruk/ruke=rook
  const hasPiece  = /\b(knight|night|nite|nigt|horse|bishop|bsup|bisup|rook|ruke|ruk|tower|queen|king|pawn|castle|castling|kingside|queenside)\b/.test(t);
  const hasSquare = /\b[a-h]\s*[1-8]\b/.test(t);
  const hasCmd    = /\bresign\b/.test(t);
  return hasPiece || hasSquare || hasCmd;
}

// ── Chess intent parser ──

const PIECE_NAMES  = { knight: 'n', horse: 'n', night: 'n', bishop: 'b', rook: 'r', tower: 'r', rock: 'r', queen: 'q', king: 'k', pawn: 'p' };
const PIECE_LABELS = { n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king', p: 'pawn' };

function parseVoiceMove(raw) {
  let t = raw.toLowerCase()
    .replace(/[''.,!?]/g, '')
    .replace(/\bone\b/g,   '1').replace(/\btwo\b/g,   '2')
    .replace(/\bthree\b/g, '3').replace(/\bfour\b/g,  '4')
    .replace(/\bfive\b/g,  '5').replace(/\bsix\b/g,   '6')
    .replace(/\bseven\b/g, '7').replace(/\beight\b/g, '8')
    .replace(/\bate\b/g,   '8').replace(/\bfor\b/g,   '4')
    .replace(/\bsee\b/g,   'c').replace(/\bsea\b/g,   'c')
    .replace(/\bbee\b/g,   'b').replace(/\bgee\b/g,   'g')
    .replace(/\baitch\b/g, 'h').replace(/\beach\b/g,  'h')
    .replace(/\bage\b/g,   'h') // 'age' sounds like 'h' in Whisper
    .replace(/\baye\b/g,   'a')
    // merged file+rank: "efive"→"e5", "dtwo"→"d2", etc.
    .replace(/\b([a-h])(one|two|three|fore|four|for|five|six|seven|eight|ate|tree|free)\b/g,
      (_, f, r) => f + ({ one:'1',two:'2',three:'3',four:'4',five:'5',six:'6',seven:'7',eight:'8',ate:'8',for:'4',fore:'4',tree:'3',free:'3' }[r] || r))
    .replace(/\b([a-h])\s+([1-8])\b/g, '$1$2')
    .replace(/\s+/g, ' ').trim();

  if (/king\s*side|short\s*castle|castle\s*king/i.test(t))  return { type: 'castle', side: 'k' };
  if (/queen\s*side|long\s*castle|castle\s*queen/i.test(t)) return { type: 'castle', side: 'q' };
  if (/\bcastles?\b/i.test(t))                               return { type: 'castle', side: 'k' }; // default to kingside

  let pieceType = null;
  for (const [word, type] of Object.entries(PIECE_NAMES)) {
    if (new RegExp(`\\b${word}\\b`).test(t)) { pieceType = type; break; }
  }

  const squares = [...t.matchAll(/\b([a-h][1-8])\b/g)].map(m => m[1]);
  if (!squares.length) return null;

  return {
    type:      'move',
    pieceType: pieceType || 'p',
    targetSq:  squares[squares.length - 1],
    fromSq:    squares.length >= 2 ? squares[0] : null,
  };
}

function handleTranscript(text) {
  // ── Resign confirmation flow ──
  if (awaitingResignConfirmation) {
    if (/\byes\b|\byeah\b|\byep\b|\bsure\b|\bconfirm\b/i.test(text)) {
      awaitingResignConfirmation = false;
      hideResignModal();
      confirmResign();
    } else if (/\bno\b|\bnope\b|\bcancel\b/i.test(text)) {
      awaitingResignConfirmation = false;
      hideResignModal();
    } else {
      const reply = 'Please say yes or no.';
      addChatMessage('ai', reply); speak(reply);
    }
    return;
  }

  // ── Resign command ──
  if (/\bresign\b/i.test(text)) {
    if (!gameActive) {
      const reply = 'No active game.';
      addChatMessage('ai', reply); speak(reply); return;
    }
    awaitingResignConfirmation = true;
    showResignModal();
    const reply = 'Are you sure you want to resign?';
    addChatMessage('ai', reply); speak(reply); return;
  }

  if (/\btake\s*back\b|\bundo\b/i.test(text)) {
    doTakeback();
    const reply = 'Takeback granted. Your move.';
    addChatMessage('ai', reply); speak(reply); return;
  }

  const parsed = parseVoiceMove(text);
  console.log('[Parse] input:', text, '| parsed:', JSON.stringify(parsed));

  if (!parsed) {
    console.log('[Parse] FAIL — no move found');
    const reply = 'Say a piece and square — for example, "knight e4" or "pawn to d5".';
    addChatMessage('ai', reply); speak(reply); return;
  }

  if (!gameActive || waitingForEngine || chess.turn() !== playerColor || inReviewMode()) {
    console.log('[Parse] SKIP — not player turn');
    const reply = "It's not your turn right now.";
    addChatMessage('ai', reply); speak(reply); return;
  }

  if (parsed.type === 'castle') {
    const san   = parsed.side === 'k' ? 'O-O' : 'O-O-O';
    const legal = chess.moves({ verbose: true });
    const m     = legal.find(mv => mv.san === san);
    if (m) {
      const reply = sanToSpeech(m.san);
      addChatMessage('ai', reply); // executeMove announces it
      console.log('[Voice] executing move:', m.san, '|', m.from + m.to);
      executeMove(m.from, m.to, null);
    } else {
      console.log('[Parse] FAIL — castling not legal');
      const reply = "You can't castle right now.";
      addChatMessage('ai', reply); speak(reply);
    }
    return;
  }

  const { pieceType, targetSq, fromSq } = parsed;
  let candidates = chess.moves({ verbose: true }).filter(m => m.to === targetSq);
  if (pieceType) candidates = candidates.filter(m => m.piece === pieceType);
  if (fromSq)   candidates = candidates.filter(m => m.from === fromSq);

  if (candidates.length > 1 && candidates.every(m => m.flags.includes('p'))) {
    candidates = candidates.filter(m => m.promotion === 'q');
  }

  if (candidates.length === 0) {
    console.log('[Parse] FAIL — no candidates for piece:', pieceType, 'to:', targetSq);
    const reply = `No legal ${PIECE_LABELS[pieceType] || 'piece'} move to ${targetSq}.`;
    addChatMessage('ai', reply); speak(reply); return;
  }
  if (candidates.length === 1) {
    const m     = candidates[0];
    const reply = sanToSpeech(m.san);
    addChatMessage('ai', reply); // executeMove announces it
    console.log('[Voice] executing move:', m.san, '|', m.from + m.to);
    executeMove(m.from, m.to, m.promotion || null); return;
  }

  console.log('[Parse] AMBIGUOUS — candidates:', candidates.map(m => m.san).join(', '));
  const reply = `Ambiguous — did you mean ${candidates.map(m => m.san).join(' or ')}?`;
  addChatMessage('ai', reply); speak(reply);
}

// ── UI helpers ──

function updateMicUI() {
  const dot = document.getElementById('voice-dot');
  const lbl = document.getElementById('voice-status-text');
  micBtn.classList.toggle('recording', listening);
  micBtn.classList.toggle('thinking',  processing);
  dot.classList.toggle('recording',    listening);
  dot.classList.toggle('thinking',     processing);
  if      (listening)  lbl.textContent = 'Listening… tap the mic when done';
  else if (processing) lbl.textContent = 'Processing…';
  else                 lbl.textContent = micAlwaysOn ? 'Hands-free: listens on your turn' : 'Tap the mic (or press M) to speak';
}

function showVoicePanel() {
  document.getElementById('voice-panel').style.display = 'flex';
}

function addChatMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg chat-${role}`;
  el.textContent = text;
  if (role === 'system') el.dataset.system = '1';
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
}

// ===== Material ripple effect =====
document.addEventListener('pointerdown', e => {
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  const rect   = btn.getBoundingClientRect();
  const size   = Math.max(rect.width, rect.height) * 2.2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - rect.left - size / 2}px;top:${e.clientY - rect.top - size / 2}px`;
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
});

// ===== Arrow & circle annotations =====
// Geometry and colours follow Lichess's board (chessground): sizes are fractions of a square.

const ARROW_COLOR = 'rgba(0, 200, 80, 0.85)'; // fallback for analysis arrows without a colour

const BRUSHES = {
  green:  '#15781B',
  red:    '#882020',
  blue:   '#003088',
  yellow: '#e68f00',
};
const BRUSH_LINE_WIDTH   = 10 / 64;
const BRUSH_CIRCLE_WIDTH = 4 / 64;
const ANNOTATION_OPACITY = 0.6; // Lichess draws the whole shape layer at 60%

// Right-click = green, +Shift/Ctrl = red, +Alt = blue, +Shift/Ctrl+Alt = yellow
function eventBrush(e) {
  const mod = e.shiftKey || e.ctrlKey;
  const alt = e.altKey || e.metaKey;
  return ['green', 'red', 'blue', 'yellow'][(mod ? 1 : 0) + (alt ? 2 : 0)];
}

function sqCenter(sq, squareSize, flipped) {
  const file = sq.charCodeAt(0) - 97;
  const rank = parseInt(sq[1]) - 1;
  const col  = flipped ? 7 - file : file;
  const row  = flipped ? rank : 7 - rank;
  return {
    x: (col + 0.5) * squareSize,
    y: (row + 0.5) * squareSize,
  };
}

function renderAnnotations() {
  const svg = document.getElementById('board-arrows');
  if (!svg) return;
  svg.innerHTML = '';

  const engineArrows = coachArrow ? [...analysisArrows, coachArrow] : analysisArrows;
  const hasContent = annotations.length > 0 || arrowDrawStart || engineArrows.length > 0;
  if (!hasContent) return;

  const boardEl   = document.getElementById('board');
  const boardRect = boardEl.getBoundingClientRect();
  const svgRect   = svg.getBoundingClientRect();
  const size      = boardRect.width / 8;
  const flipped   = (playerColor === 'b') !== manualFlip;
  const ns        = 'http://www.w3.org/2000/svg';

  const defs = document.createElementNS(ns, 'defs');
  svg.appendChild(defs);

  // The SVG spans #board-wrap, which also holds the eval bar — shift onto the board itself
  const root = document.createElementNS(ns, 'g');
  root.setAttribute('transform', `translate(${boardRect.left - svgRect.left}, ${boardRect.top - svgRect.top})`);
  svg.appendChild(root);

  // Lichess arrowhead: sized in stroke-width units, so it scales with the line
  for (const [key, color] of Object.entries(BRUSHES)) {
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', 'cg-' + key);
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('overflow', 'visible');
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refX', '2.05');
    marker.setAttribute('refY', '2');
    const mp = document.createElementNS(ns, 'path');
    mp.setAttribute('d', 'M0,0 V4 L3,2 Z');
    mp.setAttribute('fill', color);
    marker.appendChild(mp);
    defs.appendChild(marker);
  }

  // Engine arrows: one marker per colour they use
  const engineColors = [...new Set(engineArrows.map(a => a.color || ARROW_COLOR))];
  engineColors.forEach((color, i) => {
    const marker = document.createElementNS(ns, 'marker');
    marker.setAttribute('id', 'ah' + i);
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('overflow', 'visible');
    marker.setAttribute('markerWidth', '4');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refX', '2.05');
    marker.setAttribute('refY', '2');
    const mp = document.createElementNS(ns, 'path');
    mp.setAttribute('d', 'M0,0 V4 L3,2 Z');
    mp.setAttribute('fill', color);
    marker.appendChild(mp);
    defs.appendChild(marker);
  });

  // Engine arrows first (underneath), then user shapes plus the one being drawn
  const shapes = engineArrows.map(a => ({
    type: 'arrow', from: a.from, to: a.to, engine: true,
    color: a.color || ARROW_COLOR, opacity: a.opacity ?? 1, width: a.width ?? BRUSH_LINE_WIDTH,
    marker: 'ah' + engineColors.indexOf(a.color || ARROW_COLOR),
  }));
  annotations.forEach(a => shapes.push({ ...a, current: false }));
  if (arrowDrawStart && arrowDrawStart.from) {
    const to = arrowDrawStart.to && arrowDrawStart.to !== arrowDrawStart.from ? arrowDrawStart.to : null;
    shapes.push({ type: to ? 'arrow' : 'circle', from: arrowDrawStart.from, to, brush: arrowDrawStart.brush, current: true });
  }

  const layer = document.createElementNS(ns, 'g');
  layer.setAttribute('opacity', ANNOTATION_OPACITY);
  root.appendChild(layer);

  shapes.forEach(s => {
    const brush   = BRUSHES[s.brush] ? s.brush : 'green';
    const color   = s.engine ? s.color : BRUSHES[brush];
    const opacity = s.engine ? s.opacity : (s.current ? 0.9 : 1);

    if (s.type === 'circle') {
      const c      = sqCenter(s.from, size, flipped);
      const width  = BRUSH_CIRCLE_WIDTH * size;
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', c.x);
      circle.setAttribute('cy', c.y);
      circle.setAttribute('r', size / 2 - width / 2);
      circle.setAttribute('stroke', color);
      circle.setAttribute('stroke-width', width);
      circle.setAttribute('fill', 'none');
      circle.setAttribute('opacity', opacity);
      layer.appendChild(circle);
      return;
    }

    // Arrows that share a destination stop further back so their heads don't overlap
    const shared  = !s.current && shapes.some(o => o !== s && o.type === 'arrow' && o.to === s.to && o.from !== s.from);
    const margin  = (shared ? 20 / 64 : 10 / 64) * size;
    const a       = sqCenter(s.from, size, flipped);
    const b       = sqCenter(s.to,   size, flipped);
    const angle   = Math.atan2(b.y - a.y, b.x - a.x);
    const line    = document.createElementNS(ns, 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x - Math.cos(angle) * margin);
    line.setAttribute('y2', b.y - Math.sin(angle) * margin);
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', (s.engine ? s.width : BRUSH_LINE_WIDTH) * size);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('marker-end', 'url(#' + (s.engine ? s.marker : 'cg-' + brush) + ')');
    line.setAttribute('opacity', opacity);
    layer.appendChild(line);
  });
}

// Square size changes with the window, so redraw shapes at the new geometry
window.addEventListener('resize', () => renderAnnotations());

function clearAnnotations() {
  annotations = [];
  arrowDrawStart = null;
  renderAnnotations();
}

// Right-click drag on board-wrap for arrow drawing
const boardWrap = document.getElementById('board-wrap');

boardWrap.addEventListener('mousedown', e => {
  if (e.button === 0) { clearAnnotations(); return; }
  if (e.button !== 2) return;
  e.preventDefault();
  const sqEl = e.target.closest('[data-sq]');
  if (!sqEl) return;
  arrowDrawStart = { from: sqEl.dataset.sq, to: null, brush: eventBrush(e) };
  renderAnnotations();
});

boardWrap.addEventListener('mousemove', e => {
  if (!arrowDrawStart) return;
  const sqEl = e.target.closest('[data-sq]');
  if (!sqEl) return;
  const sq = sqEl.dataset.sq;
  if (sq !== arrowDrawStart.to) {
    arrowDrawStart = { ...arrowDrawStart, to: sq !== arrowDrawStart.from ? sq : null };
    renderAnnotations();
  }
});

boardWrap.addEventListener('mouseup', e => {
  if (e.button !== 2 || !arrowDrawStart) return;
  e.preventDefault();
  const sqEl  = e.target.closest('[data-sq]');
  const sq    = sqEl ? sqEl.dataset.sq : null;
  const from  = arrowDrawStart.from;
  const brush = arrowDrawStart.brush;
  arrowDrawStart = null;

  const shape = (!sq || sq === from)
    ? { type: 'circle', from, brush }
    : { type: 'arrow', from, to: sq, brush };

  // Lichess toggling: same shape + same colour removes it, a different colour replaces it
  const same    = a => a.type === shape.type && a.from === shape.from && a.to === shape.to;
  const similar = annotations.find(same);
  annotations   = annotations.filter(a => !same(a));
  if (!similar || similar.brush !== brush) annotations.push(shape);
  renderAnnotations();
});

// ===== PGN Import =====

// meta (optional): { color: 'w'|'b', you, opponent } — orients the board and labels the accuracy summary
function loadPGN(pgnText, meta = null) {
  // Parse the PGN using a temporary Chess instance
  const temp = new Chess();
  if (!temp.load_pgn(pgnText.trim())) return false;
  if (analysisMode) exitAnalysisMode(); // drop the previous game's analysis cache

  // Replay move by move from the start to build all snapshots
  const history    = temp.history({ verbose: true });
  const replayChess = new Chess();

  const newMoveList    = [];
  const newFenHistory  = [replayChess.fen()];
  const newBoardHistory = [replayChess.board()];
  const newCheckHistory = [{ inCheck: false, turn: 'w' }];
  const newMoveFromTo  = [];

  for (const mv of history) {
    const result = replayChess.move({ from: mv.from, to: mv.to, promotion: mv.promotion });
    if (!result) break;
    newMoveList.push(result.san);
    newFenHistory.push(replayChess.fen());
    newBoardHistory.push(replayChess.board());
    newCheckHistory.push({ inCheck: replayChess.in_check(), turn: replayChess.turn() });
    newMoveFromTo.push({ from: mv.from, to: mv.to });
  }

  // Stop any active game / engine
  sendCmd('stop');
  if (pendingEngineTimeout) { clearTimeout(pendingEngineTimeout); pendingEngineTimeout = null; }
  gameId++;

  // Apply state
  chess        = replayChess;
  moveList     = newMoveList;
  fenHistory   = newFenHistory;
  boardHistory = newBoardHistory;
  checkHistory = newCheckHistory;
  moveFromTo   = newMoveFromTo;
  viewIndex    = fenHistory.length - 1; // land on last position
  lastMove     = newMoveFromTo.length > 0 ? newMoveFromTo[newMoveFromTo.length - 1] : null;

  gameActive       = false;
  waitingForEngine = false;
  selectedSq       = null;
  legalTargets     = [];
  premove          = null;
  playerColor      = meta ? meta.color : 'w'; // white's side by default; user can flip with F
  reviewNames      = meta ? { you: meta.you, opponent: meta.opponent } : null;

  // Show the side panel without making it a live game
  hideHomeScreen();
  document.getElementById('side-panel').style.display  = 'flex';
  document.getElementById('main').style.justifyContent = '';
  document.getElementById('resign-btn').classList.remove('visible');
  document.getElementById('top-new-game-btn').classList.remove('in-game');
  document.getElementById('gameover-overlay').style.display = 'none';
  document.getElementById('resign-btn').disabled = true;

  renderBoard();
  renderMoveHistory();
  updateNavButtons();
  setStatus(`PGN loaded — ${newMoveList.length} moves. Use ← → to step through.`);
  return true;
}

document.getElementById('import-close').addEventListener('click', () => {
  document.getElementById('import-modal').style.display = 'none';
});

document.getElementById('import-modal').addEventListener('click', e => {
  if (e.target === document.getElementById('import-modal')) {
    document.getElementById('import-modal').style.display = 'none';
  }
});

document.getElementById('import-load-btn').addEventListener('click', () => {
  const pgn = document.getElementById('import-pgn-input').value;
  const errEl = document.getElementById('import-error');
  if (!pgn.trim()) { errEl.textContent = 'Paste a PGN first.'; return; }
  if (!loadPGN(pgn)) {
    errEl.textContent = 'Invalid PGN — check the format and try again.';
    return;
  }
  document.getElementById('import-modal').style.display = 'none';
  document.getElementById('import-pgn-input').value = '';
  errEl.textContent = '';
});

// ===== Lichess Import =====
// Public API, no token needed: https://lichess.org/api#tag/Games/operation/apiGamesUser

const LICHESS_USER      = 'Th43rdl1f3';
const LICHESS_MAX_GAMES = 100; // per category — also the pool Randomize picks from
const LICHESS_PERF_NAME = { blitz: 'Blitz', rapid: 'Rapid', bullet: 'Bullet' };

let lichessPerf = 'rapid';
const lichessGames = {}; // perf → { games: [], done, error } — fetched once per session

function openImportModal() {
  document.getElementById('import-error').textContent = '';
  document.getElementById('lichess-user-name').textContent = LICHESS_USER;
  document.getElementById('import-modal').style.display = 'flex';
  selectLichessPerf(lichessPerf);
}

function selectLichessPerf(perf) {
  lichessPerf = perf;
  document.querySelectorAll('.lichess-cat').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.perf === perf));
  if (!lichessGames[perf] || lichessGames[perf].error) loadLichessCategory(perf);
  renderLichessGames();
}

async function loadLichessCategory(perf) {
  const entry = { games: [], done: false, error: null };
  lichessGames[perf] = entry;
  try {
    const params = new URLSearchParams({
      max: LICHESS_MAX_GAMES,
      perfType: perf,
      pgnInJson: 'true',
      clocks: 'false',
      evals: 'false',
    });
    const resp = await fetch(`https://lichess.org/api/games/user/${LICHESS_USER}?${params}`, {
      headers: { Accept: 'application/x-ndjson' },
    });
    if (resp.status === 429) throw new Error('Lichess rate limit hit — wait a minute and try again.');
    if (!resp.ok) throw new Error(`Lichess error (${resp.status}).`);

    // NDJSON stream: one game per line, rendered as they arrive
    const reader  = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      const fresh = lines.filter(Boolean).map(l => JSON.parse(l));
      if (fresh.length) {
        entry.games.push(...fresh);
        if (lichessPerf === perf) renderLichessGames();
      }
    }
    if (buf.trim()) entry.games.push(JSON.parse(buf));
  } catch (err) {
    entry.error = err.message || 'Could not reach Lichess.';
  }
  entry.done = true;
  if (lichessPerf === perf) renderLichessGames();
}

function lichessPlayerName(p) {
  if (p.user) return p.user.name;
  if (p.aiLevel) return `Stockfish lvl ${p.aiLevel}`;
  return 'Anonymous';
}

// Players / result from my point of view
function lichessGameInfo(g) {
  const white  = lichessPlayerName(g.players.white);
  const black  = lichessPlayerName(g.players.black);
  const color  = white.toLowerCase() === LICHESS_USER.toLowerCase() ? 'w' : 'b';
  const result = !g.winner ? 'draw' : (g.winner === (color === 'w' ? 'white' : 'black') ? 'win' : 'lose');
  return { white, black, color, result };
}

function loadLichessGame(g) {
  const { white, black, color } = lichessGameInfo(g);
  const ok = loadPGN(g.pgn, {
    color,
    you:      color === 'w' ? white : black,
    opponent: color === 'w' ? black : white,
  });
  if (!ok) {
    document.getElementById('import-error').textContent = 'Could not parse that game.';
    return;
  }
  document.getElementById('import-modal').style.display = 'none';
  setViewIndex(0);
  enterAnalysisMode();
}

function renderLichessGames() {
  const list    = document.getElementById('lichess-games-list');
  const randBtn = document.getElementById('lichess-randomize-btn');
  const entry   = lichessGames[lichessPerf];
  const name    = LICHESS_PERF_NAME[lichessPerf];
  const games   = entry ? entry.games : [];

  randBtn.disabled = !games.length;
  list.innerHTML = '';

  if (!games.length) {
    const msg = !entry || !entry.done ? `Loading ${name.toLowerCase()} games…`
      : entry.error ? entry.error
      : `No ${name.toLowerCase()} games found.`;
    list.innerHTML = `<div class="lichess-status">${msg}</div>`;
    return;
  }

  games.forEach(g => {
    const { white, black, result } = lichessGameInfo(g);
    const rating = p => p.rating ? ` (${p.rating})` : '';

    const item = document.createElement('div');
    item.className = 'lichess-game';
    const resEl = document.createElement('span');
    resEl.className = 'lichess-game-result ' + result;
    resEl.textContent = { win: 'W', lose: 'L', draw: '½' }[result];
    const playersEl = document.createElement('span');
    playersEl.className = 'lichess-game-players';
    playersEl.textContent = `${white}${rating(g.players.white)} vs ${black}${rating(g.players.black)}`;
    const metaEl = document.createElement('span');
    metaEl.className = 'lichess-game-meta';
    metaEl.textContent = new Date(g.createdAt).toLocaleDateString();
    item.append(resEl, playersEl, metaEl);
    item.addEventListener('click', () => loadLichessGame(g));
    list.appendChild(item);
  });

  if (!entry.done) {
    list.insertAdjacentHTML('beforeend', '<div class="lichess-status">Loading more…</div>');
  }
}

document.getElementById('top-import-btn').addEventListener('click', openImportModal);
document.querySelectorAll('.lichess-cat').forEach(btn =>
  btn.addEventListener('click', () => selectLichessPerf(btn.dataset.perf)));
document.getElementById('lichess-randomize-btn').addEventListener('click', () => {
  const games = lichessGames[lichessPerf]?.games || [];
  if (games.length) loadLichessGame(games[Math.floor(Math.random() * games.length)]);
});

// ===== Analysis event listeners =====

document.getElementById('analysis-toggle-btn').addEventListener('click', () => {
  if (analysisMode) exitAnalysisMode();
  else              enterAnalysisMode();
});

document.getElementById('gameover-analyze-btn').addEventListener('click', () => {
  document.getElementById('gameover-overlay').style.display = 'none';
  // Keep side panel visible
  document.getElementById('resign-btn').classList.remove('visible');
  document.getElementById('top-new-game-btn').classList.remove('in-game');
  enterAnalysisMode();
});

// ===== Layout =====
// Wide screens get four columns: voice | board | moves + analysis | coach.
// Narrower screens keep everything in the side panel.

const WIDE_LAYOUT = window.matchMedia('(min-width: 1500px)');

function placeColumns() {
  const side   = document.getElementById('side-panel');
  const nav    = document.getElementById('nav-controls');
  const voice  = document.getElementById('voice-panel');
  const keyBox = document.getElementById('ai-setup');
  const coach  = document.getElementById('coach-panel');
  if (WIDE_LAYOUT.matches) {
    document.getElementById('left-col').append(voice, keyBox);
    document.getElementById('coach-col').append(coach);
    voice.style.display = 'flex'; // the left column is the voice column — always show it
  } else {
    document.getElementById('analysis-panel').after(coach);
    side.insertBefore(keyBox, nav);
    side.insertBefore(voice, nav);
  }
  renderAnnotations();
  renderEvalGraph();
}
WIDE_LAYOUT.addEventListener('change', placeColumns);

// ===== Boot =====
placeColumns();
initCevalControls();
applyBoardTheme(boardTheme);
updateEloBadge();
renderBoard();
initEngine();
updateNavButtons();
document.getElementById('side-panel').style.display = 'flex';
showHomeScreen();
