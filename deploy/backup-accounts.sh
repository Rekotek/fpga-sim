#!/usr/bin/env bash
# Fetches the latest daily copy of the accounts database from the VPS (accounts spec section 2.5, docs/tz-accounts.md).
# It runs on the author's Mac: make backup-accounts. The service itself writes the copies to /var/lib/fpgasim/backup.
#
# The copy streams over SSH (`ssh … cat`), not through scp: this way the script can be tested with a stub
# SSH command on a local folder (variable SSH). On the VPS the script only reads.
# The service writes the copy from the container, as root, with mode 600: the SSH user cannot read it.
# So a one-off container of the same image reads the file (like `fpgasim-admin db …`): permissions on the VPS
# do not change, and reading works with the service stopped. The list of copies is read directly: the folder
# belongs to the SSH user. To test on a local folder, set REMOTE_CAT=cat.
# The copy goes to a temporary file, is checked against the SQLite header, and only then gets its final name.
# The copy holds password hashes: the folder is 700, the file is 600; the .fpgasim folder is not stored in Git.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=deploy/site.sh
. deploy/site.sh
VPS="${VPS:?нет VPS: заполните настройки сайта (deploy/site.env.example)}"
SSH="${SSH:-ssh}"
REMOTE_DIR="${REMOTE_BACKUP_DIR:-/var/lib/fpgasim/backup}"
DEST="${BACKUP_DEST:-.fpgasim/backup}"
REMOTE_CAT="${REMOTE_CAT:-cd /opt/fpgasim && docker compose --progress quiet --env-file /var/lib/fpgasim/deploy/compose.env -f deploy/compose.yaml run --rm --no-deps -T --entrypoint cat api}"

# shellcheck disable=SC2029
latest="$(${SSH} "${VPS}" "ls -1 ${REMOTE_DIR} 2> /dev/null | grep -E '^accounts-[0-9]{8}\.db\$' | sort | tail -n 1")"
if [[ -z "${latest}" ]]; then
    echo "на ${VPS} в ${REMOTE_DIR} нет копий accounts-ГГГГММДД.db" >&2
    exit 1
fi

mkdir -p "${DEST}"
chmod 700 "${DEST}"
partial="${DEST}/.${latest}.partial"
trap 'rm -f "${partial}"' EXIT
(umask 077 && ${SSH} "${VPS}" "${REMOTE_CAT} ${REMOTE_DIR}/${latest}" > "${partial}")
if [[ "$(head -c 15 "${partial}")" != "SQLite format 3" ]]; then
    echo "${latest}: получен не файл SQLite, копия не сохранена" >&2
    exit 1
fi
mv -f "${partial}" "${DEST}/${latest}"
echo "${DEST}/${latest} ($(wc -c < "${DEST}/${latest}" | tr -d ' ') байт)"
