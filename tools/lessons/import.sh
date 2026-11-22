#!/usr/bin/env bash
# Copy lessons 2-10 from the author folder to examples/lessons/ (spec section 2.7).
#
#   tools/lessons/import.sh [lessons folder]      default ~/fpga
#
# Takes the folders lessonNN_* numbered 02 to 10 and in them the files that the project takes in a folder
# (decision 96): design, pin binding, memory data. The Makefile, top.sdc and the board build output
# are not copied. The script does not touch expect.json and fpgasim.json in examples/lessons/:
# the agent composes them from the comment at the start of top.v.
set -euo pipefail
cd "$(dirname "$0")/../.."
SRC="${1:-${HOME}/fpga}"
DST="examples/lessons"
count=0
shopt -s nullglob
for dir in "${SRC}"/lesson[0-9][0-9]_*/; do
    name="$(basename "${dir}")"
    number="${name:6:2}"
    if [ "$((10#${number}))" -lt 2 ] || [ "$((10#${number}))" -gt 10 ]; then continue; fi
    mkdir -p "${DST}/${name}"
    # The old design files are removed: a file deleted by the author must not stay in the example.
    find "${DST}/${name}" -maxdepth 1 -type f \( -name '*.v' -o -name '*.sv' -o -name '*.vh' -o -name '*.svh' \
        -o -name '*.cst' -o -name '*.hex' -o -name '*.mem' \) -delete
    for file in "${dir}"*; do
        case "${file}" in
            *.v | *.sv | *.vh | *.svh | *.cst | *.hex | *.mem) cp "${file}" "${DST}/${name}/" ;;
        esac
    done
    count=$((count + 1))
done
[ "${count}" -gt 0 ] || { echo "в ${SRC} нет папок lessonNN_* с номерами 02–10" >&2; exit 1; }
echo "уроков перенесено: ${count}"
