"""Statistical comparison of two backtest runs (e.g. T-7 vs T-5 entries).

Beyond point totals: paired per-window differences, bootstrap confidence
intervals, calibration of entry price vs realized win rate, and time-of-day
structure. Pure stdlib — no numpy needed.

Usage: python scripts/deep_compare.py results_30d_t7/trades.csv results_30d_t5/trades.csv [labelA labelB]
"""

from __future__ import annotations

import csv
import random
import sys
from collections import defaultdict


def load(path: str) -> dict[str, dict]:
    out = {}
    for r in csv.DictReader(open(path)):
        if r["traded"] == "1" and r["won"] != "":
            r["net"] = float(r["net_pnl"])
            r["staked"] = float(r["cost"]) + float(r["fees"])
            r["entry"] = int(r["entry_price_c"])
            out[r["ticker"]] = r
    return out


def bootstrap_ci(values: list[float], n: int = 10_000, seed: int = 7) -> tuple[float, float]:
    """95% CI for the sum, resampling windows with replacement."""
    rng = random.Random(seed)
    k = len(values)
    sums = sorted(sum(rng.choice(values) for _ in range(k)) for _ in range(n))
    return sums[int(n * 0.025)], sums[int(n * 0.975)]


def max_drawdown(rows: list[dict]) -> float:
    eq = peak = dd = 0.0
    for r in sorted(rows, key=lambda x: x["close_utc"]):
        eq += r["net"]
        peak = max(peak, eq)
        dd = min(dd, eq - peak)
    return dd


def calibration(rows: list[dict]) -> list[tuple[str, int, float, float, float]]:
    """Entry-price buckets: implied vs realized win rate and net P&L."""
    buckets = defaultdict(list)
    for r in rows:
        buckets[min(r["entry"] // 10 * 10, 90)].append(r)
    out = []
    for lo in sorted(buckets):
        rs = buckets[lo]
        wins = sum(1 for r in rs if r["won"] == "1")
        implied = sum(r["entry"] for r in rs) / len(rs)
        out.append((f"{lo}-{lo+9}c", len(rs), implied, 100 * wins / len(rs),
                    sum(r["net"] for r in rs)))
    return out


def by_hour(rows: list[dict]) -> dict[int, float]:
    hours = defaultdict(float)
    for r in rows:
        hours[int(r["close_utc"][11:13])] += r["net"]
    return hours


def summarize(name: str, rows: list[dict]) -> dict:
    nets = [r["net"] for r in rows]
    wins = sum(1 for r in rows if r["won"] == "1")
    lo, hi = bootstrap_ci(nets)
    total = sum(nets)
    staked = sum(r["staked"] for r in rows)
    print(f"\n=== {name}: {len(rows)} settled trades ===")
    print(f"record        : {wins}W-{len(rows)-wins}L  ({100*wins/len(rows):.1f}%)")
    print(f"net P&L       : {total:+.2f}  (95% CI [{lo:+.2f}, {hi:+.2f}])")
    print(f"deployed      : {staked:.2f}   ROI {100*total/staked:+.2f}%")
    print(f"per trade     : {total/len(rows):+.3f}")
    print(f"max drawdown  : {max_drawdown(rows):.2f}")
    print("calibration (entry px -> realized win rate, breakeven needs realized > implied + fees):")
    for label, n, implied, realized, net in calibration(rows):
        edge = realized - implied
        print(f"  {label:7s} n={n:4d}  implied {implied:5.1f}%  realized {realized:5.1f}%  edge {edge:+5.1f}pp  net {net:+8.2f}")
    return {"nets": nets, "total": total, "ci": (lo, hi)}


def main() -> int:
    path_a, path_b = sys.argv[1], sys.argv[2]
    label_a = sys.argv[3] if len(sys.argv) > 3 else "A"
    label_b = sys.argv[4] if len(sys.argv) > 4 else "B"
    a, b = load(path_a), load(path_b)

    sa = summarize(label_a, list(a.values()))
    sb = summarize(label_b, list(b.values()))

    # Paired comparison on windows both traded — the fair head-to-head.
    shared = sorted(set(a) & set(b))
    diffs = [a[k]["net"] - b[k]["net"] for k in shared]
    lo, hi = bootstrap_ci(diffs)
    agree = sum(1 for k in shared if a[k]["side"] == b[k]["side"])
    print(f"\n=== paired ({label_a} minus {label_b}), {len(shared)} shared windows ===")
    print(f"same side chosen : {agree}/{len(shared)} ({100*agree/len(shared):.1f}%)")
    print(f"mean difference  : {sum(diffs)/len(diffs):+.3f} per window")
    print(f"total difference : {sum(diffs):+.2f}  (95% CI [{lo:+.2f}, {hi:+.2f}])")
    sig = "YES" if (lo > 0 or hi < 0) else "no — CI spans zero"
    print(f"statistically distinguishable: {sig}")

    print(f"\n=== net P&L by hour of day (UTC) ===")
    ha, hb = by_hour(list(a.values())), by_hour(list(b.values()))
    print(f"  hour  {label_a:>8s}  {label_b:>8s}")
    for h in range(24):
        if h in ha or h in hb:
            print(f"  {h:02d}:xx {ha.get(h,0):+8.2f}  {hb.get(h,0):+8.2f}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
