/**
 * =============================================================================
 * Strategy: Drawdown Breaker (15% / 30d peak, 10-day clock) — tried on 2026-11-22
 * =============================================================================
 * THE IDEA (a controlled test of WHY the champion's protection works):
 *   - Yesterday's Fast Trailing Stop (sell when the close is 15% below its
 *     30-day peak, buy back within 7% of the peak) was bad protection:
 *     66-68% drawdowns in the two deep-bear eras. The autopsy said the
 *     problem was the RE-ENTRY: the 30-day peak keeps falling in a bear, so
 *     dead-cat bounces kept putting price "near the peak" and the rule kept
 *     buying back in. The champion (Circuit Breaker Hold) differs in exactly
 *     that way: after its exit it waits a FIXED 10 days that no price move
 *     can shorten.
 *   - So here is the clean experiment. Keep yesterday's EXIT identical
 *     (close more than 15% below the 30-day peak) and swap only the
 *     RE-ENTRY for the champion's: a 10-day clock, then buy unconditionally.
 *     While price is still more than 15% under the peak the trigger keeps
 *     restarting the clock (the champion also restarts its clock on a new
 *     crash day), so we only re-enter after 10 consecutive days inside
 *     the 15% line.
 *   - If clock re-entry is the active ingredient, this should beat
 *     yesterday's rule clearly and move toward the champion's profile. If it
 *     is not, it will look the same as yesterday.
 *   - Nothing tuned: 30 days, 15% and 10 days are yesterday's and the
 *     champion's numbers, declared before running.
 *
 * WHY IT MIGHT WORK: the exit now keys on depth of fall (catches slow bears
 *   a one-day trigger cannot) while the re-entry cannot be tricked by a
 *   bounce.
 * WHY IT MIGHT FAIL: the exit still triggers on every 15% shakeout inside a
 *   bull market, and 10 days out after each one means missing rebounds; and
 *   the restarting clock can keep us in cash deep into a recovery that began
 *   while price was still more than 15% under an old peak.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-22-drawdown-breaker.js
 *   - PEAK_DAYS / EXIT_DROP: what counts as a breaker-tripping fall
 *   - COOLDOWN_DAYS: the fixed sit-out after the last tripping day
 * =============================================================================
 */

const PEAK_DAYS = 30;      // the peak is the highest close in this many days
const EXIT_DROP = 0.15;    // trip when the close is more than 15% below the peak
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
  name: "Drawdown Breaker 15%/30d + 10d clock",
  description:
    "Yesterday's trailing-stop exit (close >15% below its 30-day peak) with the champion's re-entry: a fixed 10-day clock that restarts while the trip condition holds",

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
