#!/usr/bin/env bash

set -euo pipefail

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_directory="$(cd "${script_directory}/.." && pwd)"
archive_directory="$(cd "${project_directory}/.." && pwd)"
cooldown_directory="${QUBIC_COOLDOWN_DIR:-June2026}"
destination="${archive_directory}/${cooldown_directory}/"
remote_directory="qubicdl:/home/qubic/data/temperature/broadcast"

mkdir -p "${destination}"

rsync -avz --partial --append \
  --include='AVS47_1_ch[0-7].txt' \
  --include='AVS47_2_ch[0-7].txt' \
  --include='TEMPERATURE[0-9][0-9].txt' \
  --include='PRESSURE1.txt' \
  --include='compressor[12]_log.txt' \
  --include='inside_weather.txt' \
  --include='weather.txt' \
  --exclude='*' \
  "${remote_directory}/" \
  "${destination}"
