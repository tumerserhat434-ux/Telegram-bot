# Fotoğraf Satış Botu (Telegram Stars)

Kendi fotoğraflarınızı Telegram Stars ile satmanızı sağlayan bot.
Fotoğraflar Telegram'ın **ücretli medya** özelliğiyle bulanık gönderilir, alıcı Stars ödeyince açılır.
Ödemeyi tamamen Telegram yönetir, kazanılan Stars bot sahibinin bakiyesine geçer.

## Özellikler

**Alıcılar için**
- Kapak fotoğrafı, isim ve biyografiden oluşan profil kartı (`/start`)
- Galeri: içerikler kilitli 🔒 veya satın alınmış ✅ olarak listelenir
- Bir içerik birden fazla fotoğraf içerebilir (en fazla 10)
- Daha önce satın alınan içerik için tekrar ödeme alınmaz
- `/destek`: ödeme sorunları için yöneticiye mesaj gönderir
- `/bildirim`: yeni içerik duyurularını açar veya kapatır

**Yönetici için** (özelden `/admin`)
- ➕ İçerik ekle: fotoğrafları gönder → başlık yaz → fiyat yaz (1–2500 Stars)
- 📋 İçerikler: fiyat değiştirme, gizleme/yayınlama, silme
- 📢 Yeni içeriği takipçilere bulanık hâliyle duyurma, metin duyurusu gönderme
- 👤 Profil: isim, biyografi ve kapak fotoğrafını değiştirme
- 📊 Satışlar: toplam ve son 24 saat, en çok satan içerikler
- Her satışta anında bildirim
- `/cevap <id> mesaj`: destek mesajlarına cevap verme

Fotoğraflar `protect_content` ile gönderilir. Alıcılar fotoğrafı iletemez veya kaydedemez.

## Kurulum

1. **Bot oluşturun:** Telegram'da [@BotFather](https://t.me/BotFather)'a `/newbot` yazın ve size verilen **token**'ı alın.
2. **ID'nizi öğrenin:** [@userinfobot](https://t.me/userinfobot)'a `/start` yazın, gelen sayı sizin ID'niz.
3. **Ayar dosyasını oluşturun:**
   ```bash
   cp .env.example .env
   ```
   `.env` dosyasını açın, `BOT_TOKEN` ve `ADMIN_ID` değerlerini girin.
   **Token'ı kimseyle paylaşmayın.** `.env` dosyası GitHub'a gönderilmez.
4. **Çalıştırın** (Python 3.10 veya üstü):
   ```bash
   pip install -r requirements.txt
   python bot.py
   ```
5. Telegram'da botunuza `/start`, sonra `/admin` yazın. Önce profilinizi, sonra içeriklerinizi ekleyin.

## Sürekli çalıştırma

Bot, `python bot.py` çalıştığı sürece açık kalır. 7/24 açık kalması için bir sunucuda çalıştırın:
- **Railway / Render:** Depoyu bağlayın, `BOT_TOKEN` ve `ADMIN_ID` değerlerini ortam değişkeni olarak girin. `Procfile` hazır.
  Veriler `bot.db` dosyasında tutulur. Bu dosyanın silinmemesi için kalıcı disk (volume) ekleyin ve `DB_PATH` değerini o diske yönlendirin.
- **VPS:** `systemd` servisi veya `screen`/`tmux` ile çalıştırabilirsiniz.

## Stars'ları çekmek

Kazanılan Stars, @BotFather üzerinden botunuzun bakiyesinde görünür.
Telegram'ın kurallarına göre Fragment aracılığıyla TON'a çevrilerek çekilebilir. Telegram, çekim için bekleme süresi ve asgari tutar uygular.

## Kurallar

- Sadece **kendinize ait** ya da yetişkin ve açık izin vermiş kişilerin fotoğraflarını satın.
- Sahte kimlik kullanmayın, başkasının fotoğraflarını satmayın.
- [Telegram'ın kullanım şartlarına](https://telegram.org/tos) ve [Stars şartlarına](https://telegram.org/tos/stars) uyun. Aksi hâlde bot kapatılabilir.
