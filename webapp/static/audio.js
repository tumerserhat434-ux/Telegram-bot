// Ses efektleri (Web Audio ile üretilir, dosya gerekmez) + arka plan müziği
window.Sfx = (() => {
  let ctx = null, master = null, noiseBuf = null, sizzle = null;
  const pref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === "1"; } catch (e) { return d; } };
  const setPref = (k, v) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch (e) {} };
  let sfxOn = pref("doner_sfx", true);
  let musicOn = pref("doner_music", true);
  const music = new Audio("static/assets/music.mp3");
  music.loop = true; music.volume = 0.32; music.preload = "auto";

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = 0.6; master.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") ctx.resume();
    return true;
  }

  // İlk dokunuşta sesi aç (tarayıcı otomatik çalmayı engeller)
  function unlock() {
    ensure();
    if (musicOn) music.play().catch(() => {});
    window.removeEventListener("pointerdown", unlock);
  }
  window.addEventListener("pointerdown", unlock);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { music.pause(); stopSizzle(); }
    else if (musicOn && ctx) music.play().catch(() => {});
  });

  function tone(freq, dur, { type = "sine", vol = 0.3, slide = 0, delay = 0, attack = 0.005 } = {}) {
    if (!sfxOn || !ensure()) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function noise(dur, { type = "bandpass", freq = 2000, q = 1, vol = 0.3, delay = 0, sweep = 0 } = {}) {
    if (!sfxOn || !ensure()) return;
    const t = ctx.currentTime + delay;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(50, freq + sweep), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  function startSizzle() {
    if (!sfxOn || sizzle || !ensure()) return;
    const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = 3500;
    const f2 = ctx.createBiquadFilter(); f2.type = "peaking"; f2.frequency.value = 6000; f2.gain.value = 8;
    const g = ctx.createGain(); g.gain.value = 0;
    // çıtırtı için genliği rastgele oynat
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.type = "square"; lfo.frequency.value = 23; lg.gain.value = 0.02;
    lfo.connect(lg); lg.connect(g.gain);
    s.connect(f); f.connect(f2); f2.connect(g); g.connect(master); s.start(); lfo.start();
    sizzle = { s, g, lfo };
  }
  function setSizzle(heat) { // 0..140
    if (!sizzle) return;
    sizzle.g.gain.setTargetAtTime(0.03 + Math.min(1, heat / 100) * 0.09, ctx.currentTime, 0.2);
  }
  function stopSizzle() {
    if (!sizzle) return;
    try { sizzle.s.stop(); sizzle.lfo.stop(); } catch (e) {}
    sizzle = null;
  }

  const api = {
    click: () => tone(1200, 0.04, { type: "triangle", vol: 0.12 }),
    slice: () => { noise(0.09, { freq: 4500, q: 2, vol: 0.35, sweep: -2500 }); tone(180, 0.05, { type: "square", vol: 0.05 }); },
    place: () => { tone(320, 0.12, { type: "sine", vol: 0.25, slide: -120 }); noise(0.06, { type: "lowpass", freq: 900, vol: 0.2 }); },
    topping: () => { tone(660, 0.08, { vol: 0.2, slide: 300 }); tone(990, 0.06, { vol: 0.1, delay: 0.05 }); },
    sauce: () => noise(0.18, { type: "lowpass", freq: 700, q: 4, vol: 0.35, sweep: -400 }),
    wrap: () => { noise(0.1, { freq: 3000, q: 0.7, vol: 0.25 }); noise(0.12, { freq: 2200, q: 0.7, vol: 0.2, delay: 0.09 }); },
    take: () => { noise(0.08, { freq: 2500, vol: 0.18 }); tone(500, 0.08, { vol: 0.15, slide: 200 }); },
    bell: () => { [1318, 1975, 2637].forEach((f, i) => tone(f, 0.9 - i * 0.2, { vol: 0.12 / (i + 1), attack: 0.002 })); },
    cash: () => {
      noise(0.05, { freq: 5000, vol: 0.2 });
      tone(1318, 0.12, { type: "triangle", vol: 0.22, delay: 0.03 });
      tone(1976, 0.35, { type: "triangle", vol: 0.22, delay: 0.11 });
      tone(2637, 0.3, { type: "sine", vol: 0.08, delay: 0.11 });
    },
    wrong: () => { tone(220, 0.18, { type: "square", vol: 0.12, slide: -60 }); tone(165, 0.28, { type: "square", vol: 0.12, delay: 0.16, slide: -50 }); },
    angry: () => tone(300, 0.35, { type: "sawtooth", vol: 0.08, slide: -180 }),
    levelUp: () => [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, { type: "triangle", vol: 0.18, delay: i * 0.09 })),
    purchase: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.3, { type: "triangle", vol: 0.18, delay: i * 0.07 })),
    startSizzle, setSizzle, stopSizzle,
    get sfxOn() { return sfxOn; },
    get musicOn() { return musicOn; },
    toggleSfx() { sfxOn = !sfxOn; setPref("doner_sfx", sfxOn); if (!sfxOn) stopSizzle(); return sfxOn; },
    toggleMusic() {
      musicOn = !musicOn; setPref("doner_music", musicOn);
      if (musicOn) { ensure(); music.play().catch(() => {}); } else music.pause();
      return musicOn;
    },
  };
  return api;
})();
