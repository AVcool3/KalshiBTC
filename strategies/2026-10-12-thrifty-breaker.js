/**
 * =============================================================================
 * Strategy: Thrifty Breaker                             — tried on 2026-10-12
 * =============================================================================
 * THE IDEA (dissecting WHERE the champion's profit comes from):
 *   - The champion Circuit Breaker sells after a -5% day, waits 10 days,
 *     and buys back AT WHATEVER THE PRICE IS. Sometimes that's cheaper
 *     than it sold (the dodge paid), sometimes it's more expensive (the
 *     dodge cost money). The champion never checks - it just re-enters.
 *   - This variant adds one thrifty instinct everyone has: "I sold at X,
 *     I refuse to buy back above X." After the standard 10-day cooldown:
 *       - price BELOW our exit -> re-enter immediately (discount secured)
 *       - price ABOVE our exit -> keep waiting, up to EXTRA_WAIT (10) more
 *         days, re-entering the moment it dips under the exit price...
 *       - ...and if the discount never comes, swallow the regret and buy
 *         at market anyway (the cap stops us waiting forever - the
 *         Drawdown Bargain lesson: defaulting to cash loses wars).
 *
 * WHAT THE RESULT MEANS: if this BEATS the champion, part of the edge is
 * price-based and bargain-hunting the re-entry improves it. If it LOSES,
 * the edge is purely about skipping the turbulent window, and anchoring to
 * your old exit price is exactly the trap behavioral finance says it is
 * (prices that ran away while you waited never come back cheaper).
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-12-thrifty-breaker.js
 *   - EXTRA_WAIT: how long to hold out for the discount (0 = the champion)
 * =============================================================================
 */

const CRASH_PCT = 0.05;    // the champion's trip level
const COOLDOWN_DAYS = 10;  // the champion's standard sit-out
const EXTRA_WAIT = 10;     // extra days we'll hold out for a discount

// Module-level state (fine for this engine: one sequential pass).
let cooldownLeft = 0;
let exitPrice = null;  // what we sold at when the breaker tripped
let extraLeft = 0;     // discount-hunting days remaining after cooldown
let lastIndexSeen = -1;

module.exports = {
  name: "Thrifty Breaker",
  description:
    "The champion plus a thrifty rule: after the cooldown, only buy back BELOW the price you sold at (up to 10 extra days), then give up and re-enter at market",

  decide({ candles, index, position }) {
    if (index < 1) return "hold";

    // Fresh pass detection (engine re-run on same module) -> reset state.
    if (index <= lastIndexSeen) { cooldownLeft = 0; exitPrice = null; extraLeft = 0; }
    lastIndexSeen = index;

    const today = candles[index].close;
    const yesterday = candles[index - 1].close;
    const dailyReturn = (today - yesterday) / yesterday;

    // ---- Panic day: trip the breaker --------------------------------------
    if (dailyReturn < -CRASH_PCT) {
      cooldownLeft = COOLDOWN_DAYS;
      extraLeft = 0;
      if (position === "btc") {
        exitPrice = today; // remember what we sold at
        return "sell";
      }
      return "hold";
    }

    // ---- Standard cooldown: wait it out (same as the champion) ------------
    if (cooldownLeft > 0) {
      cooldownLeft--;
      if (cooldownLeft === 0) extraLeft = EXTRA_WAIT; // enter discount phase
      return "hold";
    }

    // ---- Discount phase: only buy back below our exit price ---------------
    if (extraLeft > 0 && position === "cash") {
      extraLeft--;
      const discount = exitPrice !== null && today < exitPrice;
      const gaveUp = extraLeft === 0;
      if (discount || gaveUp) {
        exitPrice = null;
        extraLeft = 0;
        return "buy"; // either we got our price, or we stop sulking
      }
      return "hold"; // still holding out for the discount
    }

    // ---- Ordinary day: be invested (the default state) ---------------------
    if (position === "cash") return "buy";
    return "hold";
  },
};
