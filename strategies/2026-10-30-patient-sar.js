/**
 * =============================================================================
 * Strategy: Patient SAR 0.01/0.01/0.1                    — tried on 2026-10-30
 * =============================================================================
 * THE IDEA (the pre-registered follow-up to yesterday's Parabolic SAR):
 *   - Yesterday Wilder's classic SAR (factors 0.02/0.02/0.2) lost -23.8%,
 *     but a sweep across four historical eras showed a monotone pattern:
 *     the SLOWER the stop accelerates, the better it did, in every era.
 *     A slow SAR is a trailing stop that gives a young trend lots of room
 *     and tightens only gradually - patient enough for BTC's pullbacks.
 *   - THE PRE-REGISTRATION: the settings below were fixed by a rule that
 *     does not look at results - "exactly half of Wilder's factors" -
 *     BEFORE this row was run, so the scoreboard row is one declared bet,
 *     not the best of a search. (Honest caveat: yesterday's sweep touched
 *     the same historical data, so this cannot be a clean out-of-sample
 *     test. The real test is the FUTURE: this row re-runs on a rolling
 *     2-year window, and every new day of data is one the setting never
 *     saw. Watch whether it keeps up.)
 *   - Rules are identical to the Parabolic SAR file: hold BTC while the
 *     SAR dot trails below price, cash after price touches the dot.
 *
 * WHY IT MIGHT WORK: patience is the one property the classic lacked, and
 *   the cross-era sweep (1090% / 207% in two eras vs 622% / 130% buy & hold)
 *   says a slow stop is not merely a single-era accident.
 * WHY IT MIGHT FAIL: it beat buy & hold in only 2 of 4 eras even when
 *   chosen with hindsight, it still carried 35-60% drawdowns, and in the
 *   current calm era the lab's results say every trend filter gives back
 *   about what it saves.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-10-30-patient-sar.js
 *   - AF_START / AF_STEP / AF_MAX: smaller = slower, more patient stop
 * =============================================================================
 */

const AF_START = 0.01; // half of Wilder's 0.02
const AF_STEP = 0.01;  // half of Wilder's 0.02
const AF_MAX = 0.1;    // half of Wilder's 0.2

// SAR is recursive (today's dot depends on yesterday's), so compute the whole
// series once per pass and cache it. uptrend[i] depends only on
// candles[0..i], so reading it at `index` has no lookahead.
let cache = null; // { length, uptrend: [bool, ...] }

function computeSar(candles) {
  const uptrend = new Array(candles.length).fill(true);

  let isUp = true;
  let sar = candles[0].low;       // start long, dot at the first low
  let extreme = candles[0].high;  // highest high (up) / lowest low (down) so far
  let af = AF_START;

  for (let i = 1; i < candles.length; i++) {
    // Today's dot moves a fraction AF of the way toward the extreme point.
    sar = sar + af * (extreme - sar);

    if (isUp) {
      // The dot may never sit above the previous two lows.
      sar = Math.min(sar, candles[i - 1].low, i >= 2 ? candles[i - 2].low : candles[i - 1].low);
      if (candles[i].low < sar) {
        isUp = false;              // price touched the dot -> trend flips down
        sar = extreme;
        extreme = candles[i].low;
        af = AF_START;
      } else if (candles[i].high > extreme) {
        extreme = candles[i].high; // new high -> tighten the stop a notch
        af = Math.min(af + AF_STEP, AF_MAX);
      }
    } else {
      // Mirror image for the downtrend: dot may never sit below the last two highs.
      sar = Math.max(sar, candles[i - 1].high, i >= 2 ? candles[i - 2].high : candles[i - 1].high);
      if (candles[i].high > sar) {
        isUp = true;               // price touched the dot from below -> flips up
        sar = extreme;
        extreme = candles[i].high;
        af = AF_START;
      } else if (candles[i].low < extreme) {
        extreme = candles[i].low;
        af = Math.min(af + AF_STEP, AF_MAX);
      }
    }
    uptrend[i] = isUp;
  }
  return { length: candles.length, uptrend };
}

module.exports = {
  name: "Patient SAR 0.01/0.1",
  description:
    "Pre-registered follow-up: Parabolic SAR with half of Wilder's acceleration (slower, more patient trailing stop) - hold while the dot trails below price, cash when it flips",

  decide({ candles, index, position }) {
    if (index < 5) return "hold"; // warm-up so the first dots settle

    if (!cache || cache.length !== candles.length) cache = computeSar(candles);

    const up = cache.uptrend[index];
    if (up && position === "cash") return "buy";
    if (!up && position === "btc") return "sell";
    return "hold";
  },
};
