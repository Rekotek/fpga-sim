#!/usr/bin/env bash
# Prints the name of the local service image (target test in server/docker/Dockerfile.api).
#
#   tools/dev/api-image.sh
#
# The tag depends on the repository directory: each worktree builds and tests its own image, so `make image-api`
# in one worktree does not replace the image under a `make check` running in another (decision 181).
# FPGASIM_API_IMAGE set in the environment wins.
set -euo pipefail
if [ -n "${FPGASIM_API_IMAGE:-}" ]; then
    echo "${FPGASIM_API_IMAGE}"
    exit 0
fi
cd "$(dirname "$0")/../.."
# cksum is in POSIX and gives the same number on Mac and Linux.
echo "fpgasim-api:dev-$(printf '%s' "${PWD}" | cksum | cut -d ' ' -f 1)"
