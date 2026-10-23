'use strict';
(() => {
  // ---------------------------------------------------------------------------
  // Setup & helpers
  // ---------------------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const cv = { stain: $('stain'), game: $('game'), splat: $('splat'), fx: $('fx') };
  const stc = cv.stain.getContext('2d'); // permanent stains on the chopping board
  const gc = cv.game.getContext('2d');   // fruit, organs, particles (cleared every frame)
  const sc = cv.splat.getContext('2d');  // blood stuck to the "screen" (persistent, fades)
  const fc = cv.fx.getContext('2d');     // blade trail, wiper, popups (cleared every frame)

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = (t) => 0.5 - Math.cos(Math.PI * clamp(t, 0, 1)) / 2;

  let W = 0, H = 0, DPR = 1, S = 1, G = 1500;

  function resize() {
    // keep the blood across a resize
    const keep = [cv.stain, cv.splat].map((c) => {
      const t = document.createElement('canvas');
      t.width = c.width; t.height = c.height;
      if (c.width && c.height) t.getContext('2d').drawImage(c, 0, 0);
      return t;
    });
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    S = clamp(Math.min(W, H) / 600, 0.7, 1.5);
    G = H * 1.9;
    for (const c of Object.values(cv)) {
      c.width = Math.round(W * DPR); c.height = Math.round(H * DPR);
      c.getContext('2d').setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    [cv.stain, cv.splat].forEach((c, i) => {
      if (!keep[i].width) return;
      const x = c.getContext('2d');
      x.save(); x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(keep[i], 0, 0, c.width, c.height); x.restore();
    });
  }
  window.addEventListener('resize', resize);
  resize();

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
  };

  // ---------------------------------------------------------------------------
  // Audio (all synthesized)
  // ---------------------------------------------------------------------------
  const Sfx = {
    ac: null, master: null, noise: null, muted: store.get('fb-muted', false), lastSwoosh: 0,
    init() {
      if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ac = new AC();
      this.master = this.ac.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ac.destination);
      const len = this.ac.sampleRate;
      this.noise = this.ac.createBuffer(1, len, this.ac.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    },
    setMuted(m) {
      this.muted = m; store.set('fb-muted', m);
      if (this.master) this.master.gain.value = m ? 0 : 0.5;
      Music.setMuted(m);
    },
    noiseHit(dur, type, f0, f1, q, vol, delay = 0) {
      const ac = this.ac, t = ac.currentTime + delay;
      const src = ac.createBufferSource(); src.buffer = this.noise; src.playbackRate.value = rand(0.8, 1.2);
      const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
      f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t, Math.random() * 0.4); src.stop(t + dur + 0.05);
    },
    tone(dur, type, f0, f1, vol, delay = 0) {
      const ac = this.ac, t = ac.currentTime + delay;
      const o = ac.createOscillator(); o.type = type;
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    },
    squish(big = 1) {
      if (!this.ac) return;
      this.noiseHit(0.25 * big, 'lowpass', rand(2200, 3400), 160, 5, 0.7);
      this.tone(0.2, 'sine', rand(110, 150), 38, 0.6 * big);
      this.noiseHit(0.14, 'bandpass', rand(700, 1100), 250, 9, 0.4, 0.05);
    },
    squeak() { if (this.ac) this.tone(0.2, 'sawtooth', rand(750, 1100), rand(220, 320), 0.05); },
    swoosh(p = 1) {
      if (!this.ac || this.ac.currentTime - this.lastSwoosh < 0.15) return;
      this.lastSwoosh = this.ac.currentTime;
      this.noiseHit(0.16, 'bandpass', 500 * p, 2800 * p, 1.4, 0.16);
    },
    ting() { if (!this.ac) return; this.tone(0.35, 'sine', 2600, 2200, 0.12); this.tone(0.3, 'sine', 3900, 3500, 0.05); },
    rupture() { if (!this.ac) return; this.tone(0.5, 'sawtooth', 120, 35, 0.18); this.noiseHit(0.45, 'lowpass', 900, 80, 3, 0.5); },
    spit() { if (!this.ac) return; this.noiseHit(0.22, 'bandpass', 500, 140, 3, 0.5); this.tone(0.25, 'square', 180, 60, 0.12); },
    pop() { if (!this.ac) return; this.tone(0.09, 'sine', 700, 120, 0.4); this.noiseHit(0.08, 'highpass', 2500, 900, 1, 0.2); },
    boom() { if (!this.ac) return; this.noiseHit(1.3, 'lowpass', 1400, 50, 1, 1); this.tone(0.9, 'sine', 95, 28, 0.9); },
    wipe() { if (!this.ac) return; this.noiseHit(0.5, 'bandpass', 300, 1000, 3, 0.25); this.noiseHit(0.5, 'bandpass', 1000, 300, 3, 0.25, 0.55); },
    hurt() { if (!this.ac) return; this.tone(0.3, 'square', 220, 110, 0.08); },
    soul(n) { if (!this.ac) return; const k = 1 + n * 0.06; this.tone(0.45, 'sine', 520 * k, 1100 * k, 0.07); this.tone(0.4, 'triangle', 780 * k, 1650 * k, 0.03, 0.04); },
    boo() { if (!this.ac) return; this.tone(0.7, 'sine', 260, 520, 0.08); this.tone(0.7, 'sine', 275, 550, 0.06, 0.05); this.tone(0.5, 'sine', 520, 300, 0.05, 0.5); },
    bane() {
      if (!this.ac) return;
      this.noiseHit(1.4, 'lowpass', 2400, 50, 2, 0.8);
      this.tone(1.5, 'sawtooth', 95, 28, 0.22);
      this.tone(1.2, 'square', 140, 42, 0.07);
      // a dissonant pair on top, the "souls screaming" part
      this.tone(1.1, 'sine', 466, 220, 0.09, 0.06); this.tone(1.1, 'sine', 494, 233, 0.08, 0.06);
    },
  };

  // ---------------------------------------------------------------------------
  // Soundtrack & sampled sfx (files in ost/, all normalized to -16 LUFS)
  // HTMLAudioElement rather than fetch so it also works when opened via file://
  // ---------------------------------------------------------------------------
  const OST = 'ost/';
  const TRACKS = {
    menu: 'Main screen.mp3',
    boss: 'Boss music.mp3',
    // level i plays music{i+1}; if that file doesn't exist yet it falls back to the last one
    level: (i) => [`music${i + 1}.mp3`, 'music4.mp3'],
  };
  const CLIPS = {
    hit: ['Hit1.mp3', 'Hit2.mp3', 'Hit3.mp3', 'Hit4.mp3', 'Hit5.mp3', 'Hit6.mp3', 'Hit7.mp3', 'Hit8.mp3'],
    defeat: ['Defeat1.mp3', 'Defeat2.mp3', 'Defeat3.mp3'],
    success: ['Success1.mp3', 'Success2.mp3', 'Success3.mp3'],
    sword: ['sfx-sword.mp3'],
  };
  const MUSIC_VOL = 0.45, CLIP_VOL = 0.9, HIT_MAX = 2.2; // seconds; Hit4 is a 9s spurt

  const FADE_MS = 400; // how long other sounds take to fade when new music takes over

  function fadeOut(a, ms) {
    if (a._fading) return;
    a._fading = true;
    // a timer, not rAF: rAF stalls in background tabs and would leave the sound stuck mid-fade
    const v0 = a.volume, t0 = Date.now();
    const id = setInterval(() => {
      const k = 1 - (Date.now() - t0) / ms;
      if (k <= 0) { clearInterval(id); a.pause(); return; }
      a.volume = v0 * k;
    }, 25);
  }

  const Music = {
    el: null, want: null, unlocked: false,
    play(files) {
      this.want = files;
      if (!this.unlocked) return;
      const [file, fallback] = files;
      if (this.el && this.el.dataset.file === file) { if (this.el.paused) this.el.play().catch(() => {}); return; }
      this.stop(FADE_MS);
      const a = new Audio(OST + encodeURI(file));
      a.loop = true; a.dataset.file = file;
      a.volume = Sfx.muted ? 0 : MUSIC_VOL;
      if (fallback && fallback !== file) a.addEventListener('error', () => { if (this.el === a) this.play([fallback]); }, { once: true });
      a.play().catch(() => {});
      this.el = a;
    },
    stop(fadeMs = 0) {
      const a = this.el;
      this.el = null;
      if (!a) return;
      if (!fadeMs) { a.pause(); return; }
      fadeOut(a, fadeMs);
    },
    pause() { if (this.el) this.el.pause(); },
    resume() { if (this.el) this.el.play().catch(() => {}); },
    unlock() { // browsers block audio until the first click/key
      if (this.unlocked) return;
      this.unlocked = true;
      if (this.want) this.play(this.want);
    },
    // Some browsers allow sound without a click (e.g. arriving via a same-site link).
    // Try that first; only if it's refused do we ask for a click.
    tryAutoplay(onBlocked) {
      if (this.unlocked || !this.want) return;
      const [file] = this.want;
      const a = new Audio(OST + encodeURI(file));
      a.loop = true; a.dataset.file = file;
      a.volume = Sfx.muted ? 0 : MUSIC_VOL;
      a.play()
        .then(() => {
          if (this.unlocked) { a.pause(); return; } // a click beat us to it
          this.unlocked = true; this.el = a;
        })
        .catch(() => { if (!this.unlocked) onBlocked(); });
    },
    setMuted(m) { if (this.el) this.el.volume = m ? 0 : MUSIC_VOL; },
  };

  const Clips = {
    bags: {},
    active: new Set(),
    // fade out every clip still playing (win/lose stingers, hits) so new music isn't buried under them
    fadeAll(ms = FADE_MS) { for (const a of this.active) fadeOut(a, ms); this.active.clear(); },
    preload() { for (const f of Object.values(CLIPS).flat()) { const a = new Audio(OST + encodeURI(f)); a.preload = 'auto'; } },
    // shuffle-bag so the same clip never plays twice in a row
    next(group) {
      let bag = this.bags[group];
      if (!bag || !bag.length) {
        const last = bag && bag.last;
        bag = CLIPS[group].slice().sort(() => Math.random() - 0.5);
        if (bag.length > 1 && bag[bag.length - 1] === last) bag.unshift(bag.pop());
        this.bags[group] = bag;
      }
      const f = bag.pop();
      bag.last = f;
      return f;
    },
    play(group, maxDur = 0) {
      if (Sfx.muted || !Music.unlocked) return;
      const a = new Audio(OST + encodeURI(this.next(group)));
      a.volume = CLIP_VOL;
      a.play().catch(() => {});
      this.active.add(a);
      a.addEventListener('ended', () => this.active.delete(a), { once: true });
      if (maxDur) setTimeout(() => { fadeOut(a, 300); this.active.delete(a); }, maxDur * 1000);
    },
  };
  Clips.preload();

  // ---------------------------------------------------------------------------
  // Content
  // ---------------------------------------------------------------------------
  const FRUITS = {
    apple:      { r: 36, gore: ['worm', 'worm', 'eye'], blood: 1.0, cw: 0.95, rind: '#9e1b1f' },
    orange:     { r: 38, gore: ['eye', 'eye', 'tooth'], blood: 1.0, cw: 0.95, rind: '#e07a12' },
    strawberry: { r: 32, gore: ['tooth', 'tooth', 'tooth', 'tooth'], blood: 0.9, cw: 0.8, rind: '#c81d2d' },
    melon:      { r: 58, gore: ['guts', 'guts', 'heart'], blood: 2.0, cw: 1.08, rind: '#2a7a2a', face: 1.3 },
    banana:     { r: 42, gore: ['spine', 'bone'], blood: 1.1, cw: 0.42, rind: '#e9c533', face: 0.8 },
    coconut:    { r: 40, gore: ['brain', 'eye', 'eye'], blood: 1.3, cw: 0.95, rind: '#5a3a1e' },
    pineapple:  { r: 44, gore: ['heart', 'guts', 'bone'], blood: 1.5, cw: 0.78, rind: '#c9952b' },
    lemon:      { r: 32, gore: [], blood: 0, cw: 0.95, rind: '#f2d43a', special: 'wipe' },
    bomb:       { r: 36, gore: [], blood: 0, cw: 1, rind: '#222', special: 'bomb' },
  };
  const GIB_R = { eye: 13, tooth: 9, worm: 15, heart: 19, brain: 21, bone: 17 };
  const GIB_WORDS = { eye: 'POP!', tooth: 'CRUNCH', worm: 'EWW', heart: 'HEARTBREAKER', brain: 'BRAINS!', bone: 'SNAP' };

  const MAX_LIVES = 5;
  // Level-5 boss: a giant watermelon that spits fruit at you
  const BOSS = { name: 'THE GREAT GOURD', hp: 40, r: 150, reward: 25, dmg: { knife: 1, cleaver: 2, katana: 1.5, ea: 1.5, shadowmourne: 1.5 } };

  // Weapons, picked on the menu. reach scales hit radius, gore scales blood + organs,
  // screen scales blood that lands on the screen, life is how long the trail lingers (ms).
  const WEAPONS = [
    { id: 'knife', name: 'Pocket Knife', img: 'swords/pocket-knife.png', size: 78, life: 90,
      blurb: 'For god gamers.', reach: 0.9, gore: 0.9, screen: 0.6, shake: 0.6, swoosh: 1.4 },
    { id: 'cleaver', name: 'Butcher Knife', img: 'swords/butcher-knife.png', size: 92, life: 120,
      blurb: 'More organs. MORE BLOOD.', reach: 1.05, gore: 1.6, screen: 1.3, shake: 2.2, swoosh: 0.6 },
    { id: 'katana', name: 'Katana', img: 'swords/katana.png', size: 150, life: 170,
      blurb: 'You have already been cut.', reach: 1.4, gore: 1, screen: 1, shake: 1, swoosh: 1.8 },
    { id: 'ea', name: 'Gilgamesh\'s sword of rupture "EA"', img: 'swords/ea.png', size: 128, life: 150,
      blurb: 'Legendary treasure hidden inside the Gate of Babylon.', reach: 1.15, gore: 1.3, screen: 1.5, shake: 1.6, swoosh: 0.8 },
    { id: 'shadowmourne', name: 'Shadowmourne', img: 'swords/shadowmourne.png', size: 150, life: 160, legendary: true,
      blurb: 'Every kill reaps a soul. 10 souls unleash Chaos Bane.', reach: 1.2, gore: 1.4, screen: 1.2, shake: 1.5, swoosh: 0.7 },
  ];
  // Shadowmourne, after the WoW axe: every fruit kill frees a ghost that flies into the soul counter at the top
  // (WoW's Soul Fragments). The 10th soul unleashes Chaos Bane: the 10 ghosts burst out of the counter and each one hunts
  // down a fruit (WoW splits the damage between all enemies nearby); with no fruit left they dive at the boss for `bossDmg`.
  // Fruit killed by the ghost army don't give souls back, so it can't chain forever.
  const MOURNE = { max: 10, ghostSpeed: 1500, bossDmg: 1.5, blue: '#5fd8ff', deep: '#b98cff' };
  // Kill messages while Shadowmourne is equipped; functions get the fruit's name
  const MOURNE_WORDS = [
    'SOUL HARVESTED', 'FROSTMOURNE HUNGERS. I SNACK.', 'BINDS WHEN SLICED', 'NEED > GREED', '+1 SOUL (SEEDLESS)',
    'MINUS 50 DKP', 'PRIMORDIAL SALAD-ITE', 'UNHOLY INFUSION OF JUICE', 'SHADOWFROST SMOOTHIE', 'REST IN PULP',
    'THE LICH KIWI SENDS HIS REGARDS', 'MOGRAINE APPROVES', 'NO KING RULES FOREVER', 'SOUL HAS BEEN PEELED',
    '4 HOURS OF ICC FOR THIS?', 'LEEROOOY JUICINS', 'GHOST DROPPED. NO LOOT.', 'TO THE SHADOWLANDS',
    'FOR THE SCOURGE!', 'YOU ARE NOT PREPARED', 'ORCHARD OF THE DAMNED', 'THE FIVE-A-DAY SCOURGE',
    (n) => `THE ${n} IS NOW SCOURGE`, (n) => `/roll 100 ON THE ${n}'S SOUL`, (n) => `${n}: LOOTED`,
    (n) => `[${n} SOUL] x1`, (n) => `RAISE DEAD: ${n}`,
  ];
  const MOURNE_GIB = { eye: 'EYE OF THE LICH KIWI', tooth: 'SINDRAGOSA\'S TOOTH', worm: 'PUTRICIDE\'S PET', heart: 'THE HEART OF ARTHAS',
    brain: 'BRAINS FOR THE SCOURGE', bone: 'MARROWGAR\'S SPARE', guts: 'FESTERGUT', spine: 'SPINESTALKER' };
  const ARMY_WORDS = ['GHOSTED', 'BOO.', 'HAUNTED TO DEATH', 'RETURN TO SENDER', 'ARMY OF THE DEAD', 'SPOOKED TO PULP', 'SOUL DUNK'];
  const mourning = () => weapon.id === 'shadowmourne';
  const fruitName = (type) => ({ melon: 'WATERMELON' }[type] || type.toUpperCase());
  const WIMG = {};
  for (const w of WEAPONS) { WIMG[w.id] = new Image(); WIMG[w.id].src = w.img; }
  let weapon = WEAPONS.find((w) => w.id === store.get('fb-weapon', 'knife')) || WEAPONS[0];
  const TRAILS = { // [color(t), width(t)] passes, t = 0 at the tail, 1 at the tip
    knife: [[(t) => `rgba(200,215,255,${0.3 * t})`, (t) => 3 + t * 6], [(t) => `rgba(255,255,255,${0.5 + t * 0.5})`, (t) => 1 + t * 2.5]],
    cleaver: [[(t) => `rgba(80,80,90,${0.45 * t})`, (t) => 8 + t * 22], [(t) => `rgba(225,228,235,${0.4 + t * 0.6})`, (t) => 3 + t * 8]],
    katana: [[(t) => `rgba(200,0,30,${0.45 * t})`, (t) => 3 + t * 18], [(t) => `rgba(255,235,240,${0.3 + t * 0.7})`, (t) => 1 + t * 3]],
    ea: [[(t) => `rgba(255,20,60,${0.5 * t})`, (t) => 22 + t * 56], [(t) => `rgba(25,0,8,${0.75 * t})`, (t) => 12 + t * 28],
      [(t) => `rgba(255,190,200,${0.4 + t * 0.6})`, (t) => 3 + t * 7]],
    shadowmourne: [[(t) => `rgba(40,0,70,${0.55 * t})`, (t) => 16 + t * 38], [(t) => `rgba(60,220,255,${0.45 * t})`, (t) => 6 + t * 14],
      [(t) => `rgba(225,250,255,${0.4 + t * 0.6})`, (t) => 2 + t * 4]],
  };
  // Auto-wipe: if more than `cover` of the screen is caked in blood for `hold` seconds, the wiper runs on its own
  const AUTO_WIPE = { cover: 0.28, hold: 1.0, every: 0.25 };
  const LEVELS = [
    { name: 'First Blood', blurb: 'Fruit only. Blood dries fast.', target: 20, speed: 0.82, wave: [1.7, 1.15], maxPer: 2,
      bomb: 0, lemon: 0.09, fade: 0.28, gore: 1, pool: ['apple', 'orange', 'strawberry', 'melon'] },
    { name: 'Juice Box', blurb: 'Bombs appear. Blood lingers.', target: 40, speed: 0.91, wave: [1.45, 0.95], maxPer: 3,
      bomb: 0.07, lemon: 0.1, fade: 0.13, gore: 1.25, pool: ['apple', 'orange', 'strawberry', 'melon', 'banana'] },
    { name: 'Gut Check', blurb: 'Everything has organs now.', target: 60, speed: 0.97, wave: [1.25, 0.8], maxPer: 4,
      bomb: 0.09, lemon: 0.1, fade: 0.07, gore: 1.55, pool: ['apple', 'orange', 'strawberry', 'melon', 'banana', 'coconut'] },
    { name: 'Red Wedding', blurb: 'Fast volleys. Blood barely dries.', target: 80, speed: 1.05, wave: [1.1, 0.65], maxPer: 5,
      bomb: 0.115, lemon: 0.11, fade: 0.035, gore: 1.85, pool: ['apple', 'orange', 'strawberry', 'melon', 'banana', 'coconut', 'pineapple'] },
    { name: 'Splatterhouse', blurb: 'Blood never dries. Lemons are your friend. Then the boss.', boss: true, target: 100, speed: 1.14, wave: [1.0, 0.55], maxPer: 6,
      bomb: 0.14, lemon: 0.13, fade: 0, gore: 2.2, pool: ['apple', 'orange', 'strawberry', 'melon', 'banana', 'coconut', 'pineapple'] },
  ];
  const MENU_LEVEL = { speed: 0.85, wave: [1.6, 1.6], maxPer: 2, bomb: 0, lemon: 0.05, fade: 0.35, gore: 1,
    pool: ['apple', 'orange', 'strawberry', 'melon', 'banana', 'coconut', 'pineapple'] };

  const QUOTES = [
    'please no', 'I have a family!', 'not the face!', 'wait—', 'I was gonna be a smoothie',
    'tell my seeds I love them', "I'm only 3 days ripe!", 'why are you like this', "I'm organic!!", 'mercy!',
    'oh no oh no oh no', 'do it. coward.', 'I can see my pulp', 'my therapist warned me', 'not again',
    'I just got waxed', 'I am a VEGETABLE', 'you monster', 'make it quick',
  ];
  const SPLAT_WORDS = ['SPLURT!', 'GUSH!', 'SQUELCH!', 'GUTTED!', 'MUSHED!', 'RIP!', 'SPLAT!', 'OOF.', 'EW!', 'JUICY!'];
  const ESCAPE_WORDS = ['IT ESCAPED', 'A SURVIVOR', 'IT WILL REMEMBER THIS', 'GOT AWAY'];
  const BLOOD = ['#8a0303', '#a10a12', '#6d0207', '#b3141c', '#7c0a0a'];

  // Fixed decoration points (unit radius) so fruit don't flicker
  const unitPts = (n, rx, ry, oy = 0) => Array.from({ length: n }, () => {
    const a = rand(0, TAU), d = Math.sqrt(Math.random());
    return [Math.cos(a) * d * rx, Math.sin(a) * d * ry + oy];
  });
  const DOTS = {
    orange: unitPts(22, 0.85, 0.85),
    straw: unitPts(16, 0.55, 0.55, 0.05),
    coco: Array.from({ length: 34 }, () => [rand(0, TAU), rand(0.15, 0.3)]),
  };

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let fruits = [], halves = [], gibs = [], ropes = [], parts = [], popups = [], drips = [], pendingSplats = [], spawnQueue = [];
  let rings = [], slashes = []; // Ea shockwaves, katana slash lines
  let ghosts = [], banes = []; // Shadowmourne: fruit souls, Chaos Bane flashes at the counter
  const soul = { n: 0, pulse: 0 }; // souls in the counter, how long its "got one" pulse has left
  const cutQueue = [];
  const blade = { down: false, id: null, last: null, hover: null, pts: [], ang: 0, rot: 0 };
  const game = {
    state: 'menu', li: 0, score: 0, lives: MAX_LIVES, t: 0, waveT: 1, wave: 0, g: G,
    combo: { n: 0, last: -9, x: 0, y: 0 }, shake: 0, flash: 0, wipe: null, fadeAcc: 0, introT: 0,
    ending: null, stats: null, lastHit: -9, coverT: 0, overT: 0,
  };
  const level = () => (game.state === 'menu' ? MENU_LEVEL : LEVELS[game.li]);
  const playing = () => game.state === 'play' && !game.ending;

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  function throwFruit(type) {
    const F = FRUITS[type], r = F.r * S, g = game.g;
    const x = rand(W * 0.12, W * 0.88);
    const h = rand(H * 0.45, H * 0.88);
    const vy = -Math.sqrt(2 * g * (h + r));
    const flight = 2 * Math.sqrt(2 * (h + r) / g);
    const vx = (rand(W * 0.25, W * 0.75) - x) / flight * rand(0.6, 1.1);
    const f = { type, x, y: H + r, vx, vy, rot: rand(-0.4, 0.4), vr: rand(-2.5, 2.5), r, quote: null, quoteT: 0 };
    if (type !== 'bomb' && type !== 'lemon' && Math.random() < 0.14) { f.quote = pick(QUOTES); f.quoteT = 2.2; }
    fruits.push(f);
  }

  function rollType(L) {
    const roll = Math.random();
    if (game.state === 'play' && game.wave > 3 && roll < L.bomb) return 'bomb';
    if (roll < L.bomb + L.lemon) return 'lemon';
    return pick(L.pool);
  }

  function throwWave() {
    const L = level();
    const prog = game.state === 'play' ? clamp(game.score / L.target, 0, 1) : 0;
    const max = Math.max(1, Math.round(lerp(Math.ceil(L.maxPer / 2), L.maxPer, prog)));
    const n = randi(1, max);
    const salvo = n >= 3 && Math.random() < 0.4;
    for (let i = 0; i < n; i++) spawnQueue.push({ t: salvo ? i * 0.15 : rand(0, 0.1), type: rollType(L) });
    game.wave++;
    game.waveT = lerp(L.wave[0], L.wave[1], prog) * rand(0.85, 1.2) + (salvo ? n * 0.1 : 0);
  }

  // ---------------------------------------------------------------------------
  // Gore
  // ---------------------------------------------------------------------------
  function spawnBlood(x, y, vx, vy, amt, color) {
    const n = Math.round(26 * amt * level().gore * weapon.gore);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(60, 520) * S;
      const life = rand(0.5, 1.3);
      parts.push({ x, y, vx: vx * 0.3 + Math.cos(a) * sp, vy: vy * 0.3 + Math.sin(a) * sp - 120 * S,
        r: rand(1.5, 5.5) * S, life, max: life, col: color || pick(BLOOD) });
    }
    if (parts.length > 1800) parts.splice(0, parts.length - 1800);
  }

  function blobPath(c, x, y, R, n, jit) {
    const pts = [], off = rand(0, TAU);
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * TAU, rr = R * (1 + rand(-jit, jit));
      pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]);
    }
    c.beginPath();
    const last = pts[n - 1];
    c.moveTo((last[0] + pts[0][0]) / 2, (last[1] + pts[0][1]) / 2);
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      c.quadraticCurveTo(p[0], p[1], (p[0] + q[0]) / 2, (p[1] + q[1]) / 2);
    }
    c.closePath();
  }

  function circle(c, x, y, r) { c.beginPath(); c.arc(x, y, Math.max(0.1, r), 0, TAU); c.fill(); }

  // Blood that hits the "camera"
  function drawSplat(x, y, R, col, dripMul = 1) {
    const c = sc;
    c.save();
    c.fillStyle = col;
    c.globalAlpha = rand(0.82, 0.95);
    blobPath(c, x, y, R, randi(9, 14), 0.35);
    c.fill();
    const n = randi(6, 14);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = R * rand(1.05, 2.5), rr = R * rand(0.05, 0.2);
      const ex = x + Math.cos(a) * d, ey = y + Math.sin(a) * d;
      circle(c, ex, ey, rr);
      if (Math.random() < 0.45) { // streak back to the main blob
        for (let k = 0; k <= 8; k++) {
          const t = k / 8, dd = lerp(R * 0.7, d, t);
          circle(c, x + Math.cos(a) * dd, y + Math.sin(a) * dd, lerp(R * 0.16, rr * 0.45, t));
        }
      }
    }
    c.globalAlpha = 0.16;
    c.fillStyle = '#fff';
    c.beginPath(); c.ellipse(x - R * 0.3, y - R * 0.35, R * 0.3, R * 0.13, -0.6, 0, TAU); c.fill();
    c.restore();
    if (dripMul > 0 && Math.random() < 0.85) {
      for (let i = randi(1, 3) * dripMul; i > 0; i--) {
        drips.push({ x: x + rand(-R * 0.7, R * 0.7), y: y + R * rand(0.2, 0.6), r: rand(2, R * 0.12 + 2.5),
          v: rand(15, 55) * S, life: rand(1.5, 5), col });
      }
    }
  }

  function queueScreenSplats(x, y, amt) {
    const L = level();
    const n = Math.max(1, Math.round(amt * L.gore * weapon.screen * rand(0.8, 1.8)));
    for (let i = 0; i < n; i++) {
      pendingSplats.push({ t: rand(0.04, 0.3), x: x + rand(-1, 1) * W * 0.2, y: y + rand(-1, 1) * H * 0.2,
        R: rand(18, 55) * S * Math.sqrt(amt), col: pick(BLOOD) });
    }
    if (Math.random() < 0.08 * L.gore * weapon.screen) {
      pendingSplats.push({ t: 0.12, x: x + rand(-60, 60) * S, y: y + rand(-60, 60) * S, R: rand(100, 160) * S, col: pick(BLOOD) });
    }
  }

  function stainBoard(x, y, R, col = pick(BLOOD), alpha = 0.3) {
    stc.save(); stc.globalAlpha = alpha; stc.fillStyle = col;
    blobPath(stc, x, y, R, 10, 0.4); stc.fill();
    stc.restore();
  }

  function makeRope(style, anchor, x, y, vx, vy) {
    const n = style === 'guts' ? randi(12, 18) : randi(8, 11);
    const seg = (style === 'guts' ? 9 : 10) * S;
    const pts = [];
    const sx = rand(-60, 60) * S;
    for (let i = 0; i < n; i++) {
      const px = x + rand(-3, 3), py = y + i * seg * 0.5;
      const k = 1 - (i / n) * 0.5;
      pts.push({ x: px, y: py, px: px - (vx * k + sx + rand(-40, 40) * S) / 60, py: py - (vy * k + rand(-40, 40) * S) / 60 });
    }
    ropes.push({ style, pts, seg, anchor, anchorT: rand(0.6, 2.2), age: 0, cool: 0 });
  }

  function spawnGore(f, F, newHalves) {
    const L = level();
    const chance = 0.45 + 0.28 * L.gore * weapon.gore;
    let items = F.gore.filter(() => Math.random() < chance);
    if (!items.length && F.gore.length) items = [pick(F.gore)];
    for (const kind of items) {
      if (kind === 'guts' || kind === 'spine') {
        const h = pick(newHalves);
        makeRope(kind, h, h.x, h.y, h.vx, h.vy);
      } else {
        gibs.push({ kind, x: f.x, y: f.y, vx: f.vx * 0.4 + rand(-260, 260) * S, vy: f.vy * 0.4 - rand(150, 450) * S,
          rot: rand(0, TAU), vr: rand(-8, 8), r: GIB_R[kind] * S, age: 0, phase: rand(0, TAU),
          iris: pick(['#3b7dd8', '#3f9a4c', '#7a4a1e', '#8b5cf6']),
          sq: Array.from({ length: 9 }, () => [rand(-0.7, 0.7), rand(-0.5, 0.5), rand(0, TAU)]) });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Slicing
  // ---------------------------------------------------------------------------
  function segDist(a, b, x, y) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
    return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
  }
  function segHit(p1, p2, p3, p4) {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (!d) return false;
    const u = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const v = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1;
  }

  function processCuts() {
    const rc = weapon.reach;
    for (const [a, b] of cutQueue) {
      for (const f of fruits) if (!f.dead && !f.iai && segDist(a, b, f.x, f.y) < f.r * 1.05 * rc) hitFruit(f, a, b);
      if (game.boss && game.boss.phase !== 'enter' && segDist(a, b, game.boss.x, game.boss.y) < game.boss.r * Math.min(rc, 1.1)) hitBoss(a, b);
      for (const gb of gibs) if (!gb.dead && gb.age > 0.12 && segDist(a, b, gb.x, gb.y) < gb.r * rc + 6 * S) sliceGib(gb);
      const n = ropes.length;
      for (let i = 0; i < n; i++) sliceRope(ropes[i], a, b);
    }
    cutQueue.length = 0;
  }

  function hitFruit(f, a, b) {
    if (weapon.id === 'katana' && f.type !== 'bomb') {
      // iai: the fruit freezes, a slash line flashes across the screen, then it bursts
      f.iai = { t: 0.3, a, b };
      slashes.push({ x: f.x, y: f.y, ang: Math.atan2(b.y - a.y, b.x - a.x), t: 0.45 });
      Sfx.ting();
      return;
    }
    sliceFruit(f, a, b);
  }

  // Ea: a shockwave that tears through every fruit nearby (bombs are spared, no chain reactions)
  function rupture(x, y) {
    const R = 280 * S;
    rings.push({ x, y, t: 0, max: 0.7, R });
    Sfx.rupture();
    game.shake = Math.max(game.shake, 14);
    for (let i = 0; i < 50; i++) {
      const a = rand(0, TAU), sp = rand(300, 900) * S;
      parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(2, 6) * S, life: 0.6, max: 0.6, col: pick(['#ff1f4b', '#1a0008', '#ff6f8a']) });
    }
    for (const o of fruits) {
      if (o.dead || o.iai || o.type === 'bomb' || Math.hypot(o.x - x, o.y - y) > R + o.r) continue;
      const ang = Math.atan2(o.y - y, o.x - x) + Math.PI / 2;
      sliceFruit(o, { x: o.x - Math.cos(ang), y: o.y - Math.sin(ang) }, { x: o.x + Math.cos(ang), y: o.y + Math.sin(ang) }, false, true);
    }
  }

  // ---------------------------------------------------------------------------
  // Shadowmourne: souls, the counter and Chaos Bane
  // ---------------------------------------------------------------------------
  // Where the soul counter sits: top centre, pushed down below the HUD on narrow screens and below the boss bar
  function soulHud() {
    const narrow = W <= 760;
    const y = game.boss ? (narrow ? 166 : 84) : (narrow ? 92 : 22);
    const gap = 26 * S;
    return { x: W / 2, y, slot: (i) => ({ x: W / 2 + (i - (MOURNE.max - 1) / 2) * gap, y: y + 30 * S }) };
  }

  // a little ghost floats up out of every fruit you kill; `counts` sends it to the counter, otherwise it just drifts off
  function releaseSoul(f, counts) {
    ghosts.push({ x: f.x, y: f.y - f.r * 0.6, vx: rand(-30, 30) * S, vy: -110 * S, t: 0, ph: rand(0, TAU),
      mode: counts && playing() ? 'rise' : 'free', tint: FRUITS[f.type].rind, r: 13 * S });
  }

  function soulArrive() {
    soul.n++; soul.pulse = 0.3;
    if (game.stats) game.stats.souls++;
    Sfx.soul(soul.n);
    if (soul.n >= MOURNE.max) chaosBane();
  }

  // Chaos Bane: all 10 souls burst out of the counter as an army of angry ghosts, each one hunting down a fruit
  function chaosBane() {
    soul.n = 0;
    const hud = soulHud();
    banes.push({ x: hud.x, y: hud.slot(0).y, t: 0, max: 1.1 });
    Sfx.bane(); Sfx.boo();
    game.shake = Math.max(game.shake, 16);
    popup('CHAOS BANE', W / 2, hud.y + 95 * S, 58, MOURNE.deep);
    popup(pick(['RELEASE THE GHOSTS', 'THE ORCHARD IS HAUNTED', 'FRUIT OF THE DAMNED, RISE', 'ARMY OF THE DEAD (FRUIT)']), W / 2, hud.y + 140 * S, 26, MOURNE.blue);
    for (let i = 0; i < MOURNE.max; i++) {
      const p = hud.slot(i);
      ghosts.push({ x: p.x, y: p.y, vx: rand(-500, 500) * S, vy: rand(250, 600) * S, t: 0, ph: rand(0, TAU),
        mode: 'army', tint: MOURNE.deep, r: 17 * S, target: null });
    }
  }

  // nearest fruit no other ghost is already chasing (bombs are left alone)
  function ghostTarget(g) {
    let best = null, bestD = Infinity, taken = new Set(ghosts.map((o) => o !== g && o.target));
    for (const pass of [true, false]) {
      for (const f of fruits) {
        if (f.dead || f.type === 'bomb' || f.y > H || (pass && taken.has(f))) continue;
        const d = Math.hypot(f.x - g.x, f.y - g.y);
        if (d < bestD) { bestD = d; best = f; }
      }
      if (best) return best;
    }
    return null;
  }

  function steer(g, tx, ty, speed, dt, k = 6) {
    const dx = tx - g.x, dy = ty - g.y, d = Math.hypot(dx, dy) || 1;
    g.vx += ((dx / d) * speed - g.vx) * Math.min(1, dt * k);
    g.vy += ((dy / d) * speed - g.vy) * Math.min(1, dt * k);
    return d;
  }

  function updateGhosts(dt) {
    const hud = soulHud();
    for (const g of ghosts) {
      g.t += dt; g.ph += dt * 6;
      if (g.mode === 'rise') { // float up out of the corpse for a moment, then fly to the counter
        g.vy += 60 * S * dt; g.vx = Math.sin(g.ph) * 40 * S;
        if (g.t > 0.45) g.mode = 'home';
      } else if (g.mode === 'home') {
        if (!playing()) { g.mode = 'free'; g.t = 0.8; }
        else {
          const p = hud.slot(Math.min(soul.n, MOURNE.max - 1));
          if (steer(g, p.x, p.y, 1300 * S, dt, 5) < 16 * S || g.t > 3) { g.dead = true; soulArrive(); }
        }
      } else if (g.mode === 'army') {
        if (!g.target || g.target.dead) g.target = ghostTarget(g);
        const B = game.boss, f = g.target;
        if (f) {
          if (steer(g, f.x, f.y, MOURNE.ghostSpeed * S, dt) < f.r * 0.8) ghostStrike(g, f);
        } else if (B && B.phase === 'fight') {
          if (steer(g, B.x, B.y, MOURNE.ghostSpeed * S, dt) < B.r * 0.6) ghostStrike(g, null);
        } else { // nothing to haunt yet: circle the upper screen waiting for the next wave
          steer(g, W / 2 + Math.cos(g.ph * 0.25) * W * 0.3, H * 0.35 + Math.sin(g.ph * 0.4) * H * 0.12, 500 * S, dt, 2);
        }
        if (g.t > 6) { g.mode = 'free'; g.t = 0.8; }
      } else { // free: drift up and fade
        g.vy += (-90 * S - g.vy) * Math.min(1, dt * 3); g.vx = Math.sin(g.ph) * 30 * S;
        if (g.t > 1.6) g.dead = true;
      }
      g.x += g.vx * dt; g.y += g.vy * dt;
    }
    ghosts = ghosts.filter((g) => !g.dead);
  }

  function ghostStrike(g, f) {
    g.dead = true;
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU), sp = rand(100, 400) * S;
      parts.push({ x: g.x, y: g.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: rand(1.5, 4) * S, life: 0.45, max: 0.45, col: pick([MOURNE.blue, MOURNE.deep, '#e6fbff']) });
    }
    if (f) { // cut along the ghost's flight path
      const sp = Math.hypot(g.vx, g.vy) || 1, ux = g.vx / sp, uy = g.vy / sp;
      sliceFruit(f, { x: f.x - ux, y: f.y - uy }, { x: f.x + ux, y: f.y + uy }, false, true);
      return;
    }
    const B = game.boss;
    B.hp -= MOURNE.bossDmg; B.hitT = 0.12;
    spawnBlood(g.x, g.y, 0, 0, 0.7);
    Sfx.squish(1);
    popup(pick(['BOO!', `-${MOURNE.bossDmg}`, 'SPOOKED']), g.x, g.y, 30, MOURNE.blue);
    updateBossBar();
    if (B.hp <= 0) { B.phase = 'dying'; B.t = 0; Sfx.boom(); popup('IT\'S DYING', B.x, B.y - B.r - 30 * S, 44, '#ffb347'); }
  }

  function mourneWord(type) {
    const w = pick(MOURNE_WORDS);
    return typeof w === 'function' ? w(fruitName(type)) : w;
  }

  function sliceFruit(f, a, b, blast = false, wave = false) {
    f.dead = true;
    const F = FRUITS[f.type];
    if (F.special === 'bomb') return explodeBomb(f);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    const push = 130 * S * (weapon.id === 'cleaver' ? 1.5 : 1);
    const made = [];
    for (const side of [-1, 1]) {
      const h = { type: f.type, x: f.x + nx * side * 2, y: f.y + ny * side * 2,
        vx: f.vx * 0.8 + nx * side * push + Math.cos(ang) * rand(-40, 40) * S, vy: f.vy * 0.6 + ny * side * push - 80 * S,
        rot: ang, vr: side * rand(1.5, 4), bodyRot: f.rot - ang, side, r: f.r, bleed: F.blood ? rand(1.2, 2.4) : 0 };
      halves.push(h); made.push(h);
    }
    if (F.special === 'wipe') {
      spawnBlood(f.x, f.y, f.vx, f.vy, 0.6, '#f7e04a');
      if (blast) return;
      startWipe();
      addScore(1, f.x, f.y, 'SQUEEGEE!', '#ffe14d');
      Sfx.squish(0.6);
      return;
    }
    spawnBlood(f.x, f.y, f.vx, f.vy, F.blood);
    spawnGore(f, F, made);
    if (!blast) queueScreenSplats(f.x, f.y, F.blood);
    stainBoard(f.x, f.y, f.r * 1.4);
    if (blast) {
      if (game.stats) { game.stats.sliced++; game.stats.blood += F.blood * rand(300, 600); }
      if (mourning()) releaseSoul(f, true);
      return;
    }
    Sfx.squish(F.blood > 1.4 ? 1.4 : 1);
    if (Math.random() < 0.5) Sfx.squeak();
    // a sampled hit now and then, never back-to-back, so it stays funny instead of repetitive
    if (playing() && game.t - game.lastHit > 1.6 && Math.random() < 0.3) { game.lastHit = game.t; Clips.play('hit', HIT_MAX); }
    game.shake = Math.max(game.shake, (3 + 3 * F.blood) * weapon.shake);
    if (weapon.id === 'knife') {
      for (let i = 0; i < 7; i++) {
        const sa = rand(0, TAU), sp = rand(200, 500) * S;
        parts.push({ x: f.x, y: f.y, vx: Math.cos(sa) * sp, vy: Math.sin(sa) * sp, r: rand(1, 2) * S, life: 0.25, max: 0.25, col: pick(['#fff', '#fff3b0', '#ffd34d']) });
      }
    }
    if (game.stats) { game.stats.sliced++; game.stats.blood += F.blood * rand(300, 600); }
    registerCombo(f.x, f.y);
    if (mourning()) {
      // kills by the ghost army get their own lines and don't feed the counter, so Chaos Bane can't chain forever
      addScore(1, f.x, f.y, wave ? pick(ARMY_WORDS) : Math.random() < 0.5 ? mourneWord(f.type) : null, MOURNE.blue, 28);
      releaseSoul(f, !wave);
    } else addScore(1, f.x, f.y, Math.random() < 0.3 ? pick(SPLAT_WORDS) : null);
    if (weapon.id === 'ea' && !wave) rupture(f.x, f.y);
  }

  function sliceGib(gb) {
    gb.dead = true;
    const big = gb.kind === 'heart' || gb.kind === 'brain';
    spawnBlood(gb.x, gb.y, gb.vx, gb.vy, big ? 1.2 : 0.45, gb.kind === 'brain' ? '#e98aa0' : null);
    queueScreenSplats(gb.x, gb.y, big ? 1 : 0.4);
    stainBoard(gb.x, gb.y, gb.r * 1.2);
    if (gb.kind === 'eye') Sfx.pop(); else Sfx.squish(0.6);
    if (gb.kind === 'eye') { // a smear of eyeball goo too
      pendingSplats.push({ t: 0.1, x: gb.x, y: gb.y, R: 22 * S, col: '#e9e4c9' });
    }
    if (game.stats) game.stats.offal++;
    if (mourning()) addScore(1, gb.x, gb.y, MOURNE_GIB[gb.kind], MOURNE.blue, 28);
    else addScore(1, gb.x, gb.y, GIB_WORDS[gb.kind], '#ffb3c1');
  }

  function sliceRope(rp, a, b) {
    if (rp.cool > 0 || rp.pts.length < 6) return;
    const p = rp.pts;
    for (let i = 2; i < p.length - 3; i++) {
      if (!segHit(a, b, p[i], p[i + 1])) continue;
      const tail = p.splice(i + 1);
      ropes.push({ style: rp.style, pts: tail, seg: rp.seg, anchor: null, anchorT: 0, age: rp.age, cool: 0.25 });
      rp.cool = 0.25;
      spawnBlood(p[i].x, p[i].y, 0, 0, 0.5, rp.style === 'guts' ? null : '#efe6cf');
      queueScreenSplats(p[i].x, p[i].y, 0.5);
      Sfx.squish(0.5);
      if (game.stats) game.stats.offal++;
      if (mourning()) addScore(1, p[i].x, p[i].y, MOURNE_GIB[rp.style], MOURNE.blue, 28);
      else addScore(1, p[i].x, p[i].y, rp.style === 'guts' ? 'OFFAL-Y GOOD' : 'SPINELESS', '#ffb3c1');
      return;
    }
  }

  function explodeBomb(f) {
    Sfx.boom();
    game.flash = 1; game.shake = 26;
    spawnBlood(f.x, f.y, 0, 0, 1.6, '#ff8a1c');
    spawnBlood(f.x, f.y, 0, 0, 1.2, '#2a2420');
    stainBoard(f.x, f.y, f.r * 3, '#120c08', 0.5);
    // the blast takes every fruit on screen with it (other bombs survive) and blows the screen clean
    let killed = 0;
    for (const o of fruits) {
      if (o.dead || o.type === 'bomb' || o.y > H + o.r) continue;
      const dx = o.x - f.x, dy = o.y - f.y, d = Math.hypot(dx, dy) || 1;
      o.vx += (dx / d) * 380 * S; o.vy += (dy / d) * 380 * S - 120 * S;
      const ang = Math.atan2(dy, dx) + Math.PI / 2;
      sliceFruit(o, { x: o.x - Math.cos(ang), y: o.y - Math.sin(ang) }, { x: o.x + Math.cos(ang), y: o.y + Math.sin(ang) }, true);
      killed++;
    }
    clearCanvas(sc); pendingSplats = []; drips = []; game.overT = 0;
    popup('BOOM', f.x, f.y, 64, '#ff8a1c');
    if (killed) { Sfx.squish(1.4); addScore(killed, f.x, f.y + 60 * S, `KABOOM x${killed}`, '#ffb347', 40); }
    loseLife(null, f.x, f.y);
  }

  function registerCombo(x, y) {
    const c = game.combo;
    if (game.t - c.last < 0.22) c.n++;
    else { flushCombo(); c.n = 1; }
    c.last = game.t; c.x = x; c.y = y;
  }
  function flushCombo() {
    const c = game.combo;
    if (c.n >= 3) {
      if (mourning()) addScore(c.n, c.x, c.y - 40 * S, `${c.n}x SOUL REAPER`, MOURNE.deep, 46);
      else addScore(c.n, c.x, c.y - 40 * S, `${c.n}x GORE COMBO`, '#ff3b3b', 46);
      queueScreenSplats(c.x, c.y, c.n * 0.5);
      if (game.stats) game.stats.maxCombo = Math.max(game.stats.maxCombo, c.n);
    }
    c.n = 0;
  }

  // Fraction of the screen covered by (mostly opaque) blood, sampled on a tiny copy of the splat layer
  const probe = document.createElement('canvas');
  probe.width = 64; probe.height = 40;
  const pc = probe.getContext('2d', { willReadFrequently: true });
  function bloodCover() {
    pc.clearRect(0, 0, 64, 40);
    pc.drawImage(cv.splat, 0, 0, 64, 40);
    const d = pc.getImageData(0, 0, 64, 40).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 110) n++;
    return n / (64 * 40);
  }

  function startWipe() {
    if (game.wipe) { game.wipe.t = Math.min(game.wipe.t, game.wipe.dur * 0.5); return; }
    game.wipe = { t: 0, dur: 1.1, prev: -Math.PI };
    Sfx.wipe();
  }

  // ---------------------------------------------------------------------------
  // Score / lives / flow
  // ---------------------------------------------------------------------------
  function popup(text, x, y, size = 28, col = '#fff') {
    popups.push({ text, x: clamp(x, 80, W - 80), y: clamp(y, 60, H - 40), vy: -45 * S, life: 1.1, size: size * S, col });
  }

  function addScore(n, x, y, label, col, size) {
    if (playing()) {
      game.score += n;
      updateHud();
      const L = LEVELS[game.li];
      if (game.score >= L.target && !game.boss && !game.bossBeaten) {
        if (L.boss) startBoss(); else game.ending = { win: true, t: 1.2 };
      }
    }
    popup(label || `+${n}`, x, y, size || (label ? 34 : 26), col || '#fff');
  }

  function loseLife(reason, x, y) {
    if (!playing()) return;
    game.lives--;
    Sfx.hurt();
    if (reason) popup(reason, x, H - 60 * S, 30, '#ff6b6b');
    updateHud();
    if (game.lives <= 0) game.ending = { win: false, t: 1.2 };
  }

  function clearWorld() {
    fruits = []; halves = []; gibs = []; ropes = []; parts = []; popups = []; drips = []; pendingSplats = []; spawnQueue = [];
    rings = []; slashes = []; ghosts = []; banes = []; soul.n = 0; soul.pulse = 0;
    game.wipe = null; game.combo = { n: 0, last: -9, x: 0, y: 0 }; game.overT = 0;
    game.boss = null; game.bossBeaten = false; show($('bossbar'), false);
  }
  function clearCanvas(c) { c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, c.canvas.width, c.canvas.height); c.restore(); }

  function show(el, on) { el.hidden = !on; }

  function showBanner(small, big, goal) {
    $('bannerNum').textContent = small;
    $('bannerName').textContent = big;
    $('bannerGoal').textContent = goal;
    const b = $('banner'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  function startBoss() {
    spawnQueue = [];
    game.boss = { x: W / 2, y: H + BOSS.r * S, r: BOSS.r * S, hp: BOSS.hp, t: 0, phase: 'enter', shootT: 2.2,
      hitT: 0, lastHit: -9, lastRupture: -9, mouthT: 0, rot: 0 };
    Clips.fadeAll();
    Music.play([TRACKS.boss]);
    showBanner('BOSS', BOSS.name, 'It shoots fruit. Slice it to death.');
    $('bossName').textContent = BOSS.name;
    updateBossBar();
    show($('bossbar'), true);
    game.shake = 14;
  }

  function updateBossBar() {
    const b = game.boss;
    if (b) $('bossHp').style.width = `${clamp(b.hp / BOSS.hp, 0, 1) * 100}%`;
  }

  function hitBoss(a, b) {
    const B = game.boss;
    if (!B || B.phase === 'dying' || game.t - B.lastHit < 0.09) return;
    B.lastHit = game.t;
    // where the blade crossed the boss, roughly
    const t = clamp(((B.x - a.x) * (b.x - a.x) + (B.y - a.y) * (b.y - a.y)) / (((b.x - a.x) ** 2 + (b.y - a.y) ** 2) || 1), 0, 1);
    const hx = a.x + (b.x - a.x) * t, hy = a.y + (b.y - a.y) * t;
    const dmg = BOSS.dmg[weapon.id] || 1;
    B.hp -= dmg; B.hitT = 0.12;
    spawnBlood(hx, hy, 0, 0, 0.7);
    if (Math.random() < 0.3) queueScreenSplats(hx, hy, 0.5);
    stainBoard(hx, hy, 30 * S);
    Sfx.squish(1.2);
    game.shake = Math.max(game.shake, 6 * weapon.shake);
    popup(`-${dmg}`, hx, hy, 26, '#ff6b6b');
    if (weapon.id === 'katana') slashes.push({ x: hx, y: hy, ang: Math.atan2(b.y - a.y, b.x - a.x), t: 0.3 });
    if (weapon.id === 'ea' && game.t - B.lastRupture > 0.5) { B.lastRupture = game.t; rupture(hx, hy); }
    updateBossBar();
    if (B.hp <= 0) { B.phase = 'dying'; B.t = 0; Sfx.boom(); popup('IT\'S DYING', B.x, B.y - B.r - 30 * S, 44, '#ffb347'); }
  }

  // boss fruit fired from its mouth
  function bossShoot(B) {
    const enraged = B.hp < BOSS.hp / 2;
    const n = enraged ? randi(3, 5) : randi(2, 3);
    const mx = B.x, my = B.y + B.r * 0.35;
    B.mouthT = 0.35;
    Sfx.spit();
    for (let i = 0; i < n; i++) {
      const roll = Math.random();
      const type = roll < 0.1 ? 'bomb' : roll < 0.18 ? 'lemon' : pick(LEVELS[game.li].pool);
      const F = FRUITS[type], r = F.r * S;
      const h = rand(H * 0.08, H * 0.25);
      fruits.push({ type, x: mx + rand(-20, 20) * S, y: my, vx: rand(-1, 1) * W * 0.4, vy: -Math.sqrt(2 * game.g * h),
        rot: rand(-0.4, 0.4), vr: rand(-4, 4), r, quote: null, quoteT: 0 });
    }
    B.shootT = enraged ? rand(1.0, 1.5) : rand(1.7, 2.4);
  }

  function updateBoss(dt) {
    const B = game.boss;
    if (!B) return;
    B.t += dt; B.hitT = Math.max(0, B.hitT - dt); B.mouthT = Math.max(0, B.mouthT - dt);
    const homeY = H * 0.32;
    if (B.phase === 'enter') {
      const p = clamp(B.t / 1.8, 0, 1);
      B.y = lerp(H + B.r, homeY, ease(p));
      if (p >= 1) { B.phase = 'fight'; B.t = 0; }
      return;
    }
    if (B.phase === 'fight') {
      const enraged = B.hp < BOSS.hp / 2;
      B.x = W / 2 + Math.sin(B.t * (enraged ? 0.9 : 0.6)) * Math.max(0, W / 2 - B.r * 1.2);
      B.y = homeY + Math.sin(B.t * 1.3) * 20 * S;
      B.rot = Math.sin(B.t * 0.9) * 0.15;
      if (playing()) { B.shootT -= dt; if (B.shootT <= 0) bossShoot(B); }
      return;
    }
    // dying: shake and gush, then burst
    B.rot = Math.sin(B.t * 40) * 0.08;
    game.shake = Math.max(game.shake, 10);
    if (Math.random() < 0.5) spawnBlood(B.x + rand(-B.r, B.r) * 0.6, B.y + rand(-B.r, B.r) * 0.5, 0, 0, 0.4);
    if (B.t > 1.3) bossExplode(B);
  }

  function bossExplode(B) {
    game.boss = null; game.bossBeaten = true;
    show($('bossbar'), false);
    Sfx.boom(); Sfx.squish(1.6);
    game.flash = 0.8; game.shake = 30;
    for (const side of [-1, 1]) {
      halves.push({ type: 'melon', x: B.x + side * 4, y: B.y, vx: side * 260 * S, vy: -380 * S, rot: Math.PI / 2,
        vr: side * rand(1, 2), bodyRot: B.rot - Math.PI / 2, side, r: B.r, bleed: 3 });
    }
    spawnBlood(B.x, B.y, 0, 0, 5);
    for (let i = 0; i < 4; i++) makeRope('guts', null, B.x + rand(-40, 40) * S, B.y, rand(-400, 400) * S, rand(-700, -300) * S);
    const kinds = ['heart', 'brain', 'eye', 'eye', 'eye', 'tooth', 'tooth', 'tooth', 'bone', 'bone', 'worm', 'worm'];
    for (const kind of kinds) {
      gibs.push({ kind, x: B.x, y: B.y, vx: rand(-500, 500) * S, vy: rand(-850, -250) * S, rot: rand(0, TAU), vr: rand(-8, 8),
        r: GIB_R[kind] * S * 1.4, age: 0, phase: rand(0, TAU), iris: '#c4121f',
        sq: Array.from({ length: 9 }, () => [rand(-0.7, 0.7), rand(-0.5, 0.5), rand(0, TAU)]) });
    }
    for (let i = 0; i < 12; i++) pendingSplats.push({ t: rand(0, 0.5), x: rand(0, W), y: rand(0, H), R: rand(50, 150) * S, col: pick(BLOOD) });
    stainBoard(B.x, B.y, B.r * 1.6, pick(BLOOD), 0.5);
    if (game.stats) { game.stats.sliced++; game.stats.blood += 25000; }
    addScore(BOSS.reward, B.x, B.y, `${BOSS.name} IS DEAD`, '#ffb347', 54);
    if (game.state === 'play') game.ending = { win: true, t: 2.8 };
  }

  function drawBoss(c, B) {
    c.save(); c.translate(B.x, B.y); c.rotate(B.rot);
    const face = B.phase === 'dying' ? { mode: 'dead' } : { mode: 'angry', open: B.mouthT > 0 };
    drawFruitBody(c, 'melon', B.r, face);
    if (B.hitT > 0) {
      c.globalAlpha = B.hitT * 4;
      c.fillStyle = '#fff'; ellipse(c, 0, 0, B.r * 1.1, B.r * 0.92); c.fill();
    }
    c.restore();
  }

  function startLevel(i) {
    Sfx.init();
    game.li = i;
    const L = LEVELS[i];
    clearWorld();
    clearCanvas(sc); clearCanvas(stc);
    Object.assign(game, { score: 0, lives: MAX_LIVES, waveT: 0.4, wave: 0, ending: null, state: 'intro', introT: 1.9 });
    game.stats = { sliced: 0, offal: 0, blood: 0, maxCombo: 0, time: 0, souls: 0 };
    show($('menu'), false); show($('result'), false); show($('pause'), false); show($('champ'), false); show($('hud'), true);
    $('hudLevel').textContent = `Level ${i + 1} · ${L.name}`;
    $('hudTarget').textContent = L.target;
    updateHud();
    showBanner(`LEVEL ${i + 1}`, L.name, `Slice ${L.target} · ${L.blurb}`);
    game.lastHit = game.t;
    Clips.fadeAll();
    Music.play(TRACKS.level(i));
    if (i === 0 || Math.random() < 0.5) Clips.play('sword');
  }

  function updateHud() {
    const L = LEVELS[game.li];
    $('hudScore').textContent = game.score;
    $('hudBar').style.width = `${clamp(game.score / L.target, 0, 1) * 100}%`;
    $('hudLives').innerHTML = Array.from({ length: MAX_LIVES }, (_, i) => `<span class="${i < game.lives ? '' : 'lost'}">❤</span>`).join('');
  }

  function endLevel(win) {
    game.state = 'result';
    game.ending = null;
    flushCombo();
    const L = LEVELS[game.li], st = game.stats;
    const best = store.get('fb-best', {}), cleared = store.get('fb-cleared', {});
    best[game.li] = Math.max(best[game.li] || 0, game.score);
    const hadAll = LEVELS.every((_, i) => cleared[i]);
    if (win) cleared[game.li] = true;
    // whole game beaten: winning the final level with everything cleared, or the win that completes the set
    const champion = win && LEVELS.every((_, i) => cleared[i]) && (game.li === LEVELS.length - 1 || !hadAll);
    store.set('fb-best', best); store.set('fb-cleared', cleared);
    Music.stop(800);
    Clips.play(win ? 'success' : 'defeat');
    $('resTitle').textContent = win ? 'NICE COCK' : 'YOU SUCK';
    $('resSub').textContent = win
      ? pick(['Health inspectors are on their way.', 'The orchard will never be the same.', 'Your mother would be horrified.', 'Somewhere, a smoothie weeps.'])
      : pick(['Too much blood in your eyes?', 'They will tell stories about you. Bad ones.', 'The produce section remembers.', 'Try wiping with a lemon.']);
    const rows = [
      ['Score', `${game.score} / ${L.target}`],
      ['Weapon', weapon.name],
      ['Fruit murdered', st.sliced],
      ['Organs harvested', st.offal],
      ['Blood spilled', `${(st.blood / 1000).toFixed(1)} L`],
      ['Best combo', st.maxCombo ? `${st.maxCombo}x` : '—'],
      ['Time', `${Math.round(st.time)}s`],
    ];
    if (mourning()) rows.splice(4, 0, ['Souls reaped', st.souls]);
    $('resStats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
    $('btnNext').hidden = !(win && game.li < LEVELS.length - 1);
    $('btnRetry').textContent = win ? 'Replay' : 'Retry';
    show($('hud'), false); show($('result'), true);
    if (champion) {
      setTimeout(() => {
        if (game.state !== 'result') return;
        show($('champ'), true);
        for (let i = 0; i < 14; i++) pendingSplats.push({ t: rand(0, 0.6), x: rand(0, W), y: rand(0, H), R: rand(40, 120) * S, col: pick(BLOOD) });
      }, 900);
    }
  }

  function renderWeapons() {
    $('weapons').innerHTML = WEAPONS.map((w) => `
      <button class="wpn ${w.id === weapon.id ? 'on' : ''} ${w.legendary ? 'legendary' : ''}" data-id="${w.id}">
        <img src="${w.img}" alt="">
        <b>${w.name}</b>
        <small>${w.blurb}</small>
      </button>`).join('');
  }

  function showMenu() {
    game.state = 'menu';
    game.ending = null;
    clearWorld();
    game.waveT = 0.5;
    show($('hud'), false); show($('result'), false); show($('pause'), false); show($('champ'), false); show($('menu'), true);
    Clips.fadeAll();
    Music.play([TRACKS.menu]);
    renderWeapons();
    const best = store.get('fb-best', {}), cleared = store.get('fb-cleared', {});
    $('levels').innerHTML = LEVELS.map((L, i) => `
      <button class="lvl-btn" data-i="${i}">
        <span class="n">${i + 1}</span>
        <span class="t"><b>${L.name}</b><small>Slice ${L.target} · ${L.blurb}</small></span>
        <span class="best ${cleared[i] ? 'cleared' : ''}">${cleared[i] ? '✓ ' : ''}${best[i] ? `Best ${best[i]}` : ''}</span>
      </button>`).join('');
  }

  function setPaused(p) {
    if (p && (game.state === 'play' || game.state === 'intro')) {
      game.prevState = game.state; game.state = 'paused'; show($('pause'), true); blade.down = false;
      Music.pause();
    } else if (!p && game.state === 'paused') {
      game.state = game.prevState; show($('pause'), false);
      Music.resume();
    }
  }

  // ---------------------------------------------------------------------------
  // Update
  // ---------------------------------------------------------------------------
  function update(dt) {
    game.t += dt;
    const L = level();
    const g = (game.g = G * L.speed * L.speed);

    if (game.state === 'intro') { game.introT -= dt; if (game.introT <= 0) game.state = 'play'; }
    if ((playing() && !game.boss) || game.state === 'menu') {
      if (game.stats && game.state === 'play') game.stats.time += dt;
      game.waveT -= dt;
      if (game.waveT <= 0) throwWave();
    }
    for (const s of spawnQueue) { s.t -= dt; if (s.t <= 0) throwFruit(s.type); }
    spawnQueue = spawnQueue.filter((s) => s.t > 0);
    if (game.ending) {
      game.ending.t -= dt;
      if (game.ending.t <= 0) endLevel(game.ending.win);
    }

    processCuts();
    updateBoss(dt);
    if (game.combo.n && game.t - game.combo.last > 0.25) flushCombo();

    // fruit
    const look = blade.down ? blade.last : blade.hover;
    for (const f of fruits) {
      if (f.dead) continue;
      if (f.iai) {
        f.iai.t -= dt;
        if (f.iai.t <= 0) { sliceFruit(f, f.iai.a, f.iai.b); spawnBlood(f.x, f.y, 0, 0, 0.8); }
        continue;
      }
      f.vy += g * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.rot += f.vr * dt;
      if (f.quoteT > 0) f.quoteT -= dt;
      f.scared = !!(look && blade.down && Math.hypot(look.x - f.x, look.y - f.y) < 220 * S) || (f.vy > 0 && f.y > H * 0.7);
      if (f.type === 'bomb' && Math.random() < 0.7) {
        const cs = Math.cos(f.rot), sn = Math.sin(f.rot), lx = f.r * 0.5, ly = -f.r * 1.3;
        parts.push({ x: f.x + lx * cs - ly * sn, y: f.y + lx * sn + ly * cs, vx: rand(-80, 80) * S, vy: rand(-140, -20) * S,
          r: rand(1, 2.6) * S, life: 0.3, max: 0.3, col: pick(['#ffd34d', '#ff8a1c', '#fff2a8']) });
      }
      if (f.y > H + f.r * 1.8 && f.vy > 0) {
        f.dead = true;
        if (f.type !== 'bomb' && f.type !== 'lemon') loseLife(pick(ESCAPE_WORDS), f.x, H);
      }
    }
    fruits = fruits.filter((f) => !f.dead);

    // halves (they bleed)
    for (const h of halves) {
      h.vy += g * dt; h.x += h.vx * dt; h.y += h.vy * dt; h.rot += h.vr * dt;
      if (h.bleed > 0) {
        h.bleed -= dt;
        if (Math.random() < 0.6) {
          parts.push({ x: h.x + rand(-h.r, h.r) * 0.5, y: h.y, vx: h.vx * 0.2 + rand(-40, 40) * S, vy: h.vy * 0.2 + rand(0, 60) * S,
            r: rand(1.5, 3.5) * S, life: 0.8, max: 0.8, col: pick(BLOOD) });
        }
      }
    }
    halves = halves.filter((h) => h.y < H + h.r * 3 + 200);

    // gibs
    for (const gb of gibs) {
      if (gb.dead) continue;
      gb.age += dt; gb.phase += dt * 7.5;
      gb.vy += g * dt; gb.x += gb.vx * dt; gb.y += gb.vy * dt; gb.rot += gb.vr * dt;
      if (gb.kind === 'heart' && Math.sin(gb.phase) > 0.97) { // spurts on each beat
        for (let i = 0; i < 3; i++) {
          parts.push({ x: gb.x, y: gb.y - gb.r * 0.6, vx: gb.vx * 0.3 + rand(-60, 60) * S, vy: gb.vy * 0.3 - rand(150, 320) * S,
            r: rand(2, 4) * S, life: 0.8, max: 0.8, col: pick(BLOOD) });
        }
      }
      if (gb.y > H + 80) gb.dead = true;
    }
    gibs = gibs.filter((gb) => !gb.dead);

    // ropes (verlet)
    for (const rp of ropes) {
      rp.age += dt; rp.cool -= dt;
      if (rp.anchor) { rp.anchorT -= dt; if (rp.anchorT <= 0 || !halves.includes(rp.anchor)) rp.anchor = null; }
      const gdt = g * dt * dt;
      for (const p of rp.pts) {
        const vx = (p.x - p.px) * 0.99, vy = (p.y - p.py) * 0.99;
        p.px = p.x; p.py = p.y; p.x += vx; p.y += vy + gdt;
      }
      for (let it = 0; it < 6; it++) {
        if (rp.anchor) { rp.pts[0].x = rp.anchor.x; rp.pts[0].y = rp.anchor.y; }
        for (let i = 0; i < rp.pts.length - 1; i++) {
          const a = rp.pts[i], b = rp.pts[i + 1];
          const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 0.001;
          const diff = (d - rp.seg) / d * 0.5;
          const pinA = i === 0 && rp.anchor;
          if (pinA) { b.x -= dx * diff * 2; b.y -= dy * diff * 2; }
          else { a.x += dx * diff; a.y += dy * diff; b.x -= dx * diff; b.y -= dy * diff; }
        }
      }
      if (rp.style === 'guts' && Math.random() < 0.15) {
        const p = rp.pts[rp.pts.length - 1];
        parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, r: rand(1.5, 3) * S, life: 0.7, max: 0.7, col: pick(BLOOD) });
      }
    }
    ropes = ropes.filter((rp) => rp.pts.length > 1 && rp.age < 10 && rp.pts.some((p) => p.y < H + 60));

    // particles
    for (const p of parts) {
      p.vy += g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 && Math.random() < 0.12 && p.y < H && p.y > 0) {
        stc.globalAlpha = 0.35; stc.fillStyle = p.col; circle(stc, p.x, p.y, p.r * 1.3); stc.globalAlpha = 1;
      }
    }
    parts = parts.filter((p) => p.life > 0);

    for (const p of popups) { p.y += p.vy * dt; p.life -= dt; }
    popups = popups.filter((p) => p.life > 0);

    // screen splatter
    for (const s of pendingSplats) { s.t -= dt; if (s.t <= 0) drawSplat(s.x, s.y, s.R, s.col); }
    pendingSplats = pendingSplats.filter((s) => s.t > 0);

    sc.save();
    for (const d of drips) {
      d.life -= dt;
      d.v = Math.max(0, d.v + rand(-50, 40) * S * dt);
      d.y += d.v * dt; d.r -= dt * 0.35 * S;
      sc.fillStyle = d.col;
      sc.globalAlpha = 0.9;
      circle(sc, d.x, d.y, d.r);
      if (d.life <= 0 || d.r < 1) circle(sc, d.x, d.y + d.r * 0.4, Math.max(d.r, 1.5) * 1.35);
    }
    sc.restore();
    drips = drips.filter((d) => d.life > 0 && d.r >= 1 && d.y < H + 20);

    game.fadeAcc += dt * L.fade;
    if (game.fadeAcc >= 0.06) {
      sc.save(); sc.globalCompositeOperation = 'destination-out';
      sc.fillStyle = `rgba(0,0,0,${Math.min(1, game.fadeAcc)})`; sc.fillRect(0, 0, W, H);
      sc.restore();
      game.fadeAcc = 0;
    }

    game.coverT -= dt;
    if (game.coverT <= 0 && !game.wipe) {
      game.coverT = AUTO_WIPE.every;
      game.overT = bloodCover() > AUTO_WIPE.cover ? game.overT + AUTO_WIPE.every : 0;
      if (game.overT >= AUTO_WIPE.hold) {
        game.overT = 0;
        startWipe();
        if (game.state === 'play') popup(pick(['TOO MUCH BLOOD', "CAN'T SEE A THING", 'WIPERS ON', 'HOSE IT DOWN']), W / 2, H * 0.3, 40, '#9fe7ff');
      }
    }

    // windshield wiper
    if (game.wipe) {
      const w = game.wipe;
      w.t += dt;
      const p = w.t / w.dur;
      const a = p < 0.5 ? -Math.PI + Math.PI * ease(p * 2) : -Math.PI * ease((p - 0.5) * 2);
      const px = W / 2, py = H + 20, len = Math.hypot(W / 2, H + 20) * 1.08;
      sc.save(); sc.globalCompositeOperation = 'destination-out';
      sc.beginPath(); sc.moveTo(px, py);
      sc.arc(px, py, len, Math.min(a, w.prev) - 0.04, Math.max(a, w.prev) + 0.04);
      sc.closePath(); sc.fill(); sc.restore();
      w.prev = a; w.angle = a;
      if (p >= 1) { game.wipe = null; drips = []; }
    }

    // blade trail
    const now = performance.now();
    blade.pts = blade.pts.filter((p) => now - p.t < weapon.life);
    for (const r of rings) r.t += dt;
    rings = rings.filter((r) => r.t < r.max);
    for (const sl of slashes) sl.t -= dt;
    slashes = slashes.filter((sl) => sl.t > 0);
    for (const b of banes) b.t += dt;
    banes = banes.filter((b) => b.t < b.max);
    updateGhosts(dt);
    soul.pulse = Math.max(0, soul.pulse - dt);

    game.shake *= Math.pow(0.004, dt);
    game.flash = Math.max(0, game.flash - dt * 2.2);
  }

  // ---------------------------------------------------------------------------
  // Drawing: fruit
  // ---------------------------------------------------------------------------
  function radial(c, r, stops, ox = -0.35, oy = -0.4) {
    const g = c.createRadialGradient(r * ox, r * oy, r * 0.1, 0, 0, r * 1.15);
    stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
    return g;
  }
  function ellipse(c, x, y, rx, ry, rot = 0) { c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU); }

  function drawFace(c, r, face, oy = 0, k = 1) {
    const s = (r / 40) * k;
    c.save(); c.translate(0, oy);
    const ex = 11 * s, ey = -5 * s, er = 6.5 * s;
    c.lineCap = 'round';
    if (face.mode === 'dead') {
      c.strokeStyle = '#1a0505'; c.lineWidth = 2.6 * s;
      c.beginPath();
      for (const sx of [-1, 1]) {
        const x = sx * ex;
        c.moveTo(x - 4 * s, ey - 4 * s); c.lineTo(x + 4 * s, ey + 4 * s);
        c.moveTo(x + 4 * s, ey - 4 * s); c.lineTo(x - 4 * s, ey + 4 * s);
      }
      c.moveTo(-7 * s, 12 * s); c.quadraticCurveTo(0, 6 * s, 7 * s, 12 * s);
      c.stroke();
      c.fillStyle = '#ff6f91'; ellipse(c, 3 * s, 14 * s, 3 * s, 4.5 * s, 0.3); c.fill();
    } else if (face.mode === 'angry') {
      c.fillStyle = '#fff4e0';
      for (const sx of [-1, 1]) { ellipse(c, sx * ex, ey, er, er * 0.9); c.fill(); }
      c.fillStyle = '#c4121f';
      for (const sx of [-1, 1]) circle(c, sx * ex + sx * -1.2 * s, ey + 1 * s, 2.8 * s);
      c.fillStyle = '#000';
      for (const sx of [-1, 1]) circle(c, sx * ex + sx * -1.2 * s, ey + 1 * s, 1.2 * s);
      c.strokeStyle = '#1a0505'; c.lineWidth = 3 * s;
      c.beginPath();
      for (const sx of [-1, 1]) { c.moveTo(sx * (ex + 7 * s), ey - 12 * s); c.lineTo(sx * (ex - 7 * s), ey - 6 * s); }
      c.stroke();
      c.fillStyle = '#3a0610';
      if (face.open) { ellipse(c, 0, 12 * s, 9 * s, 8 * s); c.fill(); }
      else { c.fillRect(-9 * s, 8 * s, 18 * s, 6 * s); }
      c.fillStyle = '#fff6dc';
      for (let i = 0; i < 4; i++) {
        const x = -8 * s + i * 4.4 * s, y = face.open ? 5 * s : 8 * s;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + 3.6 * s, y); c.lineTo(x + 1.8 * s, y + 3.5 * s); c.fill();
      }
    } else if (face.mode === 'cool') {
      c.fillStyle = '#111';
      for (const sx of [-1, 1]) { ellipse(c, sx * ex, ey, er * 1.2, er * 0.85); c.fill(); }
      c.strokeStyle = '#111'; c.lineWidth = 2 * s;
      c.beginPath(); c.moveTo(-ex + er, ey - 2 * s); c.lineTo(ex - er, ey - 2 * s); c.stroke();
      c.strokeStyle = '#5a4300'; c.lineWidth = 2.2 * s;
      c.beginPath(); c.arc(0, 6 * s, 7 * s, 0.2 * Math.PI, 0.8 * Math.PI); c.stroke();
    } else {
      const scared = face.mode === 'scared';
      c.fillStyle = '#fff';
      for (const sx of [-1, 1]) { ellipse(c, sx * ex, ey, er, er * 1.15); c.fill(); }
      c.fillStyle = '#111';
      const pr = scared ? 2 * s : 3.2 * s;
      for (const sx of [-1, 1]) circle(c, sx * ex + face.lx * 2.6 * s, ey + face.ly * 3 * s, pr);
      c.strokeStyle = '#2a0a0a'; c.lineWidth = 2.2 * s;
      c.beginPath();
      for (const sx of [-1, 1]) {
        c.moveTo(sx * (ex + 6 * s), ey - (scared ? 8 : 9) * s);
        c.lineTo(sx * (ex - 5 * s), ey - (scared ? 13 : 10) * s);
      }
      c.stroke();
      if (scared) {
        c.fillStyle = '#3a0610'; ellipse(c, 0, 11 * s, 4.5 * s, 6 * s); c.fill();
        c.fillStyle = 'rgba(160,210,255,.9)'; ellipse(c, ex + 10 * s, ey - 4 * s, 2 * s, 3.2 * s); c.fill();
      } else {
        c.beginPath(); c.moveTo(-5 * s, 11 * s); c.quadraticCurveTo(0, 8 * s, 5 * s, 11 * s); c.stroke();
      }
    }
    c.restore();
  }

  function drawFruitBody(c, type, r, face) {
    const F = FRUITS[type];
    let fy = 0;
    switch (type) {
      case 'apple': {
        c.fillStyle = radial(c, r, ['#ff7a7a', '#d62828', '#7a0c12']);
        c.beginPath();
        c.moveTo(0, -r * 0.72);
        c.bezierCurveTo(r * 0.6, -r * 1.15, r * 1.15, -r * 0.4, r * 0.95, r * 0.25);
        c.bezierCurveTo(r * 0.8, r * 0.85, r * 0.3, r * 1.05, 0, r * 0.88);
        c.bezierCurveTo(-r * 0.3, r * 1.05, -r * 0.8, r * 0.85, -r * 0.95, r * 0.25);
        c.bezierCurveTo(-r * 1.15, -r * 0.4, -r * 0.6, -r * 1.15, 0, -r * 0.72);
        c.fill();
        c.strokeStyle = '#5a3a1a'; c.lineWidth = r * 0.1; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, -r * 0.7); c.quadraticCurveTo(r * 0.05, -r * 1.0, r * 0.15, -r * 1.15); c.stroke();
        c.fillStyle = '#3c9a3c'; ellipse(c, r * 0.38, -r * 1.0, r * 0.28, r * 0.12, -0.5); c.fill();
        fy = r * 0.1;
        break;
      }
      case 'orange': {
        c.fillStyle = radial(c, r, ['#ffc46b', '#f28a1a', '#a8520a']);
        circle(c, 0, 0, r);
        c.fillStyle = 'rgba(150,70,0,.25)';
        for (const [x, y] of DOTS.orange) circle(c, x * r, y * r, r * 0.035);
        c.fillStyle = '#4c7a2a'; circle(c, 0, -r * 0.88, r * 0.08);
        break;
      }
      case 'strawberry': {
        c.fillStyle = radial(c, r, ['#ff6b7a', '#d7192d', '#7d0a16']);
        c.beginPath();
        c.moveTo(0, r * 1.0);
        c.bezierCurveTo(-r * 1.25, r * 0.2, -r * 1.0, -r * 0.85, 0, -r * 0.7);
        c.bezierCurveTo(r * 1.0, -r * 0.85, r * 1.25, r * 0.2, 0, r * 1.0);
        c.fill();
        c.fillStyle = '#ffe680';
        for (const [x, y] of DOTS.straw) { ellipse(c, x * r, y * r, r * 0.04, r * 0.07); c.fill(); }
        c.fillStyle = '#2f8f3a';
        c.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = -Math.PI / 2 + (i - 2) * 0.55;
          c.moveTo(0, -r * 0.7); c.lineTo(Math.cos(a + 1.2) * r * 0.55, -r * 0.7 + Math.sin(a + 1.2) * r * 0.25 + r * 0.05);
          c.lineTo(Math.cos(a + 1.4) * r * 0.2, -r * 0.6);
        }
        c.fill();
        circle(c, 0, -r * 0.75, r * 0.12);
        fy = r * 0.05;
        break;
      }
      case 'melon': {
        c.save();
        ellipse(c, 0, 0, r * 1.1, r * 0.92);
        c.fillStyle = radial(c, r, ['#7fd36b', '#2f8a2f', '#14501c']); c.fill();
        c.clip();
        c.strokeStyle = 'rgba(15,70,20,.85)'; c.lineWidth = r * 0.12;
        for (let k = -4; k <= 4; k++) {
          c.beginPath();
          for (let t = -1; t <= 1.001; t += 0.25) {
            const x = k * r * 0.28 + Math.sin(t * 4 + k) * r * 0.05 + t * k * r * 0.05, y = t * r;
            t === -1 ? c.moveTo(x, y) : c.lineTo(x, y);
          }
          c.stroke();
        }
        c.restore();
        break;
      }
      case 'banana': {
        const cy = -r * 1.15, R = r * 1.35, a0 = Math.PI * 0.22, a1 = Math.PI * 0.78;
        c.lineCap = 'round';
        c.strokeStyle = '#8a6a10'; c.lineWidth = r * 0.78; c.beginPath(); c.arc(0, cy, R, a0, a1); c.stroke();
        c.strokeStyle = '#f6d33c'; c.lineWidth = r * 0.64; c.beginPath(); c.arc(0, cy, R, a0, a1); c.stroke();
        c.strokeStyle = 'rgba(255,255,255,.35)'; c.lineWidth = r * 0.1; c.beginPath(); c.arc(0, cy, R - r * 0.16, a0 + 0.1, a1 - 0.1); c.stroke();
        c.fillStyle = '#4a3008';
        for (const a of [a0, a1]) circle(c, Math.cos(a) * R, cy + Math.sin(a) * R, r * 0.13);
        fy = r * 0.18;
        break;
      }
      case 'coconut': {
        c.fillStyle = radial(c, r, ['#9a6a3e', '#6b4226', '#3a2210']);
        circle(c, 0, 0, r);
        c.strokeStyle = 'rgba(40,20,5,.7)'; c.lineWidth = r * 0.04;
        c.beginPath();
        for (const [a, l] of DOTS.coco) {
          const x = Math.cos(a) * r * 0.75, y = Math.sin(a) * r * 0.75;
          c.moveTo(x, y); c.lineTo(x + Math.cos(a + 0.6) * r * l, y + Math.sin(a + 0.6) * r * l);
        }
        c.stroke();
        break;
      }
      case 'pineapple': {
        const leaf = ['#2f8f3a', '#3fae4a', '#277a31'];
        for (let i = -2; i <= 2; i++) {
          c.fillStyle = leaf[(i + 3) % 3];
          c.beginPath();
          c.moveTo(i * r * 0.14 - r * 0.12, -r * 0.8); c.lineTo(i * r * 0.32, -r * 1.6 + Math.abs(i) * r * 0.2); c.lineTo(i * r * 0.14 + r * 0.12, -r * 0.8);
          c.fill();
        }
        c.save();
        ellipse(c, 0, 0, r * 0.8, r);
        c.fillStyle = radial(c, r, ['#ffd86b', '#e0a52a', '#8a5a10']); c.fill();
        c.clip();
        c.strokeStyle = 'rgba(110,60,0,.55)'; c.lineWidth = r * 0.05;
        c.beginPath();
        for (let k = -6; k <= 6; k++) {
          c.moveTo(k * r * 0.3 - r, -r); c.lineTo(k * r * 0.3 + r, r);
          c.moveTo(k * r * 0.3 + r, -r); c.lineTo(k * r * 0.3 - r, r);
        }
        c.stroke();
        c.restore();
        break;
      }
      case 'lemon': {
        c.fillStyle = '#e8c21a';
        circle(c, r * 1.1, 0, r * 0.14); circle(c, -r * 1.1, 0, r * 0.14);
        ellipse(c, 0, 0, r * 1.12, r * 0.86);
        c.fillStyle = radial(c, r, ['#fff7a8', '#f7dc2c', '#c9a10a']); c.fill();
        break;
      }
      case 'bomb': {
        c.fillStyle = '#333'; c.fillRect(-r * 0.25, -r * 1.15, r * 0.5, r * 0.3);
        c.strokeStyle = '#c9a56b'; c.lineWidth = r * 0.08; c.lineCap = 'round';
        c.beginPath(); c.moveTo(0, -r * 1.15); c.quadraticCurveTo(r * 0.1, -r * 1.45, r * 0.5, -r * 1.3); c.stroke();
        c.fillStyle = radial(c, r, ['#666', '#262626', '#050505']);
        circle(c, 0, 0, r);
        c.fillStyle = '#e8e2d5'; // skull
        circle(c, 0, -r * 0.05, r * 0.42);
        c.fillRect(-r * 0.24, r * 0.2, r * 0.48, r * 0.24);
        c.fillStyle = '#111';
        circle(c, -r * 0.16, -r * 0.07, r * 0.11); circle(c, r * 0.16, -r * 0.07, r * 0.11);
        c.fillRect(-r * 0.03, r * 0.08, r * 0.06, r * 0.1);
        for (let i = -1; i <= 1; i++) c.fillRect(i * r * 0.12 - r * 0.015, r * 0.28, r * 0.03, r * 0.16);
        return;
      }
    }
    if (face) drawFace(c, r, face, fy, F.face || 1);
  }

  function drawCross(c, type, r) {
    const F = FRUITS[type], rx = r * F.cw, ry = r * 0.3;
    if (type === 'lemon') {
      c.fillStyle = '#f2d43a'; ellipse(c, 0, 0, rx, ry); c.fill();
      c.fillStyle = '#fff6c4'; ellipse(c, 0, 0, rx * 0.88, ry * 0.82); c.fill();
      c.fillStyle = '#ffe866'; ellipse(c, 0, 0, rx * 0.8, ry * 0.72); c.fill();
      c.strokeStyle = '#fff6c4'; c.lineWidth = 1.5 * S; c.beginPath();
      for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; c.moveTo(0, 0); c.lineTo(Math.cos(a) * rx * 0.8, Math.sin(a) * ry * 0.72); }
      c.stroke();
      return;
    }
    // every fruit is secretly a ham steak
    c.fillStyle = F.rind; ellipse(c, 0, 0, rx, ry); c.fill();
    c.fillStyle = '#f3dfd2'; ellipse(c, 0, 0, rx * 0.9, ry * 0.82); c.fill();
    const g = c.createRadialGradient(-rx * 0.2, -ry * 0.2, 1, 0, 0, rx);
    g.addColorStop(0, '#e0485c'); g.addColorStop(1, '#8e1626');
    c.fillStyle = g; ellipse(c, 0, 0, rx * 0.8, ry * 0.68); c.fill();
    c.strokeStyle = 'rgba(255,235,235,.55)'; c.lineWidth = 1.2 * S;
    c.beginPath(); c.moveTo(-rx * 0.6, -ry * 0.1); c.quadraticCurveTo(-rx * 0.2, ry * 0.4, rx * 0.05, -ry * 0.2);
    c.moveTo(-rx * 0.4, ry * 0.35); c.quadraticCurveTo(0, ry * 0.1, rx * 0.5, ry * 0.3); c.stroke();
    c.fillStyle = '#efe5cc'; ellipse(c, rx * 0.2, -ry * 0.05, rx * 0.16, ry * 0.4); c.fill();
    c.fillStyle = '#b2475c'; ellipse(c, rx * 0.2, -ry * 0.05, rx * 0.07, ry * 0.18); c.fill();
    c.fillStyle = 'rgba(110,0,10,.65)'; ellipse(c, -rx * 0.35, ry * 0.15, rx * 0.22, ry * 0.25); c.fill();
  }

  function drawFruit(c, f) {
    c.save(); c.translate(f.x, f.y); c.rotate(f.rot);
    let face = null;
    if (f.type === 'lemon') face = { mode: 'cool' };
    else if (f.type !== 'bomb') {
      const look = blade.down ? blade.last : blade.hover;
      let lx = 0, ly = 0.3;
      if (look) {
        const dx = look.x - f.x, dy = look.y - f.y, d = Math.hypot(dx, dy) || 1;
        const cs = Math.cos(-f.rot), sn = Math.sin(-f.rot);
        lx = (dx * cs - dy * sn) / d; ly = (dx * sn + dy * cs) / d;
      }
      face = { mode: f.scared ? 'scared' : 'calm', lx, ly };
    }
    if (f.type === 'lemon') { // glow so it reads as a power-up
      c.save(); c.globalAlpha = 0.35 + 0.15 * Math.sin(game.t * 8);
      c.fillStyle = '#fff59a'; circle(c, 0, 0, f.r * 1.5); c.restore();
    }
    drawFruitBody(c, f.type, f.r, face);
    c.restore();
  }

  function drawHalf(c, h) {
    c.save(); c.translate(h.x, h.y); c.rotate(h.rot);
    const R = h.r * 2.2;
    c.save();
    c.beginPath(); c.rect(-R, h.side > 0 ? 0 : -R, R * 2, R); c.clip();
    c.rotate(h.bodyRot);
    drawFruitBody(c, h.type, h.r, h.type === 'lemon' ? { mode: 'cool' } : { mode: 'dead' });
    c.restore();
    drawCross(c, h.type, h.r);
    c.restore();
  }

  function drawBubble(c, f) {
    c.save();
    c.globalAlpha = Math.min(1, f.quoteT * 3);
    const fs = Math.round(12 * S + 3);
    c.font = `600 ${fs}px Rubik, system-ui, sans-serif`;
    const tw = c.measureText(f.quote).width, bw = tw + 18, bh = fs + 12;
    const bx = clamp(f.x - bw / 2, 6, W - bw - 6), by = f.y - f.r - 18 * S - bh;
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 2;
    c.beginPath(); c.roundRect ? c.roundRect(bx, by, bw, bh, 8) : c.rect(bx, by, bw, bh); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(f.x - 6, by + bh - 1); c.lineTo(f.x, by + bh + 9); c.lineTo(f.x + 6, by + bh - 1); c.fill();
    c.fillStyle = '#111'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(f.quote, bx + bw / 2, by + bh / 2 + 1);
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // Drawing: gore
  // ---------------------------------------------------------------------------
  function heartPath(c, r) {
    c.beginPath(); c.moveTo(0, r * 0.9);
    c.bezierCurveTo(-r * 1.2, r * 0.1, -r * 0.9, -r * 0.9, 0, -r * 0.4);
    c.bezierCurveTo(r * 0.9, -r * 0.9, r * 1.2, r * 0.1, 0, r * 0.9);
    c.closePath();
  }

  function drawGib(c, gb) {
    const r = gb.r;
    c.save(); c.translate(gb.x, gb.y); c.rotate(gb.rot);
    c.lineCap = 'round'; c.lineJoin = 'round';
    switch (gb.kind) {
      case 'eye': {
        c.strokeStyle = '#c4566c'; c.lineWidth = 3 * S;
        c.beginPath(); c.moveTo(-r * 0.9, 0);
        c.bezierCurveTo(-r * 1.6, Math.sin(gb.phase) * r * 0.6, -r * 2, -r * 0.4, -r * 2.6, Math.sin(gb.phase * 0.7) * r * 0.5);
        c.stroke();
        c.fillStyle = '#f7f4ee'; circle(c, 0, 0, r);
        c.strokeStyle = 'rgba(200,20,30,.75)'; c.lineWidth = 0.9 * S; c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU + 0.4;
          c.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          c.quadraticCurveTo(Math.cos(a + 0.3) * r * 0.75, Math.sin(a + 0.3) * r * 0.75, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
        }
        c.stroke();
        c.fillStyle = gb.iris; circle(c, r * 0.38, 0, r * 0.5);
        c.fillStyle = '#000'; circle(c, r * 0.48, 0, r * 0.24);
        c.fillStyle = '#fff'; circle(c, r * 0.32, -r * 0.18, r * 0.1);
        break;
      }
      case 'tooth': {
        c.fillStyle = '#f6f1e1'; c.strokeStyle = '#a89d80'; c.lineWidth = 1.2 * S;
        c.beginPath();
        c.moveTo(-r * 0.8, -r * 0.2);
        c.quadraticCurveTo(-r * 0.9, -r, 0, -r * 0.9);
        c.quadraticCurveTo(r * 0.9, -r, r * 0.8, -r * 0.2);
        c.lineTo(r * 0.5, r); c.lineTo(r * 0.15, r * 0.25); c.lineTo(-r * 0.15, r * 0.25); c.lineTo(-r * 0.5, r);
        c.closePath(); c.fill(); c.stroke();
        c.fillStyle = '#a10a12'; circle(c, r * 0.5, r, r * 0.18); circle(c, -r * 0.5, r, r * 0.18);
        break;
      }
      case 'worm': {
        const path = () => {
          c.beginPath();
          for (let i = 0; i <= 10; i++) {
            const x = -r + (i / 10) * r * 2, y = Math.sin(gb.phase * 1.3 + i * 0.9) * r * 0.3;
            i ? c.lineTo(x, y) : c.moveTo(x, y);
          }
        };
        c.strokeStyle = '#8c3a50'; c.lineWidth = 7 * S; path(); c.stroke();
        c.strokeStyle = '#ec93a8'; c.lineWidth = 4.5 * S; path(); c.stroke();
        c.fillStyle = '#111';
        const hy = Math.sin(gb.phase * 1.3 + 9) * r * 0.3;
        circle(c, r - 1 * S, hy - 1.2 * S, 1 * S);
        break;
      }
      case 'heart': {
        const pulse = 1 + Math.max(0, Math.sin(gb.phase)) * 0.18;
        c.scale(pulse, pulse);
        c.fillStyle = '#d9b0a0'; c.fillRect(-r * 0.35, -r * 1.05, r * 0.22, r * 0.5); c.fillRect(r * 0.05, -r * 1.15, r * 0.25, r * 0.6);
        c.fillStyle = radial(c, r, ['#e2414f', '#a3121f', '#4f040b']); heartPath(c, r); c.fill();
        c.strokeStyle = 'rgba(70,90,200,.7)'; c.lineWidth = 2 * S;
        c.beginPath(); c.moveTo(-r * 0.2, -r * 0.3); c.quadraticCurveTo(r * 0.3, r * 0.1, 0, r * 0.6); c.stroke();
        break;
      }
      case 'brain': {
        c.fillStyle = '#f2a7b5'; c.strokeStyle = '#b5566c'; c.lineWidth = 2 * S;
        ellipse(c, 0, 0, r, r * 0.75); c.fill(); c.stroke();
        c.lineWidth = 1.5 * S; c.beginPath();
        c.moveTo(0, -r * 0.7); c.quadraticCurveTo(r * 0.1, 0, 0, r * 0.7);
        for (const [x, y, a] of gb.sq) { c.moveTo(x * r + Math.cos(a) * r * 0.2, y * r + Math.sin(a) * r * 0.2); c.arc(x * r, y * r, r * 0.2, a, a + 2.4); }
        c.stroke();
        break;
      }
      case 'bone': {
        c.fillStyle = '#f1e8d0'; c.strokeStyle = '#a3967a'; c.lineWidth = 1.2 * S;
        c.beginPath();
        c.rect(-r * 0.8, -r * 0.16, r * 1.6, r * 0.32);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) c.moveTo(sx * r * 0.85 + r * 0.22, sy * r * 0.2), c.arc(sx * r * 0.85, sy * r * 0.2, r * 0.22, 0, TAU);
        c.fill(); c.stroke();
        c.fillStyle = '#a10a12'; circle(c, r * 0.95, r * 0.05, r * 0.12);
        break;
      }
    }
    c.restore();
  }

  function smoothRope(c, pts) {
    c.beginPath(); c.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      c.quadraticCurveTo(pts[i].x, pts[i].y, (pts[i].x + pts[i + 1].x) / 2, (pts[i].y + pts[i + 1].y) / 2);
    }
    const l = pts[pts.length - 1]; c.lineTo(l.x, l.y);
  }

  function drawRope(c, rp) {
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    if (rp.style === 'guts') {
      c.strokeStyle = '#5e1424'; c.lineWidth = 12 * S; smoothRope(c, rp.pts); c.stroke();
      c.strokeStyle = '#d9707f'; c.lineWidth = 8.5 * S; smoothRope(c, rp.pts); c.stroke();
      c.strokeStyle = 'rgba(255,215,222,.55)'; c.lineWidth = 2.5 * S;
      c.translate(-1.5 * S, -2 * S); smoothRope(c, rp.pts); c.stroke();
    } else {
      c.strokeStyle = '#b9a57e'; c.lineWidth = 4 * S; smoothRope(c, rp.pts); c.stroke();
      c.fillStyle = '#f1e8d0'; c.strokeStyle = '#8a7a5c'; c.lineWidth = 1.2 * S;
      for (let i = 0; i < rp.pts.length; i++) {
        const p = rp.pts[i], q = rp.pts[Math.min(i + 1, rp.pts.length - 1)], o = rp.pts[Math.max(i - 1, 0)];
        const a = Math.atan2(q.y - o.y, q.x - o.x);
        c.save(); c.translate(p.x, p.y); c.rotate(a);
        c.beginPath(); c.rect(-3.5 * S, -6 * S, 7 * S, 12 * S); c.fill(); c.stroke();
        c.restore();
      }
    }
    c.restore();
  }

  // ---------------------------------------------------------------------------
  // Draw
  // ---------------------------------------------------------------------------
  function draw() {
    gc.clearRect(0, 0, W, H);
    for (const h of halves) drawHalf(gc, h);
    if (game.boss) drawBoss(gc, game.boss);
    for (const rp of ropes) drawRope(gc, rp);
    for (const f of fruits) drawFruit(gc, f);
    for (const gb of gibs) drawGib(gc, gb);
    for (const p of parts) {
      gc.globalAlpha = Math.min(1, (p.life / p.max) * 2);
      gc.fillStyle = p.col;
      circle(gc, p.x, p.y, p.r);
    }
    gc.globalAlpha = 1;
    for (const f of fruits) if (f.quote && f.quoteT > 0) drawBubble(gc, f);

    fc.clearRect(0, 0, W, H);
    if (game.wipe && game.wipe.angle !== undefined) {
      const a = game.wipe.angle, px = W / 2, py = H + 20, len = Math.hypot(W / 2, H + 20) * 1.08;
      const ex = px + Math.cos(a) * len, ey = py + Math.sin(a) * len;
      fc.save(); fc.lineCap = 'round';
      fc.strokeStyle = '#2b2b2b'; fc.lineWidth = 9 * S;
      fc.beginPath(); fc.moveTo(px, py); fc.lineTo(ex, ey); fc.stroke();
      const nx = -Math.sin(a) * 9 * S, ny = Math.cos(a) * 9 * S;
      fc.strokeStyle = '#0d0d0d'; fc.lineWidth = 7 * S;
      fc.beginPath(); fc.moveTo(px + Math.cos(a) * len * 0.15 + nx, py + Math.sin(a) * len * 0.15 + ny); fc.lineTo(ex + nx, ey + ny); fc.stroke();
      fc.restore();
    }

    for (const r of rings) {
      const p = r.t / r.max, rad = r.R * (0.25 + 0.75 * ease(p));
      fc.save();
      // crimson flash that fills the blast, then fades
      fc.globalAlpha = 0.35 * (1 - p) * (1 - p);
      fc.fillStyle = '#ff1f4b';
      fc.beginPath(); fc.arc(r.x, r.y, rad, 0, TAU); fc.fill();
      fc.globalAlpha = 1 - p;
      fc.strokeStyle = '#ff1f4b'; fc.lineWidth = 28 * S * (1 - p) + 2;
      fc.beginPath(); fc.arc(r.x, r.y, rad, 0, TAU); fc.stroke();
      fc.strokeStyle = '#14000a'; fc.lineWidth = 14 * S * (1 - p) + 1;
      fc.beginPath(); fc.arc(r.x, r.y, rad * 0.8, 0, TAU); fc.stroke();
      fc.strokeStyle = '#ff9db0'; fc.lineWidth = 4 * S * (1 - p) + 1;
      fc.beginPath(); fc.arc(r.x, r.y, rad * 1.12, 0, TAU); fc.stroke();
      fc.restore();
    }
    for (const sl of slashes) {
      const len = Math.hypot(W, H), dx = Math.cos(sl.ang) * len, dy = Math.sin(sl.ang) * len;
      fc.save(); fc.lineCap = 'round';
      fc.globalAlpha = Math.min(1, sl.t * 4);
      fc.strokeStyle = 'rgba(255,30,60,0.35)'; fc.lineWidth = 10 * S;
      fc.beginPath(); fc.moveTo(sl.x - dx, sl.y - dy); fc.lineTo(sl.x + dx, sl.y + dy); fc.stroke();
      fc.strokeStyle = '#fff'; fc.lineWidth = 2.5 * S;
      fc.beginPath(); fc.moveTo(sl.x - dx, sl.y - dy); fc.lineTo(sl.x + dx, sl.y + dy); fc.stroke();
      fc.restore();
    }

    for (const b of banes) {
      const p = b.t / b.max, rad = Math.hypot(W, H) * ease(Math.min(1, p * 1.6));
      fc.save();
      // the screen goes dark purple for a beat and a ring of soul-fire spreads out from the counter
      fc.globalAlpha = 0.45 * (1 - p);
      fc.fillStyle = '#12002a'; fc.fillRect(0, 0, W, H);
      fc.globalAlpha = 1 - p;
      fc.strokeStyle = '#3ce0ff'; fc.lineWidth = 22 * S * (1 - p) + 2;
      fc.shadowColor = '#3ce0ff'; fc.shadowBlur = 25;
      fc.beginPath(); fc.arc(b.x, b.y, rad, 0, TAU); fc.stroke();
      fc.strokeStyle = MOURNE.deep; fc.lineWidth = 8 * S * (1 - p) + 1;
      fc.beginPath(); fc.arc(b.x, b.y, rad * 0.8, 0, TAU); fc.stroke();
      fc.restore();
    }
    for (const g of ghosts) drawGhost(fc, g);
    if (mourning() && ['play', 'intro', 'paused'].includes(game.state)) drawSoulCounter();

    if (blade.pts.length > 1) {
      fc.save(); fc.lineCap = 'round'; fc.lineJoin = 'round';
      const n = blade.pts.length;
      for (const [col, width] of TRAILS[weapon.id]) {
        for (let i = 1; i < n; i++) {
          const t = i / (n - 1), a = blade.pts[i - 1], b = blade.pts[i];
          fc.strokeStyle = col(t);
          fc.lineWidth = width(t) * S;
          fc.beginPath(); fc.moveTo(a.x, a.y); fc.lineTo(b.x, b.y); fc.stroke();
        }
      }
      fc.restore();
    }

    // the weapon itself follows the pointer; the images point top-right, so swing them toward the swipe
    const wp = blade.down ? blade.last : blade.hover, im = WIMG[weapon.id];
    if (wp && im.complete && im.naturalWidth && game.state !== 'paused' && game.state !== 'result') {
      const target = blade.down ? blade.ang + Math.PI / 4 : 0;
      const diff = ((target - blade.rot + Math.PI) % TAU + TAU) % TAU - Math.PI;
      blade.rot += diff * 0.35;
      const k = (weapon.size * S) / Math.max(im.naturalWidth, im.naturalHeight);
      const iw = im.naturalWidth * k, ih = im.naturalHeight * k;
      fc.save(); fc.translate(wp.x, wp.y); fc.rotate(blade.rot);
      fc.shadowColor = 'rgba(0,0,0,.5)'; fc.shadowBlur = 8; fc.shadowOffsetY = 4;
      fc.drawImage(im, -iw / 2, -ih / 2, iw, ih);
      fc.restore();
    }

    for (const p of popups) {
      fc.save();
      fc.globalAlpha = Math.min(1, p.life * 2.5);
      fc.font = `${Math.round(p.size)}px Creepster, Impact, sans-serif`;
      fc.textAlign = 'center'; fc.textBaseline = 'middle';
      fc.lineWidth = 5; fc.strokeStyle = '#000'; fc.lineJoin = 'round';
      fc.strokeText(p.text, p.x, p.y); fc.fillStyle = p.col; fc.fillText(p.text, p.x, p.y);
      fc.restore();
    }

    if (game.flash > 0) { fc.fillStyle = `rgba(255,240,200,${game.flash * 0.8})`; fc.fillRect(0, 0, W, H); }

    const sh = game.shake;
    stage.style.transform = sh > 0.3 ? `translate(${rand(-sh, sh).toFixed(1)}px,${rand(-sh, sh).toFixed(1)}px)` : '';
  }

  // Classic sheet ghost with a wavy hem. Fruit souls are pale with a dab of their fruit's colour on top;
  // the Chaos Bane army is purple with angry brows.
  function ghostShape(c, r, ph) {
    c.beginPath();
    c.arc(0, -r * 0.2, r, Math.PI, 0);
    c.lineTo(r, r * 0.85);
    for (let i = 1; i <= 6; i++) c.lineTo(r - (i / 6) * r * 2, r * 0.85 + (i % 2 ? r * 0.3 : 0) + Math.sin(ph + i) * r * 0.1);
    c.closePath();
  }

  function drawGhost(c, g) {
    const army = g.mode === 'army', r = g.r;
    c.save(); c.translate(g.x, g.y);
    c.globalAlpha = g.mode === 'free' ? clamp(1.6 - g.t, 0, 1) * 0.85 : 0.92;
    c.rotate(clamp(g.vx / (2000 * S), -0.4, 0.4));
    c.shadowColor = army ? MOURNE.deep : MOURNE.blue; c.shadowBlur = 14;
    ghostShape(c, r, g.ph);
    c.fillStyle = army ? '#d9c4ff' : '#e6fbff'; c.fill();
    c.shadowBlur = 0;
    if (!army) { c.fillStyle = g.tint; ellipse(c, r * 0.25, -r * 1.15, r * 0.3, r * 0.14, -0.4); c.fill(); }
    c.fillStyle = '#10001f';
    for (const sx of [-1, 1]) { ellipse(c, sx * r * 0.36, -r * 0.25, r * 0.16, r * 0.24); c.fill(); }
    if (army) {
      c.strokeStyle = '#10001f'; c.lineWidth = r * 0.12; c.lineCap = 'round';
      c.beginPath();
      for (const sx of [-1, 1]) { c.moveTo(sx * r * 0.62, -r * 0.62); c.lineTo(sx * r * 0.12, -r * 0.42); }
      c.stroke();
      c.fillRect(-r * 0.3, r * 0.15, r * 0.6, r * 0.14);
    } else { ellipse(c, 0, r * 0.22, r * 0.12, r * 0.16); c.fill(); }
    c.restore();
  }

  // the soul counter at the top: 10 ghost slots that fill up, with "SOULS 7/10" above them
  function drawSoulCounter() {
    const hud = soulHud(), k = 1 + soul.pulse * 0.6;
    fc.save();
    fc.font = `${Math.round(20 * S * k)}px Creepster, Impact, sans-serif`;
    fc.textAlign = 'center'; fc.textBaseline = 'middle'; fc.lineWidth = 4; fc.strokeStyle = '#000'; fc.lineJoin = 'round';
    const txt = `SOULS ${soul.n}/${MOURNE.max}`;
    fc.strokeText(txt, hud.x, hud.y); fc.fillStyle = MOURNE.blue; fc.fillText(txt, hud.x, hud.y);
    fc.restore();
    for (let i = 0; i < MOURNE.max; i++) {
      const p = hud.slot(i), on = i < soul.n;
      const fresh = on && i === soul.n - 1 ? 1 + soul.pulse : 1;
      drawGhost(fc, { x: p.x, y: p.y + (on ? Math.sin(game.t * 4 + i) * 2 * S : 0), vx: 0, r: 9 * S * fresh,
        ph: game.t * 6 + i, mode: on ? 'slot' : 'free', t: on ? 0 : 1.25, tint: MOURNE.blue });
    }
  }

  // ---------------------------------------------------------------------------
  // Input
  // ---------------------------------------------------------------------------
  function bladeAdd(e) {
    const p = { x: e.clientX, y: e.clientY, t: performance.now() };
    if (blade.last) {
      const d = Math.hypot(p.x - blade.last.x, p.y - blade.last.y);
      if (d < 2) return;
      if (d > 3) cutQueue.push([blade.last, p]);
      if (d > 4) blade.ang = Math.atan2(p.y - blade.last.y, p.x - blade.last.x);
      if (d > 28) Sfx.swoosh(weapon.swoosh);
      if (weapon.id === 'ea' && d > 10 && Math.random() < 0.5) {
        parts.push({ x: p.x, y: p.y, vx: rand(-60, 60) * S, vy: rand(-80, 20) * S, r: rand(1.5, 3) * S, life: 0.35, max: 0.35, col: pick(['#ff1f4b', '#2a0010']) });
      }
      if (weapon.id === 'shadowmourne' && d > 10 && Math.random() < 0.4) {
        parts.push({ x: p.x, y: p.y, vx: rand(-60, 60) * S, vy: rand(-120, 0) * S, r: rand(1.5, 3) * S, life: 0.4, max: 0.4, col: pick(['#3ce0ff', '#3a0a6a']) });
      }
    }
    blade.last = p;
    blade.pts.push(p);
  }

  stage.addEventListener('pointerdown', (e) => {
    Sfx.init();
    if (blade.down || game.state === 'paused' || game.state === 'result') return;
    blade.down = true; blade.id = e.pointerId; blade.last = null; blade.pts = [];
    bladeAdd(e);
  });
  window.addEventListener('pointermove', (e) => {
    blade.hover = { x: e.clientX, y: e.clientY };
    if (!blade.down || e.pointerId !== blade.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of (evs.length ? evs : [e])) bladeAdd(ev);
  });
  const bladeUp = (e) => {
    if (e.pointerType === 'touch') blade.hover = null; // no hovering finger, so hide the weapon
    if (e.pointerId === blade.id) { blade.down = false; blade.last = null; }
  };
  window.addEventListener('pointerup', bladeUp);
  window.addEventListener('pointercancel', bladeUp);

  $('levels').addEventListener('click', (e) => {
    const b = e.target.closest('.lvl-btn');
    if (b) startLevel(+b.dataset.i);
  });
  $('weapons').addEventListener('click', (e) => {
    const b = e.target.closest('.wpn');
    if (!b) return;
    weapon = WEAPONS.find((w) => w.id === b.dataset.id) || weapon;
    store.set('fb-weapon', weapon.id);
    renderWeapons();
    Sfx.init(); Sfx.swoosh(weapon.swoosh);
  });
  $('btnPause').addEventListener('click', () => setPaused(true));
  $('btnResume').addEventListener('click', () => setPaused(false));
  $('btnQuit').addEventListener('click', showMenu);
  $('btnRetry').addEventListener('click', () => startLevel(game.li));
  $('btnNext').addEventListener('click', () => startLevel(game.li + 1));
  $('btnMenu').addEventListener('click', showMenu);
  $('btnChamp').addEventListener('click', () => show($('champ'), false));
  const syncMute = () => { $('btnMute').textContent = Sfx.muted ? '🔇' : '🔊'; };
  $('btnMute').addEventListener('click', () => { Sfx.setMuted(!Sfx.muted); syncMute(); });
  syncMute();

  const enter = () => { Music.unlock(); Sfx.init(); show($('gate'), false); };
  window.addEventListener('pointerdown', enter, true);
  window.addEventListener('keydown', (e) => {
    enter();
    const k = e.key.toLowerCase();
    if (k === 'p' || k === 'escape') setPaused(game.state !== 'paused');
    else if (k === 'm') { Sfx.setMuted(!Sfx.muted); syncMute(); }
    else if (k === 'b' && game.state === 'play') throwFruit('bomb');
    else if (k === 's' && mourning() && playing()) soulArrive();
    else if (k === ']' && (game.state === 'play' || game.state === 'intro')) {
      if (LEVELS[game.li].boss && !game.boss && game.state === 'play') { game.score = LEVELS[game.li].target; updateHud(); startBoss(); }
      else { game.score = Math.max(game.score, LEVELS[game.li].target); endLevel(true); }
    }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

  // ---------------------------------------------------------------------------
  // Loop
  // ---------------------------------------------------------------------------
  let lastT = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - lastT) / 1000);
    lastT = now;
    if (game.state !== 'paused') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  showMenu();
  Music.tryAutoplay(() => show($('gate'), true));
  requestAnimationFrame(frame);
})();
