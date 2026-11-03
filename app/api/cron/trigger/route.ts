import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const key = searchParams.get('key');
    const expectedKey = process.env.CRON_SECRET || 'nifty_oi_cron_secure_key';

    if (
      key !== 'nifty_oi_cron_secure_key' &&
      key !== expectedKey &&
      req.headers.get('x-cron-secret') !== expectedKey
    ) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Check IST time
    const now = new Date();
    const utcHours = now.getUTCHours();
    const utcMins = now.getUTCMinutes();
    const istMins = (utcHours * 60 + utcMins + 330) % 1440; // IST is UTC + 5:30 (330 mins)

    // Market hours: 09:10 to 15:35 IST (550 to 935 minutes)
    if (istMins < 550 || istMins > 935) {
      return NextResponse.json({
        success: true,
        message: 'Market is closed. No action required.',
        istTime: `${Math.floor(istMins / 60)}:${istMins % 60}`,
      });
    }

    // Trigger GitHub Actions workflow dispatch immediately via GitHub API
    const ghToken = process.env.GITHUB_PAT || process.env.GITHUB_TOKEN;
    if (ghToken) {
      const ghRes = await fetch(
        'https://api.github.com/repos/Arihant755/nifty-oi-analyzer/actions/workflows/hourly_scraper.yml/dispatches',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${ghToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
            'User-Agent': 'Nifty-OI-Analyzer-Cloud-Cron',
          },
          body: JSON.stringify({ ref: 'main' }),
        }
      );

      if (ghRes.ok || ghRes.status === 204) {
        return NextResponse.json({
          success: true,
          message: 'Dispatched GitHub Actions scraper workflow immediately',
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Trigger verified. Market is open.',
      istMinutes: istMins,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}

