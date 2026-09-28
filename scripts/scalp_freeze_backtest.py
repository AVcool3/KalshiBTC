"""Backtest the complete Scalp-and-Freeze strategy from cached candles.

Simulates exactly what the live trader does:
  entry  : T-5, favorite side, price in (min_odds, max_odds], fixed contracts
  lock   : first minute after entry where the opposite ask <= 100-lock_at,
           buy the opposite side there (pair pays $1 at settlement)
  freeze : no other exit — unpaired positions ride to the official result
  breaker: once a UTC day's realized P&L <= -halt, no more entries that day
           (a locked pair realizes at lock time; unpaired realizes at close)

Usage: python scripts/scalp_freeze_backtest.py results_sf_entries/trades.csv [lock_at] [contracts] [halt]
"""

from __future__ import annotations

import csv
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone

from kbt.auth import KalshiSigner
from kbt.kalshi import KalshiClient, parse_candles


def fee(n: float, p: float) -> float:
    return math.ceil(0.07 * n * p * (1 - p) * 100) / 100.0


def close_ts(ticker: str) -> int:
    part = ticker.split("-")[1]  # e.g. 26AUG101915 (ET label)
    dt = datetime.strptime(part, "%y%b%d%H%M").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() + 4 * 3600)  # EDT -> UTC


def main() -> int:
    path = sys.argv[1] if len(sys.argv) > 1 else "results_sf_entries/trades.csv"
    lock_at = int(sys.argv[2]) if len(sys.argv) > 2 else 90
    contracts = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    halt = float(sys.argv[4]) if len(sys.argv) > 4 else 10.0

    client = KalshiClient(signer=KalshiSigner.from_env(), cache_dir=".cache")
    entries = [r for r in csv.DictReader(open(path))
               if r["traded"] == "1" and r["won"] != ""]
    entries.sort(key=lambda r: r["close_utc"])
    print(f"{len(entries)} qualifying entries from {path}")
    print(f"config: lock_at={lock_at}c, contracts={contracts}, daily halt=-${halt:.0f}\n")

    total, locks, settle_w, settle_l, skipped = 0.0, 0, 0, 0, 0
    day_pnl: dict[str, float] = defaultdict(float)
    halted: set[str] = set()
    eq = peak = dd = 0.0

    for r in entries:
        day = r["close_utc"][:10]
        if day in halted:
            skipped += 1
            continue
        tick, side = r["ticker"], r["side"]
        e_px = int(r["entry_price_c"]) / 100.0
        ct = close_ts(tick)
        raw = client.candlesticks(tick, ct - 960, ct + 60, period_interval=1)
        candles = parse_candles(raw)
        entry_ts = ct - 5 * 60
        opp = "no" if side == "yes" else "yes"

        locked_px = None
        if lock_at:
            for cd in candles:
                if cd.ts <= entry_ts or cd.ts > ct:
                    continue
                opp_ask = cd.ask(opp, "close")
                if opp_ask is not None and opp_ask <= 100 - lock_at:
                    locked_px = opp_ask / 100.0
                    break

        cost_fee = fee(contracts, e_px)
        if locked_px is not None:
            pnl = contracts * (1.0 - e_px - locked_px) - cost_fee - fee(contracts, locked_px)
            locks += 1
        else:
            won = r["won"] == "1"
            pnl = (contracts * (1 - e_px) if won else -contracts * e_px) - cost_fee
            if won:
                settle_w += 1
            else:
                settle_l += 1
        total += pnl
        day_pnl[day] += pnl
        eq += pnl
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
        if halt and day_pnl[day] <= -halt:
            halted.add(day)

    taken = locks + settle_w + settle_l
    print(f"trades taken   : {taken}  (skipped by breaker: {skipped})")
    print(f"outcomes       : {locks} profit-locked, {settle_w} settle-wins, {settle_l} settle-losses")
    pos = locks + settle_w
    print(f"positive trades: {pos}/{taken} ({100*pos/taken:.1f}%)")
    print(f"net P&L        : ${total:+.2f}   per trade ${total/taken:+.3f}")
    print(f"max drawdown   : ${dd:.2f}")
    print(f"halted days    : {len(halted)} of {len(day_pnl)}")
    worst = min(day_pnl.values()) if day_pnl else 0
    best = max(day_pnl.values()) if day_pnl else 0
    up_days = sum(1 for v in day_pnl.values() if v > 0)
    print(f"daily          : {up_days}/{len(day_pnl)} positive, best {best:+.2f}, worst {worst:+.2f}")
    print("\nper-day P&L:")
    for d in sorted(day_pnl):
        bar = "#" * min(40, int(abs(day_pnl[d]) / 1.5))
        flag = " HALTED" if d in halted else ""
        print(f"  {d}  {day_pnl[d]:+8.2f}  {bar}{flag}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
