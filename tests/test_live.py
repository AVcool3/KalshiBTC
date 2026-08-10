"""Timing and safety-rail logic for the live trader (no network)."""

from __future__ import annotations

import pytest

from kbt.config import StrategyConfig
from kbt.live import LiveTrader


def trader(**kw) -> LiveTrader:
    return LiveTrader(StrategyConfig(), signer=None, journal_path="live/test.jsonl", **kw)


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
