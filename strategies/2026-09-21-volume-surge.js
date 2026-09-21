/**
 * =============================================================================
 * Strategy: Volume Surge Momentum (1.5x / 20-day)      — tried on 2026-09-21
 * =============================================================================
 * THE IDEA (volume analysis — a family we haven't tried yet):
 *   - Volume tells you how much CONVICTION is behind a price move. A big
 *     up-day on huge volume means lots of money agreed with the move; a big
 *     up-day on thin volume is easier to distrust.
 *   - BUY when today is an UP day AND today's volume is more than
 *     SURGE_RATIO (1.5x) its 20-day average -> heavy buying pressure,
 *     the crowd is piling in, ride it.
 *   - SELL when today is a DOWN day on surging volume -> heavy selling
 *     pressure, the exits are crowded, step aside.
 *   - Normal-volume days are ignored: no conviction, no signal.
 *
 * HOW THIS DIFFERS from the three strategies already tried: the SMA, RSI,
 * and Donchian strategies all look ONLY at price. This is the first one that
 * reads the volume column of the candles — a genuinely different input.
 *
 * WHY IT MIGHT WORK: major BTC moves (both rallies and crashes) tend to
 * kick off with a volume spike, so this aims to catch turns early — faster
 * than a moving average, without trying to catch falling knives like RSI.
 * WHY IT MIGHT FAIL: volume spikes also happen at EXHAUSTION — the very top
 * of a rally (last buyers rushing in) looks identical to the start of one,
 * so it can buy tops. Exchange volume data is also noisy.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-21-volume-surge.js
 *   - Higher SURGE_RATIO (e.g. 2.0) = only reacts to extreme volume, fewer
 *     but more meaningful signals
 *   - Longer AVG_DAYS (e.g. 50) = a slower-moving definition of "normal"
 * =============================================================================
 */

const AVG_DAYS = 20;      // how many days define "normal" volume
const SURGE_RATIO = 1.5;  // today counts as a surge at 1.5x normal volume

/**
 * Average volume over the `days` candles BEFORE `index` (today excluded, so
 * today's own surge doesn't inflate its own baseline).
 * Returns null during warm-up. Only reads candles[index-days .. index-1].
 */
function averageVolume(candles, index, days) {
  if (index < days) return null;
  let sum = 0;
  for (let i = index - days; i < index; i++) {
    sum += candles[i].volume;
  }
  return sum / days;
}

module.exports = {
  name: "Volume Surge 1.5x/20",
  description:
    "Follow conviction: buy an up-day on >1.5x average volume, sell a down-day on >1.5x average volume",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const normal = averageVolume(candles, index, AVG_DAYS);
    if (normal === null || index === 0) return "hold"; // warm-up

    const today = candles[index];
    const isSurge = today.volume > normal * SURGE_RATIO;
    if (!isSurge) return "hold"; // ordinary day, no conviction, no signal

    const isUpDay = today.close > today.open; // green candle = buyers won

    // Surging volume behind an up move -> join the buyers.
    if (isUpDay && position === "cash") return "buy";

    // Surging volume behind a down move -> get out of the way.
    if (!isUpDay && position === "btc") return "sell";

    return "hold";
  },
};
