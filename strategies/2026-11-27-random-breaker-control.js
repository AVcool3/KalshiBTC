/**
 * =============================================================================
 * Strategy: Random Breaker Control (2%/day, 10-day cooldown) — tried on 2026-11-27
 * =============================================================================
 * THE IDEA (a luck yardstick for the whole breaker family):
 *   - Every rule in the lab's "insurance" family has the same SHAPE as the
 *     champion: be invested by default, occasionally an alarm sells, sit out a
 *     fixed 10 days, buy back. The shape alone gives some protection (cash
 *     during part of a fall) and some cost (cash during part of a rise), even
 *     if the alarms carry no information at all. To know whether a given
 *     rule's alarms are worth anything, they must be compared with alarms that
 *     are PURE DICE.
 *   - This strategy is that control: each day, with probability ALARM_CHANCE
 *     (2%), a random alarm trips - sell at the close and start the 10-day
 *     cooldown; otherwise be invested. Zero information about the market,
 *     the champion's trade profile (a trip every ~50 days on average, i.e.
 *     roughly the champion's frequency on BTC).
 *   - The dice are SEEDED (mulberry32, seed 42) so the scoreboard row is
 *     reproducible; the module also exports makeControl(seed) so the
 *     capture tool (backtest/run-capture.js) can roll hundreds of different
 *     seeds and measure the whole distribution of luck.
 *   - How it is used: the commit scores real strategies by UPSIDE capture
 *     (share of buy & hold's log growth kept in rising markets) minus
 *     DOWNSIDE capture (share of the log decline taken in falling markets),
 *     median over 36 asset-eras, and reports where each sits among the
 *     random-breaker distribution.
 *
 * WHY THIS MATTERS: "beat buy & hold in N eras" and "max drawdown" both
 *   turned out to be poor judges; a control distribution tells you how much
 *   of any score is the shape of the rule rather than its information.
 * WHY IT MIGHT MISLEAD: the control has a fixed alarm frequency; a real
 *   rule with many more or many fewer trips than 2%/day is compared against
 *   a different exposure, so the tool also runs 1% and 4% controls.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-27-random-breaker-control.js
 *   - SEED: a different seed = a different random trading life
 *   - ALARM_CHANCE: daily odds of a random alarm
 *   - COOLDOWN_DAYS: the fixed sit-out (the champion's 10)
 * =============================================================================
 */

const SEED = 42;            // fixed so the scoreboard row is reproducible
const ALARM_CHANCE = 0.02;  // daily odds of a random alarm
const COOLDOWN_DAYS = 10;   // fixed sit-out after an alarm (the champion's)

/** mulberry32: a tiny, well-known seeded pseudo-random generator. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds one independent random breaker (own dice, own state). */
function makeControl(seed = SEED, alarmChance = ALARM_CHANCE) {
  let rand = mulberry32(seed);
  let cooldownLeft = 0;
  let lastIndexSeen = -1;
  return {
    name: "Random Breaker Control",
    description:
      "The control group for the breaker family: invested by default, a random 2%/day alarm sells and starts a 10-day cooldown - the same shape as the champion with zero information",
    decide({ index, position }) {
      // Fresh pass detection (engine re-run on same module) -> restart the dice.
      if (index <= lastIndexSeen) { rand = mulberry32(seed); cooldownLeft = 0; }
      lastIndexSeen = index;

      // One dice roll per day: a random alarm trips the breaker.
      if (rand() < alarmChance) {
        cooldownLeft = COOLDOWN_DAYS;
        if (position === "btc") return "sell"; // step aside at today's close
        return "hold";                         // already out; the clock restarts
      }

      // Cooling down.
      if (cooldownLeft > 0) {
        cooldownLeft--;
        return "hold";
      }

      // Ordinary day: be invested (the default state).
      if (position === "cash") return "buy";
      return "hold";
    },
  };
}

const control = makeControl();
module.exports = { name: control.name, description: control.description, decide: control.decide, makeControl };
