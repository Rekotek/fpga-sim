#!/usr/bin/env bash
# Rollback of the build server to the previous release (spec section 10.2). It runs on the Mac.
# The images of the two previous releases are kept on the VPS; the code in /opt/fpgasim does not change on rollback.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/site.sh
. deploy/site.sh
VPS="${VPS:?нет VPS: заполните настройки сайта (deploy/site.env.example)}"
VPS_DIR="${VPS_DIR:-/opt/fpgasim}"
# shellcheck disable=SC2029
ssh "${VPS}" "cd ${VPS_DIR} && deploy/remote.sh rollback"
