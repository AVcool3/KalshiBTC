/**
 * =============================================================================
 * Strategy: Two-Strike Breaker                           — tried on 2026-11-19
 * =============================================================================
 * THE IDEA (only run when crashes CLUSTER, not on every flush):
 *   - The champion sells on any single -5% day. That protects against real
 *     cascades but also flees ordinary one-day shakeouts inside healthy bull
 *     markets (in 2023-24 it made +181% against buy & hold's +446%, partly by
 *     sitting out rebounds after lone -5% days).
 *   - What the deep bears of 2018 and 2022 had that a lone shakeout does not
 *     is REPETITION: -5% days arrive in bunches (this is the volatility
 *     clustering the champion is built on). So wait for the second strike.
 *   - Rule: count the days in the last WINDOW_DAYS (20) whose close-to-close
 *     return was worse than -5%. If the count reaches STRIKES (2), be in
 *     cash; hold BTC otherwise. The alarm clears by itself when old strikes
 *     age out of the 20-day window, so no separate cooldown is needed.
 *   - Compared with the champion: fewer exits (lone -5% days are ignored),
 *     but each exit comes after a second -5% day, so one strike later.
 *   - Nothing tuned: the -5% day and the 20-day window are the champion's
 *     numbers (its cooldown is 10 days; two strikes inside 20 days is the
 *     matching "cluster" scale), 2 strikes is the smallest number that is a
 *     cluster. Declared before running; the commit shows 1 and 3 strikes
 *     and the five-era table against the champion.
 *
 * WHY IT MIGHT WORK: it removes the champion's false alarms in bull markets
 *   while still stepping aside when crashes bunch up, so it should give up
 *   less in clean-bull eras and protect about as well in deep-bear eras.
 * WHY IT MIGHT FAIL: the first strike is usually the largest drop in a
 *   cascade; waiting for the second one means entering the exit after the
 *   damage, and a V-shaped crash may never produce a second strike at all.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-19-two-strike-breaker.js
 *   - CRASH_PCT: how big a one-day drop counts as a strike
 *   - STRIKES: strikes needed inside the window to go to cash (1 = old breaker)
 *   - WINDOW_DAYS: how long a strike stays "live"
 * =============================================================================
 */

const CRASH_PCT = 0.05;    // a close-to-close drop worse than this is a strike
const STRIKES = 2;         // strikes inside the window that trigger the alarm
const WINDOW_DAYS = 20;    // a strike counts for this many days

module.exports = {
  name: "Two-Strike Breaker",
  description:
    "The breaker for clustered crashes only: go to cash while at least 2 days with a drop worse than -5% fall inside the last 20 days, hold BTC otherwise",

  decide({ candles, index, position }) {
    if (index < WINDOW_DAYS) return "hold"; // warm-up: need a full window of returns

    // Count strikes among the last WINDOW_DAYS daily returns (today included).
    let strikes = 0;
    for (let i = index - WINDOW_DAYS + 1; i <= index; i++) {
      const dailyReturn = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
      if (dailyReturn < -CRASH_PCT) strikes++;
    }

    const alarm = strikes >= STRIKES;

    if (alarm && position === "btc") return "sell";
    if (!alarm && position === "cash") return "buy";
    return "hold";
  },
};
