#!/usr/bin/env bash

set -euo pipefail

watcher_pid=""

cleanup() {
  if [[ -n "${watcher_pid}" ]]; then
    kill "${watcher_pid}" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

npm run data:watch &
watcher_pid="$!"
npm run dev
