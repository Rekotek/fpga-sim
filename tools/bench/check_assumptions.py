#!/usr/bin/env python3
"""Benchmark: check assumptions 3, 4 and 6 of spec section 15.1. Runs inside the image.

3. The port list is read from Vtop.h (checked against the expected list of the check design).
4. Internal signals are listed through scope descriptions without VPI.
6. One pre-built library of support files fits different models.

Usage: check_assumptions.py --out bench/out/<label>
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build  # noqa: E402

HERE = Path(__file__).resolve().parent
VARIETY = HERE / "checks" / "ports_variety"
BLINK = HERE.parent.parent / "examples" / "blink3"

# Name, direction, width: what Vtop.h of the check design must yield.
EXPECT_PORTS = {
    ("clk", "In", 1), ("in8", "In", 8), ("in9_asc", "In", 9), ("in16", "In", 16), ("in33", "In", 33),
    ("in64s", "In", 64), ("in128", "In", 128), ("io1", "InOut", 1), ("out1", "Out", 1),
    ("out8_off", "Out", 8), ("out17", "Out", 17), ("out32", "Out", 32), ("out65", "Out", 65),
    ("bus-a", "Out", 8),
}  # fmt: skip
HALF = 1000  # 500 rising edges


def run_wasm(mjs: Path, half: int) -> dict:
    script = (
        "const m = await (await import(process.argv[1])).default();"
        "console.log(m.UTF8ToString(m._bench_run(Number(process.argv[2]))));"
    )
    out = subprocess.run(
        ["node", "--input-type=module", "-e", script, mjs.resolve().as_uri(), str(half)],
        capture_output=True, text=True, check=True,
    )  # fmt: skip
    return json.loads(out.stdout)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    out_root = Path(args.out).resolve()
    rtdir = out_root / "rt"
    work = out_root / "checks"
    report: dict = {"ports": {}, "signals": {}, "library": []}
    ok = True

    for target in ("native", "wasm"):
        build.prep(target, "O2", False, rtdir)
        for design, src in (("blink3", BLINK), ("ports_variety", VARIETY)):
            for mode in build.MODES:
                out = work / f"{design}-{target}-{mode}"
                info = build.build_one(src, "top", mode, "O2", target, "lib", False, 4, False, False, rtdir, out)
                if target == "native":
                    res = json.loads(subprocess.run([str(out / "bench"), str(HALF)], capture_output=True, text=True,
                                                    check=True).stdout)  # fmt: skip
                else:
                    res = run_wasm(out / "bench.mjs", HALF)
                # Both models must work with the same library.
                if design == "ports_variety":
                    good = res["toggles"]["out32"][0] == HALF // 2 and res["halfSteps"] == HALF
                else:
                    good = res["halfSteps"] == HALF and res["toggles"]["led"] == [0] * 6
                ok &= good
                report["library"].append({
                    "design": design, "target": target, "mode": mode, "ok": good,
                    "runtimeFiles": info["runtimeFiles"], "warnings": info["verilatorWarnings"],
                })  # fmt: skip

                ports = json.loads(subprocess.run(
                    [sys.executable, str(HERE / "mkshim.py"), str(out / "obj" / "Vtop.h"), "--json"],
                    capture_output=True, text=True, check=True).stdout)  # fmt: skip
                if design == "ports_variety":
                    got = {(p["name"], p["dir"], p["width"]) for p in ports}
                    same = got == EXPECT_PORTS
                    ok &= same
                    report["ports"][f"{target}-{mode}"] = {
                        "ok": same, "missing": sorted(map(list, EXPECT_PORTS - got)),
                        "extra": sorted(map(list, got - EXPECT_PORTS)),
                        "order": [p["name"] for p in ports],
                        "ranges": {p["name"]: [p["msb"], p["lsb"]] for p in ports},
                    }  # fmt: skip
                    sigs = {s["path"]: s for s in res["signals"]}
                    if mode == "all":
                        need = {"top.top.cnt": (65, 0), "top.top.u_sub.mem": (8, 16), "top.top.u_sub.wp": (4, 0)}
                        found = {k: (sigs[k]["width"], sigs[k]["depth"]) if k in sigs else None for k in need}
                        same = all(found[k] == v for k, v in need.items())
                        same &= sigs.get("top.top.u_sub.wp", {}).get("value") == str((HALF // 2) % 16)
                        ok &= same
                        report["signals"][f"{target}-all"] = {"ok": same, "count": len(sigs), "paths": sorted(sigs)}
                    else:
                        same = len(sigs) == 0
                        ok &= same
                        report["signals"][f"{target}-ports"] = {"ok": same, "count": len(sigs)}

    report["ok"] = bool(ok)
    (out_root / "assumptions.json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({k: v for k, v in report.items() if k != "library"}, indent=1, ensure_ascii=False))
    print("ИТОГ:", "все проверки прошли" if ok else "ЕСТЬ РАСХОЖДЕНИЯ")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
