#!/usr/bin/env bash
# Deployment of the build server to the VPS (spec section 10.2). It runs on the Mac: make deploy-server.
#
# 1. Sends the state committed in Git (HEAD) to /opt/fpgasim on the VPS.
# 2. Runs deploy/remote.sh there: images, Compose restart, /v1/health check.
# 3. Checks the public URL ${FPGASIM_BUILD_URL}/v1/health.
#
# Host names come from the site settings (deploy/site.env.example, decision 173). The script also writes
# /var/lib/fpgasim/deploy/site.env on the VPS: the CORS origins of the service and the backup bucket.
#
# Building the tools image from scratch takes about half an hour on the VPS, so the remote part
# runs apart from the SSH session, and this script waits for its result and shows the log.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/site.sh
. deploy/site.sh
VPS="${VPS:?нет VPS: заполните настройки сайта (deploy/site.env.example)}"
VPS_DIR="${VPS_DIR:-/opt/fpgasim}"
URL="${FPGASIM_BUILD_URL:?нет FPGASIM_BUILD_URL: заполните настройки сайта}"
WEB_URL="${FPGASIM_WEB_URL:?нет FPGASIM_WEB_URL: заполните настройки сайта}"
RELEASE="$(date -u +%Y%m%d-%H%M)-$(git rev-parse --short HEAD)"
LOG="/var/lib/fpgasim/deploy/${RELEASE}.log"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    echo "в рабочем дереве есть незафиксированные правки: выкладывается только HEAD" >&2
fi

# Site settings on the VPS: remote.sh passes the CORS origins to the service, offsite-r2.sh takes the bucket.
# localhost:5173 stays allowed for a local interface working against this server.
printf 'FPGASIM_CORS_ORIGINS=%s,http://localhost:5173\nFPGASIM_BACKUP_BUCKET=%s\n' "${WEB_URL}" "${FPGASIM_BACKUP_BUCKET:-}" \
    | ssh "${VPS}" "mkdir -p /var/lib/fpgasim/deploy && cat > /var/lib/fpgasim/deploy/site.env"

echo "== передача $(git rev-parse --short HEAD) на ${VPS}:${VPS_DIR}"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT
git archive --format=tar HEAD | tar -x -C "${STAGE}"
# The deletion of extra files is limited to /opt/fpgasim: it is a copy of the repository, nothing else lives there.
rsync -a --delete "${STAGE}/" "${VPS}:${VPS_DIR}/"

echo "== сборка и перезапуск на VPS (выкладка ${RELEASE})"
# The remote part is detached from the SSH session: its own process group (setsid), all three streams closed.
# Otherwise the background command keeps the SSH channel open, and the first ssh does not return until the build ends.
# shellcheck disable=SC2029
ssh "${VPS}" "mkdir -p /var/lib/fpgasim/deploy && rm -f ${LOG}.code && \
    setsid -f sh -c 'cd ${VPS_DIR} && deploy/remote.sh deploy ${RELEASE} > ${LOG} 2>&1; echo \$? > ${LOG}.code' \
        > /dev/null 2>&1 < /dev/null"
# shellcheck disable=SC2029
# A lost connection does not stop the deployment: the loop waits for the exit-code file and survives ssh failures.
until ssh "${VPS}" "test -f ${LOG}.code"; do
    sleep 15
    # shellcheck disable=SC2029
    ssh "${VPS}" "tail -n 1 ${LOG} 2> /dev/null | cut -c1-160" || true
done
# shellcheck disable=SC2029
CODE="$(ssh "${VPS}" "cat ${LOG}.code")"
# shellcheck disable=SC2029
ssh "${VPS}" "tail -n 15 ${LOG}"
if [ "${CODE}" != "0" ]; then
    echo "выкладка не удалась (код ${CODE}); журнал на VPS: ${LOG}" >&2
    exit 1
fi

# The first deployment runs before the nginx vhost is installed: then the public URL is not checked.
if [ -n "${FPGASIM_SKIP_PUBLIC_CHECK:-}" ]; then
    echo "проверка внешнего адреса ${URL} пропущена (FPGASIM_SKIP_PUBLIC_CHECK)"
    exit 0
fi

echo "== внешний адрес"
if curl -fsS --max-time 15 "${URL}/v1/health"; then
    echo
    echo "готово: ${URL}"
else
    echo "сервис на VPS работает, но ${URL} не отвечает: проверьте vhost nginx и сертификат (docs/deploy-server.md)" >&2
    exit 1
fi
