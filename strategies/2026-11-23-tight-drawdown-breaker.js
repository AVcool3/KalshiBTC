/**
 * =============================================================================
 * Strategy: Tight Drawdown Breaker (10% / 30d peak, 10-day clock)
 *                                                        — tried on 2026-11-23
 * =============================================================================
 * THE IDEA (pre-registering yesterday's lead, then testing it on another coin):
 *   - Yesterday's Drawdown Breaker (exit when the close is more than 15% below
 *     its 30-day peak, then a fixed 10-day clock before re-entry) was a
 *     miss, but one neighbouring cell of its grid stood out: with a 10% exit
 *     the max drawdown was 30-39% in ALL FIVE eras (buy & hold: 84% and 77%
 *     in the two deep-bear eras), the most uniform risk reduction of any
 *     single-signal rule on the board. That cell was NOT declared in
 *     advance and sat in a seven-cell grid, so it could be luck.
 *   - This file declares it now, unchanged: 30-day peak, 10% exit, 10-day
 *     clock, nothing else. Same mechanics as yesterday: invested by default;
 *     trip when the close is more than 10% below the highest close of the
 *     last 30 days; sell, then wait a fixed 10 days that restarts for as
 *     long as the trip condition keeps holding; then buy unconditionally.
 *   - Because the BTC eras have all been seen (the cell was found in them),
 *     the real test is out of sample on a DIFFERENT ASSET: ETH-USD daily
 *     candles over the same kinds of eras, never used to choose anything.
 *     The commit reports it next to the champion and Belt & Suspenders.
 *
 * WHY IT MIGHT WORK: a 10% fall from a 30-day peak is a "correction"; leaving
 *   at that line and sitting out a fixed 10 days should cap the damage of
 *   any large decline while a fixed clock keeps dead-cat bounces from pulling
 *   it back in early (a point yesterday's test weakened but did not kill).
 * WHY IT MIGHT FAIL: 10% corrections happen all the time inside bull markets
 *   (nine round-trips in 2023-24), and each costs fees plus ten days of
 *   missed upside. The uniform drawdowns may be the price of mediocre
 *   returns, and the cell may simply be a lucky draw from its grid.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-23-tight-drawdown-breaker.js
 *   - PEAK_DAYS / EXIT_DROP: what counts as a tripping fall
 *   - COOLDOWN_DAYS: the fixed sit-out after the last tripping day
 * =============================================================================
 */

const PEAK_DAYS = 30;      // the peak is the highest close in this many days
const EXIT_DROP = 0.10;    // trip when the close is more than 10% below the peak
const COOLDOWN_DAYS = 10;  // fixed sit-out; restarts while the trip condition holds

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

/** Highest close over the PEAK_DAYS days ending at `index` (today included). */
function recentPeak(candles, index) {
  let peak = -Infinity;
  for (let i = Math.max(0, index - PEAK_DAYS + 1); i <= index; i++) {
    peak = Math.max(peak, candles[i].close);
  }
  return peak;
}

module.exports = {
  name: "Tight Drawdown Breaker 10%/30d + 10d clock",
  description:
    "Pre-registered lead: sell when the close is more than 10% below its 30-day peak, sit out a fixed 10-day clock (restarting while the trip holds), then buy back unconditionally",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const close = candles[index].close;
    const peak = recentPeak(candles, index);
    const drop = (peak - close) / peak;

    // ---- Tripped: too far below the recent peak ---------------------------------
    if (drop > EXIT_DROP) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell";
      return "hold"; // already in cash; the clock restarts
    }

    // ---- Cooling down -----------------------------------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Clear: be invested (the default state) ----------------------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
