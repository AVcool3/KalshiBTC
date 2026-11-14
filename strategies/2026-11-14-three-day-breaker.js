/**
 * =============================================================================
 * Strategy: Three-Day Breaker (-8% / 3d)                 — tried on 2026-11-14
 * =============================================================================
 * THE IDEA (the missing timescale between the day and the week):
 *   - The champion trips on a single -5% day. The Weekly Breaker tripped on
 *     a -15% trailing week (+37% in its window, worse than the champion).
 *     Nothing in between has been measured. Real cascades often unfold over
 *     two or three days - a -4% day, another -3%, another -2% - without any
 *     one day breaching -5%, and the champion never sees those.
 *   - Rule: look at the cumulative return over the last THREE closes
 *     (today's close vs the close three days ago). If it is worse than
 *     -8%, trip: sell at today's close and sit out COOLDOWN_DAYS (10) in
 *     cash, then buy back unconditionally. Otherwise be long.
 *   - Nothing tuned: -8% over three days is the champion's -5% scaled up by
 *     roughly the square root of time for 3 days (5% x sqrt(3) = 8.7%,
 *     rounded down); the 10-day cooldown is the champion's. Declared
 *     before running. The commit shows a threshold sweep and the four-era
 *     comparison against the champion.
 *
 * WHY IT MIGHT WORK: it catches multi-day slides the one-day trigger misses,
 *   while still ignoring ordinary two-day pullbacks (rare to exceed -8%).
 * WHY IT MIGHT FAIL: the champion's own audit showed its edge is a narrow
 *   peak on the one-day scale; a different window may simply move the peak
 *   without enlarging it. A 3-day window also re-trips on the same slide:
 *   each extra down day inside the window renews the alarm and restarts
 *   the cooldown, which can lock the strategy in cash through the rebound.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-14-three-day-breaker.js
 *   - WINDOW_DAYS: how many days the cumulative drop is measured over
 *   - DROP_PCT: size of that drop that trips the alarm
 *   - COOLDOWN_DAYS: sit-out length after tripping
 * =============================================================================
 */

const WINDOW_DAYS = 3;     // cumulative drop is measured over this many days
const DROP_PCT = 0.08;     // trip when the WINDOW_DAYS return is worse than -8%
const COOLDOWN_DAYS = 10;  // the champion's sit-out

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Three-Day Breaker -8%",
  description:
    "The breaker at the missing timescale: sell when the close is down more than 8% over three days (catches multi-day slides with no single -5% day), sit out 10 days",

  decide({ candles, index, position }) {
    if (index < WINDOW_DAYS) return "hold"; // need the close WINDOW_DAYS ago

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const then = candles[index - WINDOW_DAYS].close;
    const cumulative = (candles[index].close - then) / then;

    // ---- Multi-day slide: trip the breaker ---------------------------------
    if (cumulative < -DROP_PCT) {
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
