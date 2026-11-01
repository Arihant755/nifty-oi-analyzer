"""
Setup User Profiles and Watchlist Tables in Supabase
"""
import sys
import os
import psycopg2

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from scraper.db import get_database_url

def create_tables():
    db_url = get_database_url()
    print("Connecting to Supabase PostgreSQL...")
    conn = psycopg2.connect(db_url, connect_timeout=15)
    
    ddl = """
    -- 1. App Users Table
    CREATE TABLE IF NOT EXISTS app_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        phone VARCHAR(20) UNIQUE NOT NULL,
        name VARCHAR(100),
        telegram_chat_id BIGINT UNIQUE,
        telegram_username VARCHAR(100),
        pair_token VARCHAR(64) UNIQUE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_users_phone ON app_users(phone);
    CREATE INDEX IF NOT EXISTS idx_app_users_pair_token ON app_users(pair_token);
    CREATE INDEX IF NOT EXISTS idx_app_users_telegram_chat_id ON app_users(telegram_chat_id);

    -- 2. User Watchlists Table
    CREATE TABLE IF NOT EXISTS user_watchlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        strike INTEGER NOT NULL,
        option_type VARCHAR(10) NOT NULL CHECK (option_type IN ('CE', 'PE')),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (user_id, strike, option_type)
    );

    CREATE INDEX IF NOT EXISTS idx_user_watchlists_user_id ON user_watchlists(user_id);
    """
    
    try:
        with conn.cursor() as cur:
            cur.execute(ddl)
        conn.commit()
        print("[SUCCESS] Tables 'app_users' and 'user_watchlists' created/verified in Supabase.")
    except Exception as e:
        conn.rollback()
        print(f"[ERROR] Failed to create tables: {e}")
        raise e
    finally:
        conn.close()

if __name__ == "__main__":
    create_tables()

