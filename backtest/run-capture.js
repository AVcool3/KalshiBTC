/**
 * Scores strategies by UPSIDE vs DOWNSIDE capture against buy & hold, and
 * ranks them against a distribution of random-breaker controls (luck).
 *
 *   node backtest/run-capture.js --coins eth,ltc,bch strategies/a.js strategies/b.js
 *   node backtest/run-capture.js --no-btc --coins avax,dot --controls 150 strategies/a.js
 *
 * For every asset-era (BTC's five eras unless --no-btc, plus each coin's
 * 2017-19 / 2020-22 / 2023-24 / last-730-days eras that have 300+ candles):
 *   rising era (buy & hold > 0):  up   = ln(strategy wealth) / ln(buy & hold wealth)
 *   falling era (buy & hold < 0): down = ln(strategy wealth) / ln(buy & hold wealth)
 * "Up capture" is the median of `up` (1.0 = kept all of buy & hold's growth),
 * "down capture" the median of `down` (0 = lost nothing, 1 = lost as much, <0 =
 * made money while buy & hold fell). The score is UP - DOWN: higher = the rule
 * keeps more of the rises than of the falls.
 *
 * LUCK YARDSTICK: --controls N (default 100) random breakers
 * (strategies/2026-11-27-random-breaker-control.js, makeControl(seed)) at 1%, 2%
 * and 4% daily alarm odds are scored the same way. "pct" = the percentage of the
 * control scores (pooled) that a strategy's UP - DOWN beats. A score near or
 * below the 95th percentile is hard to tell from the shape of the rule alone.
 * Caution: strategies picked as the best of many should be re-scored on coins
 * that were not used to pick them (that is what --no-btc --coins <fresh> is for).
 */

const fs = require("fs");
const path = require("path");
const { runBacktest } = require("./engine");

const args = process.argv.slice(2);
const take = (flag, hasValue) => {
  const i = args.indexOf(flag);
  if (i < 0) return hasValue ? undefined : false;
  return hasValue ? args.splice(i, 2)[1] : (args.splice(i, 1), true);
};
const coins = (take("--coins", true) || "").split(",").filter(Boolean);
const useBtc = !take("--no-btc", false);
const nControls = Number(take("--controls", true) || 100);
const files = args;
if (files.length === 0) {
  console.error("usage: node backtest/run-capture.js [--no-btc] [--coins a,b] [--controls N] strategies/<file>.js ...");
  process.exit(1);
}

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", f), "utf8"));
const between = (c, a, b) => c.filter((x) => x.date >= a && x.date <= b);
const erasOf = (coin) =>
  [
    between(coin, "2017-01-01", "2019-12-31"),
    between(coin, "2020-01-01", "2022-12-31"),
    between(coin, "2023-01-01", "2024-11-16"),
    coin.slice(-730),
  ].filter((c) => c.length >= 300);

const sets = [];
if (useBtc) {
  sets.push(load("eras/btc-2015-2016.json"), load("eras/btc-2017-2019.json"), load("eras/btc-2020-2022.json"),
    load("eras/btc-2023-2024.json"), load("btc-daily.json"));
}
for (const name of coins) sets.push(...erasOf(load(`${name}-daily.json`)));

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const lnw = (pct) => Math.log(Math.max(1 + pct / 100, 0.001)); // guard against total wipe-outs

function score(makeStrategy) {
  const up = [], down = [];
  for (const c of sets) {
    const r = runBacktest(c, makeStrategy());
    const b = r.buyHoldReturnPct;
    const ratio = lnw(r.totalReturnPct) / lnw(b);
    if (b > 0) up.push(ratio); else if (b < 0) down.push(ratio);
  }
  return { up: median(up), down: median(down), nUp: up.length, nDown: down.length };
}

// ---- controls (pooled across 1%, 2% and 4% alarm odds) ----
const controlModule = require(path.resolve(__dirname, "..", "strategies", "2026-11-27-random-breaker-control.js"));
const controlDiffs = [];
for (const p of [0.01, 0.02, 0.04]) {
  for (let s = 1; s <= nControls; s++) {
    const r = score(() => controlModule.makeControl(s * 7919, p));
    controlDiffs.push(r.up - r.down);
  }
}
controlDiffs.sort((a, b) => a - b);
const q = (f) => controlDiffs[Math.floor(f * (controlDiffs.length - 1))];

// ---- strategies ----
const rows = files.map((f) => {
  const p = path.resolve(f);
  const make = () => { delete require.cache[require.resolve(p)]; return require(p); };
  const r = score(make);
  const diff = r.up - r.down;
  const beaten = controlDiffs.filter((d) => d < diff).length;
  return { name: make().name, ...r, diff, pct: (100 * beaten) / controlDiffs.length };
});
rows.sort((a, b) => b.diff - a.diff);

console.log(`asset-eras: ${sets.length} (${rows[0].nUp} rising, ${rows[0].nDown} falling); controls: ${controlDiffs.length} random breakers`);
console.log(`control UP-DOWN: median ${q(0.5).toFixed(2)}, 90th ${q(0.9).toFixed(2)}, 95th ${q(0.95).toFixed(2)}, 99th ${q(0.99).toFixed(2)}, max ${q(1).toFixed(2)}`);
console.log("strategy".padEnd(48) + "up capture".padEnd(12) + "down capture".padEnd(14) + "UP-DOWN".padEnd(9) + "pct of controls beaten");
for (const r of rows) {
  console.log(
    r.name.slice(0, 46).padEnd(48) + r.up.toFixed(2).padEnd(12) + r.down.toFixed(2).padEnd(14) + r.diff.toFixed(2).padEnd(9) + r.pct.toFixed(1) + "%"
  );
}
