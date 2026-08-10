"""Parsers must survive both Kalshi response schemas; report math must add up."""

from __future__ import annotations

import csv
import os

import pytest

from kbt.config import StrategyConfig
from kbt.kalshi import parse_candles, parse_market, parse_markets, pick_15m_markets
from kbt.models import Market, MarketData
from kbt.engine import simulate_market
from kbt.report import summarize, write_fills_csv, write_trades_csv
from tests.test_engine import CLOSE, candle, data, flat_spot, quotes

CENTS_SCHEMA = {
    "end_period_ts": 1_700_000_060,
    "yes_bid": {"open": 60, "low": 58, "high": 63, "close": 62},
    "yes_ask": {"open": 64, "low": 61, "high": 66, "close": 65},
    "price": {"open": 62, "low": 59, "high": 65, "close": 63, "mean": 62},
    "volume": 140,
}

DOLLARS_SCHEMA = {
    "end_period_ts": 1_700_000_120,
    "yes_bid": {"close_dollars": "0.62", "low_dollars": "0.58", "high_dollars": "0.63"},
    "yes_ask": {"close_dollars": "0.65", "low_dollars": "0.61", "high_dollars": "0.66"},
    "price": {"close_dollars": "0.63"},
    "volume_fp": "140.0",
}


def test_parses_cent_and_dollar_candlestick_schemas_identically():
    a, b = parse_candles([CENTS_SCHEMA, DOLLARS_SCHEMA])
    for c in (a, b):
        assert c.yes_bid_close == 62
        assert c.yes_ask_close == 65
        assert c.yes_ask_low == 61
        assert c.yes_bid_high == 63
        assert c.last_price == 63
        assert c.volume == 140


def test_candles_without_quotes_are_dropped_and_sorted():
    empty = {"end_period_ts": 1_700_000_000, "yes_bid": {}, "yes_ask": {}}
    out = parse_candles([DOLLARS_SCHEMA, empty, CENTS_SCHEMA])
    assert [c.ts for c in out] == [1_700_000_060, 1_700_000_120]


def test_parses_market_with_iso_timestamps_and_floor_strike():
    m = parse_market(
        {
            "ticker": "KXBTC15M-26AUG101615-T118250",
            "event_ticker": "KXBTC15M-26AUG101615",
            "open_time": "2026-08-10T16:00:00Z",
            "close_time": "2026-08-10T16:15:00Z",
            "floor_strike": 118250.5,
            "result": "YES",
            "title": "Bitcoin above 118,250.5 at 4:15pm",
        }
    )
    assert m is not None
    assert m.close_ts - m.open_ts == 900
    assert m.duration_min == 15.0
    assert m.strike == pytest.approx(118250.5)
    assert m.result == "yes"


def test_market_without_a_strike_is_dropped():
    assert parse_market({"ticker": "X", "open_time": 0, "close_time": 900}) is None


def test_pick_15m_filters_other_durations_and_dedupes_close_times():
    raws = [
        {"ticker": "A", "open_time": 0, "close_time": 900, "floor_strike": 1},
        {"ticker": "B", "open_time": 0, "close_time": 900, "floor_strike": 2},  # same window
        {"ticker": "C", "open_time": 0, "close_time": 3600, "floor_strike": 3},  # hourly
        {"ticker": "D", "open_time": 900, "close_time": 1800, "floor_strike": 4},
    ]
    picked = pick_15m_markets(parse_markets(raws))
    assert [m.ticker for m in picked] == ["A", "D"]


# ------------------------------------------------------------------- reports
def _mixed_results():
    win = simulate_market(data(quotes((69, 70)), flat_spot(100_100.0), result="yes"), StrategyConfig())
    loss = simulate_market(data(quotes((69, 70)), flat_spot(100_100.0), result="no"), StrategyConfig())
    skip = simulate_market(data(quotes((50, 52)), flat_spot(100_100.0), result="yes"), StrategyConfig())
    # de-collide close times so the equity curve has an order
    for i, r in enumerate((win, loss, skip)):
        r.market.close_ts = CLOSE + i * 900
    return [win, loss, skip]


def test_summary_totals_reconcile():
    results = _mixed_results()
    s = summarize(results, StrategyConfig())
    assert s["markets_evaluated"] == 3
    assert s["trades"] == 2
    assert s["skipped"] == 1
    assert s["skip_reasons"] == {"odds below threshold": 1}
    assert s["wins"] == 1 and s["losses"] == 1
    assert s["win_rate"] == pytest.approx(0.5)
    assert s["capital_deployed"] == pytest.approx(9.80)
    assert s["net_pnl"] == pytest.approx(1.99 - 5.01)
    assert s["gross_pnl"] == pytest.approx(s["net_pnl"] + s["fees"])
    assert s["max_drawdown"] == pytest.approx(-5.01)


def test_summary_of_empty_run_is_all_zeros():
    s = summarize([], StrategyConfig())
    assert s["trades"] == 0 and s["win_rate"] == 0.0 and s["net_pnl"] == 0.0


def test_csv_writers_emit_a_row_per_market_and_per_fill(tmp_path):
    results = _mixed_results()
    trades = os.path.join(tmp_path, "trades.csv")
    fills = os.path.join(tmp_path, "fills.csv")
    write_trades_csv(results, trades)
    write_fills_csv(results, fills)

    with open(trades) as fh:
        rows = list(csv.DictReader(fh))
    assert len(rows) == 3
    assert [r["traded"] for r in rows] == ["1", "1", "0"]
    assert rows[0]["net_pnl"] == "+1.99".lstrip("+")

    with open(fills) as fh:
        fill_rows = list(csv.DictReader(fh))
    assert len(fill_rows) == 2  # one entry each for the two traded markets
    assert all(r["kind"] == "entry" for r in fill_rows)
