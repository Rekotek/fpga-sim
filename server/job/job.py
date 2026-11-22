#!/usr/bin/env python3
"""The job script inside the build container (spec sections 8.1 and 8.4).

    job build    Verilator → parse Vtop.h → shim.cpp → compile → link
    job check    Verilator and parse Vtop.h, no compilation
    job testbench    Icarus Verilog: iverilog → vvp, output and the waveform file
    job probe    what the job can access: network and writing (for the limits test)
    job pch <file>   a precompiled header; called when the image is built

The job reads /work/request.json and the project files in /work/src, writes /work/result.json
and, on a successful build, /work/out/sim.wasm and /work/out/sim.mjs. The job does not parse
Verilator messages: the text goes to the service as is.

Request:
    { "top": "top", "visibility": "all", "files": ["top.v"], "includeDirs": ["."],
      "parameters": {"N": 8}, "defines": {"FAST": true}, "dataFiles": ["rom.hex"],
      "maxWasmBytes": 16777216, "jobs": 2 }

Result (field status): ok, verilator_failed, toolchain_failed, oom, too_large.

Testbench request:
    { "files": ["top.v", "tb_top.v"], "roots": ["tb_top"], "includeDirs": ["."], "defines": {},
      "tbSeconds": 20, "maxOutputBytes": 262144, "maxVcdBytes": 20971520 }
Testbench result (field status): ok, compile_failed, timeout, oom, toolchain_failed; fields compilerLog,
exitCode, stdout, truncated, vcd (whether /work/out/dump.vcd exists), vcdTooLarge.
The request field maxSeconds is the time limit of the job itself: when it expires, the job exits
with code 124, even if the service that started it is no longer running.
"""

from __future__ import annotations

import concurrent.futures
import json
import os
import pty
import re
import resource
import shutil
import signal
import socket
import subprocess
import sys
import termios
import threading
import time
from dataclasses import asdict
from pathlib import Path

import shimgen

WORK = Path(os.environ.get("FPGASIM_WORK", "/work"))
PREFIX = Path(os.environ.get("FPGASIM_PREFIX", "/opt/fpgasim"))
VL_INC = Path("/opt/verilator/include")
PCH = PREFIX / "rt" / "engine.pch"

# Verilator support files that sit in libfpgasim_rt.a (decision 5).
RT_VERILATOR = {"verilated", "verilated_dpi", "verilated_threads"}

# Model compile flags. The library (core/CMakeLists.txt) and the precompiled header
# are built with the same flags: if they differ, the compiler rejects the header.
CXXFLAGS = [
    "-std=c++20", "-O2", "-fbracket-depth=4096", "-w",
    "-DVM_COVERAGE=0", "-DVM_SC=0", "-DVM_TIMING=0", "-DVM_TRACE=0",
    "-DVM_TRACE_FST=0", "-DVM_TRACE_VCD=0", "-DVM_TRACE_SAIF=0",
    "-DVL_IGNORE_UNKNOWN_ARCH",
    f"-I{VL_INC}", f"-I{VL_INC}/vltstd", f"-I{PREFIX}/include",
    "-include", "cstdint",
]  # fmt: skip

LINK_FLAGS = [
    "-O2",
    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=worker,node",
    "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=33554432", "-sMAXIMUM_MEMORY=536870912",
    "-sASSERTIONS=0",
    "-sEXPORTED_FUNCTIONS=_fs_init,_fs_alloc,_fs_free,_fs_json,_fs_binary,_fs_tick",
    "-sEXPORTED_RUNTIME_METHODS=HEAPU8",
    "--js-library", str(PREFIX / "rt" / "host.js"),
]  # fmt: skip


# Up to this many files (model and shim) the build runs as one translation unit.
# Verilator splits the model into files by size, so the file count grows with the design.
UNITY_MAX_FILES = 9
MAX_LOG_BYTES = 2 * 1024 * 1024  # Verilator output in the job result; the service reads the result with a limit
OOM_EVENTS = Path("/sys/fs/cgroup/memory.events")


def oom_kills() -> int:
    """How many container processes the kernel killed for lack of memory (cgroup v2).

    Verilator and em++ are wrappers: the kernel kills their child, and the wrapper exits with an ordinary error.
    So lack of memory is detected by the counter, not by the exit code.
    """
    try:
        for line in OOM_EVENTS.read_text(encoding="ascii").splitlines():
            key, _, value = line.partition(" ")
            if key == "oom_kill":
                return int(value)
    except (OSError, ValueError):
        pass
    return 0


class StepFailed(Exception):
    def __init__(self, status: str, log: str) -> None:
        super().__init__(status)
        self.status = status
        self.log = log


def run(cmd: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, errors="replace")


def tool(cmd: list[str], cwd: Path | None = None) -> str:
    """A compile or link step: a failure is a tool failure, not a user error."""
    res = run(cmd, cwd)
    if res.returncode != 0 and (res.returncode == -signal.SIGKILL or oom_kills() > 0):
        # The kernel kills a process that exceeds the container memory.
        raise StepFailed("oom", f"{cmd[0]}: процесс убит (нехватка памяти)")
    if res.returncode != 0:
        raise StepFailed("toolchain_failed", f"$ {' '.join(cmd)}\n{res.stdout}{res.stderr}")
    return res.stdout + res.stderr


def verilator_cmd(req: dict, objdir: Path) -> list[str]:
    """Flags of spec section 7.4. File paths start with src/, so they do not read as flags."""
    cmd = [
        "verilator", "--cc", "--prefix", "Vtop", "--top-module", req["top"], "-Mdir", str(objdir),
        "--x-assign", "0", "--x-initial", "0", "--no-timing",
        "-Wall", "-Wno-fatal", "--error-limit", "30",
        "-O3", "--compiler", "clang",
    ]  # fmt: skip
    if req.get("visibility", "ports") == "all":
        cmd.append("--public-flat-rw")
    for name, value in req.get("parameters", {}).items():
        text = json.dumps(value, ensure_ascii=False) if isinstance(value, str) else str(value)
        cmd.append(f"-G{name}={text}")
    for name, value in req.get("defines", {}).items():
        cmd.append(f"-D{name}" if value is True else f"-D{name}={value}")
    for folder in req.get("includeDirs", ["."]):
        cmd.append("-Isrc" if folder in (".", "") else f"-Isrc/{folder}")
    return cmd + [f"src/{path}" for path in req["files"]]


def verilate(req: dict, objdir: Path, result: dict) -> list[shimgen.Port]:
    started = time.perf_counter()
    res = run(verilator_cmd(req, objdir), cwd=WORK)
    result["timings"]["verilatorMs"] = round((time.perf_counter() - started) * 1000, 1)
    result["verilatorLog"] = (res.stdout + res.stderr)[:MAX_LOG_BYTES]
    if res.returncode != 0 and (res.returncode == -signal.SIGKILL or oom_kills() > 0):
        result["verilatorLog"] = ""
        raise StepFailed("oom", "verilator: процесс убит (нехватка памяти)")
    header = objdir / "Vtop.h"
    if res.returncode != 0 or not header.exists():
        raise StepFailed("verilator_failed", "")
    try:
        ports = shimgen.parse_ports(header.read_text(encoding="utf-8"))
    except ValueError as e:
        raise StepFailed("toolchain_failed", f"Vtop.h: {e}") from e
    if not ports:
        raise StepFailed("toolchain_failed", "Vtop.h: у верхнего модуля нет портов")
    result["ports"] = [asdict(p) for p in ports]
    return ports


def op_check(req: dict, result: dict) -> None:
    verilate(req, WORK / "obj", result)


def op_build(req: dict, result: dict) -> None:
    objdir = WORK / "obj"
    ports = verilate(req, objdir, result)

    started = time.perf_counter()
    shim = WORK / "shim.cpp"
    try:
        shim.write_text(shimgen.render_shim(ports, req["top"]), encoding="utf-8")
    except ValueError as e:
        raise StepFailed("toolchain_failed", str(e)) from e
    classes = (objdir / "Vtop_classes.mk").read_text(encoding="utf-8")
    needed = set(re.findall(r"^\s+(verilated\w*)\s*\\?$", classes, re.M))
    if missing := sorted(needed - RT_VERILATOR):
        raise StepFailed("toolchain_failed", f"модель требует служебные файлы Verilator вне библиотеки: {missing}")
    result["timings"]["shimMs"] = round((time.perf_counter() - started) * 1000, 1)

    started = time.perf_counter()
    odir = WORK / "o"
    odir.mkdir(exist_ok=True)
    flags = [*(["-include-pch", str(PCH)] if PCH.exists() else []), *CXXFLAGS, f"-I{objdir}"]

    def compile_one(src: Path) -> Path:
        target = odir / (src.stem + ".o")
        tool(["em++", *flags, "-c", str(src), "-o", str(target)])
        return target

    units = [*sorted(objdir.glob("*.cpp")), shim]
    result["modelFiles"] = len(units) - 1
    if len(units) <= UNITY_MAX_FILES:
        # A small model: one translation unit. The headers are parsed once, and this is faster
        # than two processes (decisions 6 and 44). A large model cannot be built this way: parallelism
        # is lost and the compiler memory grows.
        unity = WORK / "unity.cpp"
        unity.write_text("".join(f'#include "{src}"\n' for src in units), encoding="utf-8")
        objects = [compile_one(unity)]
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=int(req.get("jobs", 2))) as pool:
            objects = list(pool.map(compile_one, units))
    result["timings"]["compileMs"] = round((time.perf_counter() - started) * 1000, 1)

    started = time.perf_counter()
    out = WORK / "out"
    out.mkdir(exist_ok=True)
    link = ["em++", *map(str, objects), str(PREFIX / "rt" / "libfpgasim_rt.a"), "-o", str(out / "sim.mjs"), *LINK_FLAGS]
    data = req.get("dataFiles", [])
    if data:
        # Memory data files are embedded so that $readmemh works (spec section 7.5).
        link.append("-sFILESYSTEM=1")
        for path in data:
            # The "@" sign in the parameter separates the path inside the core; in the paths themselves it is doubled.
            link += ["--embed-file", f"src/{path.replace('@', '@@')}@{path.replace('@', '@@')}"]
    else:
        link.append("-sFILESYSTEM=0")
    tool(link, cwd=WORK)
    result["timings"]["linkMs"] = round((time.perf_counter() - started) * 1000, 1)

    size = (out / "sim.wasm").stat().st_size
    result["wasmBytes"] = size
    if size > int(req.get("maxWasmBytes", 16 * 1024 * 1024)):
        raise StepFailed("too_large", f"sim.wasm: {size} байт")


# The waveform file name in the testbench text: $dumpfile("name").
DUMPFILE_RE = re.compile(r'\$dumpfile\s*\(\s*"([^"\n]+)"')
DEFAULT_DUMP = "dump.vcd"  # the Icarus name when $dumpvars has no $dumpfile
READ_CHUNK = 64 * 1024


def iverilog_cmd(req: dict, target: Path) -> list[str]:
    """Spec section 8.3: iverilog -g2012 -s <module>. Paths start with ./ so they do not read as flags."""
    cmd = ["iverilog", "-g2012", "-o", str(target)]
    for root in req["roots"]:
        cmd += ["-s", root]
    for name, value in req.get("defines", {}).items():
        cmd.append(f"-D{name}" if value is True else f"-D{name}={value}")
    for folder in req.get("includeDirs", ["."]):
        cmd.append("-I." if folder in (".", "") else f"-I./{folder}")
    return cmd + [f"./{path}" for path in req["files"]]


def limit_file_size(max_bytes: int):  # noqa: ANN201
    """The file size limit for vvp. The SIGXFSZ signal is ignored: a write past the limit
    ends with an error, while the testbench keeps running and prints its result."""

    def apply() -> None:
        signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_bytes, max_bytes))

    return apply


def remove_path(path: Path) -> None:
    """Removes a file, a link or a folder: the testbench could have created anything in /work."""
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink(missing_ok=True)
    except OSError:
        pass


def find_dump(req: dict, run_dir: Path) -> Path | None:
    """The waveform file by $dumpfile in the testbench text (it is last in the file list)."""
    names: list[str] = []
    for path in reversed(req["files"]):
        try:
            names += DUMPFILE_RE.findall((run_dir / path).read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue
    root = run_dir.resolve()
    for name in [*names, DEFAULT_DUMP]:
        candidate = run_dir / name
        try:
            inside = candidate.resolve().is_relative_to(root)
            if inside and candidate.is_file() and not candidate.is_symlink():
                return candidate
        except (OSError, ValueError):  # a name that is too long, a null byte
            continue
    return None


def op_testbench(req: dict, result: dict) -> None:
    started = time.monotonic()
    deadline = started + float(req.get("tbSeconds", 20))
    # The project files belong to the service; the testbench writes next to them ($dumpfile, $fopen),
    # so it works in its own copy.
    run_dir = WORK / "run"
    shutil.copytree(WORK / "src", run_dir)
    program = WORK / "tb.vvp"

    try:
        res = subprocess.run(
            iverilog_cmd(req, program), cwd=run_dir, capture_output=True, text=True, errors="replace",
            timeout=max(0.1, deadline - time.monotonic()),
        )  # fmt: skip
    except subprocess.TimeoutExpired:
        raise StepFailed("timeout", "") from None
    result["timings"]["compileMs"] = round((time.monotonic() - started) * 1000, 1)
    result["compilerLog"] = (res.stdout + res.stderr)[:MAX_LOG_BYTES]
    if res.returncode != 0 and (res.returncode == -signal.SIGKILL or oom_kills() > 0):
        raise StepFailed("oom", "iverilog: процесс убит (нехватка памяти)")
    if res.returncode != 0 or not program.exists():
        raise StepFailed("compile_failed", "")

    max_output = int(req.get("maxOutputBytes", 256 * 1024))
    max_vcd = int(req.get("maxVcdBytes", 20 * 1024 * 1024))
    run_started = time.monotonic()
    # Output goes through a pseudo-terminal: vvp writes to it line by line, so the output of a testbench stopped
    # by time is not lost in its buffer. Line feed translation is switched off.
    master, slave = pty.openpty()
    attrs = termios.tcgetattr(slave)
    attrs[1] &= ~termios.OPOST
    termios.tcsetattr(slave, termios.TCSANOW, attrs)
    proc = subprocess.Popen(
        ["vvp", "-n", str(program)], cwd=run_dir, stdin=subprocess.DEVNULL, stdout=slave, stderr=slave,
        preexec_fn=limit_file_size(max_vcd + 1),
    )  # fmt: skip
    os.close(slave)
    output = bytearray()
    truncated = False

    def drain() -> None:
        # Output past the limit is read and discarded: otherwise the testbench would stop on write.
        nonlocal truncated
        while True:
            try:
                chunk = os.read(master, READ_CHUNK)
            except OSError:  # the testbench ended, the terminal is closed
                return
            if not chunk:
                return
            room = max_output - len(output)
            output.extend(chunk[:room])
            truncated = truncated or len(chunk) > room

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    timed_out = False
    try:
        proc.wait(timeout=max(0.1, deadline - time.monotonic()))
    except subprocess.TimeoutExpired:
        timed_out = True
        proc.kill()
        proc.wait()
    reader.join(timeout=5)
    os.close(master)
    result["timings"]["runMs"] = round((time.monotonic() - run_started) * 1000, 1)
    result["stdout"] = bytes(output).decode("utf-8", errors="replace")
    result["truncated"] = truncated
    result["exitCode"] = proc.returncode if proc.returncode is not None and proc.returncode >= 0 else None
    result["vcd"] = False
    if timed_out:
        raise StepFailed("timeout", "")
    if proc.returncode == -signal.SIGKILL and oom_kills() > 0:
        raise StepFailed("oom", "vvp: процесс убит (нехватка памяти)")

    dump = find_dump(req, run_dir)
    if dump is not None:
        size = dump.stat().st_size
        result["vcdBytes"] = size
        if size > max_vcd:
            result["vcdTooLarge"] = True
        else:
            out = WORK / "out"
            remove_path(out)  # the testbench could have created its own file at this place
            out.mkdir()
            dump.replace(out / "dump.vcd")
            result["vcd"] = True


def can_write(path: str) -> bool:
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write("x")
        os.unlink(path)
        return True
    except OSError:
        return False


def op_probe(req: dict, result: dict) -> None:
    """What the job can do. The server test compares this with spec section 8.1."""
    try:
        socket.create_connection(("1.1.1.1", 53), timeout=3).close()
        network = True
    except OSError:
        network = False
    # IPv4 routing table: the first line is a header. Without a network there are no routes at all.
    # (A list of interfaces does not fit: in an empty namespace the kernel shows tunnel stubs.)
    routes = Path("/proc/net/route").read_text(encoding="ascii").splitlines()[1:]
    result["probe"] = {
        "uid": os.getuid(),
        "gid": os.getgid(),
        "network": network,
        "routes": len(routes),
        "writable": {
            path: can_write(f"{path}/fpgasim-probe")
            for path in ("/work", "/tmp", "/", "/etc", "/home", "/var/tmp", "/opt/fpgasim", "/opt/fpgasim/rt", "/usr")
        },
    }


def op_pch(target: str) -> int:
    """A precompiled header (decision 6). The flags are the same as for the model."""
    header = PREFIX / "include" / "fpgasim" / "engine_verilator.h"
    res = run(["em++", *CXXFLAGS, "-x", "c++-header", str(header), "-o", target])
    sys.stderr.write(res.stdout + res.stderr)
    return res.returncode


def main() -> int:
    if len(sys.argv) == 3 and sys.argv[1] == "pch":
        return op_pch(sys.argv[2])
    ops = {"build": op_build, "check": op_check, "probe": op_probe, "testbench": op_testbench}
    if len(sys.argv) != 2 or sys.argv[1] not in ops:
        print(__doc__, file=sys.stderr)
        return 2
    os.environ.setdefault("HOME", "/tmp")
    req = json.loads((WORK / "request.json").read_text(encoding="utf-8"))
    if limit := int(req.get("maxSeconds", 0)):
        # The job is the first process of the container: when it ends, the whole container stops.
        # A handler is required: a signal without a handler is not delivered to the first process.
        signal.signal(signal.SIGALRM, lambda *_: os._exit(124))
        signal.alarm(limit)
    result: dict = {"status": "ok", "timings": {}}
    started = time.perf_counter()
    try:
        ops[sys.argv[1]](req, result)
    except StepFailed as e:
        result["status"] = e.status
        # Spec section 7.6: on a tool failure the last 40 lines of output are returned.
        result["log"] = "\n".join(e.log.splitlines()[-40:])
    except Exception as e:  # noqa: BLE001
        # Only the job writes the result. The /work folder is open to the testbench too:
        # without this catch a job failure
        # would leave in it a result.json that the testbench wrote itself.
        result["status"] = "toolchain_failed"
        result["log"] = f"сбой задания: {type(e).__name__}: {e}"
    result["timings"]["totalMs"] = round((time.perf_counter() - started) * 1000, 1)
    tmp = WORK / "result.json.tmp"
    remove_path(tmp)
    tmp.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    tmp.replace(WORK / "result.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
