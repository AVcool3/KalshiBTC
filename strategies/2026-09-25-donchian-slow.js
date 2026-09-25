/**
 * =============================================================================
 * Strategy: Donchian Breakout 55/20 (the "slow turtle") — tried on 2026-09-25
 * =============================================================================
 * THE IDEA (a robustness test of the reigning champion):
 *   - Same mechanism as the champion Donchian 20/10: buy a close above the
 *     prior N-day high, sell a close below the prior M-day low.
 *   - But with the ORIGINAL turtle traders' slower "System 2" windows:
 *     enter on a 55-DAY high (a much rarer, stronger breakout) and exit on
 *     a 20-DAY low (a looser leash that rides trends longer).
 *
 * WHY THIS EXPERIMENT MATTERS MORE THAN A NEW IDEA: our 20/10 champion's
 * +40.50% is a single result on a single 2-year sample. If the breakout
 * EDGE is real, nearby parameters (55/20) should also do decently — maybe
 * a bit better or worse, but in the same ballpark. If 55/20 flops badly,
 * it suggests 20/10 was substantially LUCK (a "parameter island"), and we
 * should trust the champion less. Either result teaches us something no
 * brand-new strategy could.
 *
 * WHY IT MIGHT WIN: fewer, higher-conviction entries and a looser exit
 * mean less whipsaw and fewer fees — the two killers on our scoreboard.
 * WHY IT MIGHT LOSE: a 55-day high arrives LATE (much of the trend is
 * already spent) and a 20-day-low exit gives back a big slice of every
 * trend before letting go.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-25-donchian-slow.js
 *   (Set 20/10 to reproduce the champion exactly.)
 * =============================================================================
 */

const ENTRY_DAYS = 55; // buy when today's close beats the prior 55-day high
const EXIT_DAYS = 20;  // sell when today's close breaks the prior 20-day low

/** Highest close among the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  if (index < days) return null;
  let highest = -Infinity;
  for (let i = index - days; i < index; i++) {
    if (candles[i].close > highest) highest = candles[i].close;
  }
  return highest;
}

/** Lowest close among the `days` candles BEFORE `index`. Null in warm-up. */
function lowestClose(candles, index, days) {
  if (index < days) return null;
  let lowest = Infinity;
  for (let i = index - days; i < index; i++) {
    if (candles[i].close < lowest) lowest = candles[i].close;
  }
  return lowest;
}

module.exports = {
  name: "Donchian Breakout 55/20",
  description:
    "Robustness test of the champion: same turtle mechanism with the original slow windows - enter on a 55-day high, exit on a 20-day low",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const today = candles[index].close;
    const entryLevel = highestClose(candles, index, ENTRY_DAYS);
    const exitLevel = lowestClose(candles, index, EXIT_DAYS);

    if (entryLevel === null || exitLevel === null) return "hold"; // warm-up

    // Rare, strong breakout while in cash -> get aboard.
    if (today > entryLevel && position === "cash") return "buy";

    // Trend rolled over on the looser leash -> get out.
    if (today < exitLevel && position === "btc") return "sell";

    return "hold";
  },
};
