import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { interpretPriceToOI, PriceToOIInterpretation } from '@/lib/price-to-oi';

export const dynamic = 'force-dynamic';

export interface ComparedStrikeRow {
  strike: number;
  isATM: boolean;
  isITMCall: boolean;
  isITMPut: boolean;
  ce: {
    fromLtp: number;
    toLtp: number;
    deltaPrice: number;
    pchangePrice: number;
    fromOI: number;
    toOI: number;
    deltaOI: number;
    pchangeOI: number;
    volume: number;
    iv: number;
    analysis: PriceToOIInterpretation;
  };
  pe: {
    fromLtp: number;
    toLtp: number;
    deltaPrice: number;
    pchangePrice: number;
    fromOI: number;
    toOI: number;
    deltaOI: number;
    pchangeOI: number;
    volume: number;
    iv: number;
    analysis: PriceToOIInterpretation;
  };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fromIdParam = searchParams.get('fromId');
    const toIdParam = searchParams.get('toId');

    if (!fromIdParam || !toIdParam) {
      return NextResponse.json(
        { success: false, error: 'Both fromId and toId parameters are required' },
        { status: 400 }
      );
    }

    const fromId = parseInt(fromIdParam, 10);
    const toId = parseInt(toIdParam, 10);

    // Fetch snapshot metadata
    const [fromSnapRows, toSnapRows] = await Promise.all([
      sql`SELECT id, ts, spot, ltp, checkpoint, pcr, total_ce_oi, total_pe_oi, max_pain FROM snapshots WHERE id = ${fromId};`,
      sql`SELECT id, ts, spot, ltp, checkpoint, pcr, total_ce_oi, total_pe_oi, max_pain FROM snapshots WHERE id = ${toId};`,
    ]);

    if (!fromSnapRows.length || !toSnapRows.length) {
      return NextResponse.json(
        { success: false, error: 'One or both snapshot IDs not found' },
        { status: 404 }
      );
    }

    let fromSnap = fromSnapRows[0];
    let toSnap = toSnapRows[0];
    let actualFromId = fromId;
    let actualToId = toId;

    // Ensure strict chronological order: from must ALWAYS be the earlier snapshot, to must ALWAYS be the later snapshot
    if (new Date(fromSnap.ts).getTime() > new Date(toSnap.ts).getTime()) {
      const tempSnap = fromSnap;
      fromSnap = toSnap;
      toSnap = tempSnap;
      actualFromId = toId;
      actualToId = fromId;
    }

    // Fetch all chain rows for both snapshots
    const [fromChainRows, toChainRows] = await Promise.all([
      sql`SELECT strike, type, ltp, oi, volume, iv FROM chain_rows WHERE snapshot_id = ${actualFromId};`,
      sql`SELECT strike, type, ltp, oi, volume, iv FROM chain_rows WHERE snapshot_id = ${actualToId};`,
    ]);

    // Build lookup maps: key = `${strike}_${type}`
    const fromMap = new Map<string, any>();
    for (const r of fromChainRows) {
      fromMap.set(`${r.strike}_${r.type}`, r);
    }

    const toMap = new Map<string, any>();
    const allStrikesSet = new Set<number>();
    for (const r of toChainRows) {
      toMap.set(`${r.strike}_${r.type}`, r);
      allStrikesSet.add(Number(r.strike));
    }

    // Find ATM strike
    const toSpot = Number(toSnap.spot);
    const sortedStrikes = Array.from(allStrikesSet).sort((a, b) => a - b);
    let closestStrike = sortedStrikes[0] || 0;
    let minDistance = Infinity;
    for (const s of sortedStrikes) {
      const d = Math.abs(s - toSpot);
      if (d < minDistance) {
        minDistance = d;
        closestStrike = s;
      }
    }

    // Summary counters
    const summary = {
      ce: {
        longBuildup: 0,
        shortBuildup: 0,
        shortCovering: 0,
        longCovering: 0,
        similar: 0,
        totalOIChange: 0,
      },
      pe: {
        longBuildup: 0,
        shortBuildup: 0,
        shortCovering: 0,
        longCovering: 0,
        similar: 0,
        totalOIChange: 0,
      },
      marketStance: 'NEUTRAL' as 'BULLISH' | 'STRONG BULLISH' | 'BEARISH' | 'STRONG BEARISH' | 'NEUTRAL',
      sentimentScore: 0, // positive = bullish, negative = bearish
      keyObservations: [] as string[],
    };

    const comparedRows: ComparedStrikeRow[] = [];

    for (const strike of sortedStrikes) {
      const isATM = strike === closestStrike;
      const isITMCall = strike < toSpot;
      const isITMPut = strike > toSpot;

      // CALL SIDE (CE)
      const ceFrom = fromMap.get(`${strike}_CE`) || { ltp: 0, oi: 0, volume: 0, iv: 0 };
      const ceTo = toMap.get(`${strike}_CE`) || { ltp: 0, oi: 0, volume: 0, iv: 0 };
      const ceFromLtp = Number(ceFrom.ltp) || 0;
      const ceToLtp = Number(ceTo.ltp) || 0;
      const ceFromOI = Number(ceFrom.oi) || 0;
      const ceToOI = Number(ceTo.oi) || 0;
      const ceDeltaPrice = Number((ceToLtp - ceFromLtp).toFixed(2));
      const ceDeltaOI = ceToOI - ceFromOI;
      const cePchangePrice = ceFromLtp > 0 ? Number(((ceDeltaPrice / ceFromLtp) * 100).toFixed(2)) : 0;
      const cePchangeOI = ceFromOI > 0 ? Number(((ceDeltaOI / ceFromOI) * 100).toFixed(2)) : 0;
      const ceAnalysis = interpretPriceToOI('CE', ceToLtp, ceFromLtp, ceToOI, ceFromOI);

      // PUT SIDE (PE)
      const peFrom = fromMap.get(`${strike}_PE`) || { ltp: 0, oi: 0, volume: 0, iv: 0 };
      const peTo = toMap.get(`${strike}_PE`) || { ltp: 0, oi: 0, volume: 0, iv: 0 };
      const peFromLtp = Number(peFrom.ltp) || 0;
      const peToLtp = Number(peTo.ltp) || 0;
      const peFromOI = Number(peFrom.oi) || 0;
      const peToOI = Number(peTo.oi) || 0;
      const peDeltaPrice = Number((peToLtp - peFromLtp).toFixed(2));
      const peDeltaOI = peToOI - peFromOI;
      const pePchangePrice = peFromLtp > 0 ? Number(((peDeltaPrice / peFromLtp) * 100).toFixed(2)) : 0;
      const pePchangeOI = peFromOI > 0 ? Number(((peDeltaOI / peFromOI) * 100).toFixed(2)) : 0;
      const peAnalysis = interpretPriceToOI('PE', peToLtp, peFromLtp, peToOI, peFromOI);

      // Aggregate counters
      summary.ce.totalOIChange += ceDeltaOI;
      summary.pe.totalOIChange += peDeltaOI;

      // Count CE observations
      if (ceAnalysis.observation === 'LONG BUILD UP') summary.ce.longBuildup++;
      else if (ceAnalysis.observation === 'SHORT BUILD UP') summary.ce.shortBuildup++;
      else if (ceAnalysis.observation === 'SHORT COVERING') summary.ce.shortCovering++;
      else if (ceAnalysis.observation === 'LONG COVERING') summary.ce.longCovering++;
      else summary.ce.similar++;

      // Count PE observations
      if (peAnalysis.observation === 'LONG BUILD UP') summary.pe.longBuildup++;
      else if (peAnalysis.observation === 'SHORT BUILD UP') summary.pe.shortBuildup++;
      else if (peAnalysis.observation === 'SHORT COVERING') summary.pe.shortCovering++;
      else if (peAnalysis.observation === 'LONG COVERING') summary.pe.longCovering++;
      else summary.pe.similar++;

      // Calculate sentiment contribution (focus on ±500 points around ATM)
      if (Math.abs(strike - toSpot) <= 500) {
        // Bullish points
        if (ceAnalysis.equityView === 'STRONG BULLISH') summary.sentimentScore += 2;
        else if (ceAnalysis.equityView === 'BULLISH') summary.sentimentScore += 1;
        if (peAnalysis.equityView === 'STRONG BULLISH') summary.sentimentScore += 2;
        else if (peAnalysis.equityView === 'BULLISH') summary.sentimentScore += 1;

        // Bearish points
        if (ceAnalysis.equityView === 'STRONG BEARISH') summary.sentimentScore -= 2;
        else if (ceAnalysis.equityView === 'BEARISH') summary.sentimentScore -= 1;
        if (peAnalysis.equityView === 'STRONG BEARISH') summary.sentimentScore -= 2;
        else if (peAnalysis.equityView === 'BEARISH') summary.sentimentScore -= 1;
      }

      comparedRows.push({
        strike,
        isATM,
        isITMCall,
        isITMPut,
        ce: {
          fromLtp: ceFromLtp,
          toLtp: ceToLtp,
          deltaPrice: ceDeltaPrice,
          pchangePrice: cePchangePrice,
          fromOI: ceFromOI,
          toOI: ceToOI,
          deltaOI: ceDeltaOI,
          pchangeOI: cePchangeOI,
          volume: Number(ceTo.volume) || 0,
          iv: Number(ceTo.iv) || 0,
          analysis: ceAnalysis,
        },
        pe: {
          fromLtp: peFromLtp,
          toLtp: peToLtp,
          deltaPrice: peDeltaPrice,
          pchangePrice: pePchangePrice,
          fromOI: peFromOI,
          toOI: peToOI,
          deltaOI: peDeltaOI,
          pchangeOI: pePchangeOI,
          volume: Number(peTo.volume) || 0,
          iv: Number(peTo.iv) || 0,
          analysis: peAnalysis,
        },
      });
    }

    // Determine overall market stance
    if (summary.sentimentScore >= 6) summary.marketStance = 'STRONG BULLISH';
    else if (summary.sentimentScore >= 2) summary.marketStance = 'BULLISH';
    else if (summary.sentimentScore <= -6) summary.marketStance = 'STRONG BEARISH';
    else if (summary.sentimentScore <= -2) summary.marketStance = 'BEARISH';
    else summary.marketStance = 'NEUTRAL';

    // Key observation bullets strictly based on Price-to-OI chart
    if (summary.ce.shortBuildup > 3) {
      summary.keyObservations.push(`Call Short Buildup detected across ${summary.ce.shortBuildup} strikes.`);
    }
    if (summary.pe.shortBuildup > 3) {
      summary.keyObservations.push(`Put Short Buildup detected across ${summary.pe.shortBuildup} strikes.`);
    }
    if (summary.ce.shortCovering > 2) {
      summary.keyObservations.push(`Call Short Covering detected across ${summary.ce.shortCovering} strikes.`);
    }
    if (summary.pe.longBuildup > 2) {
      summary.keyObservations.push(`Put Long Buildup detected across ${summary.pe.longBuildup} strikes.`);
    }
    if (summary.ce.longBuildup > 2) {
      summary.keyObservations.push(`Call Long Buildup detected across ${summary.ce.longBuildup} strikes.`);
    }

    return NextResponse.json({
      success: true,
      comparison: {
        from: {
          id: fromSnap.id,
          timestamp: fromSnap.ts,
          checkpoint: fromSnap.checkpoint,
          spot: Number(fromSnap.spot),
          ltp: Number(fromSnap.ltp || fromSnap.spot),
          pcr: Number(fromSnap.pcr),
        },
        to: {
          id: toSnap.id,
          timestamp: toSnap.ts,
          checkpoint: toSnap.checkpoint,
          spot: Number(toSnap.spot),
          ltp: Number(toSnap.ltp || toSnap.spot),
          pcr: Number(toSnap.pcr),
        },
        deltaSpot: Number((Number(toSnap.spot) - Number(fromSnap.spot)).toFixed(2)),
        deltaPCR: Number((Number(toSnap.pcr) - Number(fromSnap.pcr)).toFixed(3)),
        summary,
        rows: comparedRows,
      },
    });
  } catch (error: any) {
    console.error('Error in comparison endpoint:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Comparison calculation failed' },
      { status: 500 }
    );
  }
}

