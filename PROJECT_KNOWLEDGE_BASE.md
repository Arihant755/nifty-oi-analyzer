# NIFTY 50 OI ANALYZER & AUTONOMOUS TELEGRAM CO-PILOT
## Complete System Architecture, Knowledge Base & Technical Blueprint

> **Document Purpose:** This document serves as the single source of truth (SSOT) and knowledge base for the Nifty 50 Open Interest (OI) Analyzer project. It contains top-to-bottom information covering business logic, financial models, system architecture, database schemas, scraper pipelines, frontend UI, cloud infrastructure, API references, troubleshooting guides, and product roadmap. Any AI model or developer reading this document will possess 100% technical and operational context about the project.

---

## 1. Executive Summary & Value Proposition

### 1.1 What is Nifty OI Analyzer?
Nifty OI Analyzer is an enterprise-grade, cloud-native derivatives analytics platform designed specifically for the Indian stock market (NSE - National Stock Exchange of India). It tracks, records, analyzes, and interprets Open Interest (OI) dynamics for Nifty 50 options contracts across strictly timed hourly checkpoints during Indian trading hours (09:15 AM to 03:30 PM IST).

### 1.2 Core Problem Solved
1. **The Intraday Blindspot:** Retail traders often miss institutional money flows ("smart money" buildup) because they cannot sit at a screen refreshing option chains every minute while working their day jobs.
2. **Information Overload:** Mainstream tools (Sensibull, Opstra, Quantsapp) overwhelm users with complex multi-tab interfaces. Traders want clear, actionable signals delivered directly to where they communicate: **Telegram**.
3. **Historical Context:** Standard broker platforms only show current Open Interest or End-of-Day (EOD) snapshots. This system stores persistent hourly historical snapshots, enabling traders to compare how institutional positioning shifted between 09:15 AM, 12:15 PM, and 03:15 PM.

### 1.3 Key Innovations
* **Dual Telegram Notification Engine:**
  * **Broadcast Alerts:** Posts a comprehensive market overview to a shared VIP community channel.
  * **Personalized 1-on-1 DMs:** Automatically sends personalized alerts to individual traders covering their specific starred/watched strikes, categorizing every strike into exact institutional price-to-OI regimes.
* **Dual-Cloud Redundancy:** Runs an active 24/7 background scheduler on **Render**, backed up by automated cloud cron workflows on **GitHub Actions**, backed by database deduplication logic to ensure 0 missed hours and 0 duplicate alerts.
* **Akamai Anti-Bot Bypass:** Uses browser-fingerprinted TLS sessions (`curl_cffi`) to scrape official NSE data reliably without costly paid third-party API dependencies, with native failover to the **DhanHQ API v2**.

---

## 2. Market Domain & Financial Logic

### 2.1 The Official Price-to-OI 4-Quadrant Matrix
Option contracts (Call / CE and Put / PE) are classified strictly using the standard financial derivative Price-to-OI matrix:

| Scenario | Price Change ($\Delta P$) | OI Change ($\Delta OI$) | Classification | Financial Interpretation | Badge |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | $\Delta P > 0$ (Price UP) | $\Delta OI > 0$ (OI UP) | **LONG BUILD UP** | Aggressive buyers entering new long positions. Strong upward momentum. | 🟢 `LONG BUILDUP` |
| **2** | $\Delta P < 0$ (Price DOWN) | $\Delta OI > 0$ (OI UP) | **SHORT BUILD UP** | Aggressive sellers/writers creating new short positions. Heavy resistance / downward pressure. | 🔴 `SHORT BUILDUP` |
| **3** | $\Delta P > 0$ (Price UP) | $\Delta OI < 0$ (OI DOWN) | **SHORT COVERING** | Sellers panic-buying to close short positions. Sharp explosive rally / squeeze. | 🚀 `SHORT COVERING` |
| **4** | $\Delta P < 0$ (Price DOWN) | $\Delta OI < 0$ (OI DOWN) | **LONG COVERING** | Long holders closing/unwinding profitable or losing longs. Lack of buying support. | 🔻 `LONG COVERING` |
| **5** | $\Delta P \approx 0$ or $\Delta OI \approx 0$ | Negligible change | **NO BIG CHANGE** | Sideways or consolidation. Insignificant institutional activity. | ⚪ `NO BIG CHANGE` |

### 2.2 Put-Call Ratio (PCR) Interpretation
Put-Call Ratio is calculated as:
$$\text{PCR} = \frac{\sum \text{Total Put Open Interest (PE OI)}}{\sum \text{Total Call Open Interest (CE OI)}}$$

In Indian markets, where option writers (sellers) represent institutional capital:
* **$\text{PCR} \ge 1.25$:** 🟢 **Strongly Bullish** (Heavy Put writing by institutions; strong support).
* **$1.05 \le \text{PCR} < 1.25$:** 🟢 **Mildly Bullish** (Positive bias).
* **$0.95 \le \text{PCR} < 1.05$:** ⚖️ **Neutral / Range-Bound** (Equilibrium between Call & Put writers).
* **$0.75 \le \text{PCR} < 0.95$:** 🔴 **Mildly Bearish** (Moderate Call writing).
* **$\text{PCR} < 0.75$:** 🔴 **Strongly Bearish** (Heavy Call writing; strong overhead resistance).

### 2.3 True Max Pain Theory
Max Pain is the strike price at which the total financial payout to all option buyers (CE + PE) is minimized, causing maximum monetary loss to option buyers and maximum profit to option sellers on expiry day.
$$\text{Total Loss}(S_k) = \sum_{S_i < S_k} (S_k - S_i) \times \text{OI}_{\text{CE}}(S_i) + \sum_{S_j > S_k} (S_j - S_k) \times \text{OI}_{\text{PE}}(S_j)$$
The algorithm tests every active strike $S_k$ across the chain and selects the strike that minimizes $\text{Total Loss}$.

### 2.4 Strict Trading Schedule & Checkpoints
The system operates exclusively during Indian Stock Market hours (Monday to Friday, excluding NSE official trading holidays):
1. **09:15 IST:** Market Open Baseline
2. **10:15 IST:** Hour 1 Checkpoint
3. **11:15 IST:** Hour 2 Checkpoint
4. **12:15 IST:** Hour 3 Midday Checkpoint
5. **13:15 IST:** Hour 4 Afternoon Checkpoint
6. **14:15 IST:** Hour 5 European Open Checkpoint
7. **15:15 IST:** Hour 6 Pre-Close Checkpoint
8. **15:30 IST:** Market Close Final Checkpoint

---

## 3. Technology Stack & Architecture

### 3.1 Architectural Overview Diagram
```
                       +---------------------------------------+
                       |           NSE India Servers           |
                       +---------------------------------------+
                                           |
                    (TLS-fingerprinted curl_cffi / Dhan API)
                                           v
    +------------------------------------------------------------------------+
    |                         Scraping & Alert Engine                        |
    |                                                                        |
    |   [Primary Daemon: Render]                 [Backup: GitHub Actions]    |
    |   python -m scraper.scheduler              hourly_scraper.yml          |
    |   (Listens on :10000 /healthz)             (Scheduled cron trigger)     |
    +------------------------------------------------------------------------+
                               |                 |
                   (Store & Sync)               (Send Alerts)
                               v                 v
           +-----------------------------+     +-------------------------------+
           |    Supabase PostgreSQL      |     |         Telegram Bot          |
           |  - hourly_snapshots         |     |       (@Pro9risersbot)        |
           |  - option_chain_rows        |     |  - Group: -1003944691807      |
           |  - app_users                |     |  - DMs: Personalized alerts   |
           |  - user_watchlists          |     +-------------------------------+
           +-----------------------------+
                               ^
                               | (API & Queries)
           +---------------------------------------------+
           |       Next.js 14 Web Application            |
           |     (Hosted on Vercel Production)           |
           |  - Live Option Chain Table & Filters        |
           |  - Multi-Checkpoint Comparison Engine       |
           |  - Strike History Visualization             |
           |  - Mobile Phone OTP Auth & Watchlist Sync   |
           +---------------------------------------------+
```

### 3.2 Technology Breakdown
* **Web Frontend & API Backend:** Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, Lucide Icons.
* **Scraper & Daemons:** Python 3.10+, `curl_cffi` (bypasses Cloudflare/Akamai via Chrome 120 TLS fingerprinting), `psycopg2-binary`.
* **Database:** PostgreSQL on Supabase (hosted on AWS `ap-south-1` Mumbai) using transaction/session poolers (`port 6543`).
* **Hosting Platforms:**
  * **Vercel:** Hosts the Next.js frontend, API endpoints, and serverless routes.
  * **Render (Free Web Service Tier):** Runs the continuous Python scheduler daemon with an embedded multi-threaded HTTP server on port 10000.
  * **UptimeRobot:** Pings `https://nifty-oi-analyzer.onrender.com/healthz` every 5 minutes to prevent Render free instance spin-down.
  * **GitHub Actions:** Cloud CI/CD runner executing `.github/workflows/hourly_scraper.yml` as a fail-safe backup.

---

## 4. Database Schema Specification

The PostgreSQL database contains 5 core tables:

### 4.1 Table: `hourly_snapshots`
Stores high-level metadata for every completed hourly collection.
```sql
CREATE TABLE hourly_snapshots (
    id SERIAL PRIMARY KEY,
    captured_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    spot_price NUMERIC(10, 2) NOT NULL,
    ltp NUMERIC(10, 2),
    pcr NUMERIC(6, 3) NOT NULL,
    total_ce_oi BIGINT NOT NULL,
    total_pe_oi BIGINT NOT NULL,
    max_pain NUMERIC(10, 2) NOT NULL,
    expiry_date DATE NOT NULL,
    checkpoint VARCHAR(50) NOT NULL
);
CREATE INDEX idx_snapshots_date ON hourly_snapshots (captured_at);
CREATE INDEX idx_snapshots_checkpoint ON hourly_snapshots (checkpoint);
```

### 4.2 Table: `option_chain_rows`
Stores every individual strike row for both Call and Put options per snapshot.
```sql
CREATE TABLE option_chain_rows (
    id BIGSERIAL PRIMARY KEY,
    snapshot_id INTEGER NOT NULL REFERENCES hourly_snapshots(id) ON DELETE CASCADE,
    strike INTEGER NOT NULL,
    option_type VARCHAR(2) NOT NULL CHECK (option_type IN ('CE', 'PE')),
    ltp NUMERIC(10, 2),
    oi BIGINT NOT NULL DEFAULT 0,
    change_oi BIGINT NOT NULL DEFAULT 0,
    pchange_oi NUMERIC(8, 2) DEFAULT 0,
    volume BIGINT NOT NULL DEFAULT 0,
    iv NUMERIC(6, 2) DEFAULT 0,
    price_change NUMERIC(10, 2) DEFAULT 0,
    bid_qty INTEGER DEFAULT 0,
    bid_price NUMERIC(10, 2) DEFAULT 0,
    ask_price NUMERIC(10, 2) DEFAULT 0,
    ask_qty INTEGER DEFAULT 0
);
CREATE INDEX idx_rows_snapshot_strike ON option_chain_rows (snapshot_id, strike, option_type);
```

### 4.3 Table: `app_users`
Stores registered trader accounts authenticated via mobile phone.
```sql
CREATE TABLE app_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone VARCHAR(15) UNIQUE NOT NULL,
    name VARCHAR(100),
    telegram_chat_id BIGINT UNIQUE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### 4.4 Table: `user_watchlists`
Stores strikes starred (⭐) by users for personalized Telegram alert dispatch.
```sql
CREATE TABLE user_watchlists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    strike INTEGER NOT NULL,
    option_type VARCHAR(2) NOT NULL CHECK (option_type IN ('CE', 'PE')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, strike, option_type)
);
```

---

## 5. Python Scraper & Daemon Pipelines

### 5.1 `scraper/nse_client.py`
* **Purpose:** Handles low-level HTTP requests to `https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY`.
* **Mechanism:**
  * Uses `curl_cffi.requests.Session(impersonate="chrome120")`.
  * Waxes and warms the session by first loading `https://www.nseindia.com` to obtain required session cookies (`nsit`, `nseappid`).
  * Employs standard headers (`User-Agent`, `Referer: https://www.nseindia.com/option-chain`, `Accept: application/json`).
  * Implements retry logic with exponential backoff on HTTP 401/403/429.

### 5.2 `scraper/collector.py`
* **Purpose:** Coordinates data acquisition, mathematical calculations, and database insertion.
* **Process:**
  1. Calls `NSEClient.fetch_option_chain_v3(symbol="NIFTY")`.
  2. Parses Spot price, selected Expiry, and strike records.
  3. Computes Total CE OI, Total PE OI, PCR, and Max Pain.
  4. Inserts parent record into `hourly_snapshots`.
  5. Executes batch insert (`psycopg2.extras.execute_values`) into `option_chain_rows`.
  6. Writes local fallback cache to `scraper/latest_chain.json`.

### 5.3 `scraper/scheduler.py` (Continuous Daemon)
* **Purpose:** Primary 24/7 process deployed on Render (`python -m scraper.scheduler`).
* **Key Features:**
  * **ThreadingHTTPServer:** Starts a background HTTP server on `0.0.0.0:$PORT` (default 10000) that responds `200 OK` (`{"status":"ok","service":"nifty-oi-scheduler"}`) on `/` and `/healthz`. This satisfies Render health checks and UptimeRobot pings.
  * **DB Sync On Boot:** Calls `_sync_completed_checkpoints_from_db()` on startup so if the instance restarts mid-day, it knows which checkpoints have already run today.
  * **Missed Slot Catchup:** If the instance was asleep during a checkpoint, it automatically triggers catchup once awake.
  * **Checkpoint Execution:** At the exact minute of each checkpoint, it invokes the collector, sends the group Telegram alert, and dispatches personal alerts.

### 5.4 `scraper/watchlist_alerts.py` (Personalized Alert Engine)
* **Purpose:** Dispatches 1-on-1 private Telegram messages to registered traders.
* **Logic:**
  1. Retrieves the latest snapshot and immediately preceding snapshot to compute $\Delta P$ and $\Delta OI$.
  2. Queries all active users with a valid `telegram_chat_id` from `app_users`.
  3. Queries `user_watchlists` for that user's starred strikes.
  4. **Universal Delivery Guarantee:** If a user has no starred strikes, it still delivers the hourly market summary (Spot, $\Delta$ pts, PCR, Stance) with a prompt to star strikes. If they have starred strikes, it appends a detailed breakdown of their specific Calls and Puts with official Price-to-OI badges.

### 5.5 `scraper/cloud_runner.py` & `.github/workflows/hourly_scraper.yml` (Backup Runner)
* **Purpose:** Headless single-shot execution for GitHub Actions.
* **Schedule:** Cron triggers at `15,45 3-10 * * 1-5` and `0 10 * * 1-5` (UTC).
* **Idempotency:** Checks Supabase before running; if the checkpoint was already written by Render, it logs a skip message and terminates cleanly.

---

## 6. Next.js Web Application & API Routes

### 6.1 Frontend Views (`app/`)
* `page.tsx`: Central dashboard containing:
  * **Header:** Live spot ticker, PCR indicator, Max Pain badge, Expiry dropdown selector.
  * **Checkpoint Navigator:** Switch between 09:15, 10:15, 11:15... to view historical chains.
  * **Option Chain Matrix:** Dual-sided table displaying Calls (LTP, $\Delta P$, OI, $\Delta OI$, Badge) on the left, Strike in the middle, and Puts on the right.
  * **Star Action (⭐):** One-click toggle that saves/removes strikes from the user's watchlist.
  * **Multi-Checkpoint Comparison Modal:** Side-by-side comparison of 2 or more checkpoints showing cumulative buildup.

### 6.2 API Endpoints (`app/api/`)
| Endpoint | Method | Functionality |
| :--- | :--- | :--- |
| `/api/chain` | `GET` | Fetches option chain for selected snapshot or live state. |
| `/api/snapshots` | `GET` | Returns list of available hourly snapshots for a given date. |
| `/api/comparison` | `GET` | Computes delta metrics between any two selected snapshots. |
| `/api/strike-history` | `GET` | Returns time-series progression of a single strike across all checkpoints today. |
| `/api/watchlist` | `GET/POST/DELETE` | Manages starred strikes for the authenticated user. |
| `/api/auth/phone` | `POST` | Generates / verifies mobile phone OTP for trader login. |
| `/api/telegram/webhook` | `POST` | Telegram bot webhook handling `/start <token>` to link chat IDs to user accounts. |
| `/api/cron/trigger` | `GET/POST` | Secured webhook (`?key=...`) to trigger cloud scraper runs. |

---

## 7. Cloud Environment, Secrets & Credentials Guide

### 7.1 Environment Variables Reference

| Variable Name | Required By | Example / Format | Purpose |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | Render, Vercel, GitHub Actions | `postgresql://postgres.[ref]:[pass]@aws-0-ap-south-1.pooler.supabase.com:6543/postgres?sslmode=require` | Connection to Supabase PostgreSQL pooler |
| `TELEGRAM_BOT_TOKEN` | Render, Vercel, GitHub Actions | `8770256098:AAGx...` | Telegram Bot API token (@Pro9risersbot) |
| `TELEGRAM_CHAT_ID` | Render, Vercel, GitHub Actions | `-1003944691807` | Group channel ID for public broadcast alerts |
| `PORT` | Render | `10000` | Port for the embedded health check HTTP server |
| `DHAN_CLIENT_ID` | Scraper / Next.js | `1113536410` | DhanHQ API broker client ID (fallback feed) |
| `DHAN_ACCESS_TOKEN` | Scraper / Next.js | `eyJ0eX...` | DhanHQ API JWT token |
| `GEMINI_API_KEY` | Next.js / Insights | `AQ.Ab8RN6...` | Google Gemini AI key for automated market commentary |
| `CRON_SECRET` | Vercel | `oi_analyzer_cron_secret_key_2026` | Protection key for `/api/cron/trigger` |

---

## 8. Common Troubleshooting & Runbooks

### Issue 1: `FATAL: tenant/user postgres.xxxx not found`
* **Root Cause:** Render or GitHub Actions is using an old, deleted Supabase project connection string.
* **Resolution:** Update `DATABASE_URL` in Render Environment Settings and GitHub Secrets to the active Supabase project reference (`postgres.szyjzmqxvpjkygqikyii`).

### Issue 2: Render Free Tier "Service Unavailable" / UptimeRobot Red
* **Root Cause:** Render free web services spin down after 15 minutes of HTTP inactivity.
* **Resolution:**
  1. Ensure `PORT=10000` is set in Render Environment.
  2. Set UptimeRobot monitor to `https://nifty-oi-analyzer.onrender.com/healthz` with a **5-minute** interval.
  3. Ensure start command in Render is explicitly: `python -m scraper.scheduler`.

### Issue 3: Personal Alerts Not Delivered on Telegram
* **Root Cause:**
  1. User hasn't clicked `/start` in `@Pro9risersbot` (bot cannot initiate DMs without user consent).
  2. Check `app_users` table: verify `telegram_chat_id` is populated.
  3. The `watchlist_alerts.py` script now has a universal fallback that sends hourly summaries even if `user_watchlists` is empty.

### Issue 4: NSE Scraper Returns HTTP 403 Forbidden
* **Root Cause:** NSE IP rate-limiting or missing cookies.
* **Resolution:** `NSEClient` automatically discards expired cookies and warms a fresh session with Chrome 120 TLS fingerprinting via `curl_cffi`. If persistent, failover to Dhan API occurs.

---

## 9. Commercial Product Roadmap & Monetization

### 9.1 Target Audience
* Part-time retail F&O traders and working professionals who need institutional options data delivered to Telegram without staring at trading terminals.

### 9.2 Subscription Tiers
1. **Free Tier:**
   * Access to web dashboard (delayed/hourly view).
   * 3 broadcast alerts per day (09:15, 12:15, 15:30) on public Telegram group.
2. **Pro Trader Tier (₹299/month or ₹2,499/year):**
   * Real-time hourly alerts directly to personal Telegram DM.
   * Unlimited starred strikes with Price-to-OI badges.
   * Multi-index coverage: **Nifty 50, Bank Nifty, and Sensex**.
   * Instant breakout triggers (e.g., Short Covering / Short Squeeze alerts).

### 9.3 Compliance & SEBI Guardrails
* The product operates strictly as an **educational and analytical quantitative software tool**.
* It never issues buy/sell tips, stop losses, or target prices.
* Every alert and web screen carries mandatory statutory risk disclaimers regarding derivative trading risks.
