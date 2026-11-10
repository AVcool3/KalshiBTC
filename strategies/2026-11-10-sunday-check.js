/**
 * =============================================================================
 * Strategy: Sunday Check (50-day line, weekly cadence)    — tried on 2026-11-10
 * =============================================================================
 * THE IDEA (does checking LESS OFTEN cut the whipsaw tax?):
 *   - Every trend filter on the scoreboard re-decides every single day, and
 *     every one pays for it: a close that pokes through a line on Tuesday
 *     and pokes back on Wednesday costs two 0.6% fees for nothing. The
 *     classic professional answer is to slow the DECISION down, not just
 *     the indicator: look at the market once a week, on the weekly close,
 *     and ignore everything in between.
 *   - Rule: only on SUNDAYS (BTC's weekly close, 00:00 UTC), compare the
 *     close to its 50-day average.
 *       above the line -> be long;  below the line -> be in cash.
 *     On the other six days of the week: do nothing, whatever happens.
 *   - This is a controlled experiment: the identical "close vs 50-day
 *     average" rule checked DAILY is the baseline (run in the commit). The
 *     only difference between the two is how often the decision is made, so
 *     any gap between them is the pure effect of cadence.
 *   - Nothing tuned: 50 days is the textbook medium-term line; Sunday is
 *     the weekly close in 24/7 markets; both declared before running.
 *
 * WHY IT MIGHT WORK: whipsaw is the dominant cost of trend filters; a
 *   weekly look filters out 6 of every 7 chances to be shaken out.
 * WHY IT MIGHT FAIL: it reacts up to six days late in BOTH directions, so a
 *   crash that starts on Monday is held through until Sunday. In a market
 *   that falls 10%+ in a week, a slower check costs more than fees saved.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-10-sunday-check.js
 *   - SMA_DAYS: the line being compared against
 *   - CHECK_WEEKDAY: 0 = Sunday ... 6 = Saturday (which day we look)
 * =============================================================================
 */

const SMA_DAYS = 50;     // the trend line
const CHECK_WEEKDAY = 0; // 0 = Sunday (UTC), the weekly close for 24/7 markets

/** Day of week (0 = Sunday ... 6 = Saturday) from a candle's "YYYY-MM-DD" date. */
function weekday(candle) {
  return new Date(candle.date + "T00:00:00Z").getUTCDay();
}

/** Average close of the SMA_DAYS days ending at `index`. */
function sma(candles, index) {
  let sum = 0;
  for (let i = index - SMA_DAYS + 1; i <= index; i++) sum += candles[i].close;
  return sum / SMA_DAYS;
}

module.exports = {
  name: "Sunday Check 50d",
  description:
    "Decision cadence test: compare the close to its 50-day average only on Sundays (weekly close), hold BTC if above and cash if below, ignore the other six days",

  decide({ candles, index, position }) {
    if (index + 1 < SMA_DAYS) return "hold"; // warm-up

    // Not the weekly check day -> do nothing, whatever the market did.
    if (weekday(candles[index]) !== CHECK_WEEKDAY) return "hold";

    const above = candles[index].close > sma(candles, index);
    if (above && position === "cash") return "buy";
    if (!above && position === "btc") return "sell";
    return "hold";
  },
};
