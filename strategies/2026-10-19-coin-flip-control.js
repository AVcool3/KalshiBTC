/**
 * =============================================================================
 * Strategy: Coin Flip Control                           — tried on 2026-10-19
 * =============================================================================
 * THE IDEA (every experiment needs a control group):
 *   - After 32 strategies, one question hangs over the whole scoreboard:
 *     what do these numbers look like when there is NO signal at all?
 *     This strategy answers it by trading on dice.
 *   - Each day in cash: a 2% chance to buy. Each day holding: a 10% chance
 *     to sell (so holds average ~10 days). Those odds are tuned to produce
 *     roughly the champion's trade profile (~9 round-trips in 2 years,
 *     ~10-day holds) with ZERO information content.
 *   - The random numbers come from a SEEDED generator (mulberry32, seed
 *     42), so the result is reproducible: run it again, get the same row.
 *     Change SEED to roll a different universe.
 *
 * WHY THIS MATTERS: any strategy on the scoreboard is only interesting to
 * the extent it beats not just buy & hold but also the SPREAD of outcomes
 * pure luck produces at the same trade count. The commit message for this
 * file reports that spread (200 seeds), so every past and future row has a
 * luck yardstick to stand against.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-19-coin-flip-control.js
 *   - SEED: a different seed = a different random trading life
 *   - BUY_CHANCE / SELL_CHANCE: shape the trade frequency and hold length
 * =============================================================================
 */

const SEED = 42;          // fixed so the scoreboard row is reproducible
const BUY_CHANCE = 0.02;  // daily odds of entering while in cash
const SELL_CHANCE = 0.10; // daily odds of exiting while holding (~10-day holds)

/**
 * mulberry32: a tiny, well-known seeded pseudo-random generator.
 * Same seed -> same sequence of "random" numbers, every run.
 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Module-level state: the RNG stream (reset when a fresh pass starts).
let rand = mulberry32(SEED);
let lastIndexSeen = -1;

module.exports = {
  name: "Coin Flip Control",
  description:
    "The control group: seeded random entries (2%/day) and exits (10%/day) with the champion's trade profile and zero information - the luck yardstick",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> restart the RNG
    // so the same seed always produces the same trades.
    if (index <= lastIndexSeen) rand = mulberry32(SEED);
    lastIndexSeen = index;

    const roll = rand(); // one dice roll per day, used for whichever side applies

    if (position === "cash" && roll < BUY_CHANCE) return "buy";
    if (position === "btc" && roll < SELL_CHANCE) return "sell";

    return "hold";
  },
};
