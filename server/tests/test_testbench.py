"""The testbench operation on real jobs in the build image."""

from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any

import pytest
from conftest import REPO, Env, load_project, one
from fpgasim_server.cache import TestbenchStore
from fpgasim_server.diagnostics import parse_iverilog
from fpgasim_server.jobs import docker_command
from fpgasim_server.resolve import resolve_testbench

sys.path.insert(0, str(REPO / "tools" / "wave"))
from read_vcd import read as read_vcd  # noqa: E402


def run(env: Env, project: str, testbench: str = "tb_top.v", **changes: Any) -> dict[str, Any]:  # noqa: ANN401
    request = load_project(project)
    return env.post(
        "testbench", {"files": request["files"], "config": request["config"], "testbench": testbench, **changes}
    )


def errors(body: dict[str, Any]) -> list[dict[str, Any]]:
    return [d for d in body["diagnostics"] if d["severity"] == "error"]


# --- Acceptance criteria ----------------------------------------------------------------


@pytest.mark.parametrize(("example", "text"), [("blink3", "PASS: 8 checks\n"), ("shift_chain", "PASS: 6 checks\n")])
def test_example_testbench_passes_and_dumps_waves(env: Env, example: str, text: str, tmp_path: Path) -> None:
    body = run(env, example)
    assert body["status"] == "ok" and body["exitCode"] == 0, body
    assert text in body["stdout"] and body["truncated"] is False
    assert errors(body) == [] and body["durationMs"] < 15_000
    assert body["vcd"].startswith("/v1/artifacts/tb-") and body["vcd"].endswith("/dump.vcd")

    response = env.client.get(body["vcd"], headers=env.auth)
    assert response.status_code == 200 and response.headers["content-type"].startswith("text/plain")
    assert env.client.get(body["vcd"]).status_code == 401
    # A third-party parser reads the Icarus file; the waveform has at least three signals.
    dump = tmp_path / "dump.vcd"
    dump.write_bytes(response.content)
    waves = read_vcd(dump)
    names = {s["name"] for s in waves["signals"]}  # type: ignore[union-attr]
    assert len(names) >= 3 and "tb_top.clk" in names
    assert waves["timescale"] == "1ps" and waves["changes"] > 10  # type: ignore[operator]


@pytest.mark.parametrize("example", ["blink3", "shift_chain"])
def test_testbench_file_is_not_built(env: Env, example: str) -> None:
    """The testbench file does not get into the simulator build."""
    body = env.check(example)
    assert body["status"] == "ok"
    assert body["resolved"]["files"] == ["top.v"] and body["resolved"]["testbenches"] == ["tb_top.v"]


def test_endless_testbench_times_out(env: Env) -> None:
    started = time.monotonic()
    body = run(env, "tb_loop")
    elapsed = time.monotonic() - started
    assert body["status"] == "timeout" and body["exitCode"] is None and body["vcd"] is None
    assert 19 < elapsed < 25, elapsed
    assert one(body, "TB_TIMEOUT")["args"] == {"seconds": 20}
    assert body["stdout"] == "started\n"  # the output before the stop is kept
    assert not any((env.settings.data_dir / "jobs").iterdir())


def test_compile_error_has_file_and_line(env: Env) -> None:
    body = run(env, "tb_syntax")
    assert body["status"] == "failed" and body["exitCode"] is None and body["stdout"] == "" and body["vcd"] is None
    found = errors(body)
    assert found and all(d["source"] == "iverilog" and d["code"] == "ERROR" for d in found)
    # Icarus notices the missing semicolon on the next line.
    assert (found[0]["file"], found[0]["line"]) == ("tb_top.v", 7)
    assert "syntax error" in found[0]["original"]


def test_long_output_is_truncated(env: Env) -> None:
    body = run(env, "tb_output")
    assert body["status"] == "ok" and body["exitCode"] == 0
    assert body["truncated"] is True and len(body["stdout"].encode()) == 256 * 1024
    assert body["stdout"].startswith("0000 4567")
    short = run(env, "with_testbench")
    assert short["status"] == "ok" and short["truncated"] is False


# --- Other behavior -----------------------------------------------------------------------


def test_testbench_without_dump_has_no_vcd(env: Env) -> None:
    body = run(env, "with_testbench")
    assert (body["status"], body["exitCode"], body["vcd"], body["diagnostics"]) == ("ok", 0, None, [])


def test_data_files_includes_and_dump_name(env: Env, tmp_path: Path) -> None:
    body = run(env, "tb_misc", "tb_data.v")
    assert body["status"] == "ok" and "rom a5 3c answer 42\n" in body["stdout"], body
    dump = tmp_path / "dump.vcd"
    dump.write_bytes(env.client.get(body["vcd"], headers=env.auth).content)
    assert {s["name"] for s in read_vcd(dump)["signals"]} >= {"tb_data.value"}  # type: ignore[union-attr]


def test_exit_code_of_failed_test(env: Env) -> None:
    body = run(env, "tb_misc", "tb_fatal.v")
    assert body["status"] == "ok" and body["exitCode"] not in (0, None)
    assert "before fatal" in body["stdout"] and "check failed" in body["stdout"]


def test_dump_outside_run_folder_is_ignored(env: Env) -> None:
    body = run(env, "tb_misc", "tb_escape.v")
    assert body["status"] == "ok" and body["vcd"] is None


def test_root_is_the_unused_module_of_the_file(env: Env) -> None:
    body = run(env, "tb_misc", "helpers.v")
    assert body["status"] == "ok" and "pair done\n" in body["stdout"], body


def test_testbench_cannot_replace_the_job_result(env: Env) -> None:
    """The job folder is writable by the testbench: it cannot replace the result and the waveform file."""
    hostile = (
        "module tb_top;\n  integer f;\n  reg x = 0;\n  initial begin\n"
        '    f = $fopen("../result.json", "w");\n'
        '    $fwrite(f, "{\\"status\\": \\"ok\\", \\"stdout\\": \\"forged\\", \\"exitCode\\": 0}");\n    $fclose(f);\n'
        '    f = $fopen("../result.json.tmp", "w");\n    $fclose(f);\n'
        '    f = $fopen("../out", "w");\n    $fwrite(f, "not a folder");\n    $fclose(f);\n'
        f'    // $dumpfile("{"n" * 300}.vcd");\n'
        '    $dumpfile("../run/real.vcd");\n    $dumpvars(0, tb_top);\n'
        '    #1 x = 1;\n    #1 $display("honest output");\n    $finish;\n  end\nendmodule\n'
    )
    body = env.post(
        "testbench", {"files": [{"path": "tb_top.v", "content": hostile}], "config": None, "testbench": "tb_top.v"}
    )
    assert body["status"] == "ok" and body["exitCode"] == 0, body
    assert "honest output\n" in body["stdout"] and "forged" not in body["stdout"]
    assert errors(body) == []
    dump = env.client.get(body["vcd"], headers=env.auth)
    assert dump.status_code == 200 and b"$enddefinitions" in dump.content


def test_testbench_rate_limit_is_separate(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(builds_per_minute=2)
    request = load_project("with_testbench")
    body = {"files": request["files"], "config": None, "testbench": "missing.v"}
    post = lambda: env.client.post("/v1/testbench", json=body, headers=env.auth).status_code  # noqa: E731
    assert [post(), post(), post()] == [400, 400, 429]
    # The build count is separate: testbench runs do not spend it.
    assert env.client.post("/v1/build", json={"files": [], "config": None}, headers=env.auth).status_code == 200
    assert not any((env.settings.data_dir / "jobs").iterdir())


def test_root_fallback_and_include_of_design_file() -> None:
    # Modules name each other by hierarchical names: the root is the last testbench of the file.
    files = {
        "top.v": "module top(input clk, output q); assign q = clk; endmodule\n",
        "tb.v": "module tb_mon; initial #1 $display(tb_top.clk); endmodule\n"
        "module tb_top; reg clk = 0; initial $display(tb_mon.x); endmodule\n",
        "defs.v": "`define W 4\n",
    }
    res = resolve_testbench(files, {"format": 1, "design": {"files": ["top.v"], "top": "top"}}, "tb.v", share_dir=REPO)
    assert res.diagnostics == [] and res.job is not None and res.job["roots"] == ["tb_top"]
    # A Verilog file outside design.files is visible to the job, like to the build: it is pulled in with `include.
    assert sorted(res.sources) == ["defs.v", "tb.v", "top.v"] and res.job["files"] == ["top.v", "tb.v"]


def test_testbench_requests(env: Env) -> None:
    request = load_project("with_testbench")
    base = {"files": request["files"], "config": None}

    def post(body: dict[str, Any], **kwargs: Any) -> tuple[int, str]:  # noqa: ANN401
        r = env.client.post("/v1/testbench", json=body, **{"headers": env.auth, **kwargs})
        return r.status_code, r.json().get("error", {}).get("code", "")

    assert post({**base, "testbench": "tb_top.v"}, headers={}) == (401, "UNAUTHORIZED")
    assert post(base) == (400, "BAD_REQUEST")
    assert post({**base, "testbench": "missing.v"}) == (400, "BAD_REQUEST")
    assert post({**base, "testbench": "top.cst"}) == (400, "BAD_REQUEST")
    before = len(env.log)
    assert post({**base, "testbench": "tb_top.v"}) == (200, "")
    assert [(r["op"], r["result"], r["owner"]) for r in env.log[before:]] == [("testbench", "ok", "tester")]
    # A project settings error is a response with a message, the job does not start.
    bad = env.post("testbench", {**base, "config": {"format": 1, "board": "nope"}, "testbench": "tb_top.v"})
    assert bad["status"] == "failed" and [d["code"] for d in bad["diagnostics"]] == ["BOARD_UNKNOWN"]
    # A file without modules cannot be a testbench.
    empty = env.post(
        "testbench", {"files": [{"path": "tb.v", "content": "// пусто\n"}], "config": None, "testbench": "tb.v"}
    )
    assert empty["status"] == "failed" and one(empty, "TB_NO_MODULE")["file"] == "tb.v"


def test_testbench_out_of_memory(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(tb_memory_mb=16)
    grow = (
        "module tb_top;\n  reg [7:0] big [0:67108863];\n  integer i;\n"
        "  initial begin for (i = 0; i < 67108864; i = i + 1) big[i] = i; $finish; end\nendmodule\n"
    )
    body = env.post(
        "testbench", {"files": [{"path": "tb_top.v", "content": grow}], "config": None, "testbench": "tb_top.v"}
    )
    assert body["status"] == "failed" and [d["code"] for d in errors(body)] == ["TB_OOM"], body


def test_testbench_disk_limit(make_env: Any) -> None:  # noqa: ANN401
    """The testbench writes more than the limit into the job folder: code TB_DISK_LIMIT, the job folder is removed."""
    limit = 1024 * 1024
    env = make_env(job_disk_bytes=limit)
    # An ordinary testbench fits the same limit: the refusal below is caused by the write, not by the job itself.
    assert run(env, "with_testbench")["status"] == "ok"
    line = "x" * 63
    fill = (
        "module tb_top;\n  integer f, i;\n  initial begin\n"
        '    f = $fopen("fill.txt", "w");\n'
        f'    for (i = 0; i < 32768; i = i + 1) $fwrite(f, "{line}\\n");\n'
        '    $fclose(f);\n    $display("written");\n    $finish;\n  end\nendmodule\n'
    )
    body = env.post(
        "testbench", {"files": [{"path": "tb_top.v", "content": fill}], "config": None, "testbench": "tb_top.v"}
    )
    assert body["status"] == "failed" and body["vcd"] is None, body
    assert [d["code"] for d in errors(body)] == ["TB_DISK_LIMIT"], body
    assert one(body, "TB_DISK_LIMIT")["args"] == {"limit": limit}
    assert not any((env.settings.data_dir / "jobs").iterdir())


def test_testbench_limits_and_command(env: Env) -> None:
    limits = env.client.get("/v1/info", headers=env.auth).json()["limits"]
    assert (limits["tb_seconds"], limits["tb_memory_mb"], limits["tb_cpus"]) == (20, 512, 1)
    assert (limits["tb_output_bytes"], limits["tb_vcd_bytes"]) == (256 * 1024, 20 * 1024 * 1024)
    cmd = docker_command(env.settings, "name", env.settings.data_dir / "jobs" / "x", "testbench")
    text = " ".join(cmd)
    for flag in ("--network none", "--cpus 1", "--memory 512m", "--memory-swap 512m", "--read-only", "--cap-drop ALL"):
        assert flag in text, flag
    assert cmd[-1] == "testbench"


def test_large_dump_is_not_stored(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(tb_vcd_bytes=2000)
    body = run(env, "blink3")
    assert body["status"] == "ok" and "PASS: 8 checks\n" in body["stdout"] and body["vcd"] is None
    assert one(body, "TB_VCD_TOO_LARGE")["severity"] == "warning"


# --- Without jobs -----------------------------------------------------------------------


def test_store_keeps_dumps_for_an_hour(tmp_path: Path) -> None:
    source = tmp_path / "out" / "dump.vcd"
    source.parent.mkdir()
    source.write_text("$enddefinitions $end\n" + "#1\n" * 100, encoding="ascii")
    store = TestbenchStore(tmp_path / "store", keep_seconds=3600, max_bytes=700, max_file_bytes=500)
    first = store.put(source)
    path = store.get(first, "dump.vcd")
    assert path is not None and path.read_text(encoding="ascii").endswith("#1\n")
    assert store.get(first, "other.vcd") is None and store.get("tb-../x", "dump.vcd") is None
    assert store.get("0" * 64, "dump.vcd") is None
    # Older than an hour: the file is not served and is deleted at the next write.
    old = time.time() - 3601
    os.utime(path, (old, old))
    assert store.get(first, "dump.vcd") is None
    second = store.put(source)
    assert not (tmp_path / "store" / first).exists() and store.get(second, "dump.vcd") is not None
    # Total size: when exceeded, the oldest are deleted; the last entry stays.
    ids = [second]
    for age in (30, 20, 10):
        # The write time is set explicitly: files written in a row may have the same time.
        for done, seconds in zip(ids, range(age + 10 * len(ids), age, -10), strict=True):
            stamp = time.time() - seconds
            if (kept_file := tmp_path / "store" / done / "dump.vcd").exists():
                os.utime(kept_file, (stamp, stamp))
        ids.append(store.put(source))
    kept = [i for i in ids if store.get(i, "dump.vcd") is not None]
    assert kept == ids[-2:]
    # A file over the limit and a link instead of a file are rejected.
    source.write_text("x" * 501, encoding="ascii")
    with pytest.raises(OSError, match="больше предела"):
        store.put(source)
    source.unlink()
    source.symlink_to("/etc/passwd")
    with pytest.raises(OSError):
        store.put(source)
    assert not list((tmp_path / "store").glob("tmp-*"))


def test_parse_iverilog() -> None:
    log = (
        "./tb_top.v:7: syntax error\n"
        "./tb_top.v:6: error: Malformed statement\n"
        "./sub/top.v:12: warning: Port 1 (d) of chain expects 3 bits, got 1.\n"
        "./sub/top.v:12:        : Padding 2 high bits of the port.\n"
        "./tb_top.v:3: Include file missing.vh not found\n"
        "./tb_top.v:9: sorry: Unpacked structs not supported.\n"
        'error: Unable to find the root module "tb_x" in the Verilog source.\n'
        "2 error(s) during elaboration.\n"
        "I give up.\n"
    )
    got = [(d["severity"], d["file"], d["line"], d["original"]) for d in parse_iverilog(log)]
    assert got == [
        ("error", "tb_top.v", 7, "syntax error"),
        ("error", "tb_top.v", 6, "Malformed statement"),
        ("warning", "sub/top.v", 12, "Port 1 (d) of chain expects 3 bits, got 1."),
        ("error", "tb_top.v", 3, "Include file missing.vh not found"),
        ("error", "tb_top.v", 9, "Unpacked structs not supported."),
        ("error", None, None, 'Unable to find the root module "tb_x" in the Verilog source.'),
    ]
    assert {d["source"] for d in parse_iverilog(log)} == {"iverilog"}
    assert {d["code"] for d in parse_iverilog(log)} == {"ERROR", "WARNING"}


def test_resolve_testbench_request() -> None:
    files = {
        "top.v": "module top(input clk, output q); assign q = clk; endmodule\n",
        "tb_a.v": "module tb_a; top dut(); endmodule\n",
        "tb_b.v": "module tb_b; top dut(); endmodule\n",
        "inc/defs.vh": "`define X 1\n",
        "rom.hex": "00\n",
        "top.cst": 'IO_LOC "clk" 4;\n',
    }
    config = {
        "format": 1,
        "design": {"defines": {"FAST": True, "N": "4"}, "includeDirs": ["inc"], "parameters": {"W": 2}},
    }
    res = resolve_testbench(files, config, "tb_b.v", share_dir=REPO)
    assert res.diagnostics == []
    assert res.job == {
        "files": ["top.v", "tb_b.v"],
        "roots": ["tb_b"],
        "includeDirs": ["inc"],
        "defines": {"FAST": True, "N": "4"},
    }
    # Another testbench and the binding file are not visible to the job.
    assert sorted(res.sources) == ["inc/defs.vh", "rom.hex", "tb_b.v", "top.v"]
    # A file with a design and a testbench stays in the build; the root is the testbench only.
    mixed = {"top.v": files["top.v"] + "module tb_top; top dut(); endmodule\n"}
    res = resolve_testbench(mixed, None, "top.v", share_dir=REPO)
    assert res.job is not None and res.job["files"] == ["top.v"] and res.job["roots"] == ["tb_top"]
