"""Build messages (spec section 7.6): the common record shape, parsing of Verilator and Icarus Verilog output."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

Diagnostic = dict[str, Any]

# %Warning-CODE: file:line:column: text   |   %Error[-CODE]: file:line[:column]: text
HEAD_RE = re.compile(r"^%(Warning|Error)(?:-([A-Z0-9_]+))?: (.*)$")
LOCATION_RE = re.compile(r"^(?P<file>[^:\s][^:]*):(?P<line>\d+)(?::(?P<column>\d+))?: (?P<text>.*)$")
MODULE_RE = re.compile(r"Cannot find file containing module: '([^']+)'")
# Verilator summary lines: they carry no meaning of their own.
SUMMARY_RE = re.compile(r"^(Exiting due to|Cannot continue|Command Failed)")
SRC_PREFIX = "src/"
# Verilator prints at most 30 errors (--error-limit), any number of warnings.
MAX_DIAGNOSTICS = 500


def diag(
    source: str,
    severity: str,
    code: str,
    original: str,
    *,
    file: str | None = None,
    line: int | None = None,
    column: int | None = None,
    **args: Any,  # noqa: ANN401
) -> Diagnostic:
    """A message record. source: verilator, iverilog, cst, project, toolchain; severity: error, warning."""
    return {
        "source": source,
        "severity": severity,
        "code": code,
        "file": file,
        "line": line,
        "column": column,
        "original": original,
        "args": args,
    }


def has_errors(diagnostics: list[Diagnostic]) -> bool:
    return any(d["severity"] == "error" for d in diagnostics)


def load_gowin_primitives(share_dir: Path) -> frozenset[str]:
    path = share_dir / "spec" / "gowin-primitives.txt"
    names = (line.split("#", 1)[0].strip() for line in path.read_text(encoding="utf-8").splitlines())
    return frozenset(n for n in names if n)


def parse_verilator(log: str, gowin_primitives: frozenset[str]) -> list[Diagnostic]:
    """Parse Verilator output line by line. Continuation lines (indented) are skipped.

    A message without a code location is returned whole with empty file and line (assumption 9).
    """
    out: list[Diagnostic] = []
    skipped = 0
    for raw in log.splitlines():
        m = HEAD_RE.match(raw)
        if not m:
            continue
        # Past the limit only errors are kept: they decide the build result.
        if len(out) >= MAX_DIAGNOSTICS and m.group(1) != "Error":
            skipped += 1
            continue
        kind, code, rest = m.groups()
        if SUMMARY_RE.match(rest):
            continue
        severity = "error" if kind == "Error" else "warning"
        loc = LOCATION_RE.match(rest)
        file: str | None = None
        line: int | None = None
        column: int | None = None
        text = rest
        if loc:
            file = loc["file"].removeprefix(SRC_PREFIX)
            line = int(loc["line"])
            column = int(loc["column"]) if loc["column"] else None
            text = loc["text"]
        args: dict[str, Any] = {}
        if missing := MODULE_RE.search(text):
            name = missing.group(1)
            code = "GOWIN_PRIMITIVE_UNSUPPORTED" if name in gowin_primitives else "MODULE_NOT_FOUND"
            args["module"] = name
        out.append(
            diag(
                "verilator",
                severity,
                code or ("ERROR" if severity == "error" else "WARNING"),
                text,
                file=file,
                line=line,
                column=column,
                **args,
            )
        )
    if skipped:
        out.append(
            diag(
                "verilator",
                "warning",
                "DIAGNOSTICS_TRUNCATED",
                f"Ещё {skipped} предупреждений не показано",
                count=skipped,
            )
        )
    return out


# Icarus Verilog: file:line: [error|warning|sorry: ]text. Its messages have no codes.
IVERILOG_RE = re.compile(
    r"^(?P<file>[^:\s][^:]*):(?P<line>\d+): (?:(?P<kind>error|warning|sorry|assert): ?)?(?P<text>.*)$"
)
IVERILOG_BARE_RE = re.compile(r"^(?P<kind>error|warning): (?P<text>.+)$")


def parse_iverilog(log: str) -> list[Diagnostic]:
    """Parse iverilog output line by line (the testbench operation, spec section 8.3).

    A line with a location and no word warning is an error: that is how Icarus writes "syntax error" and "Include file
    not found". Continuation lines (text starting with a colon) and summary lines are skipped.
    """
    out: list[Diagnostic] = []
    for raw in log.splitlines():
        line = raw.rstrip()
        m = IVERILOG_RE.match(line)
        if m:
            text = m["text"].strip()
            if not text or text.startswith(":"):
                continue
            severity = "warning" if m["kind"] == "warning" else "error"
        elif (m := IVERILOG_BARE_RE.match(line)) is not None:
            text = m["text"].strip()
            severity = m["kind"]
        else:
            continue
        if len(out) >= MAX_DIAGNOSTICS:
            break
        where = m.groupdict()
        out.append(
            diag(
                "iverilog",
                severity,
                "ERROR" if severity == "error" else "WARNING",
                text,
                file=where["file"].removeprefix("./") if where.get("file") else None,
                line=int(where["line"]) if where.get("line") else None,
            )
        )
    return out
