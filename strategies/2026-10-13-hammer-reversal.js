/**
 * =============================================================================
 * Strategy: Hammer Reversal                             — tried on 2026-10-13
 * =============================================================================
 * THE IDEA (candlestick anatomy — a data dimension we've barely touched):
 *   - Every strategy so far read closes (and once, volume). But each daily
 *     candle also records the battle INSIDE the day: open, high, low. The
 *     oldest school of technical analysis - Japanese candlestick patterns -
 *     claims the SHAPE of a candle telegraphs reversals.
 *   - The most famous shape is the HAMMER: during a downtrend, price gets
 *     hammered far below the open intraday, but buyers charge back and the
 *     candle CLOSES near its top. The long lower wick is a failed sell-off
 *     - supposedly the footprint of capitulation meeting real demand.
 *   - Rules (all three must hold on the same candle):
 *       1. Context: we're in a dip - close below the 10-day average.
 *       2. Long lower wick: at least 2x the candle's body.
 *       3. Strong finish: close in the top third of the day's range.
 *     BUY at that close. Then a TIME-BASED exit (also new for the lab):
 *     sell HOLD_DAYS (10) days later, win or lose, no exceptions.
 *   - The time exit makes this a clean measurement: "what happens in the
 *     10 days after a textbook hammer?" If hammers carry real information,
 *     those windows should be better than average days.
 *
 * WHY IT MIGHT FAIL: candle patterns are the astrology of markets in most
 * academic tests - visually compelling, statistically absent. And BTC
 * trades 24/7, so its daily "open" is just midnight UTC, not a true
 * session open, which may blur the psychology the pattern relies on.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-13-hammer-reversal.js
 *   - WICK_RATIO: how dramatic the lower wick must be (2 = classic)
 *   - HOLD_DAYS: the fixed holding window after a hammer
 * =============================================================================
 */

const SMA_DAYS = 10;    // "in a dip" = close below this average
const WICK_RATIO = 2;   // lower wick must be at least 2x the body
const TOP_FRACTION = 1 / 3; // close must land in the top third of the range
const HOLD_DAYS = 10;   // fixed holding period after buying a hammer

/** Simple moving average of closes over `days` ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

/** Is this candle a textbook hammer? (shape test only - no context) */
function isHammer(c) {
  const range = c.high - c.low;
  if (range <= 0) return false;
  const body = Math.abs(c.close - c.open);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const closeNearTop = c.close >= c.high - range * TOP_FRACTION;
  return lowerWick >= body * WICK_RATIO && closeNearTop;
}

// Module-level state: days remaining in the current timed hold.
// (Fine for this engine: one strategy, one sequential pass.)
let holdLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Hammer Reversal",
  description:
    "Candlestick anatomy: buy a textbook hammer (long lower wick, strong close) during a dip, hold exactly 10 days, sell - measures whether the pattern carries information",

  decide({ candles, index, position }) {
    if (index < SMA_DAYS) return "hold"; // warm-up for the dip context

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) holdLeft = 0;
    lastIndexSeen = index;

    const today = candles[index];

    if (position === "btc") {
      // Timed exit: the clock, not the price, ends every trade.
      holdLeft--;
      if (holdLeft <= 0) return "sell";
      return "hold";
    }

    // In cash: hunt for a hammer printed during a dip.
    const inDip = today.close < sma(candles, index, SMA_DAYS);
    if (inDip && isHammer(today)) {
      holdLeft = HOLD_DAYS;
      return "buy";
    }

    return "hold";
  },
};
