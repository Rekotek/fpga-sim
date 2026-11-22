#!/usr/bin/env bash
# Core tests inside the build image (make test-core): build the library and the tests,
# unit tests on the fake engine, examples on the real Verilator.
set -euo pipefail
cd "$(dirname "$0")/../.."
export CXX=clang++
BUILD=core/build
mkdir -p "$BUILD"
cmake -S core -B "$BUILD" -G Ninja -DFPGASIM_BUILD_TESTS=ON > "$BUILD/cmake.log" 2>&1 || { cat "$BUILD/cmake.log"; exit 1; }
cmake --build "$BUILD"
# All control messages of the core from the tests are saved: tools/spec/check.mjs checks them against the schemas.
rm -f "$BUILD/transcript.jsonl"
FPGASIM_TRANSCRIPT="$BUILD/transcript.jsonl" "$BUILD/fpgasim_tests"
python3 tools/native/run_examples.py --jobs "${FPGASIM_JOBS:-4}"
