import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { interpretPriceToOI } from '@/lib/price-to-oi';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(req: NextRequest) {
  try {
    const { userId } = await req.json();
    if (!userId) {
      return NextResponse.json({ success: false, error: 'userId is required' }, { status: 400 });
    }

    // Get user
    const users = await sql`
      SELECT id, name, phone, telegram_chat_id
      FROM app_users
      WHERE id = ${userId}
      LIMIT 1
    `;

    if (users.length === 0 || !users[0].telegram_chat_id) {
      return NextResponse.json(
        { success: false, error: 'User does not have Telegram linked yet' },
        { status: 400 }
      );
    }

    const u = users[0];
    const chatId = u.telegram_chat_id;

    // Get user's watched strikes
    const watchItems = await sql`
      SELECT strike, option_type
      FROM user_watchlists
      WHERE user_id = ${userId}
      ORDER BY strike ASC, option_type ASC
    `;

    if (watchItems.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Please pin at least one strike (CE or PE) to your watchlist first.' },
        { status: 400 }
      );
    }

    // Get latest 2 snapshots
    const snaps = await sql`
      SELECT id, spot, ltp, checkpoint, pcr, ts
      FROM snapshots
      ORDER BY ts DESC
      LIMIT 2
    `;

    const latestSnap = snaps[0];
    const prevSnap = snaps[1] || snaps[0];
    const spotCurrent = latestSnap?.ltp || latestSnap?.spot || 23053.1;
    const spotPrev = prevSnap?.ltp || prevSnap?.spot || spotCurrent;
    const spotDelta = Math.round((spotCurrent - spotPrev) * 100) / 100;
    const pcr = latestSnap?.pcr?.toFixed(2) || '1.62';
    const checkpoint = latestSnap?.checkpoint || 'LIVE';

    // Get strike rows from latest & prev
    const latestRows = await sql`
      SELECT strike, option_type, ltp, oi, change_oi
      FROM chain_rows
      WHERE snapshot_id = ${latestSnap.id}
    `;
    const prevRows = await sql`
      SELECT strike, option_type, ltp, oi, change_oi
      FROM chain_rows
      WHERE snapshot_id = ${prevSnap.id}
    `;

    const latestMap = new Map();
    latestRows.forEach((r) => latestMap.set(`${r.strike}_${r.option_type}`, r));

    const prevMap = new Map();
    prevRows.forEach((r) => prevMap.set(`${r.strike}_${r.option_type}`, r));

    const ceLines: string[] = [];
    const peLines: string[] = [];

    for (const w of watchItems) {
      const key = `${w.strike}_${w.option_type}`;
      const curData = latestMap.get(key);
      const prvData = prevMap.get(key);

      const curLtp = curData?.ltp ? Number(curData.ltp) : 100.0;
      const prvLtp = prvData?.ltp ? Number(prvData.ltp) : curLtp;
      const deltaP = Math.round((curLtp - prvLtp) * 100) / 100;

      const curOi = curData?.oi ? Number(curData.oi) : 50000;
      const prvOi = prvData?.oi ? Number(prvData.oi) : curOi;
      const deltaOi = curOi - prvOi;

      const analysis = interpretPriceToOI(w.option_type, curLtp, prvLtp, curOi, prvOi);
      const obs = analysis.observation;

      let badge = '⚪ Similar / No Big Change';
      if (obs === 'LONG BUILD UP') {
        badge = w.option_type === 'CE' ? '🟢 LONG BUILDUP (Bullish)' : '🔴 LONG BUILDUP (Put Buying / Bearish)';
      } else if (obs === 'SHORT COVERING') {
        badge = w.option_type === 'CE' ? '🚀 SHORT COVERING (Rally)' : '🔻 SHORT COVERING (Bearish)';
      } else if (obs === 'SHORT BUILD UP') {
        badge = w.option_type === 'CE' ? '🔴 CALL WRITING (Resistance)' : '🟢 PUT WRITING (Support)';
      } else if (obs === 'LONG COVERING') {
        badge = w.option_type === 'CE' ? '🔻 CALL UNWINDING (Bearish)' : '🟢 PUT UNWINDING (Bullish)';
      }

      const dpStr = deltaP > 0 ? `+₹${deltaP}` : `₹${deltaP}`;
      const doiStr = deltaOi > 0 ? `+${deltaOi.toLocaleString('en-IN')}` : `${deltaOi.toLocaleString('en-IN')}`;

      const line = `• <b>${w.strike} ${w.option_type}</b>: ₹${curLtp.toFixed(1)} (${dpStr}) | OI: ${doiStr}\n  👉 <b>${badge}</b>`;

      if (w.option_type === 'CE') {
        ceLines.push(line);
      } else {
        peLines.push(line);
      }
    }

    const spotSign = spotDelta >= 0 ? `+${spotDelta}` : `${spotDelta}`;
    const msg = [
      `🔔 <b>[TEST ALERT] NIFTY 50 HOURLY OI ALERT • ${checkpoint}</b>`,
      `<i>Personalized Watchlist for ${u.name || 'Trader'}</i>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `🎯 <b>Spot / LTP:</b> <code>${spotCurrent.toFixed(2)}</code> (${spotSign} pts) | <b>PCR:</b> <code>${pcr}</code>`,
      `━━━━━━━━━━━━━━━━━━━━━━`,
      ceLines.length > 0 ? `📌 <b>Your Watched Calls (CE):</b>\n${ceLines.join('\n')}\n` : '',
      peLines.length > 0 ? `📌 <b>Your Watched Puts (PE):</b>\n${peLines.join('\n')}\n` : '',
      `━━━━━━━━━━━━━━━━━━━━━━`,
      `✅ <i>Alert system is active! You will automatically receive this alert after every market hour.</i>`,
      `🌐 https://nifty-oi-analyzer-seven.vercel.app`,
    ].filter(Boolean).join('\n');

    if (!TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ success: false, error: 'Telegram bot token not configured' }, { status: 500 });
    }

    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });

    const tgJson = await tgRes.json();
    if (!tgRes.ok || !tgJson.ok) {
      return NextResponse.json({ success: false, error: tgJson.description || 'Failed to deliver to Telegram' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Test alert delivered to Telegram successfully!' });
  } catch (err: any) {
    console.error('Error in test-alert:', err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

