/**
 * =============================================================================
 * Strategy: Round Number Grid $10k                       — tried on 2026-10-24
 * =============================================================================
 * THE IDEA (trading human psychology instead of math):
 *   - Markets are famously sticky around ROUND NUMBERS: "$100k BTC" was a
 *     headline for months, limit orders pile up at $90,000 and $110,000,
 *     and nobody sets an alert for $87,341. If that crowding is real, a
 *     round level acts like a door: hard to push through, but once price
 *     is through, the crowd that defended it is done and the move runs.
 *   - Rule: lay a grid of lines every $10,000. A CLOSE that crosses UP
 *     through a line yesterday's close was below = strength that broke a
 *     defended door -> buy. A CLOSE that crosses DOWN through a line =
 *     a defended floor failed -> sell. Between lines, do nothing.
 *   - This quantizes price into $10k buckets and only trades the bucket
 *     changes - a trend filter whose levels are drawn by human round-ness
 *     instead of by any average or window. Nothing like it on the board.
 *
 * WHY IT MIGHT WORK: round-number clustering is one of the best-documented
 *   behavioral patterns in finance (it shows in real order books), and at
 *   BTC ~$100k a $10k step is ~10% - coarse enough to ignore daily noise
 *   that whipsawed every fast filter the lab has tried.
 * WHY IT MIGHT FAIL: a fixed-dollar grid means the step was 25% of price
 *   at $40k and only 8% at $120k - the filter gets finer (more whipsaw)
 *   exactly as price rises; and if the order-book clustering is mostly
 *   market-maker noise, the "doors" are decoration and this is just a
 *   crude channel with arbitrary levels plus fees.
 *
 * HOW TO CHANGE THINGS: tweak the constant below and re-run:
 *   node backtest/run.js strategies/2026-10-24-round-number-grid.js
 *   - GRID: the spacing of the psychological lines ($5k = twitchier,
 *     $20k = only the biggest doors count)
 * =============================================================================
 */

const GRID = 10000; // a psychological line every this many dollars

/** Which $GRID bucket a price sits in (e.g. $104,500 -> bucket 10). */
function bucket(price) {
  return Math.floor(price / GRID);
}

module.exports = {
  name: "Round Number Grid $10k",
  description:
    "Behavioral levels: buy a close that breaks UP through a $10k round number, sell a close that breaks DOWN through one - the grid is drawn by psychology, not math",

  decide({ candles, index, position }) {
    if (index < 1) return "hold";

    const prev = bucket(candles[index - 1].close);
    const curr = bucket(candles[index].close);

    // Crossed up through at least one round line -> a defended door broke.
    if (curr > prev && position === "cash") return "buy";

    // Crossed down through one -> a defended floor failed.
    if (curr < prev && position === "btc") return "sell";

    // Same bucket (or already positioned the right way): nothing to do.
    return "hold";
  },
};
