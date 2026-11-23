"""Tests of the server parts that need no Docker: parsing, keys, cache, the shim template."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
from pathlib import Path

import pytest
from fpgasim_server import admin
from fpgasim_server.cache import BuildCache, copy_untrusted, read_untrusted
from fpgasim_server.config import Limits, Settings, load_settings
from fpgasim_server.cst import parse_cst
from fpgasim_server.diagnostics import load_gowin_primitives, parse_verilator
from fpgasim_server.jobs import FairSlots
from fpgasim_server.keys import KeyStore, read_keys
from fpgasim_server.resolve import bind, find_modules, order_ports, resolve, strip_code

REPO = Path(__file__).resolve().parents[2]
DATA = Path(__file__).resolve().parent / "data"
sys.path.insert(0, str(REPO / "server" / "job"))


def run_resolve(files: dict[str, str], config: dict | None = None, visibility: str | None = None, **kw: str):  # noqa: ANN201
    return resolve(files, config, visibility, share_dir=REPO, toolchain=kw.get("toolchain", "t"), runtime="0.1.0")


TOP = "module top (input wire clk, input wire btn, output wire [1:0] led);\n  assign led = {btn, clk};\nendmodule\n"
PORTS = [
    {"name": "led", "cname": "led", "dir": "Out", "width": 2, "msb": 1, "lsb": 0, "ctype": "CData"},
    {"name": "btn", "cname": "btn", "dir": "In", "width": 1, "msb": 0, "lsb": 0, "ctype": "CData"},
    {"name": "clk", "cname": "clk", "dir": "In", "width": 1, "msb": 0, "lsb": 0, "ctype": "CData"},
]


# --- Shim template ------------------------------------------------------------------


def test_shim_template_matches_reference() -> None:
    """The template server/templates/shim.cpp.j2 gives the reference output stored in tests/data/shim_sample.cpp.txt."""
    import shimgen

    ports = shimgen.parse_ports((DATA / "Vtop_sample.h.txt").read_text(encoding="utf-8"))
    assert [p.name for p in ports][:3] == ["clk", "in8", "io1"]
    assert next(p for p in ports if p.cname == "bus__02Da").name == "bus-a"
    text = shimgen.render_shim(ports, "top")
    assert text == (DATA / "shim_sample.cpp.txt").read_text(encoding="utf-8")
    assert 'kTop = "top"' in text and "Shim() { init(); }" in text


def test_shim_rejects_bad_top() -> None:
    import shimgen

    with pytest.raises(ValueError):
        shimgen.render_shim([], 'top"; int x = 1; //')


# --- Modules and the top module ----------------------------------------------------


def test_find_modules_ports_and_comments() -> None:
    text = strip_code(
        "// module fake(input a);\n"
        'module a #(parameter N = 1) (input wire x); initial $display("module str(x)"); endmodule\n'
        "/* module hidden (input q); */\n"
        "module b; endmodule\nmodule c (); endmodule\nmodule tb_d (input x); endmodule\n"
    )
    mods = {m.name: m for m in find_modules(text, "f.v")}
    assert list(mods) == ["a", "b", "c", "tb_d"]
    assert mods["a"].has_ports and not mods["b"].has_ports and not mods["c"].has_ports
    assert [m.is_testbench for m in mods.values()] == [False, True, True, True]


def test_top_is_unused_module() -> None:
    files = {
        "top.v": "module top (input a, output b);\n  inner u (.a(a), .b(b));\nendmodule : top\n",
        "inner.v": "module inner (input a, output b); assign b = a; endmodule\n",
        "tb_top.v": "module tb_top; top dut (); endmodule\n",
        "notes.txt": "module ghost (input a);",
    }
    res = run_resolve(files)
    assert not res.failed
    assert res.resolved["top"] == "top"
    assert res.resolved["files"] == ["inner.v", "top.v"]
    assert res.resolved["testbenches"] == ["tb_top.v"]
    assert "tb_top.v" not in res.sources and "notes.txt" not in res.sources


def test_explicit_top_and_missing_top() -> None:
    files = {"a.v": "module a (input x); endmodule\n", "b.v": "module b (input x); endmodule\n"}
    assert [d["code"] for d in run_resolve(files).diagnostics] == ["TOP_AMBIGUOUS"]
    assert run_resolve(files).diagnostics[0]["args"]["candidates"] == ["a", "b"]
    assert run_resolve(files, {"format": 1, "design": {"top": "b"}}).resolved["top"] == "b"
    missing = run_resolve(files, {"format": 1, "design": {"top": "zzz"}})
    assert [d["code"] for d in missing.diagnostics] == ["TOP_NOT_FOUND"]
    assert [d["code"] for d in run_resolve({"readme.md": "x"}).diagnostics] == ["TOP_NOT_FOUND"]


# --- Cache key -----------------------------------------------------------------------


def test_build_id_ignores_binding_and_testbenches() -> None:
    base = run_resolve({"top.v": TOP, "top.cst": 'IO_LOC "clk" 4;\n'})
    assert base.build_id and len(base.build_id) == 64
    other_cst = run_resolve({"top.v": TOP, "top.cst": 'IO_LOC "clk" 4;\nIO_LOC "btn" 88;\n'})
    with_tb = run_resolve({"top.v": TOP, "top.cst": 'IO_LOC "clk" 4;\n', "tb_top.v": "module tb_top; endmodule\n"})
    with_pins = run_resolve({"top.v": TOP}, {"format": 1, "pins": {"clk": {"pin": 4}}, "watch": []})
    assert base.build_id == other_cst.build_id == with_tb.build_id == with_pins.build_id


def test_build_id_depends_on_design() -> None:
    base = run_resolve({"top.v": TOP})
    changed = [
        run_resolve({"top.v": TOP + "// правка\n"}),
        run_resolve({"top.v": TOP}, visibility="all"),
        run_resolve({"top.v": TOP}, {"format": 1, "design": {"parameters": {"N": 2}}}),
        run_resolve({"top.v": TOP}, {"format": 1, "design": {"defines": {"FAST": True}}}),
        run_resolve({"top.v": TOP, "inc.vh": "`define X 1\n"}),
        run_resolve({"top.v": TOP, "rom.hex": "00\n"}),
        run_resolve({"top.v": TOP}, toolchain="other"),
    ]
    ids = {r.build_id for r in changed}
    assert None not in ids and base.build_id not in ids and len(ids) == len(changed)


# --- Binding -------------------------------------------------------------------------


def test_cst_parse() -> None:
    text = (
        "// комментарий\n"
        'IO_LOC "clk" 4;  # такт\n'
        'io_port "clk" IO_TYPE=LVCMOS33 pull_mode=up DRIVE=8;\n'
        "IO_LOC btn 88;\n"
        'IO_LOC "d" 33,34;\n'
        'IO_PORT "d" PULL_MODE=KEEPER;\n'
        "CLOCK_LOC clk BUFG;\n"
        'IO_LOC "broken";\n'
        'IO_LOC "clk" 5;\n'
        'IO_LOC "tail" 7\n'
    )
    entries, diagnostics = parse_cst(text, "top.cst")
    by_name = {e.name: e for e in entries}
    assert (by_name["clk"].pin, by_name["clk"].pull, by_name["clk"].line) == ("4", "up", 2)
    assert by_name["clk"].attrs == {"IO_TYPE": "LVCMOS33", "DRIVE": "8"}
    assert (by_name["btn"].pin, by_name["btn"].pull) == ("88", "none")
    assert (by_name["d"].pin, by_name["d"].pull) == ("33", "none")
    assert [(d["code"], d["severity"], d["line"]) for d in diagnostics] == [
        ("CST_DIFF_PAIR", "warning", 5),
        ("CST_KEEPER", "warning", 6),
        ("CST_UNKNOWN", "warning", 7),
        ("CST_SYNTAX", "error", 8),
        ("CST_PORT_TWICE", "error", 9),
        ("CST_SYNTAX", "error", 10),
    ]


def test_bind_ports_clock_and_unbound() -> None:
    cst = 'IO_LOC "clk" 4;\nIO_LOC "led[1]" 16;\nIO_LOC "btn" 88;\nIO_PORT "btn" PULL_MODE=DOWN;\n'
    res = run_resolve({"top.v": TOP, "top.cst": cst})
    diagnostics = bind(res, PORTS)
    assert [p["name"] for p in res.resolved["ports"]] == ["clk", "btn", "led"]  # source text order
    assert res.resolved["ports"][2] == {"name": "led", "dir": "out", "width": 2, "msb": 1, "lsb": 0}
    assert res.resolved["clock"] == {"port": "clk", "pin": 4, "hz": 27000000}
    assert res.resolved["pins"] == [
        {"port": "clk", "bit": 0, "pin": 4, "pull": "none"},
        {"port": "btn", "bit": 0, "pin": 88, "pull": "down"},
        {"port": "led", "bit": 1, "pin": 16, "pull": "none"},
    ]
    assert res.resolved["unbound"] == [{"port": "led", "bit": 0}]
    assert [(d["code"], d["args"]["port"], d["args"]["bits"]) for d in diagnostics] == [("PORT_UNBOUND", "led", [0])]


def test_bind_errors() -> None:
    cst = 'IO_LOC "led" 15;\nIO_LOC "led[2]" 16;\nIO_LOC "nosuch" 17;\nIO_LOC "btn[0]" 88;\n'
    res = run_resolve({"top.v": TOP, "top.cst": cst})
    diagnostics = [d for d in bind(res, PORTS) if d["severity"] == "error"]
    assert [(d["code"], d["line"]) for d in diagnostics] == [("CST_NO_PORT", 1), ("CST_NO_PORT", 2), ("CST_NO_PORT", 3)]
    assert {"port": "btn", "bit": 0, "pin": 88, "pull": "none"} in res.resolved["pins"]


def test_bind_descending_range_uses_offset_from_lsb() -> None:
    ports = [{"name": "d", "cname": "d", "dir": "Out", "width": 4, "msb": 4, "lsb": 7, "ctype": "CData"}]
    res = run_resolve(
        {"top.v": "module top (output wire [4:7] d); endmodule\n", "top.cst": 'IO_LOC "d[7]" 15;\nIO_LOC "d[4]" 16;\n'}
    )
    bind(res, ports)
    assert [(p["bit"], p["pin"]) for p in res.resolved["pins"]] == [(0, 15), (3, 16)]


def test_clock_extra_on_board_with_two_clocks(tmp_path: Path) -> None:
    """Tang Nano 20K has one clock pin, so the second clock is checked on an invented board."""
    board = json.loads((REPO / "boards" / "tang-nano-20k.json").read_text(encoding="utf-8"))
    board["id"] = "two-clocks"
    board["clocks"].append({"id": "osc2", "pin": 10, "hz": 12000000, "label": "12 МГц"})
    (tmp_path / "boards").mkdir()
    (tmp_path / "boards" / "two-clocks.json").write_text(json.dumps(board), encoding="utf-8")
    os.symlink(REPO / "spec", tmp_path / "spec")
    res = resolve(
        {"top.v": TOP, "top.cst": 'IO_LOC "clk" 4;\nIO_LOC "btn" 10;\n'},
        {"format": 1, "board": "two-clocks"}, None, share_dir=tmp_path, toolchain="t", runtime="r",
    )  # fmt: skip
    diagnostics = bind(res, PORTS)
    assert res.resolved["clock"]["port"] == "clk"
    assert [(d["code"], d["args"]["port"]) for d in diagnostics if d["code"] == "CLOCK_EXTRA"] == [
        ("CLOCK_EXTRA", "btn")
    ]


def test_board_from_config_tang_nano_9k() -> None:
    """A board from the board field: on 9K the clock is on pin 52, and pin 4 is a button; the board has no pin 88."""
    cst = 'IO_LOC "clk" 52;\nIO_LOC "btn" 4;\nIO_PORT "btn" IO_TYPE=LVCMOS18 PULL_MODE=UP;\nIO_LOC "led[0]" 10;\n'
    res = run_resolve({"top.v": TOP, "top.cst": cst}, {"format": 1, "board": "tang-nano-9k"})
    diagnostics = bind(res, PORTS)
    assert res.resolved["board"] == "tang-nano-9k"
    assert res.resolved["clock"]["port"] == "clk"
    assert {(p["port"], p["pin"], p["pull"]) for p in res.resolved["pins"]} == {
        ("clk", 52, "none"),
        ("btn", 4, "up"),
        ("led", 10, "none"),
    }
    assert [d["code"] for d in diagnostics if d["severity"] == "error"] == []
    assert "CST_IO_TYPE" not in [d["code"] for d in res.diagnostics]

    # Bank 1.8 V: LVCMOS33 on a button gives a notice; for the clock (pin 52) the board standard is LVCMOS33.
    cst = (
        'IO_LOC "clk" 52;\nIO_PORT "clk" IO_TYPE=LVCMOS18;\n'
        'IO_LOC "btn" 4;\nIO_PORT "btn" IO_TYPE=LVCMOS33;\nIO_PORT "led[1]" IO_TYPE=LVCMOS33;\n'
    )
    res = run_resolve({"top.v": TOP, "top.cst": cst}, {"format": 1, "board": "tang-nano-9k"})
    assert [(d["args"]["port"], d["args"]["given"], d["args"]["expected"], d["line"])
            for d in res.diagnostics if d["code"] == "CST_IO_TYPE"] == [
        ("clk", "LVCMOS18", "LVCMOS33", 2),
        ("btn", "LVCMOS33", "LVCMOS18", 4),
    ]  # fmt: skip

    res = run_resolve({"top.v": TOP, "top.cst": 'IO_LOC "btn" 88;\n'}, {"format": 1, "board": "tang-nano-9k"})
    assert "CST_NO_PIN" in [d["code"] for d in res.diagnostics]


def test_systemverilog_header_with_import_has_ports() -> None:
    text = strip_code("module top import pkg::*; import q::x; #(parameter N = 1) (input wire a); endmodule\n")
    assert [(m.name, m.has_ports) for m in find_modules(text, "top.sv")] == [("top", True)]


@pytest.mark.parametrize(
    ("code", "rejected"),
    [
        ('initial $c("x");', True),
        ("initial $c1(x);", True),
        ("`systemc_header\nint x;\n`verilog", True),
        ("`define T(n) $``n\ninitial `T(c)(1);", True),
        ("`define D $\ninitial x = 1;", True),
        ("initial $clog2(8); initial $countones(a); initial $cast(a, b);", False),
        ('initial $display("$c(1) costs 5$"); // $c("x")', False),
        ("wire abc$c; wire a$; int q[$]; int r[$:3]; assign x = q[$];", False),
        ('initial $readmemh("rom.hex", rom); always @(posedge clk) if (stop) $finish;', False),
    ],
)
def test_c_code_is_rejected(code: str, rejected: bool) -> None:
    res = run_resolve({"top.v": f"module top (input wire clk, output wire x);\n{code}\nendmodule\n"})
    assert [d["code"] for d in res.diagnostics] == (["C_CODE_UNSUPPORTED"] if rejected else [])
    if rejected:
        assert res.diagnostics[0]["file"] == "top.v" and res.diagnostics[0]["line"] >= 2 and res.job is None


def test_c_code_in_included_file_is_rejected() -> None:
    files = {"top.v": TOP, "defs.vh": '`define HIDDEN $c("x")\n'}
    assert [(d["code"], d["file"]) for d in run_resolve(files).diagnostics] == [("C_CODE_UNSUPPORTED", "defs.vh")]


def test_c_code_in_data_file_is_rejected() -> None:
    """A data file can be pulled in with the `include directive: it is checked like a design."""
    files = {"top.v": '`include "rom.hex"\n' + TOP, "rom.hex": 'initial $c("x");\n'}
    assert [(d["code"], d["file"]) for d in run_resolve(files).diagnostics] == [("C_CODE_UNSUPPORTED", "rom.hex")]
    plain = {"top.v": TOP, "rom.hex": "00 // $ в комментарии\nFF\n@10 1f\n", "ram.mem": "0101\n"}
    assert run_resolve(plain).diagnostics == []


def test_c_code_between_macro_quotes_is_rejected() -> None:
    """A macro quote `" does not open a string: text between two such quotes is ordinary code."""
    code = '`define HIDE `" $c("x") `"\nmodule top (input wire a, output wire b); assign b = a; endmodule\n'
    assert [d["code"] for d in run_resolve({"top.v": code}).diagnostics] == ["C_CODE_UNSUPPORTED"]


def test_order_ports_by_source() -> None:
    text = strip_code("(input b, a); input a; output [3:0] ab;")
    names = [p["name"] for p in order_ports([{"name": "ab"}, {"name": "a"}, {"name": "b"}], text)]
    assert names == ["b", "a", "ab"]


# --- Verilator messages ------------------------------------------------------------


VERILATOR_LOG = """\
- V e r i l a t i o n   R e p o r t: Verilator 5.050 2026-07-01 rev v5.050
%Warning-BLKSEQ: src/sub/shift.v:14:15: Blocking assignment '=' in sequential logic process
                                      : ... note: In instance 'top'
   14 |         q = d;
      |           ^
                 ... For warning description see https://verilator.org/warn/BLKSEQ?v=5.050
%Error-MODMISSING: src/top.v:2:3: Cannot find file containing module: 'rPLL'
    2 |   rPLL u_pll(.CLKIN(clk), .CLKOUT(q[0]));
%Error-MODMISSING: src/top.v:3:3: Cannot find file containing module: 'foo'
%Error: src/top.v:4:3: syntax error, unexpected end
%Error: Specified --top-module 'nosuch' was not found in design.
%Error: Exiting due to 4 error(s)
%Error: Cannot continue
"""


def test_parse_verilator() -> None:
    got = parse_verilator(VERILATOR_LOG, load_gowin_primitives(REPO))
    assert [(d["severity"], d["code"], d["file"], d["line"], d["column"]) for d in got] == [
        ("warning", "BLKSEQ", "sub/shift.v", 14, 15),
        ("error", "GOWIN_PRIMITIVE_UNSUPPORTED", "top.v", 2, 3),
        ("error", "MODULE_NOT_FOUND", "top.v", 3, 3),
        ("error", "ERROR", "top.v", 4, 3),
        ("error", "ERROR", None, None, None),
    ]
    assert got[0]["original"] == "Blocking assignment '=' in sequential logic process"
    assert got[0]["source"] == "verilator" and got[0]["args"] == {}
    assert got[1]["args"] == {"module": "rPLL"} and got[2]["args"] == {"module": "foo"}
    assert got[4]["original"] == "Specified --top-module 'nosuch' was not found in design."


# --- Keys ------------------------------------------------------------------------------


def test_admin_and_key_store(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    keys_file = tmp_path / "etc" / "keys.toml"
    args = ["--keys", str(keys_file)]
    assert admin.main([*args, "key", "add", "taras"]) == 0
    key = capsys.readouterr().out.strip()
    assert len(key) == 43  # 32 bytes in base64url without padding
    assert key not in keys_file.read_text(encoding="utf-8")  # the key itself is not stored on the server
    assert (keys_file.stat().st_mode & 0o777) == 0o600
    store = KeyStore(keys_file)
    assert store.owner(key) == "taras" and store.owner(key + "x") is None and store.owner("") is None

    assert admin.main([*args, "key", "add", "taras"]) == 1  # a second key with the same name is not issued
    assert admin.main([*args, "key", "add", "плохое имя"]) == 1
    assert admin.main([*args, "key", "add", "student_1"]) == 0
    capsys.readouterr()
    assert admin.main([*args, "key", "list"]) == 0
    assert capsys.readouterr().out.splitlines() == ["student_1\tвключён", "taras\tвключён"]

    time.sleep(0.01)
    assert admin.main([*args, "key", "disable", "taras"]) == 0
    assert store.owner(key) is None  # the store rereads the file without a service restart
    assert read_keys(keys_file)["taras"].enabled is False
    assert admin.main([*args, "key", "disable", "nobody"]) == 1


# --- Cache -----------------------------------------------------------------------------


def test_cache_put_get_evict(tmp_path: Path) -> None:
    artifacts = tmp_path / "out"
    artifacts.mkdir()
    (artifacts / "sim.wasm").write_bytes(b"w" * 1000)
    (artifacts / "sim.mjs").write_bytes(b"j" * 100)
    cache = BuildCache(tmp_path / "cache", max_bytes=2500)
    ids = [f"{i:064x}" for i in range(3)]
    assert cache.get(ids[0]) is None
    cache.put(ids[0], {"status": "ok"}, artifacts)
    os.utime(cache.root / ids[0] / "meta.json", (1, 1))
    cache.put(ids[1], {"status": "ok"}, artifacts)
    os.utime(cache.root / ids[1] / "meta.json", (2, 2))
    assert cache.get(ids[0]) == {"status": "ok"}  # use refreshes the entry
    cache.put(ids[2], {"status": "failed"}, None)
    assert cache.artifact(ids[2], "sim.wasm") is None
    cache.put(f"{9:064x}", {"status": "ok"}, artifacts)  # the cache is full: the least recently used entry goes
    assert cache.get(ids[1]) is None
    assert cache.get(ids[0]) is not None
    assert cache.artifact(ids[0], "sim.wasm").read_bytes() == b"w" * 1000
    assert cache.artifact(ids[0], "meta.json") is None
    assert cache.artifact("../" + ids[0], "sim.wasm") is None


# --- Settings ----------------------------------------------------------------------------


def test_settings_versions_and_file(tmp_path: Path) -> None:
    settings = Settings(image="fpgasim-build:vl5.050-em7.0.0-rt0.1.0")
    assert settings.versions == {
        "toolchain": "vl5.050-em7.0.0-rt0.1.0", "verilator": "5.050", "emscripten": "7.0.0", "runtime": "0.1.0",
        "protocol": 1,
    }  # fmt: skip
    config = tmp_path / "config.toml"
    config.write_text('[limits]\nbuild_seconds = 30\n[server]\ncors_origins = ["http://x"]\n', encoding="utf-8")
    loaded = load_settings({"FPGASIM_CONFIG": str(config), "FPGASIM_IMAGE": "fpgasim-build:vl1-em2-rt3"})
    assert loaded.limits == Limits(build_seconds=30) and loaded.cors_origins == ("http://x",)
    # The deployment passes the site address in FPGASIM_CORS_ORIGINS: it wins over the file (decision 173).
    env = {"FPGASIM_CONFIG": str(config), "FPGASIM_IMAGE": "x:y", "FPGASIM_CORS_ORIGINS": "https://a, http://b"}
    assert load_settings(env).cors_origins == ("https://a", "http://b")
    no_file = {"FPGASIM_CONFIG": str(tmp_path / "none.toml"), "FPGASIM_IMAGE": "x:y", "FPGASIM_CORS_ORIGINS": ""}
    assert load_settings(no_file).cors_origins == ("http://localhost:5173",)
    config.write_text("[limits]\nbuild_second = 30\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_settings({"FPGASIM_CONFIG": str(config), "FPGASIM_IMAGE": "x:y"})
    with pytest.raises(ValueError):
        load_settings({"FPGASIM_CONFIG": str(tmp_path / "none.toml")})


# --- Untrusted data: job output and large projects -------------------------------------


def test_job_output_symlinks_are_rejected(tmp_path: Path) -> None:
    """A job could have replaced its file with a link to a foreign one: the service does not follow the link."""
    secret = tmp_path / "keys.toml"
    secret.write_text("секрет", encoding="utf-8")
    out = tmp_path / "out"
    out.mkdir()
    os.symlink(secret, out / "sim.wasm")
    (out / "sim.mjs").write_bytes(b"js")
    cache = BuildCache(tmp_path / "cache", max_bytes=10**9)
    build_id = "a" * 64
    with pytest.raises(OSError):
        cache.put(build_id, {"status": "ok"}, out)
    assert cache.get(build_id) is None and not list((tmp_path / "cache").iterdir())
    with pytest.raises(OSError):
        read_untrusted(out / "sim.wasm", 1000)

    linked_dir = tmp_path / "linked"
    os.symlink(tmp_path, linked_dir)
    with pytest.raises(OSError):
        cache.put(build_id, {"status": "ok"}, linked_dir)

    os.unlink(out / "sim.wasm")
    os.mkfifo(out / "sim.wasm")
    with pytest.raises(OSError):
        copy_untrusted(out / "sim.wasm", tmp_path / "copy", 1000)
    os.unlink(out / "sim.wasm")
    (out / "sim.wasm").write_bytes(b"w" * 2000)
    with pytest.raises(OSError):
        copy_untrusted(out / "sim.wasm", tmp_path / "copy", 1000)
    copy_untrusted(out / "sim.wasm", tmp_path / "copy", 2000)
    assert (tmp_path / "copy").read_bytes() == b"w" * 2000


@pytest.mark.parametrize(
    "text",
    [
        "/*" * 250_000,  # unclosed comments
        "module m;\n" * 50_000,  # declarations without endmodule
        "".join(f"module m{i} (input a); endmodule\n" for i in range(15_000)),  # thousands of candidates
        '"' + "a" * 500_000,  # unclosed string
        "module top (" + ", ".join(f"input p{i}" for i in range(30_000)) + "); endmodule\n",
    ],
    ids=["comments", "no-endmodule", "many-modules", "open-string", "many-ports"],
)
def test_resolve_time_is_linear(text: str) -> None:
    """Parsing a project of the maximum size takes a fraction of a second with any content."""
    assert len(text) <= 512 * 1024
    files = {f"f{i}.v": text for i in range(4)}  # a project of about 2 MB
    started = time.monotonic()
    res = run_resolve(files)
    if res.resolved.get("top"):
        order_ports([{"name": f"p{i}"} for i in range(30_000)], res.top_text)
    assert time.monotonic() - started < 3


def test_cst_time_is_linear_and_diagnostics_are_capped() -> None:
    started = time.monotonic()
    # Thousands of pins separated by commas plus a stray word: a regex with nested repeats would run for minutes.
    _, long_list = parse_cst('IO_LOC "a" ' + ",".join(["1"] * 200_000) + " x;\n", "top.cst")
    assert [d["code"] for d in long_list] == ["CST_SYNTAX"]
    _, attrs = parse_cst('IO_PORT "a" ' + "A=1 " * 100_000 + "x;\n", "top.cst")
    assert [d["code"] for d in attrs] == ["CST_SYNTAX"]
    assert time.monotonic() - started < 2
    entries, diagnostics = parse_cst("FOO bar;\n" * 50_000, "top.cst")
    assert time.monotonic() - started < 2
    assert len(diagnostics) == 101 and diagnostics[-1]["code"] == "CST_TOO_MANY"
    assert diagnostics[99]["line"] == 100
    _, many = parse_cst(";" * 500_000, "top.cst")
    assert many == []


def test_verilator_warnings_are_capped() -> None:
    log = "%Warning-UNUSED: src/top.v:1:1: x\n" * 1000 + "%Error: src/top.v:2:1: syntax error\n"
    got = parse_verilator(log, frozenset())
    assert len(got) == 502
    assert got[-2]["severity"] == "error" and got[-1]["code"] == "DIAGNOSTICS_TRUNCATED"
    assert got[-1]["args"] == {"count": 500}


# --- Message table ----------------------------------------------------------------------


def test_every_server_code_is_in_diagnostics_table() -> None:
    """Every code the server issues is in spec/diagnostics.json: the interface takes the text from there."""
    table = json.loads((REPO / "spec" / "diagnostics.json").read_text(encoding="utf-8"))["codes"]
    source = "".join(p.read_text(encoding="utf-8") for p in (REPO / "server" / "fpgasim_server").glob("*.py"))
    found = set(re.findall(r'"((?:[A-Z]+_)+[A-Z]+)"', source))
    found |= {
        f"{prefix}_{tail}"
        for prefix in ("CST", "PINS")
        for tail in re.findall(r'f"\{res\.binding_prefix\}_([A-Z_]+)"', source)
    }
    # Not message codes: request error codes (spec section 8.3), .cst words and environment variable names.
    other = {"BAD_REQUEST", "PROJECT_TOO_LARGE", "RATE_LIMITED", "NOT_FOUND", "METHOD_NOT_ALLOWED"}
    other |= {"BAD_CREDENTIALS", "LOGIN_LOCKED"}  # login error codes (accounts spec section 3, docs/tz-accounts.md)
    other |= {"ASSISTANT_OFF", "ASSISTANT_LIMIT", "ASSISTANT_FAILED", "ASSISTANT_TOO_LONG"}  # decision 175
    other |= {"IO_LOC", "IO_PORT", "PULL_MODE", "IO_TYPE"}
    codes = {c for c in found if c not in other and not c.startswith("FPGASIM_")}
    assert len(codes) >= 30
    assert sorted(codes - set(table)) == []


# --- Fair job queue (decision 165) ---------------------------------------------------


def test_fair_slots_give_freed_place_to_idle_owner() -> None:
    """An owner with no jobs running gets a slot before one who took both and waits for a third."""

    async def run() -> list[str]:
        slots = FairSlots(2)
        order: list[str] = []
        await slots.acquire("a", 1)
        await slots.acquire("a", 1)  # one owner on an idle server takes both slots
        assert slots.full() and slots.running == {"a": 2}

        async def wait(owner: str) -> None:
            await slots.acquire(owner, 1)
            order.append(owner)

        third = asyncio.create_task(wait("a"))  # queued first
        await asyncio.sleep(0)
        other = asyncio.create_task(wait("b"))
        await asyncio.sleep(0)
        slots.release("a")
        assert slots.running == {"a": 1, "b": 1}  # the slot is handed over at once, on release
        await other
        assert order == ["b"] and not third.done()
        slots.release("b")
        await asyncio.gather(third, other)
        assert slots.running == {"a": 2}
        return order

    assert asyncio.run(run()) == ["b", "a"]


def test_fair_slots_fifo_among_equals_and_timeout() -> None:
    """Among equals, in queue order; one who did not wait leaves the queue and takes no slot."""

    async def run() -> None:
        slots = FairSlots(1)
        await slots.acquire("a", 1)
        with pytest.raises(TimeoutError):
            await slots.acquire("b", 0.01)
        assert slots.running == {"a": 1}
        first = asyncio.create_task(slots.acquire("b", 1))
        await asyncio.sleep(0)
        second = asyncio.create_task(slots.acquire("c", 1))
        await asyncio.sleep(0)
        slots.release("a")
        await first
        assert slots.running == {"b": 1} and not second.done()
        slots.release("b")
        await second
        slots.release("c")
        assert slots.running == {} and not slots.full()

    asyncio.run(run())
