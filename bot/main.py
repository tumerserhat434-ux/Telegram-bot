"""Dönerci Usta — Telegram botu + Mini App sunucusu.

Tek süreçte iki iş yapar:
  1. aiogram ile botu çalıştırır (/start, Telegram Stars ödemeleri)
  2. aiohttp ile oyunu (webapp/) ve oyunun API'sini sunar
"""
import asyncio
import json
import logging
import os
import sqlite3
import time
from pathlib import Path

from aiohttp import web
from aiogram import Bot, Dispatcher, F
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    Message,
    PreCheckoutQuery,
    WebAppInfo,
)
from aiogram.utils.web_app import safe_parse_webapp_init_data

import rewards

ROOT = Path(__file__).resolve().parent.parent
WEBAPP_DIR = ROOT / "webapp"


def load_env_file() -> None:
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env_file()
BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"].rstrip("/") + "/"
PORT = int(os.environ.get("PORT", "8080"))
DB_PATH = os.environ.get("DB_PATH", str(ROOT / "doner.db"))
SPONSOR_FILE = ROOT / "sponsor.json"
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "").replace(" ", "").split(",") if x}

# Yıldız mağazası. Fiyatları buradan değiştirebilirsin.
# "bronz" ve "gold" döner başına puanı belirler (rewards.MULTIPLIER_ITEMS); müşteri sıklığı game.js'te.
STAR_ITEMS = {
    "bronz": {"title": "Bronz Dükkan", "emoji": "🥉", "stars": 300,
              "description": "Her döner 3 puan · 1,6 kat daha sık müşteri"},
    "gold": {"title": "Altın Dükkan", "emoji": "🥇", "stars": 500,
             "description": "Her döner 5 puan · 2,2 kat daha sık müşteri · usta çırak"},
    "altin": {"title": "Altın Bıçak", "emoji": "🗡️", "stars": 100,
              "description": "Et kesimi 2 kat hızlı"},
}

log = logging.getLogger("doner")

# ---------------------------------------------------------------- veritabanı
db = sqlite3.connect(DB_PATH, check_same_thread=False)
db.executescript(
    """
    CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        save TEXT,
        updated INTEGER
    );
    CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item TEXT NOT NULL,
        stars INTEGER NOT NULL,
        charge_id TEXT UNIQUE NOT NULL,
        created INTEGER NOT NULL
    );
    """
)
db.commit()
rewards.init_db(db)


def get_perks(user_id: int) -> dict:
    rows = db.execute("SELECT DISTINCT item FROM purchases WHERE user_id = ?", (user_id,)).fetchall()
    return {r[0]: True for r in rows}


def get_sponsor():
    if SPONSOR_FILE.exists():
        try:
            return json.loads(SPONSOR_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            log.warning("sponsor.json okunamadı")
    return None


# ---------------------------------------------------------------- bot
dp = Dispatcher()


@dp.message(CommandStart())
async def cmd_start(message: Message) -> None:
    kb = InlineKeyboardMarkup(
        inline_keyboard=[[InlineKeyboardButton(text="🥙 Dükkanı Aç", web_app=WebAppInfo(url=WEBAPP_URL))]]
    )
    await message.answer(
        "Hoş geldin usta! 🥙\n\nDöner kes, ekmeği saçta ısıt, sar ve müşterine teslim et. "
        "Çırağın sen yokken bile satış yapar.",
        reply_markup=kb,
    )


@dp.message(Command("paysupport"))
async def cmd_paysupport(message: Message) -> None:
    # Telegram, Stars kullanan botların /paysupport komutuna cevap vermesini ister.
    await message.answer("Ödeme sorunları için bu sohbete yaz, en kısa sürede dönüş yapacağız.")


@dp.pre_checkout_query()
async def on_pre_checkout(query: PreCheckoutQuery) -> None:
    item, _, uid = query.invoice_payload.partition(":")
    if item not in STAR_ITEMS or str(query.from_user.id) != uid:
        await query.answer(ok=False, error_message="Geçersiz ürün.")
        return
    if get_perks(query.from_user.id).get(item):
        await query.answer(ok=False, error_message="Bu ürün zaten sende.")
        return
    await query.answer(ok=True)


@dp.message(F.successful_payment)
async def on_paid(message: Message) -> None:
    sp = message.successful_payment
    item = sp.invoice_payload.split(":", 1)[0]
    try:
        db.execute(
            "INSERT INTO purchases (user_id, item, stars, charge_id, created) VALUES (?, ?, ?, ?, ?)",
            (message.from_user.id, item, sp.total_amount, sp.telegram_payment_charge_id, int(time.time())),
        )
        db.commit()
    except sqlite3.IntegrityError:
        pass  # aynı ödeme iki kez geldiyse
    title = STAR_ITEMS.get(item, {}).get("title", item)
    await message.answer(f"⭐ {title} dükkanına eklendi! Oyuna dönebilirsin.")


# ---------------------------------------------------------------- admin
def is_admin(message: Message) -> bool:
    return bool(message.from_user and message.from_user.id in ADMIN_IDS)


@dp.message(Command("havuz"))
async def cmd_havuz(message: Message) -> None:
    """/havuz <reklam_geliri_usd> [YYYY-AA-GG] — o günün havuzunu dağıtır (varsayılan: dün)."""
    if not is_admin(message):
        return
    parts = (message.text or "").split()
    try:
        revenue = float(parts[1].replace(",", "."))
    except (IndexError, ValueError):
        await message.answer("Kullanım: /havuz 100  (dünün reklam geliri, $)\nveya /havuz 100 2026-11-22")
        return
    day = parts[2] if len(parts) > 2 else rewards.today(time.time() - 86400)
    r = rewards.distribute(db, day, revenue)
    if not r["ok"]:
        await message.answer("❌ " + r["reason"])
        return
    await message.answer(
        f"✅ {r['day']} dağıtıldı\nGelir: {revenue}$ → Havuz: {r['pool']}$ (%{int(rewards.POOL_PCT * 100)})\n"
        f"Ödenen: {r['paid']}$ · Kur oranı: %{int(r['factor'] * 100)}\n"
        f"Oyuncu: {r['players']} · Toplam puan: {r['totalPoints']:g}"
    )


@dp.message(Command("cekimler"))
async def cmd_cekimler(message: Message) -> None:
    if not is_admin(message):
        return
    rows = rewards.pending_withdrawals(db)
    if not rows:
        await message.answer("Bekleyen çekim yok.")
        return
    lines = [f"#{wid} · kullanıcı {uid} · {usd:.2f}$\n<code>{wallet}</code>" for wid, uid, usd, wallet, _ in rows]
    await message.answer("Bekleyen çekimler:\n\n" + "\n\n".join(lines) +
                         "\n\nÖdedikten sonra: /odendi ID · Reddetmek için: /reddet ID", parse_mode="HTML")


async def _withdraw_status(message: Message, status: str) -> None:
    if not is_admin(message):
        return
    try:
        wid = int((message.text or "").split()[1])
    except (IndexError, ValueError):
        await message.answer("ID yaz: ör. /odendi 3")
        return
    r = rewards.set_withdraw_status(db, wid, status)
    if not r["ok"]:
        await message.answer("Bulunamadı ya da zaten işlenmiş.")
        return
    await message.answer(f"#{wid} → {status}")
    text = (f"✅ {r['usd']:.2f}$ değerindeki çekimin TON cüzdanına gönderildi." if status == "odendi"
            else f"❌ {r['usd']:.2f}$ çekim talebin reddedildi, tutar bakiyene geri eklendi.")
    try:
        await message.bot.send_message(r["user_id"], text)
    except Exception:  # kullanıcı botu engellemiş olabilir
        pass


@dp.message(Command("odendi"))
async def cmd_odendi(message: Message) -> None:
    await _withdraw_status(message, "odendi")


@dp.message(Command("reddet"))
async def cmd_reddet(message: Message) -> None:
    await _withdraw_status(message, "reddedildi")


# ---------------------------------------------------------------- web API
def auth(request: web.Request):
    init_data = request.headers.get("X-Init-Data", "")
    try:
        data = safe_parse_webapp_init_data(BOT_TOKEN, init_data)
    except ValueError:
        raise web.HTTPUnauthorized(text="initData geçersiz")
    if not data.user:
        raise web.HTTPUnauthorized(text="kullanıcı yok")
    return data.user


async def index(_: web.Request) -> web.FileResponse:
    return web.FileResponse(WEBAPP_DIR / "index.html")


async def api_config(request: web.Request) -> web.Response:
    auth(request)
    return web.json_response({"items": STAR_ITEMS, "sponsor": get_sponsor()})


async def api_state(request: web.Request) -> web.Response:
    user = auth(request)
    row = db.execute("SELECT save FROM users WHERE user_id = ?", (user.id,)).fetchone()
    save = json.loads(row[0]) if row and row[0] else None
    return web.json_response({"save": save, "perks": get_perks(user.id)})


async def api_save(request: web.Request) -> web.Response:
    user = auth(request)
    body = await request.text()
    if len(body) > 20_000:
        raise web.HTTPRequestEntityTooLarge(max_size=20_000, actual_size=len(body))
    save = json.loads(body).get("save")
    if not isinstance(save, dict):
        raise web.HTTPBadRequest(text="save yok")
    db.execute(
        "INSERT INTO users (user_id, username, save, updated) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, save = excluded.save, updated = excluded.updated",
        (user.id, user.username, json.dumps(save), int(time.time())),
    )
    db.commit()
    return web.json_response({"ok": True})


async def api_order(request: web.Request) -> web.Response:
    user = auth(request)
    return web.json_response(rewards.new_order(db, user.id))


async def api_serve(request: web.Request) -> web.Response:
    user = auth(request)
    body = await request.json()
    try:
        order_id = int(body.get("id"))
    except (TypeError, ValueError):
        raise web.HTTPBadRequest(text="id yok")
    build = body.get("build") if isinstance(body.get("build"), dict) else {}
    return web.json_response(rewards.serve_order(db, user.id, order_id, build, get_perks(user.id)))


async def api_rewards(request: web.Request) -> web.Response:
    user = auth(request)
    return web.json_response(rewards.summary(db, user.id, get_perks(user.id)))


async def api_wallet(request: web.Request) -> web.Response:
    user = auth(request)
    ok = rewards.set_wallet(db, user.id, (await request.json()).get("address", ""))
    if not ok:
        raise web.HTTPBadRequest(text="Geçersiz TON adresi")
    return web.json_response({"ok": True})


async def api_withdraw(request: web.Request) -> web.Response:
    user = auth(request)
    r = rewards.request_withdraw(db, user.id)
    if r["ok"]:
        for admin in ADMIN_IDS:
            try:
                await request.app["bot"].send_message(admin, f"💸 Yeni çekim talebi #{r['id']} · {r['usd']:.2f}$ · /cekimler")
            except Exception:
                pass
    return web.json_response(r)


def make_app(bot: Bot) -> web.Application:
    async def api_invoice(request: web.Request) -> web.Response:
        user = auth(request)
        item = (await request.json()).get("item")
        it = STAR_ITEMS.get(item)
        if not it:
            raise web.HTTPBadRequest(text="ürün yok")
        link = await bot.create_invoice_link(
            title=it["title"],
            description=it["description"],
            payload=f"{item}:{user.id}",
            currency="XTR",  # Telegram Stars
            prices=[LabeledPrice(label=it["title"], amount=it["stars"])],
        )
        return web.json_response({"link": link})

    app = web.Application(client_max_size=64 * 1024)
    app["bot"] = bot
    app.router.add_get("/", index)
    app.router.add_get("/api/config", api_config)
    app.router.add_get("/api/state", api_state)
    app.router.add_post("/api/save", api_save)
    app.router.add_post("/api/invoice", api_invoice)
    app.router.add_post("/api/order", api_order)
    app.router.add_post("/api/serve", api_serve)
    app.router.add_get("/api/rewards", api_rewards)
    app.router.add_post("/api/wallet", api_wallet)
    app.router.add_post("/api/withdraw", api_withdraw)
    app.router.add_static("/static", WEBAPP_DIR / "static")
    return app


async def main() -> None:
    logging.basicConfig(level=logging.INFO)
    bot = Bot(BOT_TOKEN)
    runner = web.AppRunner(make_app(bot))
    await runner.setup()
    await web.TCPSite(runner, "0.0.0.0", PORT).start()
    log.info("Oyun sunucusu :%s portunda çalışıyor", PORT)
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
