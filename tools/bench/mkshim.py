#!/usr/bin/env python3
"""Benchmark: port list from Vtop.h and the shim for measuring.

Checks assumption 3 of spec section 15.1: ports are read from the lines with the macros
VL_IN*, VL_OUT*, VL_INOUT* of the header that Verilator creates.

    mkshim.py obj/Vtop.h --json          port list as JSON
    mkshim.py obj/Vtop.h --shim          shim.cpp text from the template of spec section 7.2
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass

PORT_RE = re.compile(
    r"\bVL_(IN|OUT|INOUT)(8|16|64|W)?\s*\(\s*&?\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(\d+)\s*)?\)\s*;"
)
ESCAPE_RE = re.compile(r"__0([0-9A-Fa-f]{2})")
DIRS = {"IN": "In", "OUT": "Out", "INOUT": "InOut"}


@dataclass
class Port:
    name: str  # name in Verilog
    cname: str  # name of the member of class Vtop
    dir: str  # In, Out, InOut
    width: int
    msb: int
    lsb: int
    ctype: str


def verilog_name(cname: str) -> str:
    """Verilator encodes characters outside [A-Za-z0-9_] as __0HH."""
    return ESCAPE_RE.sub(lambda m: chr(int(m.group(1), 16)), cname)


def ctype_for(width: int) -> str:
    if width <= 8:
        return "CData"
    if width <= 16:
        return "SData"
    if width <= 32:
        return "IData"
    if width <= 64:
        return "QData"
    return f"VlWide<{(width + 31) // 32}>"


def parse_ports(header: str) -> list[Port]:
    ports: list[Port] = []
    for m in PORT_RE.finditer(header):
        kind, size, cname, msb, lsb, words = m.groups()
        width = abs(int(msb) - int(lsb)) + 1
        # The size in the macro name must match the width.
        expected = {"8": 8, "16": 16, None: 32, "64": 64}.get(size)
        if size == "W":
            if words is None or int(words) != (width + 31) // 32:
                raise ValueError(f"порт {cname}: число слов {words} не подходит к разрядности {width}")
        elif width > expected:
            raise ValueError(f"порт {cname}: разрядность {width} больше размера макроса VL_{kind}{size or ''}")
        ports.append(Port(verilog_name(cname), cname, DIRS[kind], width, int(msb), int(lsb), ctype_for(width)))
    return ports


def render_shim(ports: list[Port]) -> str:
    out: list[str] = []
    out.append("// Создано стендом этапа 0 (tools/bench/mkshim.py). Не править.")
    out.append('#include "Vtop.h"')
    out.append('#include "engine_bench.h"')
    out.append("")
    out.append("namespace {")
    out.append("")
    out.append("struct Shim final : fpgasim::VerilatorEngine<Vtop, Shim> {")
    out.append("    static constexpr fpgasim::PortDesc kPorts[] = {")
    for p in ports:
        name = p.name.replace("\\", "\\\\").replace('"', '\\"')
        out.append(f'        {{ "{name}", fpgasim::PortDir::{p.dir}, {p.width} }},')
    out.append("    };")
    out.append("")
    out.append("    void* portData(int port) {")
    out.append("        switch (port) {")
    for i, p in enumerate(ports):
        out.append(f"            case {i}: return &top_->{p.cname};")
    out.append("        }")
    out.append("        return nullptr;")
    out.append("    }")
    out.append("")
    out.append("    bool outputsChanged() {")
    out.append("        bool changed = false;")
    for i, p in enumerate(ports):
        if p.dir != "Out":
            continue
        out.append(f"        if (FPGASIM_DIFFERS(top_->{p.cname}, prev_{p.cname})) {{")
        out.append(f"            FPGASIM_COPY(prev_{p.cname}, top_->{p.cname});")
        out.append(f"            markChanged({i});")
        out.append("            changed = true;")
        out.append("        }")
    out.append("        return changed;")
    out.append("    }")
    out.append("")
    for p in ports:
        if p.dir == "Out":
            out.append(f"    {p.ctype} prev_{p.cname}{{}};")
    out.append("};")
    out.append("")
    out.append("}  // namespace")
    out.append("")
    out.append("std::unique_ptr<fpgasim::Engine> fpgasim::createEngine() {")
    out.append("    return std::make_unique<Shim>();")
    out.append("}")
    return "\n".join(out) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("header")
    group = ap.add_mutually_exclusive_group(required=True)
    group.add_argument("--json", action="store_true")
    group.add_argument("--shim", action="store_true")
    args = ap.parse_args()
    with open(args.header, encoding="utf-8") as f:
        ports = parse_ports(f.read())
    if not ports:
        print("в заголовке не найдено ни одного порта", file=sys.stderr)
        return 1
    if args.json:
        json.dump([asdict(p) for p in ports], sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
    else:
        sys.stdout.write(render_shim(ports))
    return 0


if __name__ == "__main__":
    sys.exit(main())
