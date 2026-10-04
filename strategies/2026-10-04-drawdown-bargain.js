/**
 * =============================================================================
 * Strategy: Deep Drawdown Bargain Hunter                — tried on 2026-10-04
 * =============================================================================
 * THE IDEA (rare-event investing, mirror image of the champion):
 *   - The scoreboard's clearest pattern: only strategies trading on RARE
 *     events (single-digit trades) have beaten buy & hold; everything
 *     trading common signals bled out on fees and whipsaw.
 *   - The champion Circuit Breaker DODGES rare catastrophes. This strategy
 *     does the opposite rare-event trade: it BUYS them.
 *   - Rule: wait in cash until price has fallen at least DIP_PCT (25%)
 *     below its 180-day high — a genuine major correction, not a dip.
 *     BUY there. Then hold until price climbs back to within
 *     RECOVERY_PCT (5%) of that same old high — recovery complete — and
 *     SELL, locking in the rebound. Back to waiting.
 *   - "Be greedy when others are fearful", mechanized, with the fear
 *     threshold set high enough that it only fires a handful of times.
 *
 * WHY IT MIGHT FAIL (two known ways):
 *   1. Opportunity cost: in a steady bull market price never gets 25%
 *      below its high, so this sits in cash earning nothing for months —
 *      the squeeze strategy's failure mode.
 *   2. Catching a collapsing knife: 25% down can become 60% down (2022
 *      style) before any recovery, and unlike the RSI dips there is no
 *      stop — it rides the full crater. The -25% entry IS the edge bet:
 *      that BTC's major corrections eventually recover.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-04-drawdown-bargain.js
 *   - DIP_PCT: 0.35 = only buys historic crashes; 0.15 = trades more often
 *   - RECOVERY_PCT: 0 = hold for a full new high; 0.10 = take profit earlier
 *   - HIGH_DAYS: how far back "the high" looks
 * =============================================================================
 */

const HIGH_DAYS = 180;     // the reference high: highest close of ~6 months
const DIP_PCT = 0.25;      // buy when price is 25%+ below that high
const RECOVERY_PCT = 0.05; // sell when price is back within 5% of it

/** Highest close among the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  let h = -Infinity;
  for (let i = index - days; i < index; i++) h = Math.max(h, candles[i].close);
  return h;
}

// Module-level state: the old high we bought the dip against. We measure
// recovery against THIS frozen level, not a moving one (a moving high would
// drift down during long bear markets and trigger fake "recoveries").
// Fine for this engine: one strategy, one sequential pass.
let targetHigh = null;
let lastIndexSeen = -1;

module.exports = {
  name: "Drawdown Bargain 25/5",
  description:
    "Rare-event contrarian: buy only when price is 25%+ below its 180-day high, hold until it recovers to within 5% of that high, then wait again",

  decide({ candles, index, position }) {
    if (index < HIGH_DAYS) return "hold"; // warm-up

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) targetHigh = null;
    lastIndexSeen = index;

    const today = candles[index].close;
    const recentHigh = highestClose(candles, index, HIGH_DAYS);

    if (position === "cash") {
      // A true major correction: 25% or more below the 6-month high.
      if (today <= recentHigh * (1 - DIP_PCT)) {
        targetHigh = recentHigh; // freeze the level recovery is measured against
        return "buy";
      }
      return "hold";
    }

    // Holding: wait for the round trip back to (near) the old high.
    if (targetHigh !== null && today >= targetHigh * (1 - RECOVERY_PCT)) {
      targetHigh = null;
      return "sell"; // recovery complete - rebound banked
    }

    return "hold"; // still underwater or climbing - keep holding
  },
};
