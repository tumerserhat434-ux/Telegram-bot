// Dönerci Usta — Telegram Mini App oyunu
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const IN_TG = !!(tg && tg.initData);
  const DEV = new URLSearchParams(location.search).has("dev");
  if (tg) { tg.ready(); tg.expand(); }

  // ---------- Sabitler ----------
  const BREADS = {
    lavas: { name: "Lavaş", emoji: "🫓", price: 60 },
    ekmek: { name: "Ekmek", emoji: "🥖", price: 50 },
  };
  const TOPPINGS = {
    tursu: { name: "Turşu", emoji: "🥒" },
    mayonez: { name: "Mayonez", emoji: "🥚" },
    ketcap: { name: "Ketçap", emoji: "🍅" },
    patates: { name: "Patates", emoji: "🍟" },
  };
  const TOPPING_PRICE = 6;
  const FACES = ["👨", "👩", "👴", "👵", "🧔", "👱‍♀️", "👷", "🧑‍🎓", "👮", "🧕", "🧑‍🍳", "🕵️"];
  const UPGRADES = {
    bicak: { name: "Keskin Bıçak", emoji: "🔪", desc: "Her kesişte daha çok et", base: 50 },
    sac: { name: "Güçlü Saç", emoji: "🔥", desc: "Ekmek daha hızlı ısınır", base: 60 },
    sabir: { name: "Rahat Sandalyeler", emoji: "🪑", desc: "Müşteriler daha sabırlı", base: 80 },
    menu: { name: "Lüks Menü", emoji: "📜", desc: "Dürümler daha pahalı", base: 120 },
    cirak: { name: "Çırak", emoji: "🧑‍🍳", desc: "Sen yokken bile satış yapar", base: 150 },
  };
  const MAX_LEVEL = 25;
  const HEAT_MAX = 140, HEAT_OK_MIN = 60, HEAT_OK_MAX = 100;
  const MAX_QUEUE = 4;

  // Sunucu yoksa kullanılan varsayılan mağaza (sunucu /api/config ile ezer)
  let config = {
    items: {
      bronz: { title: "Bronz Dükkan", emoji: "🥉", description: "Her döner 3 puan · 1,6 kat daha sık müşteri", stars: 300 },
      gold: { title: "Altın Dükkan", emoji: "🥇", description: "Her döner 5 puan · 2,2 kat daha sık müşteri · usta çırak", stars: 500 },
      altin: { title: "Altın Bıçak", emoji: "🗡️", description: "Et kesimi 2 kat hızlı", stars: 100 },
    },
    sponsor: null,
  };

  // ---------- Kayıt ----------
  const defaultState = () => ({
    coins: 0, served: 0, earned: 0,
    upgrades: { bicak: 0, sac: 0, sabir: 0, menu: 0, cirak: 0 },
    lastSeen: 0, // 0 = bu cihazda hiç kayıt yok
  });
  let S = defaultState();
  let perks = {}; // sunucudan gelir (yıldızla alınanlar), istemci değiştiremez

  function loadLocal() {
    try {
      const raw = localStorage.getItem("doner_save");
      if (raw) S = Object.assign(defaultState(), JSON.parse(raw));
      if (!IN_TG) perks = JSON.parse(localStorage.getItem("doner_perks_dev") || "{}");
    } catch (e) { /* boş kayıt */ }
  }
  function saveLocal() {
    S.lastSeen = Date.now();
    try { localStorage.setItem("doner_save", JSON.stringify(S)); } catch (e) {}
  }

  async function api(path, body) {
    const res = await fetch("api/" + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json", "X-Init-Data": IN_TG ? tg.initData : "" },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  let lastServerSave = 0;
  async function saveServer(force) {
    if (!IN_TG) return;
    if (!force && Date.now() - lastServerSave < 10000) return;
    lastServerSave = Date.now();
    try { await api("save", { save: S }); } catch (e) { console.warn("kayıt hatası", e); }
  }

  // ---------- Hesaplanan değerler ----------
  const lv = (k) => S.upgrades[k] || 0;
  const sliceAmount = () => 0.25 * (1 + 0.25 * lv("bicak")) * (perks.altin ? 2 : 1);
  const heatSpeed = () => 22 * (1 + 0.2 * lv("sac"));
  const patienceSec = () => 35 * (1 + 0.15 * lv("sabir"));
  const priceMult = () => 1 + 0.2 * lv("menu");
  const hasUsta = () => perks.gold;
  const customerRate = () => perks.gold ? 2.2 : perks.bronz ? 1.6 : 1;
  const spawnEvery = () => 9 / customerRate();
  const idlePerSec = () => lv("cirak") * 0.4 * priceMult() * customerRate() * (hasUsta() ? 2 : 1);
  const offlineCapSec = () => (hasUsta() ? 24 : 8) * 3600;
  const upgradeCost = (k) => Math.floor(UPGRADES[k].base * Math.pow(1.65, lv(k)));

  // ---------- Oyun durumu (kaydedilmez) ----------
  let customers = [];
  let nextId = 1;
  let spawnTimer = 2;
  let spitMeat = 100;
  let tray = 0;
  const sac = { bread: null, heat: 0 };
  let build = null; // { bread, quality, meat, toppings:Set, wrapped }

  // ---------- Yardımcılar ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString("tr-TR");
  const short = (n) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e4 ? Math.floor(n / 1e3) + "K" : fmt(n);
  const haptic = (type) => { try { tg && tg.HapticFeedback.impactOccurred(type || "light"); } catch (e) {} };
  let toastT;
  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 1800);
  }
  function floatText(text, el, color) {
    const r = el.getBoundingClientRect();
    const f = document.createElement("div");
    f.className = "float"; f.textContent = text;
    f.style.left = r.left + r.width / 2 - 20 + "px"; f.style.top = r.top + "px";
    if (color) f.style.color = color;
    document.body.appendChild(f); setTimeout(() => f.remove(), 1000);
  }
  function modal(text) { $("modalText").textContent = text; $("modal").classList.remove("hidden"); }
  $("modalOk").onclick = () => $("modal").classList.add("hidden");

  function addCoins(n) { S.coins += n; S.earned += n; }

  // ---------- Müşteriler ----------
  function randomOrder() {
    const bread = Math.random() < 0.55 ? "lavas" : "ekmek";
    const meat = Math.random() < 0.25 ? 2 : 1;
    const toppings = Object.keys(TOPPINGS).filter(() => Math.random() < 0.5);
    return { bread, meat, toppings };
  }
  let spawning = false;
  async function spawnCustomer() {
    if (customers.length >= MAX_QUEUE || spawning) return;
    let order = randomOrder(), serverId = null;
    if (IN_TG) {
      // Ödül puanı için siparişi sunucu verir
      spawning = true;
      try {
        const o = await api("order", {});
        order = { bread: o.bread, meat: o.meat, toppings: o.toppings };
        serverId = o.id;
      } catch (e) { /* bağlantı yoksa puansız yerel sipariş */ }
      spawning = false;
      if (customers.length >= MAX_QUEUE) return;
    }
    const p = patienceSec() * (0.85 + Math.random() * 0.3);
    customers.push({ id: nextId++, serverId, face: FACES[Math.floor(Math.random() * FACES.length)],
      order, patience: p, max: p });
    renderCustomers();
    Sfx.bell();
  }
  function orderText(o) {
    return BREADS[o.bread].emoji + " " + "🥩".repeat(o.meat) + " " + o.toppings.map((t) => TOPPINGS[t].emoji).join("");
  }
  function orderPrice(o) {
    return (BREADS[o.bread].price + (o.meat - 1) * 30 + o.toppings.length * TOPPING_PRICE) * priceMult();
  }
  function renderCustomers() {
    const box = $("customers");
    if (!customers.length) { box.innerHTML = '<div class="empty-queue">Müşteri bekleniyor…</div>'; return; }
    box.innerHTML = customers.map((c, i) => `
      <div class="customer ${i === 0 ? "first" : ""}" data-id="${c.id}">
        <div class="face">${c.face}</div>
        <div class="order">${orderText(c.order)}</div>
        <div class="pbar"><div style="width:${(c.patience / c.max) * 100}%"></div></div>
      </div>`).join("");
  }
  function updatePatienceBars() {
    customers.forEach((c) => {
      const el = document.querySelector(`.customer[data-id="${c.id}"] .pbar div`);
      if (!el) return;
      const pct = c.patience / c.max;
      el.style.width = pct * 100 + "%";
      el.style.background = pct > 0.5 ? "var(--ok)" : pct > 0.25 ? "var(--brand-2)" : "var(--bad)";
    });
  }

  // ---------- Döner kesme ----------
  function slice() {
    if (spitMeat < 5) { toast("Döner pişiyor, biraz bekle 🔥"); return; }
    const amt = sliceAmount();
    tray = Math.min(10, tray + amt);
    Sfx.slice();
    spitMeat = Math.max(0, spitMeat - amt * 8);
    if (d3) d3.slice();
    else { const m = $("meat"); m.classList.remove("cut"); void m.offsetWidth; m.classList.add("cut"); }
    haptic("light"); renderKitchen();
  }
  let sliceHold;
  $("btnSlice").addEventListener("pointerdown", () => { slice(); sliceHold = setInterval(slice, 180); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    $("btnSlice").addEventListener(ev, () => clearInterval(sliceHold)));

  // ---------- Saç ----------
  document.querySelectorAll("[data-bread]").forEach((b) => b.onclick = () => {
    if (sac.bread) { toast("Saçta zaten ekmek var"); return; }
    sac.bread = b.dataset.bread; sac.heat = 0; haptic(); renderKitchen();
    Sfx.place(); Sfx.startSizzle();
  });
  $("btnTake").onclick = () => {
    if (!sac.bread) { toast("Önce saça ekmek koy"); return; }
    if (build) { toast("Tezgah dolu, önce teslim et ya da çöpe at"); return; }
    const h = sac.heat;
    const quality = h < HEAT_OK_MIN ? "soğuk" : h <= HEAT_OK_MAX ? "mükemmel" : "yanık";
    build = { bread: sac.bread, quality, meat: 0, toppings: new Set(), wrapped: false };
    sac.bread = null; sac.heat = 0;
    Sfx.stopSizzle(); Sfx.take();
    if (quality === "mükemmel") toast("Tam kıvamında! 👌");
    else if (quality === "yanık") toast("Ekmek yandı 😬");
    haptic("medium"); renderKitchen();
  };

  // ---------- Tezgah ----------
  $("btnMeat").onclick = () => {
    if (!build) return toast("Önce saçtan ekmek al");
    if (build.wrapped) return toast("Sarıldı, artık eklenemez");
    if (tray < 1) return toast("Tepside yeterli et yok, döner kes 🔪");
    tray -= 1; build.meat += 1; haptic(); renderKitchen(); Sfx.place();
  };
  document.querySelectorAll("[data-top]").forEach((b) => b.onclick = () => {
    if (!build) return toast("Önce saçtan ekmek al");
    if (build.wrapped) return toast("Sarıldı, artık eklenemez");
    const t = b.dataset.top;
    build.toppings.has(t) ? build.toppings.delete(t) : build.toppings.add(t);
    (t === "mayonez" || t === "ketcap") ? Sfx.sauce() : Sfx.topping();
    haptic(); renderKitchen();
  });
  $("btnWrap").onclick = () => {
    if (!build) return toast("Tezgah boş");
    if (build.meat === 0) return toast("Et koymadan olmaz 🥩");
    build.wrapped = true; haptic("medium"); renderKitchen(); Sfx.wrap();
  };
  $("btnTrash").onclick = () => { if (build) { build = null; toast("Çöpe atıldı"); renderKitchen(); Sfx.place(); } };

  function matches(b, o) {
    return b.bread === o.bread && b.meat === o.meat &&
      b.toppings.size === o.toppings.length && o.toppings.every((t) => b.toppings.has(t));
  }
  $("btnServe").onclick = () => {
    if (!build) return toast("Tezgah boş");
    if (!build.wrapped) return toast("Önce sar / kapat 🌯");
    if (!customers.length) return toast("Bekleyen müşteri yok");
    let idx = customers.findIndex((c) => matches(build, c.order));
    const correct = idx !== -1;
    if (!correct) idx = 0;
    const c = customers[idx];
    let pay = orderPrice(c.order);
    let msg;
    if (!correct) { pay *= 0.3; msg = "Yanlış sipariş! 😠"; }
    else if (build.quality === "yanık") { pay *= 0.4; msg = "Ekmek yanmış… 😕"; }
    else {
      const tip = build.quality === "mükemmel" ? 0.3 * (c.patience / c.max) + 0.1 : 0;
      if (build.quality === "soğuk") { pay *= 0.8; msg = "Ekmek soğuk ama olur"; }
      else msg = tip > 0.25 ? "Harika! Bahşiş 🤑" : "Afiyet olsun! 😋";
      pay *= 1 + tip;
      S.served += 1;
    }
    pay = Math.round(pay);
    addCoins(pay);
    const el = document.querySelector(`.customer[data-id="${c.id}"]`) || $("btnServe");
    floatText("+" + pay, el, correct ? null : "var(--bad)");
    toast(msg);
    haptic(correct ? "heavy" : "rigid");
    (correct ? Sfx.cash : Sfx.wrong)();
    try { tg && tg.HapticFeedback.notificationOccurred(correct ? "success" : "error"); } catch (e) {}
    if (IN_TG && c.serverId) {
      const sent = { bread: build.bread, meat: build.meat, toppings: [...build.toppings],
        wrapped: build.wrapped, quality: build.quality };
      api("serve", { id: c.serverId, build: sent }).then((r) => {
        if (r.points > 0) { floatText("+" + r.points + " puan", $("served"), "#ffe08a"); $("bellDot").classList.add("on"); }
        else if (r.reason === "günlük sınır doldu") toast("Bugünkü ödül sınırına ulaştın");
      }).catch(() => {});
    }
    customers.splice(idx, 1);
    build = null;
    renderAll(); saveLocal(); saveServer();
  };

  // Isıya göre ekmek rengi: hamur → altın sarısı → kahve → yanık
  function breadColor(h) {
    const stops = [[0, [243, 228, 190]], [60, [228, 176, 96]], [100, [196, 122, 52]], [125, [110, 60, 25]], [140, [45, 28, 18]]];
    for (let i = 1; i < stops.length; i++) {
      if (h <= stops[i][0]) {
        const [h0, c0] = stops[i - 1], [h1, c1] = stops[i], k = (h - h0) / (h1 - h0);
        const c = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
        return `radial-gradient(circle at 40% 35%, rgb(${c.map((v) => Math.min(255, v + 25))}), rgb(${c}))`;
      }
    }
    return "rgb(45,28,18)";
  }

  // ---------- Çizim ----------
  function renderKitchen() {
    $("tray").textContent = tray.toFixed(1).replace(".0", "");
    $("meat").style.width = 30 + spitMeat * 0.45 + "px";
    const br = $("sacBread");
    br.className = "bread " + (sac.bread ? sac.bread : "hidden");
    if (sac.bread) {
      br.style.background = breadColor(sac.heat);
      br.classList.toggle("marked", sac.heat > 45);
    }
    $("sac").classList.toggle("hot", !!sac.bread);
    $("steam").classList.toggle("on", !!sac.bread && sac.heat > 50);
    const fill = $("heatFill");
    fill.style.width = (sac.heat / HEAT_MAX) * 100 + "%";
    fill.style.background = sac.heat > HEAT_OK_MAX ? "var(--bad)" : sac.heat >= HEAT_OK_MIN ? "var(--ok)" : "var(--brand-2)";
    const bd = $("build");
    if (!build) { bd.className = "build empty"; bd.textContent = "Saçtan ekmek al"; return; }
    bd.className = "build";
    bd.innerHTML = (build.wrapped ? "🌯 " : "") + BREADS[build.bread].emoji + " " +
      "🥩".repeat(build.meat) + " " + [...build.toppings].map((t) => TOPPINGS[t].emoji).join("") +
      `<div class="q">Ekmek: ${build.quality}${build.wrapped ? " · sarıldı" : ""}</div>`;
  }
  // Seviye: her seviye bir öncekinden biraz daha fazla satış ister
  const levelFor = (n) => Math.floor(Math.sqrt(n / 4)) + 1;
  const servedFor = (lvl) => 4 * (lvl - 1) * (lvl - 1);
  let shownLevel = null;
  function renderTop() {
    const lvl = levelFor(S.served);
    const a = servedFor(lvl), b = servedFor(lvl + 1);
    $("level").textContent = lvl;
    $("xpFill").style.width = ((S.served - a) / (b - a)) * 100 + "%";
    if (shownLevel !== null && lvl > shownLevel) {
      Sfx.levelUp(); toast("🎉 Seviye atladın! Lv. " + lvl);
      try { tg && tg.HapticFeedback.notificationOccurred("success"); } catch (e) {}
    }
    shownLevel = lvl;
    $("coins").textContent = short(S.coins);
    $("served").textContent = short(S.served);
    $("perkCount").textContent = Object.keys(perks).filter((k) => perks[k]).length;
    $("statServed").textContent = fmt(S.served);
    $("statEarned").textContent = fmt(S.earned);
  }
  function renderUpgrades() {
    $("upgradeList").innerHTML = Object.entries(UPGRADES).map(([k, u]) => {
      const max = lv(k) >= MAX_LEVEL, cost = upgradeCost(k);
      return `<div class="card item">
        <div class="ico">${u.emoji}</div>
        <div class="info"><b>${u.name}</b> <small>Seviye ${lv(k)} · ${u.desc}</small></div>
        <button class="btn primary" data-up="${k}" ${max || S.coins < cost ? "disabled" : ""}>
          ${max ? "MAX" : "💰 " + fmt(cost)}</button></div>`;
    }).join("");
    document.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => {
      const k = b.dataset.up, cost = upgradeCost(k);
      if (S.coins < cost || lv(k) >= MAX_LEVEL) return;
      S.coins -= cost; S.upgrades[k] = lv(k) + 1;
      haptic("medium"); toast(UPGRADES[k].name + " geliştirildi!"); Sfx.levelUp();
      renderAll(); saveLocal(); saveServer(true);
    });
  }
  function renderShop() {
    $("shopList").innerHTML = Object.entries(config.items).map(([k, it]) => `
      <div class="card item">
        <div class="ico">${it.emoji || "⭐"}</div>
        <div class="info"><b>${it.title}</b><small>${it.description}</small></div>
        ${perks[k] ? '<span class="owned">✔ Sende</span>'
          : `<button class="btn primary" data-buy="${k}">⭐ ${it.stars}</button>`}
      </div>`).join("");
    document.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => buy(b.dataset.buy));
  }
  function renderSponsor() {
    const sp = config.sponsor, a = $("sponsor");
    if (sp && sp.text) { a.textContent = "📢 " + sp.text; a.href = sp.url || "#"; }
    else { a.textContent = "📢 Reklamınız burada olabilir"; a.removeAttribute("href"); }
  }
  function renderAll() { renderTop(); renderCustomers(); renderKitchen(); renderUpgrades(); renderShop(); }

  // ---------- Yıldız ile satın alma ----------
  async function buy(item) {
    if (IN_TG) {
      try {
        const { link } = await api("invoice", { item });
        tg.openInvoice(link, async (status) => {
          if (status === "paid") {
            toast("Ödeme alındı, teşekkürler! ⭐"); Sfx.purchase();
            setTimeout(refreshFromServer, 1500);
          } else if (status === "failed") toast("Ödeme başarısız");
        });
      } catch (e) { toast("Fatura oluşturulamadı"); }
    } else if (DEV) {
      perks[item] = true;
      localStorage.setItem("doner_perks_dev", JSON.stringify(perks));
      toast("(Test) " + config.items[item].title + " alındı"); Sfx.purchase();
      renderAll();
    } else {
      toast("Satın almak için oyunu Telegram'da aç");
    }
  }

  async function refreshFromServer() {
    if (!IN_TG) return;
    try {
      const data = await api("state");
      perks = data.perks || {};
      if (data.save && (data.save.lastSeen || 0) > (S.lastSeen || 0)) S = Object.assign(defaultState(), data.save, { upgrades: Object.assign(defaultState().upgrades, data.save.upgrades) });
      renderAll();
    } catch (e) { console.warn(e); }
  }

  // ---------- Ödüller ----------
  const usd = (n) => "$" + (n || 0).toFixed(2);
  async function loadRewards() {
    const box = $("rewardsBox");
    if (!IN_TG) {
      box.innerHTML = '<div class="card"><p class="muted">Ödül puanları ve çekim, oyun Telegram içinde açılınca çalışır.</p></div>';
      return;
    }
    box.innerHTML = '<div class="card muted">Yükleniyor…</div>';
    let r;
    try { r = await api("rewards"); } catch (e) { box.innerHTML = '<div class="card">Sunucuya ulaşılamadı</div>'; return; }
    box.innerHTML = `
      <div class="card reward-hero">
        <div class="muted">Bugün kazandığın</div>
        <div class="big-num">${r.todayStars.toLocaleString("tr-TR")} ⭐</div>
        <div class="muted">${(r.points || 0).toLocaleString("tr-TR")} puan · ${r.pointsPerStar} puan = 1⭐</div>
        <div class="muted">Döner başına <b>${r.multiplier} puan</b> · ${r.served}/${r.dailyCap} döner</div>
        <div class="cap"><div style="width:${Math.min(100, (r.served / r.dailyCap) * 100)}%"></div></div>
        <p class="muted small">Yıldızların her gün bakiyene eklenir. Kur günlük değişebilir.</p>
      </div>
      <div class="card">
        <div class="kv"><span>Bakiye</span><b>${r.balanceStars}⭐ <small class="muted">(≈ ${usd(r.balanceUsd)})</small></b></div>
        ${r.pendingUsd ? `<div class="kv"><span>Bekleyen çekim</span><b>${usd(r.pendingUsd)}</b></div>` : ""}
        <input id="walletIn" class="input" placeholder="TON cüzdan adresin" value="${r.wallet || ""}">
        <div class="row">
          <button class="btn wood" id="btnWallet">💾 Cüzdanı Kaydet</button>
          <button class="btn green" id="btnWithdraw" ${r.balanceUsd < r.minWithdrawUsd ? "disabled" : ""}>💸 Çek</button>
        </div>
        <p class="muted small">En az ${usd(r.minWithdrawUsd)} birikince TON olarak çekebilirsin.</p>
      </div>
      <div class="card" id="refCard"><div class="muted">Davet bilgisi yükleniyor…</div></div>`;
    loadReferral();
    $("btnWallet").onclick = async () => {
      try { await api("wallet", { address: $("walletIn").value }); toast("Cüzdan kaydedildi ✅"); }
      catch (e) { toast("Geçersiz TON adresi"); }
    };
    $("btnWithdraw").onclick = async () => {
      try {
        const w = await api("withdraw", {});
        toast(w.ok ? "Çekim talebin alındı ✅" : w.reason);
        loadRewards();
      } catch (e) { toast("Hata oluştu"); }
    };
  }

  async function loadReferral() {
    const card = $("refCard");
    let r;
    try { r = await api("referral"); } catch (e) { card.innerHTML = '<div class="muted">Davet bilgisi alınamadı</div>'; return; }
    card.innerHTML = `
      <b>👥 Arkadaşını Davet Et</b>
      <p class="muted small">Davet ettiğin arkadaşın paket alırsa <b>+${r.refPoints} puan</b> (≈ ${r.refStars}⭐) kazanırsın.</p>
      <input class="input" id="refLink" readonly value="${r.link || ""}">
      <div class="row">
        <button class="btn wood" id="btnCopy">📋 Kopyala</button>
        <button class="btn primary" id="btnShare">📤 Paylaş</button>
      </div>
      <div class="kv"><span>Davet ettiğin</span><b>${r.invited}</b></div>
      <div class="kv"><span>Paket alan</span><b>${r.rewarded}</b></div>
      <div class="kv"><span>Davetten kazandığın</span><b>${r.pointsEarned} puan</b></div>`;
    $("btnCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.link); toast("Link kopyalandı ✅"); }
      catch (e) { $("refLink").select(); document.execCommand("copy"); toast("Link kopyalandı ✅"); }
    };
    $("btnShare").onclick = () => {
      const text = "Gel benimle döner sar, puan topla! 🥙";
      const url = "https://t.me/share/url?url=" + encodeURIComponent(r.link) + "&text=" + encodeURIComponent(text);
      if (tg && tg.openTelegramLink) tg.openTelegramLink(url); else window.open(url, "_blank");
    };
  }

  // ---------- Sekmeler ----------
  function goTab(name) {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === name));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
    if (name === "upgrades") renderUpgrades();
    if (name === "rewards") { loadRewards(); $("bellDot").classList.remove("on"); }
    window.scrollTo({ top: 0, behavior: "smooth" });
    haptic(); Sfx.click();
  }
  document.querySelectorAll("[data-tab]").forEach((b) => b.onclick = () => goTab(b.dataset.tab));
  document.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => goTab(b.dataset.go));

  // ---------- Ayarlar (ses) ----------
  function renderSettings() {
    $("tgMusic").textContent = "🎵 Müzik: " + (Sfx.musicOn ? "Açık" : "Kapalı");
    $("tgSfx").textContent = "🔊 Efektler: " + (Sfx.sfxOn ? "Açık" : "Kapalı");
    $("tgMusic").classList.toggle("on", Sfx.musicOn);
    $("tgSfx").classList.toggle("on", Sfx.sfxOn);
  }
  $("btnSettings").onclick = () => { renderSettings(); $("settings").classList.remove("hidden"); Sfx.click(); };
  $("settingsOk").onclick = () => $("settings").classList.add("hidden");
  $("tgMusic").onclick = () => { Sfx.toggleMusic(); renderSettings(); Sfx.click(); };
  $("tgSfx").onclick = () => { Sfx.toggleSfx(); renderSettings(); Sfx.click(); };

  // ---------- Ana döngü ----------
  let last = performance.now(), slowTick = 0, idleCarry = 0;
  function loop(now) {
    const dt = Math.min(0.25, (now - last) / 1000); last = now;

    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnCustomer(); spawnTimer = spawnEvery() * (0.7 + Math.random() * 0.6); }

    let left = false;
    customers.forEach((c) => { c.patience -= dt; });
    const before = customers.length;
    customers = customers.filter((c) => c.patience > 0);
    if (customers.length !== before) { left = true; toast("Müşteri sinirlenip gitti 😤"); haptic("rigid"); Sfx.angry(); }

    spitMeat = Math.min(100, spitMeat + dt * 2.5);
    if (d3) d3.update(dt, spitMeat);
    if (sac.bread) { sac.heat = Math.min(HEAT_MAX, sac.heat + dt * heatSpeed()); Sfx.startSizzle(); Sfx.setSizzle(sac.heat); }

    idleCarry += idlePerSec() * dt;
    if (idleCarry >= 1) { const n = Math.floor(idleCarry); idleCarry -= n; addCoins(n); }

    slowTick += dt;
    if (slowTick > 0.2) {
      slowTick = 0;
      renderKitchen(); updatePatienceBars(); renderTop();
      if (left) renderCustomers();
    } else if (left) renderCustomers();
    requestAnimationFrame(loop);
  }

  function applyOffline() {
    const away = Math.min(offlineCapSec(), (Date.now() - (S.lastSeen || Date.now())) / 1000);
    const gain = Math.floor(away * idlePerSec());
    if (gain > 0 && away > 30) {
      addCoins(gain);
      const h = Math.floor(away / 3600), m = Math.floor((away % 3600) / 60);
      modal(`Sen yokken çırağın ${h ? h + " saat " : ""}${m} dakika çalıştı ve 💰 ${fmt(gain)} kazandı!`);
    }
  }

  // Arka plana geçince / kapanınca kaydet
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { saveLocal(); saveServer(true); }
    else { applyOffline(); saveLocal(); }
  });
  setInterval(() => { saveLocal(); saveServer(); }, 15000);

  // ---------- Başlat ----------
  let d3 = null;
  async function init() {
    loadLocal();
    try { d3 = window.Doner3D && window.Doner3D.create($("spit")); } catch (e) { d3 = null; }
    if (d3) $("spit").classList.add("is3d");
    if (IN_TG) {
      try {
        const [cfg, data] = await Promise.all([api("config"), api("state")]);
        config = cfg;
        perks = data.perks || {};
        if (data.save && (data.save.lastSeen || 0) > (S.lastSeen || 0)) S = Object.assign(defaultState(), data.save, { upgrades: Object.assign(defaultState().upgrades, data.save.upgrades) });
      } catch (e) { toast("Sunucuya bağlanılamadı, çevrimdışı oynanıyor"); }
    }
    applyOffline();
    saveLocal();
    renderSponsor(); renderAll();
    requestAnimationFrame(loop);
  }
  init();
})();
