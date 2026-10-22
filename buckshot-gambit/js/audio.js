'use strict';
// Sound: chess sounds from the asset folder + a synthesized shotgun (WebAudio).

const SFX = (() => {
  const files = { move: 'Move', capture: 'Capture', check: 'Check', notify: 'GenericNotify' };
  const cache = {};
  let ac = null;
  let enabled = true;

  function ctx() {
    if (!ac) {
      try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ac = null; }
    }
    if (ac && ac.state === 'suspended') ac.resume();
    return ac;
  }

  function play(name, vol = 0.7) {
    if (!enabled) return;
    if (!cache[name]) cache[name] = new Audio(`assets/sounds/${files[name]}.ogg`);
    const a = cache[name].cloneNode();
    a.volume = vol;
    a.play().catch(() => {});
  }

  function noise(a, len, decay) {
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * len), a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, decay);
    const src = a.createBufferSource();
    src.buffer = buf;
    return src;
  }

  function boom() {
    const a = enabled && ctx();
    if (!a) return;
    const t = a.currentTime;
    const src = noise(a, 0.55, 3);
    const f = a.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(5000, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 0.45);
    const g = a.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
    const o = a.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const og = a.createGain();
    og.gain.setValueAtTime(0.9, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(og).connect(a.destination);
    o.start(t);
    o.stop(t + 0.32);
  }

  function click(at = 0) {
    const a = enabled && ctx();
    if (!a) return;
    const t = a.currentTime + at;
    const src = noise(a, 0.04, 6);
    const f = a.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    const g = a.createGain();
    g.gain.value = 0.5;
    src.connect(f).connect(g).connect(a.destination);
    src.start(t);
  }

  function reload() { click(0.05); click(0.16); }

  function error() {
    const a = enabled && ctx();
    if (!a) return;
    const t = a.currentTime;
    const o = a.createOscillator();
    o.type = 'square';
    o.frequency.value = 110;
    const g = a.createGain();
    g.gain.setValueAtTime(0.08, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.2);
  }

  return {
    move: () => play('move'),
    capture: () => play('capture', 0.8),
    check: () => play('check'),
    notify: () => play('notify'),
    boom, reload, error, click: () => click(0),
    get enabled() { return enabled; },
    set enabled(v) { enabled = v; },
    unlock: ctx,
  };
})();
