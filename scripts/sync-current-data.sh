#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_directory="$(cd "${script_directory}/.." && pwd)"
archive_directory="$(cd "${project_directory}/.." && pwd)"
cooldown_directory="${QUBIC_COOLDOWN_DIR:-June2026}"
destination="${archive_directory}/${cooldown_directory}/"
remote_directory="qubicdl:/home/qubic/data/temperature/broadcast"
sync_status_path="${project_directory}/public/data/data-sync-status.json"

mkdir -p "${destination}"
mkdir -p "$(dirname "${sync_status_path}")"

now_ms() {
  node -e 'process.stdout.write(String(Date.now()))'
}

last_success_ms="null"
if [[ -f "${sync_status_path}" ]]; then
  last_success_ms="$(node -e 'const fs = require("node:fs"); try { const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(Number.isFinite(value.lastSuccessAtMs) ? String(value.lastSuccessAtMs) : "null"); } catch { process.stdout.write("null"); }' "${sync_status_path}")"
fi

write_sync_status() {
  local status="$1"
  local last_attempt_ms="$2"
  local last_success="$3"
  local error_json="$4"
  local temporary_path="${sync_status_path}.tmp"
  printf '{"status":"%s","lastAttemptAtMs":%s,"lastSuccessAtMs":%s,"error":%s}\n' \
    "${status}" "${last_attempt_ms}" "${last_success}" "${error_json}" > "${temporary_path}"
  mv "${temporary_path}" "${sync_status_path}"
}

last_attempt_ms="$(now_ms)"

if rsync -avz --partial --append \
  --include='AVS47_1_ch[0-7].txt' \
  --include='AVS47_2_ch[0-7].txt' \
  --include='TEMPERATURE[0-9][0-9].txt' \
  --include='PRESSURE1.txt' \
  --include='compressor[12]_log.txt' \
  --include='inside_weather.txt' \
  --include='weather.txt' \
  --exclude='*' \
  "${remote_directory}/" \
  "${destination}"; then
  write_sync_status "success" "${last_attempt_ms}" "$(now_ms)" "null"
else
  exit_code=$?
  write_sync_status "failed" "${last_attempt_ms}" "${last_success_ms}" '"rsync failed"'
  exit "${exit_code}"
fi
