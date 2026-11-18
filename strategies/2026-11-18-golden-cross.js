/**
 * =============================================================================
 * Strategy: Golden Cross 50/200                          — tried on 2026-11-18
 * =============================================================================
 * THE IDEA (the most-quoted trend signal in markets, finally tested):
 *   - The "golden cross" is when the 50-day average rises above the 200-day
 *     average (medium-term trend overtaking long-term trend); the "death
 *     cross" is the reverse. Financial media announce both constantly. The
 *     lab has tested the 10/30 cross (+2.9%) and the price-vs-200-day line,
 *     but never the real thing.
 *   - Rule: hold BTC while the 50-day average is above the 200-day average,
 *     cash while it is below. No buffer, no extra filters.
 *   - Why this one matters now: the five-era evidence says timing rules are
 *     INSURANCE, paying off only when buy & hold suffers a deep bear. A rule
 *     that changes position only a couple of times a cycle is the cheapest
 *     kind of insurance, and the 50/200 cross is the slowest widely-known
 *     version. If any trend rule makes sense as bear-market insurance, it
 *     is this one.
 *   - Nothing tuned: 50 and 200 are the textbook numbers, declared before
 *     running; the commit shows the five-era table and neighbouring pairs.
 *
 * WHY IT MIGHT WORK: both averages move slowly, so crossings are rare and
 *   tend to coincide with real regime changes (2018 and 2022 bears were
 *   announced by death crosses).
 * WHY IT MIGHT FAIL: a cross of two lagging averages is a very late signal.
 *   The death cross typically fires after most of a decline has happened,
 *   and the golden cross after most of the recovery; in BTC's V-shaped
 *   crashes this can mean selling near the bottom and buying back far above.
 *   It also needs 200 days of history before it can say anything.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-18-golden-cross.js
 *   - FAST_DAYS / SLOW_DAYS: the two averages (50 / 200 classic)
 * =============================================================================
 */

const FAST_DAYS = 50;   // the faster average
const SLOW_DAYS = 200;  // the slower average

/** Simple average of the last `days` closes ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

module.exports = {
  name: "Golden Cross 50/200",
  description:
    "The classic: hold BTC while the 50-day average is above the 200-day average (golden cross), cash while it is below (death cross) - slowest famous trend rule, bear-market insurance",

  decide({ candles, index, position }) {
    if (index + 1 < SLOW_DAYS) return "hold"; // warm-up: the slow average needs 200 days

    const bullish = sma(candles, index, FAST_DAYS) > sma(candles, index, SLOW_DAYS);

    if (bullish && position === "cash") return "buy";
    if (!bullish && position === "btc") return "sell";
    return "hold";
  },
};
