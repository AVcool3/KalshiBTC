# Kalshi BTC 15-Minute — T-7 Momentum Backtester

Backtests a momentum strategy on Kalshi's `KXBTC15M` (Bitcoin up/down, 15-minute windows):

> Seven minutes before the market closes, bet $5 on the side BTC is currently on,
> but only if that side is trading above 60%. Hold to settlement.

The originally specified strategy also **added $5 every time the price dipped 5%
below the last fill** (while BTC stayed ≥0.02% from the strike). That ladder was
backtested, shown to be strictly harmful, and is now off by default — see
[The ladder: tested and rejected](#the-ladder-tested-and-rejected). Re-enable it
with `--with-adds` to reproduce those runs.

## Results — 7 days, 2026-08-03 18:10 → 2026-08-10 18:10 UTC

661 markets, all settled, real Kalshi candlesticks, Coinbase 1-minute spot as
the index proxy. Canonical output in `results_week/` (the last 24h alone is in
`results/`: 71W–5L, +$28.90).

| Strategy (no adds) | |
|---|---|
| Traded / skipped | 523 / 138 (odds ≤ 60¢ at T-7) |
| Record | 456W – 67L (87.2%) |
| Avg entry | 83.6¢ |
| Deployed / fees | $2,428.48 / $30.49 |
| **Net P&L** | **+$89.03 (+3.67% on deployed)** |
| Max drawdown | −$32.97 |
| Daily net | +$6, −$33, +$28, −$16, +$26, +$29, +$21, +$28 — 6 of 8 days positive |

Bankroll replay (`python scripts/bankroll.py results_week/trades.csv`): a $100
pot with $5 flat buys ends the week at **$189.03** with a **$74.24 low** — never
bust, but a ~30% drawdown means $5 stakes are aggressive for a $100 pot;
$300–500 is more conservative sizing for this stake.

Honest caveats before trusting the +3.67%:

- **One week, one regime.** 523 trades of 64–99¢ favorites winning 87.2% is
  close to what the prices already implied (~84% breakeven after fees). The
  edge, if real, is thin.
- **Fills at the touch.** The model assumes $5 gets filled at the standing ask;
  thin books make real fills slightly worse.
- **Spot proxy.** Settlement side-picking uses Coinbase, not the CF Benchmarks
  index Kalshi settles on; they differ by a few bps, which can flip the side
  choice when BTC sits nearly on the strike.

## The ladder: tested and rejected

The dip-buy rule was run on the same 7 days (`results_week_ladder/`, and
`--with-adds` to reproduce):

| | No adds (default) | With the 5% ladder |
|---|---|---|
| Record | 456W – 67L | 456W – 67L — identical |
| Deployed | $2,428 | $3,510 |
| **Net P&L** | **+$89.03** | **−$150.84** |
| Max drawdown | −$32.97 | −$278.96 |
| $100 bankroll, reinvested | ends $189 | **bust in 12h** (2026-08-04 06:30) |

The adds never changed a single market's outcome — a market that dipped and
recovered would have won with the original $5 anyway. All the ladder did was
concentrate extra capital into markets that were already losing: laddered
markets netted −$413 (+$495 on the 83 that recovered, −$908 on the 53 that
didn't), and every loss worse than −$10 was a ladder. A distance filter of
5 bps instead of 2 didn't save it (−$138). Classic martingale asymmetry in a
fast-decaying binary.

## Run it

```bash
pip install -r requirements.txt
python -m kbt run --hours 24                  # the strategy (no adds)
python -m kbt run --hours 168 --with-adds     # reproduce the rejected ladder
python -m kbt discover --hours 24             # just list the markets
python scripts/bankroll.py results/trades.csv # replay vs a finite bankroll
```

Prints a summary and writes `trades.csv`, `fills.csv`, `summary.json` to
`--out-dir` (default `results/`). Raw API responses are cached in `.cache/`;
delete it to fetch fresh. Kalshi market data is public — no credentials needed.
If your account requires auth for candlesticks, set `KALSHI_KEY_ID` and
`KALSHI_PRIVATE_KEY_PATH` and requests are signed automatically.

## Live trading

```bash
python -m kbt trade --once     # evaluate the current market, print the decision, exit
python -m kbt trade            # paper-trade: full loop, decisions journaled, no orders
python -m kbt trade --live     # real orders (requires credentials)
```

The trader wakes at T-7 before each quarter-hour close, reads the live quote
(dollar strings, sub-cent ticks handled), picks the side BTC is on, applies the
>60¢ gate, and places at most one limit buy at the standing ask. No adds, ever.
Every decision — including skips — is appended to `live/journal.jsonl`.

Safety rails:

- **Dry-run is the default.** Orders are only sent with an explicit `--live`.
- `--min-balance 20` refuses any order that would take the account below $20.
- One entry per market; a failed tick logs and waits for the next window.

Credentials (only needed for `--live`; market data is public): set
`KALSHI_KEY_ID` (or `KalshiKEY`) to the API key UUID, and the RSA private key
via `KALSHI_PRIVATE_KEY_PATH` (path to the `.pem`) or `KALSHI_PRIVATE_KEY`
(PEM content). Both halves are required — the UUID alone cannot sign requests.

### Deploying

The process must be running at T-7 of every window you want to trade, so it
belongs on an always-on machine (any $5 VPS, a Raspberry Pi, a home server):

```bash
sudo git clone <this repo> /opt/KalshiBTC && cd /opt/KalshiBTC
sudo useradd -r kbt && sudo mkdir -p /etc/kbt /opt/KalshiBTC/live
sudo cp ~/kalshi.pem /etc/kbt/kalshi.pem        # the key file from Kalshi
printf 'KALSHI_KEY_ID=<uuid>\nKALSHI_PRIVATE_KEY_PATH=/etc/kbt/kalshi.pem\n' | sudo tee /etc/kbt/env
sudo chmod 600 /etc/kbt/env /etc/kbt/kalshi.pem && sudo chown -R kbt /opt/KalshiBTC/live /etc/kbt
pip install -r requirements.txt
sudo cp deploy/kbt-trader.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now kbt-trader
journalctl -u kbt-trader -f                     # watch it decide
```

Run it **without `--live` for at least a day first** (edit the `ExecStart`
line) and compare `live/journal.jsonl` against the markets afterward — that
validates timing, quotes, and side-picking with zero risk. Then flip to
`--live` with a small balance. Kalshi restricts trading to permitted
jurisdictions and this is real money on a thin backtested edge — size like
the week of history it's based on could be wrong, because it could be.

## How each rule is implemented

| Rule | Implementation | Flag |
|---|---|---|
| "7 minutes out from market close" | Decision at `close_ts - 420s`, using the candle covering that minute (falls back to the last quote before it) | `--entry-lead-min` |
| "the side it is on" | BTC spot > strike → YES, below → NO. `floor_strike` is the reference the window opened against | — |
| "odds for that side greater than 60%" | Strictly greater than 60¢, read off the **ask** — the price you'd actually pay | `--min-odds`, `--price-source` |
| "bet 5 dollars" | `floor($5 / ask)` whole contracts, so a 70¢ side buys 7 contracts for $4.90 | `--stake` |
| Dip-buy ladder (rejected, opt-in) | −5% from last fill, ≥2 bp from strike, uncapped until close | `--with-adds`, `--dip-pct`, `--dip-mode`, `--min-distance-bps`, `--max-adds` |
| Settlement | Kalshi's own `result` field when present, else spot at close vs strike. Winners pay $1.00/contract | — |
| Fees | Kalshi's `ceil(0.07 × contracts × P × (1−P))` cents, charged on every buy | `--no-fees`, `--fee-rate` |

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
scripts/
  bankroll.py  replay trades.csv against a finite, reinvested bankroll
tests/         36 tests pinning the entry gate, ladder, fees, and settlement
results*/      committed runs: results/ (24h), results_week/ (7d), *_ladder/
```

```bash
python -m pytest tests -q
```
