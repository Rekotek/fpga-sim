"""Read a VCD file with a third-party parser (pyvcd) for the end-to-end tests of waveforms and the testbench.

    python read_vcd.py <file.vcd>

Prints JSON: time step, first and last moment, signals with the number of changes after the
$dumpvars block and the values at the start and end of the file. The end-to-end test compares this
with the record in the interface
(spec section 12, stage 8: "the exported VCD is read by a third-party parser").
"""

import json
import sys
from pathlib import Path

from vcd.reader import TokenKind, tokenize


def read(path: Path) -> dict[str, object]:
    scopes: list[str] = []
    names: dict[str, list[str]] = {}
    widths: dict[str, int] = {}
    initial: dict[str, int] = {}
    last: dict[str, int] = {}
    changes: dict[str, int] = {}
    times: list[int] = []
    timescale = ""
    dumping = False

    def change(code: str, value: int | str) -> None:
        # X and Z bits (an Icarus file) read as 0: the simulator has two states (decision 84).
        number = value if isinstance(value, int) else int(value.lower().replace("x", "0").replace("z", "0"), 2)
        if dumping:
            initial[code] = number
        else:
            changes[code] = changes.get(code, 0) + 1
        last[code] = number

    with path.open("rb") as stream:
        for token in tokenize(stream):
            if token.kind is TokenKind.TIMESCALE:
                scale = token.timescale
                timescale = f"{getattr(scale.magnitude, 'value', scale.magnitude)}{scale.unit.value}"
            elif token.kind is TokenKind.SCOPE:
                scopes.append(token.scope.ident)
            elif token.kind is TokenKind.UPSCOPE:
                scopes.pop()
            elif token.kind is TokenKind.VAR:
                names.setdefault(token.var.id_code, []).append(".".join([*scopes, token.var.reference]))
                widths[token.var.id_code] = token.var.size
            elif token.kind is TokenKind.DUMPVARS:
                dumping = True
            elif token.kind is TokenKind.END:
                dumping = False
            elif token.kind is TokenKind.CHANGE_TIME:
                times.append(token.time_change)
            elif token.kind is TokenKind.CHANGE_SCALAR:
                change(token.scalar_change.id_code, token.scalar_change.value)
            elif token.kind is TokenKind.CHANGE_VECTOR:
                change(token.vector_change.id_code, token.vector_change.value)

    signals = [
        {
            "name": name,
            "width": widths[code],
            "changes": changes.get(code, 0),
            "initial": str(initial.get(code, 0)),
            "last": str(last.get(code, 0)),
        }
        for code, found in names.items()
        for name in found
    ]
    return {
        "timescale": timescale,
        "fromPs": str(times[0]) if times else "0",
        "toPs": str(times[-1]) if times else "0",
        "changes": sum(changes.values()),
        "signals": signals,
    }


if __name__ == "__main__":
    print(json.dumps(read(Path(sys.argv[1]))))
