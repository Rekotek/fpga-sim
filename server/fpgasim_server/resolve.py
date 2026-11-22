"""Project settings resolution (spec sections 2.5, 2.6 and 8.4).

The first part (resolve) runs before the build and does not know the ports: files, testbenches, the top module,
the binding source, matching pins against the board, the cache key. The second part (bind) runs once
Verilator has named the top module ports: matching the binding against ports, the clock, free ports.
The binding is not part of the cache key, so the second part also runs on a cache hit.
"""

from __future__ import annotations

import bisect
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import Any

import jsonschema

from .cst import parse_cst
from .diagnostics import Diagnostic, diag, has_errors

CONFIG_FILE = "fpgasim.json"
DESIGN_EXT = {".v", ".sv"}
HEADER_EXT = {".vh", ".svh"}
DATA_EXT = {".hex", ".mem"}
DEFAULT_BOARD = "tang-nano-20k"

# Comments and strings are replaced with spaces of the same length: positions and line numbers stay.
# An unclosed /* comment eats the text to the end in one step: otherwise each "/*" would force
# a search for its pair to the end of the file, and parsing a file of only "/*" would take quadratic time.
STRIP_RE = re.compile(r'//[^\n]*|/\*(?:.*?\*/|.*\Z)|"(?:\\.|[^"\\\n])*"', re.S)
WORD_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_$]*")
ENDMODULE_RE = re.compile(r"\bendmodule\b")
MODULE_RE = re.compile(r"\b(?:macro)?module\s+(?:(?:static|automatic)\s+)?([A-Za-z_][A-Za-z0-9_$]*)")
END_LABEL_RE = re.compile(r"\bendmodule\s*:\s*[A-Za-z_][A-Za-z0-9_$]*")
BIT_RE = re.compile(r"^(.+)\[(\d+)\]$")
TB_NAME_RE = re.compile(r"^(tb_.*|.*_tb)$")
BOARD_ID_RE = re.compile(r"[a-z0-9][a-z0-9-]*")
PIN_NUMBER_RE = re.compile(r"[0-9]{1,6}")
IMPORT_RE = re.compile(r"\s*import\b[^;]*;")
# C code insertions in a design (decision 42): $c and the `systemc_* directives. The third part catches a "$"
# that is not followed by a letter: this is how the name $c is assembled by pasting in a macro ($``c).
# [$] and [$:N] are allowed.
C_CODE_RE = re.compile(r"(?<![A-Za-z0-9_$])\$c\d*(?![A-Za-z0-9_$])|`systemc_\w+|(?<![A-Za-z0-9_$])\$(?![A-Za-z_\]:])")

# Fields of fpgasim.json per the table of spec section 2.2; the others are kept and raise a warning.
KNOWN_FIELDS: dict[str, set[str]] = {
    "": {"format", "name", "board", "design", "pins", "boardParts", "parts", "watch", "record", "testbenches", "sim"},
    "design": {"files", "top", "parameters", "defines", "includeDirs", "constraints", "visibility"},
    "record": {"signals", "mode", "depth", "windowPs", "trigger"},
    "sim": {"speed"},
}


@dataclass
class Module:
    name: str
    file: str
    start: int  # start of the word module in the text without comments
    name_end: int
    end: int  # end of the module: position of its endmodule or the end of the text
    has_ports: bool

    @property
    def is_testbench(self) -> bool:
        return not self.has_ports or bool(TB_NAME_RE.match(self.name))


@dataclass
class Binding:
    """Binding of a port bit to a pin from .cst or from the pins field."""

    name: str  # as written: clk, led[0]
    pin: int | None
    pull: str
    line: int | None
    io_type: str | None = None  # IO_TYPE from IO_PORT, for .cst only
    io_line: int | None = None  # line of the IO_PORT with this IO_TYPE


@dataclass
class Resolution:
    diagnostics: list[Diagnostic] = field(default_factory=list)
    resolved: dict[str, Any] = field(default_factory=dict)
    board: dict[str, Any] | None = None
    bindings: list[Binding] = field(default_factory=list)
    binding_file: str | None = None  # file that the binding messages refer to
    binding_prefix: str = "CST"  # CST for .cst, PINS for the pins field
    top_text: str = ""  # text of the top module without comments: the port order is restored from it
    job: dict[str, Any] | None = None  # request to the job
    sources: dict[str, str] = field(default_factory=dict)  # files the job sees
    build_id: str | None = None

    @property
    def failed(self) -> bool:
        return has_errors(self.diagnostics)


def strip_code(text: str) -> str:
    return STRIP_RE.sub(lambda m: re.sub(r"[^\n]", " ", m.group(0)), text)


def _balanced(text: str, at: int) -> int:
    """Position after the bracket that closes the one at text[at]; -1 if there is no pair."""
    depth = 0
    for i in range(at, len(text)):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i + 1
    return -1


def find_modules(clean: str, file: str) -> list[Module]:
    """module declarations in the text without comments and strings. Ports are a non-empty list in the header.

    The search for the end of the header and of the module is bounded by the start of the next module: parse time
    is linear in the file size, however many declarations it holds.
    """
    modules: list[Module] = []
    matches = list(MODULE_RE.finditer(clean))
    ends = [e.start() for e in ENDMODULE_RE.finditer(clean)]
    for i, m in enumerate(matches):
        at = m.end()
        limit = matches[i + 1].start() if i + 1 < len(matches) else len(clean)
        # A SystemVerilog header may start with import package::*; — it ends with its own semicolon.
        while (imp := IMPORT_RE.match(clean, at, limit)) is not None:
            at = imp.end()
        end = clean.find(";", at, limit)
        header = clean[at : end if end >= 0 else limit]
        pos = len(header) - len(header.lstrip())
        if header[pos : pos + 1] == "#":  # parameter list
            open_at = header.find("(", pos)
            pos = _balanced(header, open_at) if open_at >= 0 else -1
            if pos >= 0:
                pos += len(header[pos:]) - len(header[pos:].lstrip())
        has_ports = False
        if pos >= 0 and header[pos : pos + 1] == "(":
            close = _balanced(header, pos)
            has_ports = close >= 0 and bool(header[pos + 1 : close - 1].strip())
        k = bisect.bisect_left(ends, at)
        body_end = ends[k] if k < len(ends) and ends[k] < limit else limit
        modules.append(Module(m.group(1), file, m.start(), m.end(), body_end, has_ports))
    return modules


def used_names(texts: dict[str, str], modules: dict[str, list[Module]]) -> set[str]:
    """Names that occur as a separate word outside module headers in the design files.

    A mention inside a testbench does not count: a testbench in a mixed file (TB_MIXED) creates
    an instance of the top module, and that does not stop it from being the top.
    One pass over the words of each file: time is linear in the project size.
    """
    used: set[str] = set()
    for file, text in texts.items():
        declared = {m.name_end - len(m.name) for m in modules.get(file, [])}  # positions of names in headers
        benches = sorted((tb.start, tb.end) for tb in modules.get(file, []) if tb.is_testbench)
        starts = [b[0] for b in benches]
        for w in WORD_RE.finditer(text):
            if w.start() in declared:
                continue
            k = bisect.bisect_right(starts, w.start()) - 1
            if k >= 0 and w.start() < benches[k][1]:
                continue
            used.add(w.group(0))
    return used


def _unknown_fields(config: dict[str, Any]) -> list[str]:
    found = [key for key in config if key not in KNOWN_FIELDS[""]]
    for section in ("design", "record", "sim"):
        value = config.get(section)
        if isinstance(value, dict):
            found += [f"{section}.{key}" for key in value if key not in KNOWN_FIELDS[section]]
    return found


def _canonical(doc: object) -> bytes:
    return json.dumps(doc, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


@dataclass
class ProjectFiles:
    """Result of the shared parse part: settings, design files, testbenches, modules."""

    config: dict[str, Any]
    design: dict[str, Any]
    board: dict[str, Any]
    verilog: list[str]
    clean: dict[str, str]  # text of the Verilog files without comments and strings
    modules: dict[str, list[Module]]
    testbenches: list[str]
    design_files: list[str]


def _ext(path: str) -> str:
    return PurePosixPath(path).suffix.lower()


def _project_files(
    res: Resolution, files: dict[str, str], config: dict[str, Any] | None, share_dir: Path
) -> ProjectFiles | None:
    """Settings, board, design files and testbenches (spec section 2.5). None means the parse ended with an error."""
    out = res.diagnostics

    def project_error(code: str, original: str, **args: Any) -> None:  # noqa: ANN401
        out.append(diag("project", "error", code, original, **args))

    # --- fpgasim.json ---------------------------------------------------------------
    # The settings file may be missing: then the defaults and autodetection apply (spec section 2.1).
    errors: list[jsonschema.ValidationError] = []
    if config is None:
        config = {}
    else:
        schema = json.loads((share_dir / "spec" / "fpgasim.schema.json").read_text(encoding="utf-8"))
        validator = jsonschema.Draft202012Validator(schema)
        errors = sorted(validator.iter_errors(config), key=lambda e: [str(p) for p in e.absolute_path])
    if errors:
        for e in errors[:10]:
            where = "/".join(str(p) for p in e.absolute_path)
            out.append(diag("project", "error", "CONFIG_INVALID", e.message, file=CONFIG_FILE, path=where))
        return None
    for name in _unknown_fields(config):
        out.append(
            diag("project", "warning", "CONFIG_UNKNOWN_FIELD", f"Неизвестное поле {name}", file=CONFIG_FILE, field=name)
        )
    design: dict[str, Any] = config.get("design", {})

    board_id = config.get("board", DEFAULT_BOARD)
    res.resolved["board"] = board_id
    board_path = share_dir / "boards" / f"{board_id}.json"
    if not BOARD_ID_RE.fullmatch(board_id) or not board_path.exists():
        project_error("BOARD_UNKNOWN", f"Платы {board_id} нет", file=CONFIG_FILE, board=board_id)
        return None
    board = res.board = json.loads(board_path.read_text(encoding="utf-8"))

    # --- Files, modules, testbenches --------------------------------------------------
    verilog = sorted(p for p in files if _ext(p) in DESIGN_EXT)
    clean = {p: END_LABEL_RE.sub("endmodule", strip_code(files[p])) for p in verilog}
    modules = {p: find_modules(clean[p], p) for p in verilog}

    given_tb = config.get("testbenches")
    if given_tb is None:
        testbenches = [p for p in verilog if modules[p] and all(m.is_testbench for m in modules[p])]
    else:
        testbenches = list(given_tb)
        for p in testbenches:
            if p not in files:
                project_error("FILE_NOT_FOUND", f"Файла {p} нет в проекте", file=CONFIG_FILE, path=p)
                return None
    res.resolved["testbenches"] = testbenches

    given_files = design.get("files")
    if given_files is None:
        design_files = [p for p in verilog if p not in testbenches]
    else:
        design_files = list(given_files)
        for p in design_files:
            if p not in files:
                project_error("FILE_NOT_FOUND", f"Файла {p} нет в проекте", file=CONFIG_FILE, path=p)
                return None
            if _ext(p) not in DESIGN_EXT:
                project_error("FILE_NOT_DESIGN", f"Файл {p} не является схемой (.v, .sv)", file=CONFIG_FILE, path=p)
                return None
    res.resolved["files"] = design_files
    for p in design_files:
        kinds = {m.is_testbench for m in modules.get(p, [])}
        if given_tb is None and kinds == {True, False}:
            names = [m.name for m in modules[p] if m.is_testbench]
            out.append(
                diag(
                    "project", "warning", "TB_MIXED",
                    f"В файле {p} есть и схема, и тестбенч ({', '.join(names)}): файл остаётся в сборке",
                    file=p, modules=names,
                )
            )  # fmt: skip
    return ProjectFiles(config, design, board, verilog, clean, modules, testbenches, design_files)


def resolve(
    files: dict[str, str],
    config: dict[str, Any] | None,
    visibility_override: str | None,
    *,
    share_dir: Path,
    toolchain: str,
    runtime: str,
) -> Resolution:
    res = Resolution()
    out = res.diagnostics

    def project_error(code: str, original: str, **args: Any) -> Resolution:  # noqa: ANN401
        out.append(diag("project", "error", code, original, **args))
        return res

    project = _project_files(res, files, config, share_dir)
    if project is None:
        return res
    config, design, board = project.config, project.design, project.board
    verilog, clean, modules = project.verilog, project.clean, project.modules
    testbenches, design_files = project.testbenches, project.design_files
    ext = _ext

    # --- Top module --------------------------------------------------------------
    design_modules = [m for p in design_files for m in modules.get(p, [])]
    design_texts = {p: clean[p] for p in design_files if p in clean}
    top = design.get("top")
    if top is not None:
        named = [m for m in design_modules if m.name == top]
        if not named:
            return project_error("TOP_NOT_FOUND", f"Модуля {top} нет в файлах схемы", file=CONFIG_FILE, top=top)
        if not named[0].has_ports:
            return project_error(
                "TOP_NO_PORTS", f"У модуля {top} нет портов: верхним он быть не может", file=named[0].file, top=top
            )
    else:
        used = used_names(design_texts, modules)
        candidates = [m.name for m in design_modules if not m.is_testbench and m.name not in used]
        candidates = list(dict.fromkeys(candidates))
        if not candidates:
            return project_error(
                "TOP_NOT_FOUND", "Верхний модуль не найден: в проекте нет модуля, который никем не используется"
            )
        if len(candidates) > 1:
            return project_error(
                "TOP_AMBIGUOUS", f"Верхним может быть любой из модулей: {', '.join(candidates)}", candidates=candidates
            )
        top = candidates[0]
    res.resolved["top"] = top
    top_module = next(m for m in design_modules if m.name == top)
    res.resolved["topFile"] = top_module.file  # the interface marks this file in the file list
    res.top_text = clean[top_module.file][top_module.name_end : top_module.end]

    # The default is ports only: 1.3–2 times faster (decision 108).
    visibility = visibility_override or design.get("visibility", "ports")
    res.resolved["visibility"] = visibility

    # --- Binding -----------------------------------------------------------------
    csts = sorted(p for p in files if ext(p) == ".cst")
    constraints = design.get("constraints")
    cst_file: str | None = None
    if constraints is False:
        pass
    elif constraints is not None:
        if constraints not in files:
            return project_error(
                "FILE_NOT_FOUND", f"Файла {constraints} нет в проекте", file=CONFIG_FILE, path=constraints
            )
        cst_file = constraints
    elif len(csts) == 1:
        cst_file = csts[0]
    elif len(csts) > 1:
        return project_error(
            "CST_AMBIGUOUS", f"В проекте несколько файлов привязки: {', '.join(csts)}", candidates=csts
        )
    res.resolved["constraints"] = cst_file

    pins_field: dict[str, Any] = config.get("pins", {})
    if cst_file is not None:
        res.binding_file, res.binding_prefix = cst_file, "CST"
        entries, cst_diagnostics = parse_cst(files[cst_file], cst_file)
        out.extend(cst_diagnostics)
        for e in entries:
            pin: int | None = None
            if e.pin is not None:
                if not PIN_NUMBER_RE.fullmatch(e.pin):
                    shown = e.pin[:32]  # the pin number may turn out to be a string of any length
                    out.append(
                        diag("cst", "error", "CST_NO_PIN", f"Вывода {shown} у платы нет", file=cst_file, line=e.line,
                             port=e.name, pin=shown)
                    )  # fmt: skip
                    continue
                pin = int(e.pin)
            res.bindings.append(Binding(e.name, pin, e.pull, e.line, e.attrs.get("IO_TYPE"), e.port_line))
        if pins_field:
            out.append(
                diag(
                    "project", "warning", "PINS_IGNORED",
                    f"Действует файл привязки {cst_file}: поле pins не используется",
                    file=CONFIG_FILE, constraints=cst_file,
                )
            )  # fmt: skip
    else:
        res.binding_file, res.binding_prefix = CONFIG_FILE, "PINS"
        res.bindings = [Binding(name, b["pin"], b.get("pull", "none"), None) for name, b in pins_field.items()]

    # Matching pins against the board: it needs no knowledge of the ports.
    source = "cst" if res.binding_prefix == "CST" else "project"
    by_pin: dict[int, Binding] = {}
    later: dict[int, dict[str, Any]] = {
        pin: device for device in board.get("devices", []) if device.get("since") is not None for pin in device["pins"]
    }
    for b in res.bindings:
        if b.pin is None:
            continue
        info = board["pins"].get(str(b.pin))
        where = {"file": res.binding_file, "line": b.line}
        if info is None:
            out.append(
                diag(source, "error", f"{res.binding_prefix}_NO_PIN", f"Вывода {b.pin} у платы нет", **where,
                     port=b.name, pin=b.pin)
            )  # fmt: skip
            continue
        if b.pin in by_pin:
            other = by_pin[b.pin].name
            out.append(
                diag(source, "error", f"{res.binding_prefix}_PIN_TWICE",
                     f"Вывод {b.pin} занят двумя портами: {other} и {b.name}", **where,
                     pin=b.pin, ports=[other, b.name])
            )  # fmt: skip
            continue
        by_pin[b.pin] = b
        if info.get("status") == "forbidden":
            out.append(
                diag(source, "warning", "PIN_FORBIDDEN",
                     f"Вывод {b.pin} ({info.get('name', '')}) занят на плате, использовать его нельзя", **where,
                     port=b.name, pin=b.pin, name=info.get("name", ""))
            )  # fmt: skip
            continue
        # Pin standard (decision 164): IO_TYPE from .cst is checked against the pin standard in the board file,
        # and without the standard field on the pin, against the board's io.standard. It does not affect simulation.
        expected = info.get("standard", board["io"]["standard"])
        if b.io_type is not None and b.io_type.upper() != expected.upper():
            given = b.io_type[:32]  # the value may turn out to be a string of any length
            out.append(
                diag(source, "warning", "CST_IO_TYPE",
                     f"Порт {b.name}: IO_TYPE={given}, а вывод {b.pin} на плате работает со стандартом {expected}",
                     file=res.binding_file, line=b.io_line,
                     port=b.name, pin=b.pin, given=given, expected=expected)
            )  # fmt: skip
        # A board device without a model (spec section 3.2): the binding is allowed, the author gets a notice.
        # A device without a version (since: null) gives no notice: there is nothing to promise. The device label is
        # a text per language: it goes into the argument whole, the interface picks the language (decision 168).
        device = later.get(b.pin)
        if device is not None:
            out.append(
                diag(source, "warning", "DEVICE_NOT_MODELED",
                     f"Вывод {b.pin} ведёт к устройству «{device['label']['ru']}»: его модель появится "
                     f"в версии {device['since']}", **where,
                     port=b.name, pin=b.pin, device=device["label"], since=device["since"])
            )  # fmt: skip
    if res.failed:
        return res

    # --- Job request and cache key ----------------------------------------------------
    # The job sees the design files, included files and data files;
    # testbenches and the binding do not go into the build.
    visible = set(design_files)
    visible |= {p for p in files if ext(p) in HEADER_EXT | DATA_EXT}
    visible |= {p for p in verilog if p not in testbenches}
    res.sources = {p: files[p] for p in sorted(visible)}
    # Everything the job sees is checked, data files included: `include accepts a file with any
    # extension. A macro quote (`") does not open a string, so it is removed before parsing:
    # otherwise the text between two such quotes would count as a string and bypass the check.
    for p, text in res.sources.items():
        code = strip_code(text.replace('`\\`"', "    ").replace('`"', "  "))
        if (found := C_CODE_RE.search(code)) is not None:
            out.append(
                diag("project", "error", "C_CODE_UNSUPPORTED",
                     "Вставки кода C в схему ($c, `systemc_*) не поддерживаются",
                     file=p, line=code.count("\n", 0, found.start()) + 1)
            )  # fmt: skip
    if res.failed:
        return res
    data_files = sorted(p for p in visible if ext(p) in DATA_EXT)
    res.job = {
        "top": top,
        "visibility": visibility,
        "files": design_files,
        "includeDirs": design.get("includeDirs", ["."]),
        "parameters": design.get("parameters", {}),
        "defines": design.get("defines", {}),
        "dataFiles": data_files,
    }
    key = {
        "toolchain": toolchain,
        "runtime": runtime,
        **res.job,
        "sources": [[p, hashlib.sha256(text.encode("utf-8")).hexdigest()] for p, text in res.sources.items()],
    }
    res.build_id = hashlib.sha256(_canonical(key)).hexdigest()
    return res


def order_ports(ports: list[dict[str, Any]], top_text: str) -> list[dict[str, Any]]:
    """Ports in source text order: in Vtop.h the order differs (decision 8)."""

    first: dict[str, int] = {}
    for w in WORD_RE.finditer(top_text):
        first.setdefault(w.group(0), w.start())
    return sorted(ports, key=lambda p: first.get(p["name"], len(top_text)))


def bind(res: Resolution, job_ports: list[dict[str, Any]]) -> list[Diagnostic]:
    """Matching the binding against the top module ports. Completes res.resolved: ports, pins, clock, unbound."""
    out: list[Diagnostic] = []
    assert res.board is not None
    source = "cst" if res.binding_prefix == "CST" else "project"
    ports = order_ports(job_ports, res.top_text)
    by_name = {p["name"]: p for p in ports}
    res.resolved["ports"] = [
        {"name": p["name"], "dir": p["dir"].lower(), "width": p["width"], "msb": p["msb"], "lsb": p["lsb"]}
        for p in ports
    ]

    def no_port(b: Binding, original: str) -> None:
        out.append(
            diag(source, "error", f"{res.binding_prefix}_NO_PORT", original, file=res.binding_file, line=b.line,
                 port=b.name, top=res.resolved["top"])
        )  # fmt: skip

    bound: dict[tuple[str, int], Binding] = {}
    for b in res.bindings:
        port = by_name.get(b.name)
        index: int | None = None
        if port is None and (m := BIT_RE.match(b.name)):
            port, index = by_name.get(m.group(1)), int(m.group(2))
        if port is None:
            no_port(b, f"Порта {b.name} нет у верхнего модуля {res.resolved['top']}")
            continue
        low, high = sorted((port["msb"], port["lsb"]))
        if index is None:
            if port["width"] > 1:
                no_port(b, f"Порт {port['name']} многоразрядный: привязывается по битам, {port['name']}[{port['lsb']}]")
                continue
            index = port["lsb"]
        if not low <= index <= high:
            no_port(b, f"У порта {port['name']} нет разряда {index}: границы [{port['msb']}:{port['lsb']}]")
            continue
        if b.pin is not None:
            bound[(port["name"], abs(index - port["lsb"]))] = b

    pins = [{"port": name, "bit": bit, "pin": b.pin, "pull": b.pull} for (name, bit), b in bound.items()]
    order = {p["name"]: i for i, p in enumerate(ports)}
    pins.sort(key=lambda p: (order[p["port"]], p["bit"]))
    res.resolved["pins"] = pins

    unbound: list[dict[str, Any]] = []
    for p in ports:
        free = [bit for bit in range(p["width"]) if (p["name"], bit) not in bound]
        unbound += [{"port": p["name"], "bit": bit} for bit in free]
        if free:
            out.append(
                diag(source, "warning", "PORT_UNBOUND", f"Порт {p['name']} не привязан к выводам платы",
                     file=res.binding_file, port=p["name"], bits=free)
            )  # fmt: skip
    res.resolved["unbound"] = unbound

    # Clock: an input port on a board clock pin. In version 1 there is one clock (spec section 2.5).
    clock: dict[str, Any] | None = None
    clock_pins = {c["pin"]: c for c in res.board.get("clocks", [])}
    for p in pins:
        src = clock_pins.get(p["pin"])
        if src is None or by_name[p["port"]]["dir"] != "In" or by_name[p["port"]]["width"] != 1:
            continue
        if clock is None:
            clock = {"port": p["port"], "pin": p["pin"], "hz": src["hz"]}
        else:
            out.append(
                diag(source, "warning", "CLOCK_EXTRA",
                     f"Порт {p['port']} стоит на тактовом выводе {p['pin']}, но такт в версии 1 один: {clock['port']}",
                     file=res.binding_file, line=bound[(p["port"], p["bit"])].line, port=p["port"], pin=p["pin"])
            )  # fmt: skip
    res.resolved["clock"] = clock
    return out


def resolve_testbench(
    files: dict[str, str], config: dict[str, Any] | None, testbench: str, *, share_dir: Path
) -> Resolution:
    """Request to the job for testbench (spec section 8.3): design files and the chosen testbench.

    The design top module, the binding and the board are not needed by a testbench:
    the Icarus simulation root is the modules
    of the testbench file that nobody in that file uses. The design.parameters parameters
    are not passed: they belong to the design top module, and the testbench creates its instance itself.
    """
    res = Resolution()
    project = _project_files(res, files, config, share_dir)
    if project is None:
        return res
    own = project.modules.get(testbench, [])
    # A module is used if its name stands in the file outside its own text: inside itself
    # a testbench names itself, for example in $dumpvars(0, tb_top).
    used: set[str] = set()
    by_name = {m.name: m for m in own}
    for w in WORD_RE.finditer(project.clean.get(testbench, "")):
        m = by_name.get(w.group(0))
        if m is not None and not m.start <= w.start() < m.end:
            used.add(m.name)
    roots = list(dict.fromkeys(m.name for m in own if m.name not in used))
    # In a file with a design and a testbench (TB_MIXED) the root is the testbench only.
    if any(m.is_testbench for m in own):
        roots = [name for name in roots if next(m for m in own if m.name == name).is_testbench]
    if not roots and own:
        # Module files name each other by hierarchical names (tb_top.clk from a monitor module):
        # the root cannot be found by words. The last testbench of the file is taken as the root.
        roots = [next((m.name for m in reversed(own) if m.is_testbench), own[-1].name)]
    if not roots:
        res.diagnostics.append(
            diag(
                "project",
                "error",
                "TB_NO_MODULE",
                f"В файле {testbench} нет модуля тестбенча",
                file=testbench,
                path=testbench,
            )  # fmt: skip
        )
        return res
    sources = [*project.design_files, *([] if testbench in project.design_files else [testbench])]
    # The job sees the same as the build (Verilog files outside design.files are needed for `include),
    # and the chosen testbench; other testbenches are not visible to it.
    visible = set(sources) | {p for p in files if _ext(p) in HEADER_EXT | DATA_EXT}
    visible |= {p for p in project.verilog if p not in project.testbenches}
    res.sources = {p: files[p] for p in sorted(visible)}
    res.job = {
        "files": sources,
        "roots": roots,
        "includeDirs": project.design.get("includeDirs", ["."]),
        "defines": project.design.get("defines", {}),
    }
    return res
