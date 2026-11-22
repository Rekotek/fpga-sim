"""Parser of the Gowin .cst pin binding file (spec section 2.6).

IO_LOC and IO_PORT are supported; keywords are case-insensitive; comments // and # run to the end of
the line. Only the text is parsed here: matching against design ports and board pins is in resolve.py.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .diagnostics import Diagnostic, diag

COMMENT_RE = re.compile(r"//[^\n]*|#[^\n]*")
NAME = r'(?:"(?P<quoted>[^"]*)"|(?P<bare>[^\s";=]+))'
# The pin list is parsed separately, by splitting on commas: a regex with nested repeats
# on a line of "thousands of pins separated by commas plus a stray word" would try splits in quadratic time.
LOC_RE = re.compile(rf"IO_LOC\s+{NAME}\s+(?P<pins>\S.*)$", re.I | re.S)
PIN_RE = re.compile(r"[^\s;,]+")
PORT_RE = re.compile(rf"IO_PORT\s+{NAME}(?P<attrs>(?:\s+\w+\s*=\s*[^\s=]+)*)\s*$", re.I | re.S)
ATTR_RE = re.compile(r"(\w+)\s*=\s*([^\s=]+)")
PULLS = {"UP": "up", "DOWN": "down", "NONE": "none", "KEEPER": "none"}
# A file made only of errors must not produce a megabyte response: past the limit messages are not accumulated.
MAX_DIAGNOSTICS = 100


@dataclass
class CstEntry:
    """Binding of one port bit: the name as in the file (clk, led[0])."""

    name: str
    pin: str | None = None  # pin number as in the file; None if there is only IO_PORT
    pull: str = "none"
    line: int = 0  # line of IO_LOC, or of IO_PORT if there is none
    attrs: dict[str, str] = field(default_factory=dict)  # other IO_PORT keys, not interpreted
    port_line: int | None = None  # line of IO_PORT: the IO_TYPE notice refers to it


def parse_cst(text: str, file: str) -> tuple[list[CstEntry], list[Diagnostic]]:
    diagnostics: list[Diagnostic] = []
    entries: dict[str, CstEntry] = {}
    located: dict[str, int] = {}

    def problem(severity: str, code: str, original: str, line: int, **args: object) -> None:
        if len(diagnostics) < MAX_DIAGNOSTICS:
            diagnostics.append(diag("cst", severity, code, original, file=file, line=line, **args))
        elif len(diagnostics) == MAX_DIAGNOSTICS:
            diagnostics.append(
                diag("cst", "error", "CST_TOO_MANY", "В файле привязки слишком много замечаний, остальные не показаны",
                     file=file, line=line)
            )  # fmt: skip

    clean = COMMENT_RE.sub("", text)
    chunks = clean.split(";")
    newlines = 0  # line breaks before the start of the current chunk: counted along the way, not anew for each
    for i, chunk in enumerate(chunks):
        statement = chunk.strip()
        # Number of the line where the statement starts.
        line = newlines + chunk[: len(chunk) - len(chunk.lstrip())].count("\n") + 1
        newlines += chunk.count("\n")
        terminated = i + 1 < len(chunks)
        if not statement:
            continue
        if not terminated:
            problem("error", "CST_SYNTAX", "Инструкция не закончена точкой с запятой", line)
            continue
        keyword = statement.split(None, 1)[0].upper()
        if keyword == "IO_LOC":
            m = LOC_RE.match(statement)
            if not m:
                problem("error", "CST_SYNTAX", 'Инструкция IO_LOC не разобрана: ожидается IO_LOC "порт" вывод;', line)
                continue
            name = m["quoted"] if m["quoted"] is not None else m["bare"]
            pins = [p.strip() for p in m["pins"].split(",")]
            if len(pins) > 2 or not all(PIN_RE.fullmatch(p) for p in pins):
                problem("error", "CST_SYNTAX", 'Инструкция IO_LOC не разобрана: ожидается IO_LOC "порт" вывод;', line)
                continue
            if len(pins) > 1:
                problem(
                    "warning", "CST_DIFF_PAIR",
                    f"Дифференциальная пара {m['pins']}: взят первый вывод {pins[0]}", line, port=name, pin=pins[0],
                )  # fmt: skip
            if name in located:
                problem(
                    "error", "CST_PORT_TWICE",
                    f"Порт {name} привязан дважды (строки {located[name]} и {line})", line, port=name,
                )  # fmt: skip
                continue
            located[name] = line
            entry = entries.setdefault(name, CstEntry(name))
            entry.pin = pins[0]
            entry.line = line
        elif keyword == "IO_PORT":
            m = PORT_RE.match(statement)
            if not m:
                problem(
                    "error",
                    "CST_SYNTAX",
                    'Инструкция IO_PORT не разобрана: ожидается IO_PORT "порт" ключ=значение …;',
                    line,
                )
                continue
            name = m["quoted"] if m["quoted"] is not None else m["bare"]
            entry = entries.setdefault(name, CstEntry(name, line=line))
            entry.port_line = line
            for key, value in ATTR_RE.findall(m["attrs"]):
                if key.upper() != "PULL_MODE":
                    entry.attrs[key.upper()] = value
                    continue
                mode = value.upper()
                if mode not in PULLS:
                    problem("error", "CST_SYNTAX", f"Неизвестное значение PULL_MODE={value}", line, port=name)
                    continue
                if mode == "KEEPER":
                    problem(
                        "warning", "CST_KEEPER",
                        "PULL_MODE=KEEPER не моделируется и считается как NONE", line, port=name,
                    )  # fmt: skip
                entry.pull = PULLS[mode]
        else:
            problem("warning", "CST_UNKNOWN", f"Инструкция {keyword} пропущена", line, statement=keyword)
    return list(entries.values()), diagnostics
