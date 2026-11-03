"""
Telegram Notifier for Hourly OI Scraping
=========================================
Sends instant confirmation alerts whenever an hourly snapshot is recorded into Supabase.
"""

import os
import requests
import logging

logger = logging.getLogger("telegram_notifier")

def get_telegram_creds():
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    
    if token and chat_id:
        return token, chat_id

    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env.local")
    if os.path.exists(env_path):
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("TELEGRAM_BOT_TOKEN="):
                    token = line.split("=", 1)[1].strip().strip('"').strip("'")
                elif line.startswith("TELEGRAM_CHAT_ID="):
                    chat_id = line.split("=", 1)[1].strip().strip('"').strip("'")

    return token, chat_id


def send_hourly_store_alert(result: dict) -> bool:
    """Sends a formatted confirmation message to Telegram."""
    # Staleness Guard: Never send Telegram alerts outside market hours (after 16:05 IST)
    from scraper.holidays import get_now_ist
    now_ist = get_now_ist()
    minute_of_day = now_ist.hour * 60 + now_ist.minute
    if minute_of_day > 965:
        logger.info("[telegram] Skipping push alert: current time is outside market hours (> 16:05 IST).")
        return False

    token, chat_id = get_telegram_creds()
    if not token or not chat_id:
        return False

    checkpoint = result.get("checkpoint", "HOURLY")
    ts = result.get("timestamp_ist", "")
    spot = result.get("spot", 0.0)
    ltp = result.get("ltp") or spot
    pcr = result.get("pcr", 0.0)
    max_pain = result.get("max_pain", 0)
    total_ce = result.get("total_ce_oi", 0)
    total_pe = result.get("total_pe_oi", 0)
    rows = result.get("rows_saved", 0)
    snap_id = result.get("snapshot_id", 0)

    # Format numbers into Indian system
    def fmt_oi(n):
        if n >= 10000000:
            return f"{n/10000000:.2f} Cr"
        if n >= 100000:
            return f"{n/100000:.2f} L"
        return f"{n:,}"

    msg = (
        f"<b>📊 NIFTY 50 • HOURLY OI STORED TO DATABASE</b>\n"
        f"<i>Checkpoint: {checkpoint} • {ts}</i>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"🎯 <b>Spot / LTP:</b> <code>{ltp:.2f}</code>\n"
        f"📈 <b>Put-Call Ratio (PCR):</b> <code>{pcr:.3f}</code>\n"
        f"⚖️ <b>Max Pain Strike:</b> <code>{int(max_pain)}</code>\n"
        f"• Total Call (CE) OI: <code>{fmt_oi(total_ce)}</code>\n"
        f"• Total Put (PE) OI:  <code>{fmt_oi(total_pe)}</code>\n"
        f"━━━━━━━━━━━━━━━━━━━━━━\n"
        f"💾 <b>Database Status:</b> ✅ Snapshot #{snap_id} successfully stored ({rows} strike records)."
    )

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": msg,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }

    try:
        resp = requests.post(url, json=payload, timeout=8)
        return resp.status_code == 200
    except Exception as e:
        logger.warning(f"Telegram notification warning: {e}")
        return False


def send_telegram_alert(text: str) -> bool:
    """Sends a generic text alert to Telegram."""
    token, chat_id = get_telegram_creds()
    if not token or not chat_id:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "disable_web_page_preview": True,
    }
    try:
        resp = requests.post(url, json=payload, timeout=8)
        return resp.status_code == 200
    except Exception as e:
        logger.warning(f"Telegram notification warning: {e}")
        return False


