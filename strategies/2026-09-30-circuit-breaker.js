/**
 * =============================================================================
 * Strategy: Circuit Breaker Hold                        — tried on 2026-09-30
 * =============================================================================
 * THE IDEA (event-driven risk-off — hold by default, dodge only disasters):
 *   - The scoreboard's strongest lesson: every strategy that spends less
 *     time in the market than buy & hold has lost to it. So this one is
 *     LONG BY DEFAULT — it owns BTC every ordinary day.
 *   - The single exception: a PANIC DAY. If today's close is down more
 *     than CRASH_PCT (5%) from yesterday's, sell at today's close and
 *     stay in cash for COOLDOWN_DAYS (10) trading days, then buy back in
 *     no matter what.
 *   - The bet rests on "volatility clustering", one of the oldest facts in
 *     finance: huge down days tend to arrive in bunches. If the days right
 *     after a crash are, on average, further losses, sitting out a short
 *     cooldown after each shock keeps most of buy & hold's upside while
 *     skipping the ugliest stretches.
 *
 * WHY IT MIGHT FAIL: crypto crashes often end in a V — the biggest UP days
 * also cluster right after the biggest down days. Selling into the panic
 * close and waiting 10 days can mean eating the crash AND missing the
 * rebound, the worst of both worlds. Fees on every panic round-trip too.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-30-circuit-breaker.js
 *   - CRASH_PCT: 0.05 = trip on a -5% day; 0.08 only reacts to true chaos
 *   - COOLDOWN_DAYS: how long to stay out after tripping (shorter = less
 *     rebound risk, but less protection)
 * =============================================================================
 */

const CRASH_PCT = 0.05;    // a close-to-close drop bigger than this trips it
const COOLDOWN_DAYS = 10;  // trading days to sit out after tripping

// Module-level state: how many cooldown days remain (0 = breaker not
// tripped). Fine for this engine: one strategy, one sequential pass.
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Circuit Breaker Hold",
  description:
    "Long by default; sell only after a single-day drop worse than -5% and sit out 10 days, then buy back - dodge disasters, own everything else",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    if (index < 1) return "hold"; // need yesterday to measure today's drop

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Panic day: trip the breaker -------------------------------------
    if (dailyReturn < -CRASH_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell"; // step aside at today's close
      return "hold"; // already in cash; the trip just restarts the clock
    }

    // ---- Cooling down: count the days out ---------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold"; // stay in cash until the cooldown expires
    }

    // ---- Ordinary day: be invested (the default state) --------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
