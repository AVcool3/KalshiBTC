/**
 * =============================================================================
 * Strategy: Quiet Market Hold                            — tried on 2026-10-23
 * =============================================================================
 * THE IDEA (volatility itself as the ONLY signal):
 *   - This week's 2017-2019 validation taught the lab its biggest lesson:
 *     the champion's edge lives in CALM regimes and dies in loud ones. And
 *     the live paper trader already uses a volatility gate as a safety
 *     check. So test the gate as a complete strategy on its own:
 *       hold BTC while the market is QUIET, cash while it is LOUD.
 *   - "Quiet" = the 10-day realized volatility (the standard deviation of
 *     the last 10 daily close-to-close returns) is below 4% per day.
 *     No price direction, no trend, no levels - just how shaky the
 *     ground is. Volatility famously CLUSTERS (loud days follow loud
 *     days), and in crypto the loud clusters have mostly been crashes.
 *   - This is different from everything tried so far: every prior filter
 *     watched where price WENT; this one only watches how much it SHAKES.
 *
 * WHY IT MIGHT WORK: vol clustering is one of the few iron laws of
 *   markets, and the breaker's post-crash cooldown (the one validated
 *   edge) is really a crude one-shot volatility filter - this is the same
 *   idea made continuous.
 * WHY IT MIGHT FAIL: vol is a LAGGING alarm - it spikes only after the
 *   first big drop has already hurt you. And big UP days raise vol too,
 *   so the gate can sell into strength exactly like the failed Euphoria
 *   Breaker; BTC manias are loud in both directions.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-23-quiet-market-hold.js
 *   - VOL_WINDOW: how many days of returns the vol estimate uses
 *   - VOL_GATE: the quiet/loud line (0.04 = 4% daily stdev, the same
 *     threshold the live paper trader's macro gate uses)
 * =============================================================================
 */

const VOL_WINDOW = 10; // days of returns in the realized-vol estimate
const VOL_GATE = 0.04; // quiet below this daily stdev, loud above it

/** Realized vol at `index`: stdev of the last VOL_WINDOW daily returns. */
function realizedVol(candles, index) {
  const rets = [];
  for (let i = index - VOL_WINDOW + 1; i <= index; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

module.exports = {
  name: "Quiet Market Hold 10d/4%",
  description:
    "Volatility as the only signal: hold BTC while 10-day realized vol is under 4%/day, cash while the market is loud - no direction, no levels, just shake",

  decide({ candles, index, position }) {
    // Warm-up: the vol estimate needs VOL_WINDOW returns behind it.
    if (index < VOL_WINDOW) return "hold";

    const vol = realizedVol(candles, index);

    // Quiet ground -> be invested (the market's good days live here).
    if (vol < VOL_GATE && position === "cash") return "buy";

    // Loud ground -> stand aside until the shaking stops.
    if (vol >= VOL_GATE && position === "btc") return "sell";

    return "hold";
  },
};
