/**
 * =============================================================================
 * Strategy: Circuit Breaker Ensemble (3 voters)         — tried on 2026-10-07
 * =============================================================================
 * THE IDEA (applying the lab's anti-parameter-luck lesson to the champion):
 *   - The champion Circuit Breaker Hold uses one magic number: -5%. Its
 *     parameter sweep looked healthy (every neighbor profitable), but the
 *     Donchian saga taught us to distrust any single parameterization.
 *   - So: run THREE breakers side by side, tripped at -4%, -5%, and -6%,
 *     each with its own independent 10-day cooldown clock. Each voter is
 *     "long" whenever its own clock is at zero.
 *   - Hold BTC while a MAJORITY (2 of 3) of voters are long; go to cash
 *     when 2+ are cooling down.
 *   - Net effect: a mild shock (-4.5%) trips only the twitchiest voter and
 *     the ensemble stays invested; a real crash (worse than -5%) trips at
 *     least two and the ensemble steps aside. The crash threshold becomes
 *     a weighted zone instead of a single cliff-edge number.
 *
 * WHY IT MIGHT WORK: same mechanism as the champion with less dependence
 * on exactly where "-5%" sits; staggered cooldowns also smooth re-entry.
 * WHY IT MIGHT FAIL: the -5% single version may simply be well-placed on
 * this sample, and the -4% voter's extra trips (it fires on milder, more
 * frequent shocks) could drag the blend below the one-number original.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-07-breaker-ensemble.js
 *   - THRESHOLDS: the voters' trip levels (add more for a finer blend)
 *   - MAJORITY: voters that must be long to stay invested
 *   - COOLDOWN_DAYS: each voter's sit-out period after tripping
 * =============================================================================
 */

const THRESHOLDS = [0.04, 0.05, 0.06]; // each voter's crash trip level
const COOLDOWN_DAYS = 10;              // per-voter sit-out after tripping
const MAJORITY = 2;                    // voters that must be long to hold BTC

// Module-level state: each voter's remaining cooldown days.
// (Fine for this engine: one strategy, one sequential pass over the candles.)
let cooldowns = THRESHOLDS.map(() => 0);
let lastIndexSeen = -1;

module.exports = {
  name: "Breaker Ensemble 3x",
  description:
    "Anti-parameter-luck champion: three circuit breakers (-4%/-5%/-6%) with independent cooldowns vote; hold BTC while 2 of 3 are not cooling down",

  decide({ candles, index, position }) {
    if (index < 1) return "hold"; // need yesterday to measure today's move

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldowns = THRESHOLDS.map(() => 0);
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Update every voter independently ---------------------------------
    for (let v = 0; v < THRESHOLDS.length; v++) {
      if (dailyReturn < -THRESHOLDS[v]) {
        cooldowns[v] = COOLDOWN_DAYS; // this voter's crash level was breached
      } else if (cooldowns[v] > 0) {
        cooldowns[v]--; // this voter keeps counting down its sit-out
      }
    }

    // ---- Follow the majority ----------------------------------------------
    const longVotes = cooldowns.filter((c) => c === 0).length;

    if (longVotes >= MAJORITY && position === "cash") return "buy";
    if (longVotes < MAJORITY && position === "btc") return "sell";

    return "hold";
  },
};
