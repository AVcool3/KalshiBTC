"""BTC spot history, used for "which side is it on" and distance-from-strike.

Kalshi settles KXBTC15M against the CF Benchmarks BTC Real Time Index, which
has no free public history, so we proxy it with 1-minute exchange candles.
The two track each other to a few basis points; the 0.02% (2 bp) distance
filter sits close to that noise floor, so `--min-distance-bps` is tunable and
the proxy source is reported in the output.
"""

from __future__ import annotations

import json
import os
import time
from typing import Optional

import requests

SOURCES = ("coinbase", "binance", "kraken")


class SpotHistory:
    """minute unix ts -> BTC/USD close."""

    def __init__(self, prices: dict[int, float], source: str):
        self.prices = prices
        self.source = source

    def slice(self, start_ts: int, end_ts: int) -> dict[int, float]:
        return {t: p for t, p in self.prices.items() if start_ts <= t <= end_ts}

    def __len__(self) -> int:
        return len(self.prices)


def fetch_spot(
    start_ts: int,
    end_ts: int,
    source: str = "coinbase",
    cache_dir: Optional[str] = None,
    timeout: int = 30,
) -> SpotHistory:
    if source not in SOURCES:
        raise ValueError(f"unknown spot source {source!r}; expected one of {SOURCES}")

    cache_file = None
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        cache_file = os.path.join(cache_dir, f"spot_{source}_{start_ts}_{end_ts}.json")
        if os.path.exists(cache_file):
            with open(cache_file) as fh:
                return SpotHistory({int(k): float(v) for k, v in json.load(fh).items()}, source)

    fetcher = {"coinbase": _coinbase, "binance": _binance, "kraken": _kraken}[source]
    prices = fetcher(start_ts, end_ts, timeout)
    if cache_file:
        with open(cache_file, "w") as fh:
            json.dump(prices, fh)
    return SpotHistory(prices, source)


def _iso(ts: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _get(url: str, params: dict, timeout: int, retries: int = 4):
    last: Optional[Exception] = None
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": "kbt/0.1"})
            r.raise_for_status()
            return r.json()
        except Exception as exc:  # noqa: BLE001 - retried, re-raised below
            last = exc
            if attempt < retries - 1:
                time.sleep(2**attempt)
    raise RuntimeError(f"GET {url} failed: {last}")


def _coinbase(start_ts: int, end_ts: int, timeout: int) -> dict[int, float]:
    """Coinbase Exchange caps each request at 300 candles."""
    out: dict[int, float] = {}
    chunk = 300 * 60
    cursor = start_ts
    while cursor <= end_ts:
        stop = min(cursor + chunk, end_ts)
        rows = _get(
            "https://api.exchange.coinbase.com/products/BTC-USD/candles",
            {
                "granularity": 60,
                "start": _iso(cursor),
                "end": _iso(stop),
            },
            timeout,
        )
        for row in rows or []:
            # [ time, low, high, open, close, volume ]
            out[int(row[0])] = float(row[4])
        cursor = stop + 60
        time.sleep(0.25)  # public rate limit
    return out


def _binance(start_ts: int, end_ts: int, timeout: int) -> dict[int, float]:
    out: dict[int, float] = {}
    cursor = start_ts
    while cursor <= end_ts:
        rows = _get(
            "https://api.binance.com/api/v3/klines",
            {
                "symbol": "BTCUSDT",
                "interval": "1m",
                "startTime": cursor * 1000,
                "endTime": end_ts * 1000,
                "limit": 1000,
            },
            timeout,
        )
        if not rows:
            break
        for row in rows:
            out[int(row[0]) // 1000] = float(row[4])
        cursor = int(rows[-1][0]) // 1000 + 60
        if len(rows) < 1000:
            break
        time.sleep(0.25)
    return out


def _kraken(start_ts: int, end_ts: int, timeout: int) -> dict[int, float]:
    """Kraken only serves the last ~720 one-minute candles."""
    data = _get(
        "https://api.kraken.com/0/public/OHLC",
        {"pair": "XBTUSD", "interval": 1, "since": start_ts},
        timeout,
    )
    result = data.get("result", {})
    rows: list = []
    for key, value in result.items():
        if key != "last" and isinstance(value, list):
            rows = value
            break
    return {int(r[0]): float(r[4]) for r in rows if start_ts <= int(r[0]) <= end_ts}
