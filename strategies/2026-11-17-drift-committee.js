/**
 * =============================================================================
 * Strategy: Drift t-Stat Committee 30/60/120             — tried on 2026-11-17
 * =============================================================================
 * THE IDEA (insure the drift t-stat lead against its own window luck):
 *   - Yesterday's Drift t-Stat (60-day window, buy above t = 1, sell below
 *     t = 0) was the first rule on the board whose neighbouring settings
 *     all looked alike, but the commit said what it needed next: more ERAS,
 *     not more cells. A single window is still one roll of the dice (its
 *     90-day neighbour beat buy & hold in two eras, the 60-day in three).
 *   - So: three members, each the same rule on a different window
 *     (30, 60 and 120 days: roughly one, two and four months). Each keeps
 *     its OWN long/flat state with the same hysteresis:
 *         flat -> long when its t-statistic rises above 1.0
 *         long -> flat when its t-statistic falls below 0.0
 *     Hold BTC while at least 2 of the 3 members are long.
 *   - Same philosophy as the Donchian, Breaker and Phase ensembles: it
 *     cannot add edge, it can only stop one lucky or unlucky window from
 *     deciding the result.
 *   - Nothing tuned: the three windows are 30/60/120 (a doubling ladder
 *     around the 60 already declared), thresholds are yesterday's 1 and 0,
 *     majority is 2 of 3. All declared before running; the commit also
 *     tests it on a FIFTH era (2023 to Nov 2024) that no setting here was
 *     ever run on.
 *
 * WHY IT MIGHT WORK: majority voting smooths out each window's noisy
 *   crossings, so the position flips only when two timescales agree, which
 *   should cut trades without losing the long trends.
 * WHY IT MIGHT FAIL: members are highly correlated (they read the same
 *   prices), so the vote is closer to one opinion than three; and it
 *   inherits the family's weakness: return-based momentum buys late and
 *   sells late, and with so few trades per era the results are mostly a
 *   handful of timing bets.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-17-drift-committee.js
 *   - WINDOWS: the members' lookbacks (days of returns in each t-statistic)
 *   - ENTER_T / EXIT_T: buy and sell thresholds (the gap is the dead zone)
 *   - VOTES_NEEDED: how many members must be long (2 of 3 = majority)
 * =============================================================================
 */

const WINDOWS = [30, 60, 120]; // one member per window
const ENTER_T = 1.0;           // a member goes long above this t-statistic
const EXIT_T = 0.0;            // a member goes flat below this t-statistic
const VOTES_NEEDED = 2;        // majority of three

// Module-level state: each member's own long/flat flag (hysteresis needs memory).
let memberLong = WINDOWS.map(() => false);
let lastIndexSeen = -1;

/** t-statistic of the mean daily return over the `window` days ending at `index`. */
function driftT(candles, index, window) {
  const rets = [];
  for (let i = index - window + 1; i <= index; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / window;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (window - 1);
  const stdErr = Math.sqrt(variance / window);
  return stdErr === 0 ? 0 : mean / stdErr;
}

module.exports = {
  name: "Drift Committee 30/60/120",
  description:
    "Anti-window-luck: three drift t-statistic members (30, 60 and 120-day windows, enter above 1, exit below 0) each keep their own state; hold BTC while at least 2 of 3 are long",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> reset all members.
    if (index <= lastIndexSeen) memberLong = WINDOWS.map(() => false);
    lastIndexSeen = index;

    // Update every member that has enough history; the others stay flat.
    WINDOWS.forEach((w, k) => {
      if (index < w) return;
      const t = driftT(candles, index, w);
      if (!memberLong[k] && t > ENTER_T) memberLong[k] = true;
      else if (memberLong[k] && t < EXIT_T) memberLong[k] = false;
    });

    const votes = memberLong.filter(Boolean).length;
    const wantLong = votes >= VOTES_NEEDED;

    if (wantLong && position === "cash") return "buy";
    if (!wantLong && position === "btc") return "sell";
    return "hold";
  },
};
