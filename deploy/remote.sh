#!/usr/bin/env bash
# The part of the deployment that runs on the VPS itself from /opt/fpgasim. deploy/deploy.sh starts it.
#
#   deploy/remote.sh deploy <release>   build images, restart the service, check /v1/health
#   deploy/remote.sh rollback           restore the previous release
#   deploy/remote.sh status             current release and service state
#
# It touches only its own Compose project (fpgasim), its own images (fpgasim-*) and /var/lib/fpgasim.
# Release log: /var/lib/fpgasim/deploy/releases. A line is "release service-image build-image",
# the last line is the active one. The active release and two previous ones are kept (spec section 10.2).
# Only a release after which the service answered /v1/health goes into the log. If the new release
# did not answer, the script restores the active one itself and exits with an error.
set -euo pipefail
cd "$(dirname "$0")/.."
STATE=/var/lib/fpgasim/deploy
PORT="${FPGASIM_PORT:-8090}"
KEEP=3
mkdir -p "${STATE}" /var/lib/fpgasim/cache /var/lib/fpgasim/jobs
# Accounts database (accounts spec section 2.1 in docs/tz-accounts.md): it holds password hashes, the folder is closed.
mkdir -p -m 700 /var/lib/fpgasim/accounts
# Daily copies of the database (section 2.5): the service writes them, make backup-accounts fetches them.
mkdir -p -m 700 /var/lib/fpgasim/backup

compose() { docker compose --env-file "${STATE}/compose.env" -f deploy/compose.yaml "$@"; }

activate() {  # activate <service image> <build image>
    # CORS origins of the site come from site.env, which deploy/deploy.sh writes (decision 173).
    local cors=""
    if [ -f "${STATE}/site.env" ]; then cors="$(sed -n 's/^FPGASIM_CORS_ORIGINS=//p' "${STATE}/site.env")"; fi
    printf 'FPGASIM_API_IMAGE=%s\nFPGASIM_BUILD_IMAGE=%s\nFPGASIM_PORT=%s\nFPGASIM_CORS_ORIGINS=%s\n' \
        "$1" "$2" "${PORT}" "${cors}" > "${STATE}/compose.env"
    compose up -d --remove-orphans
    for _ in $(seq 60); do
        if curl -fsS "http://127.0.0.1:${PORT}/v1/health" 2> /dev/null | grep -q '"ok"'; then
            echo "сервис отвечает: http://127.0.0.1:${PORT}/v1/health"
            return 0
        fi
        sleep 1
    done
    echo "сервис не ответил на /v1/health за 60 с" >&2
    compose logs --tail 40 api >&2 || true
    return 1
}

prune() {
    # Removes the images of releases older than the last three. An image listed in one
    # of the kept log lines (for example, the shared build image) is not deleted.
    [ -f "${STATE}/releases" ] || return 0
    tail -n "${KEEP}" "${STATE}/releases" > "${STATE}/releases.keep"
    while read -r _ api build; do
        for image in "${api}" "${build}"; do
            if ! awk -v image="${image}" '$2 == image || $3 == image { found = 1 } END { exit !found }' "${STATE}/releases.keep"; then
                docker image rm "${image}" > /dev/null 2>&1 || true
            fi
        done
    done < "${STATE}/releases"
    mv "${STATE}/releases.keep" "${STATE}/releases"
}

case "${1:-}" in
    deploy)
        RELEASE="${2:?имя выкладки}"
        BUILD_IMAGE="$(tools/bench/image.sh --name-full)"
        API_IMAGE="fpgasim-api:${RELEASE}"
        # Spare the neighbours: Verilator in the tools image builds in three threads (decision 13).
        tools/bench/image.sh 3
        docker build -q -f server/docker/Dockerfile.api --target api -t "${API_IMAGE}" . > /dev/null
        if ! activate "${API_IMAGE}" "${BUILD_IMAGE}"; then
            if [ -s "${STATE}/releases" ]; then
                read -r OLD OLD_API OLD_BUILD < <(tail -n 1 "${STATE}/releases")
                echo "выкладка ${RELEASE} не ответила, возвращается ${OLD}" >&2
                activate "${OLD_API}" "${OLD_BUILD}" || echo "прежняя выкладка ${OLD} тоже не ответила" >&2
            else
                echo "выкладка ${RELEASE} не ответила, прежней выкладки нет: сервис остановлен" >&2
                compose down || true
            fi
            docker image rm "${API_IMAGE}" > /dev/null 2>&1 || true
            exit 1
        fi
        echo "${RELEASE} ${API_IMAGE} ${BUILD_IMAGE}" >> "${STATE}/releases"
        prune
        echo "выкладка ${RELEASE} действует"
        ;;
    rollback)
        [ -f "${STATE}/releases" ] && [ "$(wc -l < "${STATE}/releases")" -ge 2 ] || { echo "предыдущей выкладки нет" >&2; exit 1; }
        read -r BAD BAD_API BAD_BUILD < <(tail -n 1 "${STATE}/releases")
        read -r RELEASE API_IMAGE BUILD_IMAGE < <(tail -n 2 "${STATE}/releases" | head -n 1)
        docker image inspect "${API_IMAGE}" "${BUILD_IMAGE}" > /dev/null
        if ! activate "${API_IMAGE}" "${BUILD_IMAGE}"; then
            echo "выкладка ${RELEASE} не ответила, возвращается ${BAD}" >&2
            activate "${BAD_API}" "${BAD_BUILD}" || true
            exit 1
        fi
        # A cancelled release leaves the log together with its service image.
        # The build image is deleted only if no remaining release uses it.
        sed -i '$ d' "${STATE}/releases"
        docker image rm "${BAD_API}" > /dev/null 2>&1 || true
        if ! awk -v image="${BAD_BUILD}" '$3 == image { found = 1 } END { exit !found }' "${STATE}/releases"; then
            docker image rm "${BAD_BUILD}" > /dev/null 2>&1 || true
        fi
        echo "отменена выкладка ${BAD}, действует ${RELEASE}"
        ;;
    status)
        if [ -f "${STATE}/releases" ]; then tail -n 1 "${STATE}/releases"; else echo "выкладок не было"; fi
        if [ -f "${STATE}/compose.env" ]; then compose ps; fi
        ;;
    *)
        echo "использование: deploy/remote.sh deploy <выкладка> | rollback | status" >&2
        exit 2
        ;;
esac
