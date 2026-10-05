/**
 * =============================================================================
 * Strategy: Euphoria Breaker                            — tried on 2026-10-05
 * =============================================================================
 * THE IDEA (a controlled experiment on WHY the champion works):
 *   - The champion Circuit Breaker Hold sells after a -5% CRASH day and
 *     sits out 10 days (+55.32% vs +40.49%). But what is its edge really
 *     made of? Two competing explanations:
 *       (a) "Volatility clustering": any giant day — up OR down — marks
 *           the start of a turbulent, dangerous stretch. Shock = step aside.
 *       (b) "Crash momentum": specifically DOWN days are followed by more
 *           down days; big up days are fine or even bullish.
 *   - This strategy is the champion's EXACT MIRROR: long by default, but
 *     it sells after a +5% EUPHORIA day (a blow-off surge) and sits out
 *     the same 10 days before re-entering. Identical machinery, opposite
 *     trigger.
 *   - Reading the result: if this mirror ALSO beats buy & hold, story (a)
 *     wins — avoid turbulence after any shock. If it clearly loses, story
 *     (b) wins — the danger is specific to what follows panic, and big up
 *     days are days you want to be holding THROUGH, not hiding from.
 *
 * WHY IT MIGHT FAIL (and why that would be informative): BTC's biggest up
 * days tend to appear inside powerful rallies; selling into them forfeits
 * exactly the handful of weeks that produce most of the asset's return.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-05-euphoria-breaker.js
 *   - SURGE_PCT: how big an up-day trips the breaker
 *   - COOLDOWN_DAYS: how long to stay out after tripping
 * =============================================================================
 */

const SURGE_PCT = 0.05;   // a close-to-close GAIN bigger than this trips it
const COOLDOWN_DAYS = 10; // trading days to sit out after tripping

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let lastIndexSeen = -1;

module.exports = {
  name: "Euphoria Breaker",
  description:
    "The champion's mirror: long by default, but sell after a +5% blow-off day and sit out 10 days - tests whether the breaker edge is turbulence-avoidance or crash-specific",

  decide({ candles, index, position }) {
    if (index < 1) return "hold"; // need yesterday to measure today's move

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) cooldownLeft = 0;
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Euphoria day: trip the breaker -----------------------------------
    if (dailyReturn > SURGE_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
      if (position === "btc") return "sell"; // step aside at today's close
      return "hold";
    }

    // ---- Cooling down: count the days out ----------------------------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      return "hold";
    }

    // ---- Ordinary day: be invested (the default state) ---------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
