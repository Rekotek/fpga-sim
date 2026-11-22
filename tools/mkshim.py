#!/usr/bin/env python3
"""Shim between the Verilator model and the runtime from the command line.

Header parsing and the template belong to the server (server/job/shimgen.py,
server/templates/shim.cpp.j2); this script wraps them to run the examples
in a native build (tools/native/run_examples.py). Runs inside the build image.

    mkshim.py obj/Vtop.h --top top --json     port list as JSON
    mkshim.py obj/Vtop.h --top top --shim     shim.cpp text
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "server" / "job"))

import shimgen  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("header")
    ap.add_argument("--top", required=True, help="имя верхнего модуля")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--json", action="store_true")
    group.add_argument("--shim", action="store_true")
    args = ap.parse_args()
    with open(args.header, encoding="utf-8") as f:
        ports = shimgen.parse_ports(f.read())
    if not ports:
        print("в заголовке не найдено ни одного порта", file=sys.stderr)
        return 1
    try:
        shim = shimgen.render_shim(ports, args.top)
    except ValueError as e:
        print(e, file=sys.stderr)
        return 1
    if args.json:
        json.dump([asdict(p) for p in ports], sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(shim)
    return 0


if __name__ == "__main__":
    sys.exit(main())
