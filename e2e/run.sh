#!/usr/bin/env bash
# End-to-end tests on the local bench (make e2e): build server in a container on a free port,
# built interface on another free port, Playwright (Chromium).
#
#   e2e/run.sh [playwright test parameters...]
#
# The script calls itself twice: the outer call picks the interface port and starts the build server
# (tools/dev/server.sh with ...); the inner call, already with FPGASIM_SERVER, FPGASIM_KEY and the accounts
# FPGASIM_ADMIN_* and FPGASIM_USER_* (login and password), builds the interface
# and runs the tests. Playwright itself starts and stops the interface (webServer in playwright.config.ts).
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${FPGASIM_SERVER:-}" ]; then
    # The interface port is needed before the server starts: the server allows its address in CORS.
    FPGASIM_WEB_PORT="$(node -e 'const s = require("node:net").createServer().listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });')"
    export FPGASIM_WEB_PORT
    export FPGASIM_CORS_ORIGIN="http://localhost:${FPGASIM_WEB_PORT}"
    exec tools/dev/server.sh with e2e/run.sh "$@"
fi

export FPGASIM_WEB_DIST="${PWD}/.fpgasim/e2e-dist-${FPGASIM_WEB_PORT}"
trap 'rm -rf "${FPGASIM_WEB_DIST}"' EXIT
( cd web && VITE_BUILD_URL="${FPGASIM_SERVER}" npx vite build --logLevel warn --outDir "${FPGASIM_WEB_DIST}" --emptyOutDir )
cd e2e
npx playwright test "$@"
