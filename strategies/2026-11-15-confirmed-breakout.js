/**
 * =============================================================================
 * Strategy: Volume-Confirmed Breakout 20/10              — tried on 2026-11-15
 * =============================================================================
 * THE IDEA (does "volume confirms the breakout" actually help?):
 *   - A standard trader's rule: a breakout to a new high is only trustworthy
 *     if it comes on above-average volume - heavy trading means real
 *     participation, thin trading means a fake-out likely to reverse.
 *   - The lab has the control built in: the Donchian 20/10 breakout (buy a
 *     close above the prior 20-day high, sell a close below the prior 10-day
 *     low) was the best classic entry in the first weeks. This strategy is
 *     IDENTICAL except the buy additionally requires that the breakout day's
 *     volume exceed its 20-day average volume. Same exits, same fees. Any
 *     difference between the two is the pure value of volume confirmation.
 *   - Nothing tuned: 20/10 are copied from the Donchian file; "above its own
 *     20-day average" (ratio > 1.0) is the literal textbook condition. All
 *     declared before running; the commit includes the identical-data
 *     comparison with the plain Donchian.
 *
 * WHY IT MIGHT WORK: filters out the thin-volume fake breakouts that
 *   whipsaw trend followers, keeping the conviction-backed ones.
 * WHY IT MIGHT FAIL: breakout days often HAVE high volume (that is what
 *   makes them breakouts), so the filter may remove few false signals while
 *   delaying or skipping real ones. And volume in crypto is fragmented and
 *   noisy across exchanges, which dilutes what "above average" means.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-15-confirmed-breakout.js
 *   - ENTRY_DAYS / EXIT_DAYS: the Donchian windows (20/10 as in the control)
 *   - VOLUME_DAYS / VOLUME_RATIO: how loud the breakout day must be
 * =============================================================================
 */

const ENTRY_DAYS = 20;      // buy when the close beats the prior 20-day high...
const EXIT_DAYS = 10;       // ...sell when it breaks the prior 10-day low
const VOLUME_DAYS = 20;     // average volume window for the confirmation
const VOLUME_RATIO = 1.0;   // breakout-day volume must exceed ratio x average

/** Highest close of the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  let highest = -Infinity;
  for (let i = index - days; i < index; i++) highest = Math.max(highest, candles[i].close);
  return highest;
}

/** Lowest close of the `days` candles BEFORE `index` (today excluded). */
function lowestClose(candles, index, days) {
  let lowest = Infinity;
  for (let i = index - days; i < index; i++) lowest = Math.min(lowest, candles[i].close);
  return lowest;
}

/** Average volume of the `days` candles BEFORE `index` (today excluded). */
function averageVolume(candles, index, days) {
  let sum = 0;
  for (let i = index - days; i < index; i++) sum += candles[i].volume;
  return sum / days;
}

module.exports = {
  name: "Volume-Confirmed Breakout 20/10",
  description:
    "Donchian 20/10 with a volume filter: buy a close above the prior 20-day high only if that day's volume beats its 20-day average, sell a close below the prior 10-day low",

  decide({ candles, index, position }) {
    if (index < Math.max(ENTRY_DAYS, EXIT_DAYS, VOLUME_DAYS)) return "hold"; // warm-up

    const close = candles[index].close;

    // Breakout above the prior 20-day high WITH above-average volume -> buy.
    if (position === "cash" && close > highestClose(candles, index, ENTRY_DAYS)) {
      const loud =
        candles[index].volume > VOLUME_RATIO * averageVolume(candles, index, VOLUME_DAYS);
      if (loud) return "buy";
    }

    // Breakdown below the prior 10-day low -> sell (no volume condition).
    if (position === "btc" && close < lowestClose(candles, index, EXIT_DAYS)) return "sell";

    return "hold";
  },
};
