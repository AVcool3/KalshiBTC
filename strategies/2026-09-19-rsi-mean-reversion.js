/**
 * =============================================================================
 * Strategy: RSI Mean Reversion (buy fear, sell recovery)  — tried on 2026-09-19
 * =============================================================================
 * THE IDEA (mean reversion — the opposite philosophy of the SMA crossover):
 *   - RSI (Relative Strength Index) measures how hard price has been pushed
 *     up or down recently, on a 0–100 scale. Low RSI = heavily sold off
 *     ("oversold"), high RSI = heavily bought up ("overbought").
 *   - When RSI drops below BUY_BELOW (30), the market has been panic-selling
 *     -> BUY, betting the dip snaps back.
 *   - When RSI recovers above SELL_ABOVE (55), the bounce we were betting on
 *     has happened -> SELL and take the profit.
 *
 * WHY IT MIGHT WORK: BTC regularly overshoots on the downside — sharp dips
 * often bounce within days, and this buys exactly those moments.
 * WHY IT MIGHT FAIL: "catching a falling knife" — in a real crash RSI can
 * stay oversold for weeks while price keeps falling, so we buy early and
 * ride the loss down. It also sits in cash during long rallies (RSI rarely
 * dips low in a strong uptrend), missing buy-and-hold gains.
 *
 * HOW TO CHANGE THINGS: tweak the three constants below and re-run:
 *   node backtest/run.js strategies/2026-09-19-rsi-mean-reversion.js
 *   - Lower BUY_BELOW (e.g. 25) = pickier, waits for deeper panics
 *   - Higher SELL_ABOVE (e.g. 70) = greedier, holds the bounce longer
 * =============================================================================
 */

const RSI_PERIOD = 14;  // how many days RSI looks back (14 is the classic)
const BUY_BELOW = 30;   // RSI under this = oversold -> buy the dip
const SELL_ABOVE = 55;  // RSI over this = bounce happened -> take profit

/**
 * Classic Wilder RSI over the `period` days ending at `index`.
 * Steps: average the up-moves and down-moves separately, take their ratio
 * (RS), then squash it onto a 0–100 scale. Returns null during warm-up.
 * Note: only reads candles[index - period .. index] — no lookahead.
 */
function rsi(candles, index, period) {
  if (index < period) return null; // not enough history yet

  let gains = 0;
  let losses = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change; // store losses as a positive number
  }

  if (losses === 0) return 100; // straight up all period = max RSI
  const rs = gains / period / (losses / period);
  return 100 - 100 / (1 + rs);
}

module.exports = {
  name: "RSI Mean Reversion 30/55",
  description:
    "Contrarian: buy when 14-day RSI drops below 30 (panic dip), sell when it recovers above 55",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const value = rsi(candles, index, RSI_PERIOD);
    if (value === null) return "hold"; // still warming up

    // Oversold and sitting in cash -> buy the panic.
    if (value < BUY_BELOW && position === "cash") return "buy";

    // Recovered and holding BTC -> sell into the bounce.
    if (value > SELL_ABOVE && position === "btc") return "sell";

    return "hold";
  },
};
