"""Timing and safety-rail logic for the live trader (no network)."""

from __future__ import annotations

import pytest

from kbt.config import StrategyConfig
from kbt.live import LiveTrader


def trader(**kw) -> LiveTrader:
    kw.setdefault("journal_path", "live/test.jsonl")
    return LiveTrader(StrategyConfig(), signer=None, **kw)


def test_next_decision_is_seven_minutes_before_the_next_quarter_hour():
    t = trader()
    # 12:00:00 -> next close 12:15, decision 12:08
    assert t.next_decision_ts(now=1_800_000 * 900 / 900 * 900) % 900 == 480
    base = 1_755_000_600  # some :10:00 -> decision at :08 already passed -> :23
    assert t.next_decision_ts(now=base) == (base // 900 + 1) * 900 + 480


def test_decision_never_scheduled_in_the_past():
    t = trader()
    for offset in range(0, 900, 37):
        now = 1_755_000_000 + offset
        assert t.next_decision_ts(now=now) > now


def test_live_mode_requires_credentials():
    with pytest.raises(RuntimeError, match="credentials"):
        trader(live=True)


def test_dry_run_needs_no_credentials():
    assert trader().live is False


class _StubClient:
    """Returns canned market results for realized_today."""

    def __init__(self, results):
        self._results = results

    def get(self, path, params=None):
        ticker = path.rsplit("/", 1)[-1]
        return {"market": {"result": self._results.get(ticker, "")}}


def test_realized_today_sums_settled_entries_and_triggers_halt(tmp_path):
    import json
    from datetime import datetime, timezone

    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    journal = tmp_path / "journal.jsonl"
    entries = [
        # 6 NO at 80c, won: +6 - 4.80 - fee(0.07)
        {"ts": f"{day}T21:15:00+00:00", "live": True, "action": "order",
         "ticker": "W1", "side": "no", "price": 80.0, "contracts": 6},
        # 7 YES at 70c, lost: -4.90 - fee(0.11)
        {"ts": f"{day}T21:30:00+00:00", "live": True, "action": "order",
         "ticker": "L1", "side": "yes", "price": 70.0, "contracts": 7},
        # still open -> ignored
        {"ts": f"{day}T21:45:00+00:00", "live": True, "action": "order",
         "ticker": "OPEN", "side": "no", "price": 85.0, "contracts": 5},
        # yesterday -> ignored
        {"ts": "2000-01-01T00:00:00+00:00", "live": True, "action": "order",
         "ticker": "OLD", "side": "no", "price": 80.0, "contracts": 6},
        # dry-run -> ignored
        {"ts": f"{day}T22:00:00+00:00", "live": False, "action": "order",
         "ticker": "DRY", "side": "no", "price": 80.0, "contracts": 6},
    ]
    journal.write_text("".join(json.dumps(e) + "\n" for e in entries))

    t = trader(journal_path=str(journal), max_daily_loss=3.0)  # day nets -3.88
    t.live = True  # after construction so no credential check fires
    t.client = _StubClient({"W1": "no", "L1": "no", "OLD": "no"})

    expected = (6 - 4.80 - 0.07) + (-4.90 - 0.11)
    assert t.realized_today() == pytest.approx(expected)
    assert "circuit breaker" in t.daily_halt_reason()

    t.max_daily_loss = 20.0
    assert t.daily_halt_reason() is None
    t.max_daily_loss = 0.0
    assert t.daily_halt_reason() is None


def test_halt_disabled_in_dry_run(tmp_path):
    t = trader(journal_path=str(tmp_path / "j.jsonl"), max_daily_loss=1.0)
    assert t.daily_halt_reason() is None




def test_book_order_maps_sides_and_pays_through_the_quote():
    # YES at 82c with 2c buffer -> bid at 0.84
    assert LiveTrader.book_order("yes", "0.8200", 2.0) == ("bid", "0.8400")
    # NO at 84c with 2c buffer -> pay up to 86c NO -> ask at 0.14
    assert LiveTrader.book_order("no", "0.8400", 2.0) == ("ask", "0.1400")
    # no buffer keeps the quote exactly
    assert LiveTrader.book_order("yes", "0.6100", 0.0) == ("bid", "0.6100")
    # buffer never pushes past 99c / below 1c
    assert LiveTrader.book_order("yes", "0.9850", 2.0) == ("bid", "0.9900")
    assert LiveTrader.book_order("no", "0.9850", 2.0) == ("ask", "0.0100")


def test_stake_ladder_now_tracks_bot_pnl_not_balance(tmp_path):
    t = trader(journal_path=str(tmp_path / "j.jsonl"), stake_step=1.0, stake_per=20.0)
    assert t.stake_for(0.0) == 5.0
    assert t.stake_for(19.99) == 5.0
    assert t.stake_for(20.0) == 6.0
    assert t.stake_for(45.0) == 7.0
    assert t.stake_for(-30.0) == 5.0   # losses never cut below base
    assert t.stake_for(None) == 5.0


def test_stake_cap_still_bounds_ladder(tmp_path):
    t = trader(journal_path=str(tmp_path / "j.jsonl"), stake_step=1.0, stake_per=20.0, stake_cap=8.0)
    assert t.stake_for(1_000_000.0) == 8.0


def _journal(tmp_path, entries):
    import json
    p = tmp_path / "journal.jsonl"
    p.write_text("".join(json.dumps(e) + "\n" for e in entries))
    return str(p)


def _entry(day, ticker, side, price, contracts, action="order"):
    return {"ts": f"{day}T01:00:00+00:00", "live": True, "action": action,
            "ticker": ticker, "side": side, "price": price, "contracts": contracts}


def test_locked_pair_counts_as_realized_without_a_result(tmp_path):
    from datetime import datetime, timezone
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # entry 10 YES @ 70c, lock 10 NO @ 8c -> pairs pay $10 for $7.80 + fees
    j = _journal(tmp_path, [
        _entry(day, "M1", "yes", 70.0, 10),
        _entry(day, "M1", "no", 8.0, 10, action="lock"),
    ])
    t = trader(journal_path=j)
    t.live = True
    t.client = _StubClient({})  # result unknown — must not matter for a full pair
    fees = StrategyConfig().fee_for(10, 70) + StrategyConfig().fee_for(10, 8)
    assert t.realized_today() == pytest.approx(10 - 7.80 - fees)


def test_unpaired_entry_still_waits_for_result(tmp_path):
    from datetime import datetime, timezone
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    j = _journal(tmp_path, [_entry(day, "M2", "no", 75.0, 8)])
    t = trader(journal_path=j)
    t.live = True
    t.client = _StubClient({})  # unsettled -> nothing realized
    assert t.realized_today() == 0.0
    t.client = _StubClient({"M2": "no"})
    t._result_cache.clear()
    fees = StrategyConfig().fee_for(8, 75)
    assert t.realized_today() == pytest.approx(8 - 6.0 - fees)


def test_partial_lock_pairs_and_residual(tmp_path):
    from datetime import datetime, timezone
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # 10 YES @ 70c, locked only 6 NO @ 10c; result NO -> 6 pairs pay, 4 yes lose
    j = _journal(tmp_path, [
        _entry(day, "M3", "yes", 70.0, 10),
        _entry(day, "M3", "no", 10.0, 6, action="lock"),
    ])
    t = trader(journal_path=j)
    t.live = True
    t.client = _StubClient({"M3": "no"})
    fees = StrategyConfig().fee_for(10, 70) + StrategyConfig().fee_for(6, 10)
    assert t.realized_today() == pytest.approx(6 + 0 - 7.0 - 0.60 - fees)


def test_no_reentry_guard(tmp_path):
    from datetime import datetime, timezone
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    j = _journal(tmp_path, [_entry(day, "KXBTC15M-X", "yes", 70.0, 10)])
    t = trader(journal_path=j)
    assert t.already_entered("KXBTC15M-X")
    assert not t.already_entered("KXBTC15M-Y")


def test_lock_threshold_price_mapping():
    # lock_at 90 means we pay at most 10c for the opposite side
    t = trader(lock_at=90)
    assert (100 - t.lock_at) / 100.0 == pytest.approx(0.10)
    # book mapping for the lock leg: buying NO at 8c with 1c buffer -> ask at 0.91
    assert LiveTrader.book_order("no", "0.0800", 1.0) == ("ask", "0.9100")
