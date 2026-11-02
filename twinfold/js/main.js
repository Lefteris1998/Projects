/* TWINFOLD — game shell: loop, input, screens, progress. */
(function () {
  'use strict';
  const E = window.Engine, R = window.Render, S = window.Sound, LV = window.LEVELS;
  const STEP = 1 / 240, T = E.T;
  const $ = id => document.getElementById(id);
  const frameEl = $('frame'), canvas = $('game');
  R.init(canvas);

  /* ---------- progress ---------- */
  const unlockAll = /[?&]all\b/.test(location.search);
  // v2 is the fifteen-chamber layout. best = fewest portals, time = fastest clear in seconds
  const SAVE_KEY = 'twinfold.save.v2';
  let save = { unlocked: 1, best: {}, time: {} };
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) save = Object.assign(save, JSON.parse(raw)); } catch (e) { /* storage blocked */ }
  if (!save.time) save.time = {};
  const persist = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) { /* ignore */ } };
  const isOpen = i => unlockAll || i < save.unlocked;

  /* ---------- state ---------- */
  let mode = 'title';           // title | select | play | pause | clear
  let s = null, idx = 0, acc = 0, last = performance.now(), fadeIn = 1, clearShown = false, ambientFor = -1;
  let demo = null;               // { s, idx, pilot, endT }
  const aimS = { x: 320, y: 176 };            // cursor on screen (view pixels)
  const aim = { x: 320, y: 176 };             // cursor in the world
  const cam = { x: 0, y: 0 };
  let snap = null, deaths = 0, wantSnap = false; // checkpoint snapshot, deaths this visit
  // speedrun clock: runTime restarts with the chamber (R, or a death with no brazier lit); totalTime counts the whole visit
  let runTime = 0, totalTime = 0, tries = 1, hintText = '', hintT = 0;
  const fmt = (t, cs = true) => { const m = Math.floor(t / 60), sec = t - m * 60; return m + ':' + (sec < 10 ? '0' : '') + (cs ? sec.toFixed(2) : Math.floor(sec)); };
  const keys = {};
  let jumpEdge = false, grabEdge = false, shootQ = -1;

  /* ---------- layout ---------- */
  function layout() {
    const sc = Math.min(window.innerWidth / E.W, window.innerHeight / E.H);
    const k = sc >= 2 ? Math.floor(sc) : Math.max(0.5, sc);
    frameEl.style.width = E.W * k + 'px';
    frameEl.style.height = E.H * k + 'px';
    frameEl.style.setProperty('--u', k + 'px');
  }
  window.addEventListener('resize', layout);
  layout();

  /* ---------- input ---------- */
  const LEFT = ['KeyA', 'ArrowLeft'], RIGHT = ['KeyD', 'ArrowRight'], JUMP = ['KeyW', 'ArrowUp', 'Space'];
  window.addEventListener('keydown', e => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    S.ensure();
    if (e.repeat) { keys[e.code] = true; return; }
    keys[e.code] = true;
    if (mode === 'play') {
      if (JUMP.includes(e.code)) jumpEdge = true;
      if (e.code === 'KeyE' || e.code === 'KeyF') grabEdge = true;
      if (e.code === 'KeyR') restart();
      if (e.code === 'Escape' || e.code === 'KeyP') setMode('pause');
    } else if (mode === 'pause') {
      if (e.code === 'Escape' || e.code === 'KeyP') resume();
      if (e.code === 'KeyR') { resume(); restart(); }
    } else if (mode === 'clear') {
      if (e.code === 'Enter' || e.code === 'Space') next();
      if (e.code === 'KeyR') retry();
    } else if (mode === 'select' && e.code === 'Escape') setMode('title');
    if (e.code === 'KeyM') toggleMute();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (mode === 'play') setMode('pause'); });
  const held = list => list.some(k => keys[k]);

  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    aimS.x = Math.max(0, Math.min(E.W, (e.clientX - r.left) / r.width * E.W));
    aimS.y = Math.max(0, Math.min(E.H, (e.clientY - r.top) / r.height * E.H));
    aim.x = cam.x + aimS.x; aim.y = cam.y + aimS.y;
  }
  window.addEventListener('mousemove', toGame);
  canvas.addEventListener('mousedown', e => {
    S.ensure(); toGame(e);
    if (mode !== 'play') return;
    if (e.button === 0) shootQ = 0;
    else if (e.button === 2) shootQ = 1;
    e.preventDefault();
  });
  window.addEventListener('contextmenu', e => { if (mode === 'play' || e.target === canvas) e.preventDefault(); });

  /* ---------- levels ---------- */
  function camFollow(st, dt, instant) {
    const t = E.camTarget(st, aimS.x, aimS.y);
    const k = instant ? 1 : 1 - Math.exp(-dt * 8);
    cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
    aim.x = cam.x + aimS.x; aim.y = cam.y + aimS.y;
  }
  function loadLevel(i, keepDeaths) {
    if (idx !== i || !keepDeaths) { deaths = 0; tries = 1; totalTime = 0; }
    runTime = 0; hintText = LV[i].hint || ''; hintT = 0;
    idx = i; snap = null; wantSnap = false;
    s = E.load(LV[i]);
    s.tpCount = 0; s.lastShot = 0;
    R.buildStatic(s, i);
    camFollow(s, 0, true);
    updateDeaths();
    fadeIn = 1; clearShown = false; acc = 0;
    $('hud-num').textContent = String(i + 1).padStart(2, '0');
    $('hud-name').textContent = LV[i].name;
    updateCount();
    if (ambientFor !== i) { S.startAmbient(i, LV[i].theme === 'volcano'); ambientFor = i; }
  }
  function restart() { if (s) { tries++; loadLevel(idx, true); } }
  function respawn() {
    deaths++; tries++;
    if (snap) {
      s = structuredClone(snap); s.events.length = 0;
      R.rebind(s); camFollow(s, 0, true); fadeIn = 1; acc = 0;
      updateCount(); updateDeaths();
    } else loadLevel(idx, true);
  }
  function updateDeaths() {
    $('hud-deaths').textContent = deaths;
    $('hud-tries').textContent = tries;
    $('hud-deaths-wrap').style.visibility = deaths > 0 || LV[idx].theme === 'volcano' ? 'visible' : 'hidden';
  }
  function updateCount() {
    $('hud-count').textContent = s ? s.shots : 0;
    $('hud-par').textContent = LV[idx].par;
    $('hud-portals').classList.toggle('over', !!s && s.shots > LV[idx].par);
    $('hud-portals').style.visibility = s && s.gun === 0 ? 'hidden' : 'visible';
  }

  function startLevel(i) { demo = null; loadLevel(i); setMode('play'); }

  /* ---------- events -> sound + fx ---------- */
  function nearCam(ev) { return ev.x > cam.x - 40 && ev.x < cam.x + E.W + 40 && ev.y > cam.y - 40 && ev.y < cam.y + E.H + 40; }
  function handleEvents(st, fx, sound) {
    const played = new Set();
    const once = (k, ...a) => { if (!sound || played.has(k)) return; played.add(k); S.play(k, ...a); };
    for (const ev of st.events) {
      if (fx) R.onEvent(ev);
      switch (ev.t) {
        case 'shot': st.lastShot = ev.c; if (ev.ok) once('shot', ev.c); else once(ev.fizz ? 'fizzShot' : 'fail'); break;
        case 'portal': once('portal', ev.c); if (st === s) updateCount(); break;
        case 'tp': if (ev.who === 'player') { st.tpCount = (st.tpCount || 0) + 1; st.lastTp = ev.c; } once('tp', ev.who === 'player' ? ev.speed : 150); break;
        case 'jump': once('jump'); break;
        case 'land': if (ev.v > 180) once('land', ev.v); break;
        case 'button': once('button', ev.on); break;
        case 'door': once('door', ev.open); break;
        case 'recv': once('recv', ev.on); break;
        case 'exit': if (ev.open) once('recv', true); break;
        case 'fizzle': once('fizzle'); break;
        case 'die': once('die'); break;
        case 'cubeGone': once('cubeGone'); break;
        case 'cubeBack': once('cubeBack'); break;
        case 'grab': once('grab'); break;
        case 'drop': once('drop'); break;
        case 'thud': once('thud', ev.v); break;
        case 'win': once('win'); break;
        case 'checkpoint': once('checkpoint'); if (st === s) wantSnap = true; break;
        case 'gun': once('checkpoint'); if (st === s) { updateCount(); const h = LV[idx].gunHint; if (h && h[ev.gun]) { hintText = h[ev.gun]; hintT = st.time; } } break;
        case 'splash': if (nearCam(ev)) once('splash', !!ev.up); break;
        case 'crack': once('crack'); break;
        case 'crumble': once('crumble'); break;
        case 'reform': if (nearCam(ev)) once('reform'); break;
        case 'vent': if (nearCam(ev)) once('vent'); break;
        case 'growl': once('growl'); break;
        case 'chomp': once('chomp'); break;
        case 'monDie': once('monDie'); break;
        case 'spikeShake': once('spikeShake'); break;
        case 'shatter': if (nearCam(ev)) once('shatter'); break;
        case 'rumble': once('rumble'); break;
        case 'sizzle': once('sizzle'); break;
      }
    }
    st.events.length = 0;
    if (wantSnap && st === s) { wantSnap = false; snap = structuredClone(st); }
  }

  /* ---------- demo autopilot (title screen) ---------- */
  function facePoint(cx, cy, f, frac) {
    if (f === 'u') return [cx * T + frac * T, cy * T + 0.5];
    if (f === 'd') return [cx * T + frac * T, (cy + 1) * T - 0.5];
    if (f === 'l') return [cx * T + 0.5, cy * T + frac * T];
    return [(cx + 1) * T - 0.5, cy * T + frac * T];
  }
  // replays a chamber's scripted solution (the same command set tools/sim.js understands)
  function* pilot(def, st) {
    const pl = st.player;
    let a = [pl.x + 100, pl.y], tp = 0;
    const inp = o => Object.assign({ ax: a[0], ay: a[1], shoot: -1 }, o);
    const wait = sec => { const out = []; for (let k = 0; k < sec / STEP; k++) out.push(inp({})); return out; };
    function* until(cond, max = 20) { for (let k = 0; k < max / STEP && !cond(); k++) yield inp({}); }
    yield* wait(0.8);
    for (const cmd of def.sol) {
      const op = cmd[0];
      if (op === 's') {
        const target = facePoint(cmd[2], cmd[3], cmd[4], cmd[5]), from = a.slice();
        for (let k = 1; k <= 24; k++) { const e = k / 24, q = e * e * (3 - 2 * e); a = [from[0] + (target[0] - from[0]) * q, from[1] + (target[1] - from[1]) * q]; yield inp({}); }
        while (st.shotCD > 0) yield inp({});
        yield inp({ shoot: cmd[1] }); yield inp({});
      } else if (op === 'e') yield inp({ grab: true });
      else if (op === 'aim') { a = [cmd[1] * T, cmd[2] * T]; yield* wait(0.1); }
      else if (op === 'to' || op === 'toa') {
        const tx = cmd[1] * T, tp0 = st.tpCount;
        for (let k = 0; k < 12 / STEP; k++) {
          const c = pl.x + pl.w / 2, d = tx - c;
          if (Math.abs(d) < 1.5 || st.tpCount > tp0 || st.won || st.dead) break;
          a = op === 'toa' ? [cmd[2] * T, cmd[3] * T] : [c + Math.sign(d) * 120, pl.y];
          yield inp({ left: d < 0, right: d > 0 });
        }
        yield* wait(0.08);
      } else if (op === 'he') {
        const k = { left: cmd[1].includes('l'), right: cmd[1].includes('r') };
        for (let i = 0; i < cmd[2] / STEP; i++) yield inp(k);
        yield inp(Object.assign({ grab: true }, k));
      } else if (op === 'w') yield* wait(cmd[1]);
      else if (op === 'wg') yield* until(() => pl.ground);
      else if (op === 'wtp') { const t0 = st.tpCount; yield* until(() => st.tpCount > t0); }
      else if (op === 'wyd') yield* until(() => pl.y + pl.h / 2 >= cmd[1] * T);
      else if (op === 'wyu') yield* until(() => pl.y + pl.h / 2 <= cmd[1] * T);
      else if (op === 'wvx') { const v = st.vents.find(o => o.x === cmd[1]); yield* until(() => v.on === !!cmd[2]); }
      else if (op === 'wmx') { const m = st.mons.find(o => o.sx === cmd[1]); yield* until(() => m.dead || Math.abs(m.x / T - cmd[2]) < 0.6); }
      else if (op === 'wmdx') { const m = st.mons.find(o => o.sx === cmd[1]); yield* until(() => m.dead); }
      else if (op === 'wshd') yield* until(() => st.sharks[cmd[1]].dead);
      else if (op === 'wsh') yield* until(() => st.sharks[cmd[1]].mode === 'swim' && st.sharks[cmd[1]].cd > E.PH.sharkCD - 0.05);
      else if (op === 'wc') yield* until(() => st.crumb[cmd[2] * st.cols + cmd[1]].st === cmd[3]);
      else if (op === 'wch') yield* until(() => st.chan[cmd[1]] === !!cmd[2]);
      else if (op === 'wcube') { const c = st.cubes[cmd[1]]; yield* until(() => !c.gone && c.ground && !c.held); }
      else if (op === 'wlava') yield* until(() => st.lavaY <= cmd[1] * T, 60);
      else if (op === 'wt') yield* until(() => st.time >= cmd[1], 60);
      else {
        const first = { left: op.includes('l'), right: op.includes('r'), jump: op.includes('j'), jumpPressed: op.includes('j') };
        yield inp(first);
        const rest = Object.assign({}, first, { jumpPressed: false });
        for (let k = 1; k < cmd[1] / STEP; k++) yield inp(rest);
      }
    }
    for (;;) yield inp({});
  }
  const DEMOS = [1, 4, 7, 2];
  let demoN = 0;
  function startDemo() {
    const i = DEMOS[demoN++ % DEMOS.length];
    const st = E.load(LV[i]); st.tpCount = 0; st.lastShot = 0;
    R.buildStatic(st, i);
    demo = { s: st, idx: i, it: pilot(LV[i], st), endT: 0, fade: 1 };
  }

  /* ---------- screens ---------- */
  const screens = ['title', 'select', 'pause', 'clear'];
  function setMode(m) {
    mode = m;
    for (const n of screens) $(n).classList.toggle('hidden', n !== m);
    $('hud').classList.toggle('hidden', !(m === 'play' || m === 'pause' || m === 'clear'));
    frameEl.classList.toggle('playing', m === 'play');
    if (m === 'select') buildGrid();
    if (m === 'title') { s = null; if (!demo) startDemo(); }
    const focus = { title: 'btn-play', pause: 'btn-resume', clear: 'btn-next' }[m];
    if (focus) setTimeout(() => $(focus).focus({ preventScroll: true }), 30);
  }
  function resume() { last = performance.now(); setMode('play'); }

  function buildGrid() {
    const g = $('grid'); g.innerHTML = '';
    LV.forEach((d, i) => {
      const b = document.createElement('button');
      b.className = 'cell' + (d.theme === 'volcano' ? ' deep' : '');
      const best = save.best[i];
      if (best != null) b.classList.add(best <= d.par ? 'par' : 'done');
      b.disabled = !isOpen(i);
      const bt = save.time[i];
      b.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="nm">${b.disabled ? '' : d.name}</span>` +
        `<span class="tm">${bt != null ? fmt(bt) : ''}</span>` +
        `<span class="sc"><i></i>${best != null ? best + ' / ' + d.par : (b.disabled ? '' : 'par ' + d.par)}</span>`;
      b.addEventListener('click', () => { S.ensure(); S.play('click'); startLevel(i); });
      g.appendChild(b);
    });
    const done = LV.filter((d, i) => save.time[i] != null).length;
    const sum = LV.reduce((a, d, i) => a + (save.time[i] || 0), 0);
    $('sum-time').innerHTML = done === LV.length ? `sum of best times <b>${fmt(sum)}</b>` : done ? `${done} / ${LV.length} cleared  ·  best times so far ${fmt(sum)}` : '';
  }

  function showClear() {
    clearShown = true;
    const d = LV[idx], n = s.shots;
    const prev = save.best[idx];
    save.best[idx] = prev == null ? n : Math.min(prev, n);
    const prevT = save.time[idx], newBest = prevT == null || runTime < prevT;
    if (newBest) save.time[idx] = runTime;
    $('clear-time').textContent = fmt(runTime);
    $('clear-best').textContent = fmt(save.time[idx]);
    $('clear-tries').textContent = tries;
    $('clear-total').textContent = fmt(totalTime, false);
    save.unlocked = Math.max(save.unlocked, Math.min(LV.length, idx + 2));
    persist();
    $('clear-num').textContent = 'Chamber ' + String(idx + 1).padStart(2, '0');
    $('clear-deaths').textContent = deaths;
    $('clear-deaths-wrap').style.display = deaths > 0 || d.theme === 'volcano' ? '' : 'none';
    $('clear-count').textContent = n;
    $('clear-par').textContent = d.par;
    const mk = $('clear-mark');
    const parTxt = n < d.par ? 'under par' : n === d.par ? 'par' : '';
    const beat = newBest && prevT != null;
    mk.className = 'mark' + (beat ? ' best' : n < d.par ? ' under' : n === d.par ? ' par' : '');
    mk.textContent = [beat ? 'new best time' : '', parTxt].filter(Boolean).join('  /  ');
    $('btn-next').textContent = idx + 1 < LV.length ? 'Next' : 'Chambers';
    setMode('clear');
  }
  function next() { S.play('click'); if (idx + 1 < LV.length) startLevel(idx + 1); else setMode('select'); }
  function retry() { S.play('click'); startLevel(idx); }

  $('btn-play').addEventListener('click', () => {
    S.ensure(); S.play('click');
    let i = 0;
    while (i < LV.length - 1 && save.best[i] != null && isOpen(i + 1)) i++;
    startLevel(i);
  });
  $('btn-select').addEventListener('click', () => { S.ensure(); S.play('click'); setMode('select'); });
  $('btn-back').addEventListener('click', () => { S.play('click'); setMode('title'); });
  $('btn-resume').addEventListener('click', () => { S.play('click'); resume(); });
  $('btn-restart').addEventListener('click', () => { S.play('click'); resume(); restart(); });
  $('btn-chambers').addEventListener('click', () => { S.play('click'); setMode('select'); });
  $('btn-next').addEventListener('click', next);
  $('btn-retry').addEventListener('click', retry);
  document.querySelectorAll('.btn').forEach(b => b.addEventListener('mouseenter', () => S.play('hover')));

  /* ---------- mute ---------- */
  const icon = on => {
    const px = on
      ? 'M2 6h3v4H2zM5 5h1v6H5zM6 4h1v8H6zM7 3h1v10H7zM10 6h1v4h-1zM12 4h1v8h-1z'
      : 'M2 6h3v4H2zM5 5h1v6H5zM6 4h1v8H6zM7 3h1v10H7zM10 6h1v1h-1zM13 6h1v1h-1zM11 7h2v2h-2zM10 9h1v1h-1zM13 9h1v1h-1z';
    return `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'><path fill='#e8e6f0' d='${px}'/></svg>`)}")`;
  };
  function toggleMute() { S.setMuted(!S.isMuted()); $('mute').style.backgroundImage = icon(!S.isMuted()); }
  $('mute').style.backgroundImage = icon(!S.isMuted());
  $('mute').addEventListener('click', () => { S.ensure(); toggleMute(); });

  /* ---------- loop ---------- */
  function stepPlay(dt) {
    acc += dt;
    if (!s.dead) camFollow(s, dt, false);
    let first = true;
    while (acc >= STEP) {
      const inp = {
        left: held(LEFT), right: held(RIGHT), jump: held(JUMP),
        jumpPressed: first && jumpEdge, grab: first && grabEdge, shoot: first ? shootQ : -1,
        ax: cam.x + aimS.x, ay: cam.y + aimS.y
      };
      E.step(s, inp, STEP);
      if (!s.won) { runTime += STEP; totalTime += STEP; }
      handleEvents(s, true, true);
      if (first) { jumpEdge = false; grabEdge = false; shootQ = -1; first = false; }
      acc -= STEP;
    }
    $('hud-time').textContent = fmt(runTime);
    if (s.dead && s.endT > 1.05) respawn();
    else if (s.won && s.endT > 0.85 && !clearShown) showClear();
  }

  function stepDemo(dt) {
    if (!demo) return;
    const st = demo.s;
    let n = Math.round(dt / STEP);
    while (n-- > 0) {
      const inp = demo.it.next().value;
      E.step(st, inp, STEP);
      handleEvents(st, true, false);
    }
    if (st.won || st.dead) { demo.endT += dt; if (demo.endT > 1.4) startDemo(); }
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fadeIn = Math.max(0, fadeIn - dt * 2.4);
    if (mode === 'play' && s) {
      stepPlay(dt);
      R.frame(s, { dt, aim, cam, hint: hintText, hintT, fadeIn, title: [String(idx + 1).padStart(2, '0'), LV[idx].name.toUpperCase()] });
    } else if ((mode === 'title' || (mode === 'select' && !s)) && demo) {
      stepDemo(dt);
      demo.fade = Math.max(0, demo.fade - dt * 1.5);
      const end = demo.s.won || demo.s.dead ? Math.min(1, demo.endT / 1.2) : 0;
      const ct = E.camTarget(demo.s);
      if (!demo.cam) demo.cam = { x: ct.x, y: ct.y };
      const k = 1 - Math.exp(-dt * 6); demo.cam.x += (ct.x - demo.cam.x) * k; demo.cam.y += (ct.y - demo.cam.y) * k;
      R.frame(demo.s, { dt, cam: demo.cam, fadeIn: Math.max(demo.fade, end) });
    } else if (s) {
      if (mode === 'clear') E.step(s, {}, dt);
      R.frame(s, { dt: mode === 'clear' ? dt : 0, aim: null, cam, fadeIn });
    }
    requestAnimationFrame(tick);
  }

  setMode('title');
  requestAnimationFrame(tick);

  // test hook for automated playtests
  window.__twinfold = { get state() { return s; }, get mode() { return mode; }, startLevel, get demo() { return demo; }, cam, aimS };
})();
