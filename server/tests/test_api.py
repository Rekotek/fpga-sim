"""Tests of the server operations on real jobs in the build image."""

from __future__ import annotations

import asyncio
import json
import subprocess
import time
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Env, codes, load_project, one
from fastapi.testclient import TestClient
from fpgasim_server.api import create_app
from fpgasim_server.jobs import docker_command

# --- Keys and request limits -----------------------------------------------------------


def test_health_needs_no_key(env: Env) -> None:
    response = env.client.get("/v1/health")
    assert response.status_code == 200 and response.json() == {"status": "ok"}


@pytest.mark.parametrize("op", ["info", "build", "check", "artifacts/" + "0" * 64 + "/sim.wasm"])
def test_key_is_required(env: Env, op: str) -> None:
    method = "get" if op == "info" or op.startswith("artifacts") else "post"
    for headers in ({}, {"Authorization": "Bearer wrong"}, {"Authorization": f"Bearer {env.disabled_key}"},
                    {"Authorization": env.key}):  # fmt: skip
        response = getattr(env.client, method)(f"/v1/{op}", headers=headers)
        assert response.status_code == 401, (op, headers)
        assert response.json()["error"]["code"] == "UNAUTHORIZED"


def test_info(env: Env) -> None:
    body = env.client.get("/v1/info", headers=env.auth).json()
    assert body["owner"] == "tester" and body["protocol"] == 1
    # The runtime version is the first line of core/VERSION: it is also part of the build image tag.
    runtime = (Path(__file__).resolve().parents[2] / "core" / "VERSION").read_text(encoding="utf-8").split()[0]
    assert body["verilator"] == "5.050" and body["runtime"] == runtime and body["toolchain"].startswith("vl5.050-em")
    assert body["toolchain"].endswith(f"-rt{runtime}")
    assert body["limits"]["build_seconds"] == 60 and body["limits"]["max_project_bytes"] == 2 * 1024 * 1024


def test_project_too_large(env: Env) -> None:
    def status(files: list[dict[str, str]]) -> tuple[int, str]:
        r = env.client.post("/v1/build", json={"files": files, "config": None}, headers=env.auth)
        return r.status_code, r.json().get("error", {}).get("code", "")

    chunk = "// " + "x" * 1020 + "\n"
    part = chunk * 500  # 512 000 bytes: the file passes the 512 KB limit
    assert status([{"path": f"f{i}.v", "content": part} for i in range(5)]) == (413, "PROJECT_TOO_LARGE")  # 2.4 MB
    assert status([{"path": "big.v", "content": chunk * 513}]) == (413, "PROJECT_TOO_LARGE")  # the file is over 512 KB
    assert status([{"path": f"f{i}.txt", "content": ""} for i in range(201)]) == (413, "PROJECT_TOO_LARGE")
    assert status([{"path": "huge.v", "content": "x" * (14 * 1024 * 1024)}]) == (413, "PROJECT_TOO_LARGE")
    big_config = env.client.post(
        "/v1/build", json={"files": [], "config": {"format": 1, "name": "x" * 600_000}}, headers=env.auth
    )
    assert big_config.status_code == 413


@pytest.mark.parametrize(
    "body",
    [
        {"config": None},
        {"files": "top.v"},
        {"files": [{"path": "../top.v", "content": ""}]},
        {"files": [{"path": "/etc/passwd", "content": ""}]},
        {"files": [{"path": "a//b.v", "content": ""}]},
        {"files": [{"path": "a\\b.v", "content": ""}]},
        {"files": [{"path": "top.v", "content": ""}, {"path": "top.v", "content": ""}]},
        {"files": [], "options": {"visibility": "some"}},
    ],
)
def test_bad_request(env: Env, body: dict[str, Any]) -> None:
    response = env.client.post("/v1/build", json=body, headers=env.auth)
    assert response.status_code == 400 and response.json()["error"]["code"] == "BAD_REQUEST"


def test_rate_limit(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(builds_per_minute=3, checks_per_minute=2)
    body = load_project("top_ambiguous")  # refusal before the job: the test does not wait for builds
    statuses = [env.client.post("/v1/build", json=body, headers=env.auth).status_code for _ in range(4)]
    assert statuses == [200, 200, 200, 429]
    assert env.log[-1]["result"] == "RATE_LIMITED"
    # Checks are counted separately from builds and have their own limit.
    checks = [env.client.post("/v1/check", json=body, headers=env.auth).status_code for _ in range(3)]
    assert checks == [200, 200, 429]


def test_cors(env: Env) -> None:
    allowed = env.client.get("/v1/health", headers={"Origin": "http://localhost:5173"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in env.client.get("/v1/health", headers={"Origin": "https://evil"}).headers


# --- Autodetection and binding: one project per code -----------------------------------


@pytest.mark.parametrize(
    ("project", "code", "severity", "status"),
    [
        ("top_ambiguous", "TOP_AMBIGUOUS", "error", "failed"),
        ("top_not_found", "TOP_NOT_FOUND", "error", "failed"),
        ("cst_ambiguous", "CST_AMBIGUOUS", "error", "failed"),
        ("cst_no_pin", "CST_NO_PIN", "error", "failed"),
        ("cst_pin_twice", "CST_PIN_TWICE", "error", "failed"),
        ("cst_port_twice", "CST_PORT_TWICE", "error", "failed"),
        ("cst_syntax", "CST_SYNTAX", "error", "failed"),
        ("config_invalid", "CONFIG_INVALID", "error", "failed"),
        ("cst_no_port", "CST_NO_PORT", "error", "failed"),
        ("cst_unknown", "CST_UNKNOWN", "warning", "ok"),
        ("cst_diff_pair", "CST_DIFF_PAIR", "warning", "ok"),
        ("cst_keeper", "CST_KEEPER", "warning", "ok"),
        ("port_unbound", "PORT_UNBOUND", "warning", "ok"),
        ("pins_ignored", "PINS_IGNORED", "warning", "ok"),
        ("pin_forbidden", "PIN_FORBIDDEN", "warning", "ok"),
        ("device_pin", "DEVICE_NOT_MODELED", "warning", "ok"),
        ("cst_io_type", "CST_IO_TYPE", "warning", "ok"),
        ("tb_mixed", "TB_MIXED", "warning", "ok"),
        ("pins_no_port", "PINS_NO_PORT", "error", "failed"),
        ("pins_no_pin", "PINS_NO_PIN", "error", "failed"),
        ("pins_pin_twice", "PINS_PIN_TWICE", "error", "failed"),
        ("c_code", "C_CODE_UNSUPPORTED", "error", "failed"),
        ("c_code_macro", "C_CODE_UNSUPPORTED", "error", "failed"),
        ("gowin_primitive", "GOWIN_PRIMITIVE_UNSUPPORTED", "error", "failed"),
        ("module_not_found", "MODULE_NOT_FOUND", "error", "failed"),
    ],
)
def test_project_gets_its_code(env: Env, project: str, code: str, severity: str, status: str) -> None:
    body = env.check(project)
    found = one(body, code)
    assert found["severity"] == severity
    assert body["status"] == status
    errors = [d["code"] for d in body["diagnostics"] if d["severity"] == "error"]
    assert errors == ([code] if severity == "error" else [])


def test_code_details(env: Env) -> None:
    assert one(env.check("top_ambiguous"), "TOP_AMBIGUOUS")["args"]["candidates"] == ["alpha", "beta"]
    assert one(env.check("cst_ambiguous"), "CST_AMBIGUOUS")["args"]["candidates"] == ["a.cst", "b.cst"]
    no_port = one(env.check("cst_no_port"), "CST_NO_PORT")
    assert (no_port["source"], no_port["file"], no_port["line"], no_port["args"]["port"]) == (
        "cst",
        "top.cst",
        6,
        "nosuch",
    )
    twice = one(env.check("cst_pin_twice"), "CST_PIN_TWICE")
    assert (twice["line"], twice["args"]["pin"], twice["args"]["ports"]) == (5, 15, ["led[0]", "led[1]"])
    assert one(env.check("cst_no_pin"), "CST_NO_PIN")["args"]["pin"] == 999
    forbidden = env.check("pin_forbidden")
    assert one(forbidden, "PIN_FORBIDDEN")["args"]["pin"] == 59
    # Flash memory is in devices without a version: there is no device notice for the forbidden pin.
    assert [d for d in forbidden["diagnostics"] if d["code"] == "DEVICE_NOT_MODELED"] == []
    device = one(env.check("device_pin"), "DEVICE_NOT_MODELED")
    assert (device["source"], device["file"], device["line"]) == ("cst", "top.cst", 5)
    # The device label is a text per language (decision 168): the expectation changed with the board format.
    assert device["args"] == {"port": "led[1]", "pin": 33, "device": {"ru": "HDMI", "en": "HDMI"}, "since": 2}
    io_type = one(env.check("cst_io_type"), "CST_IO_TYPE")  # lowercase lvcmos33 on btn matches
    assert (io_type["source"], io_type["file"], io_type["line"]) == ("cst", "top.cst", 6)
    assert io_type["args"] == {"port": "led[0]", "pin": 15, "given": "LVCMOS18", "expected": "LVCMOS33"}
    assert one(env.check("gowin_primitive"), "GOWIN_PRIMITIVE_UNSUPPORTED")["args"] == {"module": "rPLL"}
    missing = one(env.check("module_not_found"), "MODULE_NOT_FOUND")
    assert (missing["args"], missing["file"], missing["line"]) == ({"module": "blinker"}, "top.v", 5)
    unbound = env.check("port_unbound")
    assert one(unbound, "PORT_UNBOUND")["args"] == {"port": "led", "bits": [1]}
    assert unbound["resolved"]["unbound"] == [{"port": "led", "bit": 1}]
    diff = env.check("cst_diff_pair")
    assert {"port": "led", "bit": 1, "pin": 33, "pull": "none"} in diff["resolved"]["pins"]


def test_unknown_config_fields_warn(env: Env) -> None:
    body = env.check("config_unknown")
    fields = [d["args"]["field"] for d in body["diagnostics"] if d["code"] == "CONFIG_UNKNOWN_FIELD"]
    assert fields == ["colour", "design.topp"] and body["status"] == "ok"


def test_syntax_error_location(env: Env) -> None:
    """A syntax error is returned with the right file, line and column."""
    body = env.build("syntax_error")
    assert body["status"] == "failed" and "artifacts" not in body
    errors = [d for d in body["diagnostics"] if d["severity"] == "error"]
    assert len(errors) == 1
    # The semicolon is missing on line 6; Verilator notices it at the word end on line 7, column 5.
    assert (errors[0]["source"], errors[0]["file"], errors[0]["line"], errors[0]["column"]) == (
        "verilator",
        "top.v",
        7,
        5,
    )
    assert errors[0]["original"].startswith("syntax error")
    assert env.build("syntax_error")["cached"] is True  # a failed build is cached too


def test_resolved(env: Env) -> None:
    body = env.check("with_testbench")
    assert body["status"] == "ok"
    assert body["resolved"] == {
        "board": "tang-nano-20k",
        "top": "top",
        "topFile": "top.v",
        "files": ["top.v"],
        "testbenches": ["tb_top.v"],
        "constraints": "top.cst",
        "visibility": "ports",
        "ports": [
            {"name": "clk", "dir": "in", "width": 1, "msb": 0, "lsb": 0},
            {"name": "btn", "dir": "in", "width": 1, "msb": 0, "lsb": 0},
            {"name": "led", "dir": "out", "width": 2, "msb": 1, "lsb": 0},
        ],
        "clock": {"port": "clk", "pin": 4, "hz": 27000000},
        "pins": [
            {"port": "clk", "bit": 0, "pin": 4, "pull": "none"},
            {"port": "btn", "bit": 0, "pin": 88, "pull": "down"},
            {"port": "led", "bit": 0, "pin": 15, "pull": "none"},
            {"port": "led", "bit": 1, "pin": 16, "pull": "none"},
        ],
        "unbound": [],
    }


def test_pins_field_binds_without_cst(env: Env) -> None:
    body = env.check("pins_field")
    assert body["status"] == "ok" and body["resolved"]["constraints"] is None
    assert {"port": "btn", "bit": 0, "pin": 87, "pull": "down"} in body["resolved"]["pins"]
    assert body["resolved"]["clock"]["port"] == "clk"


# --- Build and cache ---------------------------------------------------------------------


@pytest.mark.parametrize("example", ["blink3", "buttons"])
def test_examples_build_and_cache(env: Env, example: str) -> None:
    first = env.build(example)
    assert first["status"] == "ok", first["diagnostics"]
    assert len(first["buildId"]) == 64
    assert first["artifacts"] == {
        "wasm": f"/v1/artifacts/{first['buildId']}/sim.wasm",
        "js": f"/v1/artifacts/{first['buildId']}/sim.mjs",
    }
    wasm = env.client.get(first["artifacts"]["wasm"], headers=env.auth)
    assert wasm.status_code == 200 and wasm.content[:4] == b"\0asm"
    assert wasm.headers["content-type"] == "application/wasm"
    assert wasm.headers["cache-control"] == "public, max-age=31536000, immutable"
    js = env.client.get(first["artifacts"]["js"], headers=env.auth)
    assert js.status_code == 200 and b"fs_emit_json" in js.content
    assert env.client.get(f"/v1/artifacts/{first['buildId']}/meta.json", headers=env.auth).status_code == 404

    started = time.monotonic()
    second = env.build(example)
    elapsed_ms = (time.monotonic() - started) * 1000
    assert second["cached"] is True and second["buildId"] == first["buildId"]
    assert elapsed_ms < 300, f"повторная сборка заняла {elapsed_ms:.0f} мс"
    assert second["diagnostics"] == first["diagnostics"] and second["resolved"] == first["resolved"]
    assert env.log[-1]["op"] == "build" and env.log[-1]["cached"] is True and env.log[-1]["owner"] == "tester"
    assert "files" not in env.log[-1] and env.log[-1]["projectBytes"] > 0


def test_blink3_diagnostics_and_clock(env: Env) -> None:
    body = env.build("blink3")
    assert set(codes(body)) == {"WIDTHEXPAND", "PROCASSINIT"}
    assert all(d["source"] == "verilator" and d["file"] == "top.v" and d["line"] for d in body["diagnostics"])
    assert body["resolved"]["clock"] == {"port": "clk", "pin": 4, "hz": 27000000}
    assert body["resolved"]["unbound"] == []


def test_cst_change_keeps_build_id(env: Env) -> None:
    """The binding is not part of the cache key: an edit of .cst does not cause a rebuild."""
    base = env.build("blink3")
    project = load_project("blink3")
    for f in project["files"]:
        if f["path"] == "top.cst":
            f["content"] = f["content"].replace('IO_LOC "led[5]" 20;', 'IO_LOC "led[5]" 73;')
    moved = env.post("build", project)
    assert moved["buildId"] == base["buildId"] and moved["cached"] is True and moved["status"] == "ok"
    assert {"port": "led", "bit": 5, "pin": 73, "pull": "none"} in moved["resolved"]["pins"]
    full = env.build("blink3", options={"visibility": "all"})
    assert full["buildId"] != base["buildId"] and full["resolved"]["visibility"] == "all"


def test_check_does_not_build(make_env: Any) -> None:  # noqa: ANN401
    env = make_env()
    body = env.check("ok")
    assert body["status"] == "ok" and "artifacts" not in body and "buildId" not in body
    assert not any((env.settings.data_dir / "cache").iterdir())
    assert not any((env.settings.data_dir / "jobs").iterdir())  # the job folder is removed


def test_build_timeout(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(build_seconds=1.5)
    started = time.monotonic()
    body = env.build("build_timeout")
    assert body["status"] == "failed" and "artifacts" not in body
    assert one(body, "BUILD_TIMEOUT")["source"] == "toolchain"
    assert time.monotonic() - started < 15
    assert not any((env.settings.data_dir / "jobs").iterdir())
    assert env.build("build_timeout")["cached"] is False  # a timeout failure does not go to the cache


def test_build_out_of_memory(make_env: Any) -> None:  # noqa: ANN401
    """The build ran out of container memory: code BUILD_OOM, the failure is not cached."""
    env = make_env(build_memory_mb=24)
    body = env.build("build_timeout")
    assert body["status"] == "failed" and "artifacts" not in body
    assert [d["code"] for d in body["diagnostics"] if d["severity"] == "error"] == ["BUILD_OOM"]
    assert not any((env.settings.data_dir / "cache").iterdir())
    assert env.build("build_timeout")["cached"] is False


def test_toolchain_failed_when_image_is_missing(test_root: Any) -> None:  # noqa: ANN401
    """A tool failure (here: no build image): TOOLCHAIN_FAILED, the service does not pull the image."""
    env = Env(test_root / "noimage")
    env.settings = replace(env.settings, image="fpgasim-build:no-such-tag")
    env.app = create_app(env.settings, env.log.append)
    env.client = TestClient(env.app)
    started = time.monotonic()
    body = env.build("ok")
    assert time.monotonic() - started < 10
    failure = one(body, "TOOLCHAIN_FAILED")
    assert (failure["source"], failure["severity"], body["status"]) == ("toolchain", "error", "failed")
    assert "артефакт" not in failure["original"] and "код" in failure["original"]
    assert env.build("ok")["cached"] is False


def test_job_disk_limit(make_env: Any) -> None:  # noqa: ANN401
    """The job folder is over the limit: the build is rejected, files do not go to the cache, the folder is removed."""
    env = make_env(job_disk_bytes=100_000)
    body = env.build("ok")
    assert body["status"] == "failed" and "artifacts" not in body
    assert one(body, "BUILD_DISK_LIMIT")["args"]["limit"] == 100_000
    assert not any((env.settings.data_dir / "cache").iterdir())
    assert not any((env.settings.data_dir / "jobs").iterdir())


def test_wasm_too_large(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(max_wasm_bytes=1000)
    body = env.build("ok")
    assert body["status"] == "failed" and "artifacts" not in body
    assert one(body, "WASM_TOO_LARGE")["args"]["limit"] == 1000
    assert env.client.get(f"/v1/artifacts/{body['buildId']}/sim.wasm", headers=env.auth).status_code == 404


def test_leftovers_of_previous_run_are_removed(make_env: Any) -> None:  # noqa: ANN401
    """The service was stopped in the middle of a job: at the next start the job folders and containers are removed."""
    env = make_env()
    jobs = env.settings.data_dir / "jobs"
    (jobs / "deadbeef" / "src").mkdir(parents=True)
    (jobs / "deadbeef" / "src" / "top.v").write_text("module top; endmodule\n", encoding="utf-8")
    name = f"fpgasim-job-leftover-{jobs.parent.parent.name}"
    subprocess.run(
        ["docker", "run", "-d", "--rm", "--name", name, "--label", f"fpgasim.jobs={env.settings.data_dir}",
         env.settings.image, "sleep", "300"],
        check=True, capture_output=True,
    )  # fmt: skip
    try:
        create_app(env.settings, env.log.append)
        assert not any(jobs.iterdir())
        assert (jobs.stat().st_mode & 0o777) == 0o700
        left = subprocess.run(["docker", "ps", "-q", "--filter", f"name={name}"], capture_output=True, text=True)
        assert left.stdout.strip() == ""
    finally:
        subprocess.run(["docker", "rm", "-f", name], capture_output=True)


def test_unexpected_inputs_get_json_errors(env: Env) -> None:
    """Inputs that used to give a 500 without a body and without a log line."""
    top = next(f for f in load_project("ok")["files"] if f["path"] == "top.v")

    def post(files: list[dict[str, str]]) -> tuple[int, dict[str, Any]]:
        r = env.client.post("/v1/check", json={"files": files, "config": None}, headers=env.auth)
        return r.status_code, r.json()

    # One path is named both a file and a folder.
    status, body = post([top, {"path": "inc.vh", "content": ""}, {"path": "inc.vh/x.vh", "content": ""}])
    assert (status, body["error"]["code"]) == (400, "BAD_REQUEST")
    # A file name longer than 255 bytes (200 Cyrillic letters are 400 bytes).
    status, body = post([top, {"path": "ф" * 200 + ".vh", "content": ""}])
    assert (status, body["error"]["code"]) == (400, "BAD_REQUEST")
    # A pin number made of non-ASCII digits and a number of thousands of digits.
    for pin in ("²", "9" * 5000):
        status, body = post([top, {"path": "top.cst", "content": f'IO_LOC "clk" {pin};\n'}])
        assert status == 200 and [d["code"] for d in body["diagnostics"]] == ["CST_NO_PIN"], body
        assert len(json.dumps(body)) < 2000
    # A top module without ports, named explicitly (without an explicit file list such a file is a testbench).
    config = {"format": 1, "design": {"files": ["t.v"], "top": "t"}}
    files = [{"path": "t.v", "content": "module t; endmodule\n"}]
    r = env.client.post("/v1/check", json={"files": files, "config": config}, headers=env.auth)
    assert r.status_code == 200 and [d["code"] for d in r.json()["diagnostics"]] == ["TOP_NO_PORTS"]


def test_internal_error_is_json_and_logged(make_env: Any, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: ANN401
    env = make_env()

    def boom(*args: Any, **kwargs: Any) -> None:  # noqa: ANN401
        raise RuntimeError("секретная подробность")

    monkeypatch.setattr("fpgasim_server.api.resolve", boom)
    r = env.client.post("/v1/check", json=load_project("ok"), headers=env.auth)
    assert r.status_code == 500 and r.json() == {"error": {"code": "INTERNAL", "text": "Внутренняя ошибка сервера"}}
    assert env.log[-1]["result"] == "INTERNAL" and "секретная подробность" in env.log[-1]["error"]


def test_broken_keys_file_keeps_previous_keys(make_env: Any) -> None:  # noqa: ANN401
    env = make_env()
    assert env.client.get("/v1/info", headers=env.auth).status_code == 200
    time.sleep(0.01)
    env.keys_file.write_text("[keys.tester\nsha256 = ", encoding="utf-8")
    assert env.client.get("/v1/info", headers=env.auth).status_code == 200
    assert "keys.toml" in env.log[-1]["keysError"]
    assert env.client.get("/v1/info", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_artifact_requests_are_logged(env: Env) -> None:
    body = env.build("ok")
    before = len(env.log)
    assert env.client.get(body["artifacts"]["js"], headers=env.auth).status_code == 200
    assert env.client.get(body["artifacts"]["js"]).status_code == 401
    assert [(r["op"], r["result"], r["owner"]) for r in env.log[before:]] == [
        ("artifacts", "ok", "tester"),
        ("artifacts", "UNAUTHORIZED", None),
    ]


def test_three_concurrent_builds(make_env: Any) -> None:  # noqa: ANN401
    """Three simultaneous builds of different projects end successfully, the third waits in the queue."""
    env = make_env()
    projects = [load_project("ok"), load_project("buttons"), load_project("pins_field")]
    projects[2]["files"][0]["content"] += "// другой проект\n"

    async def run() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=env.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=180) as client:
            return await asyncio.gather(*(client.post("/v1/build", json=p, headers=env.auth) for p in projects))

    responses = asyncio.run(run())
    bodies = [r.json() for r in responses]
    assert [r.status_code for r in responses] == [200, 200, 200]
    assert [b["status"] for b in bodies] == ["ok", "ok", "ok"], bodies
    assert len({b["buildId"] for b in bodies}) == 3 and not any(b["cached"] for b in bodies)
    stats = env.app.state.service.runner.stats
    assert (stats.started, stats.max_running, stats.queued) == (3, 2, 1)


def test_same_project_builds_once(make_env: Any) -> None:  # noqa: ANN401
    env = make_env()

    async def run() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=env.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=180) as client:
            return await asyncio.gather(
                *(client.post("/v1/build", json=load_project("ok"), headers=env.auth) for _ in range(3))
            )

    bodies = [r.json() for r in asyncio.run(run())]
    assert [b["status"] for b in bodies] == ["ok", "ok", "ok"]
    assert env.app.state.service.runner.stats.started == 1


def test_busy_when_queue_does_not_clear(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(concurrent_jobs=1, queue_seconds=0.2)
    projects = [load_project("ok"), load_project("buttons")]

    async def run() -> list[httpx.Response]:
        transport = httpx.ASGITransport(app=env.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=180) as client:
            return await asyncio.gather(*(client.post("/v1/build", json=p, headers=env.auth) for p in projects))

    responses = asyncio.run(run())
    assert sorted(r.status_code for r in responses) == [200, 503]
    busy = next(r for r in responses if r.status_code == 503)
    assert busy.json()["error"]["code"] == "BUSY"


# --- Job limits ---------------------------------------------------------------------------


def test_job_container_is_isolated(env: Env) -> None:
    """The container of the job has no network, and writing outside /work and /tmp is impossible (spec section 8.1)."""
    runner = env.app.state.service.runner

    async def run() -> dict[str, Any]:
        async with runner.job("probe", {}, {"top.v": "module top; endmodule\n"}) as outcome:
            assert outcome.status == "ok", outcome.result
            return outcome.result["probe"]

    probe = asyncio.run(run())
    assert probe["network"] is False
    assert probe["routes"] == 0
    assert (probe["uid"], probe["gid"]) == (10001, 10001)
    writable = {path for path, ok in probe["writable"].items() if ok}
    assert writable == {"/work", "/tmp"}
    assert set(probe["writable"]) >= {"/", "/etc", "/home", "/var/tmp", "/opt/fpgasim", "/opt/fpgasim/rt", "/usr"}


def test_job_command_matches_spec(env: Env) -> None:
    cmd = docker_command(env.settings, "name", env.settings.data_dir / "jobs" / "x", "build")
    text = " ".join(cmd)
    for flag in ("--rm", "--pull never", "--network none", "--cpus 2", "--memory 2048m", "--memory-swap 2048m",
                 "--pids-limit 256",
                 "--cap-drop ALL", "--security-opt no-new-privileges", "--user 10001:10001", "--read-only",
                 "--tmpfs /tmp:size=256m"):  # fmt: skip
        assert flag in text, flag
    assert cmd[-3:] == [env.settings.image, "/opt/fpgasim/bin/job", "build"]
