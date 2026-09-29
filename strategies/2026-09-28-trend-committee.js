/**
 * =============================================================================
 * Strategy: Trend Committee (3 mechanisms vote)         — tried on 2026-09-28
 * =============================================================================
 * THE IDEA (diversify across MECHANISMS, not parameters):
 *   - Last week's arc showed that averaging one idea's parameters (the
 *     Donchian ensemble) still leaves you exposed to that one idea's blind
 *     spots. Today's question: does combining DIFFERENT ideas work better?
 *   - Three trend-followers with genuinely different mechanisms each cast
 *     a daily vote, long or flat:
 *       1. SMA CROSSOVER: is the 10-day average above the 30-day average?
 *          (smooth, medium-speed trend detector)
 *       2. DONCHIAN 20/10 STATE: did a 20-day-high breakout fire more
 *          recently than a 10-day-low breakdown? (event-driven, fast exit)
 *       3. ABSOLUTE MOMENTUM: is price above its level 90 days ago?
 *          (slow, big-picture trend detector)
 *   - Hold BTC while at least 2 of the 3 vote long; otherwise hold cash.
 *
 * WHY IT MIGHT WORK: the three signals fail in DIFFERENT ways (crossover
 * whipsaws in chop, Donchian gets faked out at range tops, momentum is slow
 * at turns). Requiring agreement between two unrelated mechanisms filters
 * each one's solo mistakes while still catching every major trend, since
 * all three agree during real trends.
 * WHY IT MIGHT FAIL: all three are still TREND followers fed by the same
 * price series — in a fast V-shaped crash-and-recover market they all get
 * fooled together, just at slightly different speeds, so the committee can
 * end up as slow as its slowest member on entries and still whipsaw.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-28-trend-committee.js
 *   - VOTES_NEEDED: 1 = any signal suffices (aggressive), 3 = unanimous only
 *   - Each voter's windows are its own constants below
 * =============================================================================
 */

// --- Voter 1: SMA crossover windows ---
const SMA_FAST = 10;
const SMA_SLOW = 30;

// --- Voter 2: Donchian breakout windows ---
const DON_ENTRY = 20;
const DON_EXIT = 10;

// --- Voter 3: absolute momentum lookback ---
const MOM_DAYS = 90;

// --- Committee rule ---
const VOTES_NEEDED = 2; // hold BTC while at least this many voters are long

/** Simple moving average of closes over `days` ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

/** Highest close among the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  let h = -Infinity;
  for (let i = index - days; i < index; i++) h = Math.max(h, candles[i].close);
  return h;
}

/** Lowest close among the `days` candles BEFORE `index` (today excluded). */
function lowestClose(candles, index, days) {
  let l = Infinity;
  for (let i = index - days; i < index; i++) l = Math.min(l, candles[i].close);
  return l;
}

// Module-level state for the Donchian voter: it is event-driven (a breakout
// puts it long until a breakdown), so it must remember its own state.
// (Fine for this engine: one strategy, one sequential pass over the candles.)
let donchianLong = false;
let lastIndexSeen = -1;

module.exports = {
  name: "Trend Committee 2-of-3",
  description:
    "Mechanism diversification: SMA crossover, Donchian 20/10 state, and 90-day momentum each vote; hold BTC while any two agree the trend is up",

  decide({ candles, index, position }) {
    // Warm-up: the slowest voter (90-day momentum) sets the start line.
    if (index < MOM_DAYS) return "hold";

    // Fresh pass detection (engine restarted on same module) -> reset state.
    if (index <= lastIndexSeen) donchianLong = false;
    lastIndexSeen = index;

    const today = candles[index].close;

    // ---- Voter 1: SMA crossover ------------------------------------------
    const smaVote = sma(candles, index, SMA_FAST) > sma(candles, index, SMA_SLOW);

    // ---- Voter 2: Donchian 20/10 state (update, then read) ---------------
    if (!donchianLong && today > highestClose(candles, index, DON_ENTRY)) {
      donchianLong = true;
    } else if (donchianLong && today < lowestClose(candles, index, DON_EXIT)) {
      donchianLong = false;
    }

    // ---- Voter 3: absolute momentum --------------------------------------
    const momVote = today > candles[index - MOM_DAYS].close;

    // ---- Follow the committee's majority ----------------------------------
    const votes = (smaVote ? 1 : 0) + (donchianLong ? 1 : 0) + (momVote ? 1 : 0);

    if (votes >= VOTES_NEEDED && position === "cash") return "buy";
    if (votes < VOTES_NEEDED && position === "btc") return "sell";

    return "hold";
  },
};
