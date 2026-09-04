"""Cryogenic timeline and mechanical heat-switch event detection.

Thresholds in this file encode the operational definitions agreed for the
QUBIC cooldown timeline.  They are kept in one place, documented, and tested
so a future change is visible in code review instead of being hidden in a web
component.
"""

from __future__ import annotations

import math
import sqlite3
from typing import Iterable, List, Optional

from .database import beginning_of_data, first_threshold, touch_rows


def _event(
    event_id: str,
    event_type: str,
    label: str,
    description: str,
    detected_ms: Optional[float],
) -> dict:
    """Build the stable event shape consumed by the React timeline."""

    detected = detected_ms is not None and math.isfinite(float(detected_ms))
    return {
        "id": event_id,
        "type": event_type,
        "label": label,
        "description": description,
        "timeMs": float(detected_ms) if detected else None,
        "status": "detected" if detected else "pending",
        "confidence": "candidate" if detected else "unavailable",
    }


def _chronological(events: Iterable[dict]) -> List[dict]:
    """Sort detected events while leaving pending events at the end."""

    return sorted(
        events,
        key=lambda event: (
            float(event["timeMs"])
            if event.get("timeMs") is not None
            else float("inf")
        ),
    )


def detect_cryogenic_events(connection: sqlite3.Connection) -> List[dict]:
    """Detect the milestones that define the current cooldown phases.

    The first phase starts at the first valid sample.  Pumping is the first
    pressure bucket at or below 300 mbar.  The main cooldown ends only after
    *both* PT second stages are at or below 4.5 K.  Sub-k milestones then use
    the first crossings of the 3 K, 350 mK and 1 K thresholds requested by the
    instrument team.
    """

    below = lambda channel, threshold: first_threshold(
        connection, channel, threshold, direction="below"
    )
    above = lambda channel, threshold: first_threshold(
        connection, channel, threshold, direction="above"
    )

    pressure_below_300 = below("pressure1", 300)
    ptc1_on = above("compressor1_online", 0.5)
    ptc2_on = above("compressor2_online", 0.5)
    pt1_s2_below_260 = below("avs47_2_ch1", 260)
    pt2_s2_below_260 = below("avs47_2_ch0", 260)
    pt1_s1_below_50 = below("temperature05", 50)
    pt2_s1_below_50 = below("temperature04", 50)
    pt1_s2_below_4p5 = below("avs47_2_ch1", 4.5)
    pt2_s2_below_4p5 = below("avs47_2_ch0", 4.5)
    fridge_300_below_3 = below("avs47_1_ch6", 3)
    fridge_300_below_350 = below("avs47_1_ch6", 0.35)
    fridge_1k_below_3 = below("avs47_1_ch4", 3)
    fridge_1k_below_1 = below("avs47_1_ch4", 1)
    base_1k = below("avs47_1_ch1", 1.2)

    main_complete_ms = None
    if pt1_s2_below_4p5 is not None and pt2_s2_below_4p5 is not None:
        main_complete_ms = max(pt1_s2_below_4p5, pt2_s2_below_4p5)

    return [
        _event(
            "beginning-of-data",
            "data_start",
            "Beginning of data",
            "First valid sample in the current cooldown",
            beginning_of_data(connection),
        ),
        _event(
            "pumping",
            "pumping",
            "Pressure below 300 mbar",
            "Pumping detected from the cryostat pressure",
            pressure_below_300,
        ),
        *_chronological(
            [
                _event(
                    "ptc1-on",
                    "cooling_start",
                    "PTC 1 ON",
                    "Pulse-tube compressor 1 is running",
                    ptc1_on,
                ),
                _event(
                    "ptc2-on",
                    "cooling_start",
                    "PTC 2 ON",
                    "Pulse-tube compressor 2 is running",
                    ptc2_on,
                ),
            ]
        ),
        *_chronological(
            [
                _event(
                    "pt1-s2-260k",
                    "cooling_260k",
                    "PT1 S2 CH below 260 K",
                    "Second stage of PT1 entered the 270–250 K cooldown phase",
                    pt1_s2_below_260,
                ),
                _event(
                    "pt2-s2-260k",
                    "cooling_260k",
                    "PT2 S2 CH below 260 K",
                    "Second stage of PT2 entered the 270–250 K cooldown phase",
                    pt2_s2_below_260,
                ),
            ]
        ),
        *_chronological(
            [
                _event(
                    "pt1-s1-50k",
                    "stage_40k",
                    "PT1 S1 below 50 K",
                    "First stage of PT1 reached the 40 K regime",
                    pt1_s1_below_50,
                ),
                _event(
                    "pt2-s1-50k",
                    "stage_40k",
                    "PT2 S1 below 50 K",
                    "First stage of PT2 reached the 40 K regime",
                    pt2_s1_below_50,
                ),
            ]
        ),
        *_chronological(
            [
                _event(
                    "pt1-s2-4p5k",
                    "stage_4k",
                    "PT1 S2 CH below 4.5 K",
                    "Second stage of PT1 reached the 4 K regime",
                    pt1_s2_below_4p5,
                ),
                _event(
                    "pt2-s2-4p5k",
                    "stage_4k",
                    "PT2 S2 CH below 4.5 K",
                    "Second stage of PT2 reached the 4 K regime",
                    pt2_s2_below_4p5,
                ),
            ]
        ),
        _event(
            "main-cooldown-complete",
            "phase_boundary",
            "End of the main cooldown phase",
            "Both second PTC stages are below 4.5 K",
            main_complete_ms,
        ),
        *_chronological(
            [
                _event(
                    "300mk-fridge-below-3k",
                    "subkelvin_cycle",
                    "300 mK fridge cold head below 3 K",
                    "First 300 mK fridge cycle",
                    fridge_300_below_3,
                ),
                _event(
                    "300mk-fridge-below-350mk",
                    "subkelvin_cycle",
                    "300 mK fridge cold head below 350 mK",
                    "First 300 mK fridge cycle",
                    fridge_300_below_350,
                ),
                _event(
                    "1k-fridge-below-3k",
                    "subkelvin_cycle",
                    "1 K fridge cold head below 3 K",
                    "First 1 K fridge cycle",
                    fridge_1k_below_3,
                ),
                _event(
                    "base-1k",
                    "subkelvin",
                    "1 K stage below 1.2 K",
                    "Automatic candidate — stability to be confirmed",
                    base_1k,
                ),
                _event(
                    "1k-fridge-below-1k",
                    "subkelvin_cycle",
                    "1 K fridge cold head below 1 K",
                    "First 1 K fridge cycle",
                    fridge_1k_below_1,
                ),
            ]
        ),
    ]


def detect_touch_events(
    connection: sqlite3.Connection,
    cryogenic_events: List[dict],
    latest_global_ms: float,
) -> List[dict]:
    """Detect short MHS openings from Touch bucket maxima.

    Touch is intentionally analysed with the *maximum* value in each 30 s
    aggregate bucket.  A mean-only series hides the brief resistance spikes.
    We compare each bucket with the median of the preceding 20 buckets, then
    group adjacent high buckets into one mechanical open/close operation.
    """

    events_by_id = {event["id"]: event for event in cryogenic_events}
    ptc_times = [
        event["timeMs"]
        for event_id in ("ptc1-on", "ptc2-on")
        for event in [events_by_id.get(event_id)]
        if event and event.get("timeMs") is not None
    ]
    if not ptc_times:
        return []

    phase_start_ms = min(ptc_times)
    main_end = events_by_id.get("main-cooldown-complete", {}).get("timeMs")
    phase_end_ms = main_end if main_end is not None else latest_global_ms
    rows = touch_rows(connection, phase_start_ms, phase_end_ms)
    if len(rows) < 21:
        return []

    high_rows = []
    for index in range(20, len(rows)):
        local_values = sorted(row["meanValue"] for row in rows[index - 20 : index])
        baseline = local_values[len(local_values) // 2]
        # Match JavaScript's Number.EPSILON used by the previous detector;
        # this only matters for an (unlikely) zero-valued Touch baseline.
        threshold = max(2.220446049250313e-16, baseline * 1.08)
        if rows[index]["peakValue"] >= threshold:
            peak_ratio = rows[index]["peakValue"] / max(baseline, 1e-12)
            high_rows.append(
                {
                    **rows[index],
                    "baseline": baseline,
                    "threshold": threshold,
                    "peakRatio": peak_ratio,
                }
            )

    operations = []
    active = None
    for row in high_rows:
        if active is None or row["bucketMs"] - active["lastBucketMs"] > 120_000:
            if active is not None:
                operations.append(active)
            active = {
                "startMs": row["startMs"],
                "endMs": row["endMs"],
                "peakMs": row["peakMs"],
                "peakValue": row["peakValue"],
                "peakRatio": row["peakRatio"],
                "baseline": row["baseline"],
                "threshold": row["threshold"],
                "bucketCount": 1,
                "lastBucketMs": row["bucketMs"],
            }
            continue
        active["endMs"] = max(active["endMs"], row["endMs"])
        active["lastBucketMs"] = row["bucketMs"]
        active["bucketCount"] += 1
        if row["peakValue"] > active["peakValue"]:
            active["peakValue"] = row["peakValue"]
            active["peakMs"] = row["peakMs"]
            active["peakRatio"] = row["peakRatio"]
            active["baseline"] = row["baseline"]
            active["threshold"] = row["threshold"]
    if active is not None:
        operations.append(active)

    accepted_operations = [
        operation
        for operation in operations
        if operation["bucketCount"] >= 2 or operation["peakRatio"] >= 1.15
    ]
    return [
        {
            "id": f"mhs-operation-{index + 1}",
            "startMs": operation["startMs"],
            "peakMs": operation["peakMs"],
            "endMs": operation["endMs"],
            "peakValue": operation["peakValue"],
            "baseline": operation["baseline"],
            "threshold": operation["threshold"],
            "peakRatio": operation["peakRatio"],
        }
        for index, operation in enumerate(accepted_operations)
    ]
