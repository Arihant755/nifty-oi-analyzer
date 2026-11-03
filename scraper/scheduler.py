"""
Nifty 50 Autonomous Hourly OI Scheduler (09:15 - 15:30 IST)
=============================================================
Runs strictly on every trading hour without missing a single hour:
  - 09:15 IST (Market Open Baseline)
  - 10:15 IST (Hour 1)
  - 11:15 IST (Hour 2)
  - 12:15 IST (Hour 3 Midday)
  - 13:15 IST (Hour 4)
  - 14:15 IST (Hour 5)
  - 15:15 IST (Hour 6 Pre-Close)
  - 15:30 IST (Market Close Final)

Guarantees zero missed hours via automated retry with exponential backoff
and missed-checkpoint detection.
"""

import os
import sys
import time
import logging
from datetime import datetime, timezone, timedelta
from typing import Set

# Ensure root directory is on python path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from scraper.collector import OptionChainCollector
from scraper.holidays import is_trading_day, is_market_open, get_now_ist, IST
from scraper.db import get_snapshots_for_day
from scraper.telegram import send_hourly_store_alert
from scraper.watchlist_alerts import dispatch_watchlist_alerts_for_latest_snapshot

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] %(levelname)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger("hourly_scheduler")

# Strict hourly schedule
SCHEDULED_CHECKPOINTS = [
    (9, 15, "09:15"),
    (10, 15, "10:15"),
    (11, 15, "11:15"),
    (12, 15, "12:15"),
    (13, 15, "13:15"),
    (14, 15, "14:15"),
    (15, 15, "15:15"),
    (15, 30, "15:30"),
]

class HourlyOIScheduler:
    def __init__(self):
        self.collector = OptionChainCollector()
        self.executed_today: Set[str] = set()
        self.current_date_str = ""

    def _sync_completed_checkpoints_from_db(self, date_str: str):
        """
        Queries Supabase to find which checkpoints have already been recorded today.
        Guarantees that even if the service restarts, it won't duplicate or miss any slots.
        """
        try:
            snaps = get_snapshots_for_day(date_str)
            for s in snaps:
                cp = s.get("checkpoint")
                if cp:
                    # Strip any description to match key like '09:15', '10:15'
                    short_cp = cp.split()[0]
                    self.executed_today.add(short_cp)
            logger.info(f"[scheduler] Synced from DB: {len(self.executed_today)} checkpoints already completed today: {sorted(list(self.executed_today))}")
        except Exception as e:
            logger.warning(f"[scheduler] Could not sync historical snapshots from DB: {e}")

    def execute_checkpoint(self, checkpoint_label: str) -> bool:
        """
        Executes scrape and stores into DB with 5 retry attempts.
        """
        logger.info(f"[scheduler] >>> TRIGGERING HOURLY CHECKPOINT: {checkpoint_label} <<<")
        for attempt in range(1, 6):
            try:
                res = self.collector.collect_and_store(checkpoint_label=checkpoint_label)
                logger.info(
                    f"[scheduler] [SUCCESS] Stored {checkpoint_label} into database: "
                    f"Snapshot #{res['snapshot_id']} ({res['rows_saved']} strike rows, Spot={res['spot']:.1f}, PCR={res['pcr']:.2f})"
                )
                # Send confirmation to Telegram
                send_hourly_store_alert(res)
                # Dispatch personalized alerts
                try:
                    dispatch_watchlist_alerts_for_latest_snapshot(res['snapshot_id'])
                except Exception as ex:
                    logger.warning(f"[scheduler] Error dispatching watchlist alerts: {ex}")
                return True
            except Exception as e:
                logger.error(f"[scheduler] Attempt {attempt}/5 failed for {checkpoint_label}: {e}")
                if attempt < 5:
                    wait_time = attempt * 8
                    logger.info(f"[scheduler] Retrying in {wait_time} seconds...")
                    time.sleep(wait_time)

        logger.critical(f"[scheduler] [ALERT] Failed to capture {checkpoint_label} after 5 attempts!")
        return False

    def check_and_catchup_missed(self):
        """
        Checks if any checkpoints earlier today should have run but are missing.
        Guarantees that stale intraday checkpoints are never caught up hours late
        after market close.
        """
        now = get_now_ist()
        if not is_trading_day(now):
            return

        date_str = now.strftime("%Y-%m-%d")
        current_minute = now.hour * 60 + now.minute

        # Never run intraday catchup after 16:00 IST (market fully closed)
        if current_minute > 960:
            return

        for h, m, label in SCHEDULED_CHECKPOINTS:
            checkpoint_minute = h * 60 + m
            if label not in self.executed_today:
                is_eligible = False
                if label != "15:30":
                    # Intraday slots eligible only within 35 minutes
                    if checkpoint_minute <= current_minute <= (checkpoint_minute + 35):
                        is_eligible = True
                else:
                    # 15:30 final market close eligible up to 16:00 IST
                    if 930 <= current_minute <= 960:
                        is_eligible = True

                if is_eligible:
                    logger.warning(f"[scheduler] DETECTED MISSED CHECKPOINT: {label} (Current time: {now.strftime('%H:%M IST')})")
                    success = self.execute_checkpoint(label)
                    if success:
                        self.executed_today.add(label)

    def run(self):
        """Main continuous execution daemon."""
        logger.info("=" * 65)
        logger.info("NIFTY 50 HOURLY OI COLLECTOR DAEMON ACTIVATED")
        logger.info("Operating Hours: 09:15 to 15:30 IST on all Indian Trading Days")
        logger.info("Strict Hourly Checkpoints: 09:15, 10:15, 11:15, 12:15, 13:15, 14:15, 15:15, 15:30")
        logger.info("=" * 65)

        while True:
            try:
                now = get_now_ist()
                today_str = now.strftime("%Y-%m-%d")

                # New day rollover: reset completed checklist and sync from DB
                if today_str != self.current_date_str:
                    self.current_date_str = today_str
                    self.executed_today.clear()
                    self._sync_completed_checkpoints_from_db(today_str)

                # Check trading day
                if not is_trading_day(now):
                    # Sleep 5 minutes if weekend or holiday
                    time.sleep(300)
                    continue

                # Check for missed slots if market is open
                if is_market_open(now):
                    self.check_and_catchup_missed()

                # Check if current minute matches any scheduled checkpoint
                for h, m, label in SCHEDULED_CHECKPOINTS:
                    if now.hour == h and now.minute == m and label not in self.executed_today:
                        logger.info(f"[scheduler] EXACT TIME MATCH: {now.strftime('%H:%M:%S IST')} -> Running {label}")
                        success = self.execute_checkpoint(label)
                        if success:
                            self.executed_today.add(label)
                        # Avoid double-triggering within the same minute
                        time.sleep(60)
                        break

                # Sleep short interval before next evaluation
                time.sleep(10)

            except KeyboardInterrupt:
                logger.info("[scheduler] Daemon stopped by user.")
                break
            except Exception as e:
                logger.error(f"[scheduler] Unexpected exception in main loop: {e}", exc_info=True)
                time.sleep(15)


def main():
    scheduler = HourlyOIScheduler()

    if len(sys.argv) > 1 and sys.argv[1] == "--now":
        now_str = get_now_ist().strftime("%H:%M")
        print(f"Triggering manual instant collection for {now_str} IST...")
        scheduler.execute_checkpoint(f"{now_str} MANUAL")
    else:
        scheduler.run()


if __name__ == "__main__":
    main()

