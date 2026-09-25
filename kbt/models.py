"""Data structures shared by the fetch layer and the simulation engine.

All Kalshi prices are carried as integer cents (1..99). Spot prices are floats
in USD. Timestamps are integer unix seconds, UTC.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

YES = "yes"
NO = "no"


@dataclass(frozen=True)
class Candle:
    """One minute of Kalshi order-book history for a single market.

    Kalshi quotes everything from the YES side, so the NO book is derived:
    no_ask = 100 - yes_bid, no_bid = 100 - yes_ask.
    """

    ts: int  # end_period_ts: the candle covers (ts - interval, ts]
    yes_bid_close: int
    yes_ask_close: int
    yes_bid_low: int
    yes_bid_high: int
    yes_ask_low: int
    yes_ask_high: int
    last_price: Optional[int] = None
    volume: int = 0

    def ask(self, side: str, mode: str = "close") -> Optional[int]:
        """Cost in cents to buy one contract of `side`.

        mode="close" uses the quote standing at the end of the minute.
        mode="low" uses the best (cheapest) offer seen inside the minute.
        """
        if side == YES:
            px = self.yes_ask_close if mode == "close" else self.yes_ask_low
        else:
            # Buying NO lifts the YES bid: the cheapest NO ask corresponds to
            # the highest YES bid printed during the candle.
            yes = self.yes_bid_close if mode == "close" else self.yes_bid_high
            px = None if yes is None else 100 - yes
        return _valid(px)

    def bid(self, side: str) -> Optional[int]:
        """Proceeds in cents from selling one contract of `side` at the close."""
        if side == YES:
            return _valid(self.yes_bid_close)
        ask = self.yes_ask_close
        return None if ask is None else _valid(100 - ask)

    def mid(self, side: str) -> Optional[float]:
        b, a = self.bid(side), self.ask(side)
        if b is None or a is None:
            return None
        return (b + a) / 2.0


def _valid(px: Optional[int]) -> Optional[int]:
    """Kalshi quotes 0 or 100 when a side of the book is empty/locked."""
    if px is None:
        return None
    return int(px) if 0 < px < 100 else None


@dataclass
class Market:
    """A single KXBTC15M market (one 15-minute up/down window)."""

    ticker: str
    event_ticker: str
    series_ticker: str
    open_ts: int
    close_ts: int
    strike: float  # floor_strike: BTC reference the window is measured against
    result: str = ""  # "yes" | "no" | "" when not yet settled
    title: str = ""

    @property
    def duration_min(self) -> float:
        return (self.close_ts - self.open_ts) / 60.0


@dataclass
class MarketData:
    """Everything the engine needs to simulate one market, offline."""

    market: Market
    candles: list[Candle] = field(default_factory=list)
    spot: dict[int, float] = field(default_factory=dict)  # minute ts -> BTC USD

    def candle_at(self, ts: int) -> Optional[Candle]:
        for c in self.candles:
            if c.ts == ts:
                return c
        return None

    def spot_at(self, ts: int, max_staleness_s: int = 300) -> Optional[float]:
        """Most recent spot print at or before `ts`."""
        best_ts = None
        for t in self.spot:
            if t <= ts and (best_ts is None or t > best_ts):
                best_ts = t
        if best_ts is None or ts - best_ts > max_staleness_s:
            return None
        return self.spot[best_ts]


@dataclass
class Fill:
    ts: int
    side: str
    price: int  # cents
    contracts: int
    cost: float  # dollars, contracts * price/100
    fee: float  # dollars
    kind: str  # "entry" | "add"
    spot: Optional[float] = None
    distance_bps: Optional[float] = None  # |spot - strike| / strike, in bps


@dataclass
class MarketResult:
    market: Market
    traded: bool
    skip_reason: str = ""
    side: str = ""
    fills: list[Fill] = field(default_factory=list)
    won: Optional[bool] = None
    contracts: int = 0
    cost: float = 0.0  # dollars paid for contracts
    fees: float = 0.0
    payout: float = 0.0  # dollars returned at settlement
    entry_price: Optional[int] = None
    entry_spot: Optional[float] = None
    entry_distance_bps: Optional[float] = None

    @property
    def gross_pnl(self) -> float:
        return self.payout - self.cost

    @property
    def net_pnl(self) -> float:
        return self.payout - self.cost - self.fees

    @property
    def staked(self) -> float:
        return self.cost + self.fees

    @property
    def adds(self) -> int:
        return max(0, len(self.fills) - 1)
