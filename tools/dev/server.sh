#!/usr/bin/env bash
# Local build server in a container (the same image as on the VPS).
#
#   tools/dev/server.sh run              server at http://localhost:8080 until Ctrl+C (make dev)
#   tools/dev/server.sh with <command>   server on a free port while the command runs (make test-examples);
#                                        the command gets FPGASIM_SERVER, FPGASIM_KEY and the accounts
#                                        FPGASIM_ADMIN_LOGIN, FPGASIM_ADMIN_PASSWORD,
#                                        FPGASIM_USER_LOGIN, FPGASIM_USER_PASSWORD
#                                        FPGASIM_CORS_ORIGIN: the interface address allowed in CORS
#
# Data lives in .fpgasim/<mode> at the repository root: the path must be the same in the service container
# and on the machine, or Docker cannot bind the job folder (spec section 8.1). The development key is created
# on the first run and stored in .fpgasim/<mode>/key; Git ignores this folder. The development accounts
# are there too (accounts spec section 6, docs/tz-accounts.md): administrator admin and user, their passwords
# are in the files admin.password and user.password.
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT="${PWD}"
MODE="${1:?режим: run или with}"
shift
BUILD_IMAGE="$(tools/bench/image.sh --name-full)"
# The command started by "with" gets the same image name (e2e/tests/stage8.spec.ts runs pyvcd in it).
API_IMAGE="$(tools/dev/api-image.sh)"
export FPGASIM_API_IMAGE="${API_IMAGE}"
docker image inspect "${BUILD_IMAGE}" > /dev/null 2>&1 || { echo "нет образа ${BUILD_IMAGE}: выполните make image" >&2; exit 1; }
docker image inspect "${API_IMAGE}" > /dev/null 2>&1 || { echo "нет образа ${API_IMAGE}: выполните make image-api" >&2; exit 1; }

api() {  # api <container name> <data folder> <docker run parameters...> -- <command...>
    local name="$1" dir="$2"; shift 2
    local opts=()
    while [ "$1" != "--" ]; do opts+=("$1"); shift; done
    shift
    # The ${opts[@]+...} form is needed by bash 3.2 on Mac: it treats an empty array under set -u as an error.
    # Service limits: the same as in deploy/compose.yaml.
    docker run --rm --name "${name}" ${opts[@]+"${opts[@]}"} \
        --read-only --tmpfs /tmp --security-opt no-new-privileges \
        --cap-drop ALL --cap-add DAC_OVERRIDE --cap-add FOWNER \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v "${dir}":"${dir}" \
        -e FPGASIM_IMAGE="${BUILD_IMAGE}" -e FPGASIM_DATA_DIR="${dir}/data" \
        -e FPGASIM_KEYS="${dir}/keys.toml" -e FPGASIM_CONFIG="${dir}/config.toml" \
        "${API_IMAGE}" "$@"
}

ensure_key() {  # ensure_key <data folder>
    local dir="$1"
    mkdir -p "${dir}/data"
    if [ ! -s "${dir}/key" ] || [ ! -s "${dir}/keys.toml" ]; then
        rm -f "${dir}/keys.toml"
        ( umask 077; api "fpgasim-admin-$$" "${dir}" -- fpgasim-admin key add dev > "${dir}/key" )
    fi
}

# Bench accounts: administrator admin and user. The utility prints the password
# (accounts spec section 3.8, docs/tz-accounts.md); an account that already exists in the database gets a new password.
ensure_users() {  # ensure_users <data folder>
    local dir="$1" login
    for login in admin user; do
        [ -s "${dir}/${login}.password" ] && continue
        local flags=()
        [ "${login}" = admin ] && flags=(--name "Администратор" --admin)
        [ "${login}" = user ] && flags=(--name "Пользователь")
        ( umask 077
          api "fpgasim-admin-$$" "${dir}" -- fpgasim-admin user add "${login}" "${flags[@]}" > "${dir}/${login}.password" 2> /dev/null \
            || api "fpgasim-admin-$$" "${dir}" -- fpgasim-admin user passwd "${login}" > "${dir}/${login}.password" )
    done
}

case "${MODE}" in
    run)
        DIR="${ROOT}/.fpgasim/dev"
        ensure_key "${DIR}"
        ensure_users "${DIR}"
        echo "сервер сборки: http://localhost:8080, ключ разработки в файле ${DIR}/key" >&2
        echo "вход: логин admin, пароль в файле ${DIR}/admin.password; логин user, пароль в файле ${DIR}/user.password" >&2
        api "fpgasim-dev-$$" "${DIR}" -p 127.0.0.1:8080:8080 -- 
        ;;
    with)
        DIR="${ROOT}/.fpgasim/run-$$"
        NAME="fpgasim-run-$$"
        cleanup() {
            docker stop -t 2 "${NAME}" > /dev/null 2>&1 || true
            # The cache files belong to the user of the service container.
            docker run --rm -v "${ROOT}/.fpgasim":/fpgasim "${API_IMAGE}" rm -rf "/fpgasim/run-$$" > /dev/null 2>&1 || true
            rm -rf "${DIR}"
        }
        trap cleanup EXIT
        ensure_key "${DIR}"
        ensure_users "${DIR}"
        # The assistant runs on the scripted test model (decision 177): no key and no paid calls.
        printf '[assistant]\nenabled = true\nmodel = "fake"\n' > "${DIR}/config.toml"
        # End-to-end tests start the interface on a free port: the server must allow its address in CORS.
        if [ -n "${FPGASIM_CORS_ORIGIN:-}" ]; then
            printf '[server]\ncors_origins = ["%s"]\n' "${FPGASIM_CORS_ORIGIN}" >> "${DIR}/config.toml"
        fi
        api "${NAME}" "${DIR}" -d -p 127.0.0.1::8080 -- > /dev/null
        PORT="$(docker port "${NAME}" 8080/tcp | head -n 1 | sed 's/.*://')"
        export FPGASIM_SERVER="http://127.0.0.1:${PORT}"
        for _ in $(seq 50); do
            curl -fsS "${FPGASIM_SERVER}/v1/health" > /dev/null 2>&1 && break
            sleep 0.2
        done
        curl -fsS "${FPGASIM_SERVER}/v1/health" > /dev/null || { docker logs "${NAME}" >&2; exit 1; }
        FPGASIM_KEY="$(cat "${DIR}/key")" \
            FPGASIM_ADMIN_LOGIN=admin FPGASIM_ADMIN_PASSWORD="$(cat "${DIR}/admin.password")" \
            FPGASIM_USER_LOGIN=user FPGASIM_USER_PASSWORD="$(cat "${DIR}/user.password")" \
            "$@"
        ;;
    *)
        echo "неизвестный режим: ${MODE}" >&2
        exit 2
        ;;
esac
