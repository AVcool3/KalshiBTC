/**
 * =============================================================================
 * Strategy: Halving Cycle Hold 365d                      — tried on 2026-11-07
 * =============================================================================
 * THE IDEA (the most famous calendar claim in crypto):
 *   - Roughly every four years Bitcoin's block reward is cut in half (a
 *     "halving"), which cuts the rate of NEW supply. The folklore: prices
 *     rise for the 12-18 months after each halving as supply tightens,
 *     peak, then crash into a bear market that lasts until the next one.
 *     So: be long after a halving, be in cash for the rest of the cycle.
 *   - Rule: hold BTC from the close of each halving date through
 *     HOLD_DAYS days afterwards; cash the rest of the time.
 *   - The halving dates are protocol facts, not fitted numbers:
 *       2012-11-28, 2016-07-09, 2020-05-11, 2024-04-20.
 *   - HOLD_DAYS is the only choice. Past cycle PEAKS landed ~525-580 days
 *     after the halving, so choosing 540 would be hindsight-tuned to three
 *     data points. I declared a ROUND 365 days before running instead, and
 *     the commit shows the sweep (270 / 365 / 540 / 730) so the sensitivity
 *     is visible. With only three halvings in the data this CANNOT be
 *     validated statistically: it is a folklore check, not a finding.
 *
 * WHY IT MIGHT WORK: supply shocks are real, and the pattern has held in
 *   all three cycles that Coinbase data covers (2016, 2020, 2024).
 * WHY IT MIGHT FAIL: n = 3, every claimed mechanism is confounded with the
 *   macro cycle (rate cuts, liquidity), the 2024 cycle already looks
 *   different (ETF flows, much smaller percentage moves), and a strategy
 *   that is in cash roughly half of every cycle gives up the half of the
 *   time that buy & hold keeps compounding.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-07-halving-cycle.js
 *   - HOLD_DAYS: how long after a halving to stay long (365 declared)
 *   - HALVINGS: the protocol dates; add the next one (~April 2028) later
 * =============================================================================
 */

const HOLD_DAYS = 365; // days to hold after each halving (round number, declared up front)

// Protocol facts (UTC dates of block-reward halvings).
const HALVINGS = ["2012-11-28", "2016-07-09", "2020-05-11", "2024-04-20"];

const DAY_MS = 86400000;
const halvingTimes = HALVINGS.map((d) => Date.parse(d + "T00:00:00Z"));

/** Is the candle's date within HOLD_DAYS after (and including) any halving? */
function inCycleWindow(candle) {
  const t = Date.parse(candle.date + "T00:00:00Z");
  for (const h of halvingTimes) {
    const daysSince = (t - h) / DAY_MS;
    if (daysSince >= 0 && daysSince <= HOLD_DAYS) return true;
  }
  return false;
}

module.exports = {
  name: "Halving Cycle Hold 365d",
  description:
    "Crypto folklore: hold BTC for 365 days after each halving (2016, 2020, 2024 dates), cash for the rest of the four-year cycle",

  decide({ candles, index, position }) {
    const hold = inCycleWindow(candles[index]);

    if (hold && position === "cash") return "buy";
    if (!hold && position === "btc") return "sell";
    return "hold";
  },
};
