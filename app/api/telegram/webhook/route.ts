import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

async function sendTelegramMessage(chatId: number | string, text: string) {
  if (!TELEGRAM_BOT_TOKEN) return false;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e) {
    console.error('Error sending telegram message:', e);
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const update = await req.json();

    const message = update.message;
    if (!message || !message.text) {
      return NextResponse.json({ ok: true });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();
    const fromUser = message.from?.username || message.from?.first_name || 'Trader';

    // ── 1. HANDLE /start PAIRING ──────────────────────────────────────────────
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const token = parts[1]?.trim();

      if (token && token.startsWith('nifty_')) {
        // Find user with this pair_token
        const users = await sql`
          SELECT id, phone, name, telegram_chat_id
          FROM app_users
          WHERE pair_token = ${token}
          LIMIT 1
        `;

        if (users.length > 0) {
          const user = users[0];
          // Update user's telegram_chat_id
          await sql`
            UPDATE app_users
            SET telegram_chat_id = ${chatId},
                telegram_username = ${fromUser},
                updated_at = NOW()
            WHERE id = ${user.id}
          `;

          const welcomeMsg = 
            `✅ <b>Account Linked Successfully!</b>\n\n` +
            `Welcome <b>${user.name || 'Trader'}</b> (📱 ${user.phone})! 🎯\n` +
            `Your Telegram is now securely connected to <b>Nifty OI Analyzer</b>.\n\n` +
            `🔔 <b>What Happens Next:</b>\n` +
            `Whenever hourly market data updates (10:15, 11:15, 12:15, 1:15, 2:15, 3:15, 3:30 PM), ` +
            `you will receive an instant Price-to-OI breakdown for your watched strikes right here!\n\n` +
            `👉 Star ⭐ your favorite CE & PE strikes on your dashboard to activate alerts:\n` +
            `🌐 https://nifty-oi-analyzer-seven.vercel.app\n\n` +
            `Commands:\n` +
            `• /watchlist - View your active strikes\n` +
            `• /status - Live Nifty 50 market stance\n` +
            `• /help - Instructions`;

          await sendTelegramMessage(chatId, welcomeMsg);
          return NextResponse.json({ ok: true, linked: true, userId: user.id });
        }
      }

      // Default /start without valid token
      const greeting = 
        `👋 <b>Welcome to Nifty OI Analyzer Bot!</b>\n\n` +
        `This bot delivers real-time hourly Price-to-OI alerts and buildup analysis for Nifty 50.\n\n` +
        `To link your account:\n` +
        `1. Open https://nifty-oi-analyzer-seven.vercel.app\n` +
        `2. Click <b>"⭐ Watchlist & Alerts"</b>\n` +
        `3. Enter your phone number and tap <b>"Connect Telegram"</b>.\n\n` +
        `Available Commands:\n` +
        `• /status - Check current market spot & PCR\n` +
        `• /watchlist - Check your pinned strikes\n` +
        `• /help - How alerts work`;

      await sendTelegramMessage(chatId, greeting);
      return NextResponse.json({ ok: true });
    }

    // ── 2. HANDLE /watchlist COMMAND ──────────────────────────────────────────
    if (text === '/watchlist') {
      const users = await sql`
        SELECT id, name, phone
        FROM app_users
        WHERE telegram_chat_id = ${chatId}
        LIMIT 1
      `;

      if (users.length === 0) {
        await sendTelegramMessage(
          chatId,
          `⚠️ <b>No Linked Account Found</b>\n\nPlease connect your phone on https://nifty-oi-analyzer-seven.vercel.app first to manage your strike watchlist.`
        );
        return NextResponse.json({ ok: true });
      }

      const userId = users[0].id;
      const watchItems = await sql`
        SELECT strike, option_type
        FROM user_watchlists
        WHERE user_id = ${userId}
        ORDER BY strike ASC, option_type ASC
      `;

      if (watchItems.length === 0) {
        await sendTelegramMessage(
          chatId,
          `📋 <b>Your Watchlist is Empty</b>\n\nYou haven't pinned any strikes yet.\n\n👉 Open the dashboard and click ⭐ next to any Call or Put strike to start tracking:\nhttps://nifty-oi-analyzer-seven.vercel.app`
        );
        return NextResponse.json({ ok: true });
      }

      const ceStrikes = watchItems.filter((w) => w.option_type === 'CE').map((w) => `${w.strike} CE`);
      const peStrikes = watchItems.filter((w) => w.option_type === 'PE').map((w) => `${w.strike} PE`);

      const listMsg =
        `⭐ <b>Your Active Watched Strikes</b> (${watchItems.length} total):\n\n` +
        `🟢 <b>Calls (CE):</b>\n${ceStrikes.length > 0 ? ceStrikes.join(', ') : 'None'}\n\n` +
        `🔴 <b>Puts (PE):</b>\n${peStrikes.length > 0 ? peStrikes.join(', ') : 'None'}\n\n` +
        `💡 <i>You will receive hourly alerts for these exact strikes right after every market hour closes.</i>`;

      await sendTelegramMessage(chatId, listMsg);
      return NextResponse.json({ ok: true });
    }

    // ── 3. HANDLE /status COMMAND ─────────────────────────────────────────────
    if (text === '/status') {
      const latestSnaps = await sql`
        SELECT id, spot, ltp, checkpoint, pcr, max_pain, ts
        FROM snapshots
        ORDER BY ts DESC
        LIMIT 1
      `;

      if (latestSnaps.length === 0) {
        await sendTelegramMessage(chatId, `📊 No market snapshot available yet.`);
        return NextResponse.json({ ok: true });
      }

      const snap = latestSnaps[0];
      const spotVal = snap.ltp || snap.spot || 0;
      const statusMsg =
        `📊 <b>NIFTY 50 LIVE STATUS</b>\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🎯 <b>Spot / LTP:</b> <code>${spotVal.toFixed(2)}</code>\n` +
        `📈 <b>Put-Call Ratio (PCR):</b> <code>${snap.pcr?.toFixed(2) || '1.0'}</code>\n` +
        `⚖️ <b>Max Pain Strike:</b> <code>${snap.max_pain || 'N/A'}</code>\n` +
        `⏰ <b>Last Checkpoint:</b> ${snap.checkpoint}\n` +
        `━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🌐 Open Live Interactive Dashboard:\nhttps://nifty-oi-analyzer-seven.vercel.app`;

      await sendTelegramMessage(chatId, statusMsg);
      return NextResponse.json({ ok: true });
    }

    // ── 4. HANDLE /help COMMAND ───────────────────────────────────────────────
    if (text === '/help') {
      const helpMsg =
        `ℹ️ <b>Nifty OI Analyzer Bot Help</b>\n\n` +
        `• <b>How it works:</b>\n` +
        `Star (⭐) 3 to 4 Call (CE) and Put (PE) strikes on your dashboard.\n` +
        `At 10:15, 11:15, 12:15, 1:15, 2:15, 3:15, and 3:30 PM, this bot automatically calculates Price vs OI changes and tells you:\n` +
        ` - Long Buildup (Option Buyers Active)\n` +
        ` - Short Covering (Shorts Closing / Rally)\n` +
        ` - Short Buildup (Writers Active / Walls)\n` +
        ` - Long Covering (Longs Unwinding / Profit Booking)\n\n` +
        `Dashboard: https://nifty-oi-analyzer-seven.vercel.app`;

      await sendTelegramMessage(chatId, helpMsg);
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('Webhook error:', err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

// GET handler to inspect webhook status or set webhook
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const action = searchParams.get('action');

    if (!TELEGRAM_BOT_TOKEN) {
      return NextResponse.json({ error: 'TELEGRAM_BOT_TOKEN not configured' }, { status: 500 });
    }

    if (action === 'setWebhook') {
      const targetUrl = `https://nifty-oi-analyzer-seven.vercel.app/api/telegram/webhook`;
      const res = await fetch(
        `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?url=${encodeURIComponent(targetUrl)}`
      );
      const json = await res.json();
      return NextResponse.json(json);
    }

    // Default: get webhook info
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`);
    const json = await res.json();
    return NextResponse.json(json);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

