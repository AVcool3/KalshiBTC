/**
 * =============================================================================
 * Historical BTC Data Fetcher
 * =============================================================================
 * Downloads ~2 years of DAILY BTC-USD candles from Coinbase's public exchange
 * API (no API key needed) and caches them to backtest/data/btc-daily.json.
 *
 * Every backtest runs against this same cached file, so all strategies are
 * compared fairly on identical data.
 *
 * HOW TO CHANGE THINGS:
 *   - More/less history  -> change DAYS_OF_HISTORY below
 *   - Different coin     -> change PRODUCT (e.g. "ETH-USD")
 *   - Different timeframe-> change GRANULARITY (in seconds: 3600 = hourly,
 *                           86400 = daily). Note: hourly data over 2 years is
 *                           a LOT of requests; keep DAYS_OF_HISTORY small.
 *
 * Run it directly with:  node backtest/fetch-data.js
 * (backtest/run.js also calls this automatically when the cache is stale)
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PRODUCT = "BTC-USD";        // trading pair to download
const GRANULARITY = 86400;        // candle size in seconds (86400 = 1 day)
const DAYS_OF_HISTORY = 730;      // how far back to fetch (~2 years)

// Where the candle cache lives (relative to this file).
const DATA_FILE = path.join(__dirname, "data", "btc-daily.json");

// Coinbase returns at most 300 candles per request, so we page through
// history in chunks of this size.
const CANDLES_PER_REQUEST = 300;

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

/**
 * Fetches one "page" of candles between two dates.
 * Coinbase's response is an array of rows, NEWEST first, each row being:
 *   [ time(unix seconds), low, high, open, close, volume ]
 */
async function fetchChunk(startDate, endDate) {
  const url =
    `https://api.exchange.coinbase.com/products/${PRODUCT}/candles` +
    `?granularity=${GRANULARITY}` +
    `&start=${startDate.toISOString()}` +
    `&end=${endDate.toISOString()}`;

  const response = await fetch(url, {
    // Coinbase asks for a User-Agent on this public endpoint.
    headers: { "User-Agent": "KalshiBTC-backtester" },
  });

  if (!response.ok) {
    throw new Error(`Coinbase API returned HTTP ${response.status} for ${url}`);
  }

  return response.json();
}

/**
 * Downloads DAYS_OF_HISTORY worth of candles by walking backwards in time,
 * one 300-candle chunk at a time, then returns them sorted OLDEST first
 * (which is the order the backtest engine expects).
 */
async function fetchAllCandles() {
  const now = new Date();
  const chunkMs = CANDLES_PER_REQUEST * GRANULARITY * 1000; // ms per chunk
  const oldestWanted = new Date(now.getTime() - DAYS_OF_HISTORY * 86400 * 1000);

  const rows = [];
  let end = now;

  while (end > oldestWanted) {
    const start = new Date(Math.max(end.getTime() - chunkMs, oldestWanted.getTime()));
    console.log(`  fetching ${start.toISOString().slice(0, 10)} -> ${end.toISOString().slice(0, 10)}`);
    rows.push(...(await fetchChunk(start, end)));
    end = start;
  }

  // Convert raw rows into labeled objects and sort oldest -> newest.
  const candles = rows
    .map(([time, low, high, open, close, volume]) => ({
      date: new Date(time * 1000).toISOString().slice(0, 10), // "YYYY-MM-DD"
      time,   // unix seconds — handy for math
      open,
      high,
      low,
      close,
      volume,
    }))
    .sort((a, b) => a.time - b.time);

  // De-duplicate in case chunk boundaries overlap (keep first occurrence).
  const seen = new Set();
  return candles.filter((c) => (seen.has(c.time) ? false : seen.add(c.time)));
}

// ---------------------------------------------------------------------------
// Public API (used by run.js) + CLI entry point
// ---------------------------------------------------------------------------

/** Fetches fresh data and writes the cache file. Returns the candles. */
async function refreshData() {
  console.log(`Downloading ${DAYS_OF_HISTORY} days of ${PRODUCT} daily candles...`);
  const candles = await fetchAllCandles();
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(candles, null, 2) + "\n", "utf8");
  console.log(`Saved ${candles.length} candles to ${DATA_FILE}`);
  return candles;
}

/**
 * Returns cached candles, refreshing first if the cache is missing or older
 * than maxAgeHours (default 20h, so a daily run always gets fresh data).
 */
async function loadData(maxAgeHours = 20) {
  if (fs.existsSync(DATA_FILE)) {
    const ageHours = (Date.now() - fs.statSync(DATA_FILE).mtimeMs) / 3600000;
    if (ageHours < maxAgeHours) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    }
  }
  return refreshData();
}

module.exports = { loadData, refreshData, DATA_FILE };

// If executed directly (node backtest/fetch-data.js), just refresh the cache.
if (require.main === module) {
  refreshData().catch((err) => {
    console.error("Data fetch failed:", err);
    process.exit(1);
  });
}
