#!/usr/bin/env bash

set -u

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_directory="$(cd "${script_directory}/.." && pwd)"
watch_status_path="${project_directory}/public/data/data-watch-status.json"
heartbeat_path="${project_directory}/public/data/data-watch-heartbeat.json"
refresh_seconds="${QUBIC_REFRESH_SECONDS:-120}"
update_timeout_seconds="${QUBIC_UPDATE_TIMEOUT_SECONDS:-900}"
skip_initial_update="${QUBIC_SKIP_INITIAL_UPDATE:-0}"
watcher_pid="$$"
watcher_started_at_ms="$(node -e 'process.stdout.write(String(Date.now()))')"

mkdir -p "$(dirname "${watch_status_path}")"

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

write_watch_status() {
  local status="$1"
  local last_update_status="$2"
  local last_update_started_at_ms="$3"
  local last_update_finished_at_ms="$4"
  local next_update_at_ms="$5"
  local temporary_path="${watch_status_path}.tmp"
  printf '{"status":"%s","watcherPid":%s,"watcherStartedAtMs":%s,"refreshSeconds":%s,"lastUpdateStatus":"%s","lastUpdateStartedAtMs":%s,"lastUpdateFinishedAtMs":%s,"nextUpdateAtMs":%s}\n' \
    "${status}" "${watcher_pid}" "${watcher_started_at_ms}" "${refresh_seconds}" "${last_update_status}" \
    "${last_update_started_at_ms}" "${last_update_finished_at_ms}" "${next_update_at_ms}" > "${temporary_path}"
  mv "${temporary_path}" "${watch_status_path}"
}

write_heartbeat() {
  local temporary_path="${heartbeat_path}.tmp"
  printf '{"watcherPid":%s,"heartbeatAtMs":%s}\n' "${watcher_pid}" "$(now_ms)" > "${temporary_path}"
  mv "${temporary_path}" "${heartbeat_path}"
}

heartbeat_loop() {
  while true; do
    write_heartbeat
    sleep 30
  done
}

heartbeat_loop &
heartbeat_pid=$!

run_data_update() {
  npm run data:update &
  local update_pid="$!"
  while kill -0 "${update_pid}" 2>/dev/null; do
    local elapsed_ms=$(( $(now_ms) - update_started_at_ms ))
    if (( elapsed_ms >= update_timeout_seconds * 1000 )); then
      echo "QUBIC data refresh exceeded ${update_timeout_seconds}s; stopping the watcher so the service manager can restart it." >&2
      kill "${update_pid}" 2>/dev/null || true
      for _ in 1 2 3 4 5; do
        if ! kill -0 "${update_pid}" 2>/dev/null; then break; fi
        sleep 1
      done
      kill -KILL "${update_pid}" 2>/dev/null || true
      wait "${update_pid}" 2>/dev/null || true
      return 124
    fi
    sleep 5
  done
  wait "${update_pid}"
}

stop_watcher() {
  write_watch_status "stopped" "stopped" "null" "null" "null"
  kill "${heartbeat_pid}" 2>/dev/null || true
  exit 0
}

trap stop_watcher INT TERM
write_watch_status "running" "never" "null" "null" "$(now_ms)"

if [[ "${skip_initial_update}" == "1" ]]; then
  initial_update_ms="$(now_ms)"
  initial_next_update_at_ms=$((initial_update_ms + refresh_seconds * 1000))
  write_watch_status "running" "success" "${initial_update_ms}" "${initial_update_ms}" "${initial_next_update_at_ms}"
  sleep "${refresh_seconds}"
fi

while true; do
  update_started_at_ms="$(now_ms)"
  write_watch_status "running" "running" "${update_started_at_ms}" "null" "null"
  if run_data_update; then
    update_status="success"
  else
    update_exit_code="$?"
    echo "QUBIC data refresh failed; the last valid snapshot remains available." >&2
    update_status="failed"
  fi
  update_finished_at_ms="$(now_ms)"
  if [[ "${update_exit_code:-0}" -eq 124 ]]; then
    write_watch_status "running" "failed" "${update_started_at_ms}" "${update_finished_at_ms}" "null"
    exit 124
  fi
  next_update_at_ms=$((update_finished_at_ms + refresh_seconds * 1000))
  write_watch_status "running" "${update_status}" "${update_started_at_ms}" "${update_finished_at_ms}" "${next_update_at_ms}"
  sleep "${refresh_seconds}"
done
