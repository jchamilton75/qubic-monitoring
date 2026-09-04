"""Scientific analysis for the QUBIC monitoring data.

The web application deliberately does not implement scientific event detection.
This package is the small, dependency-free Python boundary between the SQLite
data store and the user interface.  It only reads the database and returns a
JSON-serialisable result.
"""

from .database import latest_global_time_ms
from .events import detect_cryogenic_events, detect_touch_events


def run_analysis(connection):
    """Run all currently supported analyses for one cooldown.

    The connection is opened by the command-line wrapper in read-only mode.
    Keeping the orchestration here makes it straightforward to add further
    analyses (for example cycle statistics) without putting them in the web
    server or ingestion code.
    """

    events = detect_cryogenic_events(connection)
    latest_ms = latest_global_time_ms(connection)
    touch_events = detect_touch_events(connection, events, latest_ms)
    return {
        "schemaVersion": 1,
        "events": events,
        "touchEvents": touch_events,
    }


__all__ = ["run_analysis"]
