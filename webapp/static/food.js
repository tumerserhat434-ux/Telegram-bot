// Tezgahtaki yiyecek: gerçek lavaş/ekmek görselinin üstüne et, turşu, patates görselleri ve sos çizgileri.
window.Food = (() => {
  const A = "static/assets/food/";
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  // Saçta pişme durumuna göre ekmeğin rengi
  const FILTER = {
    "soğuk": "brightness(1.08) saturate(.7)",
    "mükemmel": "none",
    "yanık": "brightness(.55) sepia(.55) saturate(1.5) contrast(1.1)",
  };
  // Malzemelerin yerleşeceği alan (tabağın yüzdesi) ve parça boyları
  const LAYOUT = {
    lavas: { band: { x0: 22, x1: 78, y0: 26, y1: 66 }, meat: 30, pickle: 15, fries: 26 },
    ekmek: { band: { x0: 18, x1: 82, y0: 56, y1: 80 }, meat: 19, pickle: 10, fries: 17 },
  };

  function pieces(kind, n, r, band, size, spin) {
    let s = "";
    for (let i = 0; i < n; i++) {
      const x = band.x0 + r() * (band.x1 - band.x0), y = band.y0 + r() * (band.y1 - band.y0);
      const rot = spin ? r() * 360 : -40 + r() * 80, v = 1 + Math.floor(r() * 3);
      s += `<img class="pc" src="${A}${kind}${v}.webp" alt="" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${(size * (0.85 + r() * 0.3)).toFixed(1)}%;transform:translate(-50%,-50%) rotate(${rot.toFixed(0)}deg)">`;
    }
    return s;
  }
  function sauce(color, hi, band, o) {
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const t = i / 80, x = band.x0 + t * (band.x1 - band.x0);
      const y = (band.y0 + band.y1) / 2 + o.dy + o.amp * Math.sin(t * Math.PI * 2 * o.freq + o.phase);
      pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
    }
    const d = "M" + pts.join(" L");
    const p = (stroke, w, extra = "") => `<path d="${d}" pathLength="1" stroke="${stroke}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" ${extra}/>`;
    return `<svg class="sauce" viewBox="0 0 100 100" preserveAspectRatio="none">
      ${p("rgba(0,0,0,.25)", o.w + 2, 'transform="translate(0,.8)"')}${p(color, o.w)}${p(hi, 1.5, 'transform="translate(-.3,-.6)" opacity=".8"')}</svg>`;
  }

  return {
    render(b) {
      if (b.wrapped) {
        const img = b.bread === "lavas" ? "durum" : "sandwich";
        return `<div class="plate wrapped ${b.bread}"><img class="base" src="${A}${img}.webp" alt=""></div>`;
      }
      const L = LAYOUT[b.bread], band = L.band, last = b.last;
      const r = (k) => rng(b.seed * 31 + k); // her malzemenin kendi sabit yerleşimi
      const layer = (key, html) => `<div class="layer ${key === last ? (key === "mayonez" || key === "ketcap" ? "draw" : "drop") : ""}">${html}</div>`;
      let h = "";
      // her et porsiyonu ayrı katman: son eklenen düşerek gelir
      for (let p = 0; p < b.meat; p++) {
        const rr = rng(b.seed * 97 + p);
        h += `<div class="layer ${last === "meat" && p === b.meat - 1 ? "drop" : ""}">${pieces("meat", 6, rr, band, L.meat, false)}</div>`;
      }
      if (b.toppings.has("patates")) h += layer("patates", pieces("fries", 5, r(2), band, L.fries, true));
      if (b.toppings.has("tursu")) h += layer("tursu", pieces("pickle", 6, r(3), band, L.pickle, true));
      if (b.toppings.has("mayonez")) h += layer("mayonez", sauce("#fffaf0", "#ffffff", band, { dy: -4, amp: 5, freq: 2.6, phase: 0.4, w: 5 }));
      if (b.toppings.has("ketcap")) h += layer("ketcap", sauce("#d4261a", "#ff8a6e", band, { dy: 4, amp: 5, freq: 3.2, phase: 2.2, w: 4.5 }));
      return `<div class="plate ${b.bread}"><img class="base" src="${A}${b.bread}.webp" alt="" style="filter:${FILTER[b.quality]}">${h}</div>`;
    },
  };
})();
