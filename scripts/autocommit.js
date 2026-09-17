/**
 * =============================================================================
 * Auto-Commit Data Script
 * =============================================================================
 * This is the script the GitHub Action (.github/workflows/autocommit.yml)
 * runs on every scheduled tick. Its ONLY job is to change a file in the repo;
 * the workflow then commits + pushes whatever changed.
 *
 * Right now it:
 *   1. Fetches the current Bitcoin spot price from Coinbase's public API
 *      (no API key needed)
 *   2. Appends a { timestamp, price } entry to data/btc-price-log.json
 *
 * HOW TO CHANGE THINGS:
 *   - Want a different data source? Edit fetchBtcPrice() below.
 *   - Want to log more fields (volume, other coins, Kalshi market data)?
 *     Add them to the `entry` object in main().
 *   - Want the file somewhere else? Change LOG_FILE.
 *   - Want to cap the file size? Change MAX_ENTRIES.
 *
 * You can also test it locally with:  node scripts/autocommit.js
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration — tweak these values to change behavior
// ---------------------------------------------------------------------------

// Where the price history gets stored (relative to the repo root).
const LOG_FILE = path.join(__dirname, "..", "data", "btc-price-log.json");

// Keep only the most recent N entries so the file doesn't grow forever.
// At 1 entry/hour, 8760 = roughly one year of history.
const MAX_ENTRIES = 8760;

// Public, key-free endpoint for the current BTC-USD spot price.
const PRICE_API_URL = "https://api.coinbase.com/v2/prices/BTC-USD/spot";

// ---------------------------------------------------------------------------
// Fetch the current BTC price
// ---------------------------------------------------------------------------

/**
 * Hits the Coinbase public API and returns the current BTC price in USD
 * as a number. Throws if the request fails so the workflow run shows red
 * instead of silently committing bad data.
 */
async function fetchBtcPrice() {
  const response = await fetch(PRICE_API_URL);

  if (!response.ok) {
    throw new Error(`Price API returned HTTP ${response.status}`);
  }

  const json = await response.json();

  // Coinbase's response shape is: { data: { amount: "63241.55", ... } }
  const price = parseFloat(json.data.amount);

  if (Number.isNaN(price)) {
    throw new Error(`Could not parse price from API response: ${JSON.stringify(json)}`);
  }

  return price;
}

// ---------------------------------------------------------------------------
// Read / write the JSON log file
// ---------------------------------------------------------------------------

/**
 * Loads the existing log file, or returns an empty array if it doesn't
 * exist yet (e.g. the very first run).
 */
function loadLog() {
  if (!fs.existsSync(LOG_FILE)) {
    return [];
  }
  const raw = fs.readFileSync(LOG_FILE, "utf8");
  return JSON.parse(raw);
}

/**
 * Writes the log back to disk, pretty-printed with 2-space indentation so
 * it's easy to read directly on GitHub.
 */
function saveLog(entries) {
  // Make sure the data/ directory exists before writing into it.
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2) + "\n", "utf8");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Fetching current BTC price...");
  const price = await fetchBtcPrice();
  console.log(`Current BTC price: $${price}`);

  // Each log entry — add extra fields here if you want to track more data.
  const entry = {
    timestamp: new Date().toISOString(), // when the price was captured (UTC)
    priceUsd: price,                     // BTC-USD spot price
  };

  const log = loadLog();
  log.push(entry);

  // Trim the oldest entries once we exceed the cap, keeping the newest ones.
  const trimmed = log.slice(-MAX_ENTRIES);

  saveLog(trimmed);
  console.log(`Wrote ${trimmed.length} entries to ${LOG_FILE}`);
}

// Run main() and make sure any error fails the process (exit code 1),
// which in turn makes the GitHub Action run show as failed.
main().catch((err) => {
  console.error("Auto-commit script failed:", err);
  process.exit(1);
});
