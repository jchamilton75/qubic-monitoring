#!/usr/bin/env python3
"""Command-line entry point for the QUBIC scientific analysis engine."""

from __future__ import annotations

import argparse
import json
import sqlite3
import tempfile
import time
from pathlib import Path

from qubic_analysis import run_analysis


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyse one QUBIC cooldown SQLite database")
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    if not args.database.is_file():
        parser.error(f"database does not exist: {args.database}")

    # SQLite's read-only URI prevents an analysis run from creating or changing
    # a database file.  Node remains the sole owner of ingestion and schema
    # migrations.
    connection = sqlite3.connect(
        f"file:{args.database.resolve()}?mode=ro",
        uri=True,
        timeout=60,
    )
    try:
        connection.execute("PRAGMA busy_timeout = 60000")
        result = run_analysis(connection)
    finally:
        connection.close()

    payload = {
        "schemaVersion": result["schemaVersion"],
        "generatedAtMs": int(time.time() * 1000),
        "engine": "python",
        "events": result["events"],
        "touchEvents": result["touchEvents"],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Replace atomically so the web server never observes a half-written JSON
    # file if an update happens while it is serving the dashboard.
    with tempfile.NamedTemporaryFile(
        mode="w",
        encoding="utf-8",
        dir=args.output.parent,
        prefix=f".{args.output.name}.",
        delete=False,
    ) as handle:
        json.dump(payload, handle, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        handle.write("\n")
        temporary_path = Path(handle.name)
    temporary_path.replace(args.output)
    print(json.dumps({"engine": "python", "events": len(payload["events"]), "touchEvents": len(payload["touchEvents"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
