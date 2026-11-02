"""
Price to OI Conclusion Engine
==============================
Implements the exact Price-to-OI matrix logic for Calls & Puts
with deadband noise filtering (Price <= +-2, OI <= +-1000).
"""

from typing import Dict, Any, Optional

PRICE_THRESHOLD = 2.0
OI_THRESHOLD = 1000

def interpret_price_to_oi(
    option_type: str,
    current_price: float,
    previous_price: float,
    current_oi: int,
    previous_oi: int,
    price_threshold: float = PRICE_THRESHOLD,
    oi_threshold: int = OI_THRESHOLD,
) -> Dict[str, Any]:
    """
    Evaluates Price & OI changes between two hourly snapshots.
    
    Returns:
      observation: 'LONG BUILD UP' | 'LONG COVERING' | 'SHORT BUILD UP' | 'SHORT COVERING' | 'NEUTRAL / SIMILAR'
      option_view: 'BULLISH' | 'STRONG BULLISH' | 'BEARISH' | 'STRONG BEARISH' | 'NEUTRAL'
      equity_view: 'BULLISH' | 'STRONG BULLISH' | 'BEARISH' | 'STRONG BEARISH' | 'NEUTRAL'
      conclusion: human-readable conclusion text
      is_significant: bool (False if change is within deadbands)
    """
    delta_p = round(current_price - previous_price, 2)
    delta_oi = current_oi - previous_oi

    # Deadband check: if price change is <= +-2 OR OI change is <= +-1000
    if abs(delta_p) <= price_threshold or abs(delta_oi) <= oi_threshold:
        return {
            "observation": "NEUTRAL / SIMILAR",
            "option_view": "NEUTRAL",
            "equity_view": "NEUTRAL",
            "delta_price": delta_p,
            "delta_oi": delta_oi,
            "conclusion": "Remained similar to previous hour",
            "is_significant": False,
        }

    price_up = delta_p > price_threshold
    oi_up = delta_oi > oi_threshold
    opt = option_type.upper().strip()

    if opt == "CE":
        if price_up and oi_up:
            return {
                "observation": "LONG BUILD UP",
                "option_view": "BULLISH",
                "equity_view": "BULLISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Call Long Buildup: Nifty 50 is Bullish",
                "is_significant": True,
            }
        elif not price_up and not oi_up:
            return {
                "observation": "LONG COVERING",
                "option_view": "STRONG BEARISH",
                "equity_view": "STRONG BEARISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Call Long Covering: Nifty 50 is Strongly Bearish",
                "is_significant": True,
            }
        elif not price_up and oi_up:
            return {
                "observation": "SHORT BUILD UP",
                "option_view": "BEARISH",
                "equity_view": "BEARISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Call Short Buildup: Nifty 50 is Bearish (Call Writing)",
                "is_significant": True,
            }
        elif price_up and not oi_up:
            return {
                "observation": "SHORT COVERING",
                "option_view": "STRONG BULLISH",
                "equity_view": "STRONG BULLISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Call Short Covering: Nifty 50 is Strongly Bullish (Short Squeeze)",
                "is_significant": True,
            }

    elif opt == "PE":
        if price_up and oi_up:
            return {
                "observation": "LONG BUILD UP",
                "option_view": "BULLISH",
                "equity_view": "BEARISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Put Long Buildup: Nifty 50 is Bearish (Put Buying)",
                "is_significant": True,
            }
        elif not price_up and not oi_up:
            return {
                "observation": "LONG COVERING",
                "option_view": "STRONG BEARISH",
                "equity_view": "STRONG BULLISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Put Long Covering: Nifty 50 is Strongly Bullish (Put Unwinding)",
                "is_significant": True,
            }
        elif not price_up and oi_up:
            return {
                "observation": "SHORT BUILD UP",
                "option_view": "BEARISH",
                "equity_view": "BULLISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Put Short Buildup: Nifty 50 is Bullish (Put Writing / Support Floor)",
                "is_significant": True,
            }
        elif price_up and not oi_up:
            return {
                "observation": "SHORT COVERING",
                "option_view": "STRONG BULLISH",
                "equity_view": "STRONG BEARISH",
                "delta_price": delta_p,
                "delta_oi": delta_oi,
                "conclusion": "Put Short Covering: Nifty 50 is Strongly Bearish (Downside Panic)",
                "is_significant": True,
            }

    return {
        "observation": "NEUTRAL / SIMILAR",
        "option_view": "NEUTRAL",
        "equity_view": "NEUTRAL",
        "delta_price": delta_p,
        "delta_oi": delta_oi,
        "conclusion": "Remained similar to previous hour",
        "is_significant": False,
    }


def classify_price_to_oi(
    delta_price: float,
    delta_oi: int,
    option_type: str,
    price_threshold: float = PRICE_THRESHOLD,
    oi_threshold: int = OI_THRESHOLD,
) -> Dict[str, Any]:
    """Convenience wrapper accepting precomputed deltas."""
    return interpret_price_to_oi(
        option_type=option_type,
        current_price=float(delta_price),
        previous_price=0.0,
        current_oi=int(delta_oi),
        previous_oi=0,
        price_threshold=price_threshold,
        oi_threshold=oi_threshold,
    )


