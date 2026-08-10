"""Command line entry point: python -m kbt run --hours 24"""

from __future__ import annotations

import argparse
import os
import sys

from .config import StrategyConfig
from .kalshi import SERIES
from .report import print_summary, summarize, write_fills_csv, write_json, write_trades_csv


def _strategy_args(p: argparse.ArgumentParser) -> None:
    p.add_argument("--hours", type=float, default=24.0, help="lookback window (default 24)")
    p.add_argument("--end-ts", type=int, default=None, help="window end, unix seconds (default now)")
    p.add_argument("--series", default=SERIES)
    p.add_argument("--stake", type=float, default=5.0, help="dollars per buy")
    p.add_argument("--entry-lead-min", type=float, default=7.0, help="minutes before close to enter")
    p.add_argument("--min-odds", type=int, default=60, help="only buy above this price, in cents")
    p.add_argument("--with-adds", action="store_true",
                   help="enable the dip-buy ladder (off by default; it backtested badly)")
    p.add_argument("--dip-pct", type=float, default=5.0, help="add after this %% drop")
    p.add_argument("--dip-mode", choices=["rel_last", "rel_first", "abs"], default="rel_last")
    p.add_argument("--min-distance-bps", type=float, default=2.0, help="0.02%% = 2 bps")
    p.add_argument("--max-adds", type=int, default=0, help="0 = unlimited")
    p.add_argument("--price-source", choices=["ask", "mid", "last"], default="ask")
    p.add_argument("--fill-mode", choices=["close", "low"], default="close")
    p.add_argument("--no-fees", action="store_true", help="report gross P&L only")
    p.add_argument("--fee-rate", type=float, default=0.07)
    p.add_argument("--spot-source", choices=["coinbase", "binance", "kraken"], default="coinbase")
    p.add_argument("--cache-dir", default=".cache", help="raw API responses (set '' to disable)")
    p.add_argument("--base-url", default=None)
    p.add_argument("--out-dir", default="results")


def _config_from(args: argparse.Namespace) -> StrategyConfig:
    return StrategyConfig(
        entry_lead_s=int(args.entry_lead_min * 60),
        stake=args.stake,
        min_odds=args.min_odds,
        adds=args.with_adds,
        dip_pct=args.dip_pct,
        dip_mode=args.dip_mode,
        min_distance_bps=args.min_distance_bps,
        max_adds=args.max_adds,
        price_source=args.price_source,
        fill_mode=args.fill_mode,
        fees=not args.no_fees,
        fee_rate=args.fee_rate,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kbt", description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    run = sub.add_parser("run", help="backtest the strategy")
    _strategy_args(run)

    disc = sub.add_parser("discover", help="list the 15-minute markets in the window")
    disc.add_argument("--hours", type=float, default=24.0)
    disc.add_argument("--end-ts", type=int, default=None)
    disc.add_argument("--series", default=SERIES)
    disc.add_argument("--cache-dir", default=".cache")
    disc.add_argument("--base-url", default=None)

    args = parser.parse_args(argv)

    from .auth import KalshiSigner
    from .kalshi import DEFAULT_BASE, KalshiClient
    from .runner import discover as discover_markets
    from .runner import run_backtest, window

    cache = args.cache_dir or None

    if args.cmd == "discover":
        client = KalshiClient(
            base_url=args.base_url or DEFAULT_BASE,
            signer=KalshiSigner.from_env(),
            cache_dir=cache,
        )
        start, end = window(args.hours, args.end_ts)
        markets = discover_markets(client, start, end, args.series)
        print(f"{len(markets)} markets in window")
        for m in markets:
            from datetime import datetime, timezone

            close = datetime.fromtimestamp(m.close_ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            print(f"  {close}Z  {m.ticker:32s} strike {m.strike:>12,.2f}  result={m.result or '-'}")
        return 0

    cfg = _config_from(args)
    results, meta = run_backtest(
        hours=args.hours,
        cfg=cfg,
        series_ticker=args.series,
        spot_source=args.spot_source,
        cache_dir=cache,
        end_ts=args.end_ts,
        base_url=args.base_url,
    )
    summary = summarize(results, cfg)

    os.makedirs(args.out_dir, exist_ok=True)
    write_trades_csv(results, os.path.join(args.out_dir, "trades.csv"))
    write_fills_csv(results, os.path.join(args.out_dir, "fills.csv"))
    write_json(summary, meta, os.path.join(args.out_dir, "summary.json"))

    print_summary(summary, meta)
    print(f"\nWrote {args.out_dir}/trades.csv, fills.csv, summary.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
