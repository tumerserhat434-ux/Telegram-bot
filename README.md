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
webapp/static/three.min.js   Three.js r128 (MIT lisansı) — 3D döner için
bot/main.py      Bot + oyun sunucusu + Stars ödemeleri (aiogram + aiohttp)
sponsor.json     (isteğe bağlı) Üstteki reklam alanının yazısı ve linki
```

## Kurulum
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
ile alınır ve `doner.db` veritabanına kaydedilir. Güçlendirmeler sunucudan gelir, oyuncu
tarayıcıdan kendine veremez.

## Tarayıcıda test
```bash
cd webapp && python3 -m http.server 8000
# http://localhost:8000/?dev=1   (dev modunda yıldız alımları ücretsiz simüle edilir)
```

## Yol haritası
- [ ] Kripto ödül sistemi (TON) — bkz. aşağıdaki notlar
- [ ] Sunucu taraflı skor doğrulama (gerçek para ödülünden **önce** şart)
- [ ] Liderlik tablosu, günlük görevler, yeni menü öğeleri (ayran, lahmacun…)

### Kripto ödül notları
- Telegram, Mini App'lerde kripto için **sadece TON** kullanılmasına izin veriyor (TON Connect).
- Ödüller **reklam/sponsor gelirinden** ödenmeli; oyuncuların yatırdığı Stars'tan başka
  oyunculara para dağıtmak saadet zinciri gibi görünür ve hukuki risk taşır.
- Gerçek para verilecekse hile koruması şart: şu an para hesabı istemcide yapılıyor.
