/**
 * =============================================================================
 * Strategy: Deep Bear Exit (-50% from the high, back in above the 100-day line)
 *                                                        — tried on 2026-11-26
 * =============================================================================
 * THE IDEA (the extreme end of the insurance trade-off):
 *   - Nine coins and five BTC eras say the same thing about every rule on the
 *     board: they beat buy & hold almost every time the market FALLS (13-15 of
 *     15 asset-eras) and almost never when it RISES (1-6 of 16). They sell too
 *     often, so they leave during ordinary corrections and miss the rebounds.
 *   - What if the rule only ever left for a CATASTROPHE? Be invested by
 *     default and sell only when the close is more than 50% below the highest
 *     close seen so far (a true crypto bear market: BTC -84% in 2018, -77% in
 *     2022; BCH -95%; ADA -85%). That should almost never trigger in a rising
 *     market, so upside is untouched, yet it still sidesteps the second half
 *     of the worst collapses, where most of the lost value sits (a coin that
 *     falls 90% falls another 80% after crossing -50%).
 *   - Re-entry: once out, buy back only when the close is back above its
 *     100-day average (the trend has turned). No fixed clock, no price level
 *     tied to the old peak. Every (re-)entry starts a FRESH reference high at
 *     the entry price, so a dead-cat bounce that lifts price above the
 *     average while it is still far below the old peak cannot trigger an
 *     immediate re-exit and a fee-burning flip-flop.
 *   - Nothing tuned: -50% is "half the value gone", the lab's natural
 *     catastrophe line; 100 days is the midpoint of the 50/200 lines used
 *     elsewhere. Both declared before running. The "high so far" is the
 *     highest close since the last entry, so no future data is used.
 *
 * WHY IT MIGHT WORK: it keeps almost all of buy & hold's upside and cuts the
 *   worst of the crash, so it might beat buy & hold in rising markets
 *   without losing the falling-market edge.
 * WHY IT MIGHT FAIL: exiting at -50% means eating the first half of every
 *   crash, and the 100-day-line re-entry can be late, so after the first deep
 *   bear the rule may sit in cash through a recovery. Deep bears are also
 *   rare: a few triggers per coin makes any result a handful of bets, and the
 *   starting reference high depends on where the data window begins.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-26-deep-bear-exit.js
 *   - EXIT_DROP: how far below the running high triggers the exit
 *   - REENTRY_DAYS: the average the close must climb back above to re-enter
 * =============================================================================
 */

const EXIT_DROP = 0.5;     // sell when the close is more than 50% below the running high
const REENTRY_DAYS = 100;  // buy back when the close is above this many days' average

/** Simple average of the last `days` closes ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

// Module-level state (fine for this engine: one sequential pass).
let runningHigh = 0;   // highest close since the last (re-)entry this pass
let lastIndexSeen = -1;

module.exports = {
  name: "Deep Bear Exit -50% / 100d re-entry",
  description:
    "Catastrophe insurance: stay invested unless the close falls more than 50% below its running high, then sell and buy back only above the 100-day average",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) runningHigh = 0;
    lastIndexSeen = index;

    const close = candles[index].close;
    runningHigh = Math.max(runningHigh, close);
    const drop = (runningHigh - close) / runningHigh;

    // Catastrophe: more than half the value gone from the high -> step aside.
    if (position === "btc" && drop > EXIT_DROP) return "sell";

    // In cash: buy back once the trend has turned (close above its 100-day average),
    // or, in the very first days before an average exists, simply be invested.
    // Each entry restarts the reference high at the entry price.
    if (position === "cash") {
      const trendTurned = index + 1 >= REENTRY_DAYS && close > sma(candles, index, REENTRY_DAYS);
      const tooEarlyForAverage = index + 1 < REENTRY_DAYS;
      if (trendTurned || tooEarlyForAverage) {
        runningHigh = close;
        return "buy";
      }
    }

    return "hold";
  },
};
