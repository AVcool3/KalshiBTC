/**
 * Runs strategies across a set of fetched coins and prints per-coin results
 * plus universe totals: how many asset-eras each strategy beat buy & hold in,
 * and how much of buy & hold's own worst drawdown it avoided.
 *
 *   node backtest/run-universe.js --coins bch,etc,xlm strategies/a.js strategies/b.js
 *
 * Each coin needs backtest/data/<coin>-daily.json (node backtest/fetch-asset.js
 * <PRODUCT> <start-date>). Eras per coin: 2017-19, 2020-22, 2023 to 2024-11-16
 * and the last 730 days; eras with fewer than 300 candles are skipped (a coin
 * listed later has fewer eras). Same engine, fees and rules as run.js; nothing
 * is written to RESULTS.md.
 *
 * Cell format per era: return % / max drawdown %. "dd ratio" is the average of
 * (strategy max drawdown / buy & hold max drawdown) over all asset-eras:
 * below 1 means it avoided part of the market's own worst fall.
 */

const fs = require("fs");
const path = require("path");
const { runBacktest } = require("./engine");

const args = process.argv.slice(2);
const ci = args.indexOf("--coins");
if (ci < 0 || !args[ci + 1]) {
  console.error("usage: node backtest/run-universe.js --coins bch,etc strategies/<file>.js ...");
  process.exit(1);
}
const coins = args.splice(ci, 2)[1].split(",");
const files = args;

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, "data", f), "utf8"));
const between = (c, a, b) => c.filter((x) => x.date >= a && x.date <= b);
const erasOf = (coin) =>
  [
    ["2017-19", between(coin, "2017-01-01", "2019-12-31")],
    ["2020-22", between(coin, "2020-01-01", "2022-12-31")],
    ["2023-24", between(coin, "2023-01-01", "2024-11-16")],
    ["Roll", coin.slice(-730)],
  ].filter(([, c]) => c.length >= 300);

// Fresh require per run: several strategies keep module-level state.
const fresh = (f) => {
  const p = path.resolve(f);
  delete require.cache[require.resolve(p)];
  return require(p);
};

const totals = files.map(() => ({ beats: 0, n: 0, ddRatio: 0 }));
for (const name of coins) {
  const eras = erasOf(load(`${name}-daily.json`));
  const bh = eras.map(([, c]) => runBacktest(c, fresh(files[0])).buyHoldReturnPct);
  const bhDd = eras.map(([, c]) => {
    let peak = -Infinity, dd = 0;
    for (const x of c) { peak = Math.max(peak, x.close); dd = Math.max(dd, (peak - x.close) / peak); }
    return dd * 100;
  });
  console.log(
    `\n${name.toUpperCase()}  ` +
      eras.map(([n], i) => `${n} [B&H ${bh[i] >= 0 ? "+" : ""}${bh[i].toFixed(0)}% dd${bhDd[i].toFixed(0)}%]`).join("  ")
  );
  files.forEach((f, k) => {
    const rs = eras.map(([, c]) => runBacktest(c, fresh(f)));
    let beats = 0;
    rs.forEach((r, i) => {
      if (r.totalReturnPct > bh[i]) beats++;
      totals[k].n++;
      totals[k].ddRatio += r.maxDrawdownPct / bhDd[i];
    });
    totals[k].beats += beats;
    console.log(
      "  " + fresh(f).name.slice(0, 34).padEnd(36) +
        rs.map((r) => `${r.totalReturnPct >= 0 ? "+" : ""}${r.totalReturnPct.toFixed(0)}%/${r.maxDrawdownPct.toFixed(0)}`.padEnd(15)).join("") +
        `[${beats}/${eras.length}]`
    );
  });
}
console.log(`\nTOTALS over ${coins.length} coins (asset-eras beating buy & hold; average drawdown ratio):`);
files.forEach((f, k) =>
  console.log("  " + fresh(f).name.slice(0, 34).padEnd(36) + `${totals[k].beats}/${totals[k].n}`.padEnd(8) + `dd ratio ${(totals[k].ddRatio / totals[k].n).toFixed(2)}`)
);
