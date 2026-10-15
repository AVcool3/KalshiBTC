/**
 * =============================================================================
 * Strategy: Weekly Breaker                              — tried on 2026-10-15
 * =============================================================================
 * THE IDEA (is the champion's edge FRACTAL?):
 *   - The lab's one validated finding: DAILY crashes cluster. Sell after a
 *     -5% day, wait 10 days, and you dodge the worst stretches (confirmed
 *     from both sides - the breaker wins, Storm Rider loses).
 *   - Volatility clustering is supposed to be roughly scale-invariant: the
 *     same bunching should appear in weekly data. If that's true, the same
 *     mechanism one level up should also work:
 *       - Long by default (as always).
 *       - If the trailing 7 DAYS lost more than -15%: SELL, sit out 20
 *         trading days (~4 weeks), then buy back. A new -15% week during
 *         the cooldown restarts the clock.
 *   - A -15% week is roughly as rare as a -5% day, so the comparison is
 *     fair: similar event frequency, longer wavelength.
 *
 * READING THE RESULT: if this works too, the crash-clustering edge is a
 * deep property of BTC across timescales - a much stronger claim than one
 * lucky threshold. If it fails while the daily version works, the edge
 * lives specifically at the daily wavelength (panic resolves in days, and
 * a month-long sit-out overstays it - the Absolute Momentum lesson: slow
 * reactions sell bottoms and re-buy higher).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-15-weekly-breaker.js
 *   - WEEK_DROP / WEEK_DAYS: what counts as a crash week
 *   - COOLDOWN_DAYS: how long to sit out (20 ~ four trading weeks)
 * =============================================================================
 */

const WEEK_DAYS = 7;        // the trailing window that defines "a week"
const WEEK_DROP = 0.15;     // a trailing-week loss worse than -15% trips it
const COOLDOWN_DAYS = 20;   // ~4 weeks out, mirroring the daily 10-day clock

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Weekly Breaker",
  description:
    "The champion one timescale up: sell after a -15% trailing week, sit out ~4 weeks, buy back - tests whether crash clustering is fractal",

  decide({ candles, index, position }) {
    if (index < WEEK_DAYS) return "hold"; // need a full trailing week

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const today = candles[index].close;
    const weekAgo = candles[index - WEEK_DAYS].close;
    const weekReturn = (today - weekAgo) / weekAgo;

    // ---- Crash week: trip the breaker -------------------------------------
    if (weekReturn < -WEEK_DROP) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell";
      return "hold";
    }

    // ---- Cooling down -------------------------------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) ----------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
