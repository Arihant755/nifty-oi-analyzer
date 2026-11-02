# Price to OI (Open Interest) Interpretation & Logic Specification
===================================================================

> **Document Version:** 1.0.0  
> **Target Instrument:** Nifty 50 Index Options (Calls & Puts)  
> **Source Grounding:** Official Price-to-OI Conclusion Framework  
> **Status:** Approved Specification  

---

## 📌 1. Overview & Core Philosophy

The **Price to OI Conclusion** system decodes institutional positioning by analyzing the simultaneous directional movement of **Price (LTP)** and **Open Interest (OI)** across hourly snapshots (checkpoints).

- An Option contract represents a levered directional bet.
- **Call Options (CE)**: Move directly with the underlying index (Nifty 50).
- **Put Options (PE)**: Move inversely to the underlying index (Nifty 50). When Nifty falls, Put Option prices rise; when Nifty rises, Put Option prices fall.

By tracking how $(\Delta \text{Price})$ and $(\Delta \text{OI})$ evolve from hour to hour for a specific strike, we identify institutional accumulation (Buildup) vs. institutional distribution/profit booking (Covering/Unwinding).

---

## ⚖️ 2. Noise Filtering & Deadband Thresholds

Market micro-fluctuations should not trigger false signals. The following strict deadbands apply:

| Metric | Deadband Condition | Classification |
| :--- | :--- | :--- |
| **Price (LTP)** | $|\Delta \text{Price}| \le ₹2.00$ | **NO CHANGE (Neutral / Negligible)** |
| **Open Interest (OI)** | $|\Delta \text{OI}| \le 1,000 \text{ contracts}$ | **NO CHANGE (Neutral / Negligible)** |

### Neutral / Stagnant Condition:
If **Price** changes by $\le \pm 2$ **OR** **OI** changes by $\le \pm 1,000$:
- **Observation:** `NEUTRAL / SIMILAR`
- **Option View:** `NEUTRAL`
- **Stock / Equity (Nifty 50) View:** `NEUTRAL`
- **Conclusion Text:** *"Remained similar to previous hour (Change within ±2 price / ±1,000 OI threshold)"*

---

## 📊 3. Complete Price-to-OI Interpretation Matrix

### A. CALL OPTIONS (CE) — Direct Correlation with Nifty 50

| Price ($\Delta P > +2$) | OI ($\Delta OI > +1000$) | Observation | Option View | Stock / Equity (Nifty 50) View | Market Action Meaning |
| :---: | :---: | :---: | :---: | :---: | :---|
| ⬆️ **UP** | ⬆️ **UP** | **LONG BUILD UP** | 🟢 **BULLISH** | 🟢 **BULLISH** | Aggressive institutional Call buying. Bullish continuation expected. |
| ⬇️ **DOWN** | ⬇️ **DOWN** | **LONG COVERING** | 🔴 **STRONG BEARISH** | 🔴 **STRONG BEARISH** | Long positions liquidating / exiting. Severe downside momentum. |
| ⬇️ **DOWN** | ⬆️ **UP** | **SHORT BUILD UP** | 🔴 **BEARISH** | 🔴 **BEARISH** | Aggressive Call writing / shorting. Heavy resistance ceiling forming. |
| ⬆️ **UP** | ⬇️ **DOWN** | **SHORT COVERING** | 🟢 **STRONG BULLISH** | 🟢 **STRONG BULLISH** | Call writers trapped & panicking / buying back. Sharp explosive upside rally. |

---

### B. PUT OPTIONS (PE) — Inverse Correlation with Nifty 50

| Price ($\Delta P > +2$) | OI ($\Delta OI > +1000$) | Observation | Option View | Stock / Equity (Nifty 50) View | Market Action Meaning |
| :---: | :---: | :---: | :---: | :---: | :---|
| ⬆️ **UP** | ⬆️ **UP** | **LONG BUILD UP** | 🟢 **BULLISH** | 🔴 **BEARISH** | Aggressive Put buying. Option rises as underlying Nifty drops. Downside expected. |
| ⬇️ **DOWN** | ⬇️ **DOWN** | **LONG COVERING** | 🔴 **STRONG BEARISH** | 🟢 **STRONG BULLISH** | Put buyers exiting / booking profits. Downward pressure on Nifty is exhausted. |
| ⬇️ **DOWN** | ⬆️ **UP** | **SHORT BUILD UP** | 🔴 **BEARISH** | 🟢 **BULLISH** | Aggressive Put writing / shorting. Strong support floor creating an upward lift for Nifty. |
| ⬆️ **UP** | ⬇️ **DOWN** | **SHORT COVERING** | 🟢 **STRONG BULLISH** | 🔴 **STRONG BEARISH** | Put sellers trapped & covering shorts as market crashes. Panic selling in Nifty 50. |

---

## 🧮 4. Mathematical Decision Logic (Pseudocode)

```python
def interpret_price_to_oi(
    option_type: str,     # 'CE' or 'PE'
    current_price: float, # Current hour LTP
    previous_price: float,# Previous hour LTP
    current_oi: int,      # Current hour OI
    previous_oi: int,     # Previous hour OI
    price_threshold: float = 2.0,
    oi_threshold: int = 1000,
) -> dict:
    delta_price = current_price - previous_price
    delta_oi = current_oi - previous_oi

    # Check deadbands
    if abs(delta_price) <= price_threshold or abs(delta_oi) <= oi_threshold:
        return {
            "observation": "NEUTRAL / SIMILAR",
            "option_view": "NEUTRAL",
            "equity_view": "NEUTRAL",
            "delta_price": round(delta_price, 2),
            "delta_oi": delta_oi,
            "conclusion": "Remained similar to previous hour",
            "is_significant": False
        }

    price_up = delta_price > price_threshold
    oi_up = delta_oi > oi_threshold

    opt = option_type.upper()

    if opt == "CE":
        if price_up and oi_up:
            return {
                "observation": "LONG BUILD UP",
                "option_view": "BULLISH",
                "equity_view": "BULLISH",
                "conclusion": "Call Long Buildup: Nifty 50 is Bullish",
                "is_significant": True
            }
        elif not price_up and not oi_up:
            return {
                "observation": "LONG COVERING",
                "option_view": "STRONG BEARISH",
                "equity_view": "STRONG BEARISH",
                "conclusion": "Call Long Covering: Nifty 50 is Strongly Bearish",
                "is_significant": True
            }
        elif not price_up and oi_up:
            return {
                "observation": "SHORT BUILD UP",
                "option_view": "BEARISH",
                "equity_view": "BEARISH",
                "conclusion": "Call Short Buildup",
                "is_significant": True
            }
        elif price_up and not oi_up:
            return {
                "observation": "SHORT COVERING",
                "option_view": "STRONG BULLISH",
                "equity_view": "STRONG BULLISH",
                "conclusion": "Call Short Covering",
                "is_significant": True
            }

    elif opt == "PE":
        if price_up and oi_up:
            return {
                "observation": "LONG BUILD UP",
                "option_view": "BULLISH",
                "equity_view": "BEARISH",
                "conclusion": "Put Long Buildup",
                "is_significant": True
            }
        elif not price_up and not oi_up:
            return {
                "observation": "LONG COVERING",
                "option_view": "STRONG BEARISH",
                "equity_view": "STRONG BULLISH",
                "conclusion": "Put Long Covering",
                "is_significant": True
            }
        elif not price_up and oi_up:
            return {
                "observation": "SHORT BUILD UP",
                "option_view": "BEARISH",
                "equity_view": "BULLISH",
                "conclusion": "Put Short Buildup",
                "is_significant": True
            }
        elif price_up and not oi_up:
            return {
                "observation": "SHORT COVERING",
                "option_view": "STRONG BULLISH",
                "equity_view": "STRONG BEARISH",
                "conclusion": "Put Short Covering",
                "is_significant": True
            }
```

---

## 🚀 5. Implementation Roadmap for Features
1. **Hourly Strike Differential Engine**:
   - Compare Snapshot $H_n$ against Snapshot $H_{n-1}$ for each strike price.
   - Compute `observation`, `option_view`, and `equity_view` dynamically.
2. **Dashboard Visual Indicators**:
   - Visual badges on each strike: `Long Buildup (Bullish)`, `Short Covering (Strong Bullish)`, `Short Buildup (Bearish)`, `Long Covering (Strong Bearish)`, or `Similar`.
   - Aggregate sentiment score: Count how many active ATM/OTM strikes favor Bullish vs. Bearish.
3. **Telegram Real-time Hourly Alert**:
   - Include the overall Price-to-OI conclusion (e.g., *"Top Activity: 23,000 CE showing Short Covering (Strong Bullish), 23,100 PE showing Put Writing (Bullish)"*).
