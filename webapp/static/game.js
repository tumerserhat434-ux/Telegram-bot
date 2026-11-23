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
  const hasUsta = () => perks.gumus || perks.gold || perks.elmas;
  const hasAyran = () => !!perks.elmas;
  const customerRate = () => perks.elmas ? 3 : perks.gold ? 2.6 : perks.gumus ? 2.2 : perks.bronz ? 1.6 : 1;
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
  const CHIP = { tursu: "Turşu", mayonez: "Mayo", ketcap: "Ketçap", patates: "Patates" };
  function orderText(o) {
    // Sipariş fişi: her satır bir malzeme
    const row = (cls, text) => `<div class="o-row ${cls}">${text}</div>`;
    return row("o-bread", `${IC(BREADS[o.bread].icon, "oi")}${BREADS[o.bread].name}`) +
      row("o-et", `${IC("meat", "oi")}${o.meat} Et${o.meat > 1 ? " (bol)" : ""}`) +
      (o.toppings.length ? o.toppings.map((t) => row("o-" + t, `${IC(TOPPINGS[t].icon, "oi")}${TOPPINGS[t].name}`)).join("") : row("o-plain", "Başka bir şey yok")) +
      (o.ayran ? row("o-ayran", `${IC("ayran", "oi")}Ayran +2 puan`) : "");
  }
  function orderPrice(o) {
    return (BREADS[o.bread].price + (o.meat - 1) * 30 + o.toppings.length * TOPPING_PRICE + (o.ayran ? 20 : 0)) * priceMult();
  }
  function renderCustomers() {
    const box = $("customers");
    if (!customers.length) { box.innerHTML = '<div class="empty-queue">Müşteri bekleniyor…</div>'; return; }
    box.innerHTML = customers.map((c, i) => `
      <div class="customer ${c === target() ? "first" : ""}" data-id="${c.id}">
        <div class="face">${FACE(c.face)}</div>
        <div class="order">${orderText(c.order)}</div>
        <div class="pbar"><div style="width:${(c.patience / c.max) * 100}%"></div></div>
      </div>`).join("");
  }
  $("customers").addEventListener("click", (e) => {
    const el = e.target.closest(".customer");
    if (!el) return;
    selectedId = +el.dataset.id; Sfx.click(); haptic();
    renderCustomers(); checkKey = ""; renderCheck();
  });
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
    if (spitMeat < 5) { toast("Döner pişiyor, biraz bekle"); return; }
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
    if (sac.bread) { toast("Saçta zaten ekmek var"); return; }
    sac.bread = b.dataset.bread; sac.heat = 0; haptic(); renderKitchen();
    Sfx.place(); Sfx.startSizzle();
  });
  $("btnTake").onclick = () => {
    if (!sac.bread) { toast("Önce saça ekmek koy"); return; }
    if (build) { toast("Tezgah dolu, önce teslim et ya da çöpe at"); return; }
    const h = sac.heat;
    const quality = h < HEAT_OK_MIN ? "soğuk" : h <= HEAT_OK_MAX ? "mükemmel" : "yanık";
    build = { bread: sac.bread, quality, meat: 0, toppings: new Set(), wrapped: false,
      seed: Math.floor(Math.random() * 1e9), last: "bread" };
    sac.bread = null; sac.heat = 0;
    Sfx.stopSizzle(); Sfx.take();
    if (quality === "mükemmel") toast("Tam kıvamında!");
    else if (quality === "yanık") toast("Ekmek yandı!");
    haptic("medium"); renderKitchen();
  };

  // ---------- Tezgah ----------
  $("btnMeat").onclick = () => {
    if (!build) return toast("Önce saçtan ekmek al");
    if (build.wrapped) return toast("Sarıldı, artık eklenemez");
    if (tray < 1) return toast("Tepside yeterli et yok, önce döner kes");
    tray -= 1; build.meat += 1; build.last = "meat"; haptic(); renderKitchen(); Sfx.place();
  };
  document.querySelectorAll("[data-top]").forEach((b) => b.onclick = () => {
    if (!build) return toast("Önce saçtan ekmek al");
    if (build.wrapped) return toast("Sarıldı, artık eklenemez");
    const t = b.dataset.top;
    if (build.toppings.has(t)) { build.toppings.delete(t); build.last = null; }
    else { build.toppings.add(t); build.last = t; }
    (t === "mayonez" || t === "ketcap") ? Sfx.sauce() : Sfx.topping();
    haptic(); renderKitchen();
  });
  $("btnWrap").onclick = () => {
    if (!build) return toast("Tezgah boş");
    if (build.meat === 0) return toast("Et koymadan olmaz");
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
      toast("Ayran dolabı Elmas Dükkan paketiyle açılır");
      return;
    }
    if (!build) return toast("Önce saçtan ekmek al");
    build.ayran = !build.ayran; build.last = build.ayran ? "ayran" : null;
    Sfx.topping(); renderKitchen();
  };
  function renderFridge() { $("fridge").classList.toggle("locked", !hasAyran()); }
  $("btnTrash").onclick = () => { if (build) { build = null; toast("Çöpe atıldı"); renderKitchen(); Sfx.place(); } };

  // Hazırlanan ile sipariş arasındaki farklar (oyuncuya ne yanlış olduğunu söylemek için)
  function diffOrder(b, o) {
    const out = [];
    if (b.bread !== o.bread) out.push(BREADS[o.bread].name + " olmalı");
    if (b.meat !== o.meat) out.push(`Et ${o.meat} olmalı (sende ${b.meat})`);
    const miss = o.toppings.filter((t) => !b.toppings.has(t));
    const extra = [...b.toppings].filter((t) => !o.toppings.includes(t));
    if (miss.length) out.push("Eksik: " + miss.map((t) => TOPPINGS[t].name).join(", "));
    if (extra.length) out.push("Fazla: " + extra.map((t) => TOPPINGS[t].name).join(", "));
    if (o.ayran && !b.ayran) out.push("Ayran eksik");
    if (!o.ayran && b.ayran) out.push("Ayran istemedi");
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
    if (!t) { box.innerHTML = '<span class="ck dim">Müşteri bekleniyor…</span>'; return; }
    const o = t.order;
    const items = [];
    const ck = (ok, text) => items.push(`<span class="ck ${ok === true ? "ok" : ok === "bad" ? "bad" : "dim"}"><i class="m">${ok === true ? "✓" : ok === "bad" ? "!" : ""}</i>${text}</span>`);
    ck(build ? (build.bread === o.bread ? true : "bad") : false, BREADS[o.bread].name);
    ck(build ? (build.meat === o.meat ? true : build.meat > o.meat ? "bad" : false) : false, `Et ${build ? build.meat : 0}/${o.meat}`);
    o.toppings.forEach((tp) => ck(!!build && build.toppings.has(tp), TOPPINGS[tp].name));
    if (build) [...build.toppings].filter((tp) => !o.toppings.includes(tp)).forEach((tp) => ck("bad", TOPPINGS[tp].name + " fazla"));
    if (o.ayran) ck(!!build && !!build.ayran, "Ayran");
    else if (build && build.ayran) ck("bad", "Ayran fazla");
    ck(build && build.wrapped ? true : false, build && build.bread === "ekmek" ? "Kapat" : "Sar");
    box.innerHTML = `<span class="ck-who">${FACE(t.face, "ckf")} için:</span>` + items.join("");
  }

  function matches(b, o) {
    return b.bread === o.bread && b.meat === o.meat && !!b.ayran === !!o.ayran &&
      b.toppings.size === o.toppings.length && o.toppings.every((t) => b.toppings.has(t));
  }
  $("btnServe").onclick = () => {
    if (!build) return toast("Tezgah boş");
    if (!build.wrapped) return toast("Önce sar / kapat");
    if (!customers.length) return toast("Bekleyen müşteri yok");
    // önce seçili müşteri, sonra siparişi tutan herhangi bir müşteri
    const t = target();
    let idx = t && matches(build, t.order) ? customers.indexOf(t) : customers.findIndex((c) => matches(build, c.order));
    const correct = idx !== -1;
    if (!correct) idx = customers.indexOf(t);
    const c = customers[idx];
    let pay = orderPrice(c.order);
    let msg;
    if (!correct) { pay *= 0.3; msg = "Yanlış sipariş! " + diffOrder(build, customers[idx].order).join(" · "); }
    else if (build.quality === "yanık") { pay *= 0.4; msg = "Ekmek yanmış…"; }
    else {
      const tip = build.quality === "mükemmel" ? 0.3 * (c.patience / c.max) + 0.1 : 0;
      if (build.quality === "soğuk") { pay *= 0.8; msg = "Ekmek soğuk ama olur"; }
      else msg = tip > 0.25 ? "Harika! Bahşiş geldi" : "Afiyet olsun!";
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
        wrapped: build.wrapped, quality: build.quality, ayran: !!build.ayran };
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
      bd.innerHTML = `<div class="hint">${IC("tongs", "hi")}Saçtan lavaş ya da ekmek al</div>`;
      return;
    }
    bd.className = "build" + (build.last === "wrap" ? " pop" : build.last === "bread" ? " slide" : "");
    const label = build.wrapped ? (build.bread === "lavas" ? "Dürüm hazır! Teslim et" : "Ekmek arası hazır! Teslim et")
      : `Ekmek: ${build.quality}`;
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
      Sfx.levelUp(); toast("Seviye atladın! Lv. " + lvl);
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
        <div class="ico">${IC(u.icon, "li")}</div>
        <div class="info"><b>${u.name}</b> <small>Seviye ${lv(k)} · ${u.desc}</small></div>
        <button class="btn primary" data-up="${k}" ${max || S.coins < cost ? "disabled" : ""}>
          ${max ? "MAX" : IC("coin", "bi") + fmt(cost)}</button></div>`;
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
      <div class="card item" id="shop-${k}">
        <div class="ico">${IC({ bronz: "medal_bronze", gumus: "medal_silver", gold: "medal_gold", elmas: "diamond", altin: "knife" }[k] || "star", "li")}</div>
        <div class="info"><b>${it.title}</b><small>${it.description}</small></div>
        ${perks[k] ? '<span class="owned">✓ Sende</span>'
          : `<button class="btn primary" data-buy="${k}">${IC("star", "bi")}${it.stars}</button>`}
      </div>`).join("");
    document.querySelectorAll("[data-buy]").forEach((b) => b.onclick = () => buy(b.dataset.buy));
  }
  function renderSponsor() {
    const sp = config.sponsor, a = $("sponsor");
    const span = a.querySelector("span");
    if (sp && sp.text) { span.textContent = sp.text; a.href = sp.url || "#"; }
    else { span.textContent = "Reklamınız burada olabilir"; a.removeAttribute("href"); }
  }
  function renderAll() { renderFridge(); renderTop(); renderCustomers(); renderKitchen(); renderUpgrades(); renderShop(); }

  // ---------- Yıldız ile satın alma ----------
  async function buy(item) {
    if (IN_TG) {
      try {
        const { link } = await api("invoice", { item });
        tg.openInvoice(link, async (status) => {
          if (status === "paid") {
            toast("Ödeme alındı, teşekkürler!"); Sfx.purchase();
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
        <div class="big-num">${r.todayStars.toLocaleString("tr-TR")} ${IC("star", "bni")}</div>
        <div class="muted">${(r.points || 0).toLocaleString("tr-TR")} puan · ${r.pointsPerStar} puan = 1 ${IC("star")}</div>
        <div class="muted">Döner başına <b>${r.multiplier} puan</b> · ${r.served}/${r.dailyCap} döner</div>
        <div class="cap"><div style="width:${Math.min(100, (r.served / r.dailyCap) * 100)}%"></div></div>
        <p class="muted small">Yıldızların her gün bakiyene eklenir. Kur günlük değişebilir.</p>
      </div>
      <div class="card">
        <div class="kv"><span>Bakiye</span><b>${r.balanceStars} ${IC("star")} <small class="muted">(≈ ${usd(r.balanceUsd)})</small></b></div>
        ${r.pendingUsd ? `<div class="kv"><span>Bekleyen çekim</span><b>${usd(r.pendingUsd)}</b></div>` : ""}
        <input id="walletIn" class="input" placeholder="TON cüzdan adresin" value="${r.wallet || ""}">
        <div class="row">
          <button class="btn wood" id="btnWallet">${IC("wallet", "bi")}Cüzdanı Kaydet</button>
          <button class="btn green" id="btnWithdraw" ${r.balanceUsd < r.minWithdrawUsd ? "disabled" : ""}>${IC("coin", "bi")}Çek</button>
        </div>
        <p class="muted small">En az ${usd(r.minWithdrawUsd)} birikince TON olarak çekebilirsin.</p>
      </div>
      <div class="card" id="refCard"><div class="muted">Davet bilgisi yükleniyor…</div></div>`;
    loadReferral();
    $("btnWallet").onclick = async () => {
      try { await api("wallet", { address: $("walletIn").value }); toast("Cüzdan kaydedildi"); }
      catch (e) { toast("Geçersiz TON adresi"); }
    };
    $("btnWithdraw").onclick = async () => {
      try {
        const w = await api("withdraw", {});
        toast(w.ok ? "Çekim talebin alındı" : w.reason);
        loadRewards();
      } catch (e) { toast("Hata oluştu"); }
    };
  }

  async function loadReferral() {
    const card = $("refCard");
    let r;
    try { r = await api("referral"); } catch (e) { card.innerHTML = '<div class="muted">Davet bilgisi alınamadı</div>'; return; }
    card.innerHTML = `
      <b class="card-title">${IC("gift", "li")}Arkadaşını Davet Et</b>
      <p class="muted small">Davet ettiğin arkadaşın paket alırsa <b>+${r.refPoints} puan</b> (≈ ${r.refStars} ${IC("star")}) kazanırsın.</p>
      <input class="input" id="refLink" readonly value="${r.link || ""}">
      <div class="row">
        <button class="btn wood" id="btnCopy">Kopyala</button>
        <button class="btn primary" id="btnShare">Paylaş</button>
      </div>
      <div class="kv"><span>Davet ettiğin</span><b>${r.invited}</b></div>
      <div class="kv"><span>Paket alan</span><b>${r.rewarded}</b></div>
      <div class="kv"><span>Davetten kazandığın</span><b>${r.pointsEarned} puan</b></div>`;
    $("btnCopy").onclick = async () => {
      try { await navigator.clipboard.writeText(r.link); toast("Link kopyalandı"); }
      catch (e) { $("refLink").select(); document.execCommand("copy"); toast("Link kopyalandı"); }
    };
    $("btnShare").onclick = () => {
      const text = "Gel benimle döner sar, puan topla!";
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
    $("tgMusic").textContent = "Müzik: " + (Sfx.musicOn ? "Açık" : "Kapalı");
    $("tgSfx").textContent = "Efektler: " + (Sfx.sfxOn ? "Açık" : "Kapalı");
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
    if (customers.length !== before) { left = true; toast("Müşteri sinirlenip gitti!"); haptic("rigid"); Sfx.angry(); }

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
      modal(`Sen yokken çırağın ${h ? h + " saat " : ""}${m} dakika çalıştı ve ${IC("coin")} ${fmt(gain)} kazandı!`);
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
      } catch (e) { toast("Sunucuya bağlanılamadı, çevrimdışı oynanıyor"); }
    }
    applyOffline();
    saveLocal();
    renderSponsor(); renderAll();
    requestAnimationFrame(loop);
  }
  init();
})();
