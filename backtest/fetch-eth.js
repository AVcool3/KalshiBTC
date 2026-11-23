/**
 * Fetches the full ETH-USD daily-candle history (complete UTC days) from the
 * Coinbase Exchange public API and saves it to backtest/data/eth-daily.json.
 * Used for out-of-sample checks of strategies on a different asset.
 *
 *   node backtest/fetch-eth.js
 *
 * Same candle shape as btc-daily.json: { date, time, open, high, low, close, volume }.
 * ETH-USD data on Coinbase begins in May 2016.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const START = new Date("2016-05-18T00:00:00Z");
const OUT = path.join(__dirname, "data", "eth-daily.json");

function getChunk(start, end) {
  const url =
    "https://api.exchange.coinbase.com/products/ETH-USD/candles?granularity=86400" +
    `&start=${start.toISOString()}&end=${end.toISOString()}`;
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "kalshibtc-backtest" } }, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () =>
          res.statusCode === 200
            ? resolve(JSON.parse(body))
            : reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 150)}`))
        );
      })
      .on("error", reject);
  });
}

(async () => {
  // End at 00:00 UTC today so the still-forming day is excluded.
  const now = new Date();
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let cursor = new Date(end);
  const rows = [];
  // At most 300 daily candles per request: walk backwards.
  while (cursor > START) {
    const chunkStart = new Date(Math.max(START.getTime(), cursor.getTime() - 300 * 86400e3));
    rows.push(...(await getChunk(chunkStart, cursor)));
    cursor = chunkStart;
    await new Promise((r) => setTimeout(r, 400)); // stay polite with the API
  }
  const seen = new Set();
  const candles = rows
    .filter(([t]) => !seen.has(t) && seen.add(t))
    .sort((a, b) => a[0] - b[0]) // oldest first, as the engine expects
    .filter(([t]) => t * 1000 < end.getTime())
    .map(([time, low, high, open, close, volume]) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      time,
      open,
      high,
      low,
      close,
      volume,
    }));
  fs.writeFileSync(OUT, JSON.stringify(candles));
  let gaps = 0;
  for (let i = 1; i < candles.length; i++) if (candles[i].time - candles[i - 1].time !== 86400) gaps++;
  console.log(`ETH-USD: ${candles.length} candles ${candles[0].date} -> ${candles[candles.length - 1].date}, gaps: ${gaps}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
