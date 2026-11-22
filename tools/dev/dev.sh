#!/usr/bin/env bash
# make dev: build server at http://localhost:8080 and the interface (Vite) at http://localhost:5173.
# The interface runs in the background and stops with the server on Ctrl+C. The development key is in
# .fpgasim/dev/key: enter it in the interface once.
set -euo pipefail
cd "$(dirname "$0")/../.."
( cd web && exec npx vite ) &
VITE_PID=$!
trap 'kill "${VITE_PID}" 2> /dev/null || true' EXIT
tools/dev/server.sh run
