// Big screen: opens a room, shows the join code, and renders whatever phase the server says we're in.

const stage = document.getElementById('stage');
const meta  = document.getElementById('meta');

let session  = null;   // { code, hostToken }
let joinUrl  = '';
let lastKey  = '';
let endsAt   = 0;      // performance.now() when the current timer hits zero
let stream   = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}

async function openRoom() {
  try { session = JSON.parse(sessionStorage.getItem('qb_host')); } catch { session = null; }
  if (!session) {
    session = await post('api/create');
    try { sessionStorage.setItem('qb_host', JSON.stringify(session)); } catch {}
  }
  // Opened on this computer: point phones at its Wi-Fi address. Opened on a public site: phones use that same site.
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  joinUrl = location.origin + '/';
  if (local) {
    try {
      const info = await (await fetch('api/info')).json();
      joinUrl = info.urls[0] || `http://localhost:${info.port}/`;
    } catch {}
  }
  connect();
}

function connect() {
  if (stream) stream.close();
  stream = new EventSource(`api/events?code=${session.code}&host=${session.hostToken}`);
  stream.onmessage = e => render(JSON.parse(e.data));
  // Room no longer exists (server restarted): start a fresh one
  stream.addEventListener('gone', () => {
    stream.close();
    try { sessionStorage.removeItem('qb_host'); } catch {}
    openRoom();
  });
}

function action(type, extra) {
  return post('api/action', { code: session.code, host: session.hostToken, type, ...extra });
}

function chip(p, extra = '') {
  return `<div class="chip ${extra} ${p.connected ? '' : 'off'}" style="--c:${p.color}">
    <span class="dot" style="background:${p.color};--c:${p.color}"></span>${esc(p.name)}${p.vip ? '<span class="tag">VIP</span>' : ''}
  </div>`;
}

function qrSvg(text) {
  if (typeof qrcode !== 'function') return '';
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 0, scalable: true });
}

const screens = {
  lobby(v) {
    const link = `${joinUrl}?code=${v.code}`;
    const need = v.minPlayers - v.players.filter(p => p.connected).length;
    const slots = Array.from({ length: Math.max(0, need) }, () => '<div class="chip empty">waiting…</div>').join('');
    const roster = v.players.map(p => `<div class="chip ${p.connected ? '' : 'off'}" style="--c:${p.color}">
        <span class="dot" style="background:${p.color};--c:${p.color}"></span>${esc(p.name)}${p.vip ? '<span class="tag">VIP</span>' : ''}
        <button class="x" data-kick="${p.id}" title="Remove">✕</button></div>`).join('');
    return {
      key: 'lobby',
      html: `
        <div class="join-box rise">
          <div class="qr">${qrSvg(link)}</div>
          <div>
            <div class="label">Join on your phone at</div>
            <div class="url">${esc(joinUrl)}</div>
            <div class="label" style="margin-top:2vh">Room code</div>
            <div class="code">${v.code}</div>
          </div>
        </div>
        <div class="roster">${roster}${slots}</div>
        ${need > 0
          ? `<h2>Need ${need} more player${need === 1 ? '' : 's'} (${v.minPlayers}–${v.maxPlayers})</h2>`
          : `<h2>Everyone in? The VIP starts the game from their phone.</h2>
             <md-filled-button class="big-btn" id="start"><md-icon slot="icon">play_arrow</md-icon>Start game</md-filled-button>`}`,
    };
  },

  answer(v) {
    const done = new Set(v.done);
    return {
      key: `answer${v.round}`,
      html: `
        <h2 class="rise kicker">Round ${v.round} of ${v.rounds}${v.round > 1 ? ` · points ×${v.round}` : ''}</h2>
        <h1 class="rise">Answer your prompts on your phone!</h1>
        <div class="roster">${v.players.map(p => chip(p, done.has(p.id) ? 'done' : '')).join('')}</div>`,
    };
  },

  vote(v) {
    const pr = v.prompt;
    const voters = v.players.filter(p => !v.authors.includes(p.id));
    const voted = new Set(v.voted);
    return {
      key: `vote${v.round}-${pr.index}`,
      html: `
        <h2 class="kicker">Matchup ${pr.index} of ${pr.total}</h2>
        <h1 class="rise">${esc(pr.text)}</h1>
        <div class="versus">
          ${answerCard(pr.options[0])}<div class="vs pop">VS</div>${answerCard(pr.options[1])}
        </div>
        <div class="roster">${voters.map(p => chip(p, voted.has(p.id) ? 'done' : '')).join('')}</div>
        <h2>Vote on your phone!</h2>`,
    };
  },

  reveal(v) {
    const pr = v.prompt;
    const [a, b] = pr.options;
    const byId = Object.fromEntries(v.players.map(p => [p.id, p]));
    const card = (o, other) => {
      const p = byId[o.author] || { name: '???', color: '#999' };
      const cls = o.votes > other.votes ? 'win' : o.votes < other.votes ? 'lose' : '';
      const names = o.voters.map(id => byId[id]?.name).filter(Boolean).map(esc).join(', ');
      return `<div class="answer ${cls} pop" style="--c:${p.color}">
        ${o.sweep ? '<div class="sweep">CLEAN SWEEP!</div>' : ''}
        ${o.points ? `<div class="pts">+${o.points}</div>` : ''}
        <div class="text ${o.text ? '' : 'none'}">${o.text ? esc(o.text) : 'no answer'}</div>
        <div class="by"><span class="dot" style="background:${p.color};--c:${p.color}"></span>${esc(p.name)}</div>
        <div class="votes">${o.votes} vote${o.votes === 1 ? '' : 's'}${names ? ` · ${names}` : ''}</div>
      </div>`;
    };
    return {
      key: `reveal${v.round}-${pr.index}`,
      html: `
        <h2 class="kicker">Matchup ${pr.index} of ${pr.total}</h2>
        <h1>${esc(pr.text)}</h1>
        <div class="versus">${card(a, b)}<div class="vs">VS</div>${card(b, a)}</div>`,
    };
  },

  scores(v) {
    return { key: `scores${v.round}`, html: `<h1 class="rise">Scores after round ${v.round}</h1>${board(v.players)}` };
  },

  final(v) {
    const sorted = v.players.slice().sort((a, b) => b.score - a.score);
    const top = sorted.filter(p => p.score === sorted[0].score);
    return {
      key: 'final',
      html: `
        <h2 class="rise kicker">${top.length > 1 ? "It's a tie!" : 'The winner is'}</h2>
        <div class="winner pop">${top.map(p => esc(p.name)).join(' & ')}</div>
        ${board(v.players)}
        <md-filled-button class="big-btn" id="again"><md-icon slot="icon">replay</md-icon>Play again</md-filled-button>`,
    };
  },
};

function answerCard(o) {
  return `<div class="answer pop"><div class="text ${o.text ? '' : 'none'}">${o.text ? esc(o.text) : 'no answer'}</div></div>`;
}

function board(players) {
  const sorted = players.slice().sort((a, b) => b.score - a.score);
  const max = Math.max(1, sorted[0]?.score || 0);
  return `<div class="board">${sorted.map((p, i) => `
    <div class="row rise ${i === 0 && p.score > 0 ? 'first' : ''}" style="--c:${p.color};animation-delay:${i * 0.08}s">
      <span class="rank">#${i + 1}</span>
      <div><div>${esc(p.name)}</div><div class="bar" style="width:${Math.max(2, (p.score / max) * 100)}%"></div></div>
      <span>${p.score}</span>
    </div>`).join('')}</div>`;
}

function render(v) {
  const { key, html } = screens[v.phase](v);
  stage.innerHTML = html;
  // Only replay entrance animations when the screen actually changes, not on every status update
  if (key !== lastKey) { stage.classList.remove('enter'); void stage.offsetWidth; stage.classList.add('enter'); }
  else stage.classList.remove('enter');
  lastKey = key;

  endsAt = v.remaining ? performance.now() + v.remaining : 0;
  meta.innerHTML = `${v.phase !== 'lobby' ? `<span>Room <strong>${v.code}</strong></span>` : ''}<span class="timer hidden" id="timer"></span>`;
  tick();

  document.getElementById('start')?.addEventListener('click', () => action('start'));
  document.getElementById('again')?.addEventListener('click', () => action('again'));
  stage.querySelectorAll('[data-kick]').forEach(b => b.addEventListener('click', () => action('kick', { target: b.dataset.kick })));
}

function tick() {
  const el = document.getElementById('timer');
  if (!el) return;
  const left = endsAt ? Math.max(0, Math.ceil((endsAt - performance.now()) / 1000)) : 0;
  el.classList.toggle('hidden', !endsAt);
  el.classList.toggle('low', !!endsAt && left <= 5);
  el.textContent = left;
}
setInterval(tick, 250);

openRoom().catch(() => { stage.innerHTML = "<h2>Couldn't reach the game server. Start it with start.bat in the Projects folder.</h2>"; });
