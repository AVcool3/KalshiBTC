"""Kalshi trade-api v2 client: market discovery + candlestick history.

The API has shipped both integer-cent fields (`yes_ask.close`) and dollar
fields (`yes_ask.close_dollars`); the parsers here accept either.
"""

from __future__ import annotations

import json
import os
import time
from typing import Iterable, Optional

import requests

from .auth import KalshiSigner
from .models import Candle, Market

DEFAULT_BASE = "https://api.elections.kalshi.com/trade-api/v2"
SERIES = "KXBTC15M"


class KalshiClient:
    def __init__(
        self,
        base_url: str = DEFAULT_BASE,
        signer: Optional[KalshiSigner] = None,
        cache_dir: Optional[str] = None,
        timeout: int = 30,
        max_retries: int = 4,
    ):
        self.base_url = base_url.rstrip("/")
        self.signer = signer
        self.cache_dir = cache_dir
        self.timeout = timeout
        self.max_retries = max_retries
        self.session = requests.Session()
        self.session.headers.update({"Accept": "application/json", "User-Agent": "kbt/0.1"})
        self.throttle_s = 0.35  # pause before each network hit (cache hits skip it)
        self._last_request = 0.0
        if cache_dir:
            os.makedirs(cache_dir, exist_ok=True)

    # ------------------------------------------------------------------ http
    def _cache_path(self, key: str) -> Optional[str]:
        if not self.cache_dir:
            return None
        safe = "".join(ch if ch.isalnum() or ch in "-_." else "_" for ch in key)
        return os.path.join(self.cache_dir, safe[:180] + ".json")

    def get(self, path: str, params: Optional[dict] = None, cache_key: Optional[str] = None) -> dict:
        cache_file = self._cache_path(cache_key) if cache_key else None
        if cache_file and os.path.exists(cache_file):
            with open(cache_file) as fh:
                return json.load(fh)

        url = f"{self.base_url}{path}"
        full_path = url.split(".com", 1)[-1] if ".com" in url else path
        last_error: Optional[Exception] = None
        for attempt in range(self.max_retries):
            wait = self.throttle_s - (time.monotonic() - self._last_request)
            if wait > 0:
                time.sleep(wait)
            headers = self.signer.headers("GET", full_path) if self.signer else {}
            try:
                self._last_request = time.monotonic()
                r = self.session.get(url, params=params, headers=headers, timeout=self.timeout)
                if r.status_code == 429 or r.status_code >= 500:
                    raise requests.HTTPError(f"{r.status_code}: {r.text[:200]}")
                r.raise_for_status()
                data = r.json()
                if cache_file:
                    with open(cache_file, "w") as fh:
                        json.dump(data, fh)
                return data
            except requests.HTTPError as exc:
                last_error = exc
                if attempt < self.max_retries - 1:
                    # Rate limits want a real pause, not a quick retry.
                    base = 5.0 if "429" in str(exc) else 1.0
                    time.sleep(base * 2**attempt)
            except Exception as exc:  # noqa: BLE001 - retried below, re-raised at end
                last_error = exc
                if attempt < self.max_retries - 1:
                    time.sleep(2**attempt)
        raise RuntimeError(f"GET {url} failed after {self.max_retries} attempts: {last_error}")

    # --------------------------------------------------------------- markets
    def markets(
        self,
        series_ticker: str = SERIES,
        min_close_ts: Optional[int] = None,
        max_close_ts: Optional[int] = None,
        status: Optional[str] = None,
        limit: int = 1000,
    ) -> list[dict]:
        """Every market in the series whose close falls in the window."""
        out: list[dict] = []
        cursor = ""
        page = 0
        while True:
            params = {"series_ticker": series_ticker, "limit": limit}
            if min_close_ts:
                params["min_close_ts"] = min_close_ts
            if max_close_ts:
                params["max_close_ts"] = max_close_ts
            if status:
                params["status"] = status
            if cursor:
                params["cursor"] = cursor
            key = f"markets_{series_ticker}_{min_close_ts}_{max_close_ts}_{status}_{page}"
            data = self.get("/markets", params=params, cache_key=key)
            out.extend(data.get("markets", []))
            cursor = data.get("cursor") or ""
            page += 1
            if not cursor or page > 50:
                break
        return out

    def candlesticks(
        self,
        market_ticker: str,
        start_ts: int,
        end_ts: int,
        series_ticker: str = SERIES,
        period_interval: int = 1,
    ) -> list[dict]:
        path = f"/series/{series_ticker}/markets/{market_ticker}/candlesticks"
        params = {"start_ts": start_ts, "end_ts": end_ts, "period_interval": period_interval}
        key = f"candles_{market_ticker}_{start_ts}_{end_ts}_{period_interval}"
        data = self.get(path, params=params, cache_key=key)
        return data.get("candlesticks", [])


# ------------------------------------------------------------------ parsing
def _px(node: Optional[dict], field: str) -> Optional[int]:
    """Pull a cent price out of a candlestick sub-object, either schema."""
    if not isinstance(node, dict):
        return None
    if field in node and node[field] is not None:
        try:
            return int(round(float(node[field])))
        except (TypeError, ValueError):
            return None
    dollars = node.get(f"{field}_dollars")
    if dollars is None:
        return None
    try:
        return int(round(float(dollars) * 100))
    except (TypeError, ValueError):
        return None


def parse_candle(raw: dict) -> Optional[Candle]:
    ts = raw.get("end_period_ts") or raw.get("end_ts")
    if ts is None:
        return None
    bid, ask, price = raw.get("yes_bid"), raw.get("yes_ask"), raw.get("price")
    bid_close, ask_close = _px(bid, "close"), _px(ask, "close")
    if bid_close is None and ask_close is None:
        return None
    volume = raw.get("volume", raw.get("volume_fp", 0)) or 0
    return Candle(
        ts=int(ts),
        yes_bid_close=bid_close if bid_close is not None else 0,
        yes_ask_close=ask_close if ask_close is not None else 100,
        yes_bid_low=_px(bid, "low") if _px(bid, "low") is not None else (bid_close or 0),
        yes_bid_high=_px(bid, "high") if _px(bid, "high") is not None else (bid_close or 0),
        yes_ask_low=_px(ask, "low") if _px(ask, "low") is not None else (ask_close or 100),
        yes_ask_high=_px(ask, "high") if _px(ask, "high") is not None else (ask_close or 100),
        last_price=_px(price, "close"),
        volume=int(float(volume)),
    )


def parse_candles(raws: Iterable[dict]) -> list[Candle]:
    out = [parse_candle(r) for r in raws]
    return sorted([c for c in out if c is not None], key=lambda c: c.ts)


def _first(raw: dict, *keys: str):
    """First key that is actually present — 0 and "" are values, not misses."""
    for key in keys:
        if raw.get(key) is not None:
            return raw[key]
    return None


def _ts(value) -> Optional[int]:
    """Kalshi returns ISO-8601 strings for open_time/close_time."""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return int(value)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        from datetime import datetime

        return int(datetime.fromisoformat(text).timestamp())
    except ValueError:
        return None


def parse_market(raw: dict, series_ticker: str = SERIES) -> Optional[Market]:
    ticker = raw.get("ticker")
    open_ts = _ts(_first(raw, "open_time", "open_ts"))
    close_ts = _ts(_first(raw, "close_time", "close_ts"))
    if not ticker or open_ts is None or close_ts is None:
        return None

    strike = _first(raw, "floor_strike", "cap_strike")
    if strike is None:
        return None

    return Market(
        ticker=ticker,
        event_ticker=raw.get("event_ticker", ""),
        series_ticker=series_ticker,
        open_ts=open_ts,
        close_ts=close_ts,
        strike=float(strike),
        result=(raw.get("result") or "").strip().lower(),
        title=raw.get("title", "") or raw.get("subtitle", ""),
    )


def parse_markets(raws: Iterable[dict], series_ticker: str = SERIES) -> list[Market]:
    out = [parse_market(r, series_ticker) for r in raws]
    return sorted([m for m in out if m is not None], key=lambda m: m.close_ts)


def pick_15m_markets(
    markets: list[Market],
    tolerance_min: float = 3.0,
    expected_min: float = 15.0,
) -> list[Market]:
    """Keep the true 15-minute windows and one market per close time.

    KXBTC15M runs one up/down market per window, but the filter is defensive:
    if a window ever carries several strikes, the one closest to its own open
    reference is kept so "the side it is on" stays well defined.
    """
    fifteen = [m for m in markets if abs(m.duration_min - expected_min) <= tolerance_min]
    by_close: dict[int, Market] = {}
    for m in fifteen:
        existing = by_close.get(m.close_ts)
        if existing is None or m.ticker < existing.ticker:
            by_close[m.close_ts] = m
    return sorted(by_close.values(), key=lambda m: m.close_ts)
