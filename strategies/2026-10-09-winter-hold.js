/**
 * =============================================================================
 * Strategy: Winter Hold (Oct-Mar in, Apr-Sep out)       — tried on 2026-10-09
 * =============================================================================
 * THE IDEA (monthly seasonality — the calendar family at a saner timescale):
 *   - Old stock-market folklore says "sell in May and go away": most of the
 *     market's long-run gain historically came from the November-April
 *     half of the year. Crypto lore tells a similar story — strong fourth
 *     quarters ("Uptober", year-end rallies) and soggy summers.
 *   - Rule: hold BTC from the start of OCTOBER through the end of MARCH,
 *     sit in cash from the start of APRIL through the end of SEPTEMBER.
 *     The calendar is the entire signal.
 *   - Crucially, unlike our disastrous day-of-week test (103 trades,
 *     -73.53%), this trades TWICE A YEAR. Fees are irrelevant here, so for
 *     once a calendar effect gets a clean shot: if it fails, the pattern
 *     itself is absent, not eaten by costs.
 *
 * WHY IT MIGHT FAIL: seasonality is the flimsiest kind of edge — a few
 * strong past Octobers can create a "pattern" out of pure chance, there is
 * no mechanism forcing it to repeat, and with 2 trades per year even a
 * 6-year test contains only ~12 decisions (tiny sample). Also, sitting out
 * every summer forfeits half of each year's time in market — the lab's
 * opportunity-cost lesson predicts that hurts unless summers are truly bad.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-09-winter-hold.js
 *   - HOLD_MONTHS: which months to be invested (1=Jan ... 12=Dec).
 *     Try Q4 only: [10, 11, 12]
 * =============================================================================
 */

// Months to be IN the market (1=Jan ... 12=Dec). October through March.
const HOLD_MONTHS = [10, 11, 12, 1, 2, 3];

/** Month (1-12) of a candle. Dates are "YYYY-MM-DD" strings in UTC. */
function monthOf(candle) {
  return parseInt(candle.date.slice(5, 7), 10);
}

module.exports = {
  name: "Winter Hold Oct-Mar",
  description:
    "Monthly seasonality: hold BTC October through March, cash April through September - 'sell in May' for crypto, only 2 trades a year",

  /**
   * Called by the engine once per day.
   *  - candles[0..index] = all price history known "today"
   *  - position = "cash" or "btc"
   * Must return "buy", "sell", or "hold".
   */
  decide({ candles, index, position }) {
    const inSeason = HOLD_MONTHS.includes(monthOf(candles[index]));

    // Winter months and sitting in cash -> get invested.
    if (inSeason && position === "cash") return "buy";

    // Summer months and still holding -> step aside until October.
    if (!inSeason && position === "btc") return "sell";

    return "hold";
  },
};
