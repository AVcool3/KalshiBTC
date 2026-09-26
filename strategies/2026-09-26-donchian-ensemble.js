/**
 * =============================================================================
 * Strategy: Donchian Ensemble (5-voter majority)        — tried on 2026-09-26
 * =============================================================================
 * THE IDEA (the standard defense against yesterday's finding):
 *   - Yesterday we learned the champion's edge is NOT parameter-robust:
 *     Donchian 20/10 made +40.50% while the same idea at 55/20 LOST 29.49%.
 *     Betting on one parameter pair is betting it stays the lucky one.
 *   - The classic fix is an ENSEMBLE: run several parameterizations at once
 *     and follow the MAJORITY. Each "voter" below is a Donchian system
 *     (enter above the prior N-day high, exit below the prior M-day low)
 *     tracking its own virtual in/out state every day:
 *         10/5, 15/8, 20/10, 30/15, 40/20
 *   - When 3 or more of the 5 voters are long -> we hold BTC.
 *     When fewer than 3 are long -> we hold cash.
 *
 * WHY IT MIGHT WORK: an ensemble's result is an average over the parameter
 * neighborhood, so it can't secretly depend on one magic number — if the
 * BREAKOUT IDEA has real merit, the ensemble captures it with far less luck.
 * WHY IT MIGHT FAIL: if 20/10 truly was a lone island of luck in a sea of
 * losers (yesterday's evidence points this way), averaging the neighborhood
 * just averages the losers. That result would close the case on breakouts
 * for this sample: idea dead, not just parameters wrong.
 *
 * HOW TO CHANGE THINGS: tweak the arrays/threshold below and re-run:
 *   node backtest/run.js strategies/2026-09-26-donchian-ensemble.js
 *   - VOTERS: add/remove [entryDays, exitDays] pairs
 *   - MAJORITY: votes needed to be invested (e.g. 2 = more aggressive,
 *     4 = only when the whole neighborhood agrees)
 * =============================================================================
 */

// Each voter is [entryDays, exitDays] — a full Donchian system of its own.
const VOTERS = [
  [10, 5],
  [15, 8],
  [20, 10], // the current champion sits in the middle of the neighborhood
  [30, 15],
  [40, 20],
];
const MAJORITY = 3; // hold BTC while at least this many voters are long

// Module-level state: each voter's own virtual in/out position, updated every
// day no matter what the real portfolio does. (Fine for this engine: one
// strategy, one sequential pass over the candles.)
let voterLong = VOTERS.map(() => false);
let lastIndexSeen = -1;

/** Highest close among the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  let h = -Infinity;
  for (let i = index - days; i < index; i++) h = Math.max(h, candles[i].close);
  return h;
}

/** Lowest close among the `days` candles BEFORE `index` (today excluded). */
function lowestClose(candles, index, days) {
  let l = Infinity;
  for (let i = index - days; i < index; i++) l = Math.min(l, candles[i].close);
  return l;
}

module.exports = {
  name: "Donchian Ensemble 5x",
  description:
    "Anti-parameter-luck: five Donchian systems (10/5 to 40/20) each vote long or flat; hold BTC only while a majority are long",

  decide({ candles, index, position }) {
    // Warm-up: the slowest voter needs its full entry window of history.
    const slowest = Math.max(...VOTERS.map(([entry]) => entry));
    if (index < slowest) return "hold";

    // Guard against being run twice on the same index (fresh pass = reset).
    if (index <= lastIndexSeen) voterLong = VOTERS.map(() => false);
    lastIndexSeen = index;

    const today = candles[index].close;

    // ---- Update every voter's virtual position for today -----------------
    for (let v = 0; v < VOTERS.length; v++) {
      const [entryDays, exitDays] = VOTERS[v];
      if (!voterLong[v] && today > highestClose(candles, index, entryDays)) {
        voterLong[v] = true; // this voter's breakout fired -> it goes long
      } else if (voterLong[v] && today < lowestClose(candles, index, exitDays)) {
        voterLong[v] = false; // this voter's exit fired -> it goes flat
      }
    }

    // ---- Follow the majority ---------------------------------------------
    const longVotes = voterLong.filter(Boolean).length;

    if (longVotes >= MAJORITY && position === "cash") return "buy";
    if (longVotes < MAJORITY && position === "btc") return "sell";

    return "hold";
  },
};
