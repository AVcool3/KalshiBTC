/**
 * =============================================================================
 * Strategy: Drawdown Alarm Vote 2-of-3                   — tried on 2026-11-28
 * =============================================================================
 * THE IDEA (insure the drawdown-breaker family against its own setting luck):
 *   - Yesterday's capture-vs-luck scoring found that the rules that did best
 *     (Drawdown Breaker 15%, Fast Trailing Stop, Tight Drawdown 10%, Vol-Scaled
 *     Breaker) all share one shape: invested by default, exit when the close
 *     falls far enough below its 30-day peak, then a fixed 10-day clock. They
 *     differ only in HOW FAR is "far enough": 10%, 15%, or a volatility-scaled
 *     line (0.75 x sigma x sqrt(30), about 10% on BTC and wider on wilder
 *     coins). On fresh coins none was clearly better than another, which is
 *     exactly the situation for an ensemble: don't pick, vote.
 *   - Three alarms, each with its own copy of the breaker mechanics:
 *       A: close more than 10% below the 30-day peak
 *       B: close more than 15% below the 30-day peak
 *       C: close more than 0.75 x sigma(60d) x sqrt(30) below the 30-day peak
 *     An alarm "trips" on any day its condition holds and then stays active
 *     for COOLDOWN_DAYS (10) days counting the trip day itself (the clock
 *     restarts while the condition keeps holding). That is the parents'
 *     mechanics, except their sit-out runs one day longer (trip day plus 10).
 *   - Hold the coin while FEWER THAN 2 alarms are active; otherwise cash.
 *     Because A and B are nested (B trips only when A does), the vote
 *     effectively means: leave once the drop passes 15%, or once it passes
 *     both the 10% line and the asset's own volatility line.
 *   - Nothing tuned: every threshold and the 10-day clock are copied from the
 *     parents; the 2-of-3 majority was declared before running. Like the
 *     Donchian, Breaker and Phase ensembles this can only remove setting luck,
 *     not add edge.
 *
 * WHY IT MIGHT WORK: it takes the middle of three plausible lines, so it
 *   should avoid the worst setting for any given coin while keeping the
 *   family's asymmetry (a larger share of rises kept than of falls taken).
 * WHY IT MIGHT FAIL: the three alarms are almost the same signal (nested
 *   thresholds on one price series), so the "vote" is closer to one opinion;
 *   and the whole family's evidence outside BTC is suggestive, not confirmed.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-11-28-drawdown-alarm-vote.js
 *   - DROPS: the fixed-percentage alarms' thresholds (10% and 15%)
 *   - K / SIGMA_DAYS: the volatility-scaled alarm
 *   - PEAK_DAYS / COOLDOWN_DAYS: shared by all three alarms
 *   - VOTES_TO_EXIT: how many alarms must be active to go to cash (2 of 3)
 * =============================================================================
 */

const DROPS = [0.10, 0.15];  // alarms A and B: fixed fall from the 30-day peak
const K = 0.75;              // alarm C: trip line = K x sigma x sqrt(PEAK_DAYS)
const SIGMA_DAYS = 60;       // days of returns in the volatility estimate
const PEAK_DAYS = 30;        // the peak is the highest close in this many days
const COOLDOWN_DAYS = 10;    // each alarm stays active this long after its last trip
const VOTES_TO_EXIT = 2;     // go to cash when at least this many alarms are active

// Module-level state: each alarm's remaining cooldown (A, B, C).
let cooldowns = [0, 0, 0];
let lastIndexSeen = -1;

/** Highest close over the PEAK_DAYS days ending at `index` (today included). */
function recentPeak(candles, index) {
  let peak = -Infinity;
  for (let i = Math.max(0, index - PEAK_DAYS + 1); i <= index; i++) {
    peak = Math.max(peak, candles[i].close);
  }
  return peak;
}

/** Standard deviation of the SIGMA_DAYS daily returns ending at `index`. */
function dailySigma(candles, index) {
  const rets = [];
  for (let i = index - SIGMA_DAYS + 1; i <= index; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, r) => a + (r - mean) ** 2, 0) / rets.length;
  return Math.sqrt(variance);
}

module.exports = {
  name: "Drawdown Alarm Vote 2-of-3",
  description:
    "Anti-setting-luck ensemble of the drawdown breakers: three alarms (10%, 15% and vol-scaled drop from the 30-day peak, each with a 10-day clock); hold the coin while fewer than 2 are active",

  decide({ candles, index, position }) {
    // Fresh pass detection (engine re-run on same module) -> reset all alarms.
    if (index <= lastIndexSeen) cooldowns = [0, 0, 0];
    lastIndexSeen = index;

    const close = candles[index].close;
    const peak = recentPeak(candles, index);
    const drop = (peak - close) / peak;

    // Each alarm's trip line today (alarm C needs a volatility estimate first).
    const lines = [DROPS[0], DROPS[1], index >= SIGMA_DAYS ? K * dailySigma(candles, index) * Math.sqrt(PEAK_DAYS) : Infinity];

    // Update every alarm: trip -> restart its clock; otherwise count it down.
    let active = 0;
    for (let k = 0; k < 3; k++) {
      if (drop > lines[k]) cooldowns[k] = COOLDOWN_DAYS;
      else if (cooldowns[k] > 0) cooldowns[k]--;
      if (drop > lines[k] || cooldowns[k] > 0) active++;
    }

    // Vote: leave while at least VOTES_TO_EXIT alarms are active.
    const wantCash = active >= VOTES_TO_EXIT;
    if (wantCash && position === "btc") return "sell";
    if (!wantCash && position === "cash") return "buy";
    return "hold";
  },
};
