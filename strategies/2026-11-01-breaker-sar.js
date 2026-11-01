/**
 * =============================================================================
 * Strategy: Breaker + Patient SAR                        — tried on 2026-11-01
 * =============================================================================
 * THE IDEA (swap the slow alarm in Belt and Suspenders):
 *   - Belt and Suspenders stacks two alarms: the champion's crash breaker
 *     (fast cascades) and the 200-day line (slow bears). It has the lowest
 *     drawdowns on the board but beat buy & hold on return in only one of
 *     four eras, because the 200-day line is SO slow that it sits out
 *     early recoveries (2019: -23%).
 *   - The Patient SAR (half of Wilder's acceleration) is a trend filter
 *     that reverses faster than a 200-day average but, unlike the classic
 *     SAR, is patient enough for BTC's pullbacks. It beat buy & hold in 2
 *     of 4 eras. Hypothesis: the same two-alarm design with a quicker
 *     trend alarm keeps the protection and gives back less upside.
 *   - Rule: hold BTC only while the SAR says "uptrend" AND the breaker is
 *     not cooling down; either alarm means cash.
 *   - NOTHING IS TUNED: every constant is copied from a parent file (the
 *     champion's -5%/10-day breaker; Patient SAR's 0.01/0.01/0.1). The
 *     only choice made today was which two pieces to combine.
 *
 * WHY IT MIGHT WORK: the breaker and the SAR fail in different ways (the
 *   breaker misses slow grinds, the SAR is late on cascades), so each
 *   covers the other's blind spot, and the SAR re-enters sooner than a
 *   200-day line does after a bottom.
 * WHY IT MIGHT FAIL: stacking two alarms means roughly the sum of both
 *   alarms' false positives. Patient SAR had 18 round-trips in two years;
 *   adding breaker trips on top could push fee drag past what the extra
 *   protection earns.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-01-breaker-sar.js
 *   - CRASH_PCT / COOLDOWN_DAYS: the champion's breaker
 *   - AF_START / AF_STEP / AF_MAX: the SAR's acceleration (smaller = slower)
 * =============================================================================
 */

// --- Circuit breaker settings (the champion's) ---
const CRASH_PCT = 0.05;
const COOLDOWN_DAYS = 10;

// --- Patient SAR settings (half of Wilder's classic) ---
const AF_START = 0.01;
const AF_STEP = 0.01;
const AF_MAX = 0.1;

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;
let sarCache = null; // { length, uptrend: [bool, ...] }

// SAR is recursive (today's dot depends on yesterday's), so compute the whole
// series once per pass. uptrend[i] depends only on candles[0..i]: no lookahead.
function computeSar(candles) {
  const uptrend = new Array(candles.length).fill(true);
  let isUp = true;
  let sar = candles[0].low;
  let extreme = candles[0].high;
  let af = AF_START;

  for (let i = 1; i < candles.length; i++) {
    sar = sar + af * (extreme - sar);
    if (isUp) {
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low);
      if (candles[i].low < sar) {
        isUp = false; sar = extreme; extreme = candles[i].low; af = AF_START;
      } else if (candles[i].high > extreme) {
        extreme = candles[i].high; af = Math.min(af + AF_STEP, AF_MAX);
      }
    } else {
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high);
      if (candles[i].high > sar) {
        isUp = true; sar = extreme; extreme = candles[i].high; af = AF_START;
      } else if (candles[i].low < extreme) {
        extreme = candles[i].low; af = Math.min(af + AF_STEP, AF_MAX);
      }
    }
    uptrend[i] = isUp;
  }
  return { length: candles.length, uptrend };
}

module.exports = {
  name: "Breaker + Patient SAR",
  description:
    "Belt and Suspenders with a quicker trend alarm: hold BTC only while the slow SAR says uptrend AND no post-crash cooldown is running; either alarm means cash",

  decide({ candles, index, position }) {
    if (index < 5) return "hold"; // warm-up so the first SAR dots settle

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    if (!sarCache || sarCache.length !== candles.length) sarCache = computeSar(candles);

    const dailyReturn =
      (candles[index].close - candles[index - 1].close) / candles[index - 1].close;

    // ---- Alarm 1: the circuit breaker (fast crashes) ----------------------
    if (dailyReturn < -CRASH_PCT) cooldownLeft = COOLDOWN_DAYS;
    else if (cooldownLeft > 0) cooldownLeft--;

    // ---- Alarm 2: the Patient SAR (slow trend breaks) -----------------------
    const trendUp = sarCache.uptrend[index];

    // ---- Hold only while BOTH say it's safe ---------------------------------
    const safe = trendUp && cooldownLeft === 0;
    if (safe && position === "cash") return "buy";
    if (!safe && position === "btc") return "sell";
    return "hold";
  },
};
