"""Read-only helpers for the monitoring SQLite schema.

The ingestion process owns schema creation and writes.  Analysis uses only
these small queries so that the scientific layer remains independent from the
Node.js runtime and cannot accidentally mutate the database.
"""

from __future__ import annotations

import math
import sqlite3
from typing import List, Optional


def _as_time(value) -> Optional[float]:
    """Return a finite millisecond timestamp, or ``None`` for missing data."""

    if value is None:
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def beginning_of_data(connection: sqlite3.Connection) -> Optional[float]:
    """Find the first valid sample in the current cooldown."""

    row = connection.execute(
        """
        SELECT MIN(first_at_ms) AS time_ms
        FROM aggregates
        WHERE sample_count > 0
        """
    ).fetchone()
    return _as_time(row[0] if row else None)


def latest_global_time_ms(connection: sqlite3.Connection) -> float:
    """Return the timestamp of the latest valid sample in any channel."""

    row = connection.execute(
        """
        SELECT MAX(last_at_ms) AS time_ms
        FROM aggregates
        WHERE sample_count > 0
        """
    ).fetchone()
    return _as_time(row[0] if row else None) or 0.0


def first_threshold(
    connection: sqlite3.Connection,
    channel_id: str,
    threshold: float,
    *,
    direction: str,
) -> Optional[float]:
    """Find the first bucket whose mean crosses a threshold.

    ``direction`` is intentionally explicit at the call site: a cooldown
    event is either a value going below (temperature/pressure) or above
    (compressor online state) a physical threshold.
    """

    if direction not in {"below", "above"}:
        raise ValueError("direction must be 'below' or 'above'")
    operator = "<=" if direction == "below" else ">="
    row = connection.execute(
        f"""
        SELECT first_at_ms AS time_ms
        FROM aggregates
        WHERE channel_id = ?
          AND sample_count > 0
          AND (sum_value / sample_count) {operator} ?
        ORDER BY bucket_ms ASC
        LIMIT 1
        """,
        (channel_id, threshold),
    ).fetchone()
    return _as_time(row[0] if row else None)


def touch_rows(
    connection: sqlite3.Connection,
    start_ms: float,
    end_ms: float,
) -> List[dict]:
    """Load Touch bucket means and true maxima for MHS peak detection."""

    rows = connection.execute(
        """
        SELECT bucket_ms AS bucket_ms,
               first_at_ms AS start_ms,
               last_at_ms AS end_ms,
               max_value AS peak_value,
               max_at_ms AS peak_ms,
               (sum_value / sample_count) AS mean_value
        FROM aggregates
        WHERE channel_id = 'avs47_1_ch0'
          AND sample_count > 0
          AND first_at_ms BETWEEN ? AND ?
        ORDER BY bucket_ms ASC
        """,
        (start_ms, end_ms),
    ).fetchall()
    result = []
    for row in rows:
        peak = _as_time(row[3])
        mean = _as_time(row[5])
        if peak is None or mean is None:
            # A valid aggregate should always have both values.  Skipping a
            # malformed row is safer than creating a false MHS operation.
            continue
        result.append(
            {
                "bucketMs": _as_time(row[0]) or 0.0,
                "startMs": _as_time(row[1]) or 0.0,
                "endMs": _as_time(row[2]) or 0.0,
                "peakMs": _as_time(row[4]) or _as_time(row[1]) or 0.0,
                "peakValue": peak,
                "meanValue": mean,
            }
        )
    return result
