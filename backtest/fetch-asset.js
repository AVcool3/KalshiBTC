/**
 * Fetches the full daily-candle history (complete UTC days) of a Coinbase
 * Exchange product and saves it to backtest/data/<asset>-daily.json. Used for
 * out-of-sample checks of strategies on a different asset.
 *
 *   node backtest/fetch-asset.js                      # ETH-USD from 2016-05-18 (default)
 *   node backtest/fetch-asset.js LTC-USD 2016-08-17   # any product, any start date
 *
 * Same candle shape as btc-daily.json: { date, time, open, high, low, close, volume }.
 * Pick a start date on or after the product's listing; earlier chunks come back empty.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const PRODUCT = process.argv[2] || "ETH-USD";
const START = new Date((process.argv[3] || "2016-05-18") + "T00:00:00Z");
const OUT = path.join(__dirname, "data", `${PRODUCT.split("-")[0].toLowerCase()}-daily.json`);

function getChunk(start, end) {
  const url =
    `https://api.exchange.coinbase.com/products/${PRODUCT}/candles?granularity=86400` +
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
  console.log(`${PRODUCT}: ${candles.length} candles ${candles[0].date} -> ${candles[candles.length - 1].date}, gaps: ${gaps}`);
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
