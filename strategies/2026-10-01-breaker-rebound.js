/**
 * =============================================================================
 * Strategy: Circuit Breaker + Rebound Re-entry          — tried on 2026-10-01
 * =============================================================================
 * THE IDEA (patching the champion's known weakness):
 *   - Yesterday's Circuit Breaker Hold became champion (+55.32% vs +40.49%
 *     buy & hold, and robust across parameters): long by default, sell
 *     after a -5% day, sit out 10 days, buy back.
 *   - Its documented weak spot: V-shaped recoveries. The biggest UP days
 *     cluster right after the biggest down days, and a fixed 10-day
 *     cooldown can sit in cash through the whole rebound.
 *   - The patch: during the cooldown, a day that closes up more than
 *     REBOUND_PCT (+5%) is treated as the market screaming "the panic is
 *     over" -> re-enter IMMEDIATELY instead of waiting out the clock.
 *   - Everything else is identical to the champion, so any difference in
 *     results is attributable to this one rule.
 *
 * WHY IT MIGHT WORK: it keeps the crash-dodging that made the champion win
 * while capping the cost of its one failure mode (missing rebounds).
 * WHY IT MIGHT FAIL: big up-days also happen MID-crash ("dead cat
 * bounces") — a +5% day inside a collapsing market is often a trap, so
 * early re-entry can walk straight back into the fire the breaker just
 * escaped. Whether rebound days help or trap is exactly what this measures.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-01-breaker-rebound.js
 *   - CRASH_PCT / COOLDOWN_DAYS: same knobs as the champion
 *   - REBOUND_PCT: how loud the up-day must be to trigger early re-entry
 * =============================================================================
 */

const CRASH_PCT = 0.05;   // a close-to-close drop worse than -5% trips it
const COOLDOWN_DAYS = 10; // max trading days to sit out after tripping
const REBOUND_PCT = 0.05; // a +5% day during cooldown = re-enter early

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Breaker + Rebound Re-entry",
  description:
    "The champion's circuit breaker, plus one rule: a +5% day during the cooldown means the panic is over - re-enter immediately instead of waiting",

  decide({ candles, index, position }) {
    if (index < 1) return "hold"; // need yesterday to measure today's move

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Panic day: trip (or re-trip) the breaker -------------------------
    if (dailyReturn < -CRASH_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell";
      return "hold";
    }

    // ---- Cooling down ------------------------------------------------------
    if (cooldownLeft > 0) {
      // THE NEW RULE: a loud up-day during the cooldown ends it early.
      if (dailyReturn > REBOUND_PCT) {
        cooldownLeft = 0;
        if (position === "cash") return "buy"; // rejoin the rebound today
        return "hold";
      }
      cooldownLeft--;
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) ---------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
