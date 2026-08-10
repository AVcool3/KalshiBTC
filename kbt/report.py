"""Aggregation, CSV/JSON output, and the printed summary."""

from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from typing import Optional

from .config import StrategyConfig
from .models import MarketResult


def _ts(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")


def summarize(results: list[MarketResult], cfg: StrategyConfig) -> dict:
    traded = [r for r in results if r.traded]
    settled = [r for r in traded if r.won is not None]
    wins = [r for r in settled if r.won]
    losses = [r for r in settled if not r.won]

    gross = sum(r.gross_pnl for r in settled)
    net = sum(r.net_pnl for r in settled)
    cost = sum(r.cost for r in settled)
    fees = sum(r.fees for r in settled)

    equity, peak, max_dd = 0.0, 0.0, 0.0
    for r in sorted(settled, key=lambda x: x.market.close_ts):
        equity += r.net_pnl
        peak = max(peak, equity)
        max_dd = min(max_dd, equity - peak)

    skips: dict[str, int] = {}
    for r in results:
        if not r.traded:
            reason = r.skip_reason.split(" not above")[0] if "not above" in r.skip_reason else r.skip_reason
            key = "odds below threshold" if "odds" in reason else (reason or "unknown")
            skips[key] = skips.get(key, 0) + 1

    return {
        "markets_evaluated": len(results),
        "trades": len(traded),
        "settled": len(settled),
        "skipped": len(results) - len(traded),
        "skip_reasons": skips,
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": (len(wins) / len(settled)) if settled else 0.0,
        "capital_deployed": cost,
        "fees": fees,
        "gross_pnl": gross,
        "net_pnl": net,
        "roi_on_deployed": (net / cost) if cost else 0.0,
        "avg_net_pnl_per_trade": (net / len(settled)) if settled else 0.0,
        "avg_entry_price_cents": (
            sum(r.entry_price for r in traded if r.entry_price) / len(traded) if traded else 0.0
        ),
        "total_adds": sum(r.adds for r in traded),
        "markets_with_adds": sum(1 for r in traded if r.adds),
        "avg_contracts_per_trade": (
            sum(r.contracts for r in traded) / len(traded) if traded else 0.0
        ),
        "max_drawdown": max_dd,
        "biggest_win": max((r.net_pnl for r in settled), default=0.0),
        "biggest_loss": min((r.net_pnl for r in settled), default=0.0),
        "config": {
            "entry_lead_min": cfg.entry_lead_s / 60,
            "stake": cfg.stake,
            "min_odds": cfg.min_odds,
            "dip_pct": cfg.dip_pct,
            "dip_mode": cfg.dip_mode,
            "min_distance_bps": cfg.min_distance_bps,
            "max_adds": cfg.max_adds or "unlimited",
            "price_source": cfg.price_source,
            "fill_mode": cfg.fill_mode,
            "fees": cfg.fees,
            "fee_rate": cfg.fee_rate,
        },
    }


def write_trades_csv(results: list[MarketResult], path: str) -> None:
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(
            [
                "close_utc", "ticker", "strike", "traded", "skip_reason", "side",
                "entry_price_c", "entry_spot", "entry_distance_bps", "adds",
                "contracts", "cost", "fees", "payout", "gross_pnl", "net_pnl", "won",
            ]
        )
        for r in sorted(results, key=lambda x: x.market.close_ts):
            w.writerow(
                [
                    _ts(r.market.close_ts), r.market.ticker, f"{r.market.strike:.2f}",
                    int(r.traded), r.skip_reason, r.side,
                    r.entry_price if r.entry_price is not None else "",
                    f"{r.entry_spot:.2f}" if r.entry_spot is not None else "",
                    f"{r.entry_distance_bps:.2f}" if r.entry_distance_bps is not None else "",
                    r.adds, r.contracts, f"{r.cost:.2f}", f"{r.fees:.2f}",
                    f"{r.payout:.2f}", f"{r.gross_pnl:.2f}", f"{r.net_pnl:.2f}",
                    "" if r.won is None else int(r.won),
                ]
            )


def write_fills_csv(results: list[MarketResult], path: str) -> None:
    with open(path, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["ts_utc", "ticker", "kind", "side", "price_c", "contracts", "cost", "fee", "spot", "distance_bps"])
        for r in sorted(results, key=lambda x: x.market.close_ts):
            for f in r.fills:
                w.writerow(
                    [
                        _ts(f.ts), r.market.ticker, f.kind, f.side, f.price, f.contracts,
                        f"{f.cost:.2f}", f"{f.fee:.2f}",
                        f"{f.spot:.2f}" if f.spot is not None else "",
                        f"{f.distance_bps:.2f}" if f.distance_bps is not None else "",
                    ]
                )


def write_json(summary: dict, meta: dict, path: str) -> None:
    with open(path, "w") as fh:
        json.dump({"meta": meta, "summary": summary}, fh, indent=2)


def print_summary(summary: dict, meta: Optional[dict] = None) -> None:
    s = summary
    line = "=" * 62
    print(line)
    print("KALSHI BTC 15-MIN — T-7 MOMENTUM BACKTEST")
    print(line)
    if meta:
        print(f"Window      : {_ts(meta['window_start_ts'])} → {_ts(meta['window_end_ts'])} UTC ({meta['hours']}h)")
        print(f"Series      : {meta['series']}   spot proxy: {meta['spot_source']}")
    c = s["config"]
    print(
        f"Rules       : T-{c['entry_lead_min']:.0f}min, ${c['stake']:.0f}/buy, "
        f">{c['min_odds']}% gate, -{c['dip_pct']:.0f}% adds ({c['dip_mode']}), "
        f"≥{c['min_distance_bps']:.0f}bp from strike, max adds {c['max_adds']}"
    )
    print(f"Execution   : {c['price_source']} price, {c['fill_mode']} fills, fees {'on' if c['fees'] else 'off'}")
    print("-" * 62)
    print(f"Markets     : {s['markets_evaluated']}   traded {s['trades']}   skipped {s['skipped']}")
    for reason, n in sorted(s["skip_reasons"].items(), key=lambda kv: -kv[1]):
        print(f"              skip: {reason} ({n})")
    print(f"Record      : {s['wins']}W - {s['losses']}L   win rate {s['win_rate']*100:.1f}%")
    print(f"Avg entry   : {s['avg_entry_price_cents']:.1f}c   avg size {s['avg_contracts_per_trade']:.1f} contracts")
    print(f"Adds        : {s['total_adds']} across {s['markets_with_adds']} markets")
    print("-" * 62)
    print(f"Deployed    : ${s['capital_deployed']:.2f}")
    print(f"Fees        : ${s['fees']:.2f}")
    print(f"Gross P&L   : ${s['gross_pnl']:+.2f}")
    print(f"Net P&L     : ${s['net_pnl']:+.2f}   ({s['roi_on_deployed']*100:+.2f}% on deployed)")
    print(f"Per trade   : ${s['avg_net_pnl_per_trade']:+.2f}")
    print(f"Best/worst  : ${s['biggest_win']:+.2f} / ${s['biggest_loss']:+.2f}")
    print(f"Max drawdown: ${s['max_drawdown']:.2f}")
    print(line)
