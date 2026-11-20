"""Fotoğraf Satış Botu - Telegram Mini Uygulaması + Telegram Stars.

- Bot ve mini uygulama sunucusu aynı süreçte çalışır (Railway için tek servis).
- Alıcılar mini uygulamada profili ve bulanık önizlemeleri görür, Stars ile satın alır.
- Yönetim sekmesi sadece ADMIN_ID'ye görünür. Her istek Telegram imzasıyla
  (initData) sunucuda doğrulanır, yani yetki tarayıcıya bırakılmaz.

Ayarlar ortam değişkenlerinden okunur (bkz. .env.example). Token koda yazılmaz.
"""

import asyncio
import hashlib
import hmac
import io
import json
import logging
import os
import re
import sqlite3
import time
import uuid
from pathlib import Path
from urllib.parse import parse_qsl

from aiohttp import web
from dotenv import load_dotenv
from PIL import Image, ImageFilter, ImageOps, UnidentifiedImageError
from telegram import (
    BotCommand,
    BotCommandScopeChat,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    MenuButtonWebApp,
    Update,
    WebAppInfo,
)
from telegram.error import Forbidden, RetryAfter, TelegramError
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    PreCheckoutQueryHandler,
    filters,
)

load_dotenv()
logging.basicConfig(format="%(asctime)s - %(name)s - %(levelname)s - %(message)s", level=logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
log = logging.getLogger("foto-bot")

BOT_TOKEN = os.getenv("BOT_TOKEN", "").strip()
ADMIN_ID = int(os.getenv("ADMIN_ID", "0") or 0)
DB_PATH = os.getenv("DB_PATH", "bot.db")
PORT = int(os.getenv("PORT", "8080"))
_domain = os.getenv("RAILWAY_PUBLIC_DOMAIN", "").strip()
WEBAPP_URL = os.getenv("WEBAPP_URL", "").strip() or (f"https://{_domain}/" if _domain else "")

DATA_DIR = Path(DB_PATH).resolve().parent
MEDIA_DIR = DATA_DIR / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)
WEBAPP_FILE = Path(__file__).resolve().parent / "webapp" / "index.html"

MIN_PRICE, MAX_PRICE = 1, 2500
MAX_PHOTOS = 10  # bir içerikteki en fazla medya (foto + video)
MAX_VIDEO_MB = int(os.getenv("MAX_VIDEO_MB", "300"))
VIDEO_EXT = {"mp4", "mov", "m4v", "webm"}
VIDEO_TYPES = {"video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v"}
MEDIA_LINK_HOURS = 6  # satın alınan medyanın imzalı bağlantısı bu kadar saat geçerli
ID_RE = re.compile(r"^[0-9a-f]{32}$")
FILE_RE = re.compile(r"^([0-9a-f]{32})\.(jpg|mp4|mov|m4v|webm)$")

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
    CREATE TABLE IF NOT EXISTS photos (
        id TEXT PRIMARY KEY,
        item_id INTEGER NOT NULL,
        pos INTEGER NOT NULL,
        preview_file_id TEXT
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
        charge_id TEXT,
        at INTEGER NOT NULL
    );
    """
)
db.execute("CREATE TABLE IF NOT EXISTS likes (user_id INTEGER, item_id INTEGER, PRIMARY KEY(user_id, item_id))")
if "category" not in {r[1] for r in db.execute("PRAGMA table_info(items)")}:
    db.execute("ALTER TABLE items ADD COLUMN category TEXT NOT NULL DEFAULT ''")
_photo_cols = {r[1] for r in db.execute("PRAGMA table_info(photos)")}
for col, ddl in (("kind", "TEXT NOT NULL DEFAULT 'photo'"), ("ext", "TEXT NOT NULL DEFAULT 'jpg'"),
                 ("duration", "INTEGER NOT NULL DEFAULT 0")):
    if col not in _photo_cols:
        db.execute(f"ALTER TABLE photos ADD COLUMN {col} {ddl}")
db.commit()

DEFAULTS = {
    "name": "Profil",
    "handle": "",
    "tagline": "Özel içerikler seni bekliyor...",
    "bio": "Galerime hoş geldin! Beğendiğin içeriği Telegram Stars ile aç. ✨",
    "cover": "",
    "avatar": "",
}


def get_setting(key: str) -> str:
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else DEFAULTS.get(key, "")


def set_setting(key: str, value: str) -> None:
    db.execute("INSERT OR REPLACE INTO settings(key, value) VALUES(?, ?)", (key, value))
    db.commit()


def save_user(uid: int, first_name: str | None, username: str | None) -> None:
    db.execute(
        "INSERT INTO users(id, first_name, username, joined_at) VALUES(?,?,?,?) "
        "ON CONFLICT(id) DO UPDATE SET first_name=excluded.first_name, username=excluded.username",
        (uid, first_name, username, int(time.time())),
    )
    db.commit()


def get_item(item_id: int):
    return db.execute("SELECT * FROM items WHERE id=?", (item_id,)).fetchone()


def photo_ids(item_id: int) -> list[str]:
    return [r["id"] for r in db.execute("SELECT id FROM photos WHERE item_id=? ORDER BY pos", (item_id,))]


def media_summary(item_id: int) -> str:
    rows = media_rows(item_id)
    n_v = sum(1 for r in rows if r["kind"] == "video")
    n_p = len(rows) - n_v
    return " • ".join(([f"{n_p} fotoğraf"] if n_p else []) + ([f"{n_v} video"] if n_v else []))


def media_rows(item_id: int):
    return db.execute("SELECT * FROM photos WHERE item_id=? ORDER BY pos", (item_id,)).fetchall()


def can_view(user_id: int, item) -> bool:
    if user_id == ADMIN_ID:
        return True
    if not item["active"]:
        return False
    return item["price"] == 0 or has_bought(user_id, item["id"])


def _media_key() -> bytes:
    return hmac.new(b"media-link", BOT_TOKEN.encode(), hashlib.sha256).digest()


def media_sig(name: str, uid: int, exp: int) -> str:
    return hmac.new(_media_key(), f"{name}:{uid}:{exp}".encode(), hashlib.sha256).hexdigest()[:32]


def media_link(name: str, uid: int) -> str:
    # Süre saat başına yuvarlanır, böylece aynı saat içinde bağlantı değişmez ve tarayıcı önbelleği çalışır.
    exp = (int(time.time()) // 3600 + MEDIA_LINK_HOURS + 1) * 3600
    return f"/media/f/{name}?u={uid}&e={exp}&s={media_sig(name, uid, exp)}"


def has_bought(user_id: int, item_id: int) -> bool:
    return db.execute(
        "SELECT 1 FROM purchases WHERE user_id=? AND item_id=? LIMIT 1", (user_id, item_id)
    ).fetchone() is not None


# ==========================================================================
# Görsel işleme
# ==========================================================================
def _process_photo(data: bytes, pid: str) -> None:
    """Orijinali (en fazla 2048px) ve bulanık önizlemeyi diske yazar."""
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    full = img.copy()
    full.thumbnail((2048, 2048))
    full.save(MEDIA_DIR / f"{pid}.jpg", "JPEG", quality=88)
    prev = img.copy()
    prev.thumbnail((480, 480))
    prev = prev.filter(ImageFilter.GaussianBlur(radius=max(prev.size) / 14))
    prev.save(MEDIA_DIR / f"{pid}_p.jpg", "JPEG", quality=70)


def _process_cover(data: bytes, name: str) -> None:
    img = ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")
    img.thumbnail((1200, 1200))
    img.save(MEDIA_DIR / f"{name}.jpg", "JPEG", quality=88)


def _placeholder_poster() -> bytes:
    """Videonun kapak karesi alınamazsa kullanılan sade kapak."""
    from PIL import ImageDraw
    img = Image.new("RGB", (720, 960))
    d = ImageDraw.Draw(img)
    for y in range(960):
        t = y / 960
        d.line([(0, y), (720, y)], fill=(int(90 - 60 * t), int(20 + 5 * t), int(110 - 50 * t)))
    d.polygon([(300, 400), (300, 560), (440, 480)], fill=(255, 255, 255))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=80)
    return buf.getvalue()


def delete_photo_files(pid: str) -> None:
    for path in MEDIA_DIR.glob(f"{pid}*"):
        path.unlink(missing_ok=True)


# ==========================================================================
# Telegram initData doğrulama (mini uygulama istekleri için)
# ==========================================================================
def check_init_data(init_data: str):
    try:
        parsed = dict(parse_qsl(init_data, keep_blank_values=True, strict_parsing=True))
    except ValueError:
        return None
    received = parsed.pop("hash", None)
    if not received or "user" not in parsed:
        return None
    check_string = "\n".join(f"{k}={v}" for k, v in sorted(parsed.items()))
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check_string.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, received):
        return None
    if time.time() - int(parsed.get("auth_date", "0")) > 86400:
        return None
    return json.loads(parsed["user"])


def auth(admin: bool = False):
    def deco(handler):
        async def wrapper(request: web.Request):
            user = check_init_data(request.headers.get("X-Init-Data", ""))
            if not user:
                return web.json_response({"error": "Telegram üzerinden açın."}, status=401)
            if admin and user["id"] != ADMIN_ID:
                return web.json_response({"error": "Yetkiniz yok."}, status=403)
            request["user"] = user
            return await handler(request)
        return wrapper
    return deco


def valid_price(price: int) -> bool:
    return price == 0 or MIN_PRICE <= price <= MAX_PRICE


def err(msg: str, status: int = 400):
    return web.json_response({"error": msg}, status=status)


# ==========================================================================
# Mini uygulama API'si - alıcı
# ==========================================================================
def item_json(row, user_id: int, admin: bool) -> dict:
    rows = media_rows(row["id"])
    bought = has_bought(user_id, row["id"])
    free = row["price"] == 0
    unlocked = bought or admin or free
    media = []
    for m in rows:
        entry = {"id": m["id"], "kind": m["kind"], "duration": m["duration"], "preview": f"/media/p/{m['id']}.jpg"}
        if unlocked:
            entry["thumb"] = media_link(f"{m['id']}.jpg", user_id)
            entry["src"] = media_link(f"{m['id']}.{m['ext']}", user_id)
        media.append(entry)
    data = {
        "id": row["id"],
        "title": row["title"],
        "category": row["category"],
        "price": row["price"],
        "free": free,
        "count": len(rows),
        "n_photos": sum(1 for m in rows if m["kind"] == "photo"),
        "n_videos": sum(1 for m in rows if m["kind"] == "video"),
        "bought": bought,
        "unlocked": unlocked,
        "created_at": row["created_at"],
        "likes": db.execute("SELECT COUNT(*) FROM likes WHERE item_id=?", (row["id"],)).fetchone()[0],
        "liked": db.execute(
            "SELECT 1 FROM likes WHERE item_id=? AND user_id=?", (row["id"], user_id)
        ).fetchone() is not None,
        "photos": media,
    }
    if admin:
        data["active"] = bool(row["active"])
        s = db.execute(
            "SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases WHERE item_id=?", (row["id"],)
        ).fetchone()
        data["sales"], data["earned"] = s[0], s[1]
    return data


@auth()
async def api_me(request: web.Request):
    u = request["user"]
    save_user(u["id"], u.get("first_name"), u.get("username"))
    admin = u["id"] == ADMIN_ID
    q = "SELECT * FROM items ORDER BY id DESC" if admin else "SELECT * FROM items WHERE active=1 ORDER BY id DESC"
    items = [item_json(r, u["id"], admin) for r in db.execute(q).fetchall()]
    if not admin:
        items = [i for i in items if i["count"] > 0]
    cover, avatar = get_setting("cover"), get_setting("avatar")
    return web.json_response(
        {
            "is_admin": admin,
            "user": {"id": u["id"], "first_name": u.get("first_name", "")},
            "profile": {
                "name": get_setting("name"),
                "handle": get_setting("handle"),
                "tagline": get_setting("tagline"),
                "bio": get_setting("bio"),
                "cover": f"/media/c/{cover}.jpg" if cover else "",
                "avatar": f"/media/c/{avatar}.jpg" if avatar else "",
            },
            "items": items,
        }
    )


async def media_full(request: web.Request):
    """Satın alınmış (veya ücretsiz) foto/videoyu imzalı bağlantıyla verir. Video ileri sarma (Range) destekler."""
    name = request.match_info["name"]
    m = FILE_RE.match(name)
    q = request.query
    try:
        uid, exp = int(q.get("u", "")), int(q.get("e", ""))
    except ValueError:
        raise web.HTTPForbidden()
    if not m or exp < time.time() or not hmac.compare_digest(media_sig(name, uid, exp), q.get("s", "")):
        raise web.HTTPForbidden()
    row = db.execute("SELECT item_id FROM photos WHERE id=?", (m.group(1),)).fetchone()
    item = get_item(row["item_id"]) if row else None
    path = MEDIA_DIR / name
    if not item or not can_view(uid, item) or not path.exists():
        raise web.HTTPForbidden()
    return web.FileResponse(path, headers={"Cache-Control": "private, max-age=3600"})


@auth()
async def api_buy(request: web.Request):
    uid = request["user"]["id"]
    body = await request.json()
    item = get_item(int(body.get("item_id", 0)))
    if not item or not item["active"]:
        return err("Bu içerik artık mevcut değil.", 404)
    if item["price"] == 0 or has_bought(uid, item["id"]):
        return web.json_response({"bought": True})
    bot = request.app["tg"].bot
    link = await bot.create_invoice_link(
        title=item["title"][:32],
        description=f"{media_summary(item['id'])} • {get_setting('name')}"[:255],
        payload=f"item:{item['id']}:{uid}",
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(item["title"][:32], item["price"])],
    )
    return web.json_response({"link": link})


@auth()
async def api_like(request: web.Request):
    uid, iid = request["user"]["id"], int(request.match_info["iid"])
    item = get_item(iid)
    if not item or not item["active"]:
        return err("Bulunamadı.", 404)
    if db.execute("SELECT 1 FROM likes WHERE user_id=? AND item_id=?", (uid, iid)).fetchone():
        db.execute("DELETE FROM likes WHERE user_id=? AND item_id=?", (uid, iid))
        liked = False
    else:
        db.execute("INSERT INTO likes(user_id, item_id) VALUES(?,?)", (uid, iid))
        liked = True
    db.commit()
    count = db.execute("SELECT COUNT(*) FROM likes WHERE item_id=?", (iid,)).fetchone()[0]
    return web.json_response({"liked": liked, "likes": count})


async def media_preview(request: web.Request):
    pid = request.match_info["pid"]
    path = MEDIA_DIR / f"{pid}_p.jpg"
    if not ID_RE.match(pid) or not path.exists():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


async def media_cover(request: web.Request):
    name = request.match_info["name"]
    path = MEDIA_DIR / f"{name}.jpg"
    if not re.match(r"^(cover|avatar)_[0-9a-f]{32}$", name) or not path.exists():
        raise web.HTTPNotFound()
    return web.FileResponse(path, headers={"Cache-Control": "public, max-age=86400"})


async def index(request: web.Request):
    return web.FileResponse(WEBAPP_FILE, headers={"Cache-Control": "no-cache"})


# ==========================================================================
# Mini uygulama API'si - yönetim (sadece ADMIN_ID)
# ==========================================================================
@auth(admin=True)
async def admin_stats(request: web.Request):
    total = db.execute("SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases").fetchone()
    today = db.execute(
        "SELECT COUNT(*), COALESCE(SUM(stars),0) FROM purchases WHERE at>=?", (int(time.time()) - 86400,)
    ).fetchone()
    recent = db.execute(
        "SELECT p.stars, p.at, i.title, u.first_name, u.username FROM purchases p "
        "LEFT JOIN items i ON i.id=p.item_id LEFT JOIN users u ON u.id=p.user_id "
        "ORDER BY p.id DESC LIMIT 10"
    ).fetchall()
    return web.json_response(
        {
            "users": db.execute("SELECT COUNT(*) FROM users").fetchone()[0],
            "buyers": db.execute("SELECT COUNT(DISTINCT user_id) FROM purchases").fetchone()[0],
            "sales": total[0], "stars": total[1],
            "sales_24h": today[0], "stars_24h": today[1],
            "recent": [
                {
                    "stars": r["stars"], "at": r["at"], "title": r["title"] or "(silinmiş)",
                    "buyer": ("@" + r["username"]) if r["username"] else (r["first_name"] or "?"),
                }
                for r in recent
            ],
        }
    )


async def _read_multipart(request: web.Request) -> tuple[dict, dict[str, list[bytes]]]:
    fields, files = {}, {}
    reader = await request.multipart()
    async for part in reader:
        if part.filename:
            data = await part.read(decode=False)
            if data:
                files.setdefault(part.name, []).append(bytes(data))
        else:
            fields[part.name] = await part.text()
    return fields, files


@auth(admin=True)
async def admin_profile(request: web.Request):
    fields, files = await _read_multipart(request)
    if "name" in fields:
        set_setting("name", fields["name"].strip()[:40] or DEFAULTS["name"])
    if "handle" in fields:
        set_setting("handle", fields["handle"].strip().lstrip("@")[:32])
    if "tagline" in fields:
        set_setting("tagline", fields["tagline"].strip()[:60])
    if "bio" in fields:
        set_setting("bio", fields["bio"].strip()[:700])
    for kind in ("cover", "avatar"):
        if not files.get(kind):
            continue
        name = f"{kind}_{uuid.uuid4().hex}"
        try:
            await asyncio.to_thread(_process_cover, files[kind][0], name)
        except (UnidentifiedImageError, OSError):
            return err("Fotoğraf okunamadı. JPG veya PNG deneyin.")
        old = get_setting(kind)
        set_setting(kind, name)
        if old:
            (MEDIA_DIR / f"{old}.jpg").unlink(missing_ok=True)
    return web.json_response({"ok": True})


async def _read_item_upload(request: web.Request) -> tuple[dict, list[dict]]:
    """Formu okur. Videolar belleğe alınmadan doğrudan diske yazılır.
    Her videonun ardından istemci 'poster' (kapak karesi) ve 'duration' alanlarını gönderir."""
    fields, media = {}, []
    reader = await request.multipart()
    try:
        async for part in reader:
            if part.name in ("media", "photos") and part.filename:
                ext = Path(part.filename).suffix.lower().lstrip(".")
                ctype = (part.headers.get("Content-Type") or "").lower()
                if ctype.startswith("video/") or ext in VIDEO_EXT:
                    if ext not in VIDEO_EXT:
                        ext = VIDEO_TYPES.get(ctype, "mp4")
                    pid = uuid.uuid4().hex
                    entry = {"pid": pid, "kind": "video", "ext": ext, "duration": 0, "poster": None}
                    media.append(entry)
                    size, limit = 0, MAX_VIDEO_MB * 1024 * 1024
                    with open(MEDIA_DIR / f"{pid}.{ext}", "wb") as f:
                        while chunk := await part.read_chunk(1024 * 1024):
                            size += len(chunk)
                            if size > limit:
                                raise ValueError(f"Video en fazla {MAX_VIDEO_MB} MB olabilir.")
                            f.write(chunk)
                else:
                    data = await part.read(decode=False)
                    if data:
                        media.append({"pid": uuid.uuid4().hex, "kind": "photo", "ext": "jpg", "data": bytes(data)})
            elif part.name == "poster" and part.filename:
                data = await part.read(decode=False)
                if media and media[-1]["kind"] == "video" and data:
                    media[-1]["poster"] = bytes(data)
            elif part.name == "duration":
                text = await part.text()
                if media and media[-1]["kind"] == "video":
                    try:
                        media[-1]["duration"] = max(0, min(int(float(text)), 24 * 3600))
                    except ValueError:
                        pass
            else:
                fields[part.name] = await part.text()
    except BaseException:
        for m in media:
            delete_photo_files(m["pid"])
        raise
    return fields, media


@auth(admin=True)
async def admin_create_item(request: web.Request):
    try:
        fields, media = await _read_item_upload(request)
    except ValueError as e:
        return err(str(e))

    def fail(msg):
        for m in media:
            delete_photo_files(m["pid"])
        return err(msg)

    title = fields.get("title", "").strip()[:60]
    category = fields.get("category", "").strip()[:24]
    try:
        price = int(fields.get("price", ""))
    except ValueError:
        price = -1
    if not title:
        return fail("Başlık yazın.")
    if not valid_price(price):
        return fail(f"Fiyat 0 (ücretsiz) ya da {MIN_PRICE}–{MAX_PRICE} Stars olmalı.")
    if not 1 <= len(media) <= MAX_PHOTOS:
        return fail(f"1–{MAX_PHOTOS} fotoğraf/video seçin.")
    for m in media:
        try:
            if m["kind"] == "photo":
                await asyncio.to_thread(_process_photo, m["data"], m["pid"])
            else:
                try:
                    await asyncio.to_thread(_process_photo, m["poster"] or _placeholder_poster(), m["pid"])
                except (UnidentifiedImageError, OSError):
                    await asyncio.to_thread(_process_photo, _placeholder_poster(), m["pid"])
        except (UnidentifiedImageError, OSError):
            return fail("Fotoğraflardan biri okunamadı. JPG veya PNG deneyin.")
    cur = db.execute(
        "INSERT INTO items(title, price, category, created_at) VALUES(?,?,?,?)",
        (title, price, category, int(time.time())),
    )
    db.executemany(
        "INSERT INTO photos(id, item_id, pos, kind, ext, duration) VALUES(?,?,?,?,?,?)",
        [(m["pid"], cur.lastrowid, i, m["kind"], m["ext"], m.get("duration", 0)) for i, m in enumerate(media)],
    )
    db.commit()
    return web.json_response({"ok": True, "id": cur.lastrowid})


@auth(admin=True)
async def admin_update_item(request: web.Request):
    iid = int(request.match_info["iid"])
    if not get_item(iid):
        return err("Bulunamadı.", 404)
    body = await request.json()
    if "price" in body:
        try:
            price = int(body["price"])
        except (TypeError, ValueError):
            price = -1
        if not valid_price(price):
            return err(f"Fiyat 0 (ücretsiz) ya da {MIN_PRICE}–{MAX_PRICE} Stars olmalı.")
        db.execute("UPDATE items SET price=? WHERE id=?", (price, iid))
    if "category" in body:
        db.execute("UPDATE items SET category=? WHERE id=?", (str(body["category"]).strip()[:24], iid))
    if "title" in body and str(body["title"]).strip():
        db.execute("UPDATE items SET title=? WHERE id=?", (str(body["title"]).strip()[:60], iid))
    if "active" in body:
        db.execute("UPDATE items SET active=? WHERE id=?", (1 if body["active"] else 0, iid))
    db.commit()
    return web.json_response({"ok": True})


@auth(admin=True)
async def admin_delete_item(request: web.Request):
    iid = int(request.match_info["iid"])
    for pid in photo_ids(iid):
        delete_photo_files(pid)
    db.execute("DELETE FROM photos WHERE item_id=?", (iid,))
    db.execute("DELETE FROM likes WHERE item_id=?", (iid,))
    db.execute("DELETE FROM items WHERE id=?", (iid,))
    db.commit()
    return web.json_response({"ok": True})


@auth(admin=True)
async def admin_announce(request: web.Request):
    item = get_item(int(request.match_info["iid"]))
    if not item or not item["active"] or not photo_ids(item["id"]):
        return err("Sadece yayındaki içerikler duyurulabilir.")
    request.app["tg"].create_task(announce_item(request.app["tg"], item["id"]))
    return web.json_response({"ok": True, "targets": notify_count()})


@auth(admin=True)
async def admin_broadcast(request: web.Request):
    text = str((await request.json()).get("text", "")).strip()[:3500]
    if not text:
        return err("Duyuru metni boş.")
    request.app["tg"].create_task(broadcast_text(request.app["tg"], text))
    return web.json_response({"ok": True, "targets": notify_count()})


def build_web(tg_app: Application) -> web.Application:
    app = web.Application(client_max_size=(MAX_VIDEO_MB * MAX_PHOTOS + 50) * 1024 * 1024)
    app["tg"] = tg_app
    app.router.add_get("/", index)
    app.router.add_get("/api/me", api_me)
    app.router.add_get("/media/f/{name}", media_full)
    app.router.add_post("/api/buy", api_buy)
    app.router.add_post("/api/like/{iid:\\d+}", api_like)
    app.router.add_get("/media/p/{pid}.jpg", media_preview)
    app.router.add_get("/media/c/{name}.jpg", media_cover)
    app.router.add_get("/api/admin/stats", admin_stats)
    app.router.add_post("/api/admin/profile", admin_profile)
    app.router.add_post("/api/admin/items", admin_create_item)
    app.router.add_post("/api/admin/items/{iid:\\d+}", admin_update_item)
    app.router.add_delete("/api/admin/items/{iid:\\d+}", admin_delete_item)
    app.router.add_post("/api/admin/items/{iid:\\d+}/announce", admin_announce)
    app.router.add_post("/api/admin/broadcast", admin_broadcast)
    return app


# ==========================================================================
# Duyurular
# ==========================================================================
def notify_count() -> int:
    return db.execute("SELECT COUNT(*) FROM users WHERE notify=1 AND id != ?", (ADMIN_ID,)).fetchone()[0]


def open_button(text: str, fragment: str = "") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup([[InlineKeyboardButton(text, web_app=WebAppInfo(url=WEBAPP_URL + fragment))]])


async def _send_to_all(send) -> tuple[int, int]:
    users = db.execute("SELECT id FROM users WHERE notify=1 AND id != ?", (ADMIN_ID,)).fetchall()
    ok = fail = 0
    for row in users:
        for _ in range(2):
            try:
                await send(row["id"])
                ok += 1
                break
            except RetryAfter as e:
                await asyncio.sleep(e.retry_after + 1)
            except Forbidden:
                db.execute("UPDATE users SET notify=0 WHERE id=?", (row["id"],))
                db.commit()
                fail += 1
                break
            except TelegramError:
                fail += 1
                break
        await asyncio.sleep(0.05)
    return ok, fail


async def announce_item(tg: Application, item_id: int) -> None:
    item = get_item(item_id)
    first = db.execute("SELECT * FROM photos WHERE item_id=? ORDER BY pos LIMIT 1", (item_id,)).fetchone()
    rows = media_rows(item_id)
    n_p = sum(1 for r in rows if r["kind"] == "photo")
    n_v = len(rows) - n_p
    parts = ([f"📸 {n_p} fotoğraf"] if n_p else []) + ([f"🎬 {n_v} video"] if n_v else [])
    caption = (
        f"🆕 Yeni içerik: {item['title']}\n{' • '.join(parts)} • "
        f"{'🎁 Ücretsiz' if item['price'] == 0 else '⭐ ' + str(item['price'])}\n\n"
        f"Bildirimleri kapatmak için /bildirim"
    )
    state = {"file_id": first["preview_file_id"]}

    async def send(uid):
        photo = state["file_id"] or (MEDIA_DIR / f"{first['id']}_p.jpg").read_bytes()
        msg = await tg.bot.send_photo(uid, photo, caption=caption, reply_markup=open_button("🔓 Galeride aç", f"#item-{item_id}"))
        if not state["file_id"]:
            state["file_id"] = msg.photo[-1].file_id
            db.execute("UPDATE photos SET preview_file_id=? WHERE id=?", (state["file_id"], first["id"]))
            db.commit()

    ok, fail = await _send_to_all(send)
    await tg.bot.send_message(ADMIN_ID, f"📢 Duyuru bitti: {ok} kişiye gitti, {fail} başarısız.")


async def broadcast_text(tg: Application, text: str) -> None:
    async def send(uid):
        await tg.bot.send_message(
            uid, text + "\n\n(Bildirimleri kapatmak için /bildirim)", reply_markup=open_button("✨ Profili aç")
        )

    ok, fail = await _send_to_all(send)
    await tg.bot.send_message(ADMIN_ID, f"📢 Duyuru bitti: {ok} kişiye gitti, {fail} başarısız.")


# ==========================================================================
# Bot komutları ve ödeme
# ==========================================================================
async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    u = update.effective_user
    save_user(u.id, u.first_name, u.username)
    if not WEBAPP_URL:
        await update.message.reply_text(
            "Mini uygulama adresi ayarlı değil. Railway'de Settings → Networking → Generate Domain yapın."
        )
        return
    text = f"✨ {get_setting('name')}\n\n{get_setting('bio')}\n\nAşağıdaki butona bas, galeriyi aç 👇"
    cover = get_setting("cover")
    kb = open_button("✨ Profili aç")
    if cover:
        await update.message.reply_photo((MEDIA_DIR / f"{cover}.jpg").read_bytes(), caption=text, reply_markup=kb)
    else:
        await update.message.reply_text(text, reply_markup=kb)
    if u.id == ADMIN_ID:
        await update.message.reply_text("👑 Yönetim için /admin yazın.")


async def admin_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not WEBAPP_URL:
        await update.message.reply_text("Önce Railway'de domain oluşturun (Settings → Networking → Generate Domain).")
        return
    await update.message.reply_text("👑 Yönetim paneli", reply_markup=open_button("⚙️ Paneli aç", "#admin"))


async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    q = update.pre_checkout_query
    try:
        _, iid, uid = q.invoice_payload.split(":")
        item = get_item(int(iid))
    except ValueError:
        item = None
    if not item or not item["active"] or item["price"] == 0:
        await q.answer(ok=False, error_message="Bu içerik artık mevcut değil.")
    elif int(uid) != q.from_user.id or q.total_amount != item["price"] or q.currency != "XTR":
        await q.answer(ok=False, error_message="Fiyat değişti, lütfen tekrar deneyin.")
    elif has_bought(q.from_user.id, item["id"]):
        await q.answer(ok=False, error_message="Bu içeriği zaten satın aldın.")
    else:
        await q.answer(ok=True)


async def successful_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    pay = update.message.successful_payment
    u = update.effective_user
    _, iid, _ = pay.invoice_payload.split(":")
    item = get_item(int(iid))
    db.execute(
        "INSERT INTO purchases(user_id, item_id, stars, charge_id, at) VALUES(?,?,?,?,?)",
        (u.id, int(iid), pay.total_amount, pay.telegram_payment_charge_id, int(time.time())),
    )
    db.commit()
    title = item["title"] if item else "İçerik"
    await update.message.reply_text(
        f"💖 Teşekkürler! “{title}” açıldı.", reply_markup=open_button("🖼 Görüntüle", f"#item-{iid}")
    )
    if ADMIN_ID:
        who = f"@{u.username}" if u.username else u.first_name
        await context.bot.send_message(
            ADMIN_ID,
            f"💰 Yeni satış!\n{who} → “{title}” • ⭐ {pay.total_amount}\n"
            f"İade gerekirse: /iade {u.id} {pay.telegram_payment_charge_id}",
        )


async def destek(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    u = update.effective_user
    save_user(u.id, u.first_name, u.username)
    text = " ".join(context.args).strip()
    if not text:
        await update.message.reply_text(
            "🛟 Destek\nMesajınızı komutla birlikte yazın, örnek:\n/destek Ödeme yaptım ama fotoğraf açılmadı"
        )
        return
    if ADMIN_ID:
        await context.bot.send_message(
            ADMIN_ID,
            f"🛟 Destek mesajı\nKimden: {u.first_name} (@{u.username or '-'}) id: {u.id}\n\n{text}\n\n"
            f"Cevaplamak için: /cevap {u.id} mesajınız",
        )
    await update.message.reply_text("✅ Mesajın iletildi, en kısa sürede dönüş yapılacak.")


async def cevap(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if len(context.args) < 2 or not context.args[0].isdigit():
        await update.message.reply_text("Kullanım: /cevap <kullanıcı_id> mesaj")
        return
    try:
        await context.bot.send_message(int(context.args[0]), "🛟 Destek: " + " ".join(context.args[1:]))
        await update.message.reply_text("✅ Gönderildi.")
    except TelegramError as e:
        await update.message.reply_text(f"Gönderilemedi: {e.message}")


async def iade(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if len(context.args) != 2 or not context.args[0].isdigit():
        await update.message.reply_text("Kullanım: /iade <kullanıcı_id> <ödeme_kodu>")
        return
    uid, charge = int(context.args[0]), context.args[1]
    try:
        await context.bot.refund_star_payment(uid, charge)
    except TelegramError as e:
        await update.message.reply_text(f"İade yapılamadı: {e.message}")
        return
    db.execute("DELETE FROM purchases WHERE user_id=? AND charge_id=?", (uid, charge))
    db.commit()
    await update.message.reply_text("✅ İade edildi, içerik tekrar kilitlendi.")
    try:
        await context.bot.send_message(uid, "↩️ Ödemen iade edildi.")
    except TelegramError:
        pass


async def bildirim(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    u = update.effective_user
    save_user(u.id, u.first_name, u.username)
    row = db.execute("SELECT notify FROM users WHERE id=?", (u.id,)).fetchone()
    new = 0 if row["notify"] else 1
    db.execute("UPDATE users SET notify=? WHERE id=?", (new, u.id))
    db.commit()
    await update.message.reply_text("🔔 Bildirimler açıldı." if new else "🔕 Bildirimler kapatıldı.")


async def on_error(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    log.error("Hata oluştu", exc_info=context.error)


async def setup_bot(app: Application) -> None:
    await app.bot.set_my_commands(
        [
            BotCommand("start", "Profili aç"),
            BotCommand("destek", "Ödeme / destek"),
            BotCommand("bildirim", "Bildirimleri aç/kapat"),
        ]
    )
    if WEBAPP_URL:
        await app.bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="Profil", web_app=WebAppInfo(url=WEBAPP_URL))
        )
    if ADMIN_ID:
        try:
            await app.bot.set_my_commands(
                [
                    BotCommand("start", "Profili aç"),
                    BotCommand("admin", "Yönetim paneli"),
                    BotCommand("cevap", "Destek mesajına cevap"),
                    BotCommand("iade", "Ödeme iadesi"),
                ],
                scope=BotCommandScopeChat(ADMIN_ID),
            )
        except TelegramError:
            log.warning("Yönetici komutları ayarlanamadı (önce bota /start yazın).")


def build_bot(token: str) -> Application:
    app = Application.builder().token(token).build()
    admin_only = filters.User(user_id=ADMIN_ID) & filters.ChatType.PRIVATE
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler(["destek", "paysupport"], destek))
    app.add_handler(CommandHandler("bildirim", bildirim))
    app.add_handler(CommandHandler("admin", admin_cmd, filters=admin_only))
    app.add_handler(CommandHandler("cevap", cevap, filters=admin_only))
    app.add_handler(CommandHandler("iade", iade, filters=admin_only))
    app.add_handler(PreCheckoutQueryHandler(precheckout))
    app.add_handler(MessageHandler(filters.SUCCESSFUL_PAYMENT, successful_payment))
    app.add_error_handler(on_error)
    return app


async def main() -> None:
    if not BOT_TOKEN:
        raise SystemExit("BOT_TOKEN bulunamadı. Ortam değişkenlerini ayarlayın (bkz. .env.example).")
    if not ADMIN_ID:
        log.warning("ADMIN_ID ayarlı değil, yönetim paneli kapalı.")
    if not WEBAPP_URL:
        log.warning("Mini uygulama adresi yok. Railway'de Generate Domain yapın veya WEBAPP_URL girin.")

    tg = build_bot(BOT_TOKEN)
    runner = web.AppRunner(build_web(tg))
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    log.info("Mini uygulama sunucusu %s portunda, adres: %s", PORT, WEBAPP_URL or "(yok)")

    async with tg:
        await setup_bot(tg)
        await tg.start()
        await tg.updater.start_polling(allowed_updates=Update.ALL_TYPES)
        log.info("Bot çalışıyor...")
        try:
            await asyncio.Event().wait()
        finally:
            await tg.updater.stop()
            await tg.stop()
            await runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        pass
