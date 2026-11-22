#!/usr/bin/env bash
# Benchmark, Mac part: build all variants in the image, measure native code
# (linux/arm64 container in Docker Desktop) and WebAssembly in Node.
# Another Verilator release for comparison: FPGASIM_VERILATOR=5.050 tools/bench/run_mac.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
IMAGE="$(tools/bench/image.sh --name)"
OUT="bench/out/${IMAGE#*:}"
mkdir -p "${OUT}"
POWER_START="$(node tools/bench/power.mjs)"
docker run --rm -v "${PWD}":/repo -w /repo "${IMAGE}" bash -c "
    python3 tools/bench/build.py matrix --src examples/blink3 --targets native,wasm --out ${OUT} &&
    python3 tools/bench/build.py speed --host mac --out ${OUT} &&
    python3 tools/bench/check_assumptions.py --out ${OUT} > ${OUT}/assumptions.log"
echo "{\"start\": ${POWER_START}, \"end\": $(node tools/bench/power.mjs)}" > "${OUT}/power-native-mac.json"
node tools/bench/run_node.mjs "${OUT}" mac
