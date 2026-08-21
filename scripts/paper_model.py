"""Paper shadow-trader for the model-edge + model-salvage strategy.

ZERO ORDERS — pure forward test. Each quarter-hour at T-5 it prices both
sides from first principles (spot distance from strike / expected residual
move at trailing vol), "enters" when the market underprices a side by the
edge margin, then follows the position minute-by-minute applying the
lock-85 and salvage rules against live quotes. Every decision and outcome
is journaled to live/paper_model.jsonl for comparison with the live bot.

Usage: PYTHONPATH=. python scripts/paper_model.py  (runs forever)
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from statistics import NormalDist

import requests

from kbt.auth import KalshiSigner
from kbt.kalshi import KalshiClient, parse_market

N = NormalDist()
CONTRACTS = 10
EDGE = 0.05
FLOOR_C, CAP_C = 55, 92
LOCK_AT = 85
SALVAGE_MARGIN = 0.10
JOURNAL = "live/paper_model.jsonl"


def fee(n, p):
    return math.ceil(0.07 * n * p * (1 - p) * 100) / 100.0


def log(entry):
    entry["ts"] = datetime.now(timezone.utc).isoformat()
    with open(JOURNAL, "a") as fh:
        fh.write(json.dumps(entry) + "\n")
    print(f"[{entry['ts'][11:19]}] paper {entry.get('action')}: {entry.get('detail','')}", flush=True)


class Paper:
    def __init__(self):
        self.client = KalshiClient(signer=KalshiSigner.from_env(), cache_dir=None)
        self.spot_hist: dict[int, float] = {}

    def spot(self):
        """Live price; also refreshes the 1-min history the vol model needs."""
        now = int(time.time())
        if not self.spot_hist or max(self.spot_hist) < now - 120:
            from kbt.spot import fetch_spot
            try:
                self.spot_hist = dict(fetch_spot(now - 2400, now, source="coinbase").prices)
            except Exception:
                pass
        r = requests.get("https://api.exchange.coinbase.com/products/BTC-USD/ticker",
                         timeout=10, headers={"User-Agent": "kbt/0.1"})
        r.raise_for_status()
        px = float(r.json()["price"])
        self.spot_hist[now // 60 * 60] = px
        cutoff = now - 3600
        self.spot_hist = {t: p for t, p in self.spot_hist.items() if t > cutoff}
        return px

    def vol1m_bps(self):
        ts = sorted(self.spot_hist)
        rets = [(self.spot_hist[b] / self.spot_hist[a] - 1) * 10_000
                for a, b in zip(ts, ts[1:]) if b - a == 60]
        if len(rets) < 10:
            return None
        mu = sum(rets) / len(rets)
        return (sum((r - mu) ** 2 for r in rets) / len(rets)) ** 0.5

    def market(self):
        now = int(time.time())
        raw = self.client.markets(min_close_ts=now, max_close_ts=now + 1800, status="open")
        best = None
        for r in raw:
            m = parse_market(r)
            if m and abs(m.duration_min - 15.0) <= 3.0:
                if best is None or m.close_ts < best[0].close_ts:
                    best = (m, r)
        return best

    def p_yes(self, spot, strike, mins_left):
        v = self.vol1m_bps()
        if v is None or v <= 0:
            return None
        z = ((spot - strike) / strike * 10_000) / (v * math.sqrt(max(mins_left, 0.5)))
        return N.cdf(z)

    def tick(self):
        found = self.market()
        if not found:
            log({"action": "skip", "detail": "no open market"})
            return
        m, raw = found
        spot = self.spot()
        mins_left = (m.close_ts - time.time()) / 60
        pm = self.p_yes(spot, m.strike, mins_left)
        if pm is None:
            log({"action": "skip", "detail": "vol history warming up", "ticker": m.ticker})
            return
        for side, p_model in (("yes", pm), ("no", 1 - pm)):
            ask_s = raw.get(f"{side}_ask_dollars") or ""
            try:
                ask = float(ask_s) * 100
            except ValueError:
                continue
            if not FLOOR_C < ask <= CAP_C:
                continue
            edge = p_model - ask / 100.0
            if edge < EDGE:
                continue
            log({"action": "enter", "ticker": m.ticker, "side": side, "price": ask,
                 "contracts": CONTRACTS, "model_p": round(p_model, 3), "edge": round(edge, 3),
                 "detail": f"{CONTRACTS}x {side.upper()} at {ask:.1f}c (model {p_model:.0%}, edge {edge:+.0%})"})
            self.follow(m, side, ask / 100.0)
            return
        log({"action": "skip", "ticker": m.ticker,
             "detail": f"no edge (model yes={pm:.0%}, yes_ask={raw.get('yes_ask_dollars')}, no_ask={raw.get('no_ask_dollars')})"})

    def follow(self, m, side, e_px):
        """Poll to close applying lock-85 then salvage-10 rules."""
        opp = "no" if side == "yes" else "yes"
        while time.time() < m.close_ts - 8:
            time.sleep(15)
            try:
                mk = self.client.get(f"/markets/{m.ticker}").get("market", {})
                spot = self.spot()
            except Exception:
                continue
            try:
                opp_ask = float(mk.get(f"{opp}_ask_dollars") or "nan")
                side_bid = float(mk.get(f"{side}_bid_dollars") or "nan")
            except ValueError:
                continue
            if opp_ask == opp_ask and opp_ask <= (100 - LOCK_AT) / 100.0:
                pnl = CONTRACTS * (1 - e_px - opp_ask) - fee(CONTRACTS, e_px) - fee(CONTRACTS, opp_ask)
                log({"action": "lock", "ticker": m.ticker, "side": opp, "price": opp_ask * 100,
                     "contracts": CONTRACTS, "pnl": round(pnl, 2),
                     "detail": f"locked at {opp_ask*100:.1f}c -> {pnl:+.2f}"})
                return
            mins_left = (m.close_ts - time.time()) / 60
            pmod = self.p_yes(spot, m.strike, mins_left)
            if pmod is None or side_bid != side_bid:
                continue
            p_side = pmod if side == "yes" else 1 - pmod
            if side_bid >= p_side + SALVAGE_MARGIN and side_bid < e_px - 0.05:
                pnl = CONTRACTS * (side_bid - e_px) - fee(CONTRACTS, e_px) - fee(CONTRACTS, side_bid)
                log({"action": "salvage", "ticker": m.ticker, "side": side, "price": side_bid * 100,
                     "contracts": CONTRACTS, "pnl": round(pnl, 2),
                     "detail": f"salvaged at {side_bid*100:.1f}c (model {p_side:.0%}) -> {pnl:+.2f}"})
                return
        # rode to settlement — resolve when the result posts
        for _ in range(20):
            time.sleep(30)
            mk = self.client.get(f"/markets/{m.ticker}").get("market", {})
            res = (mk.get("result") or "").strip().lower()
            if res in ("yes", "no"):
                won = res == side
                pnl = (CONTRACTS * (1 - e_px) if won else -CONTRACTS * e_px) - fee(CONTRACTS, e_px)
                log({"action": "settle", "ticker": m.ticker, "won": won, "pnl": round(pnl, 2),
                     "detail": f"settled {res.upper()} -> {pnl:+.2f}"})
                return
        log({"action": "settle", "ticker": m.ticker, "detail": "result never posted"})

    def run(self):
        print("paper model-trader (NO ORDERS): edge>=5%, 55-92c, lock 85, salvage 10%", flush=True)
        while True:
            now = time.time()
            next_close = (int(now) // 900 + 1) * 900
            # offset 20s after the live trader's T-5 tick to avoid contention
            target = next_close - 300 + 20
            if target <= now:
                target += 900
            time.sleep(max(1.0, target - now))
            try:
                self.tick()
            except Exception as exc:  # noqa: BLE001
                log({"action": "error", "detail": str(exc)[:200]})
            time.sleep(2)


if __name__ == "__main__":
    Paper().run()
