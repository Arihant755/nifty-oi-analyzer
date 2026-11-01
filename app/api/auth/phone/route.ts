import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { sql } from '@/lib/db';

const BOT_USERNAME = process.env.TELEGRAM_BOT_USERNAME || 'Pro9risersbot';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    let { phone, name } = body;

    if (!phone || typeof phone !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Valid phone number is required' },
        { status: 400 }
      );
    }

    // Clean phone number (keep digits, handle 10-digit Indian format)
    const cleanDigits = phone.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid 10-digit mobile number' },
        { status: 400 }
      );
    }

    // Standardize to 10 digits or 12 digits (+91)
    const standardizedPhone = cleanDigits.length === 10 ? cleanDigits : cleanDigits.slice(-10);
    const displayName = (name && typeof name === 'string' && name.trim()) ? name.trim() : `Trader ${standardizedPhone.slice(-4)}`;

    // Check if user already exists
    const existing = await sql`
      SELECT id, phone, name, telegram_chat_id, telegram_username, pair_token, created_at
      FROM app_users
      WHERE phone = ${standardizedPhone}
      LIMIT 1
    `;

    let user;
    let pairToken;

    if (existing.length > 0) {
      user = existing[0];
      pairToken = user.pair_token;
      // If pair_token is missing, generate one
      if (!pairToken) {
        pairToken = 'nifty_' + crypto.randomBytes(8).toString('hex');
        await sql`
          UPDATE app_users
          SET pair_token = ${pairToken}, updated_at = NOW()
          WHERE id = ${user.id}
        `;
      }
    } else {
      pairToken = 'nifty_' + crypto.randomBytes(8).toString('hex');
      const inserted = await sql`
        INSERT INTO app_users (phone, name, pair_token)
        VALUES (${standardizedPhone}, ${displayName}, ${pairToken})
        RETURNING id, phone, name, telegram_chat_id, telegram_username, pair_token, created_at
      `;
      user = inserted[0];
    }

    const isTelegramConnected = Boolean(user.telegram_chat_id);
    const botUrl = `https://t.me/${BOT_USERNAME}?start=${pairToken}`;

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        phone: user.phone,
        name: user.name,
        telegram_chat_id: user.telegram_chat_id,
        telegram_username: user.telegram_username,
        isTelegramConnected,
      },
      botUrl,
      botUsername: BOT_USERNAME,
      pairToken,
    });
  } catch (err: any) {
    console.error('Error in /api/auth/phone:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

