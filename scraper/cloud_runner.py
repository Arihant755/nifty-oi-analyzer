"""
Cloud Runner for GitHub Actions / Cloud Cron
============================================
Autonomous single-shot execution for cloud runners:
1. Checks if today is an Indian Trading Day (skips weekends and NSE holidays).
2. Resolves current checkpoint label (09:15, 10:15, ..., 15:30).
3. Pulls live NSE option chain with Akamai-warmed session.
4. Stores snapshot and all strike rows into Supabase PostgreSQL.
5. Sends real-time Telegram notification.
6. Retries up to 5 times with exponential backoff on transient errors.
"""

import sys
import os
import time
import logging
from datetime import datetime, timezone, timedelta

# Ensure root directory is on python path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from scraper.collector import OptionChainCollector
from scraper.holidays import is_trading_day, is_market_open, get_now_ist, IST
from scraper.db import get_snapshots_for_day
from scraper.telegram import send_hourly_store_alert, send_telegram_alert
from scraper.watchlist_alerts import dispatch_watchlist_alerts_for_latest_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("cloud_runner")

SCHEDULED_SLOTS = [
    (9, 15, "09:15"),
    (10, 15, "10:15"),
    (11, 15, "11:15"),
    (12, 15, "12:15"),
    (13, 15, "13:15"),
    (14, 15, "14:15"),
    (15, 15, "15:15"),
    (15, 30, "15:30"),
]

def resolve_checkpoint_label(now_ist: datetime) -> str:
    """Finds the closest scheduled checkpoint label based on current IST time."""
    cur_mins = now_ist.hour * 60 + now_ist.minute
    closest_label = now_ist.strftime("%H:%M")
    min_diff = float("inf")

    for h, m, label in SCHEDULED_SLOTS:
        slot_mins = h * 60 + m
        diff = abs(cur_mins - slot_mins)
        if diff < min_diff:
            min_diff = diff
            closest_label = label

    # If within 25 minutes of a scheduled slot, use that slot's official name
    if min_diff <= 25:
        return closest_label
    return f"{now_ist.strftime('%H:%M')} MANUAL"


def main():
    force_run = "--force" in sys.argv
    checkpoint_arg = None
    for arg in sys.argv[1:]:
        if arg.startswith("--checkpoint="):
            checkpoint_arg = arg.split("=", 1)[1]

    now = get_now_ist()
    today_str = now.strftime("%Y-%m-%d")
    logger.info("=" * 65)
    logger.info("NIFTY 50 HOURLY CLOUD SCRAPER TRIGGERED")
    logger.info(f"Current Time: {now.strftime('%Y-%m-%d %H:%M:%S IST')}")
    logger.info("=" * 65)

    if not force_run and not is_trading_day(now):
        msg = f"[cloud_runner] Today ({today_str}) is NOT an Indian trading day (weekend/holiday). Skipping."
        logger.info(msg)
        print(msg)
        return

    # Check which checkpoints already exist in Supabase for today
    completed_checkpoints = set()
    try:
        snaps = get_snapshots_for_day(today_str)
        for s in snaps:
            cp = s.get("checkpoint")
            if cp:
                completed_checkpoints.add(cp.split()[0])
        logger.info(f"[cloud_runner] Already recorded today in DB: {sorted(list(completed_checkpoints))}")
    except Exception as e:
        logger.warning(f"[cloud_runner] Could not fetch existing snapshots from DB: {e}")

    # Determine target checkpoint or catchup list
    checkpoints_to_run = []
    if checkpoint_arg:
        checkpoints_to_run.append(checkpoint_arg)
    else:
        current_minute = now.hour * 60 + now.minute
        for h, m, label in SCHEDULED_SLOTS:
            slot_minute = h * 60 + m
            # If checkpoint time has passed (or is right now) and hasn't been saved yet today
            if current_minute >= slot_minute and label not in completed_checkpoints:
                checkpoints_to_run.append(label)

    if not checkpoints_to_run:
        logger.info("[cloud_runner] All due checkpoints for today are already captured and recorded! Nothing to do.")
        print("[OK] Up to date.")
        return

    collector = OptionChainCollector()
    max_attempts = 5

    for target_cp in checkpoints_to_run:
        logger.info(f"[cloud_runner] >>> Executing Checkpoint: {target_cp} <<<")
        success = False

        for attempt in range(1, max_attempts + 1):
            try:
                logger.info(f"[cloud_runner] [Attempt {attempt}/{max_attempts}] Pulling NSE data & storing in Supabase...")
                res = collector.collect_and_store(checkpoint_label=target_cp)
                logger.info(
                    f"[cloud_runner] [SUCCESS] Snapshot #{res['snapshot_id']} saved. "
                    f"Spot={res['spot']:.2f}, PCR={res['pcr']:.2f}, Rows={res['rows_saved']}"
                )
                # Send Master Telegram alert
                send_hourly_store_alert(res)
                # Dispatch personalized watchlist alerts
                try:
                    dispatch_watchlist_alerts_for_latest_snapshot(res['snapshot_id'])
                except Exception as e:
                    logger.warning(f"Error dispatching watchlist alerts: {e}")
                print(f"[OK] Completed checkpoint {target_cp}")
                success = True
                break
            except Exception as e:
                logger.error(f"[cloud_runner] Attempt {attempt} failed: {e}", exc_info=True)
                if attempt < max_attempts:
                    wait_secs = attempt * 8
                    logger.info(f"[cloud_runner] Waiting {wait_secs}s before retrying...")
                    time.sleep(wait_secs)

        if not success:
            err_msg = f"CRITICAL: Cloud scraper failed to capture {target_cp} after {max_attempts} attempts at {now.strftime('%H:%M IST')}!"
            logger.critical(err_msg)
            try:
                send_telegram_alert(f"[ERROR] {err_msg}")
            except Exception:
                pass
            sys.exit(1)


if __name__ == "__main__":
    main()

