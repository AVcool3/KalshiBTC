/**
 * =============================================================================
 * Strategy: Wick Breaker                                — tried on 2026-10-20
 * =============================================================================
 * THE IDEA (probing the champion's trigger definition):
 *   - The champion trips on the CLOSE: a close-to-close drop worse than -5%.
 *     But panic usually shows up intraday first. This variant trips when
 *     the day's LOW reaches 5% below yesterday's close - even if the price
 *     recovers by the close. Everything else is identical: sell at that
 *     day's close, 10-day cooldown, long by default.
 *   - Two stories compete:
 *       (a) EARLIER DETECTION: by the time a -5% close prints, part of the
 *           damage is done; the wick sees the same panic sooner and there
 *           are more such days, so protection starts earlier and oftener.
 *       (b) SHAKEOUT NOISE: a deep wick that RECOVERS by the close means
 *           buyers absorbed the panic - arguably the opposite of a crash
 *           signal. The hammer experiment showed intraday wicks carry no
 *           information; tripping on them would just add false alarms,
 *           each costing a 10-day absence plus fees.
 *
 * READING THE RESULT: if this beats the plain champion, close-based
 * triggering was leaving protection on the table. If it loses, the close
 * is the filter - requiring panic to SURVIVE the whole day is what
 * separates real cascades from intraday shakeouts.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-20-wick-breaker.js
 *   - CRASH_PCT / COOLDOWN_DAYS: the champion's knobs, unchanged
 * =============================================================================
 */

const CRASH_PCT = 0.05;   // trip when the day's LOW is 5% below yesterday's close
const COOLDOWN_DAYS = 10; // the champion's validated sit-out

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Wick Breaker",
  description:
    "The champion triggered by the intraday LOW instead of the close: trip when the day's low reaches -5% from yesterday's close - tests earlier detection vs shakeout noise",

  decide({ candles, index, position }) {
    if (index < 1) return "hold";

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const yesterdayClose = candles[index - 1].close;
    // The intraday trigger: how far below yesterday's close did price WICK?
    const wickDrop = (candles[index].low - yesterdayClose) / yesterdayClose;

    // ---- Intraday panic: trip the breaker ---------------------------------
    if (wickDrop < -CRASH_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell"; // executed at the close, as always
      return "hold";
    }

    // ---- Cooling down -------------------------------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) ----------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
