"""Focused regression tests for the Python analysis boundary."""

from __future__ import annotations

import sqlite3
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from qubic_analysis.events import detect_cryogenic_events, detect_touch_events


def _connection() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.execute(
        """
        CREATE TABLE aggregates (
          channel_id TEXT NOT NULL,
          bucket_ms REAL NOT NULL,
          first_at_ms REAL NOT NULL,
          last_at_ms REAL NOT NULL,
          sum_value REAL NOT NULL,
          min_value REAL,
          max_value REAL,
          max_at_ms REAL,
          sample_count INTEGER NOT NULL,
          suspect_count INTEGER NOT NULL DEFAULT 0,
          invalid_count INTEGER NOT NULL DEFAULT 0,
          last_value REAL
        )
        """
    )
    return connection


def _insert(connection, channel: str, time_ms: float, value: float, maximum=None) -> None:
    peak = value if maximum is None else maximum
    connection.execute(
        """
        INSERT INTO aggregates
          (channel_id, bucket_ms, first_at_ms, last_at_ms, sum_value,
           min_value, max_value, max_at_ms, sample_count, last_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        """,
        (channel, time_ms, time_ms, time_ms, value, value, peak, time_ms, value),
    )


class AnalysisEventsTest(unittest.TestCase):
    def test_cryogenic_thresholds_and_phase_boundary(self):
        connection = _connection()
        values = [
            ("pressure1", 250),
            ("compressor1_online", 1),
            ("compressor2_online", 1),
            ("avs47_2_ch1", 259),
            ("avs47_2_ch0", 259),
            ("temperature05", 49),
            ("temperature04", 49),
            ("avs47_2_ch1", 4),
            ("avs47_2_ch0", 4),
            ("avs47_1_ch6", 2.9),
            ("avs47_1_ch6", 0.34),
            ("avs47_1_ch4", 2.9),
            ("avs47_1_ch4", 0.9),
            ("avs47_1_ch1", 1.1),
        ]
        for index, (channel, value) in enumerate(values):
            _insert(connection, channel, 1_000 + index, value)
        connection.commit()

        events = detect_cryogenic_events(connection)
        by_id = {event["id"]: event for event in events}
        self.assertEqual(by_id["beginning-of-data"]["timeMs"], 1_000)
        self.assertEqual(by_id["pumping"]["timeMs"], 1_000)
        self.assertEqual(by_id["ptc1-on"]["timeMs"], 1_001)
        self.assertEqual(by_id["main-cooldown-complete"]["timeMs"], 1_008)
        self.assertEqual(by_id["300mk-fridge-below-350mk"]["timeMs"], 1_010)

    def test_touch_uses_bucket_maxima_and_groups_open_close(self):
        connection = _connection()
        for index in range(25):
            value = 2.5 if index in (20, 21) else 1.0
            _insert(connection, "avs47_1_ch0", index * 30_000, value, maximum=value)
        connection.commit()
        cryogenic_events = [
            {"id": "ptc1-on", "timeMs": 0},
            {"id": "ptc2-on", "timeMs": 0},
            {"id": "main-cooldown-complete", "timeMs": 25 * 30_000},
        ]

        events = detect_touch_events(connection, cryogenic_events, 25 * 30_000)
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["peakMs"], 20 * 30_000)
        self.assertGreater(events[0]["peakRatio"], 2)


if __name__ == "__main__":
    unittest.main()
