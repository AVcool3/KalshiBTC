/**
 * =============================================================================
 * Strategy: Breaker Neighbor 6% / 15 days                — tried on 2026-11-12
 * =============================================================================
 * THE IDEA (a robustness probe of the champion's two knobs):
 *   - Circuit Breaker Hold has exactly two parameters: the crash threshold
 *     (-5% day) and the cooldown (10 days). Every variant so far changed the
 *     MECHANISM (rebound re-entry, calm sensing, relative trigger...) and
 *     lost. None asked the simpler question: how fragile are those two
 *     numbers themselves? If the edge only exists at exactly 5%/10 days it
 *     is an accident of fitting; if it holds on a plateau of nearby values
 *     it is a real feature of the market.
 *   - This file is the champion with BOTH knobs moved one step to round
 *     neighbors: 6% instead of 5%, 15 days instead of 10. The two values
 *     were declared before running. The commit message contains the full
 *     threshold x cooldown heat map across four eras so the whole plateau
 *     (or the lack of one) is visible, not just this cell.
 *   - Rule (unchanged): long by default. A close-to-close drop worse than
 *     CRASH_PCT sells at that close and starts a COOLDOWN_DAYS wait in cash;
 *     afterwards, buy back in unconditionally.
 *
 * WHY IT MIGHT WORK: a real crash-clustering effect should not care whether
 *   "a crash" is -5% or -6%, or whether the aftermath lasts 10 or 15 days.
 * WHY IT MIGHT FAIL: a longer cooldown means more time out of the market
 *   during the rebounds that follow cascades, and a higher threshold trips
 *   less often, so a smooth plateau is not guaranteed - and if it falls off
 *   a cliff one step away, the champion's number was luck.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-12-breaker-neighbor.js
 *   - CRASH_PCT: trigger size (0.05 is the champion)
 *   - COOLDOWN_DAYS: sit-out length (10 is the champion)
 * =============================================================================
 */

const CRASH_PCT = 0.06;    // champion uses 0.05
const COOLDOWN_DAYS = 15;  // champion uses 10

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Breaker Neighbor 6%/15d",
  description:
    "Robustness probe: the champion's circuit breaker with both knobs moved one round step (6% crash trigger, 15-day cooldown) - does the edge survive nearby settings?",

  decide({ candles, index, position }) {
    if (index < 1) return "hold"; // need yesterday to measure today's drop

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const dailyReturn =
      (candles[index].close - candles[index - 1].close) / candles[index - 1].close;

    // ---- Panic day: trip the breaker -----------------------------------------
    if (dailyReturn < -CRASH_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell";
      return "hold"; // already in cash; the trip just restarts the clock
    }

    // ---- Cooling down ---------------------------------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) ------------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
