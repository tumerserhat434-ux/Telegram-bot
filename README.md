# 🥙 Dönerci Usta — Telegram Mini App Oyunu

Döner kes, ekmeği saçta ısıt, turşu/mayonez/ketçap/patates ekle, sar ve müşteriye
siparişine göre teslim et. Çırak sen yokken de satış yapar (arka plan / çevrimdışı kazanç).
Telegram Stars ile kalıcı güçlendirmeler satılır, üstte sponsor reklam alanı vardır.

## Oynanış
1. Müşteri gelir, siparişi balonda yazar (ekmek tipi, et porsiyonu, malzemeler).
2. **🔪 Kes** — dönerden et kes (basılı tutunca sürekli keser), et tepsiye düşer.
3. **Saç** — lavaş ya da ekmeği saça koy. Çubuk **yeşil bölgedeyken** al: mükemmel ısınma = bahşiş.
   Geç kalırsan ekmek yanar.
4. **Tezgah** — Et Koy + malzemeler → **Sar / Kapat** → **Teslim Et**.
5. Yanlış sipariş az para getirir, müşteri çok beklerse sinirlenip gider.

## Klasörler
```
webapp/          Oyun (HTML/CSS/JS) — Telegram içinde açılan Mini App
webapp/static/assets/       Higgsfield ile üretilen görseller: arka plan, avatar, müşteriler (cust/), ikonlar (ic/),
                            yiyecekler (food/), döner-ısıtıcı-saç (station/) ve döngü müziği
webapp/static/audio.js      Ses efektleri (Web Audio ile üretilir) + müzik, ayarlardan açılıp kapanır
bot/main.py      Bot + oyun sunucusu + Stars ödemeleri (aiogram + aiohttp)
sponsor.json     (isteğe bağlı) Üstteki reklam alanının yazısı ve linki
```

## Render'a kurulum (önerilen, ücretsiz)
1. Telegram'da **@BotFather** → `/newbot` → bot adını ve kullanıcı adını seç → token'ı kopyala.
2. **@userinfobot**'a yaz → kendi Telegram ID'ni öğren (admin komutları için).
3. **render.com** → GitHub ile giriş yap → **New → Blueprint** → bu repoyu seç
   (Render'ın repoya erişmesine izin ver) → branch: `claude/intelligent-johnson-ume5xo`.
4. Render `BOT_TOKEN` ve `ADMIN_IDS` soracak → yapıştır → **Apply**. Kurulum 2-3 dakika sürer.
5. Telegram'da botuna `/start` yaz → **🥙 Dükkanı Aç** ya da sol alttaki **🥙 Oyna** butonu.

Notlar:
- Render ücretsiz paketi 15 dk boşta kalınca uyur; ilk mesajda ~1 dk içinde uyanır (webhook modu).
- **Ücretsiz pakette disk kalıcı değildir:** sunucu yeniden başlayınca `doner.db` (puanlar, bakiyeler,
  satın almalar) sıfırlanır. Test için sorun değil; gerçek oyuncu ve ödeme öncesi kalıcı veritabanına
  (ör. Render Disk ya da Postgres) geçilmeli.
- Token'ı sadece Render'ın ayarlarına gir; sohbete, koda veya GitHub'a yazma.

## Kendi sunucunda kurulum
1. **Bot oluştur:** Telegram'da @BotFather → `/newbot` → token'ı al.
2. **Kur:**
   ```bash
   python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
   cp .env.example .env   # içine BOT_TOKEN ve WEBAPP_URL yaz
   ```
3. **HTTPS adresi:** Mini App'ler sadece `https://` ile açılır. Domain yoksa ücretsiz:
   ```bash
   cloudflared tunnel --url http://localhost:8080
   ```
   Verdiği `https://....trycloudflare.com` adresini `.env` içindeki `WEBAPP_URL`'e yaz.
4. **Çalıştır:**
   ```bash
   .venv/bin/python bot/main.py
   ```
5. Botuna `/start` yaz → **🥙 Dükkanı Aç**.
   (İstersen BotFather → `/mybots` → Bot Settings → Menu Button ile sol alttaki butona da oyunu koyabilirsin.)

## Reklam / sponsor alanı
`sponsor.example.json` dosyasını `sponsor.json` olarak kopyala ve düzenle. Sunucuyu yeniden
başlatmana gerek yok, oyun her açılışta okur.

## Yıldız mağazası
Ürünler ve fiyatlar `bot/main.py` içindeki `STAR_ITEMS`'ta. Ödemeler Telegram Stars (`XTR`)
ile alınır ve `doner.db` veritabanına kaydedilir.

| Paket | Fiyat | Etkisi |
|---|---|---|
| Ücretsiz | — | Her doğru döner **1 puan**, normal müşteri sıklığı |
| Bronz Dükkan | 400⭐ | Her döner **3 puan**, **1,6 kat** daha sık müşteri |
| Gümüş Dükkan | 600⭐ | Her döner **5 puan**, **2,2 kat** daha sık müşteri, usta çırak |
| Altın Dükkan | 900⭐ | Her döner **7 puan**, **2,6 kat** daha sık müşteri, usta çırak |
| Elmas Dükkan | 1500⭐ | Her döner **10 puan**, **3 kat** daha sık müşteri, usta çırak, **Ayran dolabı** (ayranlı siparişe **+2 puan**) |
| Altın Bıçak | 100⭐ | Et kesimi 2 kat hızlı |

### Özel yükleme (1500⭐ ve üstü)
Mağazada Elmas paketinin altında: oyuncu 1500–10000 arası istediği miktarı yazar. Döner başı puan
`10 × √(yıldız / 1500)` (yuvarlanır, en fazla 30): 1500 → 10, 2000 → 12, 3000 → 14, 5000 → 18, 10000 → 26.
Birden fazla özel yükleme toplanır. 1500⭐ ve üstü yükleyen herkeste ayran dolabı açılır, müşteriler 3 kat sık gelir.

## Sıralama ve öğretici
- Üstteki **Sıralama** butonu: bugün / tüm zamanlar; her oyuncunun sardığı döner ve bakiyesine geçmiş yıldız.
- İlk girişte adım adım **öğretici** açılır (Ayarlar → "Öğreticiyi tekrar izle").

## Ödül sistemi (sardığın kadar kazan)
- Siparişleri **sunucu** üretir, teslimi sunucu kontrol eder. Sadece elle sarılıp doğru teslim edilen
  döner puan getirir (çırağın kazancı oyun parasıdır, puan değildir).
- Hile koruması: bir siparişte en az `MIN_SERVE_SECONDS` saniye, günlük en fazla `DAILY_CAP` puanlı döner.
- **Her gün** (ör. sabah) önceki günün reklam gelirini bota yazarsın:
  ```
  /havuz 100            → dünün geliri 100$, %50'si (POOL_PCT) havuza, puanlara göre dağıtılır
  /havuz 100 2026-11-22 → belirli bir gün
  ```
  Bir gün yalnızca bir kez dağıtılır. Dağıtılan para hiçbir zaman girdiğin gelirden fazla olmaz.
- **Kur: 12 puan = 1⭐** (`POINTS_PER_STAR`). Havuz herkesin hak edişini karşılıyorsa tam kur ödenir,
  artan kısım sende kalır. Karşılamıyorsa herkesin ödülü aynı oranda düşürülür
  (bot `/havuz` cevabında "Kur oranı: %…" olarak gösterir).
- Oyuncu Ödüller sekmesinde puanını, tahmini kazancını ve bakiyesini görür; TON adresini kaydedip
  `MIN_WITHDRAW_USD` dolar birikince çekim ister.
- Çekimler: `/cekimler` (bekleyenleri listeler) → TON'u kendi cüzdanından gönder → `/odendi ID`.
  Reddetmek için `/reddet ID` (tutar oyuncunun bakiyesine geri döner).
- Admin komutları sadece `.env` içindeki `ADMIN_IDS` kullanıcılarında çalışır.

## Arkadaş davet sistemi
- Her oyuncunun linki Ödüller sekmesinde: `https://t.me/BOTUN?start=ref_<ID>` (Kopyala / Paylaş butonları).
- Davet edilen arkadaş **ilk paketini** aldığında davet edene **240 puan** (`REF_POINTS`, 12 puan = 1⭐ ile ≈ 20⭐).
- Sadece tek seviye: arkadaşının getirdikleri sana puan kazandırmaz.
- Sadece yeni kullanıcılar sayılır; kendini davet etmek ve var olmayan davetçi geçersiz. Her arkadaş için bir kez.
- Davet puanları da günlük havuzdan, aynı kur kuralıyla ödenir.

## Tarayıcıda test
```bash
cd webapp && python3 -m http.server 8000
# http://localhost:8000/?dev=1   (dev modunda yıldız alımları ücretsiz simüle edilir)
```

## Yol haritası
- [x] Reklam geliri havuzlu ödül sistemi, TON çekim talepleri
- [ ] TON Connect ile cüzdan bağlama ve otomatik ödeme
- [ ] Liderlik tablosu, günlük görevler, yeni menü öğeleri (ayran, lahmacun…)

### Kripto ödül notları
- Telegram, Mini App'lerde kripto için **sadece TON** kullanılmasına izin veriyor (TON Connect).
- Ödüller **reklam/sponsor gelirinden** ödenmeli; oyuncuların yatırdığı Stars'tan başka
  oyunculara para dağıtmak saadet zinciri gibi görünür ve hukuki risk taşır.
- Ödüller puan payına göre değişkendir; oyunculara sabit/garanti kazanç vaat etme.
