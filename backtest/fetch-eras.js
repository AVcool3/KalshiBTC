/**
 * Fetches the three historical BTC-USD daily-candle windows used for the
 * lab's "four-era" robustness checks (the fourth era is the rolling
 * 2-year window in btc-daily.json) and saves them under backtest/data/eras/.
 *
 *   node backtest/fetch-eras.js
 *
 * Source: Coinbase Exchange public candles API (same as fetch-data.js).
 * Same candle shape as btc-daily.json: { date, time, open, high, low, close, volume }.
 * Fixed windows, so the files never change once fetched.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ERAS = [
  { name: "2015-2016", start: "2015-01-01", end: "2016-12-31" }, // data begins 2015-07-20
  { name: "2017-2019", start: "2017-01-01", end: "2019-12-31" },
  { name: "2020-2022", start: "2020-01-01", end: "2022-12-31" },
];

const OUT_DIR = path.join(__dirname, "data", "eras");

function getChunk(start, end) {
  const url =
    "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400" +
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

async function fetchEra({ start, end }) {
  const startDate = new Date(start + "T00:00:00Z");
  let cursor = new Date(end + "T00:00:00Z");
  const rows = [];
  // The API returns at most 300 daily candles per request: walk backwards.
  while (cursor > startDate) {
    const chunkStart = new Date(Math.max(startDate.getTime(), cursor.getTime() - 300 * 86400e3));
    rows.push(...(await getChunk(chunkStart, cursor)));
    cursor = chunkStart;
    await new Promise((r) => setTimeout(r, 400)); // stay polite with the API
  }
  const seen = new Set();
  return rows
    .filter(([t]) => !seen.has(t) && seen.add(t))
    .sort((a, b) => a[0] - b[0]) // oldest first, as the engine expects
    .map(([time, low, high, open, close, volume]) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10),
      time,
      open,
      high,
      low,
      close,
      volume,
    }));
}

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const era of ERAS) {
    const candles = await fetchEra(era);
    const file = path.join(OUT_DIR, `btc-${era.name}.json`);
    fs.writeFileSync(file, JSON.stringify(candles));
    console.log(`${era.name}: ${candles.length} candles ${candles[0].date} -> ${candles[candles.length - 1].date}`);
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
