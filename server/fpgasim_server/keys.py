"""Access keys (spec section 8.6).

The keys.toml file: owner name → SHA-256 of the key and an enabled flag. The keys themselves are not stored.

    [keys.taras]
    sha256 = "9f86d0…"
    enabled = true
"""

from __future__ import annotations

import base64
import hashlib
import os
import re
import secrets
import tomllib
from dataclasses import dataclass
from pathlib import Path

NAME_RE = re.compile(r"[A-Za-z0-9_-]{1,64}")


@dataclass(frozen=True)
class KeyRecord:
    owner: str
    sha256: str
    enabled: bool


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def new_key() -> str:
    """A key is 32 random bytes in base64url."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


def read_keys(path: Path) -> dict[str, KeyRecord]:
    if not path.exists():
        return {}
    with path.open("rb") as f:
        doc = tomllib.load(f)
    return {
        owner: KeyRecord(owner, str(rec["sha256"]), bool(rec.get("enabled", True)))
        for owner, rec in doc.get("keys", {}).items()
    }


def write_keys(path: Path, keys: dict[str, KeyRecord]) -> None:
    lines = ["# Ключи сервера сборки FPGA SIM. Файл ведёт fpgasim-admin.", ""]
    for owner in sorted(keys):
        rec = keys[owner]
        lines += [f"[keys.{owner}]", f'sha256 = "{rec.sha256}"', f"enabled = {'true' if rec.enabled else 'false'}", ""]
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text("\n".join(lines), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(path)


class KeyStore:
    """Request key check. The file is reread when it changes: fpgasim-admin works alongside."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self._stamp: tuple[int, int] | None = None
        self._by_hash: dict[str, KeyRecord] = {}
        self.error: str | None = None

    def _reload(self) -> None:
        try:
            st = self.path.stat()
            stamp = (st.st_mtime_ns, st.st_size)
        except FileNotFoundError:
            stamp = (0, 0)
        if stamp != self._stamp:
            self._stamp = stamp
            try:
                self._by_hash = {rec.sha256: rec for rec in read_keys(self.path).values()}
                self.error = None
            except (OSError, ValueError, KeyError, TypeError, AttributeError) as e:
                # The file is corrupt (manual edit): the previous keys stay in force, the cause is in the service log.
                self.error = f"{self.path}: {e}"

    def owner(self, key: str) -> str | None:
        """Owner name of a valid key; None for an unknown or disabled one."""
        self._reload()
        rec = self._by_hash.get(hash_key(key))
        return rec.owner if rec and rec.enabled else None
