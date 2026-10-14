/**
 * =============================================================================
 * Strategy: Storm Rider                                 — tried on 2026-10-14
 * =============================================================================
 * THE IDEA (a direct measurement of the champion's premise):
 *   - The champion Circuit Breaker is built on one claim: THE 10 DAYS AFTER
 *     A -5% CRASH DAY ARE BAD TO HOLD. Every test so far probed that claim
 *     indirectly. This strategy measures it head-on by doing the exact
 *     opposite of the champion:
 *       - Sit in CASH by default (all the days the champion holds).
 *       - On a close-to-close drop worse than -5%, BUY at that close.
 *       - Hold for exactly the champion's 10-trading-day cooldown window
 *         (another crash day during the hold restarts the clock), then sell.
 *   - Together, Storm Rider and the champion own the market on complementary
 *     days: every day belongs to exactly one of them. So this is the other
 *     half of the ledger - it isolates precisely the returns the champion
 *     steps aside from.
 *
 * READING THE RESULT:
 *   - If this LOSES while the champion wins, the premise is confirmed by
 *     both halves: post-crash windows destroy money, everything else earns it.
 *   - If this somehow WINS, the champion's out-of-sample success was luck
 *     and the whole mechanism story needs rewriting. Either answer is worth
 *     having - that's why we run it.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-14-storm-rider.js
 *   (They mirror the champion's settings on purpose - change both together
 *   if you want the two strategies to stay exact complements.)
 * =============================================================================
 */

const CRASH_PCT = 0.05;   // buy at the close of a day worse than -5%
const HOLD_DAYS = 10;     // hold through the champion's cooldown window

// Module-level state (fine for this engine: one sequential pass).
let holdLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Storm Rider",
  description:
    "The champion's complement: hold BTC ONLY during the 10-day post-crash windows the breaker avoids - a direct measurement of whether those windows really lose money",

  decide({ candles, index, position }) {
    if (index < 1) return "hold";

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) holdLeft = 0;
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Crash day: ride INTO the storm -----------------------------------
    if (dailyReturn < -CRASH_PCT) {
      holdLeft = HOLD_DAYS; // start (or restart) the storm window
      if (position === "cash") return "buy"; // buy exactly where the champion sells
      return "hold";
    }

    // ---- Inside the storm window: count it down ----------------------------
    if (holdLeft > 0) {
      holdLeft--;
      if (holdLeft === 0 && position === "btc") return "sell"; // window over
      return "hold";
    }

    // ---- Calm days: stay in cash (the champion owns these) -----------------
    return "hold";
  },
};
