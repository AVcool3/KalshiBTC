"""Strategy rules pinned against hand-built order books.

Window convention in these fixtures: close at t=900, so the decision minute
(T-7) is t=480 and the last tradable minute is t=840..900.
"""

from __future__ import annotations

import math

import pytest

from kbt.config import StrategyConfig
from kbt.engine import distance_bps, simulate_market
from kbt.models import Candle, Market, MarketData

CLOSE = 900
STRIKE = 100_000.0


def market(result: str = "") -> Market:
    return Market(
        ticker="KXBTC15M-TEST",
        event_ticker="KXBTC15M-TEST",
        series_ticker="KXBTC15M",
        open_ts=0,
        close_ts=CLOSE,
        strike=STRIKE,
        result=result,
    )


def candle(ts: int, bid: int, ask: int) -> Candle:
    return Candle(
        ts=ts,
        yes_bid_close=bid,
        yes_ask_close=ask,
        yes_bid_low=bid,
        yes_bid_high=bid,
        yes_ask_low=ask,
        yes_ask_high=ask,
        last_price=(bid + ask) // 2,
    )


def data(quotes: dict[int, tuple[int, int]], spot: dict[int, float], result: str = "") -> MarketData:
    return MarketData(
        market=market(result),
        candles=[candle(ts, b, a) for ts, (b, a) in sorted(quotes.items())],
        spot=dict(spot),
    )


def flat_spot(price: float) -> dict[int, float]:
    return {ts: price for ts in range(0, CLOSE + 60, 60)}


def quotes(default: tuple[int, int], overrides: dict[int, tuple[int, int]] | None = None):
    q = {ts: default for ts in range(0, CLOSE + 60, 60)}
    q.update(overrides or {})
    return q


CFG = StrategyConfig(adds=True)  # ladder on: most tests exercise it


# ----------------------------------------------------------------- entry gate
def test_enters_yes_side_when_spot_above_strike_and_odds_above_60():
    md = data(quotes((69, 70)), flat_spot(100_100.0), result="yes")
    r = simulate_market(md, CFG)
    assert r.traded
    assert r.side == "yes"
    assert r.entry_price == 70  # pays the ask
    assert r.fills[0].ts == CLOSE - 7 * 60
    assert r.fills[0].contracts == 7  # floor($5 / $0.70)


def test_enters_no_side_when_spot_below_strike():
    # yes 28/30 -> no ask = 100 - yes_bid = 72
    md = data(quotes((28, 30)), flat_spot(99_900.0), result="no")
    r = simulate_market(md, CFG)
    assert r.traded
    assert r.side == "no"
    assert r.entry_price == 72
    assert r.won is True


def test_skips_when_odds_not_above_60():
    md = data(quotes((58, 60)), flat_spot(100_100.0), result="yes")
    r = simulate_market(md, CFG)
    assert not r.traded
    assert "not above" in r.skip_reason
    assert r.net_pnl == 0.0


def test_sixty_is_exclusive_but_sixty_one_trades():
    md = data(quotes((60, 61)), flat_spot(100_100.0), result="yes")
    assert simulate_market(md, CFG).traded


def test_skips_when_no_spot_available():
    md = MarketData(market=market("yes"), candles=[candle(480, 69, 70)], spot={})
    r = simulate_market(md, CFG)
    assert not r.traded
    assert "spot" in r.skip_reason


# ----------------------------------------------------------------- the ladder
def test_add_fires_on_five_percent_dip_with_enough_distance():
    # entry 70c at t=480; 66c at t=540 is below 70 * 0.95 = 66.5
    md = data(
        quotes((69, 70), {540: (65, 66)}),
        flat_spot(100_100.0),  # 10 bps away, clears the 2 bp filter
        result="yes",
    )
    r = simulate_market(md, CFG)
    assert r.adds == 1
    assert [f.price for f in r.fills] == [70, 66]
    assert r.contracts == 7 + 7  # floor(5/0.70) + floor(5/0.66)


def test_add_blocked_when_btc_too_close_to_strike():
    md = data(
        quotes((69, 70), {540: (65, 66)}),
        flat_spot(100_010.0),  # 1 bp away, below the 0.02% filter
        result="yes",
    )
    r = simulate_market(md, CFG)
    assert r.adds == 0
    assert r.skip_reason == ""


def test_no_add_on_shallow_dip():
    md = data(quotes((69, 70), {540: (66, 67)}), flat_spot(100_100.0), result="yes")
    assert simulate_market(md, CFG).adds == 0


def test_ladder_resets_reference_to_each_new_fill():
    # 70 -> add at 66 (<=66.5) -> next trigger 62.7 -> 63 must NOT fire, 62 must
    md = data(
        quotes((69, 70), {540: (65, 66), 600: (62, 63), 660: (61, 62)}),
        flat_spot(100_100.0),
        result="yes",
    )
    r = simulate_market(md, CFG)
    assert [f.price for f in r.fills] == [70, 66, 62]


def test_rel_first_mode_measures_every_add_off_the_entry():
    cfg = StrategyConfig(adds=True, dip_mode="rel_first")
    md = data(
        quotes((69, 70), {540: (65, 66), 600: (64, 65)}),
        flat_spot(100_100.0),
        result="yes",
    )
    r = simulate_market(md, cfg)
    assert [f.price for f in r.fills] == [70, 66, 65]  # both below 66.5


def test_max_adds_cap_is_respected():
    cfg = StrategyConfig(adds=True, max_adds=1)
    md = data(
        quotes((69, 70), {540: (65, 66), 600: (62, 63), 660: (58, 59)}),
        flat_spot(100_100.0),
        result="yes",
    )
    assert simulate_market(md, cfg).adds == 1


def test_adds_stop_at_market_close():
    q = quotes((69, 70), {540: (65, 66)})
    q[960] = (40, 41)  # after close — must be ignored
    md = data(q, flat_spot(100_100.0), result="yes")
    r = simulate_market(md, CFG)
    assert all(f.ts <= CLOSE for f in r.fills)
    assert r.adds == 1


def test_adds_ignore_minutes_before_entry():
    md = data(quotes((69, 70), {240: (40, 41)}), flat_spot(100_100.0), result="yes")
    assert simulate_market(md, CFG).adds == 0


# ------------------------------------------------------------------ P&L math
def test_winning_trade_pnl_and_fees():
    md = data(quotes((69, 70)), flat_spot(100_100.0), result="yes")
    r = simulate_market(md, CFG)
    assert r.contracts == 7
    assert r.cost == pytest.approx(4.90)
    assert r.payout == pytest.approx(7.00)
    assert r.gross_pnl == pytest.approx(2.10)
    # fee = ceil(0.07 * 7 * 0.70 * 0.30 * 100) / 100 = ceil(10.29)/100 = 0.11
    assert r.fees == pytest.approx(0.11)
    assert r.net_pnl == pytest.approx(1.99)


def test_losing_trade_loses_full_stake_plus_fees():
    md = data(quotes((69, 70)), flat_spot(100_100.0), result="no")
    r = simulate_market(md, CFG)
    assert r.won is False
    assert r.payout == 0.0
    assert r.net_pnl == pytest.approx(-4.90 - 0.11)


def test_ladder_loss_compounds_the_stake():
    md = data(
        quotes((69, 70), {540: (65, 66), 600: (61, 62)}),
        flat_spot(100_100.0),
        result="no",
    )
    r = simulate_market(md, CFG)
    assert r.adds == 2
    assert r.cost == pytest.approx(4.90 + 7 * 0.66 + 8 * 0.62)
    assert r.net_pnl < -14.0  # three $5 buys, all worthless


def test_fees_can_be_disabled():
    md = data(quotes((69, 70)), flat_spot(100_100.0), result="yes")
    r = simulate_market(md, StrategyConfig(fees=False))
    assert r.fees == 0.0
    assert r.net_pnl == r.gross_pnl


def test_fee_formula_matches_kalshi_rounding():
    cfg = StrategyConfig()
    # ceil(0.07 * 10 * 0.5 * 0.5 * 100) = ceil(17.5) = 18 cents
    assert cfg.fee_for(10, 50) == pytest.approx(0.18)
    assert cfg.fee_for(1, 99) == pytest.approx(0.01)  # rounds up, never to zero
    assert cfg.fee_for(0, 70) == 0.0


# ------------------------------------------------------- settlement fallbacks
def test_settlement_falls_back_to_spot_when_result_missing():
    md = data(quotes((69, 70)), flat_spot(100_100.0), result="")
    r = simulate_market(md, CFG)
    assert r.won is True  # spot at close > strike


def test_unsettled_market_is_marked_not_won_and_flagged():
    q = quotes((69, 70))
    spot = {ts: 100_100.0 for ts in range(0, 600, 60)}  # nothing near close
    md = data(q, spot, result="")
    r = simulate_market(md, CFG)
    assert r.traded and r.won is None
    assert "unsettled" in r.skip_reason


# ---------------------------------------------------------------- book edges
def test_empty_offer_at_decision_time_skips():
    md = data(quotes((0, 100)), flat_spot(100_100.0), result="yes")
    r = simulate_market(md, CFG)
    assert not r.traded


def test_locked_book_minute_is_skipped_for_adds_not_fatal():
    md = data(
        quotes((69, 70), {540: (0, 100), 600: (65, 66)}),
        flat_spot(100_100.0),
        result="yes",
    )
    r = simulate_market(md, CFG)
    assert r.adds == 1
    assert r.fills[1].ts == 600


def test_low_fill_mode_never_fills_better_than_the_trigger():
    cfg = StrategyConfig(adds=True, fill_mode="low")
    md = MarketData(
        market=market("yes"),
        candles=[
            candle(480, 69, 70),
            Candle(
                ts=540, yes_bid_close=64, yes_ask_close=65,
                yes_bid_low=50, yes_bid_high=64, yes_ask_low=51, yes_ask_high=65,
            ),
        ],
        spot=flat_spot(100_100.0),
    )
    r = simulate_market(md, cfg)
    assert r.adds == 1
    assert r.fills[1].price == 66  # capped at floor(70 * 0.95) territory, not 51


def test_decision_uses_last_candle_before_target_when_minute_missing():
    q = quotes((69, 70), {420: (74, 75)})
    del q[480]
    md = data(q, flat_spot(100_100.0), result="yes")
    r = simulate_market(md, CFG)
    assert r.traded
    assert r.entry_price == 75  # priced off the last quote before T-7
    assert r.fills[0].ts == 480  # stamped at the decision time itself


# ------------------------------------------------------------------- helpers
def test_distance_bps():
    assert distance_bps(100_020.0, 100_000.0) == pytest.approx(2.0)
    assert distance_bps(99_980.0, 100_000.0) == pytest.approx(2.0)
    assert distance_bps(100_000.0, 100_000.0) == 0.0


def test_contracts_sizing_floors_to_whole_contracts():
    cfg = StrategyConfig()
    assert cfg.contracts_for(70) == 7
    assert cfg.contracts_for(99) == 5
    assert cfg.contracts_for(61) == 8
    assert math.isclose(StrategyConfig(whole_contracts=False).contracts_for(70), 5 / 0.70)


def test_no_side_pricing_is_derived_from_the_yes_book():
    c = candle(480, 40, 45)
    assert c.ask("yes") == 45
    assert c.ask("no") == 60  # 100 - yes_bid
    assert c.bid("no") == 55  # 100 - yes_ask


def test_default_config_never_adds():
    md = data(
        quotes((69, 70), {540: (65, 66), 600: (61, 62)}),
        flat_spot(100_100.0),
        result="yes",
    )
    r = simulate_market(md, StrategyConfig())
    assert r.traded
    assert r.adds == 0
    assert r.contracts == 7  # the single $5 entry, nothing else
