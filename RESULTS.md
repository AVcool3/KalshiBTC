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
| 2026-09-21 | [Vol Regime Hybrid](strategies/2026-09-21-vol-regime-hybrid.js) | -4.36% | +34.21% | 15 | 20% | -23.93% | Regime switcher: quiet market -> buy RSI dips, wide stop; loud market -> Donchian breakouts, fast stop; trades keep their entry regime's rules |
| 2026-09-22 | [Squeeze Breakout](strategies/2026-09-22-squeeze-breakout.js) | -12.66% | +36.09% | 4 | 0% | -17.30% | Volatility timing: buy only a breakout above the upper Bollinger band that erupts from a low-volatility squeeze; exit on a 10-day low |
| 2026-09-23 | [Absolute Momentum 90d](strategies/2026-09-23-absolute-momentum.js) | -3.77% | +32.94% | 5 | 40% | -29.73% | Time-series momentum: stay invested while price is above its level 90 days ago, sit in cash while below |
| 2026-09-24 | [Weekday Hold Mon-Fri](strategies/2026-09-24-weekday-hold.js) | -73.53% | +32.67% | 103 | 54% | -81.36% | Calendar effect: buy Monday's close, sell Friday's close, sit out every weekend - no indicators, the calendar is the signal |
| 2026-09-25 | [Donchian Breakout 55/20](strategies/2026-09-25-donchian-slow.js) | -29.49% | +29.71% | 9 | 44% | -41.36% | Robustness test of the champion: same turtle mechanism with the original slow windows - enter on a 55-day high, exit on a 20-day low |
| 2026-09-26 | [Donchian Ensemble 5x](strategies/2026-09-26-donchian-ensemble.js) | +7.75% | +27.64% | 15 | 33% | -33.24% | Anti-parameter-luck: five Donchian systems (10/5 to 40/20) each vote long or flat; hold BTC only while a majority are long |
| 2026-09-27 | [Walk-Forward Donchian](strategies/2026-09-27-walk-forward-donchian.js) | -5.68% | +28.63% | 11 | 36% | -26.46% | Adaptive parameters: every 30 days adopt whichever Donchian pair won the trailing 180 days, then trade its rules - tests whether 'recently best' stays best |
| 2026-09-29 | [Trend Committee 2-of-3](strategies/2026-09-28-trend-committee.js) | -8.60% | +33.21% | 12 | 42% | -26.41% | Mechanism diversification: SMA crossover, Donchian 20/10 state, and 90-day momentum each vote; hold BTC while any two agree the trend is up |
| 2026-09-30 | [Circuit Breaker Hold](strategies/2026-09-30-circuit-breaker.js) | +55.32% | +40.49% | 9 | 44% | -35.15% | Long by default; sell only after a single-day drop worse than -5% and sit out 10 days, then buy back - dodge disasters, own everything else |
| 2026-10-01 | [Breaker + Rebound Re-entry](strategies/2026-10-01-breaker-rebound.js) | +39.52% | +37.65% | 10 | 40% | -39.92% | The champion's circuit breaker, plus one rule: a +5% day during the cooldown means the panic is over - re-enter immediately instead of waiting |
| 2026-10-02 | [Red Streak Reversal 4/2](strategies/2026-10-02-red-streak-reversal.js) | +9.88% | +42.64% | 23 | 78% | -24.37% | Tape reading: buy at the close of the 4th straight down day (seller exhaustion), sell after 2 straight up days (bounce harvested) |
