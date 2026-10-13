/**
 * =============================================================================
 * Circuit Breaker Hold - daily live runner
 * =============================================================================
 * Runs ONCE PER DAY (via .github/workflows/breaker-daily.yml, just after the
 * UTC daily close) and makes the champion strategy's one daily decision:
 *
 *   - Long by default: if we're in cash with no alarm active, BUY.
 *   - If yesterday's close-to-close drop was worse than -5%: SELL and start
 *     a 10-trading-day cooldown (the validated circuit breaker).
 *   - MACRO GATE ("too much going on -> don't trade"): while in cash, if the
 *     last 10 days' realized volatility is above 4%/day (~2x normal), do NOT
 *     put on a new position - wait for the chaos to pass. Backtested: inert
 *     in calm markets, mildly helpful in 2020-22 (+437% vs +397% plain,
 *     max drawdown -40% vs -46%). It never force-sells, only delays entries.
 *
 * MODES (live/state.json -> "mode"):
 *   "paper" (default): trades a fake $10,000 at real closing prices and logs
 *     every decision to live/journal.jsonl. No keys, no risk.
 *   "live": REFUSES to run. Real-order execution is deliberately not wired
 *     yet - going live requires exchange API keys (added as GitHub secrets),
 *     an executor written and tested against the real exchange, and an
 *     explicit go-ahead. The refusal is a safety stop, not a bug.
 *
 * HOW TO CHANGE THINGS:
 *   - CRASH_PCT / COOLDOWN_DAYS: the champion's validated settings
 *   - VOL_GATE / VOL_DAYS: the macro "too much going on" threshold
 *   - Everything it decides is in the journal - one JSON line per day.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");

// ---- strategy settings (the validated champion + macro gate) --------------
const CRASH_PCT = 0.05;     // sell after a close-to-close drop worse than -5%
const COOLDOWN_DAYS = 10;   // trading days to stay out after a crash
const VOL_GATE = 0.04;      // don't ENTER while 10-day daily vol exceeds 4%
const VOL_DAYS = 10;
const FEE_RATE = 0.006;     // paper trading charges the same fee as backtests

const STATE_FILE = path.join(__dirname, "state.json");
const JOURNAL_FILE = path.join(__dirname, "journal.jsonl");

// ---- data: last ~30 completed daily candles from Coinbase (public) --------
async function fetchRecentCandles() {
  const end = new Date();
  const start = new Date(end.getTime() - 35 * 86400 * 1000);
  const url =
    "https://api.exchange.coinbase.com/products/BTC-USD/candles" +
    `?granularity=86400&start=${start.toISOString()}&end=${end.toISOString()}`;
  const res = await fetch(url, { headers: { "User-Agent": "KalshiBTC-live" } });
  if (!res.ok) throw new Error(`Coinbase API HTTP ${res.status}`);
  const rows = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  return rows
    .map(([time, low, high, open, close]) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      time, open, high, low, close,
    }))
    .sort((a, b) => a.time - b.time)
    // drop today's PARTIAL candle - decisions use completed days only
    .filter(c => c.date !== today);
}

// ---- state ------------------------------------------------------------------
function loadState() {
  if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  // First run: start in paper mode, in cash, no alarms.
  return {
    mode: "paper",
    position: "cash",      // "cash" or "btc"
    cooldownLeft: 0,        // trading days left on the post-crash clock
    paperCash: 10000,       // fake dollars (paper mode)
    paperBtc: 0,            // fake bitcoin (paper mode)
    lastDecisionDate: null, // guards against double-running on the same day
  };
}
const save = s => fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2) + "\n");
const log = entry => fs.appendFileSync(JOURNAL_FILE, JSON.stringify(entry) + "\n");

// ---- the daily decision ------------------------------------------------------
async function main() {
  const state = loadState();

  // Hard safety stop: this version never touches a real account.
  if (state.mode !== "paper") {
    console.error(`mode is "${state.mode}" but live execution is not wired yet - refusing to run.`);
    process.exit(1);
  }

  const candles = await fetchRecentCandles();
  const today = candles[candles.length - 1];      // latest COMPLETED day
  const yesterday = candles[candles.length - 2];

  // Idempotence: if we already decided on this candle, do nothing.
  if (state.lastDecisionDate === today.date) {
    console.log(`already decided for ${today.date} - nothing to do`);
    return;
  }

  const dailyReturn = (today.close - yesterday.close) / yesterday.close;

  // 10-day realized volatility (stddev of daily returns) for the macro gate.
  const rets = [];
  for (let i = candles.length - VOL_DAYS; i < candles.length; i++) {
    rets.push((candles[i].close - candles[i - 1].close) / candles[i - 1].close);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);

  // ---- decide ----------------------------------------------------------------
  let action = "hold";
  let reason = "";

  if (dailyReturn < -CRASH_PCT) {
    state.cooldownLeft = COOLDOWN_DAYS;
    if (state.position === "btc") { action = "sell"; reason = `circuit breaker: ${(dailyReturn * 100).toFixed(2)}% day`; }
    else reason = `crash day while already in cash (${(dailyReturn * 100).toFixed(2)}%) - cooldown restarted`;
  } else if (state.cooldownLeft > 0) {
    state.cooldownLeft--;
    reason = `cooling down, ${state.cooldownLeft} day(s) left`;
  } else if (state.position === "cash") {
    if (vol > VOL_GATE) {
      reason = `macro gate: 10-day vol ${(vol * 100).toFixed(2)}%/day > ${(VOL_GATE * 100).toFixed(0)}% - too much going on, not entering`;
    } else {
      action = "buy";
      reason = "all clear - default state is invested";
    }
  } else {
    reason = "holding - no alarm";
  }

  // ---- execute (paper) ---------------------------------------------------------
  if (action === "buy") {
    state.paperBtc = (state.paperCash * (1 - FEE_RATE)) / today.close;
    state.paperCash = 0;
    state.position = "btc";
  } else if (action === "sell") {
    state.paperCash = state.paperBtc * today.close * (1 - FEE_RATE);
    state.paperBtc = 0;
    state.position = "cash";
  }

  const equity = state.paperCash + state.paperBtc * today.close;
  state.lastDecisionDate = today.date;
  save(state);
  log({
    date: today.date, close: today.close,
    dailyReturnPct: +(dailyReturn * 100).toFixed(2),
    vol10dPct: +(vol * 100).toFixed(2),
    action, reason,
    position: state.position, cooldownLeft: state.cooldownLeft,
    paperEquity: +equity.toFixed(2),
  });
  console.log(`${today.date}  $${today.close}  ${action.toUpperCase()}  (${reason})  paper equity: $${equity.toFixed(2)}`);
}

main().catch(err => { console.error("daily run failed:", err); process.exit(1); });
