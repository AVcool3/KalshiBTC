/**
 * =============================================================================
 * Strategy: OBV Flow                                    — tried on 2026-10-17
 * =============================================================================
 * THE IDEA (volume as a cumulative FLOW, not a one-day spike):
 *   - Our only other volume strategy (Volume Surge, -12.28%) reacted to
 *     single loud days and got faked out, because one day's volume is
 *     ambiguous. ON-BALANCE VOLUME (OBV, from 1963) reads volume as a
 *     running tally instead: each up-day ADDS its volume to the line, each
 *     down-day SUBTRACTS it. The claim: the line tracks whether money is
 *     quietly accumulating or quietly leaving, ahead of price.
 *   - Rule: hold BTC while the OBV line is above its own 20-day average
 *     (net flow trending in), sit in cash while below (net flow trending
 *     out). The same above/below-the-line mechanic as the 200-Day Line,
 *     but applied to money flow instead of price.
 *
 * WHY IT MIGHT FAIL: OBV weights a +0.1% drift day the same as a +8%
 * surge, so the "flow" is mostly just the sequence of up/down days wearing
 * a volume costume - and we've already measured that daily up/down
 * sequences carry little tradable signal (both streak strategies lost).
 * If OBV adds nothing beyond that, this trades like a noisy, fee-heavy
 * crossover.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-17-obv-flow.js
 *   - OBV_SMA_DAYS: the smoothing window; longer = fewer, slower signals
 * =============================================================================
 */

const OBV_SMA_DAYS = 20; // hold while OBV is above its average of this many days

// ---------------------------------------------------------------------------
// OBV is a cumulative series, so compute it once per pass and cache it.
// obv[i] only depends on candles[0..i], so reading obv[index] has no
// lookahead. Same caching pattern as the MACD strategy.
// ---------------------------------------------------------------------------
let cache = null; // { length, obv: [...] }

function computeObv(candles) {
  const obv = [0]; // the starting level is arbitrary; only the SHAPE matters
  for (let i = 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    // Up day: that day's volume counts as buying. Down day: as selling.
    const signed = change > 0 ? candles[i].volume : change < 0 ? -candles[i].volume : 0;
    obv.push(obv[i - 1] + signed);
  }
  return { length: candles.length, obv };
}

module.exports = {
  name: "OBV Flow 20",
  description:
    "Cumulative money flow: hold BTC while the on-balance-volume line runs above its 20-day average, cash while net flow turns down",

  decide({ candles, index, position }) {
    if (index + 1 < OBV_SMA_DAYS + 1) return "hold"; // warm-up

    if (!cache || cache.length !== candles.length) cache = computeObv(candles);
    const obv = cache.obv;

    // Average of the OBV line over the last OBV_SMA_DAYS days.
    let sum = 0;
    for (let i = index - OBV_SMA_DAYS + 1; i <= index; i++) sum += obv[i];
    const line = sum / OBV_SMA_DAYS;

    // Money flowing in -> be invested. Flowing out -> stand aside.
    if (obv[index] > line && position === "cash") return "buy";
    if (obv[index] < line && position === "btc") return "sell";

    return "hold";
  },
};
