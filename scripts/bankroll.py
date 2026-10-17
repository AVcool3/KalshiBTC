"""Replay a backtest's trades.csv against a finite, reinvested bankroll.

Two models over the same trade sequence (trades are strictly sequential —
each market settles before the next T-7 entry):

  flat        $5 buys funded from the pot; ladder buys are cut back pro-rata
              when the pot can't cover them; broke below $5 = bust.
  compound    every buy is 5% of the current bankroll (the $5-per-$100
              ratio), so P&L scales with equity. Idealized: ignores the
              whole-contract floor, which bites hard at tiny bankrolls.

Usage: python scripts/bankroll.py results_week/trades.csv [start_bankroll]
"""

from __future__ import annotations

import csv
import sys


def load(path: str) -> list[dict]:
    rows = [r for r in csv.DictReader(open(path)) if r["traded"] == "1"]
    rows.sort(key=lambda r: r["close_utc"])
    return rows


def flat(rows: list[dict], start: float, unit: float = 5.0):
    bankroll, peak, max_dd, bust = start, start, 0.0, None
    curve = [(None, start)]
    for r in rows:
        if bankroll < unit:
            bust = r["close_utc"]
            break
        staked = float(r["cost"]) + float(r["fees"])
        effective = min(staked, bankroll)
        scale = effective / staked
        bankroll += float(r["payout"]) * scale - effective
        peak = max(peak, bankroll)
        max_dd = min(max_dd, bankroll - peak)
        curve.append((r["close_utc"], bankroll))
    return bankroll, max_dd, bust, curve


def compound(rows: list[dict], start: float, fraction: float = 0.05):
    bankroll, peak, max_dd, low = start, start, 0.0, start
    curve = [(None, start)]
    for r in rows:
        # net_pnl was computed at $5 stakes = 5% of a $100 bankroll
        bankroll += float(r["net_pnl"]) * (bankroll * fraction / 5.0)
        low = min(low, bankroll)
        peak = max(peak, bankroll)
        max_dd = min(max_dd, (bankroll - peak) / peak)
        curve.append((r["close_utc"], bankroll))
    return bankroll, max_dd, low, curve


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "results_week/trades.csv"
    start = float(sys.argv[2]) if len(sys.argv) > 2 else 100.0
    rows = load(path)
    print(f"{path}: {len(rows)} trades, start ${start:,.2f}")

    end, dd, bust, _ = flat(rows, start)
    print(f"  flat $5 buys : end ${end:,.2f}   max drawdown ${dd:,.2f}   "
          f"bust: {bust or 'no'}")

    end, dd, low, _ = compound(rows, start)
    print(f"  5% of pot    : end ${end:,.2f}   max drawdown {dd * 100:,.1f}%   "
          f"low ${low:,.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
