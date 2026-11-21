/**
 * =============================================================================
 * Strategy: Fast Trailing Stop 30d (-15% out, -7% back in) — tried on 2026-11-21
 * =============================================================================
 * THE IDEA (protection that keys on DEPTH of the fall, and acts fast):
 *   - The lab's latest lesson (five eras, nine failed champion variants) is
 *     that faster protection beats smarter protection: every attempt to wait
 *     for more evidence before exiting cost more in the bear markets than it
 *     saved in the bull markets. The champion is fast but keys on the size of
 *     ONE DAY. A trailing stop is fast in a different way: it keys on how far
 *     price has fallen from its recent peak, however many days that took,
 *     so it also catches the slow-drip declines a one-day trigger misses.
 *   - Rule: track the highest close of the last 30 days (the recent peak).
 *       EXIT  when the close falls more than 15% below that peak
 *       ENTER when the close is back within 7% of the (new) 30-day peak
 *     The gap between 15% and 7% is hysteresis: without it, price hovering
 *     around one line would whipsaw us in and out. Default state is invested
 *     (so, like the champion, it starts long and only leaves for a real drop).
 *   - Nothing tuned: 30 days is one month, 15% is the usual "correction"
 *     line (10% is a pullback, 20% a bear market), 7% is half of it.
 *     All declared before running; the commit shows neighbours and the
 *     five-era table next to the champion and Belt & Suspenders.
 *
 * WHY IT MIGHT WORK: it is purely drawdown-driven, so it needs no average,
 *   no indicator and no lag, and in 2018 and 2022 it would have stepped
 *   aside within a few weeks of the peaks; the re-entry rule keeps it out
 *   until a real recovery.
 * WHY IT MIGHT FAIL: BTC routinely falls 15% inside a healthy uptrend and
 *   recovers within days, so a 15% stop sells a lot of shakeouts, and the
 *   7% re-entry buys back higher. In 2023-24-style bull markets that is a
 *   steady leak; fees (1.2% a round trip) add to it.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-21-fast-trailing-stop.js
 *   - PEAK_DAYS: how far back "the recent peak" looks
 *   - EXIT_DROP: fall from the peak that forces us out
 *   - ENTER_DROP: how close to the peak we must get before buying back
 * =============================================================================
 */

const PEAK_DAYS = 30;     // the peak is the highest close in this many days
const EXIT_DROP = 0.15;   // sell when the close is more than 15% below the peak
const ENTER_DROP = 0.07;  // buy back when the close is within 7% of the peak

/** Highest close over the PEAK_DAYS days ending at `index` (today included). */
function recentPeak(candles, index) {
  let peak = -Infinity;
  for (let i = Math.max(0, index - PEAK_DAYS + 1); i <= index; i++) {
    peak = Math.max(peak, candles[i].close);
  }
  return peak;
}

module.exports = {
  name: "Fast Trailing Stop 30d 15/7",
  description:
    "Drawdown-driven protection: sell when the close is more than 15% below its 30-day peak, buy back once it is within 7% of that peak (hysteresis), invested by default",

  decide({ candles, index, position }) {
    const close = candles[index].close;
    const peak = recentPeak(candles, index);
    const drop = (peak - close) / peak; // how far below the recent peak we are

    // Fell more than 15% from the recent peak: step aside.
    if (position === "btc" && drop > EXIT_DROP) return "sell";

    // Back within 7% of the peak (or never really fell): be invested.
    if (position === "cash" && drop <= ENTER_DROP) return "buy";

    return "hold";
  },
};
