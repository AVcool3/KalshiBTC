/**
 * =============================================================================
 * Strategy: Phase Ensemble 7x (50-day line)              — tried on 2026-11-11
 * =============================================================================
 * THE IDEA (cancel out timing luck by polling all seven weekly phases):
 *   - Yesterday's Sunday Check showed that the identical rule - "close above
 *     its 50-day average = long" - checked on a Wednesday returned +19% in
 *     the current window, on a Sunday -23%, on a Friday -20%. Which weekday
 *     you happen to check on decided the outcome by 40+ points. That is
 *     pure phase noise, and we can't know in advance which day is lucky.
 *   - Fix: don't choose. Run seven weekly checkers, one per weekday (Mon,
 *     Tue, ... Sun). Each checker only updates its opinion on its own day
 *     ("above the 50-day line -> long vote", "below -> cash vote") and
 *     remembers it until its next check. Then take the MAJORITY: hold BTC
 *     while at least 4 of the 7 checkers currently say long.
 *   - Effect: the position changes only when the majority flips, which takes
 *     several days of evidence, so single-day pokes through the line are
 *     filtered out, and no single check day can make or break the result.
 *     (This is "parameter-luck insurance", like the Donchian and Breaker
 *     ensembles, applied to the PHASE parameter.)
 *   - Nothing tuned: the 50-day line and a simple majority (4 of 7) are
 *     declared before running.
 *
 * WHY IT MIGHT WORK: it keeps the weekly-check strategy's fee savings and
 *   removes its dependence on one lucky weekday, producing roughly the
 *   AVERAGE of the seven single-phase results with lower variance.
 * WHY IT MIGHT FAIL: an average of seven mediocre results is still
 *   mediocre; the ensemble can only remove luck, not add edge, so if the
 *   50-day rule itself is a loser in a window, the ensemble loses with it.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-11-phase-ensemble.js
 *   - SMA_DAYS: the line each checker compares against
 *   - VOTES_NEEDED: how many of the 7 must say long (4 = simple majority)
 * =============================================================================
 */

const SMA_DAYS = 50;     // the trend line every checker uses
const VOTES_NEEDED = 4;  // majority of 7 weekday checkers

/** Average close of the SMA_DAYS days ending at `i`. */
function sma(candles, i) {
  let sum = 0;
  for (let k = i - SMA_DAYS + 1; k <= i; k++) sum += candles[k].close;
  return sum / SMA_DAYS;
}

module.exports = {
  name: "Phase Ensemble 7x 50d",
  description:
    "Anti-timing-luck: seven weekly checkers (one per weekday) each vote close-above-50-day-line; hold BTC while at least 4 of 7 currently say long",

  decide({ candles, index, position }) {
    if (index < SMA_DAYS + 7) return "hold"; // warm-up: every checker needs one check

    // Each checker's latest opinion = its most recent check day (<= today).
    // Walk back over the last 7 days: every weekday appears exactly once, so
    // that day IS each checker's most recent check. Only past candles are read.
    let longVotes = 0;
    for (let back = 0; back < 7; back++) {
      const d = index - back;
      if (candles[d].close > sma(candles, d)) longVotes++;
    }

    const wantLong = longVotes >= VOTES_NEEDED;
    if (wantLong && position === "cash") return "buy";
    if (!wantLong && position === "btc") return "sell";
    return "hold";
  },
};
