"""Backtest a daily loss circuit breaker over an existing trades.csv.

Rule: once the UTC day's realized net P&L reaches -threshold, take no new
entries until the next UTC day. Assumes a window's result is known before
the next window's decision (settlement lands ~minutes after close; the next
T-7 decision is 8 minutes after the previous close).

Usage: python scripts/halt_backtest.py results_30d_t7/trades.csv 10 15 20
"""

from __future__ import annotations

import csv
import sys
from collections import defaultdict


def load(path: str) -> list[dict]:
    rows = [r for r in csv.DictReader(open(path)) if r["traded"] == "1" and r["won"] != ""]
    for r in rows:
        r["net"] = float(r["net_pnl"])
    rows.sort(key=lambda r: r["close_utc"])
    return rows


def replay(rows: list[dict], halt_at: float | None):
    total, taken, halts = 0.0, 0, 0
    eq = peak = dd = 0.0
    day_pnl: dict[str, float] = defaultdict(float)
    halted_days: set[str] = set()
    worst_day: dict[str, float] = defaultdict(float)
    for r in rows:
        day = r["close_utc"][:10]
        if halt_at is not None and day in halted_days:
            continue
        total += r["net"]
        taken += 1
        day_pnl[day] += r["net"]
        eq += r["net"]
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
        if halt_at is not None and day_pnl[day] <= -halt_at:
            halted_days.add(day)
            halts += 1
    worst = min(day_pnl.values()) if day_pnl else 0.0
    return total, dd, worst, taken, halts


def main() -> int:
    path = sys.argv[1]
    thresholds = [float(x) for x in sys.argv[2:]] or [10.0, 15.0, 20.0]
    rows = load(path)
    print(f"{path}: {len(rows)} trades")
    base = replay(rows, None)
    print(f"  no halt      : net {base[0]:+8.2f}  maxDD {base[1]:7.2f}  worst day {base[2]:+7.2f}  trades {base[3]}")
    for t in thresholds:
        net, dd, worst, taken, halts = replay(rows, t)
        cost = net - base[0]
        print(f"  halt at -{t:>4.0f} : net {net:+8.2f}  maxDD {dd:7.2f}  worst day {worst:+7.2f}  trades {taken}  halted {halts} days  (P&L vs no-halt {cost:+.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
