/**
 * Runs one or more strategies across the lab's fixed historical eras and
 * prints a comparison table (the "five-era" tables quoted in commit messages).
 *
 *   node backtest/run-eras.js strategies/a.js strategies/b.js            # BTC, 5 eras
 *   node backtest/run-eras.js --asset eth strategies/a.js                # ETH, up to 4 eras
 *   node backtest/run-eras.js --asset ltc strategies/a.js                # any fetched coin
 *
 * Needs backtest/data/eras/*.json (node backtest/fetch-eras.js) and the rolling
 * backtest/data/btc-daily.json; for another coin, backtest/data/<asset>-daily.json
 * (node backtest/fetch-asset.js <PRODUCT> <start-date>). Eras with fewer than
 * 300 candles for that coin are skipped. Same engine, fees and rules as run.js;
 * nothing is written to RESULTS.md.
 *
 * Cell format: return / max drawdown (round-trips). The header row shows buy &
 * hold's return per era, and the bottom row buy & hold's own worst drawdown.
 */

const fs = require("fs");
const path = require("path");
const { runBacktest } = require("./engine");

const DATA = path.join(__dirname, "data");
const load = (file) => JSON.parse(fs.readFileSync(path.join(DATA, file), "utf8"));
const between = (candles, from, to) => candles.filter((c) => c.date >= from && c.date <= to);

const args = process.argv.slice(2);
const assetIdx = args.indexOf("--asset");
const asset = assetIdx >= 0 ? args.splice(assetIdx, 2)[1] : "btc";
const files = args;
if (files.length === 0) {
  console.error("usage: node backtest/run-eras.js [--asset btc|eth] strategies/<file>.js ...");
  process.exit(1);
}

let eras;
if (asset === "btc") {
  eras = [
    ["2015-16", load("eras/btc-2015-2016.json")],
    ["2017-19", load("eras/btc-2017-2019.json")],
    ["2020-22", load("eras/btc-2020-2022.json")],
    ["2023-24", load("eras/btc-2023-2024.json")],
    ["Rolling 2y", load("btc-daily.json")],
  ];
} else {
  const file = path.join(DATA, `${asset}-daily.json`);
  if (!fs.existsSync(file)) {
    console.error(`missing ${file}; run: node backtest/fetch-asset.js <PRODUCT> <start-date>`);
    process.exit(1);
  }
  const coin = load(`${asset}-daily.json`);
  eras = [
    ["2015-16", between(coin, "2015-01-01", "2016-12-31")],
    ["2017-19", between(coin, "2017-01-01", "2019-12-31")],
    ["2020-22", between(coin, "2020-01-01", "2022-12-31")],
    ["2023-24", between(coin, "2023-01-01", "2024-11-16")],
    ["Rolling 2y", coin.slice(-730)],
  ].filter(([, c]) => c.length >= 300);
}

// Fresh require per run: several strategies keep module-level state.
const fresh = (file) => {
  const p = path.resolve(file);
  delete require.cache[require.resolve(p)];
  return require(p);
};

const pct = (x) => `${x >= 0 ? "+" : ""}${x.toFixed(0)}%`;
const bh = eras.map(([, c]) => runBacktest(c, fresh(files[0])).buyHoldReturnPct);
const bhDd = eras.map(([, c]) => {
  let peak = -Infinity, dd = 0;
  for (const x of c) { peak = Math.max(peak, x.close); dd = Math.max(dd, (peak - x.close) / peak); }
  return dd * 100;
});

const W = 22;
console.log(`asset: ${asset.toUpperCase()}`);
console.log("strategy".padEnd(46) + eras.map(([n], i) => `${n} [${pct(bh[i])}]`.padEnd(W)).join("") + "beats B&H");
for (const f of files) {
  const rs = eras.map(([, c]) => runBacktest(c, fresh(f)));
  const beats = rs.filter((r, i) => r.totalReturnPct > bh[i]).length;
  const name = fresh(f).name;
  console.log(
    name.slice(0, 44).padEnd(46) +
      rs.map((r) => `${pct(r.totalReturnPct)}/${r.maxDrawdownPct.toFixed(0)}% (${r.numTrades})`.padEnd(W)).join("") +
      `${beats}/${eras.length}`
  );
}
console.log("buy & hold worst drawdown".padEnd(46) + bhDd.map((d) => `${d.toFixed(0)}%`.padEnd(W)).join(""));
