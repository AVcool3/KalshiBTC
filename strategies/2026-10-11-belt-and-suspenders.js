/**
 * =============================================================================
 * Strategy: Belt and Suspenders                         — tried on 2026-10-11
 * =============================================================================
 * THE IDEA (stack the lab's only two validated protections):
 *   - After 24 strategies, exactly two defensive mechanisms have earned
 *     their keep, and they guard against DIFFERENT dangers:
 *       1. CIRCUIT BREAKER (champion, +55.32%, out-of-sample validated):
 *          dodges FAST crashes - sell after a -5% day, 10-day cooldown.
 *          Blind spot: slow, grinding declines that never print a -5% day.
 *       2. 200-DAY LINE (comfort prize, -15.58% max drawdown): dodges
 *          SLOW bears - cash while price sits clearly below the long
 *          average. Blind spot: sudden crashes it reacts to weeks late.
 *   - Each one's blind spot is the other one's specialty. So: hold BTC
 *     only while BOTH agree it's safe - price clearly above the 200-day
 *     line AND no post-crash cooldown running. Either alarm -> cash.
 *
 * WHY IT MIGHT WORK: complementary insurance - the belt catches what the
 * suspenders miss, aiming for breaker-like returns with line-like calm.
 * WHY IT MIGHT FAIL: the lab's oldest lesson cuts the other way - every
 * filter stacked on top of "just hold" subtracts time in market, and the
 * two alarms will sometimes fire on the SAME event (a crash below the
 * line), where the second filter adds delay instead of protection.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-11-belt-and-suspenders.js
 *   (Same knobs as the two parent strategies.)
 * =============================================================================
 */

// --- Circuit breaker settings (the champion's) ---
const CRASH_PCT = 0.05;
const COOLDOWN_DAYS = 10;

// --- 200-day line settings (the comfort prize's) ---
const SMA_DAYS = 200;
const BUFFER = 0.02; // only flip regime on a clear 2% break of the line

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lineBull = true; // current side of the 200-day line (with hysteresis)
let lastIndexSeen = -1;

/** Simple moving average of closes over `days` ending at `index`. */
function sma(candles, index, days) {
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) sum += candles[i].close;
  return sum / days;
}

module.exports = {
  name: "Belt and Suspenders",
  description:
    "The two validated protections stacked: hold BTC only while price is above the 200-day line AND no post-crash cooldown is running; either alarm means cash",

  decide({ candles, index, position }) {
    if (index + 1 < SMA_DAYS) return "hold"; // warm-up for the long average

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) { cooldownLeft = 0; lineBull = true; }
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Alarm 1: the circuit breaker (fast crashes) ----------------------
    if (dailyReturn < -CRASH_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
    } else if (cooldownLeft > 0) {
      cooldownLeft--;
    }

    // ---- Alarm 2: the 200-day line (slow bears), with 2% hysteresis -------
    const line = sma(candles, index, SMA_DAYS);
    if (today > line * (1 + BUFFER)) lineBull = true;
    else if (today < line * (1 - BUFFER)) lineBull = false;
    // (between the bands: keep the previous regime)

    // ---- Hold only while BOTH say it's safe --------------------------------
    const allClear = lineBull && cooldownLeft === 0;

    if (allClear && position === "cash") return "buy";
    if (!allClear && position === "btc") return "sell";

    return "hold";
  },
};
