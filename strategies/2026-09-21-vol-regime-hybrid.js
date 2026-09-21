/**
 * =============================================================================
 * Strategy: Volatility Regime Hybrid                    — tried on 2026-09-21
 * =============================================================================
 * THE IDEA (learning from the first four strategies on the scoreboard):
 *   Different tools work in different markets, so first DETECT the market
 *   type, then apply the tool that historically fits it:
 *
 *   1. Measure the market's "mood" = 30-day realized volatility (how big
 *      the average daily swing has been), compared to its own 100-day
 *      average. Below average = QUIET market, above = LOUD market.
 *
 *   2. QUIET regime -> markets tend to chop sideways. Mean reversion wins
 *      here (our RSI strategy had an 81% win rate!). So: buy dips
 *      (RSI < 35), take profits on recovery (RSI > 60). Dips in quiet
 *      markets are shallow — that's when knife-catching is safest.
 *
 *   3. LOUD regime -> big moves happen. Momentum wins here (our Donchian
 *      Breakout is the only strategy that beat buy & hold). So: buy a
 *      close above the prior 20-day high, and DON'T buy dips — in a loud
 *      market a dip can be the start of a crash (RSI's fatal flaw).
 *
 *   4. Each regime gets an exit that fits it. The loud regime keeps
 *      Donchian's fast 10-day-low exit. The quiet regime sells on RSI
 *      recovery, with a WIDER 20-day-low disaster stop — because a dip we
 *      just bought is usually already near a 10-day low, and a tight stop
 *      there just sells the dip right back at a loss.
 *
 * LESSONS FROM EARLIER VERSIONS OF THIS FILE (kept so we don't repeat them):
 *   v1 (-20.15%): used the 10-day-low exit in BOTH regimes — every dip-buy
 *      was instantly stopped out by the very dip it bought. Rule: an entry
 *      and an exit must not trigger on the same market condition.
 *   v2 (-22.90%): gave the quiet regime a wider stop, but judged exits by
 *      the CURRENT regime — and buying a dip raises measured volatility,
 *      flipping the regime to "loud" and re-arming the tight stop anyway.
 *      Rule: a trade should live and die by the rules of the regime that
 *      OPENED it, so v3 remembers the entry regime until the position closes.
 *   v3 (-18.16%): the trade log showed ALL winners were breakout rides and
 *      the losses were chains of 1-2 day dip-buys during steady downtrends
 *      (buy the dip, new low next day, stopped, repeat — Feb 2025, May-Jun
 *      2026). Rule: only buy dips when the LARGER trend is up, so v4 adds a
 *      100-day moving-average filter to the quiet-regime entry.
 *
 * WHY IT MIGHT WORK: it uses each tool only in the conditions where our own
 * scoreboard showed that tool winning, instead of one tool everywhere.
 * WHY IT MIGHT FAIL: regime detection lags (vol is measured over 30 days,
 * so it notices a regime change late), and more rules = more ways to be
 * wrong = more risk of fitting the past instead of the future.
 *
 * HOW TO CHANGE THINGS: tweak the constants below and re-run:
 *   node backtest/run.js strategies/2026-09-21-vol-regime-hybrid.js
 *   - VOL_DAYS / VOL_BASELINE_DAYS control how "quiet vs loud" is judged
 *   - RSI_BUY / RSI_SELL are the quiet-regime dip/recovery levels
 *   - ENTRY_DAYS / EXIT_DAYS are the loud-regime breakout windows
 * =============================================================================
 */

// --- Regime detection ---
const VOL_DAYS = 30;           // window for "current" volatility
const VOL_BASELINE_DAYS = 100; // window for "normal" volatility

// --- Quiet-regime (mean reversion) settings ---
const RSI_PERIOD = 14;
const RSI_BUY = 35;   // buy dips below this in quiet markets
const RSI_SELL = 60;  // take profit above this in quiet markets

// --- Loud-regime (breakout) settings ---
const ENTRY_DAYS = 20;    // buy a close above the prior 20-day high
const EXIT_DAYS = 10;     // loud-regime exit: sell below prior 10-day low

// --- Quiet-regime trend filter (the v3 lesson) ---
// Dips are only bought while price sits ABOVE its 100-day average, i.e. the
// long-term trend is still up. A "dip" below that average is treated as a
// falling market, not a bargain.
const TREND_DAYS = 100;

// --- Quiet-regime disaster stop ---
// Wider than the loud exit ON PURPOSE: we BUY dips in quiet mode, so price
// is already near a 10-day low at entry — a 10-day stop would fire on the
// entry candle itself. 20 days = "this dip became a real breakdown".
const DISASTER_DAYS = 20;

/** Std-dev of daily % returns over `days` candles ending at `index`. */
function realizedVol(candles, index, days) {
  if (index < days) return null;
  const rets = [];
  for (let i = index - days + 1; i <= index; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  return Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
}

/** Classic Wilder RSI (same as the 2026-09-19 strategy). */
function rsi(candles, index, period) {
  if (index < period) return null;
  let gains = 0, losses = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change > 0) gains += change;
    else losses -= change;
  }
  if (losses === 0) return 100;
  return 100 - 100 / (1 + gains / losses);
}

/** Highest close of the `days` candles BEFORE `index` (today excluded). */
function highestClose(candles, index, days) {
  if (index < days) return null;
  let h = -Infinity;
  for (let i = index - days; i < index; i++) h = Math.max(h, candles[i].close);
  return h;
}

/** Lowest close of the `days` candles BEFORE `index` (today excluded). */
function lowestClose(candles, index, days) {
  if (index < days) return null;
  let l = Infinity;
  for (let i = index - days; i < index; i++) l = Math.min(l, candles[i].close);
  return l;
}

// Remembers which regime opened the current position ("quiet" or "loud"),
// so the trade keeps its own exit rules even if the market's regime flips
// while we hold. Reset to null whenever we sell. (Module-level state is fine
// here: the engine runs one strategy over one pass of the data.)
let entryRegime = null;

module.exports = {
  name: "Vol Regime Hybrid",
  description:
    "Regime switcher: quiet market -> buy RSI dips, wide stop; loud market -> Donchian breakouts, fast stop; trades keep their entry regime's rules",

  decide({ candles, index, position }) {
    // Need enough history for the slowest indicator (the vol baseline+window).
    if (index < VOL_BASELINE_DAYS + VOL_DAYS) return "hold";

    const today = candles[index].close;

    // ---- Which regime are we in? -----------------------------------------
    // Current 30-day vol vs the average 30-day vol over the last 100 days.
    // (Averaging the vol at each of the last VOL_BASELINE_DAYS days.)
    const currentVol = realizedVol(candles, index, VOL_DAYS);
    let baselineSum = 0;
    for (let i = index - VOL_BASELINE_DAYS + 1; i <= index; i++) {
      baselineSum += realizedVol(candles, i, VOL_DAYS);
    }
    const baselineVol = baselineSum / VOL_BASELINE_DAYS;
    const isQuiet = currentVol < baselineVol;

    // ---- ENTRIES: decided by the market's CURRENT regime -----------------
    if (position === "cash") {
      if (isQuiet) {
        // QUIET: mean reversion (the RSI lesson: it wins in chop) — but only
        // dips in an UPTREND (the v3 lesson: falling-market dips keep falling).
        let smaSum = 0;
        for (let i = index - TREND_DAYS + 1; i <= index; i++) {
          smaSum += candles[i].close;
        }
        const uptrend = today > smaSum / TREND_DAYS;
        const r = rsi(candles, index, RSI_PERIOD);
        if (uptrend && r < RSI_BUY) {
          entryRegime = "quiet";
          return "buy"; // shallow dip in a calm, rising market
        }
      } else {
        // LOUD: momentum (the Donchian lesson: buy strength, never dips).
        const entryLevel = highestClose(candles, index, ENTRY_DAYS);
        if (today > entryLevel) {
          entryRegime = "loud";
          return "buy"; // fresh 20-day high with volatility behind it
        }
      }
      return "hold";
    }

    // ---- EXITS: decided by the regime that OPENED the trade --------------
    // (see LESSONS above: judging exits by the current regime re-armed the
    // tight stop right after every dip-buy, because dips spike volatility)
    if (entryRegime === "quiet") {
      // Dip trade: sell into the recovery, or bail on a real breakdown.
      const r = rsi(candles, index, RSI_PERIOD);
      const disasterLevel = lowestClose(candles, index, DISASTER_DAYS);
      if (r > RSI_SELL || today < disasterLevel) {
        entryRegime = null;
        return "sell";
      }
    } else {
      // Breakout trade: ride the trend, exit fast when it breaks (10-day low).
      const exitLevel = lowestClose(candles, index, EXIT_DAYS);
      if (today < exitLevel) {
        entryRegime = null;
        return "sell";
      }
    }

    return "hold";
  },
};
