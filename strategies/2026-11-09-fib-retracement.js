/**
 * =============================================================================
 * Strategy: Fibonacci Retracement 61.8%                  — tried on 2026-11-09
 * =============================================================================
 * THE IDEA (technical-analysis folklore: "buy the 61.8% pullback"):
 *   - After a strong rally, price often gives back part of the move before
 *     continuing. Chart traders say the pullback tends to stop at "Fibonacci
 *     levels" - 38.2%, 50% or 61.8% of the rally - and that buying there
 *     with a stop under the rally's start is a high-reward, small-risk bet.
 *   - Rule, mechanically defined so it can be backtested:
 *       1. SWING: look back SWING_DAYS (60). The swing HIGH is the highest
 *          close in the window; the swing LOW is the lowest close in the
 *          window BEFORE that high. The rally is high - low and must be at
 *          least MIN_RALLY (20%) of the low, or there is nothing to retrace.
 *       2. BUY when today's close falls to or below the 61.8% retracement
 *          level (high - 0.618 x rally) while still ABOVE the swing low.
 *       3. SELL when price recovers to the swing high (target hit), or
 *          closes below the swing low (the rally failed: stop out), or
 *          after MAX_HOLD days (30) if neither happens.
 *   - The swing is re-measured each day from past candles only, but the
 *     TARGET and STOP are frozen at entry so the exit does not drift.
 *   - Nothing tuned: 61.8% is the textbook level; the 60-day swing, 20%
 *     rally and 30-day hold are round numbers declared before running.
 *
 * WHY IT MIGHT WORK: it is a rule-based dip-buy with a tight, structural
 *   stop and a defined target, entered only after a real rally, so it
 *   avoids buying dips in a downtrend with no prior strength (the failure
 *   of the plain dip-buyers).
 * WHY IT MIGHT FAIL: the lab's whole buy-weakness ledger is negative, the
 *   Fibonacci levels themselves have no mechanism (they are numbers from a
 *   sequence), and a 61.8% retracement of a 20%+ rally is a big drop that
 *   is often the first leg of a reversal, not a pause.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-09-fib-retracement.js
 *   - FIB: the retracement depth (0.382 shallower, 0.5 midpoint, 0.618)
 *   - SWING_DAYS / MIN_RALLY: how big a rally counts and how far back
 *   - MAX_HOLD: give-up horizon for a bounce that does not come
 * =============================================================================
 */

const FIB = 0.618;        // buy when price retraces this fraction of the rally
const SWING_DAYS = 60;    // window used to find the rally
const MIN_RALLY = 0.20;   // rally must be at least +20% from its low
const MAX_HOLD = 30;      // days; give up if neither target nor stop is hit

// Module-level state: the frozen exit levels of the open trade.
let target = null;
let stop = null;
let entryIndex = -1;
let lastIndexSeen = -1;

module.exports = {
  name: "Fibonacci Retracement 61.8%",
  description:
    "Chart folklore: after a 20%+ rally, buy the pullback to 61.8% of the move, target the old high, stop under the rally's start, give up after 30 days",

  decide({ candles, index, position }) {
    if (index < SWING_DAYS) return "hold"; // warm-up

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) { target = null; stop = null; entryIndex = -1; }
    lastIndexSeen = index;

    const close = candles[index].close;

    // ---- In a trade: target, stop (both frozen at entry) or time-out --------
    if (position === "btc") {
      if (target !== null && close >= target) return "sell"; // rally fully recovered
      if (stop !== null && close < stop) return "sell";      // swing low broke
      if (index - entryIndex >= MAX_HOLD) return "sell";     // bounce never came
      return "hold";
    }

    // ---- In cash: find the swing in the last SWING_DAYS closes ---------------
    let hiIdx = index - SWING_DAYS + 1;
    for (let i = hiIdx; i <= index; i++) {
      if (candles[i].close >= candles[hiIdx].close) hiIdx = i;
    }
    if (hiIdx === index - SWING_DAYS + 1) return "hold"; // no room for a low before the high

    let low = Infinity;
    for (let i = index - SWING_DAYS + 1; i < hiIdx; i++) low = Math.min(low, candles[i].close);

    const high = candles[hiIdx].close;
    if (hiIdx === index) return "hold"; // price is AT the high: nothing to retrace
    if ((high - low) / low < MIN_RALLY) return "hold"; // rally too small to matter

    // Retracement level: FIB of the rally given back.
    const level = high - FIB * (high - low);
    if (close <= level && close > low) {
      target = high; // frozen exits for this trade
      stop = low;
      entryIndex = index;
      return "buy";
    }
    return "hold";
  },
};
