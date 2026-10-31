/**
 * =============================================================================
 * Strategy: Relative Breaker (2.5 sigma)                 — tried on 2026-10-31
 * =============================================================================
 * THE IDEA (a scale-free version of the champion's trigger):
 *   - The four-era check showed Circuit Breaker Hold beating buy & hold in
 *     three eras and losing only in the 2017 mania. The diagnosis: in 2017
 *     a -5% day was ROUTINE (BTC moved 4-5% on a normal day), so a fixed
 *     -5% trigger tripped 34 times and kept the account out of a 13x rally.
 *     "Big" is relative: -5% is a shock in a calm market and a Tuesday in
 *     a wild one.
 *   - Fix: define a panic day relative to the market's own recent normal.
 *       sigma = standard deviation of the previous 60 daily returns
 *               (yesterday and earlier only - never today's)
 *       trip  = today's return is worse than -TRIP_SIGMAS x sigma
 *     At 2.5 sigma and BTC's recent ~2% daily sigma, the trigger lands
 *     right around -5%, so the calm-era behavior stays close to the
 *     champion; in a wild era sigma doubles and the trigger widens to ~-10%,
 *     so only genuine shocks trip it. Cooldown stays the champion's dumb
 *     fixed 10 days (calm-sensing cooldowns lost).
 *   - 2.5 sigma was picked by arithmetic (5% / ~2%), BEFORE running, and
 *     is the only setting declared for the scoreboard row.
 *
 * WHY IT MIGHT WORK: it keeps the champion's one validated mechanism
 *   (crash-day clustering) while removing the one regime where the fixed
 *   threshold misfires, so it should match the champion where it works and
 *   improve where it failed.
 * WHY IT MIGHT FAIL: sigma is itself a trailing measure; after a crash it
 *   inflates and the trigger loosens just when a second leg down is most
 *   likely. The lab has also gone 0-for-6 on champion variants - every
 *   "smarter" tweak so far lost to the plain -5% rule out of sample.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-31-relative-breaker.js
 *   - TRIP_SIGMAS: how many sigmas down counts as a panic day
 *   - SIGMA_DAYS: how many past days define "normal" volatility
 *   - COOLDOWN_DAYS: the champion's validated sit-out
 * =============================================================================
 */

const TRIP_SIGMAS = 2.5;  // a drop worse than this many sigmas trips it
const SIGMA_DAYS = 60;    // days of past returns that define "normal"
const COOLDOWN_DAYS = 10; // the champion's validated sit-out

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

/** Daily return on day i (close-to-close). */
function ret(candles, i) {
  return (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
}

/** Std-dev of the SIGMA_DAYS daily returns ENDING YESTERDAY (index - 1). */
function sigma(candles, index) {
  let sum = 0;
  for (let i = index - SIGMA_DAYS; i < index; i++) sum += ret(candles, i);
  const mean = sum / SIGMA_DAYS;
  let sq = 0;
  for (let i = index - SIGMA_DAYS; i < index; i++) sq += (ret(candles, i) - mean) ** 2;
  return Math.sqrt(sq / SIGMA_DAYS);
}

module.exports = {
  name: "Relative Breaker 2.5 sigma",
  description:
    "The champion with a volatility-relative trigger: trip when today's drop is worse than 2.5x the trailing 60-day return sigma (not a fixed -5%), then sit out 10 days",

  decide({ candles, index, position }) {
    // Need SIGMA_DAYS past returns (each needs a prior close) before today.
    if (index < SIGMA_DAYS + 1) return "hold";

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    // ---- Panic day: worse than TRIP_SIGMAS x the recent normal ---------------
    if (ret(candles, index) < -TRIP_SIGMAS * sigma(candles, index)) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell"; // step aside at today's close
      return "hold"; // already in cash; the trip just restarts the clock
    }

    // ---- Cooling down ---------------------------------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) -----------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
