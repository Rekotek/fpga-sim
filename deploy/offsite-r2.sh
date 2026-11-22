#!/usr/bin/env bash
# A copy of the accounts database outside the VPS (accounts spec section 2.5 in docs/tz-accounts.md, decision 160): once a day
# it sends the latest daily copy from /var/lib/fpgasim/backup to Cloudflare R2.
# It runs on the VPS from the cron of the SSH user:
#
#   50 3 * * * /opt/fpgasim/deploy/offsite-r2.sh >> /var/lib/fpgasim/deploy/offsite-r2.log 2>&1
#
# The bucket is FPGASIM_BACKUP_BUCKET from /var/lib/fpgasim/deploy/site.env, which deploy/deploy.sh writes
# (decision 173); the token is the rclone profile [backups] in ~/.config/rclone/rclone.conf. It has its own prefix fpgasim/:
# the rotation below deletes only inside it.
#
# The service writes the copy from the container, as root, with mode 600: a one-off container
# of the same image reads the file (like deploy/backup-accounts.sh, decision 159) and streams it to the bucket, without
# a temporary file. The size is visible without read permission: the folder belongs to the SSH user.
#
# Success is not the rclone exit code but an object in the bucket of the same size: on R2 an empty listing gives
# code 0 (a lesson from another service's backup script). A copy not from today (UTC) also gives exit 1: it means
# the service stopped writing daily copies, although the previous one still goes to the bucket.
set -euo pipefail
cd "$(dirname "$0")/.."

RCLONE="${RCLONE:-$HOME/bin/rclone}"
REMOTE="${REMOTE:-backups}"
if [ -z "${BUCKET:-}" ] && [ -f /var/lib/fpgasim/deploy/site.env ]; then
    BUCKET="$(sed -n 's/^FPGASIM_BACKUP_BUCKET=//p' /var/lib/fpgasim/deploy/site.env)"
fi
BUCKET="${BUCKET:?нет ведра: FPGASIM_BACKUP_BUCKET в настройках сайта}"
PREFIX="${PREFIX:-fpgasim}"
KEEP_DAYS="${KEEP_DAYS:-30}"
BACKUP_DIR="${BACKUP_DIR:-/var/lib/fpgasim/backup}"
# To test on a local folder, set REMOTE_CAT=cat.
REMOTE_CAT="${REMOTE_CAT:-docker compose --progress quiet --env-file /var/lib/fpgasim/deploy/compose.env -f deploy/compose.yaml run --rm --no-deps -T --entrypoint cat api}"

echo "=== копия базы в R2: начало $(date -u '+%F %T UTC')"
[ -x "${RCLONE}" ] || { echo "ОШИБКА: нет rclone по пути ${RCLONE}"; exit 1; }

latest="$(ls -1 "${BACKUP_DIR}" | grep -E '^accounts-[0-9]{8}\.db$' | sort | tail -n 1 || true)"
if [ -z "${latest}" ]; then
    echo "ОШИБКА: в ${BACKUP_DIR} нет копий accounts-ГГГГММДД.db"
    exit 1
fi
local_size="$(stat -c %s "${BACKUP_DIR}/${latest}" 2> /dev/null || stat -f %z "${BACKUP_DIR}/${latest}")"
dest="${REMOTE}:${BUCKET}/${PREFIX}/${latest}"

# shellcheck disable=SC2086
${REMOTE_CAT} "${BACKUP_DIR}/${latest}" < /dev/null | "${RCLONE}" rcat "${dest}"

fail=0
remote_size="$("${RCLONE}" lsf --format s "${dest}" 2> /dev/null | head -n 1)"
if [ -z "${remote_size}" ]; then
    echo "ОШИБКА: ${latest} нет в ведре после загрузки"
    fail=1
elif [ "${remote_size}" != "${local_size}" ]; then
    echo "ОШИБКА: ${latest} в ведре ${remote_size} Б, на VPS ${local_size} Б"
    fail=1
else
    echo "в ведре: ${dest} (${remote_size} Б, сходится)"
fi

if [ "${latest}" != "accounts-$(date -u +%Y%m%d).db" ]; then
    echo "ОШИБКА: последняя копия ${latest} не за сегодня: сервис не пишет суточные копии (журнал, \"op\": \"backup\")"
    fail=1
fi

# Rotation: older than KEEP_DAYS days, only inside the prefix. A failure is printed: otherwise the bucket grows silently.
if ! "${RCLONE}" delete --min-age "${KEEP_DAYS}d" "${REMOTE}:${BUCKET}/${PREFIX}/" 2>&1; then
    echo "ВНИМАНИЕ: ротация в ведре не отработала: проверить права токена на удаление"
fi

echo "=== копия базы в R2: конец $(date -u '+%F %T UTC'), сбоев: ${fail}"
exit "${fail}"
