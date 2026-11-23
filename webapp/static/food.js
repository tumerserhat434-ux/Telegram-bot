// Tezgahtaki yiyeceği SVG olarak çizer: açık lavaş/ekmek, et, turşu, patates, soslar, sarılmış dürüm/ekmek.
window.Food = (() => {
  // Her dürüm için sabit "rastgele" yerleşim (yeniden çizimde malzemeler yer değiştirmesin)
  function rng(seed) {
    let s = seed >>> 0 || 1;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  const Q = { // ekmek rengi: iç, dış, kenar
    "soğuk": ["#f6e8c8", "#e3cc9f", "#c9ad7a"],
    "mükemmel": ["#f3cf8e", "#d49448", "#9c5f25"],
    "yanık": ["#a8744a", "#5a341a", "#2e1a0c"],
  };

  const defs = (q) => `
    <defs>
      <radialGradient id="fBread" cx="45%" cy="40%" r="65%"><stop offset="0" stop-color="${Q[q][0]}"/><stop offset="1" stop-color="${Q[q][1]}"/></radialGradient>
      <linearGradient id="fRoll" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${Q[q][0]}"/><stop offset=".6" stop-color="${Q[q][1]}"/><stop offset="1" stop-color="${Q[q][2]}"/></linearGradient>
      <linearGradient id="fMeat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d9904e"/><stop offset=".5" stop-color="#a65a26"/><stop offset="1" stop-color="#6e3613"/></linearGradient>
      <linearGradient id="fFry" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#e9a92a"/></linearGradient>
      <filter id="fSh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1.5" stdDeviation="1.2" flood-opacity=".35"/></filter>
    </defs>`;

  // ---- malzeme katmanları (band: x0..x1, y0..y1 arasına yerleşir)
  function meatLayer(n, r, band, cls) {
    let g = "";
    for (let p = 0; p < n; p++) {
      let strips = "";
      for (let i = 0; i < 9; i++) {
        const x = band.x0 + r() * (band.x1 - band.x0), y = band.y0 + r() * (band.y1 - band.y0);
        const a = -40 + r() * 80, w = 30 + r() * 16, h = 6 + r() * 4, k = 4 + r() * 6;
        strips += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${a.toFixed(0)})">
          <path d="M${-w / 2},${-h / 2} C${-w / 4},${-h / 2 - k} ${w / 4},${-h / 2 + k / 2} ${w / 2},${-h / 2 - 1}
            L${w / 2 - 3},${h / 2} C${w / 4},${h / 2 + k / 2} ${-w / 4},${h / 2 - k} ${-w / 2 + 2},${h / 2 + 1} Z"
            fill="url(#fMeat)" stroke="#4a210a" stroke-width="1"/>
          <path d="M${-w / 2 + 4},-2 Q0,-5 ${w / 2 - 4},-1" stroke="#e8a467" stroke-width="1.4" fill="none" opacity=".75"/>
          <circle cx="${(r() * w - w / 2).toFixed(1)}" cy="1" r="1.6" fill="#3a1906" opacity=".7"/></g>`;
      }
      g += `<g class="${p === n - 1 ? cls : ""}" filter="url(#fSh)">${strips}</g>`;
    }
    return g;
  }
  function friesLayer(r, band, cls) {
    let s = "";
    for (let i = 0; i < 9; i++) {
      const x = band.x0 + r() * (band.x1 - band.x0), y = band.y0 + r() * (band.y1 - band.y0);
      s += `<rect x="${(x - 3).toFixed(1)}" y="${(y - 14).toFixed(1)}" width="6" height="${(22 + r() * 10).toFixed(0)}" rx="2"
        fill="url(#fFry)" stroke="#b9791a" stroke-width=".8" transform="rotate(${(-60 + r() * 120).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    return `<g class="${cls}" filter="url(#fSh)">${s}</g>`;
  }
  function picklesLayer(r, band, cls) {
    let s = "";
    for (let i = 0; i < 6; i++) {
      const x = band.x0 + r() * (band.x1 - band.x0), y = band.y0 + r() * (band.y1 - band.y0);
      s += `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(1,.8)">
        <circle r="9" fill="#5f8f24" stroke="#365e12" stroke-width="2"/><circle r="6" fill="#a6cc5e"/>
        <circle cx="-2" cy="-1" r="1" fill="#f3f7d0"/><circle cx="2" cy="1.5" r="1" fill="#f3f7d0"/><circle cx="1.5" cy="-2.5" r="1" fill="#f3f7d0"/></g>`;
    }
    return `<g class="${cls}" filter="url(#fSh)">${s}</g>`;
  }
  // Sos: tezgah boyunca yumuşak dalgalı ince bir sıkım çizgisi (her sosun dalgası farklı)
  function sauceLayer(color, hi, band, opt, cls) {
    const pts = [], W = band.x1 - band.x0, mid = (band.y0 + band.y1) / 2 + opt.dy, A = opt.amp;
    for (let i = 0; i <= 80; i++) {
      const t = i / 80, x = band.x0 + t * W;
      const y = mid + A * Math.sin(t * Math.PI * 2 * opt.freq + opt.phase) + Math.sin(t * 17 + opt.phase) * 1.5;
      pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    const d = "M" + pts.join(" L");
    return `<g class="${cls}">
      <path d="${d}" pathLength="1" stroke="rgba(0,0,0,.22)" stroke-width="${opt.w + 1}" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,1.8)"/>
      <path d="${d}" pathLength="1" stroke="${color}" stroke-width="${opt.w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
      <path d="${d}" pathLength="1" stroke="${hi}" stroke-width="1.6" fill="none" stroke-linecap="round" stroke-linejoin="round" transform="translate(-1,-1.5)" opacity=".8"/></g>`;
  }
  function fillings(b, band) {
    const r = (k) => rng(b.seed * 31 + k); // her malzemenin kendi yerleşimi
    const last = b.last;
    const c = (k) => (k === last ? (k === "mayonez" || k === "ketcap" ? "draw" : "drop") : "");
    let s = "";
    if (b.meat) s += meatLayer(b.meat, r(1), band, last === "meat" ? "drop" : "");
    if (b.toppings.has("patates")) s += friesLayer(r(2), band, c("patates"));
    if (b.toppings.has("tursu")) s += picklesLayer(r(3), band, c("tursu"));
    if (b.toppings.has("mayonez")) s += sauceLayer("#fffaf0", "#ffffff", band, { dy: -9, amp: 13, freq: 4.5, phase: 0.4, w: 5 }, c("mayonez"));
    if (b.toppings.has("ketcap")) s += sauceLayer("#d4261a", "#ff8a6e", band, { dy: 9, amp: 12, freq: 5.5, phase: 2.2, w: 4.5 }, c("ketcap"));
    return s;
  }

  // ---- açık ekmekler
  function openLavas(b) {
    const r = rng(b.seed);
    let marks = "";
    for (let i = 0; i < 7; i++) marks += `<line x1="${40 + i * 38}" y1="18" x2="${10 + i * 38}" y2="160" stroke="${Q[b.quality][2]}" stroke-width="5" opacity=".22"/>`;
    let spots = "";
    for (let i = 0; i < 14; i++) spots += `<ellipse cx="${(40 + r() * 240).toFixed(0)}" cy="${(30 + r() * 110).toFixed(0)}" rx="${(3 + r() * 5).toFixed(1)}" ry="${(2 + r() * 3).toFixed(1)}" fill="${Q[b.quality][2]}" opacity=".35"/>`;
    return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg">${defs(b.quality)}
      <clipPath id="fLc"><ellipse cx="160" cy="86" rx="146" ry="74"/></clipPath>
      <ellipse cx="160" cy="92" rx="148" ry="74" fill="rgba(0,0,0,.35)"/>
      <ellipse cx="160" cy="86" rx="146" ry="74" fill="url(#fBread)" stroke="${Q[b.quality][2]}" stroke-width="3"/>
      <g clip-path="url(#fLc)">${marks}${spots}</g>
      ${fillings(b, { x0: 62, x1: 258, y0: 58, y1: 112 })}</svg>`;
  }
  function openEkmek(b) {
    const r = rng(b.seed);
    let pores = "";
    for (let i = 0; i < 40; i++) pores += `<circle cx="${(50 + r() * 220).toFixed(0)}" cy="${(52 + r() * 66).toFixed(0)}" r="${(0.8 + r() * 1.8).toFixed(1)}" fill="#c9a26a" opacity=".55"/>`;
    const crumb = b.quality === "yanık" ? "#d2a36a" : b.quality === "mükemmel" ? "#f7deaa" : "#fbeccb";
    return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg">${defs(b.quality)}
      <rect x="14" y="30" width="292" height="118" rx="58" fill="rgba(0,0,0,.35)"/>
      <rect x="14" y="24" width="292" height="118" rx="58" fill="url(#fRoll)" stroke="${Q[b.quality][2]}" stroke-width="3"/>
      <rect x="30" y="38" width="260" height="90" rx="45" fill="${crumb}"/>
      ${pores}
      ${fillings(b, { x0: 62, x1: 258, y0: 58, y1: 108 })}</svg>`;
  }

  // ---- sarılmış hâller
  function peek(b) { // dürüm ucundan görünen malzemeler
    let s = `<ellipse cx="0" cy="0" rx="9" ry="22" fill="#7a3d16"/>`;
    const dots = [];
    if (b.toppings.has("tursu")) dots.push("#7fb23a");
    if (b.toppings.has("ketcap")) dots.push("#d4261a");
    if (b.toppings.has("mayonez")) dots.push("#fffaf0");
    if (b.toppings.has("patates")) dots.push("#f5c542");
    dots.forEach((c, i) => { s += `<circle cx="${(i % 2 ? 2 : -2)}" cy="${-14 + i * 9}" r="3.6" fill="${c}"/>`; });
    for (let i = 0; i < 3; i++) s += `<path d="M-6,${-16 + i * 12} q6,-3 10,2" stroke="#c27a3e" stroke-width="2" fill="none"/>`;
    return s;
  }
  function wrappedLavas(b) {
    return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg">${defs(b.quality)}
      <ellipse cx="160" cy="132" rx="130" ry="12" fill="rgba(0,0,0,.35)"/>
      <g transform="rotate(-6 160 85)">
        <rect x="40" y="52" width="236" height="66" rx="33" fill="url(#fRoll)" stroke="${Q[b.quality][2]}" stroke-width="2.5"/>
        <path d="M120,54 q-14,31 0,62 M190,54 q-14,31 0,62" stroke="${Q[b.quality][2]}" stroke-width="2" fill="none" opacity=".45"/>
        <path d="M60,60 q100,-8 200,0" stroke="#fff" stroke-width="3" fill="none" opacity=".25"/>
        <ellipse cx="276" cy="85" rx="15" ry="33" fill="${Q[b.quality][1]}" stroke="${Q[b.quality][2]}" stroke-width="2.5"/>
        <g transform="translate(277,85)">${peek(b)}</g>
        <path d="M30,48 L152,48 L144,58 L152,68 L144,78 L152,88 L144,98 L152,108 L144,118 L152,124 L30,124 Q14,86 30,48 Z" fill="#fbf4e6" stroke="#d9c7a6" stroke-width="1.5"/>
        <rect x="40" y="62" width="104" height="9" fill="#c62a1e"/><rect x="40" y="101" width="104" height="9" fill="#c62a1e"/>
        <text x="92" y="91" font-family="Lilita One, Arial Black, sans-serif" font-size="13" fill="#7a2a10" text-anchor="middle">DÖNER USTASI</text>
      </g></svg>`;
  }
  function wrappedEkmek(b) {
    const q = Q[b.quality];
    const bits = [];
    if (b.toppings.has("tursu")) bits.push(`<ellipse cx="96" cy="96" rx="9" ry="5" fill="#7fb23a" stroke="#365e12"/><ellipse cx="212" cy="98" rx="9" ry="5" fill="#7fb23a" stroke="#365e12"/>`);
    if (b.toppings.has("patates")) bits.push(`<rect x="248" y="86" width="6" height="26" rx="2" fill="url(#fFry)" transform="rotate(-55 251 99)"/><rect x="236" y="88" width="6" height="24" rx="2" fill="url(#fFry)" transform="rotate(-70 239 100)"/>`);
    if (b.toppings.has("ketcap")) bits.push(`<path d="M120,100 q6,14 12,0 M168,101 q5,12 10,0" fill="#d4261a"/>`);
    if (b.toppings.has("mayonez")) bits.push(`<path d="M146,101 q5,12 10,0 M196,100 q5,12 10,0" fill="#fffaf0"/>`);
    let meat = "";
    for (let i = 0; i < 9; i++) meat += `<path d="M${60 + i * 24},92 q12,-${6 + (i % 3) * 2} 24,0 l0,10 q-12,6 -24,0 z" fill="url(#fMeat)" stroke="#4a210a" stroke-width=".8"/>`;
    return `<svg viewBox="0 0 320 170" xmlns="http://www.w3.org/2000/svg">${defs(b.quality)}
      <ellipse cx="160" cy="140" rx="135" ry="11" fill="rgba(0,0,0,.35)"/>
      <path d="M40,104 Q40,132 80,134 L240,134 Q280,132 280,104 Z" fill="url(#fRoll)" stroke="${q[2]}" stroke-width="2.5"/>
      ${meat}${bits.join("")}
      <path d="M36,96 Q40,46 110,40 L210,40 Q280,46 284,96 Z" fill="url(#fRoll)" stroke="${q[2]}" stroke-width="2.5"/>
      <path d="M100,52 l18,22 M150,48 l18,24 M200,50 l18,22" stroke="${q[2]}" stroke-width="3" opacity=".5"/>
      <path d="M70,56 q90,-16 180,0" stroke="#fff" stroke-width="3" fill="none" opacity=".25"/>
      <path d="M24,92 L104,92 L96,104 L104,116 L96,128 L104,140 L24,140 Q14,116 24,92 Z" fill="#fbf4e6" stroke="#d9c7a6" stroke-width="1.5"/>
      <rect x="28" y="108" width="68" height="7" fill="#c62a1e"/></svg>`;
  }

  return {
    render(b) {
      if (b.wrapped) return b.bread === "lavas" ? wrappedLavas(b) : wrappedEkmek(b);
      return b.bread === "lavas" ? openLavas(b) : openEkmek(b);
    },
  };
})();
