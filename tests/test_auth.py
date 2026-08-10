"""Credential discovery and PEM repair (no network)."""

from __future__ import annotations

import pytest

from kbt.auth import KalshiSigner, _normalize_pem


@pytest.fixture(scope="module")
def pem() -> str:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def test_clean_pem_loads_and_signs(pem):
    signer = KalshiSigner("key-id", pem.encode())
    headers = signer.headers("GET", "/trade-api/v2/portfolio/balance")
    assert headers["KALSHI-ACCESS-KEY"] == "key-id"
    assert headers["KALSHI-ACCESS-SIGNATURE"]


def test_pem_with_escaped_newlines_is_repaired(pem):
    mangled = pem.strip().replace("\n", "\\n")
    KalshiSigner("key-id", mangled.encode())  # must not raise


def test_pem_flattened_to_one_line_is_repaired(pem):
    flattened = pem.strip().replace("\n", " ")
    KalshiSigner("key-id", flattened.encode())  # must not raise


def test_normalize_leaves_clean_pem_intact(pem):
    assert _normalize_pem(pem) == pem.strip().encode() + b"\n"


def test_from_env_finds_key_under_any_name(pem, monkeypatch):
    monkeypatch.setenv("KalshiKEY", "11111111-2222-3333-4444-555555555555")
    monkeypatch.delenv("KALSHI_PRIVATE_KEY", raising=False)
    monkeypatch.delenv("KALSHI_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.setenv("my_rsa_thing", pem)
    signer = KalshiSigner.from_env()
    assert signer is not None
    assert signer.key_id == "11111111-2222-3333-4444-555555555555"


def test_from_env_returns_none_without_private_key(monkeypatch):
    monkeypatch.setenv("KalshiKEY", "11111111-2222-3333-4444-555555555555")
    for var in ("KALSHI_PRIVATE_KEY", "KALSHI_PRIVATE_KEY_PATH"):
        monkeypatch.delenv(var, raising=False)
    assert KalshiSigner.from_env() is None
