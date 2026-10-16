/**
 * =============================================================================
 * Strategy: Green Streak Momentum (3 up / 2 down)       — tried on 2026-10-16
 * =============================================================================
 * THE IDEA (the other half of the streak family):
 *   - Two weeks ago we tested red streaks as a CONTRARIAN signal (buy the
 *     4th straight down day): a real bounce signal, killed by fees. This
 *     tests the opposite read of the tape: streaks as MOMENTUM.
 *   - Buy at the close of the 3rd consecutive green day (buyers keep
 *     showing up - join them). Sell at the close of the 2nd consecutive
 *     red day (sellers took over - step aside).
 *   - There's a supportive prior on the books: the Euphoria Breaker proved
 *     that hiding after big up-days is ruinous because up-moves CONTINUE.
 *     This asks whether that continuation also rides on ordinary streaks,
 *     not just +5% fireworks.
 *
 * WHY IT MIGHT FAIL (the scoreboard's standing warnings): three green days
 * is a COMMON event, so this will trade a lot, and the fee ledger says
 * frequent traders die (~1.2% per round-trip). The signal has to be very
 * real to out-earn that drag - the red-streak twin's didn't.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-16-green-streak-momentum.js
 *   - BUY_STREAK: 4 = rarer, stronger confirmation before entering
 *   - SELL_STREAK: 3 = more tolerant of pullbacks while holding
 * =============================================================================
 */

const BUY_STREAK = 3;  // buy at the close of this many consecutive green days
const SELL_STREAK = 2; // sell at the close of this many consecutive red days

/**
 * Counts consecutive closes in one direction ending at `index`.
 * direction = +1 counts green (up) days, -1 counts red (down) days.
 * Only reads candles[0..index] - no lookahead.
 */
function streakLength(candles, index, direction) {
  let count = 0;
  for (let i = index; i >= 1; i--) {
    const change = candles[i].close - candles[i - 1].close;
    if (direction > 0 ? change > 0 : change < 0) count++;
    else break;
  }
  return count;
}

module.exports = {
  name: "Green Streak Momentum 3/2",
  description:
    "Tape momentum: buy the 3rd straight up day (buyers keep showing up), sell the 2nd straight down day - the red-streak strategy's mirror",

  decide({ candles, index, position }) {
    if (index < BUY_STREAK) return "hold"; // not enough history yet

    if (position === "cash") {
      // Three green closes in a row -> join the buyers.
      if (streakLength(candles, index, +1) >= BUY_STREAK) return "buy";
    } else {
      // Two red closes in a row -> the streak logic says momentum flipped.
      if (streakLength(candles, index, -1) >= SELL_STREAK) return "sell";
    }

    return "hold";
  },
};
