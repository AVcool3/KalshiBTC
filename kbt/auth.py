"""Kalshi API key signing (RSA-PSS over timestamp + method + path).

Market data is public, so the backtest normally runs unauthenticated. Supply
credentials only if your account/region requires them for candlesticks.
"""

from __future__ import annotations

import base64
import os
import time
from typing import Optional


def _normalize_pem(pem: str) -> bytes:
    """Repair PEMs mangled by env-var entry (escaped or stripped newlines)."""
    text = pem.strip().replace("\\n", "\n")
    if "\n" not in text:
        # Single line: rebuild the framing around the base64 body.
        import re

        match = re.match(r"^(-----BEGIN [A-Z ]+-----)(.*?)(-----END [A-Z ]+-----)$", text)
        if match:
            head, body, tail = match.groups()
            b64 = body.replace(" ", "")
            lines = [b64[i : i + 64] for i in range(0, len(b64), 64)]
            text = "\n".join([head, *lines, tail])
    return (text + "\n").encode()


class KalshiSigner:
    def __init__(self, key_id: str, private_key_pem: bytes):
        from cryptography.hazmat.primitives import serialization

        self.key_id = key_id
        self._key = serialization.load_pem_private_key(
            _normalize_pem(private_key_pem.decode()), password=None
        )

    @classmethod
    def from_env(cls) -> Optional["KalshiSigner"]:
        """Build from environment credentials, else None.

        Key id: KALSHI_KEY_ID or KalshiKEY.
        Private key: KALSHI_PRIVATE_KEY (PEM content) or
        KALSHI_PRIVATE_KEY_PATH (path to the .pem Kalshi gave you).
        """
        key_id = (os.environ.get("KALSHI_KEY_ID") or os.environ.get("KalshiKEY") or "").strip()
        if not key_id:
            return None
        pem = os.environ.get("KALSHI_PRIVATE_KEY", "").strip()
        if pem:
            return cls(key_id, pem.encode())
        path = os.environ.get("KALSHI_PRIVATE_KEY_PATH", "").strip()
        if path:
            with open(path, "rb") as fh:
                return cls(key_id, fh.read())
        # Fallback: accept the key under any env var name (people name their
        # secrets all sorts of things) by recognizing the PEM shape itself.
        for name, value in os.environ.items():
            if "-----BEGIN" in value and "PRIVATE KEY" in value:
                return cls(key_id, value.strip().encode())
        return None

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
