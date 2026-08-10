"""Live trader for the adopted strategy: $5 on the >60c favorite at T-7.

Safety model:
  * Dry-run is the default everywhere. Orders are only sent with live=True,
    which the CLI gates behind an explicit --live flag.
  * One entry per market, no adds, no averaging down — the backtested ladder
    is not implemented here at all.
  * A balance floor stops trading rather than running the account to zero.
  * Every decision (traded or skipped) is appended to a JSONL journal.

The loop wakes at T-<lead> before each quarter-hour close, decides, places at
most one limit order at the standing ask, and goes back to sleep.
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

import requests

from .auth import KalshiSigner
from .config import StrategyConfig
from .kalshi import DEFAULT_BASE, SERIES, KalshiClient, parse_market

SPOT_URL = "https://api.exchange.coinbase.com/products/BTC-USD/ticker"


@dataclass
class TickOutcome:
    action: str  # "order" | "dry_run" | "skip" | "error"
    detail: str
    ticker: str = ""
    side: str = ""
    price: Optional[float] = None  # cents, fractional on sub-cent ticks
    contracts: int = 0
    order_id: str = ""

    def as_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v not in ("", None, 0)} | {
            "action": self.action,
            "detail": self.detail,
        }


class LiveTrader:
    def __init__(
        self,
        cfg: StrategyConfig,
        signer: Optional[KalshiSigner],
        base_url: str = DEFAULT_BASE,
        series: str = SERIES,
        journal_path: str = "live/journal.jsonl",
        min_balance_cents: int = 2000,  # stop trading below $20
        live: bool = False,
    ):
        self.cfg = cfg
        self.signer = signer
        self.series = series
        self.journal_path = journal_path
        self.min_balance_cents = min_balance_cents
        self.live = live
        self.client = KalshiClient(base_url=base_url, signer=signer, cache_dir=None)
        if live and signer is None:
            raise RuntimeError(
                "--live requires credentials: set KALSHI_KEY_ID (or KalshiKEY) and "
                "KALSHI_PRIVATE_KEY or KALSHI_PRIVATE_KEY_PATH"
            )
        os.makedirs(os.path.dirname(journal_path) or ".", exist_ok=True)

    # ------------------------------------------------------------- data taps
    def spot(self) -> float:
        r = requests.get(SPOT_URL, timeout=10, headers={"User-Agent": "kbt/0.1"})
        r.raise_for_status()
        return float(r.json()["price"])

    def balance_cents(self) -> Optional[int]:
        if self.signer is None:
            return None
        data = self.client.get("/portfolio/balance")
        return int(data.get("balance", 0))

    def current_market(self, now: Optional[int] = None) -> Optional[dict]:
        """The open market whose close is nearest after now."""
        now = int(now or time.time())
        raw = self.client.markets(
            series_ticker=self.series,
            min_close_ts=now,
            max_close_ts=now + 1800,
            status="open",
        )
        candidates = []
        for r in raw:
            m = parse_market(r, self.series)
            if m and abs(m.duration_min - 15.0) <= 3.0:
                candidates.append((m, r))
        if not candidates:
            return None
        m, r = min(candidates, key=lambda t: t[0].close_ts)
        return {"market": m, "raw": r}

    # -------------------------------------------------------------- decision
    def decide(self, now: Optional[int] = None) -> TickOutcome:
        now = int(now or time.time())
        found = self.current_market(now)
        if not found:
            return TickOutcome("skip", "no open 15-minute market found")
        m, raw = found["market"], found["raw"]

        seconds_to_close = m.close_ts - now
        if seconds_to_close < 60:
            return TickOutcome("skip", f"too close to settlement ({seconds_to_close}s)", m.ticker)

        try:
            spot = self.spot()
        except Exception as exc:  # noqa: BLE001
            return TickOutcome("error", f"spot fetch failed: {exc}", m.ticker)

        side = "yes" if spot > m.strike else "no"
        # Live markets quote dollar strings with sub-cent ticks
        # (price_level_structure "tapered_deci_cent"), and each side's ask
        # comes pre-computed: yes_ask_dollars / no_ask_dollars.
        ask_str = raw.get(f"{side}_ask_dollars") or ""
        try:
            ask_dollars = float(ask_str)
        except ValueError:
            return TickOutcome("skip", f"market quote missing {side} ask", m.ticker, side)
        ask = ask_dollars * 100.0  # cents, possibly fractional
        if not 0 < ask < 100:
            return TickOutcome("skip", f"no offer on {side} side", m.ticker, side)
        if ask <= self.cfg.min_odds:
            return TickOutcome(
                "skip", f"{side} at {ask:.1f}c, gate is >{self.cfg.min_odds}c", m.ticker, side, ask
            )

        contracts = int(self.cfg.stake // ask_dollars)
        if contracts < 1:
            return TickOutcome("skip", f"${self.cfg.stake:.2f} buys 0 contracts at {ask:.1f}c", m.ticker, side, ask)

        if self.live:
            bal = self.balance_cents()
            need = contracts * ask + 100  # order cost + fee headroom
            if bal is not None and bal - need < self.min_balance_cents:
                return TickOutcome(
                    "skip",
                    f"balance floor: ${bal/100:.2f} minus ~${need/100:.2f} would breach ${self.min_balance_cents/100:.2f}",
                    m.ticker, side, ask,
                )
            return self._place(m.ticker, side, ask_str, contracts)

        return TickOutcome(
            "dry_run",
            f"would buy {contracts}x {side.upper()} at {ask:.1f}c "
            f"(spot {spot:,.2f} vs strike {m.strike:,.2f}, closes in {seconds_to_close//60}m)",
            m.ticker, side, ask, contracts,
        )

    def _place(self, ticker: str, side: str, price_dollars: str, contracts: int) -> TickOutcome:
        # Send the ask exactly as quoted (dollar string) so the price is
        # always on a valid tick, sub-cent tapers included.
        body = {
            "ticker": ticker,
            "client_order_id": str(uuid.uuid4()),
            "action": "buy",
            "side": side,
            "type": "limit",
            "count": contracts,
            f"{side}_price_dollars": price_dollars,
        }
        path = "/portfolio/orders"
        url = f"{self.client.base_url}{path}"
        headers = self.signer.headers("POST", f"/trade-api/v2{path}")
        r = self.client.session.post(url, json=body, headers=headers, timeout=15)
        cents = float(price_dollars) * 100.0
        if r.status_code >= 300:
            return TickOutcome("error", f"order rejected {r.status_code}: {r.text[:200]}", ticker, side, cents)
        order = r.json().get("order", {})
        return TickOutcome(
            "order",
            f"placed {contracts}x {side.upper()} at {cents:.1f}c",
            ticker, side, cents, contracts, order.get("order_id", ""),
        )

    # ----------------------------------------------------------------- loop
    def journal(self, outcome: TickOutcome) -> None:
        entry = {"ts": datetime.now(timezone.utc).isoformat(), "live": self.live} | outcome.as_dict()
        with open(self.journal_path, "a") as fh:
            fh.write(json.dumps(entry) + "\n")

    def tick(self) -> TickOutcome:
        try:
            outcome = self.decide()
        except Exception as exc:  # noqa: BLE001 - the loop must survive anything
            outcome = TickOutcome("error", f"tick failed: {exc}")
        self.journal(outcome)
        print(f"[{datetime.now(timezone.utc):%H:%M:%S}] {outcome.action}: {outcome.detail}", flush=True)
        return outcome

    def next_decision_ts(self, now: Optional[float] = None) -> int:
        """The next quarter-hour close minus the entry lead."""
        now = now or time.time()
        quarter = 900
        next_close = (int(now) // quarter + 1) * quarter
        decision = next_close - self.cfg.entry_lead_s
        while decision <= now:
            next_close += quarter
            decision = next_close - self.cfg.entry_lead_s
        return decision

    def run_forever(self) -> None:
        mode = "LIVE" if self.live else "dry-run"
        print(f"kbt live trader ({mode}): ${self.cfg.stake:.2f} on >{self.cfg.min_odds}c "
              f"favorite at T-{self.cfg.entry_lead_s // 60}min, no adds", flush=True)
        while True:
            target = self.next_decision_ts()
            wait = target - time.time()
            print(f"next decision {datetime.fromtimestamp(target, tz=timezone.utc):%H:%M:%S}Z "
                  f"({wait/60:.1f}m)", flush=True)
            time.sleep(max(1.0, wait))
            self.tick()
            time.sleep(2)  # step past the decision second before recomputing
