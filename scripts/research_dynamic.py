"""Research harness: dynamic strategy ideas tested against cached history.

NOT wired to the live trader — pure R&D. Each idea replaces a static rule
with a state-dependent one:

  A. vol-gate      : skip entries when trailing 30-min realized vol is high
                     (their losing days were the high-vol days)
  B. model-edge    : price the favorite from first principles — z = distance
                     from strike / expected residual move — and enter only
                     when the market underprices the model by a margin,
                     ignoring fixed price bands entirely
  C. capture-lock  : lock profit after capturing fraction k of the max
                     possible profit (dynamic per entry price, vs fixed 85c)
  D. model-salvage : exit a losing position early only when the market bid
                     exceeds the model's value of our side by a margin
                     (sell overpriced losers; never panic-sell cheap ones)

Usage: PYTHONPATH=. python scripts/research_dynamic.py [entries_csv]
"""

from __future__ import annotations

import csv
import math
import sys
from collections import defaultdict
from datetime import datetime, timezone
from statistics import NormalDist

from kbt.auth import KalshiSigner
from kbt.kalshi import KalshiClient, parse_candles
from kbt.spot import fetch_spot

N = NormalDist()
CONTRACTS = 10


def fee(n: float, p: float) -> float:
    return math.ceil(0.07 * n * p * (1 - p) * 100) / 100.0


def close_ts(ticker: str) -> int:
    part = ticker.split("-")[1]
    dt = datetime.strptime(part, "%y%b%d%H%M").replace(tzinfo=timezone.utc)
    return int(dt.timestamp() + 4 * 3600)


class Research:
    def __init__(self, entries_csv: str):
        self.client = KalshiClient(signer=KalshiSigner.from_env(), cache_dir=".cache")
        rows = [r for r in csv.DictReader(open(entries_csv)) if r["traded"] == "1" and r["won"] != ""]
        rows.sort(key=lambda r: r["close_utc"])
        self.rows = rows
        t0 = close_ts(rows[0]["ticker"]) - 3600
        t1 = close_ts(rows[-1]["ticker"]) + 600
        self.spot = fetch_spot(t0, t1, source="coinbase", cache_dir=".cache").prices
        self._c = {}

    def candles(self, ticker):
        if ticker not in self._c:
            ct = close_ts(ticker)
            self._c[ticker] = parse_candles(
                self.client.candlesticks(ticker, ct - 960, ct + 60, period_interval=1))
        return self._c[ticker]

    def spot_at(self, ts):
        for back in range(0, 300, 60):
            if (ts - back) // 60 * 60 in self.spot:
                return self.spot[(ts - back) // 60 * 60]
        return None

    def vol1m_bps(self, ts, lookback_min=30):
        """stdev of 1-min returns over the lookback, in bps."""
        rets = []
        for k in range(lookback_min):
            a = (ts - (k + 1) * 60) // 60 * 60
            b = (ts - k * 60) // 60 * 60
            if a in self.spot and b in self.spot:
                rets.append((self.spot[b] / self.spot[a] - 1) * 10_000)
        if len(rets) < 10:
            return None
        mu = sum(rets) / len(rets)
        return (sum((r - mu) ** 2 for r in rets) / len(rets)) ** 0.5

    def model_p_yes(self, ts, strike, mins_left):
        """P(spot_close > strike) from distance / expected residual move."""
        s = self.spot_at(ts)
        v = self.vol1m_bps(ts)
        if s is None or v is None or v <= 0:
            return None
        z = ((s - strike) / strike * 10_000) / (v * math.sqrt(max(mins_left, 0.5)))
        return N.cdf(z)

    # ---------------------------------------------------------------- engines
    def settle_pnl(self, r, e_px):
        won = r["won"] == "1"
        return (CONTRACTS * (1 - e_px) if won else -CONTRACTS * e_px) - fee(CONTRACTS, e_px)

    def run_baseline(self, lock_at=85):
        return self._run(self.rows, lock_at=lock_at)

    def _lock_scan(self, r, e_px, lock_price_c):
        """First minute the opposite ask allows locking at >= lock_price_c."""
        tick, side = r["ticker"], r["side"]
        ct = close_ts(tick)
        opp = "no" if side == "yes" else "yes"
        for cd in self.candles(tick):
            if cd.ts <= ct - 300 or cd.ts > ct:
                continue
            opp_ask = cd.ask(opp, "close")
            if opp_ask is not None and opp_ask <= 100 - lock_price_c:
                return opp_ask / 100.0
        return None

    def _run(self, rows, lock_at=None, lock_capture=None, vol_cut=None,
             salvage_margin=None):
        total, taken = 0.0, 0
        locks = salvages = wins = losses = 0
        eq = peak = dd = 0.0
        for r in rows:
            tick, side = r["ticker"], r["side"]
            e_px = int(r["entry_price_c"]) / 100.0
            ct = close_ts(tick)
            entry_ts = ct - 300
            if vol_cut is not None:
                v = self.vol1m_bps(entry_ts)
                if v is None or v * math.sqrt(15) > vol_cut:
                    continue
            taken += 1
            lock_c = None
            if lock_at:
                lock_c = lock_at
            elif lock_capture:
                lock_c = min(99.0, e_px * 100 + lock_capture * (100 - e_px * 100))
            pnl = None
            if lock_c:
                lp = self._lock_scan(r, e_px, lock_c)
                if lp is not None:
                    pnl = CONTRACTS * (1 - e_px - lp) - fee(CONTRACTS, e_px) - fee(CONTRACTS, lp)
                    locks += 1
            if pnl is None and salvage_margin is not None:
                strike = float(r["strike"])
                opp = "no" if side == "yes" else "yes"
                for cd in self.candles(tick):
                    if cd.ts <= entry_ts + 60 or cd.ts > ct - 60:
                        continue
                    bid = cd.bid(side)
                    if bid is None:
                        continue
                    mins_left = (ct - cd.ts) / 60
                    pm = self.model_p_yes(cd.ts, strike, mins_left)
                    if pm is None:
                        continue
                    p_side = pm if side == "yes" else 1 - pm
                    if bid / 100.0 >= p_side + salvage_margin and bid / 100.0 < e_px - 0.05:
                        pnl = CONTRACTS * (bid / 100.0 - e_px) - fee(CONTRACTS, e_px) - fee(CONTRACTS, bid / 100.0)
                        salvages += 1
                        break
            if pnl is None:
                pnl = self.settle_pnl(r, e_px)
                if r["won"] == "1":
                    wins += 1
                else:
                    losses += 1
            total += pnl
            eq += pnl
            peak = max(peak, eq)
            dd = min(dd, eq - peak)
        return {"taken": taken, "net": total, "dd": dd, "locks": locks,
                "salvages": salvages, "settle_w": wins, "settle_l": losses}

    def run_model_edge(self, edge=0.05, floor_c=55, cap_c=92, lock_at=85):
        """Idea B: enter when model prob beats market ask by >= edge."""
        total, taken, locks, wins, losses = 0.0, 0, 0, 0, 0
        eq = peak = dd = 0.0
        # evaluate EVERY market in the entry file's window, not just band entries
        for r in self.rows_all:
            tick = r["ticker"]
            ct = close_ts(tick)
            entry_ts = ct - 300
            strike = float(r["strike"])
            pm = self.model_p_yes(entry_ts, strike, 5)
            if pm is None:
                continue
            cds = [c for c in self.candles(tick) if c.ts <= entry_ts]
            if not cds:
                continue
            cd = cds[-1]
            for side, p_model in (("yes", pm), ("no", 1 - pm)):
                ask = cd.ask(side, "close")
                if ask is None or not floor_c < ask <= cap_c:
                    continue
                if p_model - ask / 100.0 < edge:
                    continue
                e_px = ask / 100.0
                taken += 1
                lp = None
                if lock_at:
                    fake = {"ticker": tick, "side": side}
                    lp = self._lock_scan(fake, e_px, lock_at)
                if lp is not None:
                    pnl = CONTRACTS * (1 - e_px - lp) - fee(CONTRACTS, e_px) - fee(CONTRACTS, lp)
                    locks += 1
                else:
                    won = (r["result"] == side)
                    pnl = (CONTRACTS * (1 - e_px) if won else -CONTRACTS * e_px) - fee(CONTRACTS, e_px)
                    wins += won
                    losses += not won
                eq += pnl
                peak = max(peak, eq)
                dd = min(dd, eq - peak)
                total += pnl
                break  # one side max per market
        return {"taken": taken, "net": total, "dd": dd, "locks": locks,
                "salvages": 0, "settle_w": wins, "settle_l": losses}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "results_sf_entries/trades.csv"
    R = Research(path)
    # results for EVERY market in the window come from the cached discovery pages
    import glob
    import json as _json
    results = {}
    for p in glob.glob(".cache/markets_KXBTC15M_*.json"):
        try:
            for m in _json.load(open(p)).get("markets", []):
                res = (m.get("result") or "").strip().lower()
                if res in ("yes", "no"):
                    results[m.get("ticker")] = res
        except ValueError:
            continue
    R.rows_all = []
    for r in csv.DictReader(open(path)):
        res = results.get(r["ticker"], "")
        if res:
            r["result"] = res
            R.rows_all.append(r)
    print(f"{len(R.rows)} baseline entries; {len(R.rows_all)} settled markets for model-edge\n")

    def show(name, res):
        print(f"{name:34s} n={res['taken']:4d}  net {res['net']:+8.2f}  DD {res['dd']:7.2f}  "
              f"locks {res['locks']:3d}  salv {res['salvages']:3d}  {res['settle_w']}W/{res['settle_l']}L")

    show("baseline lock-85 (live config)", R.run_baseline(85))
    for cut in (12, 15, 18):
        show(f"A: vol-gate <{cut}bps/15m + lock-85", R._run(R.rows, lock_at=85, vol_cut=cut))
    for k in (0.5, 0.65, 0.8):
        show(f"C: capture-lock k={k}", R._run(R.rows, lock_capture=k))
    for m in (0.05, 0.10):
        show(f"D: model-salvage margin={m:.0%}", R._run(R.rows, lock_at=85, salvage_margin=m))
    for e in (0.05, 0.08):
        show(f"B: model-edge >={e:.0%} (55-92c)", R.run_model_edge(edge=e))


if __name__ == "__main__":
    main()
