#!/usr/bin/env python3
"""Benchmark: build the variants and measure inside the build image.

Commands:
    prep    pre-build the library (Verilator support files and bench.cpp)
            and the pre-built header for each "target, level, LTO" combination
    one     build one variant and print JSON with the step times
    matrix  build all combinations of mode and optimization level for the speed test
    speed   run the built native programs and record the speed

Build steps follow spec section 8.4: Verilator, parse Vtop.h and create the shim,
compile, link. Verilator flags: section 7.4. Emscripten flags: section 7.5.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
VL_INC = Path("/opt/verilator/include")
MODES = ["all", "ports"]
OPTS = ["O1", "O2", "O3"]
HALF_STEPS = 113_400_000  # 2.1 s of simulation time at 27 MHz
EXPECT_LED = [4, 8, 16, 0, 0, 0]

VM_DEFINES = [
    "-DVM_COVERAGE=0", "-DVM_SC=0", "-DVM_TIMING=0", "-DVM_TRACE=0",
    "-DVM_TRACE_FST=0", "-DVM_TRACE_VCD=0", "-DVM_TRACE_SAIF=0",
]  # fmt: skip
INCLUDES = [f"-I{VL_INC}", f"-I{VL_INC}/vltstd", f"-I{HERE}"]
# Fixed part: Verilator support files and the bench outer loop.
# verilated_dpi is needed only by models with --public-flat-rw (mode all); the library always holds it.
RT_VERILATOR = ["verilated", "verilated_dpi", "verilated_threads"]
WASM_LINK = [
    "-sMODULARIZE=1", "-sEXPORT_ES6=1", "-sENVIRONMENT=web,worker,node",
    "-sALLOW_MEMORY_GROWTH=1", "-sINITIAL_MEMORY=33554432", "-sMAXIMUM_MEMORY=536870912",
    "-sFILESYSTEM=0", "-sASSERTIONS=0",
    "-sEXPORTED_FUNCTIONS=_bench_run", "-sEXPORTED_RUNTIME_METHODS=UTF8ToString",
]  # fmt: skip


def run(cmd: list[str], cwd: Path | None = None) -> str:
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        sys.stderr.write(f"СБОЙ: {' '.join(map(str, cmd))}\n{res.stdout}\n{res.stderr}\n")
        raise SystemExit(1)
    return res.stdout + res.stderr


def compiler(target: str) -> str:
    return "em++" if target == "wasm" else "clang++"


def cflags(target: str, opt: str, lto: bool) -> list[str]:
    flags = ["-std=c++20", f"-{opt}", "-fbracket-depth=4096", "-w", *VM_DEFINES, *INCLUDES]
    if target == "wasm":
        # Verilator before 5.052 does not know WebAssembly in VL_CPU_RELAX; this is its standard workaround.
        flags.append("-DVL_IGNORE_UNKNOWN_ARCH")
    if lto:
        flags.append("-flto")
    # Vtop__Dpi.h (mode all) includes svdpi.h before <cstdint>; with the Emscripten libc this is an error.
    flags += ["-include", "cstdint"]
    return flags


def rt_key(target: str, opt: str, lto: bool) -> str:
    return f"{target}-{opt}{'-lto' if lto else ''}"


def rt_sources(target: str, names: list[str] | None = None) -> list[Path]:
    sources = [VL_INC / f"{name}.cpp" for name in (names or RT_VERILATOR)] + [HERE / "bench.cpp"]
    if target == "wasm":
        sources.append(HERE / "wasm_stubs.cpp")
    return sources


def compile_all(cxx: str, flags: list[str], sources: list[Path], objdir: Path, jobs: int) -> list[Path]:
    """jobs == 1: one command for all files, as in spec section 7.5. Otherwise one process per file."""
    objdir.mkdir(parents=True, exist_ok=True)
    objs = [objdir / (s.stem + ".o") for s in sources]
    if jobs == 1:
        run([cxx, *flags, "-c", *map(str, sources)], cwd=objdir)
    else:
        with concurrent.futures.ThreadPoolExecutor(jobs) as pool:
            list(
                pool.map(
                    lambda so: run([cxx, *flags, "-c", str(so[0]), "-o", str(so[1])]), zip(sources, objs, strict=True)
                )
            )
    return objs


def prep(target: str, opt: str, lto: bool, rtdir: Path) -> Path:
    out = rtdir.resolve() / rt_key(target, opt, lto)
    if (out / "librt.a").exists() and (out / "engine.pch").exists():
        return out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    cxx = compiler(target)
    flags = cflags(target, opt, lto)
    objs = compile_all(cxx, flags, rt_sources(target), out / "obj", jobs=os.cpu_count() or 2)
    ar = "emar" if target == "wasm" else "llvm-ar" if shutil.which("llvm-ar") else "ar"
    run([ar, "rcs", str(out / "librt.a"), *map(str, objs)])
    run([cxx, *flags, "-x", "c++-header", str(HERE / "engine_bench.h"), "-o", str(out / "engine.pch")])
    return out


def verilator_cmd(src: Path, top: str, mode: str, objdir: Path) -> list[str]:
    files = sorted(str(p) for p in src.glob("*.v")) + sorted(str(p) for p in src.glob("*.sv"))
    cmd = [
        "verilator", "--cc", "--prefix", "Vtop", "--top-module", top, "-Mdir", str(objdir),
        "--x-assign", "0", "--x-initial", "0", "--no-timing",
        "-Wall", "-Wno-fatal", "--error-limit", "30",
        "-O3", "--compiler", "clang",
    ]  # fmt: skip
    if mode == "all":
        cmd.append("--public-flat-rw")
    return cmd + files


def build_one(
    src: Path, top: str, mode: str, opt: str, target: str, rt: str, pch: bool, jobs: int, lto: bool,
    unity: bool, rtdir: Path, out: Path,
) -> dict:  # fmt: skip
    src, rtdir, out = src.resolve(), rtdir.resolve(), out.resolve()
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)
    objdir = out / "obj"
    cxx = compiler(target)
    flags = cflags(target, opt, lto) + [f"-I{objdir}"]
    rtlib = rtdir / rt_key(target, opt, lto)
    timings: dict[str, float] = {}
    t_start = time.perf_counter()

    t = time.perf_counter()
    vl_out = run(verilator_cmd(src, top, mode, objdir))
    timings["verilatorMs"] = (time.perf_counter() - t) * 1000

    t = time.perf_counter()
    shim = out / "shim.cpp"
    shim.write_text(run([sys.executable, str(HERE / "mkshim.py"), str(objdir / "Vtop.h"), "--shim"]))
    classes = (objdir / "Vtop_classes.mk").read_text()
    needed = sorted(set(re.findall(r"^\s+(verilated\w*)\s*\\?$", classes, re.M)))
    missing = [n for n in needed if n not in RT_VERILATOR]
    if missing:
        raise SystemExit(f"модель требует служебные файлы вне библиотеки: {missing}")
    timings["shimMs"] = (time.perf_counter() - t) * 1000

    t = time.perf_counter()
    model_sources = sorted(objdir.glob("*.cpp")) + [shim]
    if unity:
        unit = out / "unity.cpp"
        unit.write_text("".join(f'#include "{s}"\n' for s in model_sources))
        model_sources = [unit]
    sources = model_sources + (rt_sources(target, needed) if rt == "source" else [])
    cf = (["-include-pch", str(rtlib / "engine.pch")] if pch else []) + flags
    objs = compile_all(cxx, cf, sources, out / "o", jobs)
    timings["compileMs"] = (time.perf_counter() - t) * 1000

    t = time.perf_counter()
    link_in = [*map(str, objs)] + ([str(rtlib / "librt.a")] if rt == "lib" else [])
    lflags = [f"-{opt}"] + (["-flto"] if lto else [])
    if target == "wasm":
        run([cxx, *link_in, "-o", str(out / "bench.mjs"), *lflags, *WASM_LINK])
        size = (out / "bench.wasm").stat().st_size
    else:
        run([cxx, *link_in, "-o", str(out / "bench"), *lflags, "-pthread", "-latomic"])
        size = (out / "bench").stat().st_size
    timings["linkMs"] = (time.perf_counter() - t) * 1000
    timings["totalMs"] = (time.perf_counter() - t_start) * 1000

    warnings = sorted(set(re.findall(r"%Warning-(\w+)", vl_out)))
    return {
        "mode": mode, "opt": opt, "target": target, "rt": rt, "pch": pch, "jobs": jobs, "lto": lto,
        "unity": unity, **{k: round(v, 1) for k, v in timings.items()},
        "modelFiles": len(list(objdir.glob("*.cpp"))), "runtimeFiles": needed, "outputBytes": size,
        "verilatorWarnings": warnings,
    }  # fmt: skip


def variant_name(mode: str, opt: str, lto: bool) -> str:
    return f"{mode}-{opt}{'-lto' if lto else ''}"


def cmd_matrix(args: argparse.Namespace) -> None:
    out_root = Path(args.out)
    rtdir = out_root / "rt"
    manifest = []
    for target in args.targets.split(","):
        combos = [(m, o, False) for m in MODES for o in OPTS]
        if target == "wasm":
            combos += [(m, o, True) for m in MODES for o in ("O2", "O3")]
        for mode, opt, lto in combos:
            prep(target, opt, lto, rtdir)
            name = variant_name(mode, opt, lto)
            info = build_one(
                Path(args.src), "top", mode, opt, target, "lib", False, os.cpu_count() or 2, lto, False,
                rtdir, out_root / target / name,
            )  # fmt: skip
            print(f"{target}/{name}: {info['totalMs']:.0f} мс, {info['outputBytes']} байт", flush=True)
            if target == "wasm":
                manifest.append({"name": name, "mode": mode, "opt": opt, "lto": lto, "wasmBytes": info["outputBytes"]})
        if target == "wasm":
            (out_root / "wasm" / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


def tool_versions() -> dict:
    return {
        "verilator": run(["verilator", "--version"]).strip(),
        "emscripten": run(["em++", "--version"]).splitlines()[0].strip(),
        "clang": run(["clang++", "--version"]).splitlines()[0].strip(),
        "node": run(["node", "--version"]).strip(),
    }


def cpu_model() -> str:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.lower().startswith(("model name", "hardware")):
                return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return platform.processor() or platform.machine()


def cmd_speed(args: argparse.Namespace) -> None:
    out_root = Path(args.out)
    results = []
    for mode in MODES:
        for opt in OPTS:
            exe = out_root / "native" / variant_name(mode, opt, False) / "bench"
            lines = run([str(exe), str(HALF_STEPS), str(args.runs + 1)]).strip().splitlines()
            runs = [json.loads(line) for line in lines]
            for r in runs:
                if r["toggles"]["led"] != EXPECT_LED or r["halfSteps"] != HALF_STEPS:
                    raise SystemExit(f"{mode}-{opt}: неверные переключения {r['toggles']}")
            mcps = sorted(r["mcps"] for r in runs[1:])  # first run is a warm-up
            entry = {
                "env": f"native-{args.host}", "mode": mode, "opt": opt, "lto": False,
                "mcps": [r["mcps"] for r in runs[1:]], "median": mcps[len(mcps) // 2], "best": mcps[-1],
                "toggles": runs[-1]["toggles"]["led"], "ok": True,
                "signals": [{k: s[k] for k in ("path", "width", "depth", "param") if k in s} | (
                    {"value": s["value"]} if "value" in s else {}) for s in runs[-1]["signals"]],
            }  # fmt: skip
            results.append(entry)
            print(f"native {mode}-{opt}: медиана {entry['median']:.1f} млн тактов/с", flush=True)
    doc = {
        "host": args.host, "arch": platform.machine(), "cpu": cpu_model(), "cpus": os.cpu_count(),
        "versions": tool_versions(), "halfSteps": HALF_STEPS, "results": results,
    }  # fmt: skip
    (out_root / f"speed-native-{args.host}.json").write_text(json.dumps(doc, indent=2, ensure_ascii=False) + "\n")


def cmd_one(args: argparse.Namespace) -> None:
    info = build_one(
        Path(args.src), args.top, args.mode, args.opt, args.target, args.rt, args.pch, args.jobs, args.lto,
        args.unity, Path(args.rtdir), Path(args.out),
    )  # fmt: skip
    print(json.dumps(info, ensure_ascii=False), flush=True)


def cmd_prep(args: argparse.Namespace) -> None:
    for target in args.targets.split(","):
        for opt in OPTS:
            for lto in (False, True) if target == "wasm" else (False,):
                prep(target, opt, lto, Path(args.rtdir))
                print(f"готово: {rt_key(target, opt, lto)}", flush=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("prep")
    p.add_argument("--targets", default="wasm")
    p.add_argument("--rtdir", required=True)
    p.set_defaults(fn=cmd_prep)

    p = sub.add_parser("one")
    p.add_argument("--src", required=True)
    p.add_argument("--top", default="top")
    p.add_argument("--mode", choices=MODES, default="all")
    p.add_argument("--opt", choices=OPTS, default="O2")
    p.add_argument("--target", choices=["native", "wasm"], default="wasm")
    p.add_argument("--rt", choices=["source", "lib"], default="lib")
    p.add_argument("--pch", action="store_true")
    p.add_argument("--jobs", type=int, default=1)
    p.add_argument("--lto", action="store_true")
    p.add_argument("--unity", action="store_true")
    p.add_argument("--rtdir", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_one)

    p = sub.add_parser("matrix")
    p.add_argument("--src", required=True)
    p.add_argument("--targets", default="native,wasm")
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_matrix)

    p = sub.add_parser("speed")
    p.add_argument("--host", required=True)
    p.add_argument("--runs", type=int, default=5)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_speed)

    args = ap.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
