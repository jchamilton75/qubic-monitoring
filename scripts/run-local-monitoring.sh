#!/usr/bin/env bash

# One-command local launch. It stops older instances of this project, refreshes
# the data and database, rebuilds the production bundle, then keeps the data
# watcher and web server alive together until the terminal is interrupted.

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_directory="$(cd "${script_directory}/.." && pwd)"
run_directory="${project_directory}/.local/run"
port="${QUBIC_LOCAL_PORT:-3000}"
watcher_pid=""
server_pid=""
cleanup_done=0

usage() {
  printf 'Usage: npm run monitor -- [--port PORT]\n' >&2
}

while [[ "$#" -gt 0 ]]; do
  case "$1" in
    --port)
      if [[ "$#" -lt 2 ]]; then
        usage
        exit 2
      fi
      port="$2"
      shift 2
      ;;
    --port=*)
      port="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage
      exit 2
      ;;
  esac
done

if ! [[ "${port}" =~ ^[0-9]{1,5}$ ]] || (( port < 1 || port > 65535 )); then
  printf 'Invalid port: %s\n' "${port}" >&2
  exit 2
fi

mkdir -p "${run_directory}"

stop_pid() {
  local pid="$1"
  if [[ -z "${pid}" || "${pid}" == "$$" ]] || ! kill -0 "${pid}" 2>/dev/null; then return 0; fi
  kill "${pid}" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if ! kill -0 "${pid}" 2>/dev/null; then return 0; fi
    sleep 1
  done
  kill -KILL "${pid}" 2>/dev/null || true
}

stop_pid_file() {
  local pid_file="$1"
  if [[ ! -f "${pid_file}" ]]; then return 0; fi
  local pid
  pid="$(<"${pid_file}")"
  if [[ "${pid}" =~ ^[0-9]+$ ]]; then stop_pid "${pid}"; fi
  rm -f "${pid_file}"
}

stop_old_project_processes() {
  stop_pid_file "${run_directory}/server.pid"
  stop_pid_file "${run_directory}/watcher.pid"

  # Catch instances launched before the PID files were introduced. The match
  # is restricted to this checkout; unrelated Node services are untouched.
  local pid
  for pid in $(pgrep -f "${project_directory}/scripts/watch-data.sh" || true); do
    stop_pid "${pid}"
  done
  for pid in $(pgrep -f "${project_directory}/node_modules/vinext/dist/cli.js" || true); do
    stop_pid "${pid}"
  done

  # If an old production server still owns our configured port, stop it only
  # when its command line points into this project.
  local listener command_line
  for listener in $(lsof -tiTCP:"${port}" -sTCP:LISTEN 2>/dev/null || true); do
    command_line="$(ps -p "${listener}" -o command= 2>/dev/null || true)"
    if [[ "${command_line}" == *"${project_directory}"* ]]; then
      stop_pid "${listener}"
    fi
  done
}

cleanup() {
  if [[ "${cleanup_done}" == "1" ]]; then return 0; fi
  cleanup_done=1
  set +e
  stop_pid "${server_pid}"
  stop_pid "${watcher_pid}"
  rm -f "${run_directory}/server.pid" "${run_directory}/watcher.pid"
}

trap cleanup EXIT INT TERM

echo "Stopping older local QUBIC Monitoring processes..."
stop_old_project_processes

echo "Refreshing source files, SQLite and the analysis snapshot..."
npm run data:update

echo "Building the local production bundle..."
npm run build

echo "Starting the automatic updater..."
QUBIC_PROJECT_DIR="${project_directory}" QUBIC_SKIP_INITIAL_UPDATE=1 npm run data:watch >"${run_directory}/data-watch.log" 2>&1 &
watcher_pid="$!"
echo "${watcher_pid}" >"${run_directory}/watcher.pid"

echo "Starting the web server on http://127.0.0.1:${port}/"
QUBIC_PROJECT_DIR="${project_directory}" npm run start -- --port "${port}" &
server_pid="$!"
echo "${server_pid}" >"${run_directory}/server.pid"

wait "${server_pid}"
