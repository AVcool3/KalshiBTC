/**
 * =============================================================================
 * Backtest Engine
 * =============================================================================
 * A simple, dependency-free simulator that runs a strategy over historical
 * daily candles and reports how it would have performed.
 *
 * THE TRADING MODEL (kept intentionally simple):
 *   - You start with $10,000 cash and no BTC.
 *   - Each day, the strategy looks at all candles UP TO AND INCLUDING today
 *     and answers: "buy", "sell", or "hold".
 *   - "buy"  = go ALL-IN  (spend all cash on BTC at today's close price)
 *   - "sell" = go ALL-OUT (sell all BTC for cash at today's close price)
 *   - "hold" = do nothing
 *   - A small fee (FEE_RATE) is charged on every trade to keep it realistic.
 *
 * WHAT A STRATEGY FILE LOOKS LIKE (see strategies/ for real examples):
 *
 *   module.exports = {
 *     name: "My Strategy",
 *     description: "One-line summary shown in RESULTS.md",
 *     decide({ candles, index, position }) {
 *       // candles[index] is "today"; candles[0..index] is all known history.
 *       // position is "cash" (holding dollars) or "btc" (holding bitcoin).
 *       return "buy" | "sell" | "hold";
 *     },
 *   };
 *
 * HOW TO CHANGE THINGS:
 *   - Starting money -> STARTING_CASH
 *   - Trading fee    -> FEE_RATE (0.006 = 0.6%, roughly Coinbase taker fee)
 * =============================================================================
 */

const STARTING_CASH = 10000; // dollars the simulation starts with
const FEE_RATE = 0.006;      // fee taken on every buy AND every sell (0.6%)

/**
 * Runs one strategy over the candle history and returns a stats object.
 *
 * @param {Array}  candles  Daily candles, OLDEST first (from fetch-data.js)
 * @param {Object} strategy A strategy module (see doc comment above)
 * @returns {Object} stats  Performance metrics used for the report
 */
function runBacktest(candles, strategy) {
  let cash = STARTING_CASH; // dollars we're holding (0 while in BTC)
  let btc = 0;              // bitcoin we're holding (0 while in cash)

  const trades = [];        // completed round-trips: { buyPrice, sellPrice, ... }
  let openBuyPrice = null;  // price of the buy that opened the current position

  let peakEquity = 0;       // highest portfolio value seen so far
  let maxDrawdown = 0;      // worst % drop from a peak (risk measure)

  for (let index = 0; index < candles.length; index++) {
    const price = candles[index].close;
    const position = btc > 0 ? "btc" : "cash";

    // Ask the strategy what to do today. Strategies may only look at
    // candles[0..index] — the engine passes the full array, but peeking at
    // future candles (index+1 and beyond) is cheating and makes results fake.
    const action = strategy.decide({ candles, index, position });

    if (action === "buy" && position === "cash" && cash > 0) {
      // Spend all cash on BTC, minus the trading fee.
      btc = (cash * (1 - FEE_RATE)) / price;
      cash = 0;
      openBuyPrice = price;
    } else if (action === "sell" && position === "btc" && btc > 0) {
      // Sell all BTC for cash, minus the trading fee.
      cash = btc * price * (1 - FEE_RATE);
      btc = 0;
      trades.push({
        buyPrice: openBuyPrice,
        sellPrice: price,
        date: candles[index].date,
        win: price > openBuyPrice, // did this round-trip make money?
      });
      openBuyPrice = null;
    }
    // "hold" (or an invalid action) = do nothing today.

    // --- Track drawdown: how far portfolio value fell from its peak --------
    const equity = cash + btc * price;
    peakEquity = Math.max(peakEquity, equity);
    const drawdown = (peakEquity - equity) / peakEquity;
    maxDrawdown = Math.max(maxDrawdown, drawdown);
  }

  // ---- Final accounting ---------------------------------------------------
  const lastPrice = candles[candles.length - 1].close;
  const finalEquity = cash + btc * lastPrice; // value if we cashed out today

  // "Buy & hold" benchmark: what if we'd just bought on day 1 and waited?
  const firstPrice = candles[0].close;
  const buyHoldReturnPct = ((lastPrice - firstPrice) / firstPrice) * 100;

  const wins = trades.filter((t) => t.win).length;

  return {
    startDate: candles[0].date,
    endDate: candles[candles.length - 1].date,
    startingCash: STARTING_CASH,
    finalEquity,
    totalReturnPct: ((finalEquity - STARTING_CASH) / STARTING_CASH) * 100,
    buyHoldReturnPct,           // the benchmark to beat
    numTrades: trades.length,   // completed buy->sell round-trips
    winRatePct: trades.length ? (wins / trades.length) * 100 : 0,
    maxDrawdownPct: maxDrawdown * 100,
    endedInPosition: btc > 0 ? "btc" : "cash", // still holding BTC at the end?
    trades,
  };
}

module.exports = { runBacktest, STARTING_CASH, FEE_RATE };
