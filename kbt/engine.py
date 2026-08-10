"""Pure simulation of the strategy over one market's history.

No network, no globals: hand it a MarketData and a StrategyConfig and it
replays the window minute by minute.
"""

from __future__ import annotations

import math
from typing import Optional

from .config import StrategyConfig
from .models import NO, YES, Candle, Fill, MarketData, MarketResult


def _signal_price(candle: Candle, side: str, cfg: StrategyConfig) -> Optional[float]:
    """The price the strategy *reads* (odds check and dip tracking)."""
    if cfg.price_source == "mid":
        return candle.mid(side)
    if cfg.price_source == "last":
        last = candle.last_price
        if last is None or not 0 < last < 100:
            return None
        return float(last if side == YES else 100 - last)
    return candle.ask(side, cfg.fill_mode)


def _fill_price(candle: Candle, side: str, cfg: StrategyConfig) -> Optional[int]:
    """The price the strategy *pays*. Always the offer — you cross the spread."""
    ask = candle.ask(side, cfg.fill_mode)
    if ask is None:
        return None
    return int(ask)


def distance_bps(spot: float, strike: float) -> float:
    """|spot - strike| / strike, in basis points."""
    if strike <= 0:
        return 0.0
    return abs(spot - strike) / strike * 10_000.0


def _decision_candle(md: MarketData, target_ts: int) -> Optional[Candle]:
    """Candle covering the decision minute, or the last one before it."""
    exact = md.candle_at(target_ts)
    if exact is not None:
        return exact
    prior = [c for c in md.candles if c.ts <= target_ts]
    return prior[-1] if prior else None


def _settled_won(md: MarketData, side: str, cfg: StrategyConfig) -> Optional[bool]:
    """Did `side` win? Prefer Kalshi's own result over reconstructing it."""
    result = (md.market.result or "").strip().lower()
    if result in (YES, NO):
        return result == side
    settle_spot = md.spot_at(md.market.close_ts, cfg.spot_max_staleness_s)
    if settle_spot is None:
        return None
    yes_won = settle_spot > md.market.strike
    return yes_won if side == YES else not yes_won


def simulate_market(md: MarketData, cfg: StrategyConfig) -> MarketResult:
    m = md.market
    res = MarketResult(market=m, traded=False)

    decision_ts = m.close_ts - cfg.entry_lead_s
    spot = md.spot_at(decision_ts, cfg.spot_max_staleness_s)
    if spot is None:
        res.skip_reason = "no spot price at decision time"
        return res

    # "the side it is on": BTC above the strike -> YES, below -> NO.
    side = YES if spot > m.strike else NO
    res.side = side
    res.entry_spot = spot
    res.entry_distance_bps = distance_bps(spot, m.strike)

    candle = _decision_candle(md, decision_ts)
    if candle is None:
        res.skip_reason = "no candlestick at decision time"
        return res

    signal = _signal_price(candle, side, cfg)
    if signal is None:
        res.skip_reason = "no quote on chosen side at decision time"
        return res
    if signal <= cfg.min_odds:
        res.skip_reason = f"odds {signal:.0f}c not above {cfg.min_odds}c"
        return res

    entry_px = _fill_price(candle, side, cfg)
    if entry_px is None:
        res.skip_reason = "no offer to lift at decision time"
        return res
    contracts = cfg.contracts_for(entry_px)
    if contracts <= 0:
        res.skip_reason = "stake too small for one contract"
        return res

    res.traded = True
    res.entry_price = entry_px
    _record(res, cfg, decision_ts, side, entry_px, contracts, "entry", spot, m.strike)

    # --- ladder (opt-in): every minute from entry to close, look for a dip ---
    reference = entry_px  # price the next dip is measured against
    first_fill = entry_px
    for c in md.candles if cfg.adds else []:
        if c.ts <= decision_ts or c.ts > m.close_ts:
            continue
        if cfg.max_adds and res.adds >= cfg.max_adds:
            break

        ref = first_fill if cfg.dip_mode == "rel_first" else reference
        trigger = cfg.add_trigger_price(ref)
        px_now = _signal_price(c, side, cfg)
        if px_now is None or px_now > trigger:
            continue

        spot_now = md.spot_at(c.ts, cfg.spot_max_staleness_s)
        if spot_now is None:
            continue
        dist = distance_bps(spot_now, m.strike)
        if dist < cfg.min_distance_bps:
            continue

        fill_px = _fill_price(c, side, cfg)
        if fill_px is None:
            continue
        # In "low" mode the minute's cheapest offer is only reachable with
        # hindsight; assume the fill happens at the trigger we were watching.
        if cfg.fill_mode == "low":
            fill_px = max(int(fill_px), int(math.floor(trigger)))
        fill_px = int(fill_px)
        if fill_px <= 0:
            continue
        n = cfg.contracts_for(fill_px)
        if n <= 0:
            continue

        _record(res, cfg, c.ts, side, fill_px, n, "add", spot_now, m.strike)
        reference = fill_px

    res.won = _settled_won(md, side, cfg)
    if res.won is None:
        res.skip_reason = "unsettled: no result and no settlement spot"
        res.payout = 0.0
    else:
        res.payout = float(res.contracts) if res.won else 0.0
    return res


def _record(
    res: MarketResult,
    cfg: StrategyConfig,
    ts: int,
    side: str,
    price: int,
    contracts: int,
    kind: str,
    spot: Optional[float],
    strike: float,
) -> None:
    cost = contracts * price / 100.0
    fee = cfg.fee_for(contracts, price)
    res.fills.append(
        Fill(
            ts=ts,
            side=side,
            price=price,
            contracts=contracts,
            cost=cost,
            fee=fee,
            kind=kind,
            spot=spot,
            distance_bps=None if spot is None else distance_bps(spot, strike),
        )
    )
    res.contracts += contracts
    res.cost += cost
    res.fees += fee


def simulate_all(mds: list[MarketData], cfg: StrategyConfig) -> list[MarketResult]:
    return [simulate_market(md, cfg) for md in sorted(mds, key=lambda d: d.market.close_ts)]
