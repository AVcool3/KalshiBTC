/**
 * =============================================================================
 * Strategy: Walk-Forward Donchian                       — tried on 2026-09-27
 * =============================================================================
 * THE IDEA (testing the assumption everyone secretly makes):
 *   - Our scoreboard says Donchian 20/10 was the lucky pair on THIS sample
 *     (55/20 lost, the 5-voter ensemble only made +7.75%). The tempting
 *     conclusion is: "fine, just keep using whatever pair has been working
 *     LATELY." This strategy tests exactly that temptation, honestly.
 *   - Every 30 days, run a mini-backtest of five Donchian pairs
 *     (10/5, 15/8, 20/10, 30/15, 40/20) over the TRAILING 180 days only —
 *     data we'd genuinely have had at that moment, so no lookahead.
 *   - Adopt the best-performing pair and trade its rules for the next
 *     30 days. Then re-evaluate. Quants call this "walk-forward
 *     optimization" — parameters that adapt as the market changes.
 *
 * WHY IT MIGHT WORK: if which-breakout-speed-wins shifts slowly with market
 * character (fast pairs in choppy phases, slow pairs in long trends), then
 * recent performance is a usable compass and this follows it automatically.
 * WHY IT MIGHT FAIL (the famous result in quant finance): the recently-best
 * parameter is usually just the recently-LUCKY parameter, so this ends up
 * always fighting the last war — switching to fast pairs right before the
 * market smooths out, and vice versa. If this loses while the fixed pairs
 * around it do fine, "chase what worked lately" is dead as an approach.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-27-walk-forward-donchian.js
 *   - TRAIN_DAYS: how much history each mini-backtest sees
 *   - REOPT_EVERY: how often the pair gets re-picked (days)
 *   - CANDIDATES: the parameter pairs competing for the job
 * =============================================================================
 */

const CANDIDATES = [
  [10, 5],
  [15, 8],
  [20, 10],
  [30, 15],
  [40, 20],
];
const TRAIN_DAYS = 180; // trailing window each mini-backtest is scored on
const REOPT_EVERY = 30; // re-pick the ruling pair every 30 days
const FEE_RATE = 0.006; // same fee the real engine charges, so scores are fair

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

/**
 * Mini-backtest: run one Donchian pair over candles[from..to] (inclusive),
 * all-in/all-out at closes with fees, starting in cash. Returns the final
 * portfolio multiple (1.0 = broke even). Used to SCORE each candidate on
 * the trailing window — it never touches data after `to`.
 */
function scorePair(candles, from, to, entryDays, exitDays) {
  let cash = 1;
  let btc = 0;
  for (let i = from; i <= to; i++) {
    if (i < entryDays || i < exitDays) continue; // not enough lookback yet
    const price = candles[i].close;
    if (btc === 0 && price > highestClose(candles, i, entryDays)) {
      btc = (cash * (1 - FEE_RATE)) / price;
      cash = 0;
    } else if (btc > 0 && price < lowestClose(candles, i, exitDays)) {
      cash = btc * price * (1 - FEE_RATE);
      btc = 0;
    }
  }
  return cash + btc * candles[to].close; // liquidation value at window end
}

// Module-level state: which pair currently rules, and when we last re-picked.
// (Fine for this engine: one strategy, one sequential pass over the candles.)
let rulingPair = null;
let lastReopt = -Infinity;

module.exports = {
  name: "Walk-Forward Donchian",
  description:
    "Adaptive parameters: every 30 days adopt whichever Donchian pair won the trailing 180 days, then trade its rules - tests whether 'recently best' stays best",

  decide({ candles, index, position }) {
    // Warm-up: need a full training window plus the slowest lookback.
    const slowest = Math.max(...CANDIDATES.map(([e]) => e));
    if (index < TRAIN_DAYS + slowest) return "hold";

    // ---- Re-optimization day: crown the pair that won the trailing window
    if (index - lastReopt >= REOPT_EVERY) {
      let bestScore = -Infinity;
      for (const [entryDays, exitDays] of CANDIDATES) {
        const score = scorePair(candles, index - TRAIN_DAYS, index, entryDays, exitDays);
        if (score > bestScore) {
          bestScore = score;
          rulingPair = [entryDays, exitDays];
        }
      }
      lastReopt = index;
    }

    // ---- Trade the ruling pair's plain Donchian rules ---------------------
    const [entryDays, exitDays] = rulingPair;
    const today = candles[index].close;

    if (position === "cash" && today > highestClose(candles, index, entryDays)) {
      return "buy";
    }
    if (position === "btc" && today < lowestClose(candles, index, exitDays)) {
      return "sell";
    }

    return "hold";
  },
};
