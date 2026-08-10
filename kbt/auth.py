"""Kalshi API key signing (RSA-PSS over timestamp + method + path).

Market data is public, so the backtest normally runs unauthenticated. Supply
credentials only if your account/region requires them for candlesticks.
"""

from __future__ import annotations

import base64
import os
import time
from typing import Optional


class KalshiSigner:
    def __init__(self, key_id: str, private_key_pem: bytes):
        from cryptography.hazmat.primitives import serialization

        self.key_id = key_id
        self._key = serialization.load_pem_private_key(private_key_pem, password=None)

    @classmethod
    def from_env(cls) -> Optional["KalshiSigner"]:
        """Build from KALSHI_KEY_ID + KALSHI_PRIVATE_KEY_PATH, else None."""
        key_id = os.environ.get("KALSHI_KEY_ID", "").strip()
        path = os.environ.get("KALSHI_PRIVATE_KEY_PATH", "").strip()
        if not key_id or not path:
            return None
        with open(path, "rb") as fh:
            return cls(key_id, fh.read())

    def headers(self, method: str, path: str) -> dict:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        ts = str(int(time.time() * 1000))
        message = f"{ts}{method.upper()}{path}".encode()
        signature = self._key.sign(
            message,
            padding.PSS(
                mgf=padding.MGF1(hashes.SHA256()),
                salt_length=padding.PSS.DIGEST_LENGTH,
            ),
            hashes.SHA256(),
        )
        return {
            "KALSHI-ACCESS-KEY": self.key_id,
            "KALSHI-ACCESS-TIMESTAMP": ts,
            "KALSHI-ACCESS-SIGNATURE": base64.b64encode(signature).decode(),
        }
