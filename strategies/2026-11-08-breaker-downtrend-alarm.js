/**
 * =============================================================================
 * Strategy: Breaker + Downtrend Alarm                    — tried on 2026-11-08
 * =============================================================================
 * THE IDEA (a second alarm that only rings for a CLEAN slide):
 *   - Belt and Suspenders pairs the champion's crash breaker (fast
 *     cascades) with the 200-day line (slow bears). Last week's attempt to
 *     swap the 200-day line for the Patient SAR failed on fee drag: the SAR
 *     rings on every ordinary pullback, 28-30 round-trips in wild eras.
 *   - What we want from the second alarm: ring ONLY for a sustained, orderly
 *     decline (the 2018 / 2022 style grind), stay silent during choppy
 *     noise. Kaufman's Efficiency Ratio (ER) is built for exactly that
 *     distinction: ER = |net change| / total daily travel over N days.
 *       ER high + net change DOWN = a clean, one-directional slide
 *       ER low (zig-zag)          = noise, however big the swings
 *   - Rules:
 *       ALARM 1 (champion): a close-to-close drop worse than 5% starts a
 *               10-day cooldown (cash).
 *       ALARM 2 (new): the 20-day change is negative AND ER(20) > 0.3 -> the
 *               market is sliding in a straight line -> cash. The alarm
 *               clears as soon as either condition fails.
 *       Hold BTC only while NEITHER alarm is ringing.
 *   - Nothing tuned: breaker settings copied from the champion; ER 20 days
 *     and 0.3 gate copied from the Efficiency Ratio strategy, all declared
 *     before this run.
 *
 * WHY IT MIGHT WORK: slow grinds are the one kind of damage the breaker
 *   cannot see (no single -5% day), and an orderly slide is the one regime
 *   where "cash" has consistently beaten "hold" across all the eras tested.
 * WHY IT MIGHT FAIL: ER is measured over the same window as the damage, so
 *   the alarm rings late (after ~20 days of grinding); and a clean 20-day
 *   decline that then reverses (a V) is the pattern that cost every other
 *   trend filter its upside.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-08-breaker-downtrend-alarm.js
 *   - CRASH_PCT / COOLDOWN_DAYS: the champion's breaker
 *   - ER_DAYS / ER_GATE: how long and how straight a slide must be to ring
 * =============================================================================
 */

// --- Alarm 1: the champion's circuit breaker ---
const CRASH_PCT = 0.05;
const COOLDOWN_DAYS = 10;

// --- Alarm 2: clean downtrend (Efficiency Ratio) ---
const ER_DAYS = 20;   // window for net change and total travel
const ER_GATE = 0.3;  // slide must be at least this "straight" to ring

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Breaker + Downtrend Alarm",
  description:
    "The champion's breaker plus a second alarm for clean slides: cash while a -5% day cooldown runs OR while the 20-day change is negative with Efficiency Ratio above 0.3",

  decide({ candles, index, position }) {
    if (index < ER_DAYS) return "hold"; // warm-up

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    // ---- Alarm 1: circuit breaker -------------------------------------------
    const dailyReturn =
      (candles[index].close - candles[index - 1].close) / candles[index - 1].close;
    if (dailyReturn < -CRASH_PCT) cooldownLeft = COOLDOWN_DAYS;
    else if (cooldownLeft > 0) cooldownLeft--;

    // ---- Alarm 2: clean downtrend -------------------------------------------
    const net = candles[index].close - candles[index - ER_DAYS].close;
    let travel = 0;
    for (let i = index - ER_DAYS + 1; i <= index; i++) {
      travel += Math.abs(candles[i].close - candles[i - 1].close);
    }
    const er = travel === 0 ? 0 : Math.abs(net) / travel;
    const slidingCleanly = net < 0 && er > ER_GATE;

    // ---- Hold only while both alarms are quiet -------------------------------
    const safe = cooldownLeft === 0 && !slidingCleanly;
    if (safe && position === "cash") return "buy";
    if (!safe && position === "btc") return "sell";
    return "hold";
  },
};
