"""Ödül sistemi: sunucu taraflı siparişler, günlük puanlar, reklam geliri havuzu, çekimler.

Kurallar:
  * Siparişi sunucu üretir; teslimde sunucu kontrol eder (hile koruması).
  * Doğru teslim = paket puanı (ücretsiz 1, 300⭐ paket 3, 500⭐ paket 5).
  * Kur: POINTS_PER_STAR puan = 1⭐ — ama sadece havuz yetiyorsa.
  * Günlük havuz = o günün reklam geliri × POOL_PCT. Herkesin hak edişi toplamı havuzu aşarsa
    hepsi aynı oranda düşürülür; aşmazsa kur aynen ödenir ve kalan sende kalır.
  * Hiçbir zaman girilen reklam gelirinden fazlası dağıtılmaz; kazanç sabit/garanti değildir.
"""
import json
import os
import random
import re
import sqlite3
import time

POOL_PCT = float(os.environ.get("POOL_PCT", "0.5"))          # reklam gelirinin havuza giden oranı
DAILY_CAP = int(os.environ.get("DAILY_CAP", "400"))           # kişi başı günlük puanlı döner sınırı
MIN_SERVE_SECONDS = float(os.environ.get("MIN_SERVE_SECONDS", "4"))
ORDER_TTL_SECONDS = 180
MAX_OPEN_ORDERS = 6
MIN_WITHDRAW_USD = float(os.environ.get("MIN_WITHDRAW_USD", "2"))
STAR_USD = float(os.environ.get("STAR_USD", "0.013"))  # 1 yıldızın dolar karşılığı (ödeme hesabı)
TZ_OFFSET = 3 * 3600  # Türkiye saati

BREADS = ("lavas", "ekmek")
TOPPINGS = ("tursu", "mayonez", "ketcap", "patates")
MULTIPLIER_ITEMS = {"gold": 5, "bronz": 3}  # döner başına puan, en yüksek olan geçerli
POINTS_PER_STAR = float(os.environ.get("POINTS_PER_STAR", "12"))

TON_ADDR = re.compile(r"^(?:[A-Za-z0-9_-]{48}|-?\d:[0-9a-fA-F]{64})$")


def today(ts=None) -> str:
    return time.strftime("%Y-%m-%d", time.gmtime((ts or time.time()) + TZ_OFFSET))


def init_db(db: sqlite3.Connection) -> None:
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            spec TEXT NOT NULL,
            created REAL NOT NULL,
            done INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS orders_user ON orders(user_id, done);
        CREATE TABLE IF NOT EXISTS daily_points (
            user_id INTEGER NOT NULL,
            day TEXT NOT NULL,
            points REAL NOT NULL DEFAULT 0,
            served INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, day)
        );
        CREATE TABLE IF NOT EXISTS pools (
            day TEXT PRIMARY KEY,
            revenue_usd REAL NOT NULL,
            pool_usd REAL NOT NULL,
            factor REAL NOT NULL DEFAULT 1,
            total_points REAL NOT NULL,
            distributed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS balances (
            user_id INTEGER PRIMARY KEY,
            usd REAL NOT NULL DEFAULT 0,
            wallet TEXT
        );
        CREATE TABLE IF NOT EXISTS withdrawals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            usd REAL NOT NULL,
            wallet TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'bekliyor',
            created INTEGER NOT NULL
        );
        """
    )
    cols = [r[1] for r in db.execute("PRAGMA table_info(pools)")]
    if "factor" not in cols:  # eski veritabanı
        db.execute("ALTER TABLE pools ADD COLUMN factor REAL NOT NULL DEFAULT 1")
    db.commit()


def multiplier(perks: dict) -> int:
    return max([m for k, m in MULTIPLIER_ITEMS.items() if perks.get(k)] + [1])


# ------------------------------------------------------------- siparişler
def new_order(db, user_id: int) -> dict:
    now = time.time()
    db.execute("UPDATE orders SET done = 2 WHERE user_id = ? AND done = 0 AND created < ?",
               (user_id, now - ORDER_TTL_SECONDS))
    open_count = db.execute("SELECT COUNT(*) FROM orders WHERE user_id = ? AND done = 0", (user_id,)).fetchone()[0]
    if open_count >= MAX_OPEN_ORDERS:
        # en eskisini kapat, sınırsız sipariş biriktirilmesin
        db.execute("UPDATE orders SET done = 2 WHERE id = (SELECT MIN(id) FROM orders WHERE user_id = ? AND done = 0)",
                   (user_id,))
    spec = {
        "bread": random.choice(BREADS) if random.random() > 0.1 else "lavas",
        "meat": 2 if random.random() < 0.25 else 1,
        "toppings": [t for t in TOPPINGS if random.random() < 0.5],
    }
    cur = db.execute("INSERT INTO orders (user_id, spec, created) VALUES (?, ?, ?)", (user_id, json.dumps(spec), now))
    db.commit()
    return {"id": cur.lastrowid, **spec}


def serve_order(db, user_id: int, order_id: int, build: dict, perks: dict) -> dict:
    row = db.execute("SELECT spec, created, done FROM orders WHERE id = ? AND user_id = ?",
                     (order_id, user_id)).fetchone()
    if not row:
        return {"ok": False, "reason": "sipariş yok"}
    spec, created, done = json.loads(row[0]), row[1], row[2]
    now = time.time()
    if done != 0 or now - created > ORDER_TTL_SECONDS:
        return {"ok": False, "reason": "sipariş süresi doldu"}
    db.execute("UPDATE orders SET done = 1 WHERE id = ?", (order_id,))

    day = today(now)
    too_fast = now - created < MIN_SERVE_SECONDS
    tops = build.get("toppings") or []
    matched = (
        build.get("bread") == spec["bread"]
        and build.get("meat") == spec["meat"]
        and sorted(set(tops)) == sorted(spec["toppings"])
        and build.get("wrapped") is True
        and build.get("quality") != "yanık"
    )
    pts_row = db.execute("SELECT points, served FROM daily_points WHERE user_id = ? AND day = ?",
                         (user_id, day)).fetchone()
    served_today = pts_row[1] if pts_row else 0
    points = 0.0
    reason = None
    if not matched:
        reason = "yanlış sipariş"
    elif too_fast:
        reason = "çok hızlı"
    elif served_today >= DAILY_CAP:
        reason = "günlük sınır doldu"
    else:
        points = float(multiplier(perks))
        db.execute(
            "INSERT INTO daily_points (user_id, day, points, served) VALUES (?, ?, ?, 1) "
            "ON CONFLICT(user_id, day) DO UPDATE SET points = points + excluded.points, served = served + 1",
            (user_id, day, points),
        )
    db.commit()
    return {"ok": True, "matched": matched, "points": points, "reason": reason}


# ------------------------------------------------------------- havuz
def summary(db, user_id: int, perks: dict) -> dict:
    day = today()
    row = db.execute("SELECT points, served FROM daily_points WHERE user_id = ? AND day = ?", (user_id, day)).fetchone()
    my_points, served = (row or (0, 0))
    total = db.execute("SELECT COALESCE(SUM(points), 0) FROM daily_points WHERE day = ?", (day,)).fetchone()[0]
    last_pool = db.execute("SELECT pool_usd, day FROM pools WHERE distributed = 1 ORDER BY day DESC LIMIT 1").fetchone()
    # tam kur hak edişi; son havuz bugünkü toplamı karşılamıyorsa aynı oranda düşürülmüş tahmin
    ideal_usd = my_points / POINTS_PER_STAR * STAR_USD
    total_ideal = total / POINTS_PER_STAR * STAR_USD
    factor = min(1.0, last_pool[0] / total_ideal) if last_pool and total_ideal else 1.0
    est_usd = ideal_usd * factor
    bal = db.execute("SELECT usd, wallet FROM balances WHERE user_id = ?", (user_id,)).fetchone()
    pending = db.execute("SELECT COALESCE(SUM(usd), 0) FROM withdrawals WHERE user_id = ? AND status = 'bekliyor'",
                         (user_id,)).fetchone()[0]
    return {
        "day": day,
        "points": my_points,
        "served": served,
        "dailyCap": DAILY_CAP,
        "totalPoints": total,
        "multiplier": multiplier(perks),
        "pointsPerStar": POINTS_PER_STAR,
        "fullStars": round(my_points / POINTS_PER_STAR, 1),
        "factor": round(factor, 3),
        "lastPoolUsd": last_pool[0] if last_pool else 0,
        "lastPoolDay": last_pool[1] if last_pool else None,
        "estimateUsd": round(est_usd, 4),
        "estimateStars": round(est_usd / STAR_USD, 1),
        "balanceUsd": round(bal[0], 4) if bal else 0,
        "balanceStars": round((bal[0] if bal else 0) / STAR_USD, 1),
        "wallet": bal[1] if bal else None,
        "pendingUsd": round(pending, 4),
        "minWithdrawUsd": MIN_WITHDRAW_USD,
    }


def distribute(db, day: str, revenue_usd: float) -> dict:
    """Bir günün reklam gelirini girer ve havuzu puanlara göre dağıtır. Bir gün yalnızca bir kez dağıtılır."""
    existing = db.execute("SELECT distributed FROM pools WHERE day = ?", (day,)).fetchone()
    if existing and existing[0]:
        return {"ok": False, "reason": f"{day} zaten dağıtıldı"}
    rows = db.execute("SELECT user_id, points FROM daily_points WHERE day = ? AND points > 0", (day,)).fetchall()
    total = sum(p for _, p in rows)
    pool = round(revenue_usd * POOL_PCT, 4)
    total_ideal = total / POINTS_PER_STAR * STAR_USD
    factor = min(1.0, pool / total_ideal) if total_ideal else 1.0
    paid = 0.0
    if total > 0:
        for uid, pts in rows:
            share = pts / POINTS_PER_STAR * STAR_USD * factor
            paid += share
            db.execute(
                "INSERT INTO balances (user_id, usd) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET usd = usd + excluded.usd",
                (uid, share),
            )
    db.execute(
        "INSERT OR REPLACE INTO pools (day, revenue_usd, pool_usd, factor, total_points, distributed) VALUES (?, ?, ?, ?, ?, 1)",
        (day, revenue_usd, pool, factor, total),
    )
    db.commit()
    return {"ok": True, "day": day, "pool": pool, "paid": round(paid, 4), "factor": round(factor, 3),
            "players": len(rows), "totalPoints": total}


# ------------------------------------------------------------- cüzdan / çekim
def set_wallet(db, user_id: int, address: str) -> bool:
    address = (address or "").strip()
    if not TON_ADDR.match(address):
        return False
    db.execute("INSERT INTO balances (user_id, usd, wallet) VALUES (?, 0, ?) "
               "ON CONFLICT(user_id) DO UPDATE SET wallet = excluded.wallet", (user_id, address))
    db.commit()
    return True


def request_withdraw(db, user_id: int) -> dict:
    bal = db.execute("SELECT usd, wallet FROM balances WHERE user_id = ?", (user_id,)).fetchone()
    if not bal or not bal[1]:
        return {"ok": False, "reason": "Önce TON cüzdan adresini kaydet"}
    if bal[0] < MIN_WITHDRAW_USD:
        return {"ok": False, "reason": f"En az {MIN_WITHDRAW_USD}$ birikmeli"}
    amount = round(bal[0], 4)
    db.execute("UPDATE balances SET usd = usd - ? WHERE user_id = ?", (amount, user_id))
    cur = db.execute("INSERT INTO withdrawals (user_id, usd, wallet, created) VALUES (?, ?, ?, ?)",
                     (user_id, amount, bal[1], int(time.time())))
    db.commit()
    return {"ok": True, "id": cur.lastrowid, "usd": amount}


def pending_withdrawals(db):
    return db.execute("SELECT id, user_id, usd, wallet, created FROM withdrawals WHERE status = 'bekliyor' ORDER BY id").fetchall()


def set_withdraw_status(db, wid: int, status: str) -> dict:
    row = db.execute("SELECT user_id, usd, status FROM withdrawals WHERE id = ?", (wid,)).fetchone()
    if not row or row[2] != "bekliyor":
        return {"ok": False}
    db.execute("UPDATE withdrawals SET status = ? WHERE id = ?", (status, wid))
    if status == "reddedildi":  # para bakiyeye geri döner
        db.execute("UPDATE balances SET usd = usd + ? WHERE user_id = ?", (row[1], row[0]))
    db.commit()
    return {"ok": True, "user_id": row[0], "usd": row[1]}
