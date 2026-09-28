"""Fetch → assemble → simulate."""

from __future__ import annotations

import sys
import time
from typing import Optional

from .config import StrategyConfig
from .engine import simulate_all
from .kalshi import SERIES, KalshiClient, parse_candles, parse_markets, pick_15m_markets
from .models import MarketData, MarketResult
from .spot import SpotHistory, fetch_spot


def window(hours: float, end_ts: Optional[int] = None) -> tuple[int, int]:
    end = int(end_ts if end_ts is not None else time.time())
    return end - int(hours * 3600), end


def discover(
    client: KalshiClient,
    start_ts: int,
    end_ts: int,
    series_ticker: str = SERIES,
) -> list:
    raw = client.markets(
        series_ticker=series_ticker,
        min_close_ts=start_ts,
        max_close_ts=end_ts,
    )
    return pick_15m_markets(parse_markets(raw, series_ticker))


def build_market_data(
    client: KalshiClient,
    markets: list,
    spot: SpotHistory,
    cfg: StrategyConfig,
    verbose: bool = True,
) -> list[MarketData]:
    out: list[MarketData] = []
    for i, m in enumerate(markets, 1):
        if verbose:
            print(f"  [{i}/{len(markets)}] {m.ticker}", file=sys.stderr)
        # Pad the pull so the decision minute and the close minute are covered.
        raw = client.candlesticks(
            market_ticker=m.ticker,
            start_ts=m.open_ts - 60,
            end_ts=m.close_ts + 60,
            series_ticker=m.series_ticker,
            period_interval=cfg.interval_min,
        )
        candles = parse_candles(raw)
        out.append(
            MarketData(
                market=m,
                candles=candles,
                spot=spot.slice(m.open_ts - 600, m.close_ts + 600),
            )
        )
    return out


def run_backtest(
    hours: float = 24.0,
    cfg: Optional[StrategyConfig] = None,
    series_ticker: str = SERIES,
    spot_source: str = "coinbase",
    cache_dir: Optional[str] = None,
    end_ts: Optional[int] = None,
    base_url: Optional[str] = None,
    verbose: bool = True,
) -> tuple[list[MarketResult], dict]:
    from .auth import KalshiSigner
    from .kalshi import DEFAULT_BASE

    cfg = cfg or StrategyConfig()
    start, end = window(hours, end_ts)
    client = KalshiClient(
        base_url=base_url or DEFAULT_BASE,
        signer=KalshiSigner.from_env(),
        cache_dir=cache_dir,
    )

    if verbose:
        print(f"Discovering {series_ticker} markets closing in the last {hours}h…", file=sys.stderr)
    markets = discover(client, start, end, series_ticker)
    if verbose:
        print(f"  found {len(markets)} markets", file=sys.stderr)

    if verbose:
        print(f"Fetching BTC spot ({spot_source})…", file=sys.stderr)
    spot = fetch_spot(start - 1800, end + 1800, source=spot_source, cache_dir=cache_dir)
    if verbose:
        print(f"  {len(spot)} spot minutes", file=sys.stderr)

    if verbose:
        print("Fetching candlesticks…", file=sys.stderr)
    mds = build_market_data(client, markets, spot, cfg, verbose)

    results = simulate_all(mds, cfg)
    meta = {
        "series": series_ticker,
        "window_start_ts": start,
        "window_end_ts": end,
        "hours": hours,
        "spot_source": spot.source,
        "markets_found": len(markets),
        "candle_minutes": sum(len(md.candles) for md in mds),
    }
    return results, meta
