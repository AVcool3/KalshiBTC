# Strategy Backtest Results

One new BTC trading strategy is tried and backtested every day; each run
appends a row here (done automatically by `backtest/run.js`).

**How to read this table:**
- **Return** — what the strategy turned $10,000 into over ~2 years of daily
  BTC data (after 0.6% fees per trade), as a percentage.
- **Buy & Hold** — the benchmark: just buying on day 1 and never selling.
  A strategy is only interesting if it beats this (or gets close with a much
  smaller drawdown).
- **Trades** — completed buy→sell round-trips.
- **Win rate** — % of those round-trips that made money.
- **Max DD** — max drawdown: the worst peak-to-trough drop in portfolio
  value along the way (smaller magnitude = less scary to hold).

To re-run any strategy yourself: `node backtest/run.js strategies/<file>`

| Date | Strategy | Return | Buy & Hold | Trades | Win rate | Max DD | Idea |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-09-17 | [SMA Crossover 10/30](strategies/2026-09-17-sma-crossover.js) | +2.88% | +23.77% | 15 | 33% | -42.31% | Trend-following: buy when the 10-day average crosses above the 30-day, sell when it crosses back below |
| 2026-09-19 | [RSI Mean Reversion 30/55](strategies/2026-09-19-rsi-mean-reversion.js) | +1.53% | +28.11% | 16 | 81% | -40.42% | Contrarian: buy when 14-day RSI drops below 30 (panic dip), sell when it recovers above 55 |
| 2026-09-20 | [Donchian Breakout 20/10](strategies/2026-09-20-donchian-breakout.js) | +40.50% | +27.14% | 14 | 43% | -26.46% | Turtle-style momentum: buy a close above the prior 20-day high, sell a close below the prior 10-day low |
| 2026-09-21 | [Volume Surge 1.5x/20](strategies/2026-09-21-volume-surge.js) | -12.28% | +34.21% | 24 | 33% | -49.22% | Follow conviction: buy an up-day on >1.5x average volume, sell a down-day on >1.5x average volume |
