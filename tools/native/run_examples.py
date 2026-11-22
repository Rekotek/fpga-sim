#!/usr/bin/env python3
"""Run the examples in a native build. Runs inside the build image.

For each example in examples/ that has an expect.json file:
  1. Verilator with the flags of spec section 7.4, in modes all and ports;
  2. the shim tools/mkshim.py;
  3. compile the model and link it with libfpgasim_rt.a and the launcher
     (core/src/native/example_main.cpp);
  4. the configure message from the board file and .cst, as the interface composes it;
  5. run and compare with expect.json (spec section 11.2).

Extra expectations for the same example live in core/tests/expect/<example>.<name>.json.
Engine check designs (not examples for the user) live in core/tests/designs/: their
expect.json has two more fields, "cycle" (clock cycle at the end of the run) and "engine": observation
and recording on a real model after reset.

Parsing .cst and composing configure are simplified here: the server and the interface
do the real work. The script stays a core check without a server and a browser.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VL_INC = Path("/opt/verilator/include")
MODES = ["all", "ports"]
CXXFLAGS = [
    "-std=c++20", "-O2", "-fbracket-depth=4096", "-w", "-include", "cstdint",
    "-DVM_COVERAGE=0", "-DVM_SC=0", "-DVM_TIMING=0", "-DVM_TRACE=0",
    "-DVM_TRACE_FST=0", "-DVM_TRACE_VCD=0", "-DVM_TRACE_SAIF=0",
    f"-I{VL_INC}", f"-I{VL_INC}/vltstd", f"-I{ROOT / 'core' / 'include'}",
]  # fmt: skip
WARNING_RE = re.compile(r"^%(?:Warning|Error)-([A-Z0-9_]+):", re.M)
LOC_RE = re.compile(r'^\s*IO_LOC\s+"?([^"\s;]+)"?\s+(\d+)', re.I)
PORT_RE = re.compile(r'^\s*IO_PORT\s+"?([^"\s;]+)"?\s+(.*?);', re.I)
BIT_RE = re.compile(r"^(.+)\[(\d+)\]$")


class Failure(Exception):
    pass


def run(cmd: list[str], cwd: Path | None = None) -> str:
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if res.returncode != 0:
        raise Failure(
            f"команда завершилась с кодом {res.returncode}: {' '.join(map(str, cmd))}\n{res.stdout}{res.stderr}"
        )
    return res.stdout + res.stderr


def parse_cst(text: str) -> dict[str, dict[str, object]]:
    """Port bit -> {"pin", "pull"}. Only IO_LOC and PULL_MODE from IO_PORT (spec section 2.6)."""
    binding: dict[str, dict[str, object]] = {}
    for raw in text.splitlines():
        line = re.split(r"//|#", raw, maxsplit=1)[0]
        if m := LOC_RE.match(line):
            binding.setdefault(m.group(1), {"pull": "none"})["pin"] = int(m.group(2))
        elif m := PORT_RE.match(line):
            pull = re.search(r"PULL_MODE\s*=\s*(\w+)", m.group(2), re.I)
            mode = pull.group(1).lower() if pull else "none"
            binding.setdefault(m.group(1), {})["pull"] = mode if mode in ("up", "down") else "none"
    return {name: b for name, b in binding.items() if "pin" in b}


def make_configure(
    board: dict, binding: dict[str, dict[str, object]], ports: list[dict], part_types: list[str], config: dict
) -> dict:
    """The configure message per spec section 4.4: nets of the bound ports, built-in board parts
    with the changes from boardParts and breadboard parts from parts (fpgasim.json)."""
    by_name = {p["name"]: p for p in ports}
    nets: list[dict] = []
    pins: set[int] = set()
    for name, b in sorted(binding.items(), key=lambda kv: kv[1]["pin"]):
        m = BIT_RE.match(name)
        port, bit = (m.group(1), int(m.group(2))) if m else (name, 0)
        if port not in by_name:
            raise Failure(f".cst: порта {port} нет у верхнего модуля")
        nets.append({"pin": b["pin"], "port": port, "bit": bit, "pull": b["pull"]})
        pins.add(int(b["pin"]))
    changes = config.get("boardParts", {})
    parts = [
        {
            "id": p["id"],
            "type": p["type"],
            "pins": p["pins"],
            "settings": {**p.get("settings", {}), **changes.get(p["id"], {}).get("settings", {})},
        }
        for p in board["parts"]
        if changes.get(p["id"], {}).get("enabled", True)
    ]
    parts += [
        {"id": p["id"], "type": p["type"], "pins": p["pins"], "settings": p.get("settings", {})}
        for p in config.get("parts", [])
    ]
    # Parts whose type the core does not have do not go into configure.
    parts = [p for p in parts if p["type"] in part_types]
    for part in parts:
        for pin in part["pins"].values():
            if pin not in pins:
                nets.append({"pin": pin, "pull": "none"})
                pins.add(pin)
    clock = None
    for src in board["clocks"]:
        for net in nets:
            port = by_name.get(net.get("port", ""))
            if net["pin"] == src["pin"] and port and port["dir"] == "In" and clock is None:
                clock = {"port": net["port"], "hz": src["hz"]}
    return {"board": board["id"], "clock": clock, "nets": nets, "parts": parts, "watch": []}


def build(example: Path, mode: str, out: Path, libs: Path, jobs: int) -> tuple[Path, list[dict], str]:
    """Build the example and return the program, the port list and the Verilator output."""
    obj = out / "obj"
    shutil.rmtree(out, ignore_errors=True)
    obj.mkdir(parents=True)
    sources = sorted(str(p) for p in example.glob("*.v")) + sorted(str(p) for p in example.glob("*.sv"))
    verilator = [
        "verilator", "--cc", "--prefix", "Vtop", "--top-module", "top", "-Mdir", str(obj),
        "--x-assign", "0", "--x-initial", "0", "--no-timing",
        "-Wall", "-Wno-fatal", "--error-limit", "30", "-O3", "--compiler", "clang",
    ]  # fmt: skip
    if mode == "all":
        verilator.append("--public-flat-rw")
    log = run([*verilator, f"-I{example}", *sources])
    mkshim = [sys.executable, str(ROOT / "tools" / "mkshim.py"), str(obj / "Vtop.h"), "--top", "top"]
    ports = json.loads(run([*mkshim, "--json"]))
    (out / "shim.cpp").write_text(run([*mkshim, "--shim"]), encoding="utf-8")

    units = [*sorted(obj.glob("*.cpp")), out / "shim.cpp"]

    def compile_one(src: Path) -> Path:
        target = out / (src.stem + ".o")
        run(["clang++", *CXXFLAGS, f"-I{obj}", "-c", str(src), "-o", str(target)])
        return target

    with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as pool:
        objects = list(pool.map(compile_one, units))
    sim = out / "sim"
    run([
        "clang++", "-O2", *map(str, objects),
        str(libs / "libfpgasim_example_main.a"), str(libs / "libfpgasim_rt.a"), str(libs / "libfpgasim_verilated.a"),
        "-lpthread", "-latomic", "-o", str(sim),  # libatomic is needed by the Verilator support files on arm64
    ])  # fmt: skip
    return sim, ports, log


def sim_result(sim: Path, scenario: Path) -> dict:
    """Launcher result: a line with a label; the model may print to standard output itself."""
    for line in reversed(run([str(sim), str(scenario)]).splitlines()):
        if line.startswith("FPGASIM_RESULT "):
            return json.loads(line.removeprefix("FPGASIM_RESULT "))
    raise Failure(f"{sim}: в выводе нет итога")


def half_start(hz: int, half: int) -> int:
    return half * 10**12 // (2 * hz)


def check_engine(spec: dict, got: dict, hz: int) -> list[str]:
    """Observation and recording on a real model: values, number and moments of changes."""
    problems: list[str] = []
    if got.get("cycle") != spec["cycles"]:
        problems.append(f"движок: после шага такт {got.get('cycle')}, ожидался {spec['cycles']}")
    if got.get("watch") != spec["watchWords"]:
        problems.append(f"движок: наблюдение {got.get('watch')}, ожидалось {spec['watchWords']}")
    for index, want in enumerate(spec.get("traces", [])):
        changes = [c for c in got.get("trace", []) if c["index"] == index]
        if not changes:
            problems.append(f"движок: в записи нет сигнала {index}")
            continue
        start, rest = changes[0], changes[1:]
        if len(rest) != want["count"]:
            problems.append(f"движок: у сигнала {index} изменений {len(rest)}, ожидалось {want['count']}")
            continue
        if any(c["words"] == p["words"] for p, c in zip(changes, rest, strict=False)):
            problems.append(f"движок: у сигнала {index} записано изменение без смены значения")
        if want["kind"] == "clock":
            # The clock changes on every half cycle: one on even, zero on odd, time by formula.
            for k, c in enumerate(rest):
                if c["words"] != [1 - k % 2] or int(c["t"]) != half_start(hz, k):
                    problems.append(f"движок: полутакт {k} записан как {c}")
                    break
        elif want["kind"] == "counter":
            # The counter grows by one on every rising edge.
            for k, c in enumerate(rest):
                if c["words"] != [start["words"][0] + k + 1] or int(c["t"]) != half_start(hz, 2 * k):
                    problems.append(f"движок: такт {k + 1} записан как {c}")
                    break
    return problems


def matches(want: object, got: object) -> bool:
    """Value from the event data: a number means exact, {"min", "max"} means bounds."""
    if isinstance(want, dict):
        if not isinstance(got, int | float):
            return False
        return want.get("min", got) <= got <= want.get("max", got)
    return want == got


def check_parts(expect: dict, parts: dict) -> list[str]:
    """Expectations for parts (spec section 11.2): terminal text and bytes, colors and error counter
    of WS2812, events. The part state is the bytes from the frame (spec section 6)."""
    problems: list[str] = []
    for part_id, want in expect.items():
        got = parts.get(part_id)
        if got is None:
            problems.append(f"деталь {part_id}: её нет в configure")
            continue
        data = bytes(got["data"])
        state = bytes(got["state"])
        text = data.decode("latin-1")
        if "text" in want and text != want["text"]:
            problems.append(f"деталь {part_id}: терминал получил {text!r}, ожидалось {want['text']!r}")
        if "bytes" in want and list(data) != want["bytes"]:
            problems.append(f"деталь {part_id}: получено байтов {len(data)}, ожидалось {len(want['bytes'])} других")
        if "colors" in want or "errors" in want:
            if got["type"] != "ws2812" or len(state) < 8:
                problems.append(f"деталь {part_id}: состояния WS2812 нет")
                continue
            colors = [f"#{state[i : i + 3].hex()}" for i in range(8, len(state), 3)]
            errors = int.from_bytes(state[4:8], "little")
            if "colors" in want and colors != want["colors"]:
                problems.append(f"деталь {part_id}: цвета {colors}, ожидались {want['colors']}")
            if "errors" in want and errors != want["errors"]:
                problems.append(f"деталь {part_id}: ошибок длительности {errors}, ожидалось {want['errors']}")
        wanted = [{"event": e} if isinstance(e, str) else e for e in want.get("events", [])]
        got_names = sorted({e["event"] for e in got["events"]})
        want_names = sorted({e["event"] for e in wanted})
        if got_names != want_names:
            problems.append(f"деталь {part_id}: события {got_names}, ожидались {want_names}")
            continue
        for item in wanted:
            fields = item.get("data", {})
            if not any(
                e["event"] == item["event"] and all(matches(v, e["data"].get(k)) for k, v in fields.items())
                for e in got["events"]
            ):
                problems.append(f"деталь {part_id}: нет события {item['event']} с данными {fields}")
    return problems


def check(expect: dict, result: dict, log: str) -> list[str]:
    """Compare the run result with expect.json. Returns the list of mismatches."""
    problems: list[str] = []
    if expect.get("build", {}).get("status", "ok") != "ok":
        problems.append("ожидание сборки с ошибкой в обычной сборке не поддерживается")
    found = set(WARNING_RE.findall(log))
    for code in expect.get("build", {}).get("codes", []):
        if code not in found:
            problems.append(f"сборка: нет сообщения {code}")
    for pin, want in expect.get("nets", {}).items():
        got = result["nets"].get(pin)
        if got is None:
            problems.append(f"вывод {pin}: сети нет в configure")
            continue
        if "toggles" in want and got["toggles"] != want["toggles"]:
            problems.append(f"вывод {pin}: переключений {got['toggles']}, ожидалось {want['toggles']}")
        if "togglesMin" in want and got["toggles"] < want["togglesMin"]:
            problems.append(f"вывод {pin}: переключений {got['toggles']}, ожидалось не меньше {want['togglesMin']}")
        if "level" in want and got["level"] != want["level"]:
            problems.append(f"вывод {pin}: уровень {got['level']}, ожидался {want['level']}")
        if "dutyMin" in want and got["duty"] < want["dutyMin"]:
            problems.append(f"вывод {pin}: доля в единице {got['duty']:.6f} меньше {want['dutyMin']}")
        if "dutyMax" in want and got["duty"] > want["dutyMax"]:
            problems.append(f"вывод {pin}: доля в единице {got['duty']:.6f} больше {want['dutyMax']}")
    problems += check_parts(expect.get("parts", {}), result["parts"])
    want_notices = sorted(set(expect.get("notices", [])))
    got_notices = sorted(set(result["notices"]))
    if want_notices != got_notices:
        problems.append(f"замечания {got_notices}, ожидались {want_notices}")
    if "cycle" in expect and result["cycle"] != expect["cycle"]:
        problems.append(f"номер такта {result['cycle']}, ожидался {expect['cycle']}")
    # A model that called $finish stops before the given time.
    if "MODEL_FINISH" not in got_notices and result["timePs"] != expect["run"]["ps"]:
        problems.append(f"время симуляции {result['timePs']} пс, ожидалось {expect['run']['ps']}")
    return problems


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--libs", type=Path, default=ROOT / "core" / "build", help="каталог с библиотеками ядра")
    ap.add_argument("--out", type=Path, default=ROOT / "core" / "build" / "examples")
    ap.add_argument("--jobs", type=int, default=4)
    ap.add_argument("names", nargs="*", help="имена примеров; по умолчанию все")
    args = ap.parse_args()

    examples = sorted(
        p.parent
        for base in (ROOT / "examples", ROOT / "core" / "tests" / "designs")
        for p in base.glob("*/expect.json")
        if (p.parent / "top.v").exists()
    )
    if args.names:
        examples = [e for e in examples if e.name in args.names]
    failed = 0
    runs = 0
    for example in examples:
        expects = [
            example / "expect.json",
            *sorted((ROOT / "core" / "tests" / "expect").glob(f"{example.name}.*.json")),
        ]
        for mode in MODES:
            out = args.out / f"{example.name}-{mode}"
            try:
                sim, ports, log = build(example, mode, out, args.libs, args.jobs)
                (out / "ready.json").write_text(json.dumps({"readyOnly": True, "configure": {}}), encoding="utf-8")
                ready = sim_result(sim, out / "ready.json")["ready"]
                csts = sorted(example.glob("*.cst"))
                binding = parse_cst(csts[0].read_text(encoding="utf-8")) if csts else {}
                config_path = example / "fpgasim.json"
                config = json.loads(config_path.read_text(encoding="utf-8")) if config_path.exists() else {}
                board_path = ROOT / "boards" / f"{config.get('board', 'tang-nano-20k')}.json"
                board = json.loads(board_path.read_text(encoding="utf-8"))
                configure = make_configure(board, binding, ports, ready["partTypes"], config)
                for expect_path in expects:
                    expect = json.loads(expect_path.read_text(encoding="utf-8"))
                    scenario = {
                        "configure": configure,
                        "runPs": expect["run"]["ps"],
                        "actions": expect.get("actions", []),
                    }
                    # Internal signals exist only in mode all.
                    if "engine" in expect and mode == "all":
                        scenario["engine"] = expect["engine"]
                    scenario_path = out / f"{expect_path.stem}.scenario.json"
                    scenario_path.write_text(json.dumps(scenario, ensure_ascii=False, indent=1), encoding="utf-8")
                    result = sim_result(sim, scenario_path)
                    (out / f"{expect_path.stem}.result.json").write_text(
                        json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8"
                    )
                    problems = check(expect, result, log)
                    if "engine" in scenario:
                        problems += check_engine(expect["engine"], result["engine"], configure["clock"]["hz"])
                    # In mode ports the signal list holds only ports (spec section 4.5).
                    kinds = {s["kind"] for s in result["signals"]}
                    if mode == "ports" and kinds != {"port"}:
                        problems.append(f"режим ports: в списке сигналов есть не только порты: {sorted(kinds)}")
                    if mode == "all" and len(result["signals"]) <= len(ports) and example.name == "blink3":
                        problems.append("режим all: внутренних сигналов нет")
                    runs += 1
                    label = f"{example.name} [{mode}] {expect_path.name}"
                    if problems:
                        failed += 1
                        print(f"СБОЙ  {label}")
                        for p in problems:
                            print(f"      {p}")
                    else:
                        cycles = result["cycle"]
                        speed = f", {cycles / result['realMs'] / 1000:.1f} млн тактов/с" if cycles else ""
                        print(f"ок    {label}: {result['realMs']:.0f} мс{speed}")
            except Failure as e:
                failed += 1
                runs += 1
                print(f"СБОЙ  {example.name} [{mode}]\n{e}")
    print(f"примеры: прогонов {runs}, сбоев {failed}")
    return 1 if failed or runs == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
