import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'userId is required' },
        { status: 400 }
      );
    }

    const rows = await sql`
      SELECT strike, option_type, created_at
      FROM user_watchlists
      WHERE user_id = ${userId}
      ORDER BY strike ASC, option_type ASC
    `;

    return NextResponse.json({
      success: true,
      watchlist: rows.map((r) => ({
        strike: r.strike,
        option_type: r.option_type as 'CE' | 'PE',
        created_at: r.created_at,
      })),
    });
  } catch (err: any) {
    console.error('Error in GET /api/watchlist:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, strike, option_type, action } = body;

    if (!userId || !strike || !option_type) {
      return NextResponse.json(
        { success: false, error: 'userId, strike, and option_type (CE/PE) are required' },
        { status: 400 }
      );
    }

    if (option_type !== 'CE' && option_type !== 'PE') {
      return NextResponse.json(
        { success: false, error: 'option_type must be either CE or PE' },
        { status: 400 }
      );
    }

    const numericStrike = parseInt(strike, 10);
    if (isNaN(numericStrike)) {
      return NextResponse.json(
        { success: false, error: 'Invalid strike' },
        { status: 400 }
      );
    }

    // Check if strike already in watchlist
    const existing = await sql`
      SELECT id FROM user_watchlists
      WHERE user_id = ${userId} AND strike = ${numericStrike} AND option_type = ${option_type}
      LIMIT 1
    `;

    const isPresent = existing.length > 0;
    let shouldAdd = false;

    if (action === 'add') {
      shouldAdd = true;
    } else if (action === 'remove') {
      shouldAdd = false;
    } else {
      // Toggle mode
      shouldAdd = !isPresent;
    }

    if (shouldAdd && !isPresent) {
      await sql`
        INSERT INTO user_watchlists (user_id, strike, option_type)
        VALUES (${userId}, ${numericStrike}, ${option_type})
        ON CONFLICT (user_id, strike, option_type) DO NOTHING
      `;
    } else if (!shouldAdd && isPresent) {
      await sql`
        DELETE FROM user_watchlists
        WHERE user_id = ${userId} AND strike = ${numericStrike} AND option_type = ${option_type}
      `;
    }

    // Return current updated watchlist
    const updated = await sql`
      SELECT strike, option_type, created_at
      FROM user_watchlists
      WHERE user_id = ${userId}
      ORDER BY strike ASC, option_type ASC
    `;

    return NextResponse.json({
      success: true,
      action: shouldAdd ? 'added' : 'removed',
      strike: numericStrike,
      option_type,
      watchlist: updated.map((r) => ({
        strike: r.strike,
        option_type: r.option_type as 'CE' | 'PE',
        created_at: r.created_at,
      })),
    });
  } catch (err: any) {
    console.error('Error in POST /api/watchlist:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

