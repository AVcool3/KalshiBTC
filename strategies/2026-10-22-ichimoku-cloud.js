/**
 * =============================================================================
 * Strategy: Ichimoku Cloud 9/26/52                       — tried on 2026-10-22
 * =============================================================================
 * THE IDEA (the last famous trend system the lab hasn't measured):
 *   - The Ichimoku Cloud (Goichi Hosoda, 1960s Japan) builds everything out
 *     of MIDPOINTS of recent high-low ranges instead of averages of closes:
 *       Tenkan  = midpoint of the last  9 days' range  (fast line)
 *       Kijun   = midpoint of the last 26 days' range  (slow line)
 *       Senkou A = (Tenkan + Kijun) / 2, drawn 26 days AHEAD
 *       Senkou B = midpoint of the last 52 days' range, drawn 26 days AHEAD
 *     The area between Senkou A and B is "the cloud": a support/resistance
 *     zone that today inherited from where the market traded a month ago.
 *   - Rule tested here (the system's core signal, kept to our long/cash
 *     world): hold BTC while the close is ABOVE the cloud, sit in cash
 *     while it is BELOW; inside the cloud, keep whatever position you have
 *     (the cloud is the "undecided" zone - no new action inside it).
 *   - Note the plumbing: the cloud at today's index was computed from data
 *     26 days OLD (that is what "drawn ahead" means), so there is no
 *     lookahead - today is judged against month-old equilibrium levels.
 *
 * WHY IT MIGHT WORK: range midpoints ignore where closes clustered, so the
 *   cloud moves slower than any close-based average - and the only trend
 *   filters that survived here were the SLOW ones (the 200-day line). The
 *   neutral zone also kills some whipsaw: no flip-flopping on every cross.
 * WHY IT MIGHT FAIL: it is still a lagging trend filter in a market where
 *   every lagging filter except the 200-day line has lost to buy & hold,
 *   and the month-old anchor may simply be the wrong timescale - faster
 *   than 200 days, slower than a breakout, best of neither.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-22-ichimoku-cloud.js
 *   - TENKAN/KIJUN/SENKOU_B: the classic 9/26/52 windows
 *   - SHIFT: how far ahead the cloud is projected (classically = KIJUN)
 * =============================================================================
 */

const TENKAN = 9;    // fast midpoint window (only used inside Senkou A)
const KIJUN = 26;    // slow midpoint window
const SENKOU_B = 52; // widest midpoint window
const SHIFT = 26;    // the cloud is drawn this many days ahead

/** Midpoint of the high-low range over the `days` ending at `index`. */
function midpoint(candles, index, days) {
  let hi = -Infinity, lo = Infinity;
  for (let i = index - days + 1; i <= index; i++) {
    hi = Math.max(hi, candles[i].high);
    lo = Math.min(lo, candles[i].low);
  }
  return (hi + lo) / 2;
}

module.exports = {
  name: "Ichimoku Cloud 9/26/52",
  description:
    "The classic Japanese trend system: hold BTC while the close sits above the cloud (month-old range midpoints projected forward), cash while below, no action inside it",

  decide({ candles, index, position }) {
    // Warm-up: the cloud under today was computed SHIFT days ago and its
    // Senkou B needed SENKOU_B days of history behind THAT point.
    if (index < SENKOU_B + SHIFT) return "hold";

    // The cloud at today's index = spans computed at (index - SHIFT).
    const base = index - SHIFT;
    const senkouA = (midpoint(candles, base, TENKAN) + midpoint(candles, base, KIJUN)) / 2;
    const senkouB = midpoint(candles, base, SENKOU_B);
    const cloudTop = Math.max(senkouA, senkouB);
    const cloudBottom = Math.min(senkouA, senkouB);

    const close = candles[index].close;

    // Above the cloud: the market cleared month-old resistance -> be long.
    if (close > cloudTop && position === "cash") return "buy";

    // Below the cloud: month-old support gave way -> stand aside.
    if (close < cloudBottom && position === "btc") return "sell";

    // Inside the cloud: the undecided zone - keep whatever you hold.
    return "hold";
  },
};
