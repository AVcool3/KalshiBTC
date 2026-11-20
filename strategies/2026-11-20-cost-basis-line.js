/**
 * =============================================================================
 * Strategy: Cost-Basis Line (90-day VWAP)                — tried on 2026-11-20
 * =============================================================================
 * THE IDEA (price vs. what the average recent buyer actually paid):
 *   - A simple moving average treats every day equally. The volume-weighted
 *     average price (VWAP) weights each day's price by how much BTC changed
 *     hands that day, so it approximates the AVERAGE COST BASIS of everyone
 *     who bought over the window: busy days count more than quiet ones.
 *   - The folk theory: when price is above the average recent buyer's cost,
 *     most holders are in profit and trends tend to continue; when price is
 *     below it, most are underwater, and many will sell any rally to get
 *     back to even (overhead supply), so rallies fail.
 *   - Rule: hold BTC while today's close is above the 90-day VWAP, cash
 *     while below. Same shape as the lab's 200-Day Line rule (which has
 *     worked as an insurance filter), but the line is cost basis instead of
 *     a plain average.
 *   - It is a controlled comparison: the identical rule with the plain
 *     90-day average is the control (run in the commit), so any difference
 *     is purely the effect of volume weighting.
 *   - Nothing tuned: 90 days (about one quarter), no buffer; declared before
 *     running.
 *
 * WHY IT MIGHT WORK: volume-weighting pulls the line toward the prices where
 *   the heavy trading actually happened, which is closer to a real support /
 *   resistance level than an equal-weighted average.
 * WHY IT MIGHT FAIL: Coinbase volume is only one venue and its share of BTC
 *   trading has changed a lot, and a VWAP behaves very much like a moving
 *   average in practice (volume is only mildly uneven day to day), so this
 *   may simply be the SMA filter with a different name, with all of its
 *   lag and whipsaw.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-20-cost-basis-line.js
 *   - VWAP_DAYS: window for the cost-basis average (longer = slower line)
 * =============================================================================
 */

const VWAP_DAYS = 90; // days of volume-weighted prices in the cost-basis line

/** Volume-weighted average price of the VWAP_DAYS days ending at `index`. */
function vwap(candles, index) {
  let priceTimesVolume = 0;
  let volume = 0;
  for (let i = index - VWAP_DAYS + 1; i <= index; i++) {
    // Typical price of the day: the average of its high, low and close.
    const typical = (candles[i].high + candles[i].low + candles[i].close) / 3;
    priceTimesVolume += typical * candles[i].volume;
    volume += candles[i].volume;
  }
  return volume === 0 ? candles[index].close : priceTimesVolume / volume;
}

module.exports = {
  name: "Cost-Basis Line 90d VWAP",
  description:
    "Cost-basis trend filter: hold BTC while the close is above the 90-day volume-weighted average price (what the average recent buyer paid), cash while below",

  decide({ candles, index, position }) {
    if (index + 1 < VWAP_DAYS) return "hold"; // warm-up

    const aboveCostBasis = candles[index].close > vwap(candles, index);

    if (aboveCostBasis && position === "cash") return "buy";
    if (!aboveCostBasis && position === "btc") return "sell";
    return "hold";
  },
};
