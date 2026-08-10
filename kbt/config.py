"""Strategy parameters.

Defaults encode the strategy exactly as specified:

  * 7 minutes before close, buy $5 of whichever side BTC is currently on,
    but only if that side is trading above 60%.
  * If the price falls 5% below the last fill AND BTC is still at least
    0.02% away from the strike, buy $5 more.
  * Repeat until the market closes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass
class StrategyConfig:
    # --- entry ---
    entry_lead_s: int = 7 * 60  # decide this many seconds before close
    stake: float = 5.00  # dollars per buy
    min_odds: int = 60  # buy only if the side trades strictly above this (cents)

    # --- adds ---
    dip_pct: float = 5.0  # add after a 5% drop...
    dip_mode: str = "rel_last"  # ...measured off the last fill ("rel_last"),
    # the first fill ("rel_first"), or in cents ("abs")
    min_distance_bps: float = 2.0  # 0.02% = 2 bps of BTC distance from strike
    max_adds: int = 0  # 0 = unlimited, per "continue till market close"

    # --- execution ---
    price_source: str = "ask"  # "ask" | "mid" | "last" — drives odds check + fills
    fill_mode: str = "close"  # "close" = end-of-minute quote, "low" = best in minute
    whole_contracts: bool = True  # Kalshi contracts are integers

    # --- costs ---
    fees: bool = True
    fee_rate: float = 0.07  # Kalshi: ceil(rate * C * P * (1-P)) per order, in cents

    # --- data ---
    interval_min: int = 1  # candlestick granularity
    spot_max_staleness_s: int = 300

    def fee_for(self, contracts: int, price_cents: int) -> float:
        """Kalshi trading fee, rounded up to the next cent, in dollars."""
        if not self.fees or contracts <= 0:
            return 0.0
        p = price_cents / 100.0
        cents = math.ceil(self.fee_rate * contracts * p * (1.0 - p) * 100.0)
        return cents / 100.0

    def contracts_for(self, price_cents: int) -> int:
        """How many contracts $stake buys at `price_cents`."""
        if price_cents <= 0:
            return 0
        n = self.stake / (price_cents / 100.0)
        return int(math.floor(n)) if self.whole_contracts else n

    def add_trigger_price(self, reference_cents: int) -> float:
        """Price at or below which the next $5 add fires."""
        if self.dip_mode == "abs":
            return reference_cents - self.dip_pct
        return reference_cents * (1.0 - self.dip_pct / 100.0)
