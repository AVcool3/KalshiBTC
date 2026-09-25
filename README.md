# KalshiBTC — Daily Strategy Lab + Auto-Committer

Two automated systems live in this repo:

1. **Daily Strategy Lab** — every day, Claude invents ONE new BTC trading
   strategy, backtests it against ~2 years of real daily price data, and
   commits the strategy + its results to this repo automatically.
2. **GitHub Auto-Committer** — a GitHub Actions workflow that logs the live
   BTC price every hour and commits the update.

## Daily Strategy Lab

```
Daily schedule (Claude session, 13:00 UTC)
        │
        ▼
Reads RESULTS.md to see what's been tried already
        │
        ▼
strategies/YYYY-MM-DD-<name>.js    ← writes ONE new strategy (commented!)
        │
        ▼
node backtest/run.js strategies/<file>
        │
        ▼
RESULTS.md gets a new scoreboard row  →  commit + push
```

| File | What it does |
| --- | --- |
| `backtest/fetch-data.js` | Downloads ~2 years of daily BTC-USD candles from Coinbase (public API, cached in `backtest/data/`). |
| `backtest/engine.js` | The simulator: $10,000 start, all-in/all-out trades at daily close, 0.6% fee per trade. Reports return, win rate, max drawdown, and the buy-and-hold benchmark. |
| `backtest/run.js` | The command you run: `node backtest/run.js strategies/<file>`. Prints a report and appends a row to `RESULTS.md`. |
| `strategies/` | One file per strategy, date-prefixed. Each is heavily commented — read them to learn the idea behind each one. |
| `RESULTS.md` | The scoreboard: every strategy ever tried, with its numbers, in one table. |

Try any strategy yourself (needs Node 18+, no npm installs):

```bash
node backtest/run.js strategies/2026-09-17-sma-crossover.js
```

## Hourly price auto-committer

```
GitHub schedule (every hour, UTC)
        │
        ▼
.github/workflows/autocommit.yml   ← the workflow (when + how to commit)
        │
        ▼
scripts/autocommit.js              ← the script (what actually changes)
        │
        ▼
data/btc-price-log.json            ← the file that gets updated
        │
        ▼
git commit + git push  (done automatically by the workflow)
```

| File | What it does |
| --- | --- |
| `.github/workflows/autocommit.yml` | Scheduled workflow. Controls **when** it runs and handles the commit/push. |
| `scripts/autocommit.js` | Node.js script. Controls **what** gets changed each run (currently: log the BTC price). |
| `data/btc-price-log.json` | The growing price history: `[{ "timestamp": "...", "priceUsd": 12345.67 }, ...]` |

## Common changes you might want to make

- **Run more/less often** — edit the `cron` line in
  `.github/workflows/autocommit.yml`. The comments in that file include
  ready-to-paste examples (every 30 min, every 6 hours, daily).
- **Log different data** — edit `fetchBtcPrice()` or the `entry` object in
  `scripts/autocommit.js`. For example, you could add Kalshi market data or
  other coins as extra fields.
- **Change the commit message** — edit the `git commit -m "..."` line at the
  bottom of the workflow file.
- **Trigger a run manually** — go to the repo's **Actions** tab on GitHub,
  pick "Auto Commit BTC Price", and click **Run workflow**.

## Testing the script locally

The script is plain Node.js (v18+ for the built-in `fetch`), so you can run
it on your machine without GitHub:

```bash
node scripts/autocommit.js
```

It will create/update `data/btc-price-log.json`. Nothing gets committed when
you run it locally — the commit/push step only happens inside the GitHub
Action.

## Using the data in a React app

Since the log is plain JSON in the repo, a React frontend can fetch it
straight from GitHub's raw URL and, for example, chart the price history:

```jsx
// Example: load the price history inside a React component
useEffect(() => {
  fetch(
    "https://raw.githubusercontent.com/AVcool3/KalshiBTC/main/data/btc-price-log.json"
  )
    .then((res) => res.json())
    .then((entries) => setPrices(entries)); // entries = [{ timestamp, priceUsd }, ...]
}, []);
```

## Web search & scraping (Firecrawl)

[Firecrawl](https://firecrawl.dev) gives both you and the Claude agent a way to
search the web and turn pages into clean markdown — useful for news/sentiment
inputs to a strategy, or for the daily lab to research an idea before coding it.

```
FIRECRAWL_API_KEY  (env var or .env file — never committed)
        │
        ├──▶ .mcp.json             ← Claude Code loads Firecrawl as MCP tools
        │                            (firecrawl_search, firecrawl_scrape, ...)
        │
        └──▶ scripts/firecrawl.js  ← plain-Node helper for your own code
```

| File | What it does |
| --- | --- |
| `.mcp.json` | Project-scoped MCP config. Any Claude Code session opened in this repo automatically gets Firecrawl tools. Reads the key from `${FIRECRAWL_API_KEY}`. |
| `scripts/firecrawl.js` | `search(query)` and `scrape(url)` helpers built on Node's `fetch`, no npm installs. Also works as a CLI. |
| `.env.example` | Template for the git-ignored `.env` file that holds the key. |

Setup:

1. Copy `.env.example` to `.env` and paste your key from
   <https://firecrawl.dev/app/settings?tab=api-keys>.
   For Claude Code on the web, add `FIRECRAWL_API_KEY` as an environment
   variable in the cloud environment settings instead (title bar menu → Edit).
2. Try it:

```bash
node scripts/firecrawl.js search "bitcoin ETF inflows"
node scripts/firecrawl.js scrape https://www.coindesk.com/price/bitcoin
```

Use it in a strategy or script:

```js
const { search, scrape } = require("./scripts/firecrawl");
const hits = await search("bitcoin news", { limit: 5, tbs: "qdr:d" }); // past day
const page = await scrape(hits[0].url); // page.markdown
```

## Notes / gotchas

- Scheduled workflows run in **UTC** and can be delayed a few minutes during
  GitHub's busy periods — that's normal.
- GitHub automatically **disables schedules after ~60 days of no repo
  activity**; since this workflow commits on every run, it keeps itself alive.
- The commit message includes `[skip ci]` so the auto-commit doesn't trigger
  other CI workflows in a loop.
- The log is capped at the most recent **8760 entries** (~1 year at hourly
  runs). Change `MAX_ENTRIES` in `scripts/autocommit.js` to adjust.
