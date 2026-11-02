/**
 * =============================================================================
 * Strategy: High Proximity 180d/20%                      — tried on 2026-11-02
 * =============================================================================
 * THE IDEA (the "52-week-high" momentum anomaly, George & Hwang 2004):
 *   - In stocks, a surprisingly strong predictor of future returns is not
 *     how much an asset has risen, but how CLOSE it is to its recent
 *     high. Assets within a few percent of their high keep outperforming;
 *     assets far below it keep lagging. The usual story: traders anchor on
 *     the high, so good news gets under-reacted to as price approaches it.
 *   - Rule: look at the highest close of the last LOOKBACK days.
 *       HOLD BTC while today's close is within BAND (20%) of that high.
 *       CASH   when price is more than BAND below that high.
 *     No averages, no crossovers - one number: "how far off the high am I?"
 *   - It is the exact INVERSE of the lab's Drawdown Bargain (+19.7%, one
 *     trade), which BOUGHT when price sat 25% below the 180-day high. If
 *     the anomaly is real, that contrarian bet should be on the wrong
 *     side of it; this tests the other side.
 *   - A 180-day lookback (not the classic 365) keeps most of our 2-year
 *     window usable after warm-up.
 *
 * WHY IT MIGHT WORK: it is a trailing-stop-from-the-peak system whose stop
 *   RESETS upward whenever a new high prints, so it rides trends and exits
 *   bear markets once they've fallen 20% - without a lagging average.
 * WHY IT MIGHT FAIL: a 20% stop is wide for a daily-noise filter but BTC
 *   routinely drops 20% in a healthy bull trend and rebounds; exiting
 *   there is a sell-low, and the re-entry (within 20% of a high that may
 *   be far above) comes only after the rebound is mostly over.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-02-high-proximity.js
 *   - LOOKBACK: how many days define "the high" (180 here; 365 classic)
 *   - BAND: how far below the high still counts as "near" (0.20 = 20%)
 * =============================================================================
 */

const LOOKBACK = 180; // days that define "the recent high"
const BAND = 0.20;    // within this fraction below the high = "near the high"

/** Highest close over the LOOKBACK days ending at `index` (today included). */
function recentHigh(candles, index) {
  let hi = -Infinity;
  for (let i = index - LOOKBACK + 1; i <= index; i++) {
    hi = Math.max(hi, candles[i].close);
  }
  return hi;
}

module.exports = {
  name: "High Proximity 180d/20%",
  description:
    "52-week-high momentum: hold BTC while the close is within 20% of its 180-day high, cash once it falls more than 20% below - the inverse of Drawdown Bargain",

  decide({ candles, index, position }) {
    if (index + 1 < LOOKBACK) return "hold"; // warm-up

    const close = candles[index].close;
    const high = recentHigh(candles, index);
    const nearHigh = close >= high * (1 - BAND);

    // Near the high -> the anchor-and-under-react story says stay long.
    if (nearHigh && position === "cash") return "buy";

    // Far below the high -> the laggard side of the anomaly -> stand aside.
    if (!nearHigh && position === "btc") return "sell";

    return "hold";
  },
};
