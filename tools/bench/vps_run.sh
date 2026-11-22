#!/usr/bin/env bash
# Benchmark, VPS part. Runs on the VPS itself from /opt/fpgasim.
#   1. Native code speed: all combinations of mode and optimization level.
#   2. WebAssembly build time of blink3 by step, each measurement in a new container
#      with the job limits of spec section 8.1.
# Writes only to /var/lib/fpgasim. We spare the neighbors: heavy steps run with --cpus=3 --memory=5g.
set -euo pipefail
cd "$(dirname "$0")/../.."
REPO="${PWD}"
IMAGE="$(tools/bench/image.sh --name)"
docker image inspect "${IMAGE}" > /dev/null 2>&1 || tools/bench/image.sh 3
WORK="/var/lib/fpgasim/bench/${IMAGE#*:}"
JOBS_DIR="/var/lib/fpgasim/jobs"
REPEATS="${REPEATS:-3}"
mkdir -p "${WORK}" "${JOBS_DIR}"
rm -f "${WORK}/buildtime.jsonl"

steal() { vmstat 1 4 | tail -3 | awk '{ if ($(NF-1) > m) m = $(NF-1) } END { print m + 0 }'; }

cat > "${WORK}/meta.json" <<META
{
  "host": "vps",
  "cpu": "$(lscpu | sed -n 's/^Model name: *//p')",
  "cpus": $(nproc),
  "memoryMb": $(free -m | awk '/^Mem:/ { print $2 }'),
  "kernel": "$(uname -r)",
  "docker": "$(docker version --format '{{.Server.Version}}')",
  "image": "${IMAGE}",
  "stealBeforePercent": $(steal)
}
META

echo "== скорость обычного кода"
docker run --rm --cpus=3 --memory=5g --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "${REPO}":/repo:ro -v "${WORK}":/out -w /repo "${IMAGE}" bash -c "
        python3 tools/bench/build.py matrix --src examples/blink3 --targets native --out /out &&
        python3 tools/bench/build.py speed --host vps --out /out &&
        python3 tools/bench/build.py prep --targets wasm --rtdir /out/rt"

echo "== время сборки"
job() {  # job <label> <arguments of build.py one>
    local label="$1"; shift
    local dir="${JOBS_DIR}/bench-$$-${RANDOM}"
    mkdir -p "${dir}" && chmod 777 "${dir}"
    local t0 t1 line
    t0=$(date +%s%N)
    line=$(docker run --rm --network none --cpus 2 --memory 2g --memory-swap 2g \
        --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges \
        --user 10001:10001 --read-only --tmpfs /tmp:size=256m -e HOME=/tmp \
        -v "${dir}":/work -v "${REPO}":/repo:ro -v "${WORK}/rt":/rt:ro \
        "${IMAGE}" python3 /repo/tools/bench/build.py one \
            --src /repo/examples/blink3 --target wasm --rtdir /rt --out /work/b "$@")
    t1=$(date +%s%N)
    echo "{\"label\": \"${label}\", \"wallMs\": $(( (t1 - t0) / 1000000 )), \"build\": ${line}}" >> "${WORK}/buildtime.jsonl"
    echo "${label} $*: $(( (t1 - t0) / 1000000 )) мс"
    # The job files belong to user 10001; only the container can remove them.
    docker run --rm -v "${dir}":/work "${IMAGE}" rm -rf /work/b
    rmdir "${dir}"
}

# Price of an empty container: start and stop with no work.
for _ in 1 2 3; do
    t0=$(date +%s%N)
    docker run --rm --network none --cpus 2 --memory 2g --user 10001:10001 --read-only "${IMAGE}" true
    t1=$(date +%s%N)
    echo "{\"label\": \"empty\", \"wallMs\": $(( (t1 - t0) / 1000000 ))}" >> "${WORK}/buildtime.jsonl"
done

for rep in $(seq "${REPEATS}"); do
    for mode in all ports; do
        for opt in O1 O2 O3; do
            job source  --mode "${mode}" --opt "${opt}" --rt source --jobs 1
            job lib     --mode "${mode}" --opt "${opt}" --rt lib --jobs 1
            job lib-pch --mode "${mode}" --opt "${opt}" --rt lib --pch --jobs 1
        done
        # Extra for -O2: parallel compile, one translation unit, LTO.
        job lib-j2        --mode "${mode}" --opt O2 --rt lib --jobs 2
        job lib-pch-j2    --mode "${mode}" --opt O2 --rt lib --pch --jobs 2
        job lib-unity     --mode "${mode}" --opt O2 --rt lib --unity
        job lib-pch-unity --mode "${mode}" --opt O2 --rt lib --pch --unity
        job lib-lto-j2    --mode "${mode}" --opt O2 --rt lib --lto --jobs 2
    done
done

echo "{\"stealAfterPercent\": $(steal)}" > "${WORK}/meta-after.json"
echo "== готово: ${WORK}"
