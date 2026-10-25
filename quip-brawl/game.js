'use strict';
// Quip Brawl on a phone: join the one lobby, ready up, race. Tap anywhere to flip gravity. Your own runner is simulated
// right here so taps never lag; everyone else is drawn from the positions the server relays. Before you join, a bot
// runs the track in the background so the lobby shows how the game plays.
(() => {
  const $ = (id) => document.getElementById(id);
  const cv = $('view'), ctx = cv.getContext('2d');
  const KANA = [...'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン'];
  const INK = '#050506', EMBER = '#ff7a2e';
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const hash = (i, j) => {
    let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const load = () => { try { return JSON.parse(localStorage.getItem('qb_runner')) || {}; } catch { return {}; } };
  const save = (v) => { try { localStorage.setItem('qb_runner', JSON.stringify(v)); } catch {} };

  // ===========================================================================
  // Network
  // ===========================================================================
  let ws = null, offset = 0, bestRtt = Infinity;
  let me = { ...load(), id: null };     // { name, token, id }
  let lobby = null, race = null;
  const serverNow = () => performance.now() + offset;
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };

  function connect() {
    const u = new URL('ws', location.href);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(u);
    ws.onopen = () => {
      bestRtt = Infinity;
      for (let i = 0; i < 5; i++) setTimeout(ping, i * 200);
      if (me.name) send({ t: 'hello', name: me.name, token: me.token });
      updatePanel();
    };
    ws.onmessage = (e) => { try { onMsg(JSON.parse(e.data)); } catch {} };
    ws.onclose = () => { ws = null; setTimeout(connect, 1500); };
  }
  // the clock: the race starts at a server time, so every phone needs to know how far its clock is off
  const ping = () => send({ t: 'ping', c: performance.now() });
  setInterval(() => { bestRtt += 5; ping(); }, 3000);

  function onMsg(m) {
    switch (m.t) {
      case 'pong': {
        const now = performance.now(), rtt = now - m.c;
        if (rtt <= bestRtt) { bestRtt = rtt; offset = m.s + rtt / 2 - now; }
        break;
      }
      case 'welcome':
        me = { name: m.name, token: m.token, id: m.id };
        save({ name: me.name, token: me.token });
        $('join-err').textContent = '';
        updatePanel();
        break;
      case 'error':
        me.id = null;
        $('join-err').textContent = m.msg;
        updatePanel();
        break;
      case 'lobby':
        lobby = m;
        if (m.phase === 'lobby' && race) endRaceView();
        renderLobby();
        updatePanel();
        break;
      case 'race':
        if (!race || race.seed !== m.seed) beginRace(m);
        for (const id of m.out) knock(id, 0);
        break;
      case 'snap':
        if (!race) break;
        for (const [id, x, y, g, rt, st] of m.p) {
          const o = race.others.get(id);
          if (o) Object.assign(o, { tx: x, ty: y, g, rt, st });
        }
        break;
      case 'out':
        knock(m.id, m.place);
        break;
      case 'end':
        if (race) showResults(m);
        break;
    }
  }

  // ===========================================================================
  // Race
  // ===========================================================================
  let wake = null;

  function beginRace(m) {
    const mine = m.runners.includes(me.id);
    race = {
      seed: m.seed, startAt: m.startAt, track: World.track(m.seed), mine, self: World.runner(), simT: 0, sent: 0,
      others: new Map(), place: 0, ended: false, t: -9, outAt: 0,
    };
    race.self.alive = mine;
    for (const id of m.runners) {
      if (id !== me.id) race.others.set(id, { x: World.START_X, y: World.START_Y, tx: World.START_X, ty: World.START_Y, g: 1, rt: 0, st: 0, alive: true });
    }
    flakes.length = 0;
    camX = World.START_X - 6;
    $('results').classList.add('hidden');
    updatePanel();
    navigator.wakeLock?.request('screen').then((l) => { wake = l; }).catch(() => {});
  }

  function endRaceView() {
    race = null;
    $('results').classList.add('hidden');
    setBanner('', '');
    wake?.release().catch(() => {});
    wake = null;
  }

  function knock(id, place) {
    if (!race) return;
    const r = id === me.id ? race.self : race.others.get(id);
    if (!r) return;
    if (r.alive) { r.alive = false; burst(r, colorOf(id)); }
    if (id === me.id && race.mine) {
      race.place = place || race.place;
      race.outAt = race.outAt || performance.now();
    }
  }

  function showResults(m) {
    race.ended = true;
    setBanner('', '');
    const byId = Object.fromEntries((lobby?.players || []).map((p) => [p.id, p]));
    const w = byId[m.winner];
    $('results').innerHTML = `
      <div class="winner" style="--c:${w?.color || EMBER}">${w ? esc(w.name) : 'Nobody'}</div>
      <div class="sub">${m.winner === me.id ? 'You win!' : 'wins'}</div>
      <ol>${m.places.map((id) => byId[id] ? `<li style="--c:${byId[id].color}"><span class="dot"></span>${esc(byId[id].name)}</li>` : '').join('')}</ol>`;
    $('results').classList.remove('hidden');
    if (m.winner === me.id) navigator.vibrate?.([30, 60, 30]);
  }

  function flip() {
    if (!race || !race.mine || !race.self.alive || race.ended || race.t < 0) return;
    race.self.want = race.simT;
    navigator.vibrate?.(8);
  }

  // Run our own runner up to the race clock, and tell the server where we are ~15 times a second
  function stepRace(now) {
    race.t = (serverNow() - race.startAt) / 1000;
    const p = race.self;
    if (race.mine && p.alive && !race.ended && race.t > 0) {
      for (let n = 0; race.simT + World.TICK <= race.t && n < 600; n++) {
        if (World.step(p, race.simT, race.track)) {
          p.alive = false;
          burst(p, colorOf(me.id));
          send({ t: 'dead' });
          navigator.vibrate?.(70);
          race.outAt = now;
          break;
        }
        race.simT += World.TICK;
      }
      if (p.alive && now - race.sent > 66) {
        race.sent = now;
        send({ t: 'pos', x: +p.x.toFixed(3), y: +p.y.toFixed(3), g: p.g, rt: +race.simT.toFixed(3), st: p.stuck ? 1 : 0 });
      }
    }
    if (race.t < 0 && race.mine) setBanner(String(Math.ceil(-race.t)), 'tap to flip');
    else if (race.ended) return;
    else if (race.mine && p.alive) setBanner('', '');
    // out: your place, big for a moment, then a small line so you can watch the rest
    else if (race.mine && now - race.outAt < 2000) setBanner(race.place ? `#${race.place}` : 'Out', '');
    else if (race.mine) setBanner('', race.place ? `#${race.place} · watching` : 'watching');
    else setBanner('', 'watching');
  }

  // Other runners: carry them forward at run speed between updates (unless they were stuck), and ease towards that
  function moveOthers(dt) {
    for (const o of race.others.values()) {
      if (!o.alive) continue;
      const ahead = o.st ? 0 : World.speed(race.t) * clamp(race.t - o.rt, 0, 0.4);
      o.x += (o.tx + ahead - o.x) * Math.min(1, dt * 12);
      o.y += (o.ty - o.y) * Math.min(1, dt * 16);
    }
  }

  // ===========================================================================
  // Attract mode: a bot runs the lobby's background track
  // ===========================================================================
  let demo = null;
  function newDemo() {
    demo = { track: World.track((Math.random() * 2 ** 31) | 0), p: World.runner(), t: 0 };
  }
  // flip when staying put would snag or drop us, and flipping lands somewhere
  function demoProbe(flipNow, secs) {
    const q = { ...demo.p, want: flipNow ? demo.t : null };
    let t = demo.t, left = false, snag = false;
    for (let i = 0; i < secs / World.TICK; i++) {
      if (World.step(q, t, demo.track)) return { dead: true };
      t += World.TICK;
      snag = snag || q.stuck;
      if (!q.ground) left = true;
      if (left && q.ground) return { land: true, snag };
    }
    return { ground: q.ground, snag };
  }
  function stepDemo(dt) {
    for (let n = Math.min(60, Math.round(dt / World.TICK)); n > 0; n--) {
      if (demo.p.ground) {
        const stay = demoProbe(false, 0.06);
        if ((stay.dead || stay.snag || !stay.ground) && demoProbe(true, 2).land) demo.p.want = demo.t;
      }
      if (World.step(demo.p, demo.t, demo.track)) { burst(demo.p, EMBER); newDemo(); flakes.length = 0; return; }
      demo.t += World.TICK;
    }
  }

  // ===========================================================================
  // Drawing: everything is squares and glyphs, the Haunt way
  // ===========================================================================
  let VW = 0, VH = 0, DPR = 1, S = 20, oy = 0, camX = 0, atlas = [];
  const flakes = [];

  function resize() {
    DPR = Math.min(devicePixelRatio || 1, 2);
    cv.width = VW = Math.round(innerWidth * DPR);
    cv.height = VH = Math.round(innerHeight * DPR);
    // whole device pixels per tile keep the pixel art crisp; at least 18 tiles of track visible, all 14 rows fit
    S = Math.max(8, Math.floor(Math.min(VW / 18, VH / (World.HEIGHT + 4))));
    oy = Math.round((VH - World.HEIGHT * S) / 2 + S * 0.5);
    buildAtlas();
  }

  function buildAtlas() {
    atlas = ['█', '▣', '#', '▣', '+'].map((g, i) => {
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const x = c.getContext('2d'), k = Math.max(1, Math.round(S / 10));
      x.fillStyle = '#2a070b'; x.fillRect(0, 0, S, S);
      x.fillStyle = ['#a10f1a', '#8a0c16', '#b3121e', '#7a0a13', '#6d0207'][i];
      x.fillRect(k, k, S - 2 * k, S - 2 * k);
      x.fillStyle = 'rgba(255, 130, 120, 0.22)';
      x.font = `700 ${Math.round(S * 0.62)}px 'JetBrains Mono', monospace`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(g, S / 2, S / 2 + k);
      return c;
    });
  }

  const sx = (x) => Math.round((x - camX) * S);
  const sy = (y) => Math.round(oy + y * S);

  function backdrop(time) {
    ctx.fillStyle = INK;
    ctx.fillRect(0, 0, VW, VH);
    const g = ctx.createLinearGradient(0, sy(-1), 0, sy(World.HEIGHT + 1));
    g.addColorStop(0, 'rgba(42, 10, 13, 0)'); g.addColorStop(0.5, 'rgba(42, 10, 13, 0.55)'); g.addColorStop(1, 'rgba(42, 10, 13, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, sy(-1), VW, (World.HEIGHT + 2) * S);
    // drifting kana far behind the track (slow parallax, glyphs swap every few seconds, never flash)
    const par = camX * 0.3, step = 2;
    ctx.font = `500 ${Math.round(S * 0.7)}px 'JetBrains Mono', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = Math.floor(par / step) - 1; (i * step - par) * S < VW + S; i++) {
      for (let j = 0; j < 12; j++) {
        const h = hash(i, j);
        if (h > 0.3) continue;
        const k = KANA[Math.floor(hash(i + 7, j + Math.floor(time / 3 + h * 9)) * KANA.length)];
        ctx.fillStyle = `rgba(196, 18, 31, ${0.06 + h * 0.3})`;
        ctx.fillText(k, (i * step - par + 1) * S, sy(j * 1.25 + 0.3));
      }
    }
  }

  function solids(track) {
    const x0 = camX - 1, x1 = camX + VW / S + 1;
    for (const s of track.solids) {
      if (s.x + s.w < x0 || s.x > x1) continue;
      const a = Math.max(Math.floor(s.x), Math.floor(x0)), b = Math.min(s.x + s.w, Math.ceil(x1));
      for (let i = a; i < b; i++) {
        for (let j = 0; j < s.h; j++) {
          const img = s.wall ? atlas[4] : atlas[Math.floor(hash(i, Math.round(s.y) + j) * 4)];
          ctx.drawImage(img, sx(i), sy(s.y + j));
        }
      }
      // the face you run on glows orange
      if (!s.wall) {
        const k = Math.max(2, Math.round(S / 8));
        ctx.fillStyle = EMBER;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(sx(Math.max(s.x, x0)), s.low ? sy(s.y) : sy(s.y + 1) - k, Math.round((Math.min(s.x + s.w, x1) - Math.max(s.x, x0)) * S), k);
        ctx.globalAlpha = 1;
      }
    }
  }

  // The pursuer: a wall of blood-red glyph static with two ember eyes, from the left of the screen up to where it is
  function pursuer(px, time, eyeY) {
    const edge = sx(px);
    if (edge < -S * 2) return;
    const c = Math.max(4, Math.round(S / 2));
    for (let row = 0; row * c < VH; row++) {
      const rag = Math.round(hash(row, Math.floor(time * 4)) * 2.2) * c;
      const e = edge - rag;
      if (e > 0) { ctx.fillStyle = 'rgba(26, 3, 6, 0.94)'; ctx.fillRect(0, row * c, e, c); }
      for (let k = 0; k < 4; k++) {
        const x = e + k * c - c;
        if (x < -c) continue;
        const h = hash(row * 7 + k, Math.floor(time * 3 + row));
        if (k > 0 && h > 0.55 - k * 0.12) continue;
        ctx.fillStyle = k === 0 ? '#6d0207' : h > 0.4 ? '#c4121f' : '#8a0c16';
        ctx.globalAlpha = 1 - k * 0.22;
        ctx.fillRect(x, row * c, c - 1, c - 1);
      }
    }
    ctx.globalAlpha = 1;
    const ey = sy(eyeY), ex = edge - S * 1.6, es = Math.round(S * 0.35);
    ctx.fillStyle = EMBER;
    ctx.shadowColor = EMBER; ctx.shadowBlur = S * 0.6;
    ctx.fillRect(ex, ey - es, es, es);
    ctx.fillRect(ex + es * 2, ey - es, es, es);
    ctx.shadowBlur = 0;
  }

  // 8 x 12 pixel runner, facing right. X body, O eye
  const SPRITES = [
    ['..XXXX..', '..XXXX..', '..XOXO..', '..XXXX..', '...XX...', '.XXXXXX.', 'X.XXXX.X', '..XXXX..', '..XXXX..', '..X..X..', '.X....X.', '.X....XX'],
    ['..XXXX..', '..XXXX..', '..XOXO..', '..XXXX..', '...XX...', '.XXXXXX.', '.XXXXXX.', '..XXXX..', '..XXXX..', '...XX...', '...XX...', '...XXX..'],
    ['X.XXXX.X', '.XXXXXX.', '..XOXO..', '..XXXX..', '...XX...', '..XXXX..', '..XXXX..', '..XXXX..', '..XXXX..', '..X..X..', '..X..X..', '.XX..XX.'],
  ];
  let tags = [];   // name tags drawn this frame
  function runner(r, color, frame, alpha, name) {
    const cw = (World.PW * S) / 8, ch = (World.PH * S) / 12, x0 = sx(r.x), y0 = sy(r.y);
    const rows = SPRITES[frame];
    ctx.globalAlpha = alpha;
    ctx.shadowColor = color; ctx.shadowBlur = S * 0.5;
    for (let j = 0; j < 12; j++) {
      const row = rows[r.g < 0 ? 11 - j : j];
      for (let i = 0; i < 8; i++) {
        const c = row[i];
        if (c === '.') continue;
        ctx.fillStyle = c === 'O' ? INK : color;
        ctx.fillRect(Math.round(x0 + i * cw), Math.round(y0 + j * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
    ctx.shadowBlur = 0;
    if (name) {
      ctx.font = `600 ${Math.round(S * 0.55)}px Rubik, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = r.g < 0 ? 'top' : 'bottom';
      ctx.fillStyle = color;
      // stack tags of runners bunched together instead of printing them over each other
      const tx = x0 + (World.PW * S) / 2, w = ctx.measureText(name).width, lh = S * 0.62, dir = r.g < 0 ? 1 : -1;
      let ty = r.g < 0 ? y0 + World.PH * S + S * 0.25 : y0 - S * 0.25;
      while (tags.some((b) => Math.abs(b.x - tx) < (b.w + w) / 2 && Math.abs(b.y - ty) < lh)) ty += dir * lh;
      tags.push({ x: tx, y: ty, w });
      ctx.fillText(name, tx, ty);
    }
    ctx.globalAlpha = 1;
  }
  const frameOf = (r, time) => (r.ground === false && !r.stuck ? 2 : Math.floor(time * 10) % 2);

  function trail(r, color) {
    if (Math.random() < 0.5) flakes.push({ x: r.x + 0.1, y: r.y + Math.random() * World.PH, vx: -1 - Math.random() * 2, vy: (Math.random() - 0.5), life: 0.5, max: 0.5, color, size: 0.18 });
  }
  function burst(r, color) {
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 7;
      flakes.push({ x: r.x + World.PW / 2, y: r.y + World.PH / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.9, max: 0.9, color, size: 0.2 + Math.random() * 0.2 });
    }
  }
  function drawFlakes(dt) {
    for (let i = flakes.length - 1; i >= 0; i--) {
      const f = flakes[i];
      f.life -= dt;
      if (f.life <= 0) { flakes.splice(i, 1); continue; }
      f.x += f.vx * dt; f.y += f.vy * dt;
      const s = Math.max(2, Math.round(f.size * S));
      ctx.globalAlpha = (f.life / f.max) * 0.8;
      ctx.fillStyle = f.color;
      ctx.fillRect(sx(f.x), sy(f.y), s, s);
    }
    ctx.globalAlpha = 1;
  }

  // Top strip: where everyone is relative to the pursuer
  function strip(px, list) {
    if (!list.length) return;
    const w = Math.min(VW - 32 * DPR, 360 * DPR), x = (VW - w) / 2, y = Math.round(14 * DPR);
    const lead = Math.max(...list.map((r) => r.x)), lo = px - 3, hi = Math.max(lo + 30, lead + 4);
    const at = (v) => x + ((v - lo) / (hi - lo)) * w, k = Math.round(4 * DPR);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.fillRect(x, y + k, w, Math.max(2, DPR * 2));
    ctx.fillStyle = '#c4121f';
    ctx.fillRect(x, y, at(px) - x, k * 2 + 2);
    for (const r of list) {
      const s = r.me ? k * 3 : k * 2;
      ctx.fillStyle = r.color;
      ctx.fillRect(Math.round(at(r.x) - s / 2), Math.round(y + k + 1 - s / 2), s, s);
    }
  }

  function colorOf(id) { return lobby?.players.find((p) => p.id === id)?.color || '#999'; }
  function nameOf(id) { return lobby?.players.find((p) => p.id === id)?.name || ''; }

  // ===========================================================================
  // Frame
  // ===========================================================================
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000), time = now / 1000;
    last = now;
    let track, list = [], t;

    if (race) {
      stepRace(now);
      moveOthers(dt);
      track = race.track;
      t = Math.max(0, race.t);
      if (race.mine) list.push({ ...race.self, id: me.id, me: true, color: colorOf(me.id) });
      for (const [id, o] of race.others) list.push({ ...o, id, color: colorOf(id), name: nameOf(id), ground: undefined });
    } else {
      if (!demo) newDemo();
      stepDemo(dt);
      track = demo.track;
      t = demo.t;
      list.push({ ...demo.p, color: EMBER, me: true });
    }

    // follow our runner; once we're out, follow whoever is leading
    const alive = list.filter((r) => r.alive);
    const follow = list.find((r) => r.me && r.alive) || alive.sort((a, b) => b.x - a.x)[0] || list.find((r) => r.me) || { x: World.START_X, y: World.START_Y };
    const goal = follow.x - (VW / S) * 0.32;
    camX += (goal - camX) * Math.min(1, dt * 6);
    track.ensure(camX + VW / S + 4);

    backdrop(time);
    solids(track);
    drawFlakes(dt);
    const px = World.pursuerX(t);
    // ghosts first, our own runner on top
    tags = [];
    for (const r of list.sort((a, b) => !!a.me - !!b.me)) {
      if (!r.alive) continue;
      if (t > 0) trail(r, r.color);
      runner(r, r.color, frameOf(r, time), r.me ? 1 : 0.55, r.me ? '' : r.name);
    }
    pursuer(px, time, follow.y + World.PH / 2);
    if (race) strip(px, alive);
    if (!race) {
      ctx.fillStyle = 'rgba(5, 5, 6, 0.45)';
      ctx.fillRect(0, 0, VW, VH);
      updateStatus();
    }
    requestAnimationFrame(frame);
  }

  // ===========================================================================
  // UI
  // ===========================================================================
  let bannerKey = '';
  function setBanner(big, small) {
    const key = big + '|' + small;
    if (key === bannerKey) return;
    bannerKey = key;
    $('banner-big').textContent = big;
    $('banner-small').textContent = small;
    $('banner').classList.toggle('hidden', !big && !small);
    $('banner').classList.toggle('only-small', !big);
  }

  function updatePanel() {
    const inRace = !!race;
    $('panel').classList.toggle('hidden', inRace);
    $('join').classList.toggle('hidden', !!me.id);
    $('lobby').classList.toggle('hidden', !me.id);
    if (!me.id && me.name && !$('name').value) $('name').value = me.name;
  }

  function renderLobby() {
    if (!lobby) return;
    const mine = lobby.players.find((p) => p.id === me.id);
    $('roster').innerHTML = lobby.players.map((p) => `
      <li class="${p.online ? '' : 'off'} ${p.ready ? 'ready' : ''}" style="--c:${p.color}">
        <span class="dot"></span><span class="name">${esc(p.name)}</span>${p.id === me.id ? '<span class="you">you</span>' : ''}
        <span class="wins">${p.wins ? `${p.wins}<md-icon>emoji_events</md-icon>` : ''}</span>
        <md-icon class="check">${p.ready ? 'check_circle' : 'radio_button_unchecked'}</md-icon>
      </li>`).join('');
    $('ready').classList.toggle('hidden', !!mine?.ready);
    $('unready').classList.toggle('hidden', !mine?.ready);
  }

  let statusText = '';
  function updateStatus() {
    let s = '';
    if (!ws || ws.readyState !== 1) s = 'Connecting…';
    else if (lobby && me.id) {
      const here = lobby.players.filter((p) => p.online), ready = here.filter((p) => p.ready);
      if (lobby.phase !== 'lobby') s = 'Race on. You’re in the next one.';
      else if (here.length < lobby.min) s = `Waiting for ${lobby.min - here.length} more`;
      else if (lobby.launchAt) s = `Starting in ${Math.max(0, Math.ceil((lobby.launchAt - serverNow()) / 1000))}`;
      else s = `${ready.length} of ${here.length} ready`;
    }
    if (s !== statusText) { statusText = s; $('status').textContent = s; }
  }

  $('join').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('name').value.replace(/\s+/g, ' ').trim();
    if (!name) { $('join-err').textContent = 'Pick a name first.'; return; }
    me = { name, token: me.name === name ? me.token : null, id: null };
    save({ name, token: me.token });
    $('join-err').textContent = '';
    send({ t: 'hello', name, token: me.token });
  });
  $('ready').addEventListener('click', () => send({ t: 'ready', on: true }));
  $('unready').addEventListener('click', () => send({ t: 'ready', on: false }));
  $('rename').addEventListener('click', () => {
    send({ t: 'leave' });
    me = { name: me.name, token: null, id: null };
    save({ name: me.name });
    updatePanel();
    $('name').focus();
  });

  // tap anywhere (or space / arrows / W / S) to flip
  cv.addEventListener('pointerdown', (e) => { e.preventDefault(); flip(); });
  addEventListener('keydown', (e) => {
    if (!race || e.repeat || !['Space', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyS'].includes(e.code)) return;
    e.preventDefault();
    flip();
  });
  addEventListener('contextmenu', (e) => { if (race) e.preventDefault(); });
  addEventListener('resize', resize);
  document.fonts?.ready.then(buildAtlas);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && race && !wake) navigator.wakeLock?.request('screen').then((l) => { wake = l; }).catch(() => {});
  });

  resize();
  updatePanel();
  connect();
  requestAnimationFrame(frame);
})();
