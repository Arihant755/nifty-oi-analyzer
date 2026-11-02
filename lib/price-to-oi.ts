/**
 * Price to OI Conclusion Engine (TypeScript)
 * ==========================================
 * Implements the exact Price-to-OI matrix logic for Calls & Puts
 * with deadband noise filtering (Price <= +-2, OI <= +-1000).
 */

export const PRICE_THRESHOLD = 2.0;
export const OI_THRESHOLD = 1000;

export type ObservationType =
  | 'LONG BUILD UP'
  | 'LONG COVERING'
  | 'SHORT BUILD UP'
  | 'SHORT COVERING'
  | 'NEUTRAL / SIMILAR';

export type SentimentView =
  | 'BULLISH'
  | 'STRONG BULLISH'
  | 'BEARISH'
  | 'STRONG BEARISH'
  | 'NEUTRAL';

export interface PriceToOIInterpretation {
  observation: ObservationType;
  optionView: SentimentView;
  equityView: SentimentView;
  deltaPrice: number;
  deltaOI: number;
  conclusion: string;
  isSignificant: boolean;
}

export function interpretPriceToOI(
  optionType: 'CE' | 'PE',
  currentPrice: number,
  previousPrice: number,
  currentOI: number,
  previousOI: number,
  priceThreshold: number = PRICE_THRESHOLD,
  oiThreshold: number = OI_THRESHOLD
): PriceToOIInterpretation {
  const deltaPrice = Number((currentPrice - previousPrice).toFixed(2));
  const deltaOI = currentOI - previousOI;

  // Deadband check
  if (Math.abs(deltaPrice) <= priceThreshold || Math.abs(deltaOI) <= oiThreshold) {
    return {
      observation: 'NEUTRAL / SIMILAR',
      optionView: 'NEUTRAL',
      equityView: 'NEUTRAL',
      deltaPrice,
      deltaOI,
      conclusion: 'Remained similar to previous hour',
      isSignificant: false,
    };
  }

  const priceUp = deltaPrice > priceThreshold;
  const oiUp = deltaOI > oiThreshold;

  if (optionType === 'CE') {
    if (priceUp && oiUp) {
      return {
        observation: 'LONG BUILD UP',
        optionView: 'BULLISH',
        equityView: 'BULLISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Call Long Buildup',
        isSignificant: true,
      };
    } else if (!priceUp && !oiUp) {
      return {
        observation: 'LONG COVERING',
        optionView: 'STRONG BEARISH',
        equityView: 'STRONG BEARISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Call Long Covering',
        isSignificant: true,
      };
    } else if (!priceUp && oiUp) {
      return {
        observation: 'SHORT BUILD UP',
        optionView: 'BEARISH',
        equityView: 'BEARISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Call Short Buildup',
        isSignificant: true,
      };
    } else {
      return {
        observation: 'SHORT COVERING',
        optionView: 'STRONG BULLISH',
        equityView: 'STRONG BULLISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Call Short Covering',
        isSignificant: true,
      };
    }
  } else {
    // Put Option (PE)
    if (priceUp && oiUp) {
      return {
        observation: 'LONG BUILD UP',
        optionView: 'BULLISH',
        equityView: 'BEARISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Put Long Buildup',
        isSignificant: true,
      };
    } else if (!priceUp && !oiUp) {
      return {
        observation: 'LONG COVERING',
        optionView: 'STRONG BEARISH',
        equityView: 'STRONG BULLISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Put Long Covering',
        isSignificant: true,
      };
    } else if (!priceUp && oiUp) {
      return {
        observation: 'SHORT BUILD UP',
        optionView: 'BEARISH',
        equityView: 'BULLISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Put Short Buildup',
        isSignificant: true,
      };
    } else {
      return {
        observation: 'SHORT COVERING',
        optionView: 'STRONG BULLISH',
        equityView: 'STRONG BEARISH',
        deltaPrice,
        deltaOI,
        conclusion: 'Put Short Covering',
        isSignificant: true,
      };
    }
  }
}

