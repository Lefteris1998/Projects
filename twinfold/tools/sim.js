// Headless level verifier: node tools/sim.js [levelNumber ...] [-v]
// Replays each chamber's scripted solution (def.sol). For scrolling chambers it also checks that every
// shot target could actually be reached with the cursor from where the player stands (camera + look-ahead).
const E = require('../js/engine.js');
const LEVELS = require('../js/chambers.js');

const DT = 1 / 240, T = E.T;
const args = process.argv.slice(2);
const trace = args.includes('-t');
const verbose = args.includes('-v') || trace;
const only = args.filter(a => /^\d+$/.test(a)).map(Number);

function facePoint(cx, cy, f, frac) {
  if (f === 'u') return [cx * T + frac * T, cy * T + 0.5];
  if (f === 'd') return [cx * T + frac * T, (cy + 1) * T - 0.5];
  if (f === 'l') return [cx * T + 0.5, cy * T + frac * T];
  return [(cx + 1) * T - 0.5, cy * T + frac * T];
}

// can the cursor reach world point (tx,ty) from the current player position?
function reachable(s, tx, ty) {
  const M = 4, TOP = 4;
  const lo = E.camTarget(s, M, TOP), hi = E.camTarget(s, E.W - M, E.H - M);
  const x0 = lo.x + M, x1 = hi.x + E.W - M, y0 = lo.y + TOP, y1 = hi.y + E.H - M;
  return tx >= x0 && tx <= x1 && ty >= y0 && ty <= y1;
}

function run(def, n) {
  const problems = [];
  const w = def.map[0].length;
  def.map.forEach((r, i) => { if (r.length !== w) problems.push(`row ${i} len ${r.length}!=${w}`); });
  if (def.map.length < 22 || w < 40) problems.push(`map too small ${w}x${def.map.length}`);
  const s = E.load(def);
  const pl = s.player;
  let aim = [pl.x + 100, pl.y];
  let tps = 0, t = 0;
  const log = [];
  const tick = (inp) => {
    const i = Object.assign({ ax: aim[0], ay: aim[1], shoot: -1 }, inp);
    E.step(s, i, DT); t += DT;
    for (const ev of s.events) {
      if (ev.t === 'tp' && ev.who === 'player') tps++;
      if (verbose && ['tp', 'die', 'win', 'portal', 'fizzle', 'door', 'recv', 'button', 'cubeGone', 'grab', 'drop', 'checkpoint', 'monDie', 'growl', 'crumble', 'rumble', 'gun', 'crack'].includes(ev.t))
        log.push(`  t=${t.toFixed(2)} ${ev.t} ${JSON.stringify(ev).slice(0, 110)}`);
      if (ev.t === 'die') log.push(`  t=${t.toFixed(2)} DIED cause=${ev.cause} at (${(ev.x / T).toFixed(2)},${(ev.y / T).toFixed(2)})`);
      if (ev.t === 'shot' && !ev.ok) log.push(`  t=${t.toFixed(2)} SHOT FAILED c=${ev.c} hit=(${(ev.x1 / T).toFixed(2)},${(ev.y1 / T).toFixed(2)}) fizz=${ev.fizz}`);
    }
    s.events.length = 0;
    if (trace && Math.round(t / DT) % Math.round(0.05 / DT) === 0)
      log.push(`    . t=${t.toFixed(2)} p=(${(pl.x / T).toFixed(2)},${(pl.y / T).toFixed(2)}) v=(${pl.vx.toFixed(0)},${pl.vy.toFixed(0)})${pl.ground ? ' G' : ''}`);
  };
  const hold = (keys, secs) => {
    const first = { left: keys.includes('l'), right: keys.includes('r'), jump: keys.includes('j'), jumpPressed: keys.includes('j') };
    const rest = Object.assign({}, first, { jumpPressed: false });
    tick(first);
    for (let k = 1; k < secs / DT && !s.won && !s.dead; k++) tick(rest);
  };
  let minLava = Infinity;
  const until = (cond, max = 20) => { for (let k = 0; k < max / DT && !s.won && !s.dead && !cond(); k++) tick({}); };
  for (const cmd of def.sol || []) {
    if (s.won || s.dead) break;
    const op = cmd[0];
    if (verbose) log.push(`> ${JSON.stringify(cmd)}  player=(${(pl.x / T).toFixed(2)},${(pl.y / T).toFixed(2)}) v=(${pl.vx.toFixed(0)},${pl.vy.toFixed(0)}) t=${t.toFixed(2)}${s.cubes.map(c => ` cube=(${(c.x / T).toFixed(2)},${(c.y / T).toFixed(2)})`).join("")}${isFinite(s.lavaY) ? ' lava=' + (s.lavaY / T).toFixed(1) : ''}`);
    if (op === 's') {
      aim = facePoint(cmd[2], cmd[3], cmd[4], cmd[5]);
      while (s.shotCD > 0 && !s.dead && !s.won) tick({});
      if (!reachable(s, aim[0], aim[1])) { problems.push(`offscreen shot ${JSON.stringify(cmd)}`); log.push(`  OFFSCREEN ${JSON.stringify(cmd)} from (${(pl.x / T).toFixed(1)},${(pl.y / T).toFixed(1)})`); }
      tick({ shoot: cmd[1] });
      tick({});
    } else if (op === 'e') { tick({ grab: true }); }
    else if (op === 'he') {                           // hold keys for a while, then grab/drop without letting go
      const k = { left: cmd[1].includes('l'), right: cmd[1].includes('r') };
      for (let i = 0; i < cmd[2] / DT && !s.won && !s.dead; i++) tick(k);
      tick(Object.assign({ grab: true }, k));
    }
    else if (op === 'aim') { aim = [cmd[1] * T, cmd[2] * T]; for (let k = 0; k < 0.1 / DT; k++) tick({}); }
    else if (op === 'to' || op === 'toa') {          // toa: walk to x while keeping the aim at (cmd[2], cmd[3])
      const tx = cmd[1] * T, jump = cmd[2] === 'j';
      const tp0 = tps;
      for (let k = 0; k < 12 / DT && !s.won && !s.dead; k++) {
        const c = pl.x + pl.w / 2, d = tx - c;
        if (Math.abs(d) < 1.5 || tps > tp0) break;
        aim = op === 'toa' ? [cmd[2] * T, cmd[3] * T] : [c + Math.sign(d) * 120, pl.y];
        tick({ left: d < 0, right: d > 0, jump, jumpPressed: jump && k === 0 });
      }
      for (let k = 0; k < 0.08 / DT; k++) tick({});
    } else if (op === 'w') hold('', cmd[1]);
    else if (op === 'wt') until(() => s.time >= cmd[1], 60);                       // wait until absolute time
    else if (op === 'wv') until(() => s.vents[cmd[1]].on === !!cmd[2]);              // wait for vent i on(1)/off(0)
    else if (op === 'wg') until(() => pl.ground);                                    // wait until grounded
    else if (op === 'wsh') until(() => s.sharks[cmd[1]].mode === 'swim' && s.sharks[cmd[1]].cd > PH_SHARK - 0.05); // shark just splashed down
    else if (op === 'wm') until(() => { const m = s.mons[cmd[1]]; return m.dead || Math.abs(m.x / T - cmd[2]) < 0.6; }); // monster near x
    else if (op === 'wmd') until(() => s.mons[cmd[1]].dead);
    // position-addressed variants (used by the section builders in levels3.js)
    else if (op === 'wvx') { const v = s.vents.find(o => o.x === cmd[1]); until(() => v.on === !!cmd[2]); }
    else if (op === 'wmx') { const m = s.mons.find(o => o.sx === cmd[1]); until(() => m.dead || Math.abs(m.x / T - cmd[2]) < 0.6); }
    else if (op === 'wmdx') { const m = s.mons.find(o => o.sx === cmd[1]); until(() => m.dead); }
    // waits used by chambers.js
    else if (op === 'wyd') until(() => pl.y + pl.h / 2 >= cmd[1] * T);              // player centre has dropped below row
    else if (op === 'wyu') until(() => pl.y + pl.h / 2 <= cmd[1] * T);              // player centre has risen above row
    else if (op === 'wtp') { const t0 = tps; until(() => tps > t0); }                // next teleport
    else if (op === 'wc') until(() => s.crumb[cmd[2] * s.cols + cmd[1]].st === cmd[3]); // crumbling cell reaches state
    else if (op === 'wch') until(() => s.chan[cmd[1]] === !!cmd[2]);                // channel on/off
    else if (op === 'wcube') { const c = s.cubes[cmd[1]]; until(() => !c.gone && c.ground && !c.held); } // cube settled
    else if (op === 'wshd') until(() => s.sharks[cmd[1]].dead);                   // shark dead
    else if (op === 'wlava') until(() => s.lavaY <= cmd[1] * T);                     // rising lava reached row
    else hold(op, cmd[1]);
    if (isFinite(s.lavaY) && s.riseT > (def.rise.delay || 0)) minLava = Math.min(minLava, (s.lavaY - (pl.y + pl.h)) / T);
  }
  for (let k = 0; k < 4 / DT && !s.won && !s.dead; k++) tick({});
  const ok = s.won && problems.length === 0;
  const parOk = s.shots <= def.par;
  const lava = isFinite(minLava) ? ` lavaMargin=${minLava.toFixed(1)}` : '';
  console.log(`${String(n).padStart(2)} ${def.name.padEnd(13)} ${ok ? 'WIN ' : 'FAIL'} shots=${s.shots} par=${def.par}${parOk ? '' : ' (OVER PAR)'} t=${t.toFixed(1)}s${lava} ${s.dead ? 'DIED' : ''} ${problems.join(' ')}` +
    (ok ? '' : ` final=(${(pl.x / T).toFixed(2)},${(pl.y / T).toFixed(2)})`));
  if (verbose || !ok) console.log(log.join('\n'));
  return ok;
}
const PH_SHARK = E.PH.sharkCD;

let all = true;
LEVELS.forEach((d, i) => { if (!only.length || only.includes(i + 1)) all = run(d, i + 1) && all; });
process.exit(all ? 0 : 1);
