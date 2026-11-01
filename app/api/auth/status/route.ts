import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const phone = searchParams.get('phone');

    if (!userId && !phone) {
      return NextResponse.json(
        { success: false, error: 'userId or phone is required' },
        { status: 400 }
      );
    }

    let rows;
    if (userId) {
      rows = await sql`
        SELECT id, phone, name, telegram_chat_id, telegram_username, pair_token
        FROM app_users
        WHERE id = ${userId}
        LIMIT 1
      `;
    } else {
      const cleanPhone = (phone || '').replace(/\D/g, '').slice(-10);
      rows = await sql`
        SELECT id, phone, name, telegram_chat_id, telegram_username, pair_token
        FROM app_users
        WHERE phone = ${cleanPhone}
        LIMIT 1
      `;
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    const u = rows[0];
    const isTelegramConnected = Boolean(u.telegram_chat_id);
    const botUsername = process.env.TELEGRAM_BOT_USERNAME || 'Pro9risersbot';
    const botUrl = `https://t.me/${botUsername}?start=${u.pair_token}`;

    return NextResponse.json({
      success: true,
      user: {
        id: u.id,
        phone: u.phone,
        name: u.name,
        telegram_chat_id: u.telegram_chat_id,
        telegram_username: u.telegram_username,
        isTelegramConnected,
      },
      botUrl,
      botUsername,
    });
  } catch (err: any) {
    console.error('Error in /api/auth/status:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

