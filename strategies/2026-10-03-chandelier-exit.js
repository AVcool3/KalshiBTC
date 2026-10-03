/**
 * =============================================================================
 * Strategy: Chandelier Exit (3x ATR trailing stop)      — tried on 2026-10-03
 * =============================================================================
 * THE IDEA (a volatility-scaled trailing stop — a new exit mechanism):
 *   - Every exit tested so far was a FIXED rule: a 10-day low, an RSI
 *     level, a cooldown clock. This one scales with the market's own
 *     turbulence, using ATR (Average True Range) — the average size of a
 *     full daily swing (high to low, gaps included) over the last 14 days.
 *   - Be LONG BY DEFAULT (the scoreboard's core lesson). While holding,
 *     hang a "chandelier" from the HIGHEST close since entry: if today's
 *     close drops more than 3 ATRs below that peak, get out.
 *   - Why scale the leash? In calm markets 3 ATRs is a tight stop that
 *     reacts quickly; in wild markets it's a wide stop that tolerates the
 *     noise. A fixed-percent stop can't do both.
 *   - Re-entry: a close above the prior 20-day high — wait for the market
 *     to prove strength again before rejoining.
 *
 * WHY IT MIGHT WORK: it targets the champion Circuit Breaker's one known
 * weakness — slow, grinding declines that never trigger a -5% panic day.
 * A trailing stop bleeds out of those gradually-sinking stretches too,
 * while still riding every rally to its peak.
 * WHY IT MIGHT FAIL: trailing stops sell AFTER giving back 3 ATRs from the
 * top of every single swing — a cost paid on every exit, win or lose — and
 * the 20-day-high re-entry means buying back near local tops (the
 * sell-low-buy-high whipsaw that hurt several earlier strategies).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-03-chandelier-exit.js
 *   - ATR_MULT: 2 = tighter leash (exits sooner), 4 = looser
 *   - ATR_DAYS: the window that defines "normal" daily turbulence
 *   - REENTRY_DAYS: how strong a recovery must be before rejoining
 * =============================================================================
 */

const ATR_DAYS = 14;    // lookback for the average daily range
const ATR_MULT = 3;     // exit when close < peak-since-entry - 3 * ATR
const REENTRY_DAYS = 20; // re-enter on a close above the prior 20-day high

/**
 * Average True Range over `days` ending at `index`. True range = the full
 * extent of a day's move including any gap from yesterday's close:
 * max(high - low, |high - prevClose|, |low - prevClose|).
 */
function atr(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) {
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose)
    );
    sum += tr;
  }
  return sum / days;
}

/** Highest close among the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  let h = -Infinity;
  for (let i = index - days; i < index; i++) h = Math.max(h, candles[i].close);
  return h;
}

// Module-level state: the highest close since our current entry (null when
// in cash). Fine for this engine: one strategy, one sequential pass.
let peakSinceEntry = null;
let lastIndexSeen = -1;

module.exports = {
  name: "Chandelier Exit 3xATR",
  description:
    "Long by default with a volatility-scaled trailing stop: exit when price closes 3 ATRs below its peak since entry, re-enter on a 20-day high",

  decide({ candles, index, position }) {
    // Warm-up: need ATR history plus the re-entry lookback.
    if (index < Math.max(ATR_DAYS + 1, REENTRY_DAYS)) return "hold";

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) peakSinceEntry = null;
    lastIndexSeen = index;

    const today = candles[index].close;

    if (position === "btc") {
      // Raise the chandelier's anchor whenever we set a new peak.
      peakSinceEntry = Math.max(peakSinceEntry ?? today, today);

      // The stop: 3 average-days'-worth of movement below the peak.
      const stopLevel = peakSinceEntry - ATR_MULT * atr(candles, index, ATR_DAYS);
      if (today < stopLevel) {
        peakSinceEntry = null;
        return "sell";
      }
      return "hold";
    }

    // In cash: first entry, or re-entry once strength is proven again.
    if (today > highestClose(candles, index, REENTRY_DAYS)) {
      peakSinceEntry = today;
      return "buy";
    }

    return "hold";
  },
};
