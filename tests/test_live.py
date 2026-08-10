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


def test_stake_ladder_steps_with_portfolio_growth(tmp_path):
    t = trader(journal_path=str(tmp_path / "j.jsonl"), stake_step=1.0, stake_per=20.0)
    assert t.stake_for(71.38) == 5.0        # first call sets the anchor
    assert t.stake_for(85.00) == 5.0        # +13.62, below one step
    assert t.stake_for(91.38) == 6.0        # +20.00 exactly -> one step
    assert t.stake_for(115.00) == 7.0       # +43.62 -> two steps
    assert t.stake_for(88.00) == 5.0        # retracement steps back down
    assert t.stake_for(51.38) == 5.0        # never below base
    # anchor persisted: a fresh trader on the same journal dir keeps the ladder
    t2 = trader(journal_path=str(tmp_path / "j.jsonl"), stake_step=1.0, stake_per=20.0)
    assert t2.stake_for(91.38) == 6.0


def test_stake_ladder_respects_cap_and_disabled_mode(tmp_path):
    t = trader(journal_path=str(tmp_path / "j.jsonl"), stake_step=1.0, stake_per=20.0, stake_cap=8.0)
    t.stake_for(100.0)  # anchor
    assert t.stake_for(1_000_000.0) == 8.0  # capped
    fixed = trader(journal_path=str(tmp_path / "fixed" / "j.jsonl"))
    import os
    os.makedirs(os.path.dirname(fixed.journal_path), exist_ok=True)
    assert fixed.stake_for(1_000_000.0) == 5.0  # step 0 = fixed stake
    assert fixed.stake_for(None) == 5.0
