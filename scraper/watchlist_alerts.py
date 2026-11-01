"""
Personalized Watchlist Hourly Alert Dispatcher
==============================================
Sends tailored Telegram alerts to users for their specific watched CE & PE strikes
using the Price-to-OI conclusion matrix whenever a market checkpoint is stored.
"""

import os
import sys
import requests
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
import psycopg2
from psycopg2.extras import RealDictCursor

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from scraper.db import get_database_url
from scraper.price_to_oi import classify_price_to_oi

logger = logging.getLogger("watchlist_alerts")
IST = timezone(timedelta(hours=5, minutes=30))

def get_telegram_bot_token() -> str:
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if token:
        return token
    env_path = os.path.join(ROOT_DIR, ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip().startswith("TELEGRAM_BOT_TOKEN="):
                    return line.strip().split("=", 1)[1].strip().strip('"').strip("'")
    return ""


def send_telegram_user_message(bot_token: str, chat_id: int, text: str) -> bool:
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    try:
        resp = requests.post(url, json=payload, timeout=8)
        return resp.status_code == 200
    except Exception as e:
        logger.warning(f"Failed to send alert to chat_id {chat_id}: {e}")
        return False


def dispatch_watchlist_alerts_for_latest_snapshot(snapshot_id: Optional[int] = None) -> int:
    """
    Evaluates Price-to-OI action for every user's watched strikes and delivers
    personalized Telegram alerts to each user.
    """
    bot_token = get_telegram_bot_token()
    if not bot_token:
        logger.warning("TELEGRAM_BOT_TOKEN not configured. Skipping watchlist alerts.")
        return 0

    conn = psycopg2.connect(get_database_url(), connect_timeout=15)
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            # 1. Fetch latest 2 snapshots to compare current hour vs previous hour
            cur.execute(
                """
                SELECT id, ts, spot, ltp, checkpoint, pcr, max_pain, expiry
                FROM snapshots
                ORDER BY ts DESC
                LIMIT 2;
                """
            )
            snaps = cur.fetchall()
            if len(snaps) < 1:
                logger.info("No snapshots found to compare.")
                return 0

            latest_snap = snaps[0]
            prev_snap = snaps[1] if len(snaps) >= 2 else snaps[0]

            latest_id = latest_snap["id"]
            prev_id = prev_snap["id"]
            checkpoint = latest_snap["checkpoint"]
            spot_current = float(latest_snap["ltp"] or latest_snap["spot"] or 0)
            spot_prev = float(prev_snap["ltp"] or prev_snap["spot"] or spot_current)
            spot_delta = round(spot_current - spot_prev, 2)
            pcr = float(latest_snap["pcr"] or 1.0)
            expiry_str = latest_snap["expiry"]

            # 2. Fetch all users who have telegram_chat_id linked
            cur.execute(
                """
                SELECT u.id, u.name, u.phone, u.telegram_chat_id
                FROM app_users u
                WHERE u.telegram_chat_id IS NOT NULL AND u.is_active = TRUE;
                """
            )
            users = cur.fetchall()
            if not users:
                logger.info("No users with linked Telegram found.")
                return 0

            # 3. Fetch latest strike data and previous strike data
            cur.execute(
                """
                SELECT strike, option_type, ltp, oi, change_oi
                FROM chain_rows
                WHERE snapshot_id = %s;
                """,
                (latest_id,),
            )
            latest_rows = { (r["strike"], r["option_type"]): r for r in cur.fetchall() }

            cur.execute(
                """
                SELECT strike, option_type, ltp, oi, change_oi
                FROM chain_rows
                WHERE snapshot_id = %s;
                """,
                (prev_id,),
            )
            prev_rows = { (r["strike"], r["option_type"]): r for r in cur.fetchall() }

            sent_count = 0

            # 4. For each user, fetch their watched strikes
            for u in users:
                user_id = u["id"]
                chat_id = u["telegram_chat_id"]
                name = u["name"] or "Trader"

                cur.execute(
                    """
                    SELECT strike, option_type
                    FROM user_watchlists
                    WHERE user_id = %s
                    ORDER BY strike ASC, option_type ASC;
                    """,
                    (user_id,),
                )
                watch_items = cur.fetchall()
                if not watch_items:
                    continue

                ce_lines = []
                pe_lines = []

                for w in watch_items:
                    strike = w["strike"]
                    opt_type = w["option_type"]
                    key = (strike, opt_type)

                    cur_data = latest_rows.get(key)
                    prv_data = prev_rows.get(key)

                    cur_ltp = float(cur_data["ltp"]) if cur_data and cur_data["ltp"] is not None else 0.0
                    prv_ltp = float(prv_data["ltp"]) if prv_data and prv_data["ltp"] is not None else cur_ltp
                    delta_p = round(cur_ltp - prv_ltp, 2)

                    cur_oi = int(cur_data["oi"]) if cur_data and cur_data["oi"] is not None else 0
                    prv_oi = int(prv_data["oi"]) if prv_data and prv_data["oi"] is not None else cur_oi
                    delta_oi = cur_oi - prv_oi

                    # Classify using official Price-to-OI engine
                    analysis = classify_price_to_oi(delta_p, delta_oi, opt_type)
                    obs = analysis["observation"]

                    # Format emoji badge
                    if obs == "LONG BUILD UP":
                        badge = "🟢 LONG BUILDUP (Bullish)" if opt_type == "CE" else "🔴 LONG BUILDUP (Put Buying / Bearish)"
                    elif obs == "SHORT COVERING":
                        badge = "🚀 SHORT COVERING (Rally)" if opt_type == "CE" else "🔻 SHORT COVERING (Bearish)"
                    elif obs == "SHORT BUILD UP":
                        badge = "🔴 CALL WRITING (Resistance)" if opt_type == "CE" else "🟢 PUT WRITING (Support)"
                    elif obs == "LONG COVERING":
                        badge = "🔻 LONG UNWINDING (Bearish)" if opt_type == "CE" else "🟢 PUT UNWINDING (Bullish)"
                    else:
                        badge = "⚪ Similar / No Big Change"

                    dp_str = f"+₹{delta_p}" if delta_p > 0 else f"₹{delta_p}"
                    doi_str = f"+{delta_oi:,}" if delta_oi > 0 else f"{delta_oi:,}"

                    line = (
                        f"• <b>{strike} {opt_type}</b>: ₹{cur_ltp:.1f} ({dp_str}) | OI: {doi_str}\n"
                        f"  👉 <b>{badge}</b>"
                    )

                    if opt_type == "CE":
                        ce_lines.append(line)
                    else:
                        pe_lines.append(line)

                # Format message
                spot_sign = f"+{spot_delta}" if spot_delta >= 0 else f"{spot_delta}"
                msg_parts = [
                    f"🔔 <b>NIFTY 50 HOURLY OI ALERT • {checkpoint}</b>",
                    f"<i>Personalized Watchlist for {name}</i>",
                    f"━━━━━━━━━━━━━━━━━━━━━━",
                    f"🎯 <b>Spot / LTP:</b> <code>{spot_current:.2f}</code> ({spot_sign} pts) | <b>PCR:</b> <code>{pcr:.2f}</code>",
                    f"━━━━━━━━━━━━━━━━━━━━━━",
                ]

                if ce_lines:
                    msg_parts.append("📌 <b>Your Watched Calls (CE):</b>")
                    msg_parts.extend(ce_lines)
                    msg_parts.append("")

                if pe_lines:
                    msg_parts.append("📌 <b>Your Watched Puts (PE):</b>")
                    msg_parts.extend(pe_lines)
                    msg_parts.append("")

                msg_parts.append("━━━━━━━━━━━━━━━━━━━━━━")
                msg_parts.append("🌐 Open Live Interactive Dashboard:\nhttps://nifty-oi-analyzer-seven.vercel.app")

                final_text = "\n".join(msg_parts)
                if send_telegram_user_message(bot_token, chat_id, final_text):
                    sent_count += 1

            logger.info(f"[watchlist_alerts] Dispatched personalized alerts to {sent_count} users for checkpoint {checkpoint}.")
            return sent_count

    except Exception as e:
        logger.error(f"[watchlist_alerts] Error dispatching alerts: {e}")
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    count = dispatch_watchlist_alerts_for_latest_snapshot()
    print(f"Watchlist alert dispatcher completed. Sent alerts to {count} users.")

