#!/usr/bin/env bash

set -u

refresh_seconds="${QUBIC_REFRESH_SECONDS:-120}"

while true; do
  if ! npm run data:update; then
    echo "QUBIC data refresh failed; the last valid snapshot remains available." >&2
  fi
  sleep "${refresh_seconds}"
done

