"""Token accounting of the assistant (decisions 175 and 176).

The counts live in their own SQLite file, <data_dir>/assistant/usage.db, not in the account database:
they are a spend counter, and the account database keeps a strict schema with backup restore.
One row per UTC day, owner (Principal.limit_id) and model; each call adds to its row.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, NamedTuple

DAY_MS = 24 * 3600 * 1000

# USD per million tokens: input, output, cache read, cache write (5 minutes). Only for the spend report.
# The refusal fallbacks (claude-sonnet-5 for Sonnet 5.5, Opus 5 and 4.8 for Opus 5.5) are here too: their
# tokens are counted under their own names. Their cache prices are estimates (decision 180).
PRICES: dict[str, tuple[float, float, float, float]] = {
    "claude-sonnet-5-5": (2.0, 10.0, 0.10, 2.5),
    "claude-sonnet-5": (2.0, 10.0, 0.20, 2.5),
    "claude-opus-5": (5.0, 25.0, 0.50, 6.25),
    "claude-opus-4-8": (5.0, 25.0, 0.50, 6.25),
    "claude-opus-5-5": (4.0, 20.0, 0.20, 5.0),
    "claude-haiku-5-5": (0.10, 0.50, 0.01, 0.125),
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS usage (
    day TEXT NOT NULL,
    owner TEXT NOT NULL,
    model TEXT NOT NULL,
    input INTEGER NOT NULL,
    output INTEGER NOT NULL,
    cache_read INTEGER NOT NULL,
    cache_write INTEGER NOT NULL,
    PRIMARY KEY (day, owner, model)
)
"""


class Usage(NamedTuple):
    input: int
    output: int
    cache_read: int
    cache_write: int

    @property
    def total(self) -> int:
        """All kinds count toward the limits at full weight (decision 175)."""
        return self.input + self.output + self.cache_read + self.cache_write


def cost(model: str, usage: Usage) -> float | None:
    """Approximate cost in USD; None for a model without a price."""
    price = PRICES.get(model)
    if price is None:
        return None
    return sum(n * p for n, p in zip(usage, price, strict=True)) / 1e6


class UsageStore:
    """Daily token counts. clock() is milliseconds; tests replace it."""

    def __init__(self, path: Path, clock: Callable[[], int]) -> None:
        self.path = path
        self.clock = clock
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self._db() as conn:
            conn.execute(SCHEMA)
        os.chmod(path, 0o600)

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def day(self, offset: int = 0) -> str:
        return datetime.fromtimestamp((self.clock() + offset * DAY_MS) / 1000, UTC).strftime("%Y-%m-%d")

    def add(self, owner: str, model: str, usage: Usage) -> None:
        with self._db() as conn:
            conn.execute(
                "INSERT INTO usage VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (day, owner, model) DO UPDATE SET "
                "input = input + excluded.input, output = output + excluded.output, "
                "cache_read = cache_read + excluded.cache_read, cache_write = cache_write + excluded.cache_write",
                (self.day(), owner, model, *usage),
            )

    def _sum(self, where: str, args: tuple[Any, ...]) -> int:
        with self._db() as conn:
            row = conn.execute(
                f"SELECT COALESCE(SUM(input + output + cache_read + cache_write), 0) FROM usage WHERE {where}", args
            ).fetchone()
        return int(row[0])

    def tokens_today(self, owner: str) -> int:
        return self._sum("day = ? AND owner = ?", (self.day(), owner))

    def tokens_today_total(self) -> int:
        return self._sum("day = ?", (self.day(),))

    def report(self, days: int) -> list[dict[str, Any]]:
        """Rows of the last `days` UTC days, today included, by day, owner and model."""
        with self._db() as conn:
            rows = conn.execute(
                "SELECT * FROM usage WHERE day >= ? ORDER BY day, owner, model", (self.day(1 - days),)
            ).fetchall()
        return [
            {
                "day": r["day"],
                "owner": r["owner"],
                "model": r["model"],
                "input": r["input"],
                "output": r["output"],
                "cacheRead": r["cache_read"],
                "cacheWrite": r["cache_write"],
            }
            for r in rows
        ]
