// Phone controller: join a room, then answer and vote. All game state comes from the server.

const form    = document.getElementById('join-form');
const codeIn  = document.getElementById('code');
const nameIn  = document.getElementById('name');
const joinErr = document.getElementById('join-error');
const game    = document.getElementById('game');
const meEl    = document.getElementById('me');

let me      = null;   // { code, id, secret, name }
let stream  = null;
let lastKey = '';
let endsAt  = 0;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = () => { try { return JSON.parse(localStorage.getItem('qb_player')); } catch { return null; } };
const save = v => { try { v ? localStorage.setItem('qb_player', JSON.stringify(v)) : localStorage.removeItem('qb_player'); } catch {} };

async function post(path, body) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({ error: 'Server error.' }));
  if (!r.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function action(type, extra) {
  return post('api/action', { code: me.code, id: me.id, secret: me.secret, type, ...extra });
}

async function join(code, name, rejoin) {
  const res = await post('api/join', { code, name, ...(rejoin ? { id: rejoin.id, secret: rejoin.secret } : {}) });
  me = { code: res.code, id: res.id, secret: res.secret, name };
  save(me);
  form.classList.add('hidden');
  game.classList.remove('hidden');
  connect();
}

function connect() {
  if (stream) stream.close();
  stream = new EventSource(`api/events?code=${me.code}&id=${me.id}&secret=${me.secret}`);
  stream.onmessage = e => render(JSON.parse(e.data));
  stream.addEventListener('gone', () => leave('You were removed from the room, or it closed.'));
}

function leave(msg) {
  if (stream) stream.close();
  save(null);
  me = null;
  lastKey = '';
  meEl.innerHTML = '';
  game.classList.add('hidden');
  form.classList.remove('hidden');
  joinErr.textContent = msg || '';
}

form.addEventListener('submit', async e => {
  e.preventDefault();
  joinErr.textContent = '';
  const btn = document.getElementById('join-btn');
  btn.disabled = true;
  try { await join(codeIn.value.trim().toUpperCase(), nameIn.value.trim()); }
  catch (err) { joinErr.textContent = err.message; }
  btn.disabled = false;
});

const timerHtml = '<span class="timer hidden" id="timer"></span>';

function wait(emoji, title, sub) {
  return `<div class="center"><div class="big-emoji">${emoji}</div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`;
}

const screens = {
  lobby(v) {
    const need = v.minPlayers - v.playerCount;
    if (!v.me.vip) return { key: `lobby${need > 0}`, html: wait('🎉', "You're in!", 'Waiting for the VIP to start the game…') };
    return {
      key: `lobby-vip${Math.max(0, need)}`,
      html: `<div class="center"><div class="big-emoji">👑</div><h1>You're the VIP</h1>
        <p>${need > 0 ? `Waiting for ${need} more player${need === 1 ? '' : 's'}…` : 'Start when everyone is in.'}</p></div>
        <button class="btn" id="start" ${need > 0 ? 'disabled' : ''}>Everybody's in!</button>
        <div class="error" id="err"></div>`,
    };
  },

  answer(v) {
    if (!v.todo) return { key: `answer-done${v.round}`, html: wait('✅', 'All done!', 'Waiting for everyone else to finish.') };
    return {
      key: `answer${v.round}-${v.todo.id}`,
      html: `<p>Prompt ${3 - v.todo.left} of 2 · ${timerHtml}</p>
        <div class="card prompt">${esc(v.todo.text)}</div>
        <form id="answer-form">
          <textarea id="answer" maxlength="60" placeholder="Be funny…" required></textarea>
          <div class="count" id="count">0 / 60</div>
          <button class="btn pink" type="submit">Send it</button>
        </form>
        <div class="error" id="err"></div>`,
      init() {
        const box = document.getElementById('answer');
        box.addEventListener('input', () => { document.getElementById('count').textContent = `${box.value.length} / 60`; });
        box.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.target.form.requestSubmit(); } });
        box.focus();
        document.getElementById('answer-form').addEventListener('submit', async e => {
          e.preventDefault();
          const btn = e.target.querySelector('button');
          btn.disabled = true;
          try { await action('answer', { promptId: v.todo.id, text: box.value }); }
          catch (err) { document.getElementById('err').textContent = err.message; btn.disabled = false; }
        });
      },
    };
  },

  vote(v) {
    if (v.vote.mine) return { key: `vote-mine${v.round}-${v.vote.key}`, html: wait('😬', "That's your answer up there!", "You can't vote on this one. Sit tight.") };
    const picked = v.vote.voted;
    return {
      key: `vote${v.round}-${v.vote.key}-${picked}`,
      html: `<p>Which is funnier? ${timerHtml}</p>
        <div class="card prompt">${esc(v.vote.text)}</div>
        ${v.vote.options.map((t, i) => `<button class="choice ${picked === i ? 'picked' : ''}" data-side="${i}" ${picked !== null ? 'disabled' : ''}>${t ? esc(t) : '<em>no answer</em>'}</button>`).join('')}
        <p style="text-align:center">${picked !== null ? 'Vote locked in!' : ''}</p>
        <div class="error" id="err"></div>`,
      init() {
        game.querySelectorAll('[data-side]').forEach(b => b.addEventListener('click', async () => {
          game.querySelectorAll('[data-side]').forEach(x => { x.disabled = true; });
          try { await action('vote', { side: Number(b.dataset.side) }); }
          catch (err) { document.getElementById('err').textContent = err.message; }
        }));
      },
    };
  },

  reveal(v) { return { key: `reveal${v.me.score}`, html: wait('👀', 'Eyes on the big screen!', `You have ${v.me.score} points.`) }; },

  scores(v) { return { key: `scores${v.round}`, html: wait('📊', `You're #${v.rank}`, `${v.me.score} points after round ${v.round} of ${v.rounds}.`) }; },

  final(v) {
    const title = v.rank === 1 ? 'You won! 🏆' : `You finished #${v.rank}`;
    return {
      key: `final${v.me.vip}`,
      html: `${wait(v.rank === 1 ? '🥳' : '🎤', title, `${v.me.score} points.`)}
        ${v.me.vip ? '<button class="btn" id="again">Play again</button>' : '<p style="text-align:center">The VIP can start a new game.</p>'}`,
    };
  },
};

function render(v) {
  meEl.innerHTML = `<span class="dot" style="background:${v.me.color}"></span>${esc(v.me.name)}`;
  endsAt = v.remaining ? performance.now() + v.remaining : 0;
  const s = screens[v.phase](v);
  // Rebuild only when the screen changes, so typing isn't wiped out by other players' updates
  if (s.key !== lastKey) {
    lastKey = s.key;
    game.innerHTML = s.html;
    s.init?.();
    document.getElementById('start')?.addEventListener('click', () => action('start').catch(err => { document.getElementById('err').textContent = err.message; }));
    document.getElementById('again')?.addEventListener('click', () => action('again').catch(() => {}));
  }
  tick();
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

// Prefill from the QR link, and quietly rejoin if this phone was already in the room (e.g. after a refresh)
const urlCode = (new URLSearchParams(location.search).get('code') || '').toUpperCase();
const saved = load();
codeIn.value = urlCode || '';
if (saved) nameIn.value = saved.name || '';
if (saved && (!urlCode || urlCode === saved.code)) {
  join(saved.code, saved.name, saved).catch(() => { save(null); });
} else if (urlCode) nameIn.focus();
