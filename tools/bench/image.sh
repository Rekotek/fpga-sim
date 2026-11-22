#!/usr/bin/env bash
# Build the images without make (make is not installed on the VPS, and nothing may be installed there).
# Usage: tools/bench/image.sh [jobs]. Prints the build image name as the last line.
#   --name          tools image fpgasim-tools:vl…-em… (Verilator, Emscripten); the bench
#                   and the core tests use it
#   --name-full     build image fpgasim-build:vl…-em…-rt… with the runtime library and the job
#                   script (spec section 8.2); the server uses it, its tag is the toolchain field in the cache
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck disable=SC1091
. server/docker/versions.env
# To compare releases: FPGASIM_VERILATOR=5.050 tools/bench/image.sh
VERILATOR_VERSION="${FPGASIM_VERILATOR:-${VERILATOR_VERSION}}"
TAG="vl${VERILATOR_VERSION}-em${EMSCRIPTEN_VERSION}"
TOOLS="fpgasim-tools:${TAG}"
FULL="fpgasim-build:${TAG}-rt$(head -n 1 core/VERSION)"
case "${1:-}" in
    --name) echo "${TOOLS}"; exit 0 ;;
    --name-full) echo "${FULL}"; exit 0 ;;
esac
echo "сборка образа ${TOOLS}" >&2
docker build -f server/docker/Dockerfile.tools \
    --build-arg UBUNTU_VERSION="${UBUNTU_VERSION}" \
    --build-arg VERILATOR_VERSION="${VERILATOR_VERSION}" \
    --build-arg EMSCRIPTEN_VERSION="${EMSCRIPTEN_VERSION}" \
    --build-arg JOBS="${1:-2}" \
    -t "${TOOLS}" server/docker
echo "сборка образа ${FULL}" >&2
docker build -f server/docker/Dockerfile.build --build-arg TOOLS_IMAGE="${TOOLS}" -t "${FULL}" .
echo "${FULL}"
