/**
 * =============================================================================
 * Backtest Runner (the command you actually run)
 * =============================================================================
 * Usage:
 *   node backtest/run.js strategies/2026-09-17-sma-crossover.js
 *
 * What it does:
 *   1. Loads the historical BTC candles (auto-downloads if cache is stale)
 *   2. Runs the given strategy file through the engine
 *   3. Prints a readable report to the terminal
 *   4. Appends one summary row to RESULTS.md (the strategy scoreboard)
 *
 * HOW TO CHANGE THINGS:
 *   - Report columns / RESULTS.md format -> edit resultsRow() below
 *   - Skip writing to RESULTS.md         -> run with --no-log flag
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");
const { loadData } = require("./fetch-data");
const { runBacktest } = require("./engine");

const RESULTS_FILE = path.join(__dirname, "..", "RESULTS.md");

/** Formats a number like "+12.34%" / "-5.67%" for the report. */
function pct(n) {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

/** Builds the markdown table row that gets appended to RESULTS.md. */
function resultsRow(strategyFile, strategy, stats) {
  const today = new Date().toISOString().slice(0, 10);
  // Link the strategy name to its source file so it's clickable on GitHub.
  const link = `[${strategy.name}](${strategyFile.replace(/\\/g, "/")})`;
  return (
    `| ${today} | ${link} | ${pct(stats.totalReturnPct)} | ` +
    `${pct(stats.buyHoldReturnPct)} | ${stats.numTrades} | ` +
    `${stats.winRatePct.toFixed(0)}% | ${pct(-stats.maxDrawdownPct)} | ` +
    `${strategy.description} |`
  );
}

async function main() {
  // ---- Parse command line arguments --------------------------------------
  const args = process.argv.slice(2).filter((a) => a !== "--no-log");
  const skipLog = process.argv.includes("--no-log");

  if (args.length !== 1) {
    console.error("Usage: node backtest/run.js <strategy-file> [--no-log]");
    process.exit(1);
  }

  // Resolve the strategy path relative to where the command was run.
  const strategyFile = args[0];
  const strategy = require(path.resolve(strategyFile));

  // ---- Load data and run the backtest ------------------------------------
  const candles = await loadData();
  const stats = runBacktest(candles, strategy);

  // ---- Print a human-readable report -------------------------------------
  console.log("");
  console.log("=".repeat(60));
  console.log(`  Strategy:   ${strategy.name}`);
  console.log(`  About:      ${strategy.description}`);
  console.log(`  Period:     ${stats.startDate} -> ${stats.endDate}`);
  console.log("-".repeat(60));
  console.log(`  Final value:     $${stats.finalEquity.toFixed(2)}  (from $${stats.startingCash})`);
  console.log(`  Strategy return: ${pct(stats.totalReturnPct)}`);
  console.log(`  Buy & hold:      ${pct(stats.buyHoldReturnPct)}   <- benchmark to beat`);
  console.log(`  Trades:          ${stats.numTrades} round-trips, ${stats.winRatePct.toFixed(0)}% winners`);
  console.log(`  Max drawdown:    ${pct(-stats.maxDrawdownPct)}  (worst peak-to-trough drop)`);
  console.log(`  Ended holding:   ${stats.endedInPosition}`);
  console.log("=".repeat(60));

  const beat = stats.totalReturnPct > stats.buyHoldReturnPct;
  console.log(beat ? "  ✅ BEAT buy & hold" : "  ❌ Did NOT beat buy & hold");
  console.log("");

  // ---- Append the summary row to RESULTS.md -------------------------------
  if (!skipLog) {
    fs.appendFileSync(RESULTS_FILE, resultsRow(strategyFile, strategy, stats) + "\n");
    console.log(`Appended result row to ${RESULTS_FILE}`);
  }
}

main().catch((err) => {
  console.error("Backtest failed:", err);
  process.exit(1);
});
