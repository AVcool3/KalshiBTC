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
        max_daily_loss: float = 15.0,  # halt entries for the UTC day (0 = off)
        stake_step: float = 0.0,  # grow stake by this per stake_per of growth (0 = fixed)
        stake_per: float = 20.0,
        stake_cap: float = 20.0,  # hard ceiling on stake, bug blast-radius guard
        live: bool = False,
    ):
        self.cfg = cfg
        self.signer = signer
        self.series = series
        self.journal_path = journal_path
        self.min_balance_cents = min_balance_cents
        self.max_daily_loss = max_daily_loss
        self.stake_step = stake_step
        self.stake_per = stake_per
        self.stake_cap = stake_cap
        self.live = live
        self._result_cache: dict[str, str] = {}  # settled ticker -> "yes"/"no"
        self.anchor_path = os.path.join(os.path.dirname(journal_path) or ".", "stake_anchor.json")
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

    # ------------------------------------------------------- circuit breaker
    def _entries_for_day(self, day: str) -> list[dict]:
        """Live orders journaled on `day` (UTC), from this and prior restarts."""
        entries = []
        try:
            with open(self.journal_path) as fh:
                for line in fh:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                    if (
                        e.get("action") == "order"
                        and e.get("live")
                        and str(e.get("ts", "")).startswith(day)
                        and e.get("ticker") and e.get("side") and e.get("contracts")
                    ):
                        entries.append(e)
        except FileNotFoundError:
            pass
        return entries

    def realized_today(self, day: Optional[str] = None) -> float:
        """Net P&L of today's settled entries (order-priced; IOC fills may
        be slightly better, so this under-counts wins if anything)."""
        day = day or datetime.now(timezone.utc).strftime("%Y-%m-%d")
        total = 0.0
        for e in self._entries_for_day(day):
            ticker = e["ticker"]
            result = self._result_cache.get(ticker)
            if result is None:
                m = self.client.get(f"/markets/{ticker}").get("market", {})
                result = (m.get("result") or "").strip().lower()
                if result in ("yes", "no"):
                    self._result_cache[ticker] = result
            if result not in ("yes", "no"):
                continue  # still open
            contracts = float(e["contracts"])
            price = float(e["price"])
            cost = contracts * price / 100.0
            fee = self.cfg.fee_for(contracts, int(round(price)))
            won = result == e["side"]
            total += (contracts - cost - fee) if won else (-cost - fee)
        return total

    # --------------------------------------------------------- stake ladder
    def bot_realized_pnl(self) -> float:
        """Cumulative realized P&L of the bot's own journaled entries, all
        days. Manual trading on the account is invisible here by design."""
        total = 0.0
        for e in self._entries_for_day(""):  # "" prefix matches every day
            ticker = e["ticker"]
            result = self._result_cache.get(ticker)
            if result is None:
                m = self.client.get(f"/markets/{ticker}").get("market", {})
                result = (m.get("result") or "").strip().lower()
                if result in ("yes", "no"):
                    self._result_cache[ticker] = result
            if result not in ("yes", "no"):
                continue
            contracts = float(e["contracts"])
            price = float(e["price"])
            cost = contracts * price / 100.0
            fee = self.cfg.fee_for(contracts, int(round(price)))
            total += (contracts - cost - fee) if result == e["side"] else (-cost - fee)
        return total

    def stake_for(self, bot_pnl: Optional[float]) -> float:
        """Base stake plus stake_step per full stake_per of the bot's own
        cumulative profit. Steps back down as profit retraces; never below
        base. Manual account activity does not move this ladder."""
        base = self.cfg.stake
        if not self.stake_step or bot_pnl is None:
            return base
        steps = max(0, int(bot_pnl // self.stake_per))
        return min(base + steps * self.stake_step, self.stake_cap)

    def daily_halt_reason(self) -> Optional[str]:
        if not (self.live and self.max_daily_loss > 0):
            return None
        realized = self.realized_today()
        if realized <= -self.max_daily_loss:
            return f"circuit breaker: {realized:+.2f} today breaches -{self.max_daily_loss:.2f}, halted until next UTC day"
        return None

    # -------------------------------------------------------------- decision
    def decide(self, now: Optional[int] = None) -> TickOutcome:
        now = int(now or time.time())
        halt = self.daily_halt_reason()
        if halt:
            return TickOutcome("skip", halt)
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
        if ask > self.cfg.max_odds:
            return TickOutcome(
                "skip", f"{side} at {ask:.1f}c, above {self.cfg.max_odds}c cap (no edge up there)",
                m.ticker, side, ask,
            )

        if self.cfg.contracts:
            contracts = self.cfg.contracts
            stake = contracts * ask_dollars
        else:
            try:
                stake = self.stake_for(self.bot_realized_pnl() if self.live else None)
            except Exception:  # noqa: BLE001 - sizing must never kill a tick
                stake = self.cfg.stake
            contracts = int(stake // ask_dollars)
        if contracts < 1:
            return TickOutcome("skip", f"${stake:.2f} buys 0 contracts at {ask:.1f}c", m.ticker, side, ask)

        if self.live:
            bal = self.balance_cents()
            need = contracts * ask + 100  # order cost + fee headroom
            if bal is not None and bal - need < self.min_balance_cents:
                return TickOutcome(
                    "skip",
                    f"balance floor: ${bal/100:.2f} minus ~${need/100:.2f} would breach ${self.min_balance_cents/100:.2f}",
                    m.ticker, side, ask,
                )
            out = self._place(m.ticker, side, ask_str, contracts)
            for _ in range(2):  # up to two more attempts at re-read quotes
                if out.action != "no_fill":
                    break
                nxt = self._retry_at_fresh_quote(m.ticker, side, stake, now)
                if nxt is None:
                    break
                out = nxt
            return out

        return TickOutcome(
            "dry_run",
            f"would buy {contracts}x {side.upper()} at {ask:.1f}c "
            f"(spot {spot:,.2f} vs strike {m.strike:,.2f}, closes in {seconds_to_close//60}m)",
            m.ticker, side, ask, contracts,
        )

    def _retry_at_fresh_quote(
        self, ticker: str, side: str, stake: float, now: int
    ) -> Optional[TickOutcome]:
        """After an empty IOC, try once more at the re-read quote."""
        fresh = self.current_market(now)
        if not fresh or fresh["market"].ticker != ticker:
            return None
        ask_str = fresh["raw"].get(f"{side}_ask_dollars") or ""
        try:
            ask = float(ask_str) * 100.0
        except ValueError:
            return None
        if not 0 < ask < 100 or ask <= self.cfg.min_odds or ask > self.cfg.max_odds:
            return None
        contracts = self.cfg.contracts or int(stake // (ask / 100.0))
        if contracts < 1:
            return None
        out = self._place(ticker, side, ask_str, contracts)
        out.detail = "retry: " + out.detail
        return out

    @staticmethod
    def book_order(side: str, price_dollars: str, buffer_cents: float = 0.0) -> tuple[str, str]:
        """Map a buy of `side` at its quoted ask onto the V2 single (YES) book:
          buy YES at P   -> bid at P
          buy NO  at 1-P -> ask at P (selling YES you don't hold = long NO)
        buffer_cents pays up to that much through the quote so the IOC still
        fills when the market ticks away between read and submit; the limit
        keeps it from paying more than quote + buffer.
        """
        pay = min(float(price_dollars) + buffer_cents / 100.0, 0.99)
        if side == "yes":
            return "bid", f"{pay:.4f}"
        return "ask", f"{max(1.0 - pay, 0.01):.4f}"

    def _place(
        self, ticker: str, side: str, price_dollars: str, contracts: int, buffer_cents: float = 2.0
    ) -> TickOutcome:
        book_side, book_price = self.book_order(side, price_dollars, buffer_cents)
        client_order_id = str(uuid.uuid4())
        body = {
            "ticker": ticker,
            "client_order_id": client_order_id,
            "side": book_side,
            "count": str(contracts),
            "price": book_price,
            "time_in_force": "immediate_or_cancel",
            "self_trade_prevention_type": "taker_at_cross",
        }
        path = "/portfolio/events/orders"
        url = f"{self.client.base_url}{path}"
        headers = self.signer.headers("POST", f"/trade-api/v2{path}")
        r = self.client.session.post(url, json=body, headers=headers, timeout=15)
        cents = float(price_dollars) * 100.0
        if r.status_code >= 300:
            return TickOutcome("error", f"order rejected {r.status_code}: {r.text[:200]}", ticker, side, cents)
        order = r.json().get("order", {})
        order_id = str(order.get("order_id") or order.get("id") or "")
        if not order_id:
            order_id = self._order_id_from_client_id(ticker, client_order_id)
        filled, avg_cents = self._fill_stats(order_id, side)
        if avg_cents is not None:
            cents = avg_cents  # journal the price actually paid, not the quote
        if filled is None:
            # Fill feed unreachable: assume filled as ordered so the circuit
            # breaker counts the risk; the journal marks it unverified.
            return TickOutcome(
                "order",
                f"IOC {side.upper()} at {cents:.1f}c ({book_side} {book_price}) fill unverified, assuming {contracts}",
                ticker, side, cents, contracts, order_id,
            )
        if filled <= 0:
            return TickOutcome("no_fill", f"IOC {contracts}x {side.upper()} at {cents:.1f}c canceled unfilled",
                               ticker, side, cents, 0, order_id)
        return TickOutcome(
            "order",
            f"IOC {side.upper()} at {cents:.1f}c ({book_side} {book_price}) filled {filled:g}/{contracts}",
            ticker, side, cents, filled, order_id,
        )

    def _order_id_from_client_id(self, ticker: str, client_order_id: str) -> str:
        """Resolve our client_order_id to the exchange order_id."""
        try:
            data = self.client.get("/portfolio/orders", params={"ticker": ticker, "limit": 20})
            for o in data.get("orders", []):
                if o.get("client_order_id") == client_order_id:
                    return str(o.get("order_id") or o.get("id") or "")
        except Exception:  # noqa: BLE001
            pass
        return ""

    def _fill_stats(self, order_id: str, side: str) -> tuple[Optional[float], Optional[float]]:
        """(contracts filled, average price paid in cents) or (None, None)."""
        if not order_id:
            return None, None
        time.sleep(1.0)  # give the fill a moment to land
        try:
            fills = self.client.get("/portfolio/fills", params={"order_id": order_id, "limit": 50})
            count, notional = 0.0, 0.0
            for f in fills.get("fills", []):
                n = float(f.get("count_fp") or f.get("count") or 0)
                px = f.get(f"{side}_price_dollars")
                count += n
                if px is not None:
                    notional += n * float(px) * 100.0
            avg = (notional / count) if count > 0 and notional > 0 else None
            return count, avg
        except Exception:  # noqa: BLE001
            return None, None

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
