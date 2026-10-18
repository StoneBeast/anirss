#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
export ANIRSS_PORT="${ANIRSS_PORT:-${QBRSS_PORT:-8777}}"
exec node app/server/index.js
