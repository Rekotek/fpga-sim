#!/usr/bin/env bash
# Benchmark: run the VPS part from the Mac and fetch the results.
set -euo pipefail
cd "$(dirname "$0")/../.."
# shellcheck source=deploy/site.sh
. deploy/site.sh
VPS="${VPS:?нет VPS: заполните настройки сайта (deploy/site.env.example)}"
VPS_DIR="${VPS_DIR:-/opt/fpgasim}"
IMAGE="$(tools/bench/image.sh --name)"
TAG="${IMAGE#*:}"
rsync -a --delete --exclude .git --exclude bench/out --exclude node_modules ./ "${VPS}:${VPS_DIR}/"
ssh -o BatchMode=yes "${VPS}" "${VPS_DIR}/tools/bench/vps_run.sh"
mkdir -p "bench/out/${TAG}/vps"
rsync -a "${VPS}:/var/lib/fpgasim/bench/${TAG}/"{meta.json,meta-after.json,speed-native-vps.json,buildtime.jsonl} "bench/out/${TAG}/vps/"
