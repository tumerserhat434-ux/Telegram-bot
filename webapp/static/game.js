// Dönerci Usta — Telegram Mini App oyunu
(() => {
  const tg = window.Telegram && window.Telegram.WebApp;
  const IN_TG = !!(tg && tg.initData);
  const DEV = new URLSearchParams(location.search).has("dev");
  if (tg) {
    tg.ready(); tg.expand();
    // Hızlı dokunuşlarda Telegram penceresi aşağı kayıp kapanmaya çalışmasın
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (e) {}
    try { tg.setHeaderColor && tg.setHeaderColor("#1f1007"); tg.setBackgroundColor && tg.setBackgroundColor("#1a0e06"); } catch (e) {}
  }

  // ---------- Sabitler ----------
  const BREADS = {
    lavas: { name: "Lavaş", icon: "lavas", price: 60 },
    ekmek: { name: "Ekmek", icon: "ekmek", price: 50 },
  };
  const TOPPINGS = {
    tursu: { name: "Turşu", icon: "pickle" },
    mayonez: { name: "Mayonez", icon: "mayo" },
    ketcap: { name: "Ketçap", icon: "ketchup" },
    patates: { name: "Patates", icon: "fries" },
  };
  const TOPPING_PRICE = 6;
  const FACES = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9"]; // assets/cust/*.webp
  const L = I18N.t;                       // çeviri: L("anahtar", {değişken})
  const LOC = () => I18N.locale();
  const IC = (n, cls = "ti") => `<img class="${cls}" src="static/assets/ic/${n}.webp" alt="">`;
  const FACE = (f, cls = "fimg") => `<img class="${cls}" src="static/assets/cust/${f}.webp" alt="">`;
  const UPGRADES = {
    bicak: { name: "Keskin Bıçak", icon: "knife", desc: "Her kesişte daha çok et", base: 50 },
    sac: { name: "Güçlü Saç", icon: "fire", desc: "Ekmek daha hızlı ısınır", base: 60 },
    sabir: { name: "Rahat Sandalyeler", icon: "clock", desc: "Müşteriler daha sabırlı", base: 80 },
    menu: { name: "Lüks Menü", icon: "wrap", desc: "Dürümler daha pahalı", base: 120 },
    cirak: { name: "Çırak", icon: "chefhat", desc: "Sen yokken bile satış yapar", base: 150 },
  };
  const MAX_LEVEL = 25;
  const HEAT_MAX = 140, HEAT_OK_MIN = 50, HEAT_OK_MAX = 108;
  const MAX_QUEUE = 3;

  // Sunucu yoksa kullanılan varsayılan mağaza (sunucu /api/config ile ezer)
  let config = {
    items: {
      bronz: { title: "Bronz Dükkan", description: "Her döner 3 puan · 1,6 kat daha sık müşteri", stars: 400 },
      gumus: { title: "Gümüş Dükkan", description: "Her döner 5 puan · 2,2 kat daha sık müşteri · usta çırak", stars: 600 },
      gold: { title: "Altın Dükkan", description: "Her döner 7 puan · 2,6 kat daha sık müşteri · usta çırak", stars: 900 },
      elmas: { title: "Elmas Dükkan", description: "Her döner 10 puan · 3 kat daha sık müşteri · usta çırak · Ayran dolabı: ayranlı siparişe +2 puan", stars: 1500 },
      altin: { title: "Altın Bıçak", description: "Et kesimi 2 kat hızlı", stars: 100 },
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
  const heatSpeed = () => 15 * (1 + 0.15 * lv("sac"));
  const patienceSec = () => 75 * (1 + 0.15 * lv("sabir"));
  const priceMult = () => 1 + 0.2 * lv("menu");
  // Özel yükleme (1500⭐ ve üstü): döner başı puan karekökle yavaş artar, en fazla 30
  const CUSTOM_MIN = 1500, CUSTOM_MAX = 10000;
  const customPts = (st) => st < CUSTOM_MIN ? 0 : Math.min(30, Math.round(10 * Math.sqrt(st / CUSTOM_MIN)));
  const ozelStars = () => +perks.ozel_stars || 0;
  const isTop = () => !!perks.elmas || ozelStars() >= CUSTOM_MIN;
  const hasUsta = () => perks.gumus || perks.gold || isTop();
  const hasAyran = () => isTop();
  const customerRate = () => isTop() ? 3 : perks.gold ? 2.6 : perks.gumus ? 2.2 : perks.bronz ? 1.6 : 1;
  const spawnEvery = () => 16 / customerRate();
  const idlePerSec = () => lv("cirak") * 0.4 * priceMult() * customerRate() * (hasUsta() ? 2 : 1);
  const offlineCapSec = () => (hasUsta() ? 24 : 8) * 3600;
  const upgradeCost = (k) => Math.floor(UPGRADES[k].base * Math.pow(1.65, lv(k)));

  // ---------- Oyun durumu (kaydedilmez) ----------
  let customers = [];
  let selectedId = null; // dokunulan müşteri; yoksa sıradaki ilk müşteri
  const target = () => customers.find((c) => c.id === selectedId) || customers[0] || null;
  let nextId = 1;
  let spawnTimer = 2;
  let spitMeat = 100;
  let tray = 0;
  const sac = { bread: null, heat: 0 };
  let build = null; // { bread, quality, meat, toppings:Set, wrapped }

  // ---------- Yardımcılar ----------
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Math.floor(n).toLocaleString(LOC());
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
  function modal(html) { $("modalText").innerHTML = html; $("modal").classList.remove("hidden"); }
  $("modalOk").onclick = () => $("modal").classList.add("hidden");

  function addCoins(n) { S.coins += n; S.earned += n; }

  // ---------- Müşteriler ----------
  function randomOrder() {
    const bread = Math.random() < 0.55 ? "lavas" : "ekmek";
    const meat = Math.random() < 0.25 ? 2 : 1;
    const toppings = Object.keys(TOPPINGS).filter(() => Math.random() < 0.5);
    return { bread, meat, toppings, ayran: hasAyran() && Math.random() < 0.45 };
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
        order = { bread: o.bread, meat: o.meat, toppings: o.toppings, ayran: !!o.ayran };
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
    // Sipariş fişi: her satır bir malzeme
    const row = (cls, text) => `<div class="o-row ${cls}">${text}</div>`;
    return row("o-bread", `${IC(BREADS[o.bread].icon, "oi")}${L("bread_" + o.bread)} · <span class="o-et">${L("nEt", { n: o.meat })}</span>`) +
      (o.toppings.length ? o.toppings.map((t) => row("o-" + t, `${IC(TOPPINGS[t].icon, "oi")}${L("top_" + t)}`)).join("") : row("o-plain", L("nothingElse"))) +
      (o.ayran ? row("o-ayran", `${IC("ayran", "oi")}${L("ayranBonus")}`) : "");
  }
  function orderPrice(o) {
    return (BREADS[o.bread].price + (o.meat - 1) * 30 + o.toppings.length * TOPPING_PRICE + (o.ayran ? 20 : 0)) * priceMult();
  }
  // Müşteriler sağdan yürüyerek gelir, sıraya girer; kafalarının üstünde sipariş notu çıkar.
  const custEls = new Map();
  const leaveMood = {}; // id → "happy" | "angry"
  const SLOTS = [19, 50, 81];
  function renderCustomers() {
    const box = $("customers");
    const ids = new Set(customers.map((c) => c.id));
    for (const [id, el] of custEls) {
      if (ids.has(id)) continue;
      custEls.delete(id);
      el.classList.add("leaving", leaveMood[id] || "happy", "walking");
      delete leaveMood[id];
      setTimeout(() => { el.style.left = "-30%"; }, leaveMoodDelay(el));
      setTimeout(() => el.remove(), 2600);
    }
    customers.forEach((c, i) => {
      let el = custEls.get(c.id);
      if (!el) {
        el = document.createElement("div");
        el.className = "cust walking";
        el.dataset.id = c.id;
        el.innerHTML = `<div class="note">${orderText(c.order)}<div class="pbar"><div></div></div></div>
          <img class="body" src="static/assets/body/${c.face}.webp" alt="">`;
        el.style.left = "125%";
        box.appendChild(el);
        custEls.set(c.id, el);
        void el.offsetWidth;
        el.addEventListener("transitionend", (e) => { if (e.propertyName === "left" && !el.classList.contains("leaving")) el.classList.remove("walking"); });
      }
      const left = SLOTS[i] + "%";
      if (el.style.left !== left) { el.classList.add("walking"); el.style.left = left; }
      el.classList.toggle("first", c === target());
    });
    $("emptyQ").style.display = customers.length ? "none" : "";
  }
  const leaveMoodDelay = (el) => (el.classList.contains("angry") ? 450 : 250);
  $("customers").addEventListener("click", (e) => {
    const el = e.target.closest(".cust");
    if (!el) return;
    selectedId = +el.dataset.id; Sfx.click(); haptic();
    renderCustomers(); checkKey = ""; renderCheck();
  });
  function updatePatienceBars() {
    customers.forEach((c) => {
      const el = document.querySelector(`.cust[data-id="${c.id}"] .pbar div`);
      if (!el) return;
      const pct = c.patience / c.max;
      el.style.width = pct * 100 + "%";
      el.style.background = pct > 0.5 ? "var(--ok)" : pct > 0.25 ? "var(--brand-2)" : "var(--bad)";
    });
  }

  // ---------- Döner kesme ----------
  let donerLevel = null;
  // Kesilen et parçaları dönerden tepsiye düşer
  function sliceFx() {
    const box = $("chips");
    const wrap = $("donerImg").closest(".doner-wrap");
    wrap.classList.remove("cut"); void wrap.offsetWidth; wrap.classList.add("cut");
    for (let i = 0; i < 2; i++) {
      const p = document.createElement("img");
      p.className = "chip-fall";
      p.src = `static/assets/food/meat${1 + Math.floor(Math.random() * 3)}.webp`;
      p.style.left = 52 + Math.random() * 18 + "%";
      p.style.top = 30 + Math.random() * 30 + "%";
      p.style.setProperty("--dx", (10 + Math.random() * 20) + "px");
      p.style.setProperty("--rot", (Math.random() * 300 - 150) + "deg");
      box.appendChild(p);
      setTimeout(() => p.remove(), 700);
    }
  }
  function slice() {
    if (spitMeat < 5) { toast(L("t_cooking")); return; }
    const amt = sliceAmount();
    tray = Math.min(10, tray + amt);
    Sfx.slice();
    spitMeat = Math.max(0, spitMeat - amt * 8);
    sliceFx();
    haptic("light"); renderKitchen();
  }
  let sliceHold;
  $("btnSlice").addEventListener("pointerdown", () => { slice(); sliceHold = setInterval(slice, 180); });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    $("btnSlice").addEventListener(ev, () => clearInterval(sliceHold)));

  // ---------- Saç ----------
  document.querySelectorAll("[data-bread]").forEach((b) => b.onclick = () => {
    if (sac.bread) { toast(L("t_sacBusy")); return; }
    sac.bread = b.dataset.bread; sac.heat = 0; haptic(); renderKitchen();
    Sfx.place(); Sfx.startSizzle();
  });
  $("btnTake").onclick = () => {
    if (!sac.bread) { toast(L("t_needSac")); return; }
    if (build) { toast(L("t_counterFull")); return; }
    const h = sac.heat;
    const quality = h < HEAT_OK_MIN ? "soğuk" : h <= HEAT_OK_MAX ? "mükemmel" : "yanık";
    build = { bread: sac.bread, quality, meat: 0, toppings: new Set(), wrapped: false,
      seed: Math.floor(Math.random() * 1e9), last: "bread" };
    sac.bread = null; sac.heat = 0;
    Sfx.stopSizzle(); Sfx.take();
    if (quality === "mükemmel") toast(L("t_perfect"));
    else if (quality === "yanık") toast(L("t_burnt"));
    haptic("medium"); renderKitchen();
  };

  // ---------- Tezgah ----------
  $("btnMeat").onclick = () => {
    if (!build) return toast(L("t_needBread"));
    if (build.wrapped) return toast(L("t_wrapped"));
    if (tray < 1) return toast(L("t_noMeat"));
    tray -= 1; build.meat += 1; build.last = "meat"; haptic(); renderKitchen(); Sfx.place();
  };
  document.querySelectorAll("[data-top]").forEach((b) => b.onclick = () => {
    if (!build) return toast(L("t_needBread"));
    if (build.wrapped) return toast(L("t_wrapped"));
    const t = b.dataset.top;
    if (build.toppings.has(t)) { build.toppings.delete(t); build.last = null; }
    else { build.toppings.add(t); build.last = t; }
    (t === "mayonez" || t === "ketcap") ? Sfx.sauce() : Sfx.topping();
    haptic(); renderKitchen();
  });
  $("btnWrap").onclick = () => {
    if (!build) return toast(L("t_empty"));
    if (build.meat === 0) return toast(L("t_meatFirst"));
    if (build.wrapped) return;
    build.wrapped = true; build.last = "wrap"; haptic("medium"); Sfx.wrap();
    // önce sarılma animasyonu, sonra dürüm/ekmek çizimi
    const bd = $("build");
    bd.classList.add("wrapping");
    setTimeout(() => { bd.classList.remove("wrapping"); renderKitchen(); }, 420);
  };
  // Ayran dolabı: kilitliyse Elmas pakete götür, açıksa tezgaha ayran koy/al
  $("fridge").onclick = () => {
    Sfx.click(); haptic();
    if (!hasAyran()) {
      goTab("shop");
      setTimeout(() => {
        const el = $("shop-elmas");
        if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.classList.add("pulse"); setTimeout(() => el.classList.remove("pulse"), 2400); }
      }, 120);
      toast(L("t_ayranLocked"));
      return;
    }
    if (!build) return toast(L("t_needBread"));
    build.ayran = !build.ayran; build.last = build.ayran ? "ayran" : null;
    Sfx.topping(); renderKitchen();
  };
  function renderFridge() { $("fridge").classList.toggle("locked", !hasAyran()); }
  $("btnTrash").onclick = () => { if (build) { build = null; toast(L("t_trashed")); renderKitchen(); Sfx.place(); } };

  // Hazırlanan ile sipariş arasındaki farklar (oyuncuya ne yanlış olduğunu söylemek için)
  function diffOrder(b, o) {
    const out = [];
    if (b.bread !== o.bread) out.push(L("d_bread", { x: L("bread_" + o.bread) }));
    if (b.meat !== o.meat) out.push(L("d_meat", { a: o.meat, b: b.meat }));
    const miss = o.toppings.filter((t) => !b.toppings.has(t));
    const extra = [...b.toppings].filter((t) => !o.toppings.includes(t));
    if (miss.length) out.push(L("d_missing", { x: miss.map((t) => L("top_" + t)).join(", ") }));
    if (extra.length) out.push(L("d_extra", { x: extra.map((t) => L("top_" + t)).join(", ") }));
    if (o.ayran && !b.ayran) out.push(L("d_ayranMissing"));
    if (!o.ayran && b.ayran) out.push(L("d_ayranExtra"));
    return out;
  }
  // Tezgahın altındaki canlı kontrol listesi
  let checkKey = "";
  function renderCheck() {
    const box = $("check"), t = target();
    const key = (t ? t.id : "-") + "|" + (build ? [build.bread, build.meat, [...build.toppings].sort().join(","), build.wrapped, build.ayran].join("|") : "none");
    if (key === checkKey) return;
    checkKey = key;
    document.querySelectorAll("[data-top]").forEach((btn) => btn.classList.toggle("on", !!build && build.toppings.has(btn.dataset.top)));
    if (!t) { box.innerHTML = `<span class="ck dim">${L("waiting")}</span>`; return; }
    const o = t.order;
    const items = [];
    const ck = (ok, text) => items.push(`<span class="ck ${ok === true ? "ok" : ok === "bad" ? "bad" : "dim"}"><i class="m">${ok === true ? "✓" : ok === "bad" ? "!" : ""}</i>${text}</span>`);
    ck(build ? (build.bread === o.bread ? true : "bad") : false, L("bread_" + o.bread));
    ck(build ? (build.meat === o.meat ? true : build.meat > o.meat ? "bad" : false) : false, L("ckMeat", { a: build ? build.meat : 0, b: o.meat }));
    o.toppings.forEach((tp) => ck(!!build && build.toppings.has(tp), L("top_" + tp)));
    if (build) [...build.toppings].filter((tp) => !o.toppings.includes(tp)).forEach((tp) => ck("bad", L("ckExtra", { x: L("top_" + tp) })));
    if (o.ayran) ck(!!build && !!build.ayran, L("ayran"));
    else if (build && build.ayran) ck("bad", L("ckAyranExtra"));
    ck(build && build.wrapped ? true : false, build && build.bread === "ekmek" ? L("ckClose") : L("ckWrap"));
    box.innerHTML = `<span class="ck-who">${FACE(t.face, "ckf")} ${L("ckFor")}</span>` + items.join("");
  }

  function matches(b, o) {
    return b.bread === o.bread && b.meat === o.meat && !!b.ayran === !!o.ayran &&
      b.toppings.size === o.toppings.length && o.toppings.every((t) => b.toppings.has(t));
  }
  $("btnServe").onclick = () => {
    if (!build) return toast(L("t_empty"));
    if (!build.wrapped) return toast(L("t_wrapFirst"));
    if (!customers.length) return toast(L("t_noCustomer"));
    // önce seçili müşteri, sonra siparişi tutan herhangi bir müşteri
    const t = target();
    let idx = t && matches(build, t.order) ? customers.indexOf(t) : customers.findIndex((c) => matches(build, c.order));
    const correct = idx !== -1;
    if (!correct) idx = customers.indexOf(t);
    const c = customers[idx];
    let pay = orderPrice(c.order);
    let msg;
    if (!correct) { pay *= 0.3; msg = L("t_wrong") + " " + diffOrder(build, customers[idx].order).join(" · "); }
    else if (build.quality === "yanık") { pay *= 0.4; msg = L("t_burntServe"); }
    else {
      const tip = build.quality === "mükemmel" ? 0.3 * (c.patience / c.max) + 0.1 : 0;
      if (build.quality === "soğuk") { pay *= 0.8; msg = L("t_cold"); }
      else msg = tip > 0.25 ? L("t_tip") : L("t_enjoy");
      pay *= 1 + tip;
      S.served += 1;
    }
    pay = Math.round(pay);
    addCoins(pay);
    const el = document.querySelector(`.cust[data-id="${c.id}"] .note`) || $("btnServe");
    floatText("+" + pay, el, correct ? null : "var(--bad)");
    toast(msg);
    haptic(correct ? "heavy" : "rigid");
    (correct ? Sfx.cash : Sfx.wrong)();
    try { tg && tg.HapticFeedback.notificationOccurred(correct ? "success" : "error"); } catch (e) {}
    if (IN_TG && c.serverId) {
      const sent = { bread: build.bread, meat: build.meat, toppings: [...build.toppings],
        wrapped: build.wrapped, quality: build.quality, ayran: !!build.ayran };
      api("serve", { id: c.serverId, build: sent }).then((r) => {
        if (r.points > 0) { floatText("+" + r.points + " puan", $("served"), "#ffe08a"); $("bellDot").classList.add("on"); }
        else if (r.reason === "günlük sınır doldu") toast(L("t_dailyCap"));
      }).catch(() => {});
    }
    leaveMood[c.id] = correct ? "happy" : "angry";
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
    // dönerin azalması: 3 aşamalı görsel
    const lvlImg = spitMeat > 60 ? "full" : spitMeat > 25 ? "half" : "low";
    if (lvlImg !== donerLevel) {
      donerLevel = lvlImg;
      const url = `static/assets/station/doner_${lvlImg}.webp`;
      $("donerImg").src = url;
      $("donerSheen").style.webkitMaskImage = $("donerSheen").style.maskImage = `url(${url})`;
    }
    const br = $("sacBread");
    br.className = "bread " + (sac.bread ? sac.bread : "hidden");
    if (sac.bread) {
      // gerçek ekmek görseli; ısındıkça kızarır, fazla kalırsa yanar
      const h = sac.heat;
      const bright = h <= 80 ? 1.15 - h * 0.0019 : 1.0 - (h - 80) * 0.008;
      const sat = 0.55 + Math.min(h, 80) / 80 * 0.45;
      const sep = h > 100 ? Math.min(0.7, (h - 100) / 40 * 0.7) : 0;
      br.style.backgroundImage = `url(static/assets/food/${sac.bread}.webp)`;
      br.style.filter = `brightness(${bright.toFixed(2)}) saturate(${sat.toFixed(2)}) sepia(${sep.toFixed(2)})`;
    }
    $("sac").classList.toggle("hot", !!sac.bread);
    $("steam").classList.toggle("on", !!sac.bread && sac.heat > 50);
    const fill = $("heatFill");
    fill.style.width = (sac.heat / HEAT_MAX) * 100 + "%";
    fill.style.background = sac.heat > HEAT_OK_MAX ? "var(--bad)" : sac.heat >= HEAT_OK_MIN ? "var(--ok)" : "var(--brand-2)";
    renderBuild();
    renderCheck();
  }
  // Tezgahı sadece içerik değişince yeniden çiz (animasyonlar her karede baştan başlamasın)
  let buildKey = "";
  function renderBuild() {
    const bd = $("build");
    if (bd.classList.contains("wrapping")) return;
    const key = build ? [build.seed, build.meat, [...build.toppings].sort().join(","), build.wrapped, build.ayran].join("|") : "empty";
    if (key === buildKey) return;
    buildKey = key;
    if (!build) {
      bd.className = "build empty";
      bd.innerHTML = `<div class="hint">${IC("tongs", "hi")}${L("hintTake")}</div>`;
      return;
    }
    bd.className = "build" + (build.last === "wrap" ? " pop" : build.last === "bread" ? " slide" : "");
    const label = build.wrapped ? (build.bread === "lavas" ? L("readyDurum") : L("readySandwich"))
      : L("breadQ", { q: L("q_" + build.quality) });
    bd.innerHTML = Food.render(build) + (build.ayran ? `<img class="ayran-side${build.last === "ayran" ? " drop" : ""}" src="static/assets/ic/ayran.webp" alt="">` : "") + `<div class="q">${label}</div>`;
    build.last = null;
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
      Sfx.levelUp(); toast(L("t_levelUp", { n: lvl }));
      try { tg && tg.HapticFeedback.notificationOccurred("success"); } catch (e) {}
    }
    shownLevel = lvl;
    $("coins").textContent = short(S.coins);
    $("served").textContent = short(S.served);
    $("perkCount").textContent = Object.keys(perks).filter((k) => k !== "ozel_stars" && perks[k]).length;
    $("statServed").textContent = fmt(S.served);
    $("statEarned").textContent = fmt(S.earned);
  }
  function renderUpgrades() {
    $("upgradeList").innerHTML = Object.entries(UPGRADES).map(([k, u]) => {
      const max = lv(k) >= MAX_LEVEL, cost = upgradeCost(k);
      return `<div class="card item">
        <div class="ico">${IC(u.icon, "li")}</div>
        <div class="info"><b>${L("up_" + k)}</b> <small>${L("level", { n: lv(k) })} · ${L("up_" + k + "_d")}</small></div>
        <button class="btn primary" data-up="${k}" ${max || S.coins < cost ? "disabled" : ""}>
          ${max ? "MAX" : IC("coin", "bi") + fmt(cost)}</button></div>`;
    }).join("");
    document.querySelectorAll("[data-up]").forEach((b) => b.onclick = () => {
      const k = b.dataset.up, cost = upgradeCost(k);
      if (S.coins < cost || lv(k) >= MAX_LEVEL) return;
      S.coins -= cost; S.upgrades[k] = lv(k) + 1;
      haptic("medium"); toast(L("t_upgraded", { x: L("up_" + k) })); Sfx.levelUp();
      renderAll(); saveLocal(); saveServer(true);
    });
  }
  function renderShop() {
    $("shopList").innerHTML = Object.entries(config.items).map(([k, it]) => `
      <div class="card item" id="shop-${k}">
        <div class="ico">${IC({ bronz: "medal_bronze", gumus: "medal_silver", gold: "medal_gold", elmas: "diamond", altin: "knife" }[k] || "star", "li")}</div>
        <div class="info"><b>${itemTitle(k)}</b><small>${I18N.has("it_" + k + "_d") ? L("it_" + k + "_d") : it.description}</small></div>
        ${perks[k] ? `<span class="owned">${L("owned")}</span>`
          : `<button class="btn primary" data-buy="${k}">${IC("star", "bi")}${it.stars}</button>`}
      </div>`).join("");
    $("shopList").insertAdjacentHTML("beforeend", customCardHTML());
    document.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => buy(b.dataset.buy));
    bindCustomCard();
  }
  // ---------- Özel yükleme kartı ----------
  let ozelVal = 2000;
  function customCardHTML() {
    return `<div class="card custom" id="shop-ozel">
      <div class="item"><div class="ico">${IC("diamond", "li")}</div>
        <div class="info"><b>${L("custom")}</b><small>${L("custom_d", { min: CUSTOM_MIN })}</small></div></div>
      <div class="row qamt">${[2000, 3000, 5000, 10000].map((v) => `<button class="btn wood" data-amt="${v}">${v.toLocaleString(LOC())}</button>`).join("")}</div>
      <div class="row"><input id="ozelIn" class="input" type="number" inputmode="numeric" min="${CUSTOM_MIN}" max="${CUSTOM_MAX}" step="100" value="${ozelVal}">
        <button class="btn primary" id="ozelBuy">${IC("star", "bi")}${L("load")}</button></div>
      <div id="ozelInfo" class="ozel-info"></div>
      ${ozelStars() ? `<div class="small">${L("customSoFar", { n: ozelStars().toLocaleString(LOC()), star: IC("star"), p: customPts(ozelStars()) })}</div>` : ""}
    </div>`;
  }
  function bindCustomCard() {
    const inp = $("ozelIn"), info = $("ozelInfo");
    const upd = () => {
      const v = Math.floor(+inp.value || 0); ozelVal = v;
      const ok = v >= CUSTOM_MIN && v <= CUSTOM_MAX;
      $("ozelBuy").disabled = !ok;
      info.innerHTML = ok
        ? L("customInfo", { p: customPts(ozelStars() + v), prev: ozelStars() ? L("customPrev") : "" })
        : `<span class="bad-t">${L("customRange", { min: CUSTOM_MIN.toLocaleString(LOC()), max: CUSTOM_MAX.toLocaleString(LOC()) })}</span>`;
    };
    inp.oninput = upd; upd();
    document.querySelectorAll("[data-amt]").forEach((b) => b.onclick = () => { inp.value = b.dataset.amt; upd(); Sfx.click(); });
    $("ozelBuy").onclick = () => buy("ozel", Math.floor(+inp.value));
  }

  const itemTitle = (k) => (I18N.has("it_" + k) ? L("it_" + k) : (config.items[k] || {}).title || k);
  // sunucudan gelen Türkçe çekim mesajlarını dile çevir
  function serverMsg(m) {
    if (!m) return L("t_error");
    if (m.startsWith("Önce TON")) return L("w_needWallet");
    const mm = m.match(/En az ([\d.]+)\$/);
    return mm ? L("w_min", { min: mm[1] }) : m;
  }

  function renderSponsor() {
    const sp = config.sponsor, a = $("sponsor");
    const span = a.querySelector("span");
    if (sp && sp.text) { span.textContent = sp.text; a.href = sp.url || "#"; }
    else { span.textContent = L("sponsor"); a.removeAttribute("href"); }
  }
  function renderAll() { renderFridge(); renderTop(); renderCustomers(); renderKitchen(); renderUpgrades(); renderShop(); }

  // ---------- Yıldız ile satın alma ----------
  async function buy(item, stars) {
    if (IN_TG) {
      try {
        const { link } = await api("invoice", { item, stars });
        tg.openInvoice(link, async (status) => {
          if (status === "paid") {
            toast(L("t_paid")); Sfx.purchase();
            setTimeout(refreshFromServer, 1500);
          } else if (status === "failed") toast(L("t_payFail"));
        });
      } catch (e) { toast(L("t_invoiceFail")); }
    } else if (DEV) {
      perks[item] = true;
      if (item === "ozel") perks.ozel_stars = ozelStars() + stars;
      localStorage.setItem("doner_perks_dev", JSON.stringify(perks));
      toast(item === "ozel" ? L("t_testStars", { n: stars }) : L("t_testBought", { x: itemTitle(item) })); Sfx.purchase();
      renderAll();
    } else {
      toast(L("t_openInTg"));
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
      box.innerHTML = `<div class="card"><p class="muted">${L("r_tgOnly")}</p></div>`;
      return;
    }
    box.innerHTML = `<div class="card muted">${L("loading")}</div>`;
    let r;
    try { r = await api("rewards"); } catch (e) { box.innerHTML = `<div class="card">${L("r_noServer")}</div>`; return; }
    box.innerHTML = `
      <div class="card reward-hero">
        <div class="muted">${L("r_today")}</div>
        <div class="big-num">${r.todayStars.toLocaleString(LOC())} ${IC("star", "bni")}</div>
        <div class="muted">${L("r_pts", { p: (r.points || 0).toLocaleString(LOC()), k: r.pointsPerStar, star: IC("star") })}</div>
        <div class="muted">${L("r_perDoner", { m: r.multiplier, s: r.served, c: r.dailyCap })}</div>
        <div class="cap"><div style="width:${Math.min(100, (r.served / r.dailyCap) * 100)}%"></div></div>
        <p class="muted small">${L("r_note")}</p>
      </div>
      <div class="card">
        <div class="kv"><span>${L("r_balance")}</span><b>${r.balanceStars} ${IC("star")} <small class="muted">(≈ ${usd(r.balanceUsd)})</small></b></div>
        ${r.pendingUsd ? `<div class="kv"><span>${L("r_pending")}</span><b>${usd(r.pendingUsd)}</b></div>` : ""}
        <input id="walletIn" class="input" placeholder="${L("r_wallet")}" value="${r.wallet || ""}">
        <div class="row">
          <button class="btn wood" id="btnWallet">${IC("wallet", "bi")}${L("r_saveWallet")}</button>
          <button class="btn green" id="btnWithdraw" ${r.balanceUsd < r.minWithdrawUsd ? "disabled" : ""}>${IC("coin", "bi")}${L("r_withdraw")}</button>
        </div>
        <p class="muted small">${L("r_min", { min: usd(r.minWithdrawUsd) })}</p>
      </div>
      <div class="card" id="refCard"><div class="muted">${L("ref_loading")}</div></div>`;
    loadReferral();
    $("btnWallet").onclick = async () => {
      try { await api("wallet", { address: $("walletIn").value }); toast(L("t_walletSaved")); }
      catch (e) { toast(L("t_walletBad")); }
    };
    $("btnWithdraw").onclick = async () => {
      try {
        const w = await api("withdraw", {});
        toast(w.ok ? L("t_withdrawOk") : serverMsg(w.reason));
        loadRewards();
      } catch (e) { toast(L("t_error")); }
    };
  }

  async function loadReferral() {
    const card = $("refCard");
    let r;
    try { r = await api("referral"); } catch (e) { card.innerHTML = `<div class="muted">${L("ref_fail")}</div>`; return; }
    card.innerHTML = `
      <b class="card-title">${IC("gift", "li")}${L("ref_title")}</b>
      <p class="muted small">${L("ref_text", { p: r.refPoints, s: r.refStars, star: IC("star") })}</p>
      <input class="input" id="refLink" readonly value="${r.link || ""}">
      <div class="row">
        <button class="btn wood" id="btnCopy">${L("copy")}</button>
        <button class="btn primary" id="btnShare">${L("share")}</button>
      </div>
      <div class="kv"><span>${L("ref_invited")}</span><b>${r.invited}</b></div>
      <div class="kv"><span>${L("ref_bought")}</span><b>${r.rewarded}</b></div>
      <div class="kv"><span>${L("ref_earned")}</span><b>${L("points", { n: r.pointsEarned })}</b></div>`;
    $("btnCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.link); toast(L("t_copied")); }
      catch (e) { $("refLink").select(); document.execCommand("copy"); toast(L("t_copied")); }
    };
    $("btnShare").onclick = () => {
      const text = L("ref_shareText");
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
    $("tgMusic").textContent = L("music") + ": " + (Sfx.musicOn ? L("on") : L("off"));
    $("tgSfx").textContent = L("sfx") + ": " + (Sfx.sfxOn ? L("on") : L("off"));
    $("tgLang").textContent = L("language") + ": " + L("langName");
    $("tgMusic").classList.toggle("on", Sfx.musicOn);
    $("tgSfx").classList.toggle("on", Sfx.sfxOn);
  }
  $("btnSettings").onclick = () => { renderSettings(); $("settings").classList.remove("hidden"); Sfx.click(); };
  $("settingsOk").onclick = () => $("settings").classList.add("hidden");
  $("tgMusic").onclick = () => { Sfx.toggleMusic(); renderSettings(); Sfx.click(); };
  $("tgSfx").onclick = () => { Sfx.toggleSfx(); renderSettings(); Sfx.click(); };

  // ---------- Ana döngü ----------
  let last = performance.now(), slowTick = 0, idleCarry = 0;
  let paused = false; // öğretici açıkken oyun durur
  function loop(now) {
    const dt = paused ? 0 : Math.min(0.25, (now - last) / 1000); last = now;

    spawnTimer -= dt;
    if (spawnTimer <= 0) { spawnCustomer(); spawnTimer = spawnEvery() * (0.7 + Math.random() * 0.6); }

    let left = false;
    customers.forEach((c) => { c.patience -= dt; });
    const before = customers.length;
    customers.forEach((c) => { if (c.patience <= 0) leaveMood[c.id] = "angry"; });
    customers = customers.filter((c) => c.patience > 0);
    if (customers.length !== before) { left = true; toast(L("t_angry")); haptic("rigid"); Sfx.angry(); }

    spitMeat = Math.min(100, spitMeat + dt * 2.5);
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
      modal(L("offline", { t: (h ? L("hours", { n: h }) : "") + L("minutes", { n: m }), coin: IC("coin"), g: fmt(gain) }));
    }
  }

  // Arka plana geçince / kapanınca kaydet
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) { saveLocal(); saveServer(true); }
    else { applyOffline(); saveLocal(); }
  });
  setInterval(() => { saveLocal(); saveServer(); }, 15000);

  // ---------- Başlat ----------
  async function init() {
    loadLocal();
    if (IN_TG) {
      try {
        const [cfg, data] = await Promise.all([api("config"), api("state")]);
        config = cfg;
        perks = data.perks || {};
        if (data.save && (data.save.lastSeen || 0) > (S.lastSeen || 0)) S = Object.assign(defaultState(), data.save, { upgrades: Object.assign(defaultState().upgrades, data.save.upgrades) });
      } catch (e) { toast(L("t_offline")); }
    }
    applyOffline();
    saveLocal();
    renderSponsor(); renderAll();
    requestAnimationFrame(loop);
    I18N.apply();
    if (!I18N.chosen()) openLangPick(true);
    else if (!S.tutorialDone) setTimeout(() => Tutorial.start(), 700);
  }

  // ---------- Dil seçimi (ilk girişte ve ayarlardan) ----------
  function openLangPick(first) {
    const box = $("langPick");
    // Telegram dili Türkçe değilse İngilizce öne çıksın
    const tgLang = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user && tg.initDataUnsafe.user.language_code) || navigator.language || "";
    const guess = I18N.chosen() ? I18N.lang : (String(tgLang).toLowerCase().startsWith("tr") ? "tr" : "en");
    box.querySelectorAll("[data-lang]").forEach((b) => {
      b.classList.toggle("sel", b.dataset.lang === guess);
      b.onclick = () => {
        Sfx.click(); haptic();
        I18N.set(b.dataset.lang);
        box.classList.add("hidden");
        renderAll(); renderSponsor(); renderSettings(); checkKey = ""; buildKey = "";
        customers.forEach((c) => { const el = custEls.get(c.id); if (el) el.querySelector(".note").innerHTML = orderText(c.order) + '<div class="pbar"><div></div></div>'; });
        if (first && !S.tutorialDone) setTimeout(() => Tutorial.start(), 300);
      };
    });
    paused = true;
    box.classList.remove("hidden");
    const obs = new MutationObserver(() => { if (box.classList.contains("hidden")) { paused = false; obs.disconnect(); } });
    obs.observe(box, { attributes: true, attributeFilter: ["class"] });
  }
  $("tgLang").onclick = () => { $("settings").classList.add("hidden"); openLangPick(false); };

  // ---------- Sıralama ----------
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
  let rankScope = "day";
  async function openRank() {
    $("rankModal").classList.remove("hidden"); Sfx.click();
    await loadRank();
  }
  async function loadRank() {
    document.querySelectorAll("[data-scope]").forEach((b) => b.classList.toggle("on", b.dataset.scope === rankScope));
    const list = $("rankList"), me = $("rankMe");
    if (!IN_TG) { list.innerHTML = `<p class="muted">${L("rk_tgOnly")}</p>`; me.innerHTML = ""; return; }
    list.innerHTML = `<p class="muted">${L("loading")}</p>`;
    let r;
    try { r = await api("leaderboard?scope=" + rankScope); } catch (e) { list.innerHTML = `<p class="muted">${L("rk_fail")}</p>`; return; }
    const pos = (n) => n <= 3 ? IC(["medal_gold", "medal_silver", "medal_bronze"][n - 1], "rkm") : `<b>${n}</b>`;
    const row = (x) => `<div class="rk${x.me ? " me" : ""}"><span class="pos">${pos(x.rank)}</span><span class="nm">${esc(x.name)}${x.me ? L("rk_you") : ""}</span>
      <span class="st">${IC("wrap")} ${x.served.toLocaleString(LOC())}</span><span class="st">${IC("star")} ${x.stars.toLocaleString(LOC())}</span></div>`;
    list.innerHTML = r.rows.length ? r.rows.map(row).join("") : `<p class="muted">${L("rk_empty")}</p>`;
    me.innerHTML = r.me && r.me.rank > r.rows.length ? `<div class="small">${L("rk_mine")}</div>${row(r.me)}`
      : r.me ? "" : `<div class="small">${L("rk_join")}</div>`;
  }
  $("btnRank").onclick = openRank;
  $("rankClose").onclick = () => $("rankModal").classList.add("hidden");
  document.querySelectorAll("[data-scope]").forEach((b) => b.onclick = () => { rankScope = b.dataset.scope; Sfx.click(); loadRank(); });

  // ---------- Öğretici (ilk girişte) ----------
  const Tutorial = (() => {
    const steps = [
      { k: "tu1", img: "static/assets/avatar.webp" },
      { sel: "#customers", k: "tu2" },
      { sel: "#btnSlice", k: "tu3" },
      { sel: "[data-bread]", parent: true, k: "tu4" },
      { sel: ".heatbar", k: "tu5" },
      { sel: "#btnTake", k: "tu6" },
      { sel: "#btnMeat", k: "tu7" },
      { sel: "[data-top]", parent: true, k: "tu8" },
      { sel: "#check", k: "tu9" },
      { sel: "#btnWrap", k: "tu10" },
      { sel: "#btnServe", k: "tu11" },
      { sel: "#fridge", k: "tu12" },
      { sel: ".tabs", k: "tu13" },
      { sel: "#btnRank", k: "tu14" },
    ];
    let i = 0;
    const ov = () => $("tut");
    function show() {
      const st = steps[i], hole = $("tutHole"), box = $("tutBox");
      $("tutTitle").textContent = L(st.k + "t");
      $("tutText").textContent = L(st.k + "d");
      $("tutImg").style.display = st.img ? "" : "none";
      if (st.img) $("tutImg").src = st.img;
      $("tutStep").textContent = `${i + 1}/${steps.length}`;
      $("tutNext").textContent = i === steps.length - 1 ? L("start") : L("next");
      let el = st.sel ? document.querySelector(st.sel) : null;
      if (el && st.parent) el = el.parentElement;
      if (!el) {
        hole.style.cssText = "left:50%;top:40%;width:0;height:0";
        box.style.top = "30%"; return;
      }
      el.scrollIntoView({ block: "center" });
      setTimeout(() => {
        const r = el.getBoundingClientRect(), pad = 6;
        hole.style.cssText = `left:${r.left - pad}px;top:${r.top - pad}px;width:${r.width + pad * 2}px;height:${r.height + pad * 2}px`;
        const below = r.bottom + 12, h = box.offsetHeight;
        box.style.top = (below + h < window.innerHeight - 10 ? below : Math.max(10, r.top - h - 12)) + "px";
      }, 60);
    }
    function end() {
      ov().classList.add("hidden"); paused = false;
      S.tutorialDone = true; saveLocal(); saveServer(true);
    }
    $("tutNext").onclick = () => { Sfx.click(); if (++i >= steps.length) end(); else show(); };
    $("tutSkip").onclick = () => { Sfx.click(); end(); };
    window.addEventListener("resize", () => { if (!ov().classList.contains("hidden")) show(); });
    return { start() { i = 0; paused = true; goTab("game"); ov().classList.remove("hidden"); show(); } };
  })();
  $("tutReplay").onclick = () => { $("settings").classList.add("hidden"); Tutorial.start(); };
  init();
})();
