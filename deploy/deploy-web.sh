#!/usr/bin/env bash
# Deployment of the interface statics to Cloudflare Pages (make deploy-web, spec section 10.1).
#
#   deploy/deploy-web.sh
#
# Builds the interface with the build server address FPGASIM_BUILD_URL and deploys web/dist to the Pages project
# FPGASIM_PAGES_PROJECT (branch main is the production deployment). Both come from the site settings
# (deploy/site.env.example). The project is created on the first run; the own domain is attached
# in the Cloudflare panel (docs/deploy-web.md).
# It needs wrangler login; the repository holds no keys.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/site.sh
. deploy/site.sh
PROJECT="${FPGASIM_PAGES_PROJECT:-fpga-sim}"
BUILD_URL="${FPGASIM_BUILD_URL:?нет FPGASIM_BUILD_URL: заполните настройки сайта (deploy/site.env.example)}"
command -v wrangler > /dev/null || { echo "нет wrangler: установите его (brew install cloudflare-wrangler)" >&2; exit 1; }

# Deployment label: time and commit, like the build server; "+" means uncommitted changes in the tree.
STAMP="$(date -u +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- web boards parts spec examples || echo +)"

( cd web && VITE_BUILD_URL="${BUILD_URL}" npx vite build --logLevel warn --outDir dist --emptyOutDir )
test -s web/dist/index.html && test -s web/dist/_headers
grep -q "connect-src 'self' ${BUILD_URL};" web/dist/_headers \
    || { echo "адрес сервера сборки ${BUILD_URL} не попал в web/dist/_headers" >&2; exit 1; }

# The list is read in full before the search: grep -q in a pipeline would break wrangler at the first match.
PROJECTS="$(wrangler pages project list 2> /dev/null)"
if ! grep -q "│ ${PROJECT} " <<< "${PROJECTS}"; then
    wrangler pages project create "${PROJECT}" --production-branch main
fi
wrangler pages deploy web/dist --project-name "${PROJECT}" --branch main --commit-dirty=true --commit-message "${STAMP}"
echo "статика выложена: ${STAMP}"
