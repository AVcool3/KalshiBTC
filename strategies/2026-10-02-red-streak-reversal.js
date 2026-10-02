/**
 * =============================================================================
 * Strategy: Red Streak Reversal (4 down / 2 up)         — tried on 2026-10-02
 * =============================================================================
 * THE IDEA (price-streak patterns — a mechanism we haven't tested):
 *   - Ignore indicators entirely and read the raw tape: how many days in a
 *     row has BTC closed down?
 *   - Four consecutive red days is statistically uncommon and tends to mean
 *     sellers are exhausted — everyone who panicked has already sold.
 *     BUY at the close of the 4th straight down day.
 *   - Two consecutive green days means the bounce has materialized.
 *     SELL at the close of the 2nd straight up day and wait for the next
 *     streak. Short holds, by design: this harvests the snap-back, not the
 *     trend.
 *
 * HOW THIS DIFFERS from RSI Mean Reversion (which also buys weakness):
 * RSI measures the SIZE of recent moves over 14 days; a streak counts only
 * their ORDER. Four tiny red days trigger this but barely dent RSI; one
 * giant red day craters RSI but counts as a streak of one here. Different
 * trigger, same contrarian spirit — and the circuit-breaker lessons say
 * single-day size cuts both ways, so order alone is worth isolating.
 *
 * WHY IT MIGHT FAIL: in a real downtrend, 4 red days are followed by more
 * red days (the "falling knife" that killed the RSI dips in downtrends),
 * and the quick two-green-day exit caps winners while losers are uncapped.
 * Trade count also matters — if streaks are common, fees stack up fast
 * (the Weekday Hold lesson: 0.6% per side devours frequent traders).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-02-red-streak-reversal.js
 *   - BUY_STREAK: 5 = wait for rarer, deeper exhaustion; 3 = trade more
 *   - SELL_STREAK: 1 = take profit on any green day; 3 = ride bounces longer
 * =============================================================================
 */

const BUY_STREAK = 4;  // buy at the close of this many consecutive red days
const SELL_STREAK = 2; // sell at the close of this many consecutive green days

/**
 * Counts consecutive closes in one direction ending at `index`.
 * direction = -1 counts red (down) days, +1 counts green (up) days.
 * Only reads candles[0..index] — no lookahead.
 */
function streakLength(candles, index, direction) {
  let count = 0;
  for (let i = index; i >= 1; i--) {
    const change = candles[i].close - candles[i - 1].close;
    if (direction < 0 ? change < 0 : change > 0) count++;
    else break; // streak broken
  }
  return count;
}

module.exports = {
  name: "Red Streak Reversal 4/2",
  description:
    "Tape reading: buy at the close of the 4th straight down day (seller exhaustion), sell after 2 straight up days (bounce harvested)",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    if (index < BUY_STREAK) return "hold"; // not enough history yet

    if (position === "cash") {
      // Sellers exhausted after BUY_STREAK straight red closes -> buy the panic.
      if (streakLength(candles, index, -1) >= BUY_STREAK) return "buy";
    } else {
      // Bounce delivered after SELL_STREAK straight green closes -> cash out.
      if (streakLength(candles, index, +1) >= SELL_STREAK) return "sell";
    }

    return "hold";
  },
};
