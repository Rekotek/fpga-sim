# Stage 0: speed and build time measurement

Date: 2026-11-18. Example: `examples/blink3`. Raw data: `bench/results.json`.
The tables below were generated from it with `node tools/bench/tables.mjs`.

This is a snapshot at the day the stage closed. The current decisions are in `docs/decisions.md`;
if they differ from the report, the decisions are correct.

## 1. Conclusion by the rule

| Stage criterion | Threshold | Result | Conclusion |
|---|---|---|---|
| Speed in Chrome on the Mac in the chosen mode (`all`, `-O2`) | at least 27 million clock cycles/s: continue; 8.1–27: continue with a note; below 8.1: stop | 39.2 million clock cycles/s, 1.45× real time. The Mac was running on battery in low power mode; on mains power about 54 (2.0×), see section 2 | **Work continues** |
| Cold build of `blink3` on the VPS with the prebuilt library | up to 15 s: accepted; 15–30 s: accepted with a note; over 30 s: stop | 4.3 s, worst run 4.5 s (with the library only, without the prebuilt header: 13.9 s) | **Accepted** |
| 4, 8 and 16 toggles in 2.1 s in every run | exact match | matched in all 160 measured runs and 32 warm-up runs across the four environments | **Met** |
| `make bench` creates `bench/results.json` with all combinations | — | passes with one command, exit code 0 | **Met** |

The main finding of the stage: the result depends on the Verilator version. With release 5.054,
the closest to the author's version, Chrome gives 16.6 million clock cycles/s (0.61×). With
release 5.050 it gives 39.2 (1.45×). 5.050 is chosen; the reason and the conditions for
reconsidering are in section 5 and in `docs/decisions.md`, item 1.

## 2. What was measured and how

- **Design.** `examples/blink3`: three 25-bit counters on a 27 MHz clock.
- **Run.** 2.1 s of simulation time: 56.7 million clock cycles, 113.4 million half-cycles. The
  model is created anew, and the clock runs in batches of 40,000 half-cycles (spec section 5.3).
  The loop inside a batch is verbatim from section 7.2. After each run, the toggle counts of
  `led[0]`, `led[1]`, `led[2]` are compared with 4, 8 and 16; a mismatch stops the measurement.
- **Speed.** One warm-up run and five measured runs per combination; the tables show the median.
  The unit is millions of clock cycles per second; 27 matches the board's real time.
- **Environments.** Native code on the VPS and on the Mac; WebAssembly in Node 26.13.1 (V8 14.6)
  and in Chrome 157.0.8103.79 on the Mac. In Chrome the core runs in a Web Worker, as in the
  application; Playwright launches the browser (installed Chrome, no window).
- **Machines.** Mac: Apple M2 Max, 12 cores. VPS: AMD EPYC-Rome, 4 virtual cores, 7.6 GB;
  the stolen-time share (`st` in `vmstat`) before and after the measurement was 0%.
- **Tools.** Verilator 5.050, Emscripten 7.0.0, clang 18.1.3 (Ubuntu 24.04), image
  `fpgasim-build:vl5.050-em7.0.0`. The Verilator flags are spec section 7.4, unchanged.
- **Build time.** Each measurement uses a new container with the job limits from section 8.1
  (`--cpus 2 --memory 2g --read-only --network none --user 10001`). Three runs per variant;
  the table shows the median and the worst. "With container" includes container start and stop.

**Mac power mode.** All Mac measurements in the tables ran on battery: on this Mac, low power
mode is on when running on battery (`pmset`: `lowpowermode 1` on battery, `0` on mains power), and
it lowers the processor frequency. The mode at the start and end of each measurement is recorded
in `bench/results.json` (field `machines.mac.power`); it is the same in all three measurements.
On mains power, the same Chrome on the same cores is 37% faster: a manual check of the page
`bench.html` at 13:51–13:54 (according to the `pmset -g log` log, the Mac ran on mains power at
that time) showed:

| | all, -O1 | all, -O2 | all, -O3 | ports, -O1 | ports, -O2 | ports, -O3 |
|---|---:|---:|---:|---:|---:|---:|
| Chrome on mains power, million clock cycles/s | 42.1 | 54.2 | 52.3 | 55.8 | 71.0 | 72.5 |
| Ratio to real time | 1.56× | 2.01× | 1.94× | 2.07× | 2.63× | 2.68× |

This is one run of the page; it is not part of `bench/results.json`. The stage's official number is
the smaller one (on battery). The comparison of Verilator releases in section 5 was also made on
battery, that is, under equal conditions.

**Native code on the Mac.** By the rules, Verilator is not installed on the Mac, so the program
was built and run in a linux/arm64 container (Docker Desktop, no processor emulation). The number
is for reference.

## 3. Measurements

### Speed, million clock cycles per second (median of five runs)

| Environment | all, -O1 | all, -O2 | all, -O3 | ports, -O1 | ports, -O2 | ports, -O3 |
|---|---:|---:|---:|---:|---:|---:|
| Native code, VPS | 16.5 | 15.7 | 15.6 | 22.3 | 21.4 | 22.1 |
| Native code, Mac (linux/arm64 container) | 22.7 | 24.9 | 24.8 | 25.4 | 28.0 | 26.1 |
| WebAssembly, Node on the Mac | 31.2 | 40.9 | 40.2 | 40.1 | 53.2 | 52.4 |
| WebAssembly, Chrome on the Mac | 30.2 | 39.2 | 37.7 | 38.9 | 52.5 | 52.3 |

### Ratio to real time in Chrome (27 million clock cycles per second = 1×)

| all, -O1 | all, -O2 | all, -O3 | ports, -O1 | ports, -O2 | ports, -O3 |
|---:|---:|---:|---:|---:|---:|
| 1.12× | 1.45× | 1.40× | 1.44× | 1.95× | 1.94× |

### Link-time optimization (LTO), million clock cycles per second

| Environment | all, -O2 | all, -O2 LTO | all, -O3 LTO | ports, -O2 | ports, -O2 LTO | ports, -O3 LTO |
|---|---:|---:|---:|---:|---:|---:|
| WebAssembly, Node on the Mac | 40.9 | 40.5 | 37.5 | 53.2 | 52.7 | 53.2 |
| WebAssembly, Chrome on the Mac | 39.2 | 38.5 | 38.5 | 52.5 | 51.7 | 50.9 |

### Size of the bench `sim.wasm`, KB

| all, -O1 | all, -O2 | all, -O3 | ports, -O1 | ports, -O2 | ports, -O3 | all, -O2 LTO | all, -O3 LTO |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 228 | 167 | 142 | 221 | 162 | 137 | 162 | 83 |

### For comparison: vl5.054-em7.0.0, million clock cycles per second

| Environment | all, -O1 | all, -O2 | all, -O3 | ports, -O1 | ports, -O2 | ports, -O3 |
|---|---:|---:|---:|---:|---:|---:|
| Native code, Mac (linux/arm64 container) | 13.2 | 14.7 | 14.6 | 16.8 | 17.0 | 16.4 |
| WebAssembly, Node on the Mac | 18.6 | 17.6 | 18.3 | 21.3 | 20.3 | 20.3 |
| WebAssembly, Chrome on the Mac | 17.1 | 16.6 | 16.6 | 19.5 | 18.6 | 19.2 |

### Build time of blink3 on the VPS, seconds (median of 3 runs)

| Variant | Mode | Level | Verilator | Wrapper | Compilation | Linking | Total | With container | Worst |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|
| Support files compiled every time | all | -O1 | 0.08 | 0.05 | 24.24 | 0.81 | 25.16 | 25.46 | 26.14 |
| Support files compiled every time | all | -O2 | 0.08 | 0.05 | 24.45 | 1.85 | 26.42 | 26.69 | 27.77 |
| Support files compiled every time | all | -O3 | 0.09 | 0.05 | 25.04 | 2.68 | 27.79 | 28.08 | 29.20 |
| Support files compiled every time | ports | -O1 | 0.09 | 0.06 | 20.49 | 0.80 | 21.50 | 21.78 | 22.06 |
| Support files compiled every time | ports | -O2 | 0.08 | 0.05 | 20.37 | 1.79 | 22.30 | 22.72 | 23.66 |
| Support files compiled every time | ports | -O3 | 0.09 | 0.05 | 21.62 | 2.67 | 24.43 | 24.72 | 24.77 |
| Prebuilt library | all | -O1 | 0.08 | 0.06 | 12.05 | 0.82 | 12.99 | 13.28 | 13.32 |
| Prebuilt library | all | -O2 | 0.08 | 0.06 | 11.67 | 1.83 | 13.61 | 13.91 | 14.24 |
| Prebuilt library | all | -O3 | 0.08 | 0.05 | 11.56 | 2.67 | 14.36 | 14.64 | 15.13 |
| Prebuilt library | ports | -O1 | 0.07 | 0.05 | 10.13 | 0.86 | 11.12 | 11.45 | 11.57 |
| Prebuilt library | ports | -O2 | 0.08 | 0.05 | 10.33 | 1.85 | 12.25 | 12.56 | 13.30 |
| Prebuilt library | ports | -O3 | 0.07 | 0.05 | 10.14 | 2.71 | 12.88 | 13.16 | 13.35 |
| Library and prebuilt header | all | -O1 | 0.08 | 0.05 | 2.94 | 0.79 | 3.86 | 4.17 | 4.19 |
| Library and prebuilt header | all | -O2 | 0.08 | 0.05 | 2.93 | 1.77 | 4.82 | 5.10 | 5.45 |
| Library and prebuilt header | all | -O3 | 0.07 | 0.05 | 2.92 | 2.67 | 5.72 | 6.00 | 6.25 |
| Library and prebuilt header | ports | -O1 | 0.08 | 0.06 | 2.58 | 0.80 | 3.63 | 3.94 | 4.10 |
| Library and prebuilt header | ports | -O2 | 0.08 | 0.05 | 2.66 | 1.75 | 4.54 | 4.84 | 5.22 |
| Library and prebuilt header | ports | -O3 | 0.08 | 0.05 | 2.52 | 2.56 | 5.21 | 5.49 | 5.71 |
| Library, two compile processes | all | -O2 | 0.08 | 0.05 | 7.02 | 1.88 | 9.02 | 9.31 | 9.65 |
| Library, two compile processes | ports | -O2 | 0.07 | 0.05 | 5.42 | 1.80 | 7.33 | 7.64 | 7.85 |
| Library, header, two processes | all | -O2 | 0.08 | 0.05 | 2.13 | 1.77 | 4.04 | 4.34 | 4.48 |
| Library, header, two processes | ports | -O2 | 0.07 | 0.05 | 1.61 | 1.83 | 3.58 | 3.87 | 3.94 |
| Library, one translation unit | all | -O2 | 0.08 | 0.05 | 2.06 | 1.87 | 4.09 | 4.39 | 4.40 |
| Library, one translation unit | ports | -O2 | 0.07 | 0.05 | 2.02 | 1.76 | 3.90 | 4.17 | 4.31 |
| Library, header, one unit | all | -O2 | 0.08 | 0.05 | 0.79 | 1.85 | 2.75 | 3.07 | 3.23 |
| Library, header, one unit | ports | -O2 | 0.08 | 0.05 | 0.70 | 1.77 | 2.58 | 2.89 | 3.08 |
| Library, LTO, two processes | all | -O2 | 0.08 | 0.05 | 7.15 | 6.39 | 13.64 | 13.94 | 14.05 |
| Library, LTO, two processes | ports | -O2 | 0.07 | 0.05 | 5.23 | 5.98 | 11.33 | 11.77 | 11.87 |

Empty container (start and stop): 0.23 s.

## 4. What the numbers show

1. **WebAssembly is faster than native code.** The expectation was 50–70% of native speed
   (risk 1 of the vision document). In practice, Chrome gives 39.2 million clock cycles/s against
   25 for native code on the same Mac and 15.7 on the VPS. Probable cause: in the native build, the
   Verilator support library takes mutexes on every `eval()`, while in the single-threaded
   Emscripten build they are empty. This is a guess from the library code; I did not verify it
   with a profiler. It does not affect the stage's decisions.
2. **Optimization level.** `-O2` and `-O3` are equal within the spread; `-O1` in Chrome is
   23% slower in `all` mode and 26% slower in `ports` mode. `-O2` is chosen.
3. **LTO** gives no speed and lengthens linking from 1.8 to 6.4 s. It is not used.
4. **The `all` mode** costs 25% of speed against `ports`, but stays faster than real time
   (1.45×). It stays the default.
5. **Build time** goes almost entirely to compilation: Verilator runs 0.08 s, creating the
   wrapper takes 0.05 s. The prebuilt library cuts the build from 26.7 to 13.9 s, the prebuilt
   header cuts it to 5.1 s, and two compile processes cut it to 4.3 s. `-O2` linking takes
   1.8 s and does not shrink further.
6. **The margin against the 15 s rule** is more than threefold. In stage 3, parsing the settings
   and writing to the cache add to this time; they are small compared with compilation.

## 5. Comparison of Verilator releases

Both releases were measured on the Mac on battery, in the same power mode.

| Release | Chrome, `all`, `-O2` | Chrome, `ports`, `-O2` | Ratio to real time (`all`) |
|---|---:|---:|---:|
| 5.050 (chosen) | 39.2 | 52.5 | 1.45× |
| 5.054 | 16.6 | 18.6 | 0.61× |

Since release 5.052, the `eval()` loop is not in the model but in the support library
(`VerilatedEvalLoop::evalImpl` in `verilated.cpp`) and calls the model through virtual functions:
about ten calls per half-cycle. Checked against the release headers: in 5.050 and earlier there is
no `VerilatedEvalLoop` class, and in 5.052 and 5.054 there is. For a design of the size of
`blink3`, these calls are the main work.

The author's version (5.055, built from the development branch after 5.054) is built the same
way. A model created by it and built with the system clang on the Mac gives the same 4, 8 and 16
toggles and 12.5 million clock cycles/s in native code. If the author simulates the same designs
locally with their own Verilator, they get less than half of real time.

By the stage rule, 5.054 would fall in the zone "from 8.1 to 27: continue with a note". Choosing
5.050 moves the result to the zone "at least 27".

## 6. Assumptions of section 15.1

| No. | Assumption | Result |
|---|---|---|
| 1 | WebAssembly speed on `blink3` is at least 1× in Chrome on the Mac | **Confirmed** with Verilator 5.050: 1.45× in `all` mode, 1.95× in `ports`. With 5.054 it would be 0.61× |
| 2 | A cold build takes at most 15 s on the VPS | **Confirmed**: 4.3 s with the library, the prebuilt header and two processes; 13.9 s with the library alone. The header goes into the build right away, not as a fallback path |
| 3 | The port list reads reliably from `Vtop.h` | **Confirmed** on a design with ports of 1, 8, 9, 16, 17, 32, 33, 64, 65 and 128 bits, a reversed and an offset range, a signed port, `inout` and an escaped name. Clarifications: the name is preceded by `&` (`VL_IN8(&clk,0,0)`); the port order in the header does not match the source |
| 4 | Internal signals are listed through scope descriptions with `--public-flat-rw`, without VPI | **Confirmed**: names, width, memory depth and direct pointers; counter values after a run read correctly (2,700,000 for all three). Clarification: the model needs `verilated_dpi.cpp` |
| 5 | The speed loss from `--public-flat-rw` allows keeping `all` as the default | **Confirmed**: loss of 25%, 1.45× remains |
| 6 | The Verilator support files are built into a library in advance and fit any model of the same version | **Confirmed**: one library was linked with `blink3` and with a test design, in both modes, in native code and in WebAssembly (8 builds, all work). Clarifications: Emscripten needs three stubs; the library is built for each optimization level |
| 7 | A stable release behaves on the examples the same as the author's 5.055 | **Behavior confirmed, version replaced.** 5.050, 5.054 and 5.055 give the same toggles and verbatim identical warnings. But the closest release, 5.054, is 2.4 times slower than 5.050. Replacement: 5.050 is pinned. The spec's fallback path (the same build as the author's) does not fit for the same reason |

`tools/bench/check_assumptions.py` runs checks 3, 4 and 6 on every `make bench`; the result is in
`bench/results.json`, field `assumptions`.

## 7. Differences from the spec text found along the way

Formats and protocol are not affected. All items below concern "default" values and command
examples; the decisions are recorded in `docs/decisions.md`.

1. **Section 7.5, compile command.** Extra flags are needed: `-include cstdint` (otherwise `all`
   mode does not compile in Emscripten), `-DVL_IGNORE_UNKNOWN_ARCH` (otherwise the 5.050 support
   files do not compile to WebAssembly), the `VM_*` definitions.
2. **Section 7.5, one `em++` command for all files.** Replaced with separate processes with a
   prebuilt header: 4.3 s instead of 13.9 s.
3. **Section 5.8, library contents.** `verilated_threads.cpp`, `verilated_dpi.cpp` and three
   Emscripten stubs are added to `verilated.cpp`.
4. **Section 8.1, read-only container.** It works only if the Emscripten cache is frozen
   (`EM_FROZEN_CACHE=1`) and built during the image build.
5. **Section 7.6, warning table.** `blink3` from the spec itself produces `PROCASSINIT`
   (`reg x = 0` together with an assignment in `always`). This code is not in the table.
   Proposal for stage 5: add it with the level "hidden"; this is a spec change, and the author
   decides.
6. **Section 10.2.** The VPS has no `make`, and sudo asks for a password. The VPS scripts are
   written in bash; the author created the directories `/opt/fpgasim`, `/etc/fpgasim`,
   `/var/lib/fpgasim`.

## 8. How to repeat

- The whole measurement: `make bench` in the repository root (about 35 minutes, 20 of them on the
  VPS).
- Only a check of the finished results: `make check`.
- **For the author.** In the repository root, run `make bench-serve` and open
  `http://localhost:8377/tools/bench/bench.html` in Chrome, then click "Start measurement". The
  `all-O2` row should show about 39 million clock cycles/s if the Mac runs on battery in low power
  mode, and about 54 on mains power. The page takes the cores from `bench/out/`; this directory is
  not stored in Git and is created by the command `make bench-mac` (Docker Desktop is required).
- Another Verilator release:
  `FPGASIM_VERILATOR=5.054 tools/bench/image.sh 8 && FPGASIM_VERILATOR=5.054 tools/bench/run_mac.sh`.
