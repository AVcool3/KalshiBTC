/**
 * =============================================================================
 * Strategy: Absolute Momentum (90-day)                  — tried on 2026-09-23
 * =============================================================================
 * THE IDEA (time-series momentum — the simplest serious strategy there is):
 *   - Ask ONE question each day: "is BTC higher than it was 90 days ago?"
 *   - YES -> be invested. NO -> be in cash. That's the whole strategy.
 *   - No bands, no oscillators, no breakout levels — just the sign of the
 *     trailing 90-day return. Academics call this "time-series momentum"
 *     or "absolute momentum", and it's one of the most robust effects ever
 *     documented across markets (Moskowitz/Ooi/Pedersen 2012).
 *
 * WHY THIS ONE, GIVEN OUR SCOREBOARD: the recurring lesson from 7 strategies
 * is that anything reducing time-in-market during uptrends loses. This is
 * the maximum-time-in-market strategy short of buy & hold itself: it stays
 * long through every wobble of an uptrend (no 10-day-low exits, no profit
 * taking) and only steps aside when the whole 90-day trend has rolled over —
 * i.e. it aims to sidestep only the BIG bear phases, which is exactly where
 * buy & hold takes its -40% drawdowns.
 *
 * WHY IT MIGHT FAIL: it's slow by design. It gives back the first chunk of
 * every crash before the 90-day return turns negative, and after a V-shaped
 * bottom it re-enters late. In a market that crashes and recovers fast, it
 * sells the bottom and re-buys higher (whipsaw at 90-day scale).
 *
 * HOW TO CHANGE THINGS: tweak the constant below and re-run:
 *   node backtest/run.js strategies/2026-09-23-absolute-momentum.js
 *   - Shorter LOOKBACK_DAYS (e.g. 30) = reacts faster, whipsaws more
 *   - Longer  LOOKBACK_DAYS (e.g. 180) = calmer, but exits crashes even later
 * =============================================================================
 */

const LOOKBACK_DAYS = 90; // "is price higher than this many days ago?"

module.exports = {
  name: "Absolute Momentum 90d",
  description:
    "Time-series momentum: stay invested while price is above its level 90 days ago, sit in cash while below",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    if (index < LOOKBACK_DAYS) return "hold"; // warm-up

    const today = candles[index].close;
    const then = candles[index - LOOKBACK_DAYS].close;
    const trendIsUp = today > then;

    // Trend up but we're in cash -> get invested.
    if (trendIsUp && position === "cash") return "buy";

    // Trend down but we're still holding -> step aside.
    if (!trendIsUp && position === "btc") return "sell";

    return "hold"; // already positioned with the trend
  },
};
