"""Fotoğraf Satış Botu - Telegram Stars ile ücretli fotoğraf satışı.

Alıcılar: /start ile profil kartını görür, galeriden içerik seçer.
İçerik Telegram'ın "ücretli medya" özelliğiyle bulanık gelir, Stars ödenince açılır.

Yönetici: özelden /admin ile panel açılır (içerik ekle/sil, fiyat, profil, satışlar, duyuru).

Ayarlar .env dosyasından okunur (bkz. .env.example). Token koda yazılmaz.
"""

import asyncio
import logging
import os
import sqlite3
import time
import warnings

from dotenv import load_dotenv
from telegram import (
    BotCommand,
    BotCommandScopeChat,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    InputMediaPhoto,
    InputPaidMediaPhoto,
    Update,
)
from telegram.constants import ParseMode
from telegram.error import Forbidden, RetryAfter, TelegramError
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    PaidMediaPurchasedHandler,
    filters,
)
from telegram.helpers import escape_markdown
from telegram.warnings import PTBUserWarning

load_dotenv()
warnings.filterwarnings("ignore", category=PTBUserWarning)

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("foto-bot")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_ID = int(os.getenv("ADMIN_ID", "0") or 0)
DB_PATH = os.getenv("DB_PATH", "bot.db")

MIN_PRICE, MAX_PRICE = 1, 2500  # Telegram ücretli medya sınırları (Stars)
PAGE_SIZE = 8


def md(text) -> str:
    return escape_markdown(str(text), version=2)


# ==========================================================================
# Veritabanı
# ==========================================================================
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.row_factory = sqlite3.Row
db.executescript(
    """
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        price INTEGER NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS item_photos (
        item_id INTEGER NOT NULL,
        file_id TEXT NOT NULL,
        pos INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY,
        first_name TEXT,
        username TEXT,
        notify INTEGER NOT NULL DEFAULT 1,
        joined_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        stars INTEGER NOT NULL,
        at INTEGER NOT NULL
    );
    """
)
db.commit()

DEFAULTS = {
    "name": "Profil",
    "bio": "Merhaba! Galerime göz at, beğendiğin içeriği Telegram Stars ile aç. ✨",
    "cover": "",
}


def get_setting(key: str) -> str:
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else DEFAULTS.get(key, "")


def set_setting(key: str, value: str) -> None:
    db.execute("INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)", (key, value))
    db.commit()


def save_user(user) -> None:
    db.execute(
        "INSERT INTO users(id, first_name, username, joined_at) VALUES(?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username",
        (user.id, user.first_name, user.username, int(time.time())),
    )
    db.commit()


def get_item(item_id: int):
    return db.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()


def item_photos(item_id: int) -> list[str]:
    rows = db.execute(
        "SELECT file_id FROM item_photos WHERE item_id=? ORDER BY pos", (item_id,)
    ).fetchall()
    return [r["file_id"] for r in rows]


def has_bought(user_id: int, item_id: int) -> bool:
    return (
        db.execute(
            "SELECT 1 FROM purchases WHERE user_id=? AND item_id=? LIMIT 1", (user_id, item_id)
        ).fetchone()
        is not None
    )


def is_admin(update: Update) -> bool:
    return bool(ADMIN_ID) and update.effective_user and update.effective_user.id == ADMIN_ID


# ==========================================================================
# Alıcı tarafı
# ==========================================================================
def profile_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("🖼 Galeri", callback_data="u:gal:0")],
            [
                InlineKeyboardButton("🆕 En yeni", callback_data="u:new"),
                InlineKeyboardButton("❓ Nasıl satın alırım?", callback_data="u:how"),
            ],
        ]
    )


def profile_caption() -> str:
    count = db.execute("SELECT COUNT(*) FROM items WHERE active=1").fetchone()[0]
    return (
        f"✨ *{md(get_setting('name'))}* ✨\n\n"
        f"{md(get_setting('bio'))}\n\n"
        f"📸 {count} içerik  •  ⭐ Telegram Stars ile güvenli ödeme"
    )


async def send_profile(chat_id: int, context: ContextTypes.DEFAULT_TYPE) -> None:
    cover = get_setting("cover")
    if cover:
        await context.bot.send_photo(
            chat_id, cover, caption=profile_caption(),
            parse_mode=ParseMode.MARKDOWN_V2, reply_markup=profile_keyboard(),
        )
    else:
        await context.bot.send_message(
            chat_id, profile_caption(),
            parse_mode=ParseMode.MARKDOWN_V2, reply_markup=profile_keyboard(),
        )


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    save_user(update.effective_user)
    await send_profile(update.effective_chat.id, context)
    if is_admin(update):
        await update.message.reply_text("👑 Yönetici paneli için /admin yazın.")


def gallery_markup(page: int, user_id: int) -> tuple[str, InlineKeyboardMarkup]:
    total = db.execute("SELECT COUNT(*) FROM items WHERE active=1").fetchone()[0]
    rows = db.execute(
        "SELECT * FROM items WHERE active=1 ORDER BY id DESC LIMIT ? OFFSET ?",
        (PAGE_SIZE, page * PAGE_SIZE),
    ).fetchall()
    if not rows:
        return "Galeri şu an boş. Yakında yeni içerikler gelecek! 💫", InlineKeyboardMarkup(
            [[InlineKeyboardButton("⬅️ Profil", callback_data="u:profile")]]
        )
    buttons = []
    for r in rows:
        mark = "✅" if has_bought(user_id, r["id"]) else "🔒"
        n = len(item_photos(r["id"]))
        label = f"{mark} {r['title']} ({n} foto) — ⭐{r['price']}"
        buttons.append([InlineKeyboardButton(label, callback_data=f"u:item:{r['id']}")])
    nav = []
    if page > 0:
        nav.append(InlineKeyboardButton("◀️", callback_data=f"u:gal:{page - 1}"))
    if (page + 1) * PAGE_SIZE < total:
        nav.append(InlineKeyboardButton("▶️", callback_data=f"u:gal:{page + 1}"))
    if nav:
        buttons.append(nav)
    buttons.append([InlineKeyboardButton("⬅️ Profil", callback_data="u:profile")])
    pages = (total - 1) // PAGE_SIZE + 1
    return f"🖼 Galeri ({page + 1}/{pages})\nBir içerik seç:", InlineKeyboardMarkup(buttons)


async def send_item(chat_id: int, user_id: int, item, context: ContextTypes.DEFAULT_TYPE) -> None:
    photos = item_photos(item["id"])
    if not photos:
        await context.bot.send_message(chat_id, "Bu içerik şu an kullanılamıyor.")
        return
    if has_bought(user_id, item["id"]):
        # Daha önce aldıysa tekrar ödetme, normal gönder
        media = [InputMediaPhoto(p) for p in photos]
        media[0] = InputMediaPhoto(photos[0], caption=f"✅ {item['title']} (satın aldın)")
        await context.bot.send_media_group(chat_id, media, protect_content=True)
        return
    await context.bot.send_paid_media(
        chat_id,
        star_count=item["price"],
        media=[InputPaidMediaPhoto(p) for p in photos],
        caption=f"🔒 {item['title']}\n⭐ {item['price']} Stars ile aç",
        payload=f"item:{item['id']}",
        protect_content=True,
    )


async def user_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    await query.answer()
    parts = query.data.split(":")
    action = parts[1]
    chat_id = query.message.chat.id
    user_id = query.from_user.id

    if action == "gal":
        text, markup = gallery_markup(int(parts[2]), user_id)
        await context.bot.send_message(chat_id, text, reply_markup=markup)
    elif action == "item":
        item = get_item(int(parts[2]))
        if not item or not item["active"]:
            await context.bot.send_message(chat_id, "Bu içerik artık mevcut değil.")
            return
        await send_item(chat_id, user_id, item, context)
    elif action == "new":
        item = db.execute("SELECT * FROM items WHERE active=1 ORDER BY id DESC LIMIT 1").fetchone()
        if not item:
            await context.bot.send_message(chat_id, "Henüz içerik yok. Yakında! 💫")
        else:
            await send_item(chat_id, user_id, item, context)
    elif action == "how":
        await context.bot.send_message(
            chat_id,
            "❓ Nasıl satın alırım?\n\n"
            "1. Galeriden bir içerik seç.\n"
            "2. Bulanık fotoğrafın üzerindeki butona bas.\n"
            "3. Telegram Stars ile ödemeyi onayla, fotoğraf anında açılır.\n\n"
            "Stars'ın yoksa Telegram içinden satın alabilirsin "
            "(Ayarlar → Telegram Stars).\n"
            "Sorun yaşarsan: /destek",
        )
    elif action == "profile":
        await send_profile(chat_id, context)


async def on_purchase(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    purchase = update.purchased_paid_media
    payload = purchase.paid_media_payload or ""
    if not payload.startswith("item:"):
        return
    item = get_item(int(payload.split(":")[1]))
    if not item:
        return
    buyer = purchase.from_user
    save_user(buyer)
    db.execute(
        "INSERT INTO purchases(user_id, item_id, stars, at) VALUES(?,?,?,?)",
        (buyer.id, item["id"], item["price"], int(time.time())),
    )
    db.commit()
    try:
        await context.bot.send_message(buyer.id, "💖 Teşekkürler! İçeriğin açıldı, keyfini çıkar.")
    except TelegramError:
        pass
    if ADMIN_ID:
        who = f"@{buyer.username}" if buyer.username else buyer.first_name
        await context.bot.send_message(
            ADMIN_ID, f"💰 Yeni satış!\n{who} → “{item['title']}” • ⭐ {item['price']}"
        )


async def destek(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Telegram, Stars kabul eden botlarda bir destek komutu ister."""
    save_user(update.effective_user)
    text = " ".join(context.args).strip()
    if not text:
        await update.message.reply_text(
            "🛟 Destek\nMesajınızı komutla birlikte yazın, örnek:\n"
            "/destek Ödeme yaptım ama fotoğraf açılmadı"
        )
        return
    u = update.effective_user
    if ADMIN_ID:
        await context.bot.send_message(
            ADMIN_ID,
            f"🛟 Destek mesajı\nKimden: {u.first_name} (@{u.username or '-'}) id: {u.id}\n\n{text}\n\n"
            f"Cevaplamak için: /cevap {u.id} mesajınız",
        )
    await update.message.reply_text("✅ Mesajın iletildi, en kısa sürede dönüş yapılacak.")


async def bildirim(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    save_user(update.effective_user)
    row = db.execute("SELECT notify FROM users WHERE id=?", (update.effective_user.id,)).fetchone()
    new = 0 if row and row["notify"] else 1
    db.execute("UPDATE users SET notify=? WHERE id=?", (new, update.effective_user.id))
    db.commit()
    await update.message.reply_text(
        "🔔 Yeni içerik bildirimleri açıldı." if new else "🔕 Yeni içerik bildirimleri kapatıldı."
    )


# ==========================================================================
# Yönetici paneli
# ==========================================================================
(ADD_PHOTOS, ADD_TITLE, ADD_PRICE, EDIT_NAME, EDIT_BIO, EDIT_COVER, EDIT_PRICE, BCAST_TEXT) = range(8)


def admin_menu() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [InlineKeyboardButton("➕ İçerik ekle", callback_data="a:add")],
            [
                InlineKeyboardButton("📋 İçerikler", callback_data="a:list:0"),
                InlineKeyboardButton("📊 Satışlar", callback_data="a:stats"),
            ],
            [
                InlineKeyboardButton("👤 Profili düzenle", callback_data="a:profile"),
                InlineKeyboardButton("📢 Duyuru", callback_data="a:bcast"),
            ],
            [InlineKeyboardButton("👁 Profili önizle", callback_data="u:profile")],
        ]
    )


def back_btn() -> list:
    return [InlineKeyboardButton("⬅️ Panel", callback_data="a:panel")]


async def admin(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update):
        return
    users = db.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    items = db.execute("SELECT COUNT(*) FROM items WHERE active=1").fetchone()[0]
    stars = db.execute("SELECT COALESCE(SUM(stars),0) FROM purchases").fetchone()[0]
    await update.effective_message.reply_text(
        f"👑 Yönetici Paneli\n\n👥 {users} kullanıcı  •  📸 {items} içerik  •  ⭐ {stars} Stars kazanç",
        reply_markup=admin_menu(),
    )


async def admin_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    query = update.callback_query
    if not is_admin(update):
        await query.answer()
        return
    await query.answer()
    parts = query.data.split(":")
    action = parts[1]
    msg = query.message

    if action == "panel":
        await admin(update, context)

    elif action == "list":
        page = int(parts[2])
        total = db.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        rows = db.execute(
            "SELECT * FROM items ORDER BY id DESC LIMIT ? OFFSET ?", (PAGE_SIZE, page * PAGE_SIZE)
        ).fetchall()
        if not rows:
            await msg.reply_text("Henüz içerik yok.", reply_markup=InlineKeyboardMarkup([back_btn()]))
            return
        buttons = [
            [InlineKeyboardButton(
                f"{'🟢' if r['active'] else '⚪️'} {r['title']} — ⭐{r['price']}",
                callback_data=f"a:item:{r['id']}",
            )]
            for r in rows
        ]
        nav = []
        if page > 0:
            nav.append(InlineKeyboardButton("◀️", callback_data=f"a:list:{page - 1}"))
        if (page + 1) * PAGE_SIZE < total:
            nav.append(InlineKeyboardButton("▶️", callback_data=f"a:list:{page + 1}"))
        if nav:
            buttons.append(nav)
        buttons.append(back_btn())
        await msg.reply_text("📋 İçerikler (🟢 yayında, ⚪️ gizli):", reply_markup=InlineKeyboardMarkup(buttons))

    elif action == "item":
        item = get_item(int(parts[2]))
        if not item:
            await msg.reply_text("İçerik bulunamadı.")
            return
        photos = item_photos(item["id"])
        if photos:
            await msg.reply_media_group([InputMediaPhoto(p) for p in photos])
        sold = db.execute(
            "SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases WHERE item_id=?", (item["id"],)
        ).fetchone()
        iid = item["id"]
        await msg.reply_text(
            f"📸 {item['title']}\n⭐ Fiyat: {item['price']}\n"
            f"Durum: {'Yayında 🟢' if item['active'] else 'Gizli ⚪️'}\n"
            f"Satış: {sold[0]} adet • ⭐ {sold[1]}",
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton("💰 Fiyat değiştir", callback_data=f"a:price:{iid}"),
                        InlineKeyboardButton(
                            "🙈 Gizle" if item["active"] else "👁 Yayınla", callback_data=f"a:toggle:{iid}"
                        ),
                    ],
                    [
                        InlineKeyboardButton("📢 Takipçilere duyur", callback_data=f"a:announce:{iid}"),
                        InlineKeyboardButton("🗑 Sil", callback_data=f"a:del:{iid}"),
                    ],
                    [InlineKeyboardButton("⬅️ İçerikler", callback_data="a:list:0")],
                ]
            ),
        )

    elif action == "toggle":
        iid = int(parts[2])
        db.execute("UPDATE items SET active = 1 - active WHERE id=?", (iid,))
        db.commit()
        item = get_item(iid)
        await msg.reply_text(
            f"“{item['title']}” artık {'yayında 🟢' if item['active'] else 'gizli ⚪️'}.",
            reply_markup=InlineKeyboardMarkup([back_btn()]),
        )

    elif action == "del":
        iid = int(parts[2])
        await msg.reply_text(
            "🗑 Bu içerik kalıcı olarak silinsin mi? (Satış kayıtları korunur)",
            reply_markup=InlineKeyboardMarkup(
                [[
                    InlineKeyboardButton("✅ Evet, sil", callback_data=f"a:delok:{iid}"),
                    InlineKeyboardButton("❌ Vazgeç", callback_data=f"a:item:{iid}"),
                ]]
            ),
        )

    elif action == "delok":
        iid = int(parts[2])
        db.execute("DELETE FROM item_photos WHERE item_id=?", (iid,))
        db.execute("DELETE FROM items WHERE id=?", (iid,))
        db.commit()
        await msg.reply_text("🗑 Silindi.", reply_markup=InlineKeyboardMarkup([back_btn()]))

    elif action == "stats":
        total = db.execute("SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases").fetchone()
        day_ago = int(time.time()) - 86400
        today = db.execute(
            "SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases WHERE at>=?", (day_ago,)
        ).fetchone()
        buyers = db.execute("SELECT COUNT(DISTINCT user_id) FROM purchases").fetchone()[0]
        top = db.execute(
            "SELECT i.title, COUNT(*) c, SUM(p.stars) s FROM purchases p JOIN items i ON i.id=p.item_id "
            "GROUP BY p.item_id ORDER BY s DESC LIMIT 5"
        ).fetchall()
        lines = "\n".join(f"• {r['title']}: {r['c']} adet, ⭐{r['s']}" for r in top) or "—"
        await msg.reply_text(
            f"📊 Satışlar\n\n"
            f"Toplam: {total[0]} satış • ⭐ {total[1]}\n"
            f"Son 24 saat: {today[0]} satış • ⭐ {today[1]}\n"
            f"Farklı alıcı: {buyers}\n\n"
            f"🏆 En çok kazandıranlar:\n{lines}\n\n"
            f"Stars'larınızı çekmek için: @BotFather → botunuz → Bot Settings / Balance",
            reply_markup=InlineKeyboardMarkup([back_btn()]),
        )

    elif action == "profile":
        await msg.reply_text(
            f"👤 Profil\n\nİsim: {get_setting('name')}\nBiyografi: {get_setting('bio')}\n"
            f"Kapak fotoğrafı: {'var ✅' if get_setting('cover') else 'yok ❌'}",
            reply_markup=InlineKeyboardMarkup(
                [
                    [
                        InlineKeyboardButton("✏️ İsim", callback_data="a:ename"),
                        InlineKeyboardButton("📝 Biyografi", callback_data="a:ebio"),
                    ],
                    [InlineKeyboardButton("🖼 Kapak fotoğrafı", callback_data="a:ecover")],
                    back_btn(),
                ]
            ),
        )

    elif action == "announce":
        item = get_item(int(parts[2]))
        if not item or not item["active"]:
            await msg.reply_text("Sadece yayındaki içerikler duyurulabilir.")
            return
        context.application.create_task(announce_item(context, item["id"]))
        await msg.reply_text("📢 Duyuru gönderiliyor, bitince haber vereceğim.")

    elif action == "bcastok":
        text = context.user_data.pop("bcast_text", None)
        if not text:
            await msg.reply_text("Gönderilecek duyuru bulunamadı.")
            return
        context.application.create_task(broadcast_text(context, text))
        await msg.reply_text("📢 Duyuru gönderiliyor, bitince haber vereceğim.")

    elif action == "bcastno":
        context.user_data.pop("bcast_text", None)
        await msg.reply_text("Duyuru iptal edildi.", reply_markup=InlineKeyboardMarkup([back_btn()]))


async def _send_to_all(context: ContextTypes.DEFAULT_TYPE, send) -> tuple[int, int]:
    users = db.execute("SELECT id FROM users WHERE notify=1 AND id != ?", (ADMIN_ID,)).fetchall()
    ok = fail = 0
    for row in users:
        uid = row["id"]
        for _ in range(2):
            try:
                await send(uid)
                ok += 1
                break
            except RetryAfter as e:
                await asyncio.sleep(e.retry_after + 1)
            except Forbidden:  # botu engellemiş
                db.execute("UPDATE users SET notify=0 WHERE id=?", (uid,))
                db.commit()
                fail += 1
                break
            except TelegramError:
                fail += 1
                break
        await asyncio.sleep(0.05)  # Telegram hız sınırı
    return ok, fail


async def announce_item(context: ContextTypes.DEFAULT_TYPE, item_id: int) -> None:
    item = get_item(item_id)
    photos = item_photos(item_id)

    async def send(uid):
        await context.bot.send_paid_media(
            uid, star_count=item["price"], media=[InputPaidMediaPhoto(p) for p in photos],
            caption=f"🆕 Yeni içerik: {item['title']}\n⭐ {item['price']} Stars ile aç\n\n"
                    f"(Bildirimleri kapatmak için /bildirim)",
            payload=f"item:{item_id}", protect_content=True,
        )

    ok, fail = await _send_to_all(context, send)
    await context.bot.send_message(ADMIN_ID, f"📢 Duyuru bitti: {ok} kişiye gitti, {fail} başarısız.")


async def broadcast_text(context: ContextTypes.DEFAULT_TYPE, text: str) -> None:
    async def send(uid):
        await context.bot.send_message(uid, text + "\n\n(Bildirimleri kapatmak için /bildirim)")

    ok, fail = await _send_to_all(context, send)
    await context.bot.send_message(ADMIN_ID, f"📢 Duyuru bitti: {ok} kişiye gitti, {fail} başarısız.")


# --- Konuşma adımları (içerik ekleme, profil düzenleme, fiyat, duyuru) ------
CANCEL_KB = InlineKeyboardMarkup([[InlineKeyboardButton("❌ İptal", callback_data="a:cancel")]])


async def conv_entry(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if not is_admin(update):
        return ConversationHandler.END
    parts = query.data.split(":")
    action = parts[1]
    msg = query.message
    if action == "add":
        context.user_data["new_photos"] = []
        await msg.reply_text(
            "📸 İçeriğe eklenecek fotoğrafları gönderin (1–10 adet).\n"
            "Hepsini gönderince ✅ Tamam'a basın.",
            reply_markup=InlineKeyboardMarkup(
                [[
                    InlineKeyboardButton("✅ Tamam", callback_data="a:photosdone"),
                    InlineKeyboardButton("❌ İptal", callback_data="a:cancel"),
                ]]
            ),
        )
        return ADD_PHOTOS
    if action == "ename":
        await msg.reply_text("✏️ Yeni profil ismini yazın:", reply_markup=CANCEL_KB)
        return EDIT_NAME
    if action == "ebio":
        await msg.reply_text("📝 Yeni biyografiyi yazın:", reply_markup=CANCEL_KB)
        return EDIT_BIO
    if action == "ecover":
        await msg.reply_text("🖼 Kapak fotoğrafını gönderin:", reply_markup=CANCEL_KB)
        return EDIT_COVER
    if action == "price":
        context.user_data["price_item"] = int(parts[2])
        await msg.reply_text(
            f"💰 Yeni fiyatı yazın ({MIN_PRICE}–{MAX_PRICE} Stars):", reply_markup=CANCEL_KB
        )
        return EDIT_PRICE
    if action == "bcast":
        await msg.reply_text(
            "📢 Tüm kullanıcılara gönderilecek duyuru metnini yazın:", reply_markup=CANCEL_KB
        )
        return BCAST_TEXT
    return ConversationHandler.END


async def add_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    photos = context.user_data.setdefault("new_photos", [])
    if len(photos) >= 10:
        await update.message.reply_text("En fazla 10 fotoğraf eklenebilir. ✅ Tamam'a basın.")
        return ADD_PHOTOS
    photos.append(update.message.photo[-1].file_id)
    await update.message.reply_text(
        f"📥 {len(photos)}. fotoğraf alındı.",
        reply_markup=InlineKeyboardMarkup(
            [[
                InlineKeyboardButton(f"✅ Tamam ({len(photos)})", callback_data="a:photosdone"),
                InlineKeyboardButton("❌ İptal", callback_data="a:cancel"),
            ]]
        ),
    )
    return ADD_PHOTOS


async def photos_done(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()
    if not context.user_data.get("new_photos"):
        await query.message.reply_text("Önce en az 1 fotoğraf gönderin.")
        return ADD_PHOTOS
    await query.message.reply_text(
        "🏷 İçeriğe bir başlık yazın (örnek: “Yaz tatili seti”):", reply_markup=CANCEL_KB
    )
    return ADD_TITLE


async def add_title(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    title = update.message.text.strip()[:60]
    context.user_data["new_title"] = title
    await update.message.reply_text(
        f"💰 Fiyatı yazın ({MIN_PRICE}–{MAX_PRICE} Stars):", reply_markup=CANCEL_KB
    )
    return ADD_PRICE


def parse_price(text: str):
    text = text.strip()
    if not text.isdigit():
        return None
    value = int(text)
    return value if MIN_PRICE <= value <= MAX_PRICE else None


async def add_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    price = parse_price(update.message.text)
    if price is None:
        await update.message.reply_text(f"Lütfen {MIN_PRICE} ile {MAX_PRICE} arasında bir sayı yazın.")
        return ADD_PRICE
    photos = context.user_data.pop("new_photos", [])
    title = context.user_data.pop("new_title", "İçerik")
    cur = db.execute(
        "INSERT INTO items(title, price, created_at) VALUES(?,?,?)", (title, price, int(time.time()))
    )
    item_id = cur.lastrowid
    db.executemany(
        "INSERT INTO item_photos(item_id, file_id, pos) VALUES(?,?,?)",
        [(item_id, fid, i) for i, fid in enumerate(photos)],
    )
    db.commit()
    await update.message.reply_text(
        f"✅ “{title}” eklendi ({len(photos)} foto, ⭐{price}). Galeride yayında!",
        reply_markup=InlineKeyboardMarkup(
            [
                [InlineKeyboardButton("📢 Takipçilere duyur", callback_data=f"a:announce:{item_id}")],
                [InlineKeyboardButton("➕ Bir tane daha ekle", callback_data="a:add")],
                back_btn(),
            ]
        ),
    )
    return ConversationHandler.END


async def edit_name(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    set_setting("name", update.message.text.strip()[:40])
    await update.message.reply_text("✅ İsim güncellendi.", reply_markup=InlineKeyboardMarkup([back_btn()]))
    return ConversationHandler.END


async def edit_bio(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    set_setting("bio", update.message.text.strip()[:700])
    await update.message.reply_text("✅ Biyografi güncellendi.", reply_markup=InlineKeyboardMarkup([back_btn()]))
    return ConversationHandler.END


async def edit_cover(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    set_setting("cover", update.message.photo[-1].file_id)
    await update.message.reply_text(
        "✅ Kapak fotoğrafı güncellendi.",
        reply_markup=InlineKeyboardMarkup(
            [[InlineKeyboardButton("👁 Önizle", callback_data="u:profile")], back_btn()]
        ),
    )
    return ConversationHandler.END


async def edit_price(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    price = parse_price(update.message.text)
    if price is None:
        await update.message.reply_text(f"Lütfen {MIN_PRICE} ile {MAX_PRICE} arasında bir sayı yazın.")
        return EDIT_PRICE
    iid = context.user_data.pop("price_item", None)
    db.execute("UPDATE items SET price=? WHERE id=?", (price, iid))
    db.commit()
    await update.message.reply_text(
        f"✅ Yeni fiyat: ⭐{price}",
        reply_markup=InlineKeyboardMarkup([[InlineKeyboardButton("⬅️ İçerik", callback_data=f"a:item:{iid}")]]),
    )
    return ConversationHandler.END


async def bcast_text(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    text = update.message.text.strip()
    context.user_data["bcast_text"] = text
    n = db.execute("SELECT COUNT(*) FROM users WHERE notify=1 AND id != ?", (ADMIN_ID,)).fetchone()[0]
    await update.message.reply_text(
        f"Önizleme:\n\n{text}\n\n👥 {n} kişiye gönderilecek. Onaylıyor musunuz?",
        reply_markup=InlineKeyboardMarkup(
            [[
                InlineKeyboardButton("✅ Gönder", callback_data="a:bcastok"),
                InlineKeyboardButton("❌ İptal", callback_data="a:bcastno"),
            ]]
        ),
    )
    return ConversationHandler.END


async def conv_cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    for k in ("new_photos", "new_title", "price_item"):
        context.user_data.pop(k, None)
    if update.callback_query:
        await update.callback_query.answer()
    await update.effective_message.reply_text(
        "İşlem iptal edildi.", reply_markup=InlineKeyboardMarkup([back_btn()])
    )
    return ConversationHandler.END


async def wrong_input(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.effective_message.reply_text("Beklenen bu değildi. Tekrar deneyin ya da ❌ İptal'e basın.")


async def cevap(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not is_admin(update):
        return
    if len(context.args) < 2 or not context.args[0].isdigit():
        await update.message.reply_text("Kullanım: /cevap <kullanıcı_id> mesaj")
        return
    try:
        await context.bot.send_message(int(context.args[0]), "🛟 Destek: " + " ".join(context.args[1:]))
        await update.message.reply_text("✅ Gönderildi.")
    except TelegramError as e:
        await update.message.reply_text(f"Gönderilemedi: {e.message}")


# ==========================================================================
# Kurulum
# ==========================================================================
async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.error("Hata oluştu", exc_info=context.error)


async def post_init(app: Application) -> None:
    await app.bot.set_my_commands(
        [
            BotCommand("start", "Profil ve galeri"),
            BotCommand("destek", "Ödeme / destek"),
            BotCommand("bildirim", "Yeni içerik bildirimlerini aç/kapat"),
        ]
    )
    if ADMIN_ID:
        try:
            await app.bot.set_my_commands(
                [
                    BotCommand("start", "Profil ve galeri"),
                    BotCommand("admin", "Yönetici paneli"),
                    BotCommand("cevap", "Destek mesajına cevap ver"),
                ],
                scope=BotCommandScopeChat(ADMIN_ID),
            )
        except TelegramError:
            log.warning("Yönetici komutları ayarlanamadı (önce bota /start yazın).")


def build_app(token: str) -> Application:
    app = Application.builder().token(token).post_init(post_init).build()
    admin_only = filters.User(user_id=ADMIN_ID) & filters.ChatType.PRIVATE
    cancel = [
        CallbackQueryHandler(conv_cancel, pattern=r"^a:cancel$"),
        CommandHandler("iptal", conv_cancel),
    ]

    conv = ConversationHandler(
        entry_points=[
            CallbackQueryHandler(conv_entry, pattern=r"^a:(add|ename|ebio|ecover|bcast|price:\d+)$")
        ],
        states={
            ADD_PHOTOS: [
                MessageHandler(admin_only & filters.PHOTO, add_photo),
                CallbackQueryHandler(photos_done, pattern=r"^a:photosdone$"),
            ],
            ADD_TITLE: [MessageHandler(admin_only & filters.TEXT & ~filters.COMMAND, add_title)],
            ADD_PRICE: [MessageHandler(admin_only & filters.TEXT & ~filters.COMMAND, add_price)],
            EDIT_NAME: [MessageHandler(admin_only & filters.TEXT & ~filters.COMMAND, edit_name)],
            EDIT_BIO: [MessageHandler(admin_only & filters.TEXT & ~filters.COMMAND, edit_bio)],
            EDIT_COVER: [MessageHandler(admin_only & filters.PHOTO, edit_cover)],
            EDIT_PRICE: [MessageHandler(admin_only & filters.TEXT & ~filters.COMMAND, edit_price)],
            BCAST_TEXT: [MessageHandler(admin_only & filters.TEXT & ~filters.COMMAND, bcast_text)],
        },
        fallbacks=cancel + [MessageHandler(admin_only & ~filters.COMMAND, wrong_input)],
        allow_reentry=True,
    )

    app.add_handler(conv)
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler(["destek", "paysupport"], destek))
    app.add_handler(CommandHandler("bildirim", bildirim))
    app.add_handler(CommandHandler("admin", admin, filters=admin_only))
    app.add_handler(CommandHandler("cevap", cevap, filters=admin_only))
    app.add_handler(CallbackQueryHandler(admin_callback, pattern=r"^a:"))
    app.add_handler(CallbackQueryHandler(user_callback, pattern=r"^u:"))
    app.add_handler(PaidMediaPurchasedHandler(on_purchase))
    app.add_error_handler(on_error)
    return app


def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN bulunamadı. .env dosyasını doldurun (bkz. .env.example).")
    if not ADMIN_ID:
        log.warning("ADMIN_ID ayarlı değil, yönetici paneli kapalı. .env dosyasına ekleyin.")
    app = build_app(BOT_TOKEN)
    log.info("Bot çalışıyor... Durdurmak için Ctrl+C")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
