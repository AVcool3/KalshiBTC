# Kalshi BTC 15-Minute — T-7 Momentum Backtester

Backtests this strategy on Kalshi's `KXBTC15M` (Bitcoin up/down, 15-minute windows):

> Seven minutes before the market closes, bet $5 on the side BTC is currently on,
> but only if that side is trading above 60%. If the share price dips 5% below
> what you bought it for **and** BTC is still at least 0.02% away from the strike,
> buy $5 more. Keep doing that until the market closes.

## Results: 2026-08-09 18:01 → 2026-08-10 18:01 UTC

Run against real Kalshi candlesticks (95 markets, all settled) with Coinbase
1-minute spot as the index proxy. Full per-market and per-fill detail is in
`results/`.

| | Base strategy | No adds (`--dip-pct 100`) | 5 bp filter (`--min-distance-bps 5`) |
|---|---|---|---|
| Traded / skipped | 76 / 19 (odds ≤ 60¢) | 76 / 19 | 76 / 19 |
| Record | 71W–5L (93.4%) | 71W–5L | 71W–5L |
| Adds | 18 across 12 markets | 0 | 11 across 8 |
| Deployed | $438.19 | $352.42 | $403.75 |
| **Net P&L** | **+$6.91 (+1.6%)** | **+$28.90 (+8.2%)** | **+$33.12 (+8.2%)** |

The headline: the entry rule made money; the dip-buying ladder gave most of it
back. Every one of the 5 losing markets kept dipping to the end, so the adds
concentrated extra capital into exactly the markets that lost — the worst
(2026-08-10 15:15 UTC) laddered $5 buys down to penny prices, accumulating 679
doomed contracts for a −$20.48 loss on a single window. Adds on winning markets
existed too, but at 60–90¢ they bought only a handful of extra contracts each.
Classic martingale asymmetry: small extra wins, concentrated extra losses.

One day is ~76 trades of a strategy that buys 64–99¢ favorites — the 93% win
rate is what the prices already implied, and a single bad afternoon (three
laddered losses in 05:00–05:15 and 15:15) produced a −$29.57 drawdown against
$5 stakes. Do not extrapolate edge from this sample; re-run with `--hours 168`+.

## Run it

```bash
pip install -r requirements.txt
python -m kbt run --hours 24
```

That prints a summary and writes `results/trades.csv`, `results/fills.csv`, and
`results/summary.json`. Raw API responses are cached in `.cache/` so re-runs with
different parameters don't refetch (delete it to pull fresh data).

Sanity-check the market discovery first if you like:

```bash
python -m kbt discover --hours 24     # lists the ~96 windows and their strikes
```

Kalshi market data is public, so no credentials are needed. If your account or
region requires authentication for candlesticks, set `KALSHI_KEY_ID` and
`KALSHI_PRIVATE_KEY_PATH` and requests are signed automatically.

## How each rule is implemented

| Rule | Implementation | Flag |
|---|---|---|
| "7 minutes out from market close" | Decision at `close_ts - 420s`, using the candle covering that minute (falls back to the last quote before it) | `--entry-lead-min` |
| "the side it is on" | BTC spot > strike → YES, below → NO. `floor_strike` is the reference the window opened against | — |
| "odds for that side greater than 60%" | Strictly greater than 60¢, read off the **ask** — the price you'd actually pay | `--min-odds`, `--price-source` |
| "bet 5 dollars" | `floor($5 / ask)` whole contracts, so a 70¢ side buys 7 contracts for $4.90 | `--stake` |
| "dips 5% below what you bought it for" | Relative to the **last** fill, so the ladder re-bases each time: 70¢ → 66.5¢ → 63.2¢ | `--dip-pct`, `--dip-mode` |
| "distance from the price target is .02% or higher" | `abs(spot - strike) / strike >= 2 bps`, checked at the moment of each add | `--min-distance-bps` |
| "continue that strategy till market close" | Every minute from entry to close, uncapped adds | `--max-adds` |
| Settlement | Kalshi's own `result` field when present, else spot at close vs strike. Winners pay $1.00/contract, losers $0 | — |
| Fees | Kalshi's `ceil(0.07 × contracts × P × (1−P))` cents, charged on every buy | `--no-fees`, `--fee-rate` |

Alternative readings are one flag away — e.g. `--dip-mode abs` treats "5%" as
5 cents, `--price-source mid` ignores the spread, `--max-adds 2` caps risk at
$15/market. Re-running with a changed flag is free once the cache is warm, so
the sensible move is to run the base case and then sweep the ambiguous knobs.

## Things to know before you trust the output

- **Spot proxy.** Kalshi settles `KXBTC15M` against the CF Benchmarks BTC Real
  Time Index, which has no free public history. The backtest proxies it with
  1-minute Coinbase candles (`--spot-source binance|kraken` to switch). The two
  track within a few basis points — which matters, because the 0.02% distance
  filter is only 2 bps. Treat marginal adds as noise, and check whether results
  hold under `--min-distance-bps 5`.
- **Minute granularity.** Fills use the quote standing at the end of each minute.
  A dip that happens and recovers inside one minute is invisible. `--fill-mode low`
  uses the intra-minute low instead but never fills better than the trigger price.
- **Quotes, not the tape.** A fill is modeled whenever an offer exists at the
  right price. In a thin 15-minute book, size at the touch may be smaller than
  $5 — real slippage on the adds will be worse than modeled.
- **Sample size.** 24 hours is ~96 markets, and only the subset clearing the 60%
  gate gets traded. That is far too small to separate edge from luck: a strategy
  buying 70–90¢ favorites wins most markets by construction, and one bad tail
  wipes out many wins. Run `--hours 168` or more before concluding anything.

## Layout

```
kbt/
  config.py    strategy parameters, position sizing, Kalshi fee formula
  models.py    Candle/Market/Fill/MarketResult; NO book derived from the YES book
  engine.py    the simulation — pure, offline, no network
  kalshi.py    trade-api v2 client, market discovery, response parsing
  spot.py      BTC 1-minute history (coinbase / binance / kraken)
  runner.py    fetch → assemble → simulate
  report.py    summary stats, CSV/JSON output
  cli.py       python -m kbt run | discover
tests/         35 tests pinning the entry gate, ladder, fees, and settlement
```

```bash
python -m pytest tests -q
```
