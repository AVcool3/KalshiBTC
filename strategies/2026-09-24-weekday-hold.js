/**
 * =============================================================================
 * Strategy: Weekday Hold (Mon -> Fri)                   — tried on 2026-09-24
 * =============================================================================
 * THE IDEA (calendar / day-of-week effects — the last untried family):
 *   - Old market folklore says returns aren't spread evenly across the week.
 *     For BTC specifically, weekends have thin liquidity (traditional-market
 *     money is off), and several studies claim weekday hours capture most of
 *     the gains while weekends drift or dip.
 *   - Rule: BUY at Monday's close, SELL at Friday's close. Hold through the
 *     working week, sit in cash every weekend. The calendar IS the signal —
 *     no indicators at all.
 *
 * THE REAL EXPERIMENT HERE (be honest about the odds): this trades EVERY
 * week — roughly 52 round-trips year, at 0.6% fee per side that's a
 * guaranteed drag of about 60% over two years. So this tests whether the
 * weekday/weekend gap is not just real but ENORMOUS — big enough to out-earn
 * a fee mountain. Doubtful, but that's what experiments are for, and the
 * result will quantify the scoreboard's recurring lesson about trade
 * frequency and fees better than any single strategy so far.
 *
 * WHY IT MIGHT FAIL (beyond fees): calendar effects are the most fragile
 * kind of pattern — they're statistical residue with no mechanism forcing
 * them to persist, and they evaporate once widely known.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-24-weekday-hold.js
 *   - BUY_DAY / SELL_DAY use JS day numbers: 0=Sun, 1=Mon, ... 6=Sat.
 *     Try the inverse bet (hold weekends only): BUY_DAY=5, SELL_DAY=1.
 * =============================================================================
 */

const BUY_DAY = 1;  // Monday  (JS Date day number: 0=Sun ... 6=Sat)
const SELL_DAY = 5; // Friday

/**
 * Day of week for a candle. Candle dates are "YYYY-MM-DD" strings in UTC,
 * so parse them as UTC to avoid timezone off-by-one-day surprises.
 */
function dayOfWeek(candle) {
  return new Date(candle.date + "T00:00:00Z").getUTCDay();
}

module.exports = {
  name: "Weekday Hold Mon-Fri",
  description:
    "Calendar effect: buy Monday's close, sell Friday's close, sit out every weekend - no indicators, the calendar is the signal",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const day = dayOfWeek(candles[index]);

    // Monday's close -> start the working-week hold.
    if (day === BUY_DAY && position === "cash") return "buy";

    // Friday's close -> step aside for the weekend.
    if (day === SELL_DAY && position === "btc") return "sell";

    return "hold";
  },
};
