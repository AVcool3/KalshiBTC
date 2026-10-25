/**
 * =============================================================================
 * Strategy: Turn-of-Month Hold                           — tried on 2026-10-25
 * =============================================================================
 * THE IDEA (a calendar effect on the DAY OF THE MONTH):
 *   - In stock markets, the "turn-of-the-month effect" is one of the oldest
 *     documented anomalies: most of the market's gains cluster in the last
 *     few days of a month and the first few of the next. The usual
 *     explanations are mechanical - paychecks land and get invested, funds
 *     rebalance, monthly contracts roll and settle.
 *   - BTC trades 24/7 and has no paycheck calendar, but month-end IS when
 *     monthly options/futures expire and many funds mark their books, so
 *     it is a fair thing to test. Rule: be in BTC from the close of the
 *     28th until the close of the 3rd of the next month (about 6 days a
 *     month), and sit in cash the other ~24 days.
 *   - Our only other calendar tests were the weekday trade (-73.5%) and
 *     "sell in May" winter hold (-23%). This is a different calendar axis.
 *
 * WHY IT MIGHT WORK: if month-end flows (expiries, rebalancing, payday
 *   buying through exchanges) move BTC at all, this catches it while only
 *   being exposed a quarter of the time - lower drawdown by construction.
 * WHY IT MIGHT FAIL: a ~25% time-in-market strategy gives up ~75% of a
 *   rising market by design, and the weekday result already showed BTC
 *   calendar patterns tend to be noise. Also ~24 round-trips in two years
 *   means 24 x 1.2% = ~29% of fee drag before any edge.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-25-turn-of-month.js
 *   - ENTER_DAY: first day-of-month we hold (28 = last ~3 days of month)
 *   - EXIT_DAY: last day-of-month we hold in the NEW month (3 = days 1-3)
 * =============================================================================
 */

const ENTER_DAY = 28; // hold from the close of this day-of-month onward
const EXIT_DAY = 3;   // ...through the close of this day of the next month

/** Day-of-month (1-31) parsed from a candle's "YYYY-MM-DD" date string. */
function dayOfMonth(candle) {
  return Number(candle.date.slice(8, 10));
}

module.exports = {
  name: "Turn-of-Month Hold 28th-3rd",
  description:
    "Calendar effect: hold BTC from the close of the 28th through the close of the 3rd of the next month (month-end flows), cash for the other ~24 days",

  decide({ candles, index, position }) {
    const day = dayOfMonth(candles[index]);

    // Inside the turn-of-month window: late in the month (>= 28th) or
    // early in the next (<= 3rd).
    const inWindow = day >= ENTER_DAY || day <= EXIT_DAY;

    if (inWindow && position === "cash") return "buy";
    if (!inWindow && position === "btc") return "sell";
    return "hold";
  },
};
