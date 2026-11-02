/* TWINFOLD — synthesized sound (WebAudio, no assets). */
(function (root) {
  'use strict';
  let ac = null, master = null, sfx = null, amb = null, noiseBuf = null, ambNodes = null;
  let muted = false;
  try { muted = localStorage.getItem('twinfold.mute') === '1'; } catch (e) { /* storage blocked */ }

  function ensure() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return true; }
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    ac = new AC();
    master = ac.createGain(); master.gain.value = muted ? 0 : 0.8; master.connect(ac.destination);
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 4; comp.connect(master);
    sfx = ac.createGain(); sfx.gain.value = 0.55; sfx.connect(comp);
    amb = ac.createGain(); amb.gain.value = 0; amb.connect(comp);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return true;
  }

  function env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  function tone(type, f0, f1, dur, vol, delay = 0, dest = sfx) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    env(g, t, 0.005, vol, dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }
  function noise(dur, vol, type, f0, f1, q = 1, delay = 0) {
    if (!ac) return;
    const t = ac.currentTime + delay;
    const n = ac.createBufferSource(); n.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); env(g, t, 0.008, vol, dur);
    n.connect(f); f.connect(g); g.connect(sfx);
    n.start(t, Math.random() * 0.5); n.stop(t + dur + 0.05);
  }

  const S = {
    shot(c) { tone('square', c ? 760 : 980, c ? 240 : 320, 0.11, 0.07); noise(0.08, 0.06, 'highpass', 3000, 6000); },
    portal(c) {
      const base = c ? 440 : 523.25;
      tone('sine', base, base * 1.5, 0.32, 0.12); tone('triangle', base * 1.5, base * 2, 0.4, 0.05, 0.03);
      noise(0.3, 0.07, 'bandpass', 400, 2400, 3);
    },
    fail() { tone('triangle', 150, 110, 0.09, 0.12); noise(0.05, 0.05, 'lowpass', 900); },
    fizzShot() { noise(0.18, 0.08, 'highpass', 2500, 8000); },
    tp(speed) { const k = Math.min(1, speed / 760); tone('sine', 300 + k * 200, 900 + k * 500, 0.16, 0.09); noise(0.14, 0.04, 'bandpass', 1200, 5000, 4); },
    jump() { tone('triangle', 330, 520, 0.07, 0.05); },
    land(v) { noise(0.07, Math.min(0.12, v / 4000), 'lowpass', 600, 150); },
    button(on) { tone('square', on ? 660 : 440, on ? 880 : 330, 0.06, 0.05); tone('sine', on ? 1320 : 660, null, 0.08, 0.04, 0.04); },
    door(open) { tone('sawtooth', open ? 70 : 90, open ? 110 : 60, 0.35, 0.05); noise(0.3, 0.05, 'lowpass', 500, 200); },
    recv(on) { if (on) { tone('sine', 660, null, 0.2, 0.07); tone('sine', 990, null, 0.3, 0.06, 0.08); } else tone('sine', 520, 300, 0.2, 0.05); },
    fizzle() { noise(0.3, 0.09, 'highpass', 1800, 7000); tone('sine', 1400, 300, 0.25, 0.04); },
    die() { tone('sawtooth', 220, 50, 0.6, 0.08); noise(0.5, 0.07, 'lowpass', 1200, 100); },
    cubeGone() { noise(0.4, 0.06, 'bandpass', 800, 3000, 2); tone('sine', 500, 1500, 0.35, 0.04); },
    cubeBack() { tone('sine', 400, 800, 0.2, 0.05); },
    grab() { tone('triangle', 520, 700, 0.05, 0.06); },
    drop() { tone('triangle', 600, 420, 0.06, 0.05); },
    thud(v) { noise(0.08, Math.min(0.1, v / 5000), 'lowpass', 400, 120); },
    win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => { tone('triangle', f, null, 0.5, 0.08, i * 0.09); tone('sine', f * 2, null, 0.35, 0.025, i * 0.09 + 0.02); }); },
    splash(up) { noise(up ? 0.35 : 0.25, up ? 0.1 : 0.06, 'lowpass', up ? 1400 : 900, 200); tone('sine', up ? 180 : 140, up ? 90 : 60, 0.25, 0.05); },
    crack() { noise(0.06, 0.05, 'highpass', 1500, 3000); tone('square', 220, 160, 0.04, 0.02); },
    crumble() { noise(0.35, 0.08, 'lowpass', 900, 120); tone('triangle', 90, 50, 0.3, 0.05); },
    reform() { tone('sine', 200, 320, 0.15, 0.02); },
    vent() { noise(0.9, 0.08, 'bandpass', 300, 1400, 0.8); tone('sawtooth', 60, 90, 0.6, 0.03); },
    growl() { tone('sawtooth', 110, 70, 0.45, 0.07); tone('sawtooth', 116, 66, 0.45, 0.05, 0.02); noise(0.4, 0.05, 'lowpass', 500, 200); },
    chomp() { noise(0.12, 0.12, 'lowpass', 1600, 300); tone('square', 160, 60, 0.12, 0.08); },
    monDie() { noise(0.5, 0.08, 'lowpass', 1200, 100); tone('sawtooth', 200, 40, 0.5, 0.05); },
    spikeShake() { noise(0.25, 0.04, 'bandpass', 2000, 2600, 6); },
    shatter() { noise(0.2, 0.08, 'highpass', 1200, 5000); tone('triangle', 900, 300, 0.12, 0.03); },
    rumble() { noise(1.8, 0.12, 'lowpass', 220, 60); tone('sine', 45, 35, 1.6, 0.08); },
    sizzle() { noise(0.4, 0.06, 'highpass', 3000, 7000); },
    checkpoint() { [392, 523.25, 659.25].forEach((f, i) => tone('triangle', f, null, 0.35, 0.06, i * 0.07)); noise(0.4, 0.04, 'bandpass', 800, 3000, 2); },
    click() { tone('square', 900, 700, 0.03, 0.035); },
    hover() { tone('sine', 1200, null, 0.025, 0.015); }
  };

  function startAmbient(level, volcano) {
    if (!ensure()) return;
    stopAmbient();
    const roots = volcano ? [41.2, 43.65, 38.89, 36.71] : [55, 58.27, 61.74, 49, 51.91];
    const f = roots[level % roots.length];
    const t = ac.currentTime;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.7;
    const lfo = ac.createOscillator(), lfoG = ac.createGain();
    lfo.frequency.value = 0.07; lfoG.gain.value = 120; lfo.connect(lfoG); lfoG.connect(lp.frequency);
    const oscs = [f, f * 1.5, f * 2.003, f * 3.01].map((fr, i) => {
      const o = ac.createOscillator(); o.type = i < 2 ? 'sawtooth' : 'sine'; o.frequency.value = fr; o.detune.value = (i - 1.5) * 6;
      const g = ac.createGain(); g.gain.value = [0.05, 0.03, 0.03, 0.012][i];
      o.connect(g); g.connect(lp); o.start(t); return o;
    });
    lp.connect(amb); lfo.start(t);
    if (volcano) { // deep magma rumble: looping filtered noise
      const n = ac.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
      const nf = ac.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 110;
      const ng = ac.createGain(); ng.gain.value = 0.35;
      n.connect(nf); nf.connect(ng); ng.connect(amb); n.start(t);
      oscs.push(n);
    }
    amb.gain.cancelScheduledValues(t); amb.gain.setValueAtTime(amb.gain.value, t); amb.gain.linearRampToValueAtTime(0.5, t + 2.5);
    ambNodes = { oscs, lfo, lp };
  }
  function stopAmbient() {
    if (!ac || !ambNodes) return;
    const t = ac.currentTime, n = ambNodes; ambNodes = null;
    amb.gain.cancelScheduledValues(t); amb.gain.setValueAtTime(amb.gain.value, t); amb.gain.linearRampToValueAtTime(0, t + 0.6);
    setTimeout(() => { n.oscs.forEach(o => o.stop()); n.lfo.stop(); n.lp.disconnect(); }, 800);
  }

  function setMuted(m) {
    muted = m;
    try { localStorage.setItem('twinfold.mute', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (master) master.gain.setTargetAtTime(m ? 0 : 0.8, ac.currentTime, 0.05);
  }

  function play(name, ...a) { if (!ac || muted) return; const f = S[name]; if (f) f(...a); }

  root.Sound = { ensure, play, startAmbient, stopAmbient, setMuted, isMuted: () => muted };
})(window);
