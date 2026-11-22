"""The shim between the Verilator model and the runtime (spec section 7.2).

Ports are read from the Vtop.h header that Verilator creates: lines with the macros
VL_IN*, VL_OUT*, VL_INOUT* hold the name and the bit bounds (decision 8). The shim text
is created from the template server/templates/shim.cpp.j2.

The job script (job.py, inside the build image) and tools/mkshim.py use this module.
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path

import jinja2

PORT_RE = re.compile(
    r"\bVL_(IN|OUT|INOUT)(8|16|64|W)?\s*\(\s*&?\s*(\w+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*(?:,\s*(\d+)\s*)?\)\s*;"
)
ESCAPE_RE = re.compile(r"__0([0-9A-Fa-f]{2})")
TOP_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*")
DIRS = {"IN": "In", "OUT": "Out", "INOUT": "InOut"}


@dataclass
class Port:
    name: str  # name in Verilog
    cname: str  # name of the Vtop class member
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
        # The size in the macro name must match the bit width.
        expected = {"8": 8, "16": 16, None: 32, "64": 64}.get(size)
        if size == "W":
            if words is None or int(words) != (width + 31) // 32:
                raise ValueError(f"порт {cname}: число слов {words} не подходит к разрядности {width}")
        elif expected is None or width > expected:
            raise ValueError(f"порт {cname}: разрядность {width} больше размера макроса VL_{kind}{size or ''}")
        ports.append(Port(verilog_name(cname), cname, DIRS[kind], width, int(msb), int(lsb), ctype_for(width)))
    return ports


def templates_dir() -> Path:
    """In the repository the templates are in server/templates, in the image in /opt/fpgasim/templates."""
    return Path(os.environ.get("FPGASIM_TEMPLATES") or Path(__file__).resolve().parent.parent / "templates")


def render_shim(ports: list[Port], top: str) -> str:
    if not TOP_RE.fullmatch(top):
        raise ValueError(f"недопустимое имя верхнего модуля: {top}")
    env = jinja2.Environment(
        loader=jinja2.FileSystemLoader(templates_dir()),
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
        undefined=jinja2.StrictUndefined,
        autoescape=False,
    )
    items = [
        {
            "cstr": p.name.replace("\\", "\\\\").replace('"', '\\"'),
            "cname": p.cname,
            "dir": p.dir,
            "width": p.width,
            "ctype": p.ctype,
            "index": i,
        }
        for i, p in enumerate(ports)
    ]
    return env.get_template("shim.cpp.j2").render(ports=items, top=top)
