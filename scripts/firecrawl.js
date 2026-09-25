/**
 * =============================================================================
 * Firecrawl helper — web search + page scraping from plain Node
 * =============================================================================
 * Firecrawl (https://firecrawl.dev) turns any web page into clean markdown and
 * can run web searches. This file is a tiny wrapper around its REST API so the
 * rest of the repo (strategies, the auto-committer, one-off experiments) can
 * pull in news / sentiment / on-chain articles without extra npm packages.
 *
 * It uses Node 18+'s built-in `fetch`, so there is nothing to install.
 *
 * WHERE THE API KEY COMES FROM (checked in this order):
 *   1. process.env.FIRECRAWL_API_KEY   (shell export, GitHub Actions secret,
 *                                       or the cloud environment settings)
 *   2. a `.env` file in the repo root  (copy .env.example -> .env)
 *
 * QUICK TRY FROM THE TERMINAL:
 *   node scripts/firecrawl.js search "bitcoin ETF inflows"
 *   node scripts/firecrawl.js scrape https://www.coindesk.com/price/bitcoin
 *
 * USE FROM ANOTHER FILE:
 *   const { search, scrape } = require("./scripts/firecrawl");
 *   const hits = await search("bitcoin news", { limit: 5 });
 *   const page = await scrape(hits[0].url);
 *
 * HOW TO CHANGE THINGS:
 *   - Different Firecrawl endpoint/version? Edit API_BASE.
 *   - Want HTML instead of markdown from scrape()? Change DEFAULT_FORMATS.
 *   - Want to add crawl / map / extract endpoints? Copy the pattern in
 *     callFirecrawl() — every endpoint is "POST <API_BASE>/<name>" with JSON.
 * =============================================================================
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Configuration — tweak these values to change behavior
// ---------------------------------------------------------------------------

// Base URL for the Firecrawl REST API (v2 is current as of Sept 2026).
const API_BASE = "https://api.firecrawl.dev/v2";

// What scrape() asks Firecrawl to return. "markdown" is the most useful for
// feeding into an LLM or a sentiment strategy; other options: "html",
// "rawHtml", "links", "screenshot".
const DEFAULT_FORMATS = ["markdown"];

// How many results search() returns when the caller doesn't say.
const DEFAULT_SEARCH_LIMIT = 5;

// ---------------------------------------------------------------------------
// API key lookup
// ---------------------------------------------------------------------------

/**
 * Reads FIRECRAWL_API_KEY from the environment, falling back to a `.env` file
 * in the repo root. We parse .env by hand (KEY=value lines) so there's no
 * dependency on the `dotenv` package.
 */
function getApiKey() {
  if (process.env.FIRECRAWL_API_KEY) return process.env.FIRECRAWL_API_KEY;

  const envPath = path.join(__dirname, "..", ".env");
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
      const match = line.match(/^\s*FIRECRAWL_API_KEY\s*=\s*(.+?)\s*$/);
      if (match) return match[1].replace(/^["']|["']$/g, ""); // strip quotes
    }
  }

  throw new Error(
    "FIRECRAWL_API_KEY is not set. Export it in your shell, or copy " +
      ".env.example to .env and fill it in."
  );
}

// ---------------------------------------------------------------------------
// Core request helper — every public function below goes through this
// ---------------------------------------------------------------------------

/**
 * POSTs `body` as JSON to `${API_BASE}/${endpoint}` with the bearer token and
 * returns the parsed response. Throws with a readable message on any failure
 * so callers don't have to inspect HTTP codes themselves.
 */
async function callFirecrawl(endpoint, body) {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(
      `Firecrawl /${endpoint} failed (HTTP ${res.status}): ` +
        (json.error || JSON.stringify(json))
    );
  }
  return json;
}

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/**
 * Web search. Returns an array of { url, title, description }.
 *
 * @param {string} query   - e.g. "bitcoin halving 2028"
 * @param {object} [opts]
 * @param {number} [opts.limit]  - max results (default DEFAULT_SEARCH_LIMIT)
 * @param {string} [opts.tbs]    - time filter like "qdr:d" (past day),
 *                                 "qdr:w" (past week), "qdr:m" (past month)
 */
async function search(query, opts = {}) {
  const json = await callFirecrawl("search", {
    query,
    limit: opts.limit ?? DEFAULT_SEARCH_LIMIT,
    ...(opts.tbs ? { tbs: opts.tbs } : {}),
  });
  // v2 nests results under data.web (there can also be data.news / data.images).
  return (json.data && json.data.web) || [];
}

/**
 * Scrape one page. Returns { markdown, metadata } (plus any other formats
 * you asked for in `opts.formats`).
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string[]} [opts.formats]  - default DEFAULT_FORMATS
 * @param {boolean}  [opts.onlyMainContent] - strip nav/footer (default true)
 */
async function scrape(url, opts = {}) {
  const json = await callFirecrawl("scrape", {
    url,
    formats: opts.formats ?? DEFAULT_FORMATS,
    onlyMainContent: opts.onlyMainContent ?? true,
  });
  return json.data;
}

module.exports = { search, scrape, callFirecrawl };

// ---------------------------------------------------------------------------
// CLI entry point — only runs when you call this file directly with `node`
// ---------------------------------------------------------------------------

if (require.main === module) {
  const [, , command, ...rest] = process.argv;
  const arg = rest.join(" ");

  (async () => {
    if (command === "search" && arg) {
      const hits = await search(arg);
      for (const h of hits) console.log(`- ${h.title}\n  ${h.url}`);
    } else if (command === "scrape" && arg) {
      const page = await scrape(arg);
      console.log(page.markdown);
    } else {
      console.log("Usage:\n  node scripts/firecrawl.js search <query>\n  node scripts/firecrawl.js scrape <url>");
      process.exitCode = 1;
    }
  })().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
