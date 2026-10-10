/**
 * =============================================================================
 * Strategy: The 200-Day Line                            — tried on 2026-10-10
 * =============================================================================
 * THE IDEA (the most famous rule in markets, finally tested standalone):
 *   - "Above the 200-day moving average = bull market, below = bear market"
 *     is probably the single most quoted rule in all of trading. Funds use
 *     it, newsletters live by it, and we somehow never tested it by itself
 *     (the 100-day version only ever appeared as a filter inside hybrids).
 *   - Rule: hold BTC while today's close is ABOVE the average of the last
 *     200 closes; sit in cash while below. Nothing else.
 *   - A 2% BUFFER around the line reduces whipsaw: we only act when price
 *     is clearly above (buy) or clearly below (sell) the line, not when it
 *     is dancing on top of it.
 *
 * WHERE IT FITS IN OUR TAXONOMY: it is a slow trend filter, like Absolute
 * Momentum 90d (-3.77%) but with a smoother reference line, and the slower
 * sibling of the SMA crossover family (which compared two averages instead
 * of price vs one). The scoreboard predicts the usual trend-filter outcome:
 * decent crash protection, late exits, late re-entries, and a shortfall
 * versus buy & hold in V-shaped markets. Testing it anyway matters, because
 * this specific rule is the one people actually follow with real money.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-10-200-day-line.js
 *   - SMA_DAYS: the classic 200; try 100 or 300 for faster/slower lines
 *   - BUFFER: 0 = act on any cross (more whipsaw), 0.05 = act only on
 *     decisive 5% breaks (fewer, later signals)
 * =============================================================================
 */

const SMA_DAYS = 200; // the famous line: average of the last 200 closes
const BUFFER = 0.02;  // act only when price is 2%+ beyond the line

/** Simple moving average of closes over `days` ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

module.exports = {
  name: "200-Day Line",
  description:
    "The classic: hold BTC while price is 2%+ above its 200-day average, cash while 2%+ below - the most-quoted rule in markets, tested straight",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    if (index + 1 < SMA_DAYS) return "hold"; // warm-up: need 200 closes

    const today = candles[index].close;
    const line = sma(candles, index, SMA_DAYS);

    // Clearly above the line -> bull regime -> be invested.
    if (today > line * (1 + BUFFER) && position === "cash") return "buy";

    // Clearly below the line -> bear regime -> stand aside.
    if (today < line * (1 - BUFFER) && position === "btc") return "sell";

    return "hold"; // near the line, or already positioned correctly
  },
};
