/**
 * =============================================================================
 * Strategy: Calm-Sensing Breaker                        — tried on 2026-10-08
 * =============================================================================
 * THE IDEA (replace the champion's dumbest part with a measurement):
 *   - The champion Circuit Breaker's edge is proven: crash days cluster,
 *     so step aside after a -5% day. But its cooldown is a blind CLOCK —
 *     10 days, no matter what the market does. Why 10? No reason; it just
 *     tested well. A clock can return mid-storm or waste calm days.
 *   - The theory says what we're really waiting for: THE END OF THE
 *     TURBULENCE CLUSTER. So measure that directly. After tripping on a
 *     -5% day, re-enter only once the market has printed CALM_DAYS (3)
 *     consecutive days each moving less than CALM_PCT (2%) in either
 *     direction — the storm has demonstrably passed.
 *   - Safety valve: never stay out more than MAX_WAIT (15) trading days,
 *     so one noisy stretch can't keep us in cash forever (the lab's
 *     opportunity-cost lesson).
 *
 * WHY IT MIGHT WORK: the wait now self-adjusts — short after a one-off
 * shock that fizzles, long after a shock that keeps churning. That is
 * exactly the behavior the fixed clock approximates by accident.
 * WHY IT MIGHT FAIL: "3 quiet days" can happen in the eye of the storm
 * (re-entering right before leg two of a crash), and in wild stretches
 * the calm test plus the cap can hold us out longer than 10 days, missing
 * rebounds the champion caught. The data decides which effect dominates.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-08-calm-breaker.js
 *   - CRASH_PCT: the trip level (same -5% as the champion)
 *   - CALM_PCT / CALM_DAYS: what counts as "the storm has passed"
 *   - MAX_WAIT: hard cap on days spent waiting for calm
 * =============================================================================
 */

const CRASH_PCT = 0.05; // a close-to-close drop worse than -5% trips it
const CALM_PCT = 0.02;  // a "quiet day" moves less than 2% either way
const CALM_DAYS = 3;    // quiet days in a row required to re-enter
const MAX_WAIT = 15;    // never sit out longer than this many days

// Module-level state (fine for this engine: one sequential pass).
let waiting = false;   // are we out, waiting for calm?
let daysWaited = 0;    // how long we've been waiting
let lastIndexSeen = -1;

/** True if the last `n` days (ending at index) each moved < CALM_PCT. */
function isCalm(candles, index, n) {
  for (let i = index - n + 1; i <= index; i++) {
    const r = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
    if (Math.abs(r) >= CALM_PCT) return false;
  }
  return true;
}

module.exports = {
  name: "Calm-Sensing Breaker",
  description:
    "The champion with a smarter cooldown: after a -5% day, re-enter when 3 consecutive sub-2% days show the storm has passed (15-day cap) instead of a blind 10-day clock",

  decide({ candles, index, position }) {
    if (index < CALM_DAYS + 1) return "hold"; // need history for the calm test

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) { waiting = false; daysWaited = 0; }
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Panic day: trip the breaker (or restart the wait) ----------------
    if (dailyReturn < -CRASH_PCT) {
      waiting = true;
      daysWaited = 0;
      if (position === "btc") return "sell";
      return "hold";
    }

    // ---- Waiting for calm --------------------------------------------------
    if (waiting) {
      daysWaited++;
      const stormPassed = isCalm(candles, index, CALM_DAYS);
      const waitedTooLong = daysWaited >= MAX_WAIT;
      if (stormPassed || waitedTooLong) {
        waiting = false;
        daysWaited = 0;
        if (position === "cash") return "buy"; // conditions met - rejoin
      }
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) ---------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
