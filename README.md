# KalshiBTC — GitHub Auto-Committer

This repo contains a **GitHub auto-committer**: a GitHub Actions workflow that
runs on a schedule, fetches the current Bitcoin price, appends it to a JSON
log file, and **automatically commits and pushes** the update — no manual
work needed.

## How it works

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

## Notes / gotchas

- Scheduled workflows run in **UTC** and can be delayed a few minutes during
  GitHub's busy periods — that's normal.
- GitHub automatically **disables schedules after ~60 days of no repo
  activity**; since this workflow commits on every run, it keeps itself alive.
- The commit message includes `[skip ci]` so the auto-commit doesn't trigger
  other CI workflows in a loop.
- The log is capped at the most recent **8760 entries** (~1 year at hourly
  runs). Change `MAX_ENTRIES` in `scripts/autocommit.js` to adjust.
