/**
 * =============================================================================
 * Strategy: NR7 Narrow-Range Breakout                    — tried on 2026-10-26
 * =============================================================================
 * THE IDEA (candle-range compression, a trader's favorite since the 1990s):
 *   - An "NR7" day is a day whose high-low RANGE is the narrowest of the
 *     last 7 days. The folklore (Toby Crabel's "Day Trading with Short Term
 *     Price Patterns"): markets alternate between contraction and
 *     expansion, so the quietest day in a week is a coiled spring - the
 *     next real move out of its range is the start of an expansion.
 *   - Rule: remember the most recent NR7 day. If, within the next
 *     WAIT_DAYS days, a close breaks ABOVE that day's high -> buy (the
 *     spring released upward). Then manage the trade with the NR7 day's
 *     own LOW as a stop: close below it -> sell (the spring released the
 *     wrong way). Also sell after MAX_HOLD days so a trade can't drift
 *     forever on a stale setup.
 *   - How this differs from the Squeeze Breakout (-12.66%): that used
 *     Bollinger-band WIDTH over 20 days (close-to-close volatility);
 *     this uses single-candle high-low RANGE over 7 days - a faster,
 *     purely intraday-anatomy measure, with a tight structural stop.
 *
 * WHY IT MIGHT WORK: the stop is only one narrow candle away, so losses
 *   are small by construction, and range compression genuinely precedes
 *   expansion in volatility data (that part is real - vol clusters).
 * WHY IT MIGHT FAIL: compression predicts that a BIG move is coming, not
 *   which DIRECTION - the breakout-up rule catches half the expansions
 *   and the tight stop gets shaken out of many of those. Fees (1.2% a
 *   round trip) are large relative to a stop one narrow candle wide.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-26-nr7-breakout.js
 *   - NR_DAYS: the "narrowest of the last N days" lookback (7 = classic)
 *   - WAIT_DAYS: how long a setup stays live after the NR day
 *   - MAX_HOLD: forced exit after this many days in the trade
 * =============================================================================
 */

const NR_DAYS = 7;    // an NR day has the smallest range of this many days
const WAIT_DAYS = 5;  // a setup expires this many days after the NR day
const MAX_HOLD = 10;  // sell after this many days regardless

// Module-level state for the open trade (fine: one sequential pass).
let stopLevel = null;   // the NR day's low, our stop while in the trade
let entryIndex = -1;    // when we bought, to count hold days
let lastIndexSeen = -1;

/** High-low range of the candle at `i`. */
function range(candles, i) {
  return candles[i].high - candles[i].low;
}

/** Is the candle at `i` the narrowest range of the last NR_DAYS days? */
function isNarrowRange(candles, i) {
  for (let k = i - NR_DAYS + 1; k < i; k++) {
    if (range(candles, k) <= range(candles, i)) return false;
  }
  return true;
}

module.exports = {
  name: "NR7 Breakout 7/5/10",
  description:
    "Range compression: after the narrowest-range day of a week, buy a close above its high (spring releases up), stop at its low, exit after 10 days at most",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) { stopLevel = null; entryIndex = -1; }
    lastIndexSeen = index;

    if (index < NR_DAYS + WAIT_DAYS) return "hold"; // warm-up

    const close = candles[index].close;

    // ---- In a trade: stop at the NR day's low, or time out ------------------
    if (position === "btc") {
      if (stopLevel !== null && close < stopLevel) return "sell";
      if (index - entryIndex >= MAX_HOLD) return "sell";
      return "hold";
    }

    // ---- In cash: look for the most recent NR day still inside its window --
    // Scan back from yesterday so only PAST candles define the setup.
    for (let j = index - 1; j >= index - WAIT_DAYS; j--) {
      if (isNarrowRange(candles, j)) {
        if (close > candles[j].high) {
          stopLevel = candles[j].low; // the coil's floor becomes our stop
          entryIndex = index;
          return "buy";
        }
        break; // only the most recent NR day counts as the live setup
      }
    }
    return "hold";
  },
};
