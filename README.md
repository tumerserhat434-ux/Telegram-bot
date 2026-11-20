# Fotoğraf Satış Botu (Telegram Mini Uygulaması + Stars)

Kendi fotoğraflarınızı Telegram Stars ile satmanızı sağlayan bot ve mini uygulama.

## Nasıl çalışır?

- **Alıcı:** Bota `/start` yazar ve **✨ Profili aç** butonuna basar. Mini uygulamada kapak, isim, biyografi ve
  bulanık önizlemeli galeri görünür. Bir içeriğe dokunup **⭐ ile aç** butonuna basınca Telegram'ın Stars ödeme penceresi açılır.
  Ödeme yapılınca fotoğraflar uygulamada açılır.
- **Siz:** Mini uygulamada sadece size görünen **👑 Yönetim** sekmesinden yönetirsiniz:
  - içerik yükleme (bir içerikte 10'a kadar fotoğraf/video, başlık, kategori, fiyat veya ücretsiz)
  - düzenleme, gizleme, silme
  - yeni içeriği takipçilere duyurma
  - profili düzenleme
  - satış istatistikleri

## Video

- Fotoğrafla birlikte veya tek başına video yüklenebilir (mp4, mov, m4v, webm; varsayılan sınır video başına 300 MB, `MAX_VIDEO_MB` ile değişir).
- Kapak karesini ve süreyi yükleme sırasında telefon çıkarır, sunucuda ffmpeg gerekmez. Kilitli videolarda bu kare bulanık görünür.
- iPhone videoları HEVC formatında olabilir ve bazı Android cihazlarda oynamayabilir. En geniş uyumluluk için iPhone'da
  **Ayarlar → Kamera → Formatlar → En Uyumlu** seçeneğiyle çekin (H.264).

## Güvenlik

- Yönetim yetkisi tarayıcıda değil, **sunucuda** kontrol edilir. Her istek Telegram'ın imzasıyla (initData) doğrulanır.
  Sadece `ADMIN_ID` hesabı yönetim işlemlerini yapabilir. Başkaları sekmeyi görmez, sayfayı kurcalasa bile istekleri reddedilir.
- Orijinal fotoğraf ve videolar sadece satın alan kişiye (ücretsizse herkese) **süreli, kişiye özel imzalı bağlantılarla** verilir.
  Herkese açık olan tek görsel, sunucuda bulanıklaştırılmış önizlemedir.
- Ödeme öncesinde içerik, fiyat ve alıcı yeniden kontrol edilir. Satın alma kaydı Telegram'ın onayladığı ödemeden sonra yapılır.

## Bot komutları

| Komut | Kim | Ne yapar |
|---|---|---|
| `/start` | herkes | Profili açma butonu |
| `/destek mesaj` | herkes | Yöneticiye destek mesajı gönderir (Telegram, Stars kabul eden botlarda bunu zorunlu tutar) |
| `/bildirim` | herkes | Duyuruları açar veya kapatır |
| `/admin` | yönetici | Yönetim panelini açar |
| `/cevap id mesaj` | yönetici | Destek mesajına cevap verir |
| `/iade id kod` | yönetici | Stars iadesi yapar (kod, satış bildiriminde yazar) |

## Railway'de kurulum

1. Depoyu Railway'e bağlayın. Servis ayarlarında dal olarak kodun bulunduğu dalı seçin.
2. **Volume** ekleyin ve mount path olarak `/data` girin. Fotoğraflar ve satışlar burada saklanır.
3. **Variables** sekmesine şunları ekleyin:
   - `BOT_TOKEN`: @BotFather'dan aldığınız token
   - `ADMIN_ID`: @userinfobot'tan öğrendiğiniz numara
   - `DB_PATH`: `/data/bot.db`
4. **Settings → Networking → Generate Domain** ile bir adres oluşturun. Bot bu adresi otomatik olarak bulur
   (`RAILWAY_PUBLIC_DOMAIN`). Port sorulursa `8080` girin.
5. Deploy edin. Telegram'da bota `/start` yazın.

Yerelde denemek için `.env.example` dosyasını `.env` adıyla kopyalayın. Ardından `pip install -r requirements.txt` ve `python bot.py` çalıştırın.
Mini uygulama HTTPS adresi gerektirdiği için yerelde ngrok gibi bir tünele ve `WEBAPP_URL` değişkenine ihtiyaç vardır.

## Stars'ları çekmek

Kazanılan Stars, @BotFather üzerinden botun bakiyesinde görünür ve Telegram'ın kurallarına göre Fragment aracılığıyla çekilebilir.

## Kurallar

- Sadece **kendinize ait** ya da yetişkin ve açık izin vermiş kişilerin fotoğraflarını satın.
- Sahte kimlik kullanmayın, başkasının fotoğraflarını satmayın.
- [Telegram kullanım şartlarına](https://telegram.org/tos) ve [Stars şartlarına](https://telegram.org/tos/stars) uyun.
