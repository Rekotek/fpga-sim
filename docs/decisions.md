# Decisions made along the way

This file records every decision that the spec (`docs/tz-v1.md`) does not contain, with its date and reason.
Do not read the whole file. Before a change, find the decisions on your topic in the table of contents and read them.
A new decision gets the next number, a line in the table of contents, and a dated section.

## Table of contents

Decision number — topic. Find the file section by its number (`### N.`). Numbers 135–139 and 143–149
are not issued: parallel branches held them. The mark "changed" means that the section
starts with a pointer to a later decision.


**2026-11-18. Stage 0: measuring speed and build time**

- 1. Verilator 5.050, not release 5.054, the closest to the author's version
- 2. Emscripten 7.0.0, Ubuntu 24.04
- 3. Optimization level: `-O2` for compiling and linking, no LTO
- 4. Default visibility mode: `all` *(changed)*
- 5. Contents of the prebuilt library
- 6. Project build order: library, prebuilt header, two processes
- 7. The Emscripten cache in the image is frozen (`EM_FROZEN_CACHE=1`)
- 8. The port list is read from `Vtop.h` (assumption 3 confirmed)
- 9. Signals are enumerated without VPI (assumption 4 confirmed)
- 10. "Ordinary code on the Mac" is measured in a linux/arm64 container
- 11. Mac measurements record the power mode
- 12. Scripts for the VPS do not use `make`
- 13. Which Verilator speed-up tips do not apply, and why

**2026-11-18. Stage 1: repository skeleton and formats**

- 14. Format checks: Node and ajv, samples with the place of the expected error
- 15. Unknown fields: `fpgasim.json` skips them, the other formats reject them
- 16. Format clarifications where the spec is silent
- 17. Style: line length 120, tools run through `uvx`
- 18. Two open questions closed on the author's order: `net` and `PROCASSINIT`

**2026-11-18. Stage 2: the core on an ordinary machine**

- 19. CMake, Ninja, nlohmann/json and Catch2 added to the build image
- 20. Scheduler time model
- 21. Engine interface: what is added to section 7.1 and template 7.2
- 22. Protocol: `error` codes and message order
- 23. Nets
- 24. Parts *(changed)*
- 25. Recording is already done in the core at stage 2
- 26. Reference binary messages and checking core messages against the schemas
- 27. Running examples in the ordinary build *(changed)*
- 28. The `fs_*` boundary and the WebAssembly library are done at stage 3
- 29. Fixes from the independent review of stage 2

**2026-11-18. Stage 3: build server**

- 30. Two images: tools and build
- 31. On the VPS the system nginx stands in front of the service, not Caddy
- 32. Boundary with the host: what is added to sections 4.8 and 7.5
- 33. Assumptions 8 and 9 confirmed
- 34. The check (`/v1/check`) runs Verilator with `--cc`, not with `--lint-only`
- 35. Auto-detection and binding: clarifications to sections 2.5 and 2.6
- 36. Cache and queue
- 37. Limits beyond section 8.5
- 38. Job launch: additions to the command in section 8.1 *(changed)*
- 39. Server tests, local server and development key
- 40. Deployment
- 41. The Docker socket of the service is a deliberate risk of spec section 8.1
- 42. C code insertions in a design are not built
- 43. Fixes from the independent review of stage 3
- 44. The small model is built as one translation unit
- 45. Fixes from the security review after the merge of stage 3

**2026-11-19. Stage 4: interface skeleton and running in the browser**

- 46. An unsaved edit is stored next to the file; a build saves the edits
- 47. The open project is recorded in the page address
- 48. Core host: what the page does and what the Worker does
- 49. The stage 4 speed criterion is measured at multiplier `max`; at `max` the batches run back to back *(changed)*
- 50. End-to-end test bench
- 51. Style check of `tools/**/*.mjs` and `e2e/`
- 52. Scope of the stage 4 interface and additions to `window.__fpgasim`

**2026-11-19. Stage 5: board, LEDs, buttons, time control**

- 53. Board drawing: what is drawn and from where; assumption 10
- 54. LED: brightness per frame, instantaneous level on pause
- 55. Button: mouse, Shift, keys
- 56. Top bar: step, speed multiplier, ratio, keyboard shortcuts
- 57. Workspace layout and the bottom panel
- 58. `/v1/check` check on edit and on save
- 59. Messages: labels by level, explanations *(changed)*
- 60. ESLint catches interface strings that bypass the dictionary
- 61. Project files and project name; what of the "Files" area is deferred
- 62. Examples `pwm_fade` and `shift_chain`
- 63. Additions to `window.__fpgasim` at stage 5
- 64. Fixes from the independent review of stage 5

**2026-11-19. Stage 6: breadboard and pin binding**

- 65. The interface computes the binding from the `pins` field; changing the binding and parts needs no build
- 66. The "Pin binding" dialog and export to `.cst`
- 67. Breadboard field
- 68. Part dialog: add, edit, built-in parts
- 69. Switch and probe widgets
- 70. Example `debounce`; `togglesMin` in `expect.json`; parts in the example runners
- 71. Project settings dialog and top module choice
- 72. Additions to `window.__fpgasim` at stage 6
- 73. Fixes from the independent review of stage 6

**2026-11-19. Stage 7: UART and WS2812**

- 74. The author confirmed the spec additions made at stage 6
- 75. The `uart` part: what section 6.3 does not contain
- 76. The `ws2812` part: what section 6.4 does not contain
- 77. Part expectations in `expect.json`
- 78. Stage 7 examples
- 79. Runtime version 0.2.0; built-in UART and WS2812 in every `configure` *(changed)*
- 80. Stage 7 interface
- 81. Fixes from the independent review of stage 7 *(changed)*

**2026-11-19. Stage 8: signals and waveforms**

- 82. Signal tree and observation
- 83. Waveform model
- 84. VCD: export and parsing
- 85. When the interface requests recording data
- 86. Waveform panel
- 87. Additions to `window.__fpgasim` at stage 8
- 88. Fixes from the independent review of stage 8 *(changed)*

**2026-11-19. Stage 9: testbench**

- 89. The `testbench` operation: what is compiled and where it runs *(changed)*
- 90. Icarus Verilog messages
- 91. Time, output and the waveform file
- 92. The "Testbench" tab and the waveform from VCD
- 93. Example testbenches
- 94. File list: icons and marks
- 95. Fixes from the independent review of stage 9 *(changed)*

**2026-11-19. Stage 10: folder on disk and archives**

- 96. Which files go into a project from a folder, an archive and single files
- 97. Project in a folder: disk, copy in the browser, access, rebuild
- 98. Changed files are counted from the content at project creation
- 99. File upload and drag and drop
- 100. Fixes from the independent review of stage 10

**2026-11-19. Stage 11: deployment and acceptance of version 1**

- 101. Static deployment and the content security policy
- 102. The `make e2e-prod` suite *(changed)*
- 103. The author's lessons in `examples/lessons/`
- 104. Quick help
- 105. Request retry in the example runner without a browser
- 106. Fixes from the independent review of stage 11

**2026-11-19. After acceptance of version 1**

- 107. Batches run back to back at any multiplier while the core cannot keep up (2026-11-19) *(changed)*
- 108. The default visibility mode is `ports` (2026-11-19)
- 109. The `SLOW` notice appears at a lag over 10% within three seconds (2026-11-19)
- 110. Note on a board device without a model — code `DEVICE_NOT_MODELED` (2026-11-20)

**2026-11-20. Interface design**

- 111. Interface on Tailwind and shadcn, light and dark theme
- 112. "Run" builds an unbuilt or changed project
- 113. "Run" and "Pause" are one button
- 114. The "changed after build" label
- 115. Project menu, file actions, projects screen
- 116. Screenshots in the help

**2026-11-20. Accounts and projects on the server**

- 117. Accounts and projects on the server: scope and task
- 118. Accounts are a SQLite database in the `api` service
- 119. The session token is in the `Authorization` header, no cookie
- 120. Access keys stay
- 121. Login limits and session lifetime are in `Limits`
- 122. Operations on one's own account — only for a session
- 123. Restoring the database from a copy
- 124. A database connection per operation
- 125. `fpgasim-admin user` and the prohibitions of section 3.4
- 126. Stage 1 fixes after the independent check
- 127. Projects on the server: limits, request checks, trash
- 128. Emptying the trash and database copies are a task inside the service
- 129. `last_build`, the project log, `make backup-accounts` *(changed)*
- 140. Stage 3 fixes after the independent check
- 130. Login of the saved session in `localStorage`
- 131. The 401 refusal and a session that has ended
- 132. Accounts of the development bench and end-to-end tests
- 133. Look of the "Users" page
- 134. The "no color literals" check
- 141. Synchronization mechanism in the browser (accounts stage 4)
- 142. Stage 4 fixes after the independent check
- 150. Synchronization flags and the conflict dialog (accounts stage 5)
- 151. "Sign out" sends first; the dialog appears if sending failed
- 152. The administrator views users' work
- 153. Messages about a project deleted on another device
- 154. End-to-end tests of stage 5 *(changed)*
- 155. Help and acceptance test of accounts (stage 6)
- 156. The `deploy/fpgasim-admin` wrapper: the Compose command as an array
- 157. The file label is compressed before the name; helpers of two devices in one file
- 158. The author's answers: dialog on logout, database copy, administrator limit *(changed)*
- 159. `make backup-accounts` reads the copy with a one-off container
- 160. Daily copy of the accounts database to R2

**2026-11-20. Tang Nano 9K board**

- 161. Tang Nano 9K board: scope and board choice *(changed)*
- 162. Pin standard in the board file
- 163. The 9K buttons are pulled up on the board

**2026-11-21. Author's tasks after 9K**

- 164. Checking IO_TYPE against the pin standard
- 165. Fair job queue

**2026-11-22. Author's tasks**

- 166. Dragging files into an open project
- 167. Changing the board in project settings
- 168. English interface language
- 169. `fpgasim.json` of lessons 02, 03, 06, 07
- 170. README in English
- 171. Access key for hackathon judges
- 172. Repository language is English
- 173. Host names in site settings, not in the code
- 174. Open source: MIT, a new public repository
- 175. The assistant: own panel, the author's key on the server
- 176. Assistant token counts in their own SQLite file
- 177. A scripted model for the assistant tests
- 178. The assistant tool step stays on the screen; the tools used under each answer

## 2026-11-18. Stage 0: measuring speed and build time

Numbers and tables are in `docs/stage0-report.md` and `bench/results.json`.

### 1. Verilator 5.050, not release 5.054, the closest to the author's version

The spec (section 7.4) proposes the stable release closest to the author's 5.055, that is 5.054.
The measurement showed that 5.054 is unfit for our designs by speed.

- Since 5.052 the `eval()` loop has moved from the model into a helper library
  (`VerilatedEvalLoop` in `verilated.cpp`). On every half cycle it makes about ten
  virtual calls into the model. On a large design this is invisible. On `blink3` it is the main
  work.
- Chrome on Mac, mode `all`, `-O2`: 5.050 — 39.2 M clock cycles/s (1.45×), 5.054 — 16.6
  (0.61×). The difference is 2.4 times, and it separates "faster than real time" from "slower".
- The author's version 5.055 is built the same way as 5.054 (checked: its `Vtop.cpp` has the same
  `m_evalLoop`).
- The three versions behave the same on `blink3` and on the check design: the same 4, 8 and 16
  toggles, and the warnings match word for word.

5.050 is pinned: it is the last release with the loop inside the model. Consequence: compiling
to WebAssembly needs the flag `-DVL_IGNORE_UNKNOWN_ARCH` (in 5.050 the `VL_CPU_RELAX` macro does
not yet know WebAssembly; this is the standard workaround from `verilatedos.h`).

When to revisit: at every new Verilator release, run
`FPGASIM_VERILATOR=<version> tools/bench/image.sh 8 && FPGASIM_VERILATOR=<version> tools/bench/run_mac.sh`
and compare with the table in the report. Move to the new release only if the speed in Chrome
is not below 27 M clock cycles/s in mode `all`.

### 2. Emscripten 7.0.0, Ubuntu 24.04

Emscripten 7.0.0 is the last stable emsdk release on 2026-11-18 (the rule of section 7.5).
The versions are recorded in `server/docker/versions.env`. Images: `fpgasim-tools:vl5.050-em7.0.0`
and on top of it `fpgasim-build:vl5.050-em7.0.0-rt<core version>` (decision 30).

### 3. Optimization level: `-O2` for compiling and linking, no LTO

- `-O3` is not faster than `-O2` in any environment (the difference is within the spread), and
  linking takes 0.9 s longer.
- `-O1` is 23% slower in Chrome (30.2 against 39.2 M clock cycles/s in mode `all`), and it
  speeds up the build by only 1 s, through linking.
- LTO adds no speed (38.5 against 39.2) and makes linking 4.5 s longer.

The spec default (`-O2`, no optimization at link time) is confirmed.

### 4. Default visibility mode: `all`

> **Changed later.** Replaced by decision 108: the default is `ports`. The measurements and arguments below stay valid for mode `all`.

In Chrome on Mac, mode `all` gives 39.2 M clock cycles/s, that is 1.45× real time.
The condition of section 7.3 (not below 1× on `blink3`) is met. `--public-flat-rw` costs 25%
of the speed (in mode `ports` it is 52.5 M clock cycles/s). Mode `ports` stays the fast mode
for heavy designs.

### 5. Contents of the prebuilt library

`libfpgasim_rt.a` must contain:

- `verilated.cpp`, `verilated_threads.cpp` — every model needs them;
- `verilated_dpi.cpp` — a model with `--public-flat-rw` (mode `all`) needs it; in mode `ports`
  the linker does not take it;
- stubs of three functions for Emscripten: `pthread_getaffinity_np`,
  `pthread_setaffinity_np`, `sched_getcpu` (sample: `tools/bench/wasm_stubs.cpp`).
  The Emscripten libc headers declare them, but the functions themselves do not exist, and
  without the stubs the Verilator support files do not link. The core is single-threaded, so the
  stubs are never called;
- the runtime and the parts (from stage 2).

The server must check the list of support files against `VM_GLOBAL_FAST` in `obj/Vtop_classes.mk`:
if the model asks for a file that the library lacks, this is a `TOOLCHAIN_FAILED` error,
not a silent link failure.

The library is built with the same flags as the model. Compile flags beyond section 7.5:
`-DVM_COVERAGE=0 -DVM_SC=0 -DVM_TIMING=0 -DVM_TRACE=0 -DVM_TRACE_FST=0 -DVM_TRACE_VCD=0
-DVM_TRACE_SAIF=0 -fbracket-depth=4096 -DVL_IGNORE_UNKNOWN_ARCH -include cstdint`.
The last one is needed because of `Vtop__Dpi.h`: it includes `svdpi.h` before `<cstdint>`,
and with the Emscripten libc mode `all` does not compile otherwise.

### 6. Project build order: library, prebuilt header, two processes

Section 7.5 describes compiling the model with one `em++` command. One command compiles the
files one by one, and almost all the time goes to parsing `verilated.h` again and again.

Accepted for stage 3:

- next to the library the image holds a prebuilt header (PCH) of
  `engine_verilator.h`, which includes `verilated.h`; the flag `-include-pch` attaches it. The PCH is
  built with the same flags as the model;
- the model files compile in separate processes, as many as the job has cores (two).

Cold build of `blink3` on the VPS in mode `all`, including the container start: 4.3 s
(worst run 4.5 s) against 13.9 s with the library only and 26.7 s without it.

The "one translation unit" variant is even faster on `blink3` (3.1 s), but it is not accepted as
the default: on a large design it removes the parallelism of the build and needs more memory.
It is accepted for small models at stage 3 (decision 44).

### 7. The Emscripten cache in the image is frozen (`EM_FROZEN_CACHE=1`)

The build job runs in a container with a read-only file system (section 8.1).
Without the freeze, `em++` creates a lock file in its cache at link time and fails
with `Read-only file system`. The Emscripten system libraries are built when the image is built
(ordinary ones, ones for LTO and ones for linking with a file system). If the link flags need
a library that the cache lacks, the build of the tools image must add it
(`server/docker/Dockerfile.tools`): in the frozen mode this is an error.

### 8. The port list is read from `Vtop.h` (assumption 3 confirmed)

Line format in 5.050: `VL_IN8(&clk,0,0);`, `VL_OUT8(&led,5,0);`, `VL_INW(&in128,127,0,4);`.
An `&` stands before the name, and the parsing pattern must allow it. The port order in the header
differs from the order in the source (on the check design: `clk, in8, io1, out1, …,
in33, in64s`); the server must not take the port order for the interface from here. Escaped names are encoded as `__0HH`
(`\bus-a` → `bus__02Da`). Parsing: `server/job/shimgen.py`; the server
takes the port order for the interface from the source text (decision 35).

### 9. Signals are enumerated without VPI (assumption 4 confirmed)

`VerilatedContext::scopeNameMap()` and `VerilatedScope::varsp()` give the name, the width,
the dimensions and a direct pointer to the data. The `--vpi` flag is not needed. What to take into account at stage 2:

- the scopes are called `<model name>.TOP` (copies of the top-level ports) and
  `<model name>.top…` (the design hierarchy); the `TOP` scope does not go into the signal tree,
  otherwise the ports would show twice;
- parameters (`localparam`) get into the list with the `isParam()` flag;
- a memory has `udims() > 0`, and its depth comes from the size of the unpacked dimension.

### 10. "Ordinary code on the Mac" is measured in a linux/arm64 container

By the conditions, Verilator is not installed on the Mac, so the ordinary program is built and runs
in Docker Desktop (a linux/arm64 container, the same processor, virtualization without emulation).
This number is for reference: the stage 0 rule relies on Chrome.

### 11. Mac measurements record the power mode

The counted Mac measurements were made on battery in power-saving mode (this is how the author's Mac is set up:
`lowpowermode 1` on battery, `0` on mains). On mains Chrome is 37% faster (about 54 M
clock cycles/s in mode `all`). The stage rule was applied to the smaller number. The bench
records the power source and the mode at the start and at the end of every measurement (`tools/bench/power.mjs`);
only measurements in the same mode can be compared. For the stage 4 criterion "the speed ratio
not below the one accepted at stage 0 minus 20%", count from 1.45×.

### 12. Scripts for the VPS do not use `make`

The VPS has no `make`, and nothing may be installed there. Everything that runs on the VPS
(`tools/bench/image.sh`, `tools/bench/vps_run.sh`, `deploy/remote.sh`) is written in bash;
`make` is for the Mac only.

### 13. Which Verilator speed-up tips do not apply, and why

An agent of a neighboring project on the VPS gave a list of techniques for ordinary simulation. Not all of them
suit the core in the browser; so that nobody returns to the rejected ones:

- `--x-assign fast --x-initial fast` — not allowed: spec section 7.4 requires `0`, registers
  start from zero, as on an FPGA.
- `--threads`, `--prof-pgo`, `-march=native` — not applicable: the core runs in the browser
  in one WebAssembly thread (section 7.5).
- `ccache` — not needed: repeated builds are covered by the server cache keyed by content, and a cold
  build takes 4 s.
- "The newest Verilator is faster" — wrong for our designs, see item 1.

Applied: Verilator is built with clang; heavy steps on the VPS run with `--cpus=3 --memory=5g`,
the image is built in three threads, and the build jobs run with `--cpus 2 --memory 2g` per the spec; `st`
from `vmstat` is recorded in `bench/results.json`.

## 2026-11-18. Stage 1: repository skeleton and formats

### 14. Format checks: Node and ajv, samples with the place of the expected error

`tools/spec/check.mjs` checks the schemas (ajv, JSON Schema 2020-12, strict mode: a typo
in a schema keyword is an error). Node is chosen because `make check` and the interface
already need it; there was no need to install Python on the Mac for this.

The samples are one file per schema: `spec/tests/<name>.json` and
`spec/tests/protocol/<message>.json`. The format is described in the header of `check.mjs`. Every
invalid sample has an `at` field — the place in the document where the error must point.
Without it a sample can be rejected for an unrelated reason (for example, because of a typo
in the sample itself), and the schema check would check nothing. The invalid samples of a board and a part are
a real file with one edit (`from` + `set`/`remove`), not a trimmed document.

Beyond the schemas, the script checks what a schema cannot express: a part in a board or
project file has an existing type, and the pin roles and settings fit the part description; the pins
of headers, clocks, devices and groups exist in the board `pins`; identifiers do not repeat;
the setting defaults pass their own constraints.

### 15. Unknown fields: `fpgasim.json` skips them, the other formats reject them

Section 2.2 requires keeping the unknown fields of `fpgasim.json` and warning about them.
So the project schema does not forbid extra fields at any level; the server issues the warning
(`CONFIG_UNKNOWN_FIELD`). The project itself writes the board file, the part description and the protocol messages,
so an extra field there is a typo, and the schemas reject it. The exception is the `ok` message:
its set of fields is given explicitly (`warnings`, `signals`, `record`, `info`).

### 16. Format clarifications where the spec is silent

None of them contradicts the spec; if the author disagrees, the schema and this item change.

- **Part description.** A `commands` element is `{ "name", "args" }`, where `args` maps an
  argument name to a value description (`type`, `minimum`, `maximum`, `items`). An
  `events` element is `{ "name" }`. A setting is described by the keys `type`, `enum`, `minimum`,
  `maximum`, `maxLength`, `default`, `label`; `default` and `label` are required.
- **Defaults that section 6 lacks.** `uart.lineEnding` is `"none"`; for `ws2812`
  the matrix width is the setting `width`, default 8; `button.key` and `probe.label` are
  an empty string; for `ws2812` `layout` is `"strip"`.
- **Six descriptions, not five.** The stage says "five parts" by the number of subsections
  of section 6, while section 13 lists six folders: the button and the switch are different types
  with different commands.
- **`spec/diagnostics.json`.** `{ "format": 1, "codes": { "BLKSEQ": { "level", "text":
  { "ru" }, "explain": { "ru" } } } }`. Levels: `important`, `note`,
  `hidden`. Texts by language, as in the part descriptions (section 15.2). The `explain`
  explanation is required for every code that is shown (decision 59).
- **Protocol.** One schema per control message, common definitions in
  `spec/protocol/common.schema.json`. The `engine` field in `ready` is an object
  `{ "name": "verilator", "version": "5.050" }`. All times are strings, including
  `ps` in `step` and `windowPs` in `recordStart`; in `fpgasim.json` the field `record.windowPs`
  stays a number, as in the example of section 2.4. `cycle` in `state` is a number (up to 2^53 clock cycles
  at 27 MHz — more than ten years). In `step` the field `count` is required and allowed only
  with `unit: "cycle"`, the field `ps` only with `"time"`. In `recordStart`, `signals`
  and `mode` are required. A `warnings` element is `{ "code", "text" }` with optional `net`,
  `part`, `port`.
- **The field `net` is a string `pin:N`.** The reason is section 4.1
  ("nets are addressed by a string"), see item 18.
- **Minor constraints of the protocol schemas.** `id` is an integer not less than zero and is allowed in any
  command, including `hello`. A time has no leading zeros. The `dir` of a port in `ready`: `in`, `out`,
  `inout`. In `recordStart` the `signals` list is not empty, and `trigger.signal` is a signal number or
  `pin:N`. In `partEvent` the field `data` is required (an empty object if there is no data).
  In `recordFetch` both bounds are optional. In `notice` the fields `net` and `part` can come
  together.
- **Minor constraints of the other schemas.** The `key` setting of a button and a switch is not
  longer than one character. A path in `fpgasim.json` does not end with `/`.
- **A rule that a schema cannot express.** Section 2.4: for a multi-bit signal the
  trigger condition is only `change`. The core checks it at `recordStart` (stage 8).

### 17. Style: line length 120, tools run through `uvx`

- Line length 120 in C++, Python and TypeScript: the stage 0 code is written for it.
- C++: `.clang-format` in the root, Google base, indent 4. Python: `ruff.toml` in the root,
  rules `E`, `F`, `W`, `I`, `UP`, `B`, `ANN` (type annotations are required).
- `clang-format` and `ruff` are not installed on the Mac: `make lint` runs them through `uvx`
  with pinned versions (23.1.5 and 0.14.5); `uv` is already on the machine.
- `make lint` checks C++ and Python in the whole tree, TypeScript in `web/`, and the scripts
  `tools/**/*.mjs` and `e2e/` with a separate target (decision 51).
- Interface: TypeScript 6.0.3, not 7: `typescript-eslint` 8.73 does not accept
  version 7. ESLint — the `strictTypeChecked` set. React and Vite versions are in decision 52.

### 18. Two open questions closed on the author's order: `net` and `PROCASSINIT`

The author ordered to find the accepted solution and apply it. Edits were made to section 4.1 and the table of section 7.6
of the spec.

- **`net` in `notice` and in the warnings of `ok` is a string `pin:N`.** There is no industry
  standard here; this is an internal protocol choice. Reasons: section 4.1 requires a string; the same
  name already stands in the recording list and in the signal panel (section 6.5), and the interface does not need to
  translate one kind of address into another; similar simulators address pins by a string
  (Wokwi: `"led1:A"`, `"uno:13"`). In `configure` a net is still given by the number `pin`.
- **`PROCASSINIT` is level "hidden".** The warning fires on `reg q = 0;`
  with an assignment in `always`. The Verilator documentation: an initial value in a declaration is
  "an acceptable design practice for FPGAs", and FPGA users are advised to disable this
  warning; it is meant for custom-chip synthesis, where a reset is needed.
  The course uses this practice (`blink3` from the spec), so the message only gets in a learner's way.
  That Gowin loads the initial register values at configuration is confirmed only
  indirectly (init support in Yosys for Gowin, a forum message quoting support);
  no official Gowin document was found. This does not affect the decision: the spec (section 7.4)
  already assumes that registers start from the given value.

Sources: https://verilator.org/guide/latest/warnings.html (section PROCASSINIT),
https://docs.wokwi.com/diagram-format (section Connections).

## 2026-11-18. Stage 2: the core on an ordinary machine

### 19. CMake, Ninja, nlohmann/json and Catch2 added to the build image

The `cmake` command in the stage 0 image answered "Permission denied": the image had no CMake itself,
and the shell found the directory `/opt/emsdk/upstream/emscripten/cmake`. The packages `cmake` 3.28.3,
`ninja-build`, `nlohmann-json3-dev` 3.11.3 and `catch2` 3.4.0 are installed from Ubuntu 24.04 as a separate
layer (now this is `server/docker/Dockerfile.tools`), so that editing the list does not rebuild Verilator and Emscripten.
The Ubuntu release pins the versions. Module scanning for C++20 is disabled in `core/CMakeLists.txt`:
otherwise CMake 3.28 requires `clang-scan-deps`, which the image lacks.

The layer is part of the `fpgasim-tools` tools image (decision 30).

### 20. Scheduler time model

- Invariant: all half cycles that began strictly before the current simulation time are done.
  A half cycle that begins exactly at the current moment is not done yet. So a part
  command that arrives at the moment of an edge takes effect before it, and a 1 s step at 27 MHz does
  exactly 54,000,000 half cycles.
- The moment of an event from the FPGA (a change of an output or of a recorded signal) is the start of the half cycle
  in which it happened.
- The clock cycle number (`cycle`) is the number of rising edges done. After a "until change" step
  the simulation stands between edges, and the number equals the clock cycle in which the output changed.
- A step of N clock cycles is a step to the start of the half cycle numbered "current + 2N". A "until change" step
  stops at a change of any FPGA output, including one caused by a part.
- A long step is computed in several `fs_tick` calls (a budget of 12 ms per call, as for a batch),
  so that the core in the browser does not block the Worker. One frame goes out, at the end of the step, and covers
  the whole step. Commands on pause take effect at once, and the core computes only inside `fs_tick`.
- The fractional remainder of the target is stored in picoseconds (the fractional part of a number). Simulation time may
  stand between half cycles, so at multiplier 10^-6 batches shorter than a half cycle add up
  by themselves.
- The real-time reference for the target is the parameter `fs_tick(nowMs)`; the batch budget is counted
  by `fs_now_ms()`. The host must give both the same time (`performance.now()`).

### 21. Engine interface: what is added to section 7.1 and template 7.2

The spec section is corrected. Reasons:

- `Engine::info()` and `EngineInfo`: the `ready` message needs the engine name and version and the name of the
  top module, and the interface of section 7.1 did not have them.
- `SignalKind` was mentioned in `SignalInfo` but not declared.
- The first signals of the list are the ports in the order of `ports()`, and the port number equals `sig`. So observation
  and recording of a port need no separate table.
- The shim got `kTop` (the top module name; in mode `ports` there is nowhere else to
  take it from) and the constructor `Shim() { init(); }`. The common part reaches the port data through the
  shim, and a base class constructor cannot call its method: the object is not built yet.
- `reset()` creates the model anew and marks all outputs as changed: the runtime
  rereads them, and the previous values in the shim are compared with the new model.
- The model instance is called `m`; the Verilator scopes `m.TOP` (copies of the ports) are skipped,
  and for the others the prefix `m.` is dropped, so the path starts with the top module name
  (`top.cnt_a`). The top module ports in its own scope are skipped: they already stand at the start.
- Signal kind: `param` — `isParam()`, `memory` — there are unpacked dimensions, `wire` —
  `isNet()`, otherwise `reg`. Strings and real parameters do not get into the list.
- Values are read as bytes from the least significant (CData, SData, IData, QData, VlWide are laid out this way
  on all our platforms; the header has a byte order check).
- The ordinary build on linux/arm64 needs `-latomic` when linking with the Verilator support files.

### 22. Protocol: `error` codes and message order

The schemas did not change; spec section 4.3 got a table of `error` codes and clarifications of the order
(`ready` and `ok` in reply to `hello` with a number; notices after `ok` and `state` on `configure`;
`state` and a frame after a step; `state` after `speed`). A command without `id` runs but gets
no reply; a message of unknown type without `id` is skipped, and with `id` it gets `UNKNOWN_COMMAND`.

`configure` applies only as a whole: on refusal the previous setup stays. A repeated
`configure` while running resets the simulation and pauses it. `pause` is allowed on pause too
(the same reply: `ok`, `state`, frame) and interrupts a running step. `watch` and `speed` are allowed before
`configure`.

### 23. Nets

- The net of a clock port is driven by the board generator: the level rules do not apply to it, and it is not
  "floating". Its level, toggles and share in the frame are computed from the number of half cycles; the flags
  are zero. A part on this net gets no edges. In a recording, `pin:N` of the clock pin
  is replaced by the signal of the clock port (a change on every half cycle).
- The "floating" flag (bit 3) is set on any net without a source and without a pull;
  the `INPUT_FLOATING` notice appears only if the FPGA reads the net.
- A notice is issued when the condition appears (not all the time while it holds), and not more often than
  once per second of simulation time per net. `reset` clears the notice history.
- The initial setting of levels at `configure` and `reset` does not count as a toggle and
  does not call `onEdge`.
- The chain "a part changed an input → the model is recomputed → an output changed → the part reacted"
  within one moment of time is limited to 16 rounds: this guards against a loop through parts.

### 24. Parts

> **Changed later.** Extended by decisions 75, 76 and 79: the descriptions of six parts are built in, including `uart` and `ws2812`.

- The descriptions `parts/<type>/part.json` are built into the library as text at CMake configuration
  (only for parts that have a C++ class: `led`, `button`, `switch`, `probe`).
  `partTypes` in `ready` are the parts that have both a class and a description.
- Settings are completed with defaults and checked against the description (kind, list, bounds, length);
  an unknown setting is an error. A command and its arguments are also checked against the description:
  an unknown command, an extra or a missing argument gives `PART_COMMAND_INVALID`.
- `attach` is called once, `reset` — at `configure` and at every `reset`.
- The button and the switch are one contact class. Bounce: the contact goes to the new
  position at once, then toggles at random intervals from 50 µs to 2 ms and exactly
  at the end of `bounceMs` takes the final position. So there are always more than two toggles
  at `bounceMs = 5`. The state in a frame is the position set by the command, without bounce.
- The random number generator of a part is xorshift64*, its seed is FNV-1a of `id`;
  `reset` returns it to the start.
- The state of every part arrives in the first frame after `configure` and `reset`, and later
  only after `markDirty()`. A part without state (the LED, the probe) gives no block.

### 25. Recording is already done in the core at stage 2

Stage 2 requires the whole runtime of section 5, the TRACE reference and tests for success and refusal of
`recordStart`, `recordStop`, `recordFetch`, so recording is implemented now; stage 8
adds the interface and its own criteria.

- There is one recording: a new `recordStart` replaces the previous one, and its data is lost. `reset`
  and `configure` erase the recording.
- Defaults: `depth` 200,000, `windowPs` 10^11 (as in section 2.4).
- The trigger condition works in both modes. The condition signal may not be in the recording
  list; then it is absent from `info`.
- A change is stored in a ring: time, signal number and value. Memory: `depth` × (16 +
  4 × words of the widest signal); over 64 MB is refused with `RECORD_INVALID`.
- The values at the start of the section after the trigger fired already contain the edge itself.
- The window ends exactly after `windowPs`, even if there are no changes. When the recording has ended,
  the engine stops watching the signals.
- TRACE: every message starts with the values of all signals at its start; the next
  message starts where the previous one ended. Changes exactly at the moment `fromPs`
  go as changes, earlier ones go into the initial values.
- In state `armed` the fields `fromPs` and `toPs` equal the current time, and `changes` is zero.

### 26. Reference binary messages and checking core messages against the schemas

- `spec/protocol/vectors/vectors.json` describes the contents of five `.bin` files (FRAME, empty
  FRAME, TRACE, two PART_DATA). `node tools/spec/vectors.mjs --write` creates the files;
  the encoder there is written independently of the core. `make check-spec` checks the files against the description,
  and the core test checks its own encoding against the files. Stage 4 checks TypeScript against them.
- The core tests save every control message that the core sent
  (`core/build/transcript.jsonl`), and `make test-core` checks them against the schemas
  in `spec/protocol/`. Every message type of the core must occur at least once.
- The FRAME parser (`decodeFrame`) lives in the library, although the core does not need it: the tests
  and the example runner use it.

### 27. Running examples in the ordinary build

> **Changed later.** Extended by decisions 77 and 79: since stage 7 the built-in `uart` and `ws2812` go into the `configure` of every project.

- `tools/native/run_examples.py` (in the container): Verilator with the flags of section 7.4, the shim,
  linking with the library and `core/src/native/example_main.cpp`, `configure` from the board file
  and `.cst`, comparison with `expect.json`. Every example runs in modes `all` and `ports`.
- Parsing `.cst` and composing `configure` are simplified there and remain a core check without the server.
  The real parsing is in the server (`server/fpgasim_server/`); `tools/headless/core.mjs` and the interface
  (`web/src/sim/configure.ts`) compose `configure` from the server reply. The top module there is `top`.
- The built-in board parts that the core does not have yet (`uart`, `ws2812`) did not go into `configure`
  before stage 7; since stage 7 they do (decisions 77 and 79).
- `notices` in `expect.json` is the exact set of notice codes for a run. `parts` must be empty
  before stage 7.
- Additional expectations for the same example live in `core/tests/expect/<example>.<name>.json`:
  this is how the duty cycle 0.5 of `blink3` over a whole number of periods (2 s) is checked, while the `expect.json`
  from the spec (2.1 s) stays unchanged.
- The runtime tests run on a fake engine (`core/tests/fake_engine.h`); the real
  Verilator is checked by the examples.

### 28. The `fs_*` boundary and the WebAssembly library are done at stage 3

Stage 2 is "the core on an ordinary machine", so the `fs_*` boundary, `host.js` and the build of `libfpgasim_rt.a`
through `emcmake` were not part of it. They are done at stage 3 (decision 32): the boundary is a thin wrapper over
`Runtime::json`, `binary` and `tick`; the `Host` class separates the runtime from the host
(`core/include/fpgasim/runtime.h`).

### 29. Fixes from the independent review of stage 2

A second agent checked the core code against the spec. The confirmed defects are fixed, and each has a test.

- **A design without a clock at speed `max`.** `max` has no target, and the simulation time in one batch
  ran to the `uint64` limit. In a design without a clock, time runs in real time (section 5.3),
  so for it `max` equals multiplier 1.
- **The clock cycle loop checks both the outputs and the recorded signals, always.** The sample in section 7.2
  had `outputsChanged() || trackedChanged()`: when an output changed, the second check
  did not run, the previous values of the recorded signals went stale, and the recording lost an edge
  (a clock pin got a pulse of three half cycles). Spec section 7.2 is corrected.
  `$finish` is now noticed on the same half cycle, even if an output changed on it.
- **`$stop` and `$fatal`.** By default Verilator aborts the process on them. The context is created
  with `fatalOnError(false)`: the model ends the same way as on `$finish` (`MODEL_FINISH`,
  state `finished`). Checked by reading `verilated.cpp` 5.050; the test is the check designs
  `core/tests/designs/stopcheck` and `fatalcheck` (added 2026-11-22).
- **The first recomputation of the model runs after the initial input levels are set.** Before, the model
  was recomputed with zero inputs, and an input with a pull-up gave a false rising edge
  at moment 0. In mode `all` a port has a copy inside the top module, and the model
  looks for the edge in that copy; before the first recomputation the engine writes the initial level into it too.
- **The time share in the unit state of a clock net** is computed approximately (to 1 ps); the difference now
  does not go below zero and does not exceed the batch length.
- **A recording stopped before the trigger fired** returns the signal values at the moment of
  stopping, not zeros.
- Minor: the watch list is limited to 65,535 signals (the counter in a frame is u16); the `id` of a part
  is checked against the schema pattern; at most 1024 wake-ups run in one pass
  (a part that asks to wake at the current moment does not loop the core past the budget);
  the speed ratio is zeroed at `reset`.

What is left as is, deliberately:

- The core does not check incoming commands against the schemas in full: extra fields are skipped. The interface
  keeps to the schemas (stage 4 checks its messages against them with tests).
- The core is stricter than the schemas in two places: `count` in `step` is not above 2^40, `hz` is not above 10^9.
- The scheduler drives one clock directly through `ClockList::hz()` and `half()`; choosing the nearest
  edge from several sources (`ClockList::next()`) is checked by a test, but it will appear in the loop
  together with several clocks (version 2).
- `$finish` in a design without a clock is not noticed: `settle()` has no result. Such a design is
  pure combinational logic, and `$finish` in it is possible only from `initial`.

So that the engine template is checked on the real Verilator with more than two examples, the check
design `core/tests/designs/enginecheck` is added: an output changes on every clock cycle, there is
a 70-bit signal, an input with a pull-up, and `$finish`. It checks observation,
recording of the clock and of a counter after `reset`, and the number of the finishing clock cycle.

## 2026-11-18. Stage 3: build server

### 30. Two images: tools and build

Spec section 8.2 describes one image. Two are made:

- `fpgasim-tools:vl<version>-em<version>` (`server/docker/Dockerfile.tools`) — Verilator, Emscripten,
  Icarus, CMake, Jinja2. It does not depend on repository files and takes long to build. The core tests
  and the measurement run in it (`tools/bench/image.sh --name`).
- `fpgasim-build:vl…-em…-rt<core/VERSION>` (`Dockerfile.build`, built on top of the first) — the runtime
  library, headers, `host.js`, the prebuilt header, the job script, the shim template, the
  board files. Its tag is the `toolchain` field in the cache key (`image.sh --name-full`).

Reason: on the VPS the owner's `~/bin/docker-prune.sh` runs once a week and deletes the build cache
older than a week (it does not touch tagged images). With one image, an edit of `core/` a week after the
previous build would build Verilator from source again (about half an hour on the VPS). A tagged image
stays, and rebuilding the second image takes about a minute.

Consequence: the tag `fpgasim-build:vl5.050-em7.0.0` (the image of stages 0–2) is no longer used.
It remains on the Mac and on the VPS from earlier builds; the owner can delete it
(`docker image rm fpgasim-build:vl5.050-em7.0.0`), and it does not affect operation.

While `core/VERSION` has not changed, an edit of `core/` gives an image with the same tag, and the old build cache
entries stay valid. When an edit of the core changes behavior, raise `core/VERSION`.

### 31. On the VPS the system nginx stands in front of the service, not Caddy

Spec sections 8.1 and 10.2 put Caddy in front of the service in our Compose. On the VPS (`fpga-build`) ports 80 and 443 are held by the system nginx with two other sites.
Caddy cannot be started on these ports
without touching what belongs to others, and on the VPS only one's own folders, one's own Compose project and one's own images may be touched.

Replacement: the service in Compose listens on `127.0.0.1:8090`, and the nginx vhost
`deploy/nginx-fpga-build.scriptorium.cc.conf` does TLS and proxying — the other services of this host are set up the same way.
The file `deploy/Caddyfile` is not created. The formats and the protocol do not change.

The owner agreed to the replacement on 2026-11-18 and installed the vhost and the certificate the same day:
Cloudflare Origin, the DNS record in Proxied mode (like the two other sites of the host; the spec asked for no
proxying). The variant with Let's Encrypt and a DNS-only record was not chosen: certbot is not
installed on the host. The description is in `docs/deploy-server.md`. Two things matter in the vhost: `client_max_body_size 16m` (by default
nginx cuts the body at 1 MB) and `proxy_read_timeout 150s` (a build of up to 60 s and a queue of up to 60 s).

### 32. Boundary with the host: what is added to sections 4.8 and 7.5

- The host passes the handlers in the parameters of the module factory: `createModule({ onJson, onBinary,
  instantiateWasm })`. `onBinary` receives a copy of the bytes (a `Uint8Array` with its own buffer).
- The host passes the bytes of `sim.wasm` through `instantiateWasm`: the `wasmBinary` parameter in Emscripten 7.0.0
  has no effect without extra flags, and in the browser the file arrives through `fetch`
  with a key anyway (section 8.3).
- The flag `-sEXPORTED_RUNTIME_METHODS=HEAPU8` is added to the link flags: the host writes a message into the core
  memory through `Module.HEAPU8` (after `fs_alloc`). Without the flag the memory view is not exposed.
- Compiling the model is as decided at stage 0 (decisions 5 and 6): flags beyond section 7.5, the prebuilt
  header `/opt/fpgasim/rt/engine.pch`, one process per file (a small model as one
  translation unit, decision 44). The flags are recorded in one
  place — `server/job/job.py`; the same script (`job pch`) builds the header when the image is built.
- For a project with data files, linking runs with `-sFILESYSTEM=1`; the Emscripten system
  libraries needed for this are built in the tools image (the cache is frozen, decision 7).

### 33. Assumptions 8 and 9 confirmed

- **8.** `$readmemh` works with embedded files at `-sFILESYSTEM=1`: the project
  `server/tests/projects/readmem` (memory from `rom.hex`) is built by the server and passes `expect.json`
  in Node in both visibility modes. With a failed load the memory would be zero and there would be no
  toggles.
- **9.** Line-by-line parsing of the Verilator output covers errors with a place in the code: a syntax error,
  a missing module, a missing include file. A message without a place (for example, "top
  module not found") is returned whole with empty `file` and `line`. The summary lines ("Exiting due
  to", "Cannot continue") are skipped. A message without a code gets the code `ERROR` or `WARNING`.

### 34. The check (`/v1/check`) runs Verilator with `--cc`, not with `--lint-only`

The check reply contains `resolved` with the ports (the binding dialog needs it), and the port list is read
from `Vtop.h` (decision 8), which does not exist with `--lint-only`. So the check runs Verilator with the same
flags as the build and stops before compiling. The messages are the same as those of the build.
The time on the Mac, including the container start, is about 0.3 s. If the cache already has a build of this project,
the check takes the reply from there and does not start a job. Checks are not cached.

### 35. Auto-detection and binding: clarifications to sections 2.5 and 2.6

- **A mention in a testbench does not count as use.** In a mixed file (`TB_MIXED`) the testbench
  instantiates the top module; by the letter of section 2.5 the module would become "used",
  and no top module would be found.
- **A testbench by name or without ports** is determined from the module header: the ports are a non-empty list
  in parentheses after the name (the parameter list `#(…)` is skipped). The label `endmodule : name`
  does not count as use.
- **The port order in `resolved.ports`** is by the first mention of the name in the top module text:
  the order in `Vtop.h` is different (decision 8).
- **The binding is checked in two passes.** Before the build — what does not need the ports: the pin exists on the board
  (`CST_NO_PIN`), is not taken twice (`CST_PIN_TWICE`), is not forbidden (`PIN_FORBIDDEN`). After
  Verilator has named the ports — `CST_NO_PORT`, `PORT_UNBOUND`, the clock, `CLOCK_EXTRA`. The second part runs
  on a cache hit too: the binding is not part of the key, and an edit of `.cst` causes no rebuild.
  A build with a binding error has the state `failed` and gives no file links.
- **New codes.** `CST_SYNTAX` (an `IO_LOC` or `IO_PORT` statement is not parsed, a semicolon is missing,
  an unknown `PULL_MODE` value), `CST_PORT_TWICE` (two `IO_LOC` for one port), `CST_KEEPER`
  (a warning for `PULL_MODE=KEEPER`), `CST_TOO_MANY` (more than a hundred notices). For a binding
  from the `pins` field — `PINS_NO_PORT`, `PINS_NO_PIN`, `PINS_PIN_TWICE` with the file `fpgasim.json`.
  Settings: `CONFIG_INVALID` (not per schema), `CONFIG_UNKNOWN_FIELD`, `BOARD_UNKNOWN`,
  `FILE_NOT_FOUND`, `FILE_NOT_DESIGN`. Build: `WASM_TOO_LARGE`, `DIAGNOSTICS_TRUNCATED`.
- **A multi-bit port is bound only by bits** (`led[0]`); a name without a bit number for
  such a port is `CST_NO_PORT`. The bit number is as declared in the design; in `resolved.pins` the field `bit` is
  the offset from the least significant bit (`configure` expects it), so the fields `msb` and `lsb` are added to
  `resolved.ports`: the interface restores the bit name from them.
- **`PORT_UNBOUND`** is one warning per port, the free bits are listed in `args.bits`.
  `resolved.unbound` is an array of `{ "port", "bit" }`.
- **A clock port** is a one-bit input on a clock pin of the board.
- **The texts in `spec/diagnostics.json`** may contain substitutions `{name}` from the `args` field of the message
  (the example of section 7.6: "The Gowin primitive `{module}` is not supported yet…"). The server test checks
  that every server code is in the table.
- **`fpgasim.json` is passed only in the field `config`**; a file with this name in `files` is `BAD_REQUEST`.
  Its size counts toward the project size.

### 36. Cache and queue

- The cache key, beyond what section 8.4 lists: the list of data files and the list of design files
  (besides their content). A job sees only what went into the key: the design files, the headers
  (`.vh`, `.svh`), the data files and other `.v` and `.sv` files that are not testbenches.
- The cache takes successful builds and failures that depend only on the project (Verilator errors,
  `sim.wasm` size exceeded). `BUILD_TIMEOUT`, `BUILD_OOM` and `TOOLCHAIN_FAILED` are not cached:
  they depend on the server load, and a repeated build may pass.
- Identical builds that arrive at the same time run once: the other requests wait for the result.
- Eviction is by the time of last use (the modification time of `meta.json`), at every
  write to the cache.

### 37. Limits beyond section 8.5

Added after the automatic security review; each has a test.

- **The job folder is untrusted data.** The service reads the result and the build files without following
  symbolic links, only regular files and not above a limit (`result.json` — 8 MB, the build
  files — the `sim.wasm` size limit). The service runs as root and sees `/etc/fpgasim`; through a link
  it would give someone else's file out.
- **Project parsing is linear in size.** The first version took quadratic time and stopped the service on a file of unclosed `/*`, on thousands of
  modules and on a `.cst` of only semicolons.
  Parsing runs in a separate thread.
- **Not more than 240 checks per minute from one key** (`checks_per_minute`); builds stay at 30.
- **Not more messages than:** 100 `.cst` notices, 500 Verilator warnings (all errors are kept,
  their number is limited by `--error-limit 30`).
- **The request body** is not more than six times the project size plus 1 MB: in JSON a character can be written
  with six bytes. Above this the answer is 413 before parsing.

### 38. Job launch: additions to the command in section 8.1

> **Changed later.** The out-of-memory sign is replaced by decision 43: the `oom_kill` counter in the job cgroup.

- `-e HOME=/tmp`: user 10001 has no home folder, and Emscripten and clang look for it
  (the stage 0 measurement ran the same way).
- `--name fpgasim-job-<id>`: the service stops the container by this name when the time is exceeded
  and when the request is cancelled.
- The out-of-memory sign: the compiler process is killed by signal 9 (the job script reports `oom`)
  or the container ended with code 137.
- The isolation test checks the absence of a network by an empty routing table and by a refused connection,
  not by the list of interfaces: in a container without a network, Docker Desktop shows tunnel stubs.

### 39. Server tests, local server and development key

- `make test-server` runs pytest in a container of the service image (`fpgasim-api:dev`, target `test`
  in `Dockerfile.api`) with the Docker socket; the repository is bound at its own path, because Docker binds
  the job folder by a path on the machine. For a quick edit the tests also run without a container:
  `cd server && uv run pytest`.
- `tools/dev/server.sh run` (`make dev`) — the server on `localhost:8080`; `tools/dev/server.sh with
  <command>` starts the server on a free port for the time of the command (`make test-examples`). The development
  key is created by `fpgasim-admin` at the first start and lives in `.fpgasim/` (it does not go into Git).
- `make test-examples` runs in Node the examples from `examples/` and the projects from
  `server/tests/projects/` that have an `expect.json`, in modes `all` and `ports`.
- The service dependencies are pinned in `server/uv.lock`. The service image takes the Docker client and `uv`
  from the images `docker:cli` and `ghcr.io/astral-sh/uv:latest` (moving tags).

### 40. Deployment

- `deploy/deploy.sh` passes the state of `HEAD` (not the working tree) to the VPS, runs
  `deploy/remote.sh` there detached from the SSH session and waits for the result: building the tools image from scratch
  takes about half an hour.
- The service image gets a deployment tag (`fpgasim-api:<date>-<commit>`). The deployment log is
  `/var/lib/fpgasim/deploy/releases`; the current deployment and the two previous ones are kept,
  and `deploy/rollback.sh` returns the previous one.
- `fpgasim-admin` on the VPS runs through the wrapper `/opt/fpgasim/deploy/fpgasim-admin`: the utility works
  inside the service container, because `/etc/fpgasim` belongs to root.
- The settings in `/etc/fpgasim/config.toml` may be absent: the defaults of section 8.5 apply.

### 41. The Docker socket of the service is a deliberate risk of spec section 8.1

The service starts jobs with the `docker run` command, and for this it gets the Docker socket (section 8.1).
Access to the socket equals root rights on the VPS: if a code-execution vulnerability is found in the service,
the neighboring services of the host are also at risk. The automatic security review noted this
and proposed a socket proxy. The proxy is not accepted: it would have to allow creating containers,
and creating a container with an arbitrary folder binding gives the same root rights; only a
proxy that checks the request body would help, and that is a separate service with its own upkeep.

What is done instead:

- the service itself does not run foreign code: it only parses the project files as text and writes them into the job
  folder; the file names are checked, and the parameters go to the job as a list, without a shell;
- everything that comes from the job folder counts as untrusted (decision 37);
- the service container runs with a read-only file system, without privilege escalation,
  and keeps only the capabilities `DAC_OVERRIDE` and `FOWNER` (deleting job files);
- the service is visible from outside only through nginx, and without a key one operation answers: `health`.

When to revisit: when services with data that must not be lost appear on the VPS, or when
the build server opens to outsiders — then jobs should run in a separate service
without a network, and the service should keep the queue.

### 42. C code insertions in a design are not built

Verilator accepts `$c("…")` and the directives `` `systemc_* ``: the text goes into the model as C++ code
without a warning. Through the Emscripten macros such code becomes arbitrary JavaScript
in `sim.mjs` and runs in the browser of whoever opens someone else's project. Checked by running: both a direct
`$c` and a name assembled by concatenation in a macro (`` $``c ``) pass Verilator 5.050 silently.

Before the build, the server searches the design files and headers (without comments and strings) for: the word `$c` with digits
or without, the directives `` `systemc_* ``, and a `$` that is not followed by a letter (this is how a name is assembled
by concatenation; the forms `[$]` and `[$:N]` are allowed). A finding is the error `C_CODE_UNSUPPORTED` with a file
and a line, and the build does not start. DPI functions (`import "DPI-C"`) need no separate check:
the build has no implementation for them, and linking ends with an error.

A check of the source text is not strict protection but a barrier against the known paths. When
projects start to be exchanged between learners, return to the question: the reliable way is to check that the C++ code
Verilator creates contains nothing except what it creates itself.

### 43. Fixes from the independent review of stage 3

A second agent checked the diff of the branch; the confirmed defects are fixed, and each has a test.

- **Parsing `IO_LOC`** on a line with thousands of pins separated by commas took quadratic time and
  stopped the service. The pin list is now split by commas; more than two pins is `CST_SYNTAX`.
- **Out of memory** is determined by the `oom_kill` counter in the container cgroup: Verilator and `em++` are
  wrappers, the kernel kills their descendant, and the exit code does not show it. A Verilator failure is cached
  only when it named an error in the project itself.
- **Leftovers of the previous run.** At start the service removes the job folders and stops its own
  job containers (it finds them by the label `fpgasim.jobs=<data folder>`). A job has its own time limit
  (`maxSeconds`, the build limit plus 15 s): it ends even if the service is restarted.
- **The jobs folder is closed** to other users of the machine (rights 700): it holds the users' sources,
  and the service takes the build files from it.
- **The service does not pull the build image** (`--pull never`): no image means `TOOLCHAIN_FAILED` at once.
- **An unforeseen failure** gives a generic reply (`500`, code `INTERNAL`) and a log line with the cause;
  the cause is not shown to the client. Handled separately: a path named as both a file and a folder; a file
  name longer than 255 bytes; a pin number that is not ASCII digits; a corrupted `keys.toml` (the previous
  keys stay in effect, the cause is in the log); a truncated request body. Requests for build files also go to the log.
- **A top module without ports**, named explicitly, is the error `TOP_NO_PORTS`. A SystemVerilog header
  with `import package::*;` is parsed.
- **Deployment.** If the new deployment did not answer `/v1/health`, `deploy/remote.sh` returns the current
  one itself and ends with an error; only answering deployments go into the deployment log. The rollback removes
  the image of the cancelled deployment. The remote part is detached from the SSH session (`setsid -f`): before, the first
  `ssh` waited for the end of the build.

What did not change, deliberately:

- **A client disconnect does not interrupt the build** (uvicorn does not cancel the handler): the build runs
  to the end and gets into the cache, and the slot is busy no longer than the build limit.
- **There is no project in `server/tests/projects/` for `CLOCK_EXTRA`:** Tang Nano 20K has one clock pin,
  and a project cannot produce this code. A test on an invented board with two clocks checks it
  (`test_clock_extra_on_board_with_two_clocks`). A project will appear together with a board that has
  more than one clock pin.
- **The text of `TOOLCHAIN_FAILED`** contains the tail of the tool output with paths inside the container:
  section 7.6 requires these 40 lines for the report, and there are no secrets in them.
- **Cache eviction** may delete an entry whose file the reply has just promised: this is possible
  only with a cache smaller than a few builds; it is not observed with the 2 GB limit.
- **With the DNS record in Cloudflare Proxied mode** the reply must arrive within 100 s, while a build request
  in the worst case lasts 120 s (60 s of queue and 60 s of build). A client that did not wait out the queue
  gets 524 from Cloudflare instead of `BUSY`; in both cases the build must be repeated.

### 44. The small model is built as one translation unit

The first deployment showed a cold build of `blink3` on the VPS in 5.5 s against the limit of 5.2 s (the stage 0 time,
4.3 s, plus 20%). The cause: linking grew from 1.8 to 2.55 s, because the core now includes
the whole runtime, not the loop of the bench; compiling grew from 2.1 to 2.4 s.

The fallback variant of decision 6 is accepted: if the model files together with the shim number no more than nine,
they compile as one translation unit with the prebuilt header. The headers are parsed
once; on the Mac compiling `blink3` takes 0.38 s instead of 0.98 s. A larger model still
compiles with one process per file: one unit would remove its parallelism and need
more memory. Verilator splits a model into files by size, so the number of files is a fair sign
of size. The core speed did not change (the same flags, the same linking).

Linking was not touched: `wasm-opt` takes 1.2 s of it, and dropping it (`-O1` at link time)
contradicts decision 3 and enlarges `sim.wasm` by a third.

### 45. Fixes from the security review after the merge of stage 3

- **The check for C code insertions (decision 42) could be bypassed through a data file:** `` `include `` accepts
  a file with any extension, and `.hex` and `.mem` were not checked. Now everything the job sees is checked.
  The macro quote (`` `" ``) is removed before the check: the parser counted the text between two such quotes
  as a string and skipped it.
- **The job folder had no size limit:** it lies on the VPS disk, and a job could fill it within its 60 s.
  The service counts the folder size once a second and after the job; above the limit
  (`job_disk_bytes`, 512 MB) the container is stopped, the error is `BUILD_DISK_LIMIT`, and it does not go into
  the cache.

## 2026-11-19. Stage 4: interface skeleton and running in the browser

### 46. An unsaved edit is stored next to the file; a build saves the edits

Spec section 9.2 requires writing unsaved edits to the storage after 300 ms, but does not say
where they lie and what the build takes.

- The `files` storage record got an optional field `draft`: the editor text that is not yet
  saved. The field `content` is the saved content. An edit equal to the content is erased.
- Saving (Ctrl/Cmd+S) saves all project files at once: the edit becomes the content.
- "Build" first saves all edits, then sends the content. Reason: building what
  is not in the saved files would diverge from the project export and from the folder on disk (stage 10).
- A `fpgasim.json` that does not parse as JSON is not sent to the server: the interface itself issues the
  message `CONFIG_INVALID` with the file `fpgasim.json` and the parser text.

The exchange format and the `spec/` schemas are not affected: this is the internal browser storage.

### 47. The open project is recorded in the page address

The criterion "reloading the page keeps the project and the unsaved edit" requires returning
to the workspace, not to the list. The identifier of the open project lives in the address: `#p=<id>`.
A link with a key (`#key=…`, section 8.6) is parsed earlier and removed from the address.

### 48. Core host: what the page does and what the Worker does

- The page receives the build files (`sim.mjs`, `sim.wasm`) through `fetch` with a key and passes them to the Worker
  with transfer of ownership. The key does not reach the Worker.
- Besides the protocol messages (a JSON string and an `ArrayBuffer`, section 4.1), two transport
  service objects go between the page and the Worker: `{ load: { mjs, wasm } }` from the page
  and `{ transport: "ready" }` or `{ transport: "failed", text }` from the Worker (item 1 of section 4.7).
  They are not part of the core protocol.
- The Worker is an ES module: `sim.mjs` loads in it through `import()` of a temporary address (Blob URL).
- The page accumulates the toggle counters "since the start" itself from all frames and zeroes them at the `ok` reply
  to `configure` and `reset`: the frame after such a reply already belongs to the simulation from the start.

### 49. The stage 4 speed criterion is measured at multiplier `max`; at `max` the batches run back to back

> **Changed later.** Changed by decision 107: the batches run back to back at any multiplier while the core cannot keep up. The phrase "at multiplier 1 the ratio equals one by construction" holds only for light designs.

The criterion requires a speed ratio not below 1.16× (decision 11). At multiplier 1 the ratio equals
one by construction, so after a start by the button the end-to-end test sends `speed` with the value `max`
and after 3 s of real time checks three numbers: `net(15).toggles ≥ 4`, the ratio over the whole window
(the increase of simulation time to real time) and the ratio from the last frame — both not below
1.16. The multiplier is also chosen in the top bar (decision 56); the test sends the command itself.

At multiplier `max` the host calls `fs_tick` back to back, not once per 16 ms (`web/src/sim/worker.ts`):
while the state is `running`, the multiplier is `max` and a batch lasts at least 6 ms (the core is busy computing,
not idle as with a design without a clock), the next batch is scheduled through `MessageChannel`
right after the incoming messages are handled; otherwise the batches run on a timer. The batch budget in the core
(12 ms) did not change, so `pause` takes effect within one batch at most. Spec section 5.3 and the table
of section 4.8 are extended. The host for Node (`tools/headless/core.mjs`) did not change: it counts by steps.

Reason. The stage 0 measurement (1.45× on battery) ran without batches, and with a call once per 16 ms the core computes
at most 12 ms of 16, that is 75% of the time: on mains this gave 1.40–1.47×, on battery in
power-saving mode — 1.05× (the author's measurement), below the threshold. The rejected replacement was to count the threshold from 75% of the
stage 0 speed (0.87×): then `max` on battery is hardly faster than real time. The author chose
back-to-back batches on 2026-11-19. After the fix: 1.88× on mains, 1.35× on battery (`lowpowermode 1`).

### 50. End-to-end test bench

- `make e2e` (`e2e/run.sh`): the build server in a container on a free port (`tools/dev/server.sh
  with`), the interface as a production Vite build (`vite build`, then `vite preview`) on another free
  port, Playwright with Chromium. Free ports are needed so that the tests run next to `make dev`
  and next to other agents.
- The server allows only the given addresses in CORS, so `server.sh with` got the variable
  `FPGASIM_CORS_ORIGIN`: the interface address is written into the bench `config.toml`. The production server
  is not affected.
- The tests run on the production build with the parameter `?debug=1` (section 9.7), and the key is passed by the link
  `#key=…`. One worker: the speed test measures the ratio to real time.
- `make check` includes `make e2e` (spec section 11.3). Chromium downloads into the Playwright cache
  with the command `npx playwright install chromium` at the first run.
- Playwright 1.65.1, as in the measurement bench.

### 51. Style check of `tools/**/*.mjs` and `e2e/`

What decision 17 deferred is now connected: the target `make lint-scripts` (part of `make lint`). ESLint
and Prettier come from `web/node_modules`, the rules are in `web/eslint.scripts.config.js` (run from the repository
root: otherwise ESLint does not check files outside the folder of its rules). The `.mjs` scripts use the
`recommended` set, the `e2e/` tests use `strictTypeChecked` and type checking. Eight scripts of `tools/`
are reformatted by Prettier without a change of behavior.

### 52. Scope of the stage 4 interface and additions to `window.__fpgasim`

- Versions: Vite 8.3.8, React 19.3.1, Zustand 5.1.0, CodeMirror 6, `idb` 8.0.4, Vitest 5.1.1.
- The workspace layout, the top bar, the labels and the messages are described in decisions 56, 57 and 59.
  "Open folder" and "Upload archive" on the projects screen are done at stage 10 (decisions 96, 97, 99).
- An empty project is created with an empty file `top.v`. An example is created without `expect.json`.
- `window.__fpgasim` beyond section 9.7: `state()` also gives `loaded` and `build` (the state of the
  last build: `none`, `building`, `ok`, `failed`, `error`); `net(pin)` also gives `flags`;
  the new method `editor()` gives the open file, the cursor place, the message marks in it and the list of files
  with an unsaved edit. The stage 5 additions are decision 63.
- The `projects` storage record beyond section 9.2 carries the field `board` (the project list needs the board).
  It is always `tang-nano-20k`: there is one board, and the project settings dialog shows it without a choice
  (decision 71).
- A core failure (`error` without `id`) shows in the "Messages" tab next to the simulator notices.
  A message of unknown type is skipped with a note in the browser console. A core message that
  does not parse stops the simulation with the error `BAD_CORE_MESSAGE`.

## 2026-11-19. Stage 5: board, LEDs, buttons, time control

### 53. Board drawing: what is drawn and from where; assumption 10

- The drawing (`web/src/board/`) is built from the board file: the outline and sizes from `geometry.width`
  and `height`, the USB connector and the chip from the points `usb` and `chip`, the header contacts from
  `headerLeftX`, `headerRightX`, `headerFirstY`, `headerPitch` and the order of `headers`, the parts from
  their own `geometry`. The USB connector size in the drawing (9 × 6.2 mm) and the contact side (1.7 mm) are
  constants of the drawing code: the board format does not have them, and the format did not change.
- The `devices` in the board file have no coordinates, so they are shown as a gray list under
  the drawing with a version label ("will appear in version 2", "there will be no model"), not on the drawing itself.
  To put them on the drawing, a device needs the field `geometry`: this is a format change, and it is not
  part of the stage.
- The contact color: the frame is the state (taken by a design port, free, onboard part, clock, forbidden),
  the fill is the net level, if the net is in `configure`. Being taken by a port outranks the state from the board
  file, and a prohibition outranks being taken.
- A part whose type has no widget (before stage 7 — UART and WS2812; their widgets are decision 80) is shown as a gray plate with a label.
  The LED labels do not fit at the 2.2 mm pitch: the common beginning ("LED") is written once to the left
  of the row, and the numbers stay under the LEDs.
- **Assumption 10 of section 15.1** (the color of the built-in LEDs, the board sizes, the position
  of the elements). The sizes 22.55 × 54.04 mm in the board file match those recorded in the spec; the agent cannot
  check the LED color and the element positions against the real board. The item stays
  with the author ("rate how recognizable the board is", spec section 12); the fallback is an edit of `boards/tang-nano-20k.json`,
  and the drawing code does not change.

### 54. LED: brightness per frame, instantaneous level on pause

- The brightness per batch is the share of time the net is at the active level (spec section 6.1), and the display is smoothed
  with a time constant of 30 ms at every screen frame.
- If nothing drives the net (the net flags show neither an FPGA nor a part), the LED is off.
  Otherwise a built-in LED with `activeLevel: 0` would light up in a design that did not connect it:
  the level of such a net is zero.
- On pause the LED shows the instantaneous pin level. Reason: the frame after a step carries the share
  over the whole step, and after an "until output changes" step in `blink3` the LED looked off while
  the pin was at the active level (found by an end-to-end test). Spec section 6.1 is extended.
- `window.__fpgasim.part(id).brightness` gives the brightness from the last frame without smoothing
  (`pwm_fade` is checked by it), and `shown` is what is on the screen.

### 55. Button: mouse, Shift, keys

- A mouse press holds the button until release (the release is caught on the window, not on the drawing).
  A click with Shift latches the press, and the next click releases it.
- The key from the `key` setting presses the button when the focus is neither in the editor nor in an input field
  (spec section 9.4); combinations with Ctrl, Cmd and Alt are skipped. A key release is accepted
  from any place, otherwise a key pressed before moving to an input field would stick.
- The widget sends `press` and `release` only when the resulting state changes: the mouse, the key and the latch
  add up.

### 56. Top bar: step, speed multiplier, ratio, keyboard shortcuts

- Step: the "Step" button and the list of step kinds (1, 10, 100 clocks, until output changes, a given time).
  The step time is entered in milliseconds of simulation time. For a design without a clock the clock step is off.
  While a step runs, "Run" and "Step" are off; the interface learns the end of the step from the `state` message.
- Multiplier: the list of spec section 5.3 and "other…" with an input field. The initial value comes from
  `sim.speed` of the file `fpgasim.json`. After a new build the chosen multiplier is sent to the new core.
  The list shows the multiplier from the last `state`, so a `speed` command that bypasses the list
  (`window.__fpgasim.command`) is visible in it.
- The actual ratio is shown next to the multiplier while the simulation runs; it is removed from the status line
  (the layout of section 9.3 does not have it there).
- Ctrl/Cmd+Enter ("Build") and Ctrl/Cmd+S work in the whole workspace.

### 57. Workspace layout and the bottom panel

- The three top areas (files, editor, board) and the bottom panel are separated by borders that
  move with the mouse; each of the three areas can collapse into a narrow strip. The free space
  goes to the editor, and if it is collapsed, to the board.
- The layout is stored in `localStorage` under the key `fpgasim.layout.<project id>`
  and is erased when the project is deleted. It is not put into the project record in IndexedDB: moving a border
  would change the project modification time.
- The bottom panel: the tabs "Messages" and "Nets". The stage 4 net table is kept as a tab: the toggle
  counts and shares are visible nowhere else until the signal panel (stage 8). The stage 4 test got
  a click on the "Nets" tab before reading the table; its checks did not change.
- The tabs "Signals", "Waveforms", "UART terminal" and "Testbench" are done at their own stages
  (decisions 80, 82, 86, 92).

### 58. `/v1/check` check on edit and on save

- The check runs after 2 s of idle time after an edit and at once on save (spec section 9.5, item 5).
  It sends the editor text together with the unsaved edit: otherwise the check "on edit"
  would check the previous content.
- The check reply replaces the messages in the "Messages" tab and the marks in the editor; the simulation and the build
  result are not touched. `window.__fpgasim.diagnostics()` gives the shown list.
- A build cancels the deferred check and discards the reply of a running one. A server refusal during a check
  (busy, request limit, no connection) is not shown: the check is a hint while editing.
- The server limit is 240 checks per minute per key; one check per 2 s of idle time fits into it.

### 59. Messages: labels by level, explanations

> **Changed later.** The number of codes grew: decision 90 added five `TB_*` codes, and there are now 66 shown codes.

- Marks in the editor: an error is red, "important" is yellow, "note" is gray (the levels `error`,
  `warning`, `info` of CodeMirror), hidden codes are not marked. The hover text is the short text
  and the explanation.
- The "Messages" tab: errors and "important" as a list, notes under a collapsed heading, simulator
  notices with the time. The "?" button expands the explanation and the original compiler text.
  `TOOLCHAIN_FAILED` has the button "Copy report" (spec section 7.6).
- The explanations (`explain`) are written for all codes of `spec/diagnostics.json` that are shown,
  not only for the table of section 7.6: 61 codes. `make check-spec` now requires an explanation
  for every non-hidden code. The texts wait for the author's proofreading.

### 60. ESLint catches interface strings that bypass the dictionary

The criterion "the style check finds Cyrillic in component files" is met by the rule
`no-restricted-syntax` in `web/eslint.config.js`: Cyrillic in a string, in a template string and in markup text
is an error in all files of `web/src` except the tests. The rule looks at the parse tree,
so comments in Russian do not bother it. The widgets give hints as dictionary keys.
The part labels and the device names come from the board file — this is data, not interface strings.

### 61. Project files and project name; what of the "Files" area is deferred

- Done what the stage 4 entry deferred: creating, renaming and deleting a file; renaming
  a project; deleting a project and a file in two clicks (the first one asks).
- A file name: Latin letters, digits, dot, hyphen, underscore; folders through "/".
- The deferred was done later: file kind icons and marks of the top module and testbenches — stage 9
  (decision 94), file upload and export — stage 10 (decisions 98, 99). The project settings dialog and the choice of the top
  module at `TOP_AMBIGUOUS` are done at stage 6 (decision 71).

### 62. Examples `pwm_fade` and `shift_chain`

- `pwm_fade`: PWM with a period of 256 clock cycles, the level changes once per 131,072 clock cycles from 0 to 255
  and back. The numbers are chosen so that the brightness is computed exactly: in the middle of a step over 4096 clock cycles
  it equals level / 256. `led[1]` is on constantly at 1/8 — for comparison and as an exact number of
  toggles in `expect.json`.
- `shift_chain`: two chains of three flip-flops with a shift once per 8,388,608 clock cycles, the input is button
  S1. Both modules and the top one are in one `top.v`. Verilator issues `BLKSEQ` on each of the three
  lines with "="; the build succeeds.
- Spec section 2.7 put `pwm_fade` at stages 6–7, section 12 at stage 5; done per section 12,
  and section 2.7 is fixed.

### 63. Additions to `window.__fpgasim` at stage 5

- `state()`: `stepping` (a step has started and not ended), `checks` (the number of completed checks).
- `part(id)`: besides the state bytes — the widget numbers (`brightness`, `shown` for an LED;
  `pressed`, `latched` for a button) and `point` — the center of the part in the drawing area, where the test clicks.
- `pins()`: the header contacts with state and level. `messages()`: the shown messages
  with level, short text and explanation. `layout()`: the layout.

### 64. Fixes from the independent review of stage 5

A second agent checked the branch by `git diff main...HEAD`. It found no blocking defects and no regression of stage 4.
Fixed:

- **The board buttons stuck.** Losing the window focus now releases what the key and the mouse held
  (the latch stays). A key release is accepted with Ctrl, Cmd, Alt held too; a key is also recognized
  by its place on the keyboard (`event.code`), otherwise releasing "1" with Shift held came as
  "!". A press is accepted only from the left mouse button.
- **Reset and a new build.** The core releases the buttons itself then, while the drawing remembered the latch: now
  it forgets the presses at reset, at a new build and when the core stops.
- **A press on pause was not visible.** The core sends no frame on a part command. After a part command
  on pause the interface sends a step of zero length (`step`, `unit: "time"`, `ps: "0"`): the core answers
  with a frame with the new levels, and time does not run. The protocol did not change.
- **A long step could not be interrupted.** The "Pause" button works during a step too.
- **The `/v1/check` check.** A new edit makes the reply of a running check stale (its line numbers
  are from the previous text). A check that falls in the time of a build is deferred, not lost.
- **Ctrl/Cmd+S outside the editor** is recognized by the key place too: in the Russian layout it is "ы".
- **Layout.** The upper limit of an area size is counted from the window: the neighboring areas keep
  at least 240 pixels.
- **Explanations.** `FILE_NOT_FOUND` also names `design.constraints`; `PINS_IGNORED` also names disabling
  the binding file with the field `design.constraints`; the example with `cnt + 1'b1` is removed from `WIDTHEXPAND`
  (Verilator does not warn on it: in `blink3` the notes stand on the comparison lines, not on the addition);
  `SELRANGE` clarifies that zero is read in the simulator.
- **Tests.** `pwm_fade` also checks the fourth control moment (the level falls). Added
  scenarios: a press on pause, a release with Shift, a reset with a latched button, interrupting a step.

## 2026-11-19. Stage 6: breadboard and pin binding

### 65. The interface computes the binding from the `pins` field; changing the binding and parts needs no build

- The interface determines the binding source itself by the same rule as the server (spec section 2.5):
  `design.constraints`, else the only `.cst` of the project, else the field `pins`. Several `.cst` without
  a choice are a conflict: the table is read-only, and the dialog sends the user to the project settings.
- The interface computes the binding from `pins` by `resolved.ports` of the last build
  (`web/src/project/config.ts`, `bindPins`): the same rules and codes as in `resolve.py`
  (`PINS_NO_PORT`, `PINS_NO_PIN`, `PINS_PIN_TWICE`, `PIN_FORBIDDEN`, `CLOCK_EXTRA`, the clock is a one-bit
  input on a clock pin). The interface does not parse the design text: the port names and widths come
  from the server. Only the server parses the binding from `.cst`; the interface takes it from `resolved.pins`.
- Reason: the criterion "after binding in the dialog the simulation starts, and the build request counter does not
  change". The build does not depend on the binding (the binding is not in the cache key, decision 35), so
  a new `configure` is enough for the core.
- Writing the settings from the dialog (`updateConfig` in `actions.ts`): `fpgasim.json` is rewritten
  as a whole, keeping unknown fields. An unsaved edit of this file in the editor is
  saved before the dialog opens (decision 73). After the write: the drawing is rebuilt, the core gets `configure` (the simulation starts
  over; if it was running, it starts again, and the speed multiplier carries over), and `/v1/check` runs.
  The same happens on saving a `fpgasim.json` edited in the editor.
- If the new `configure` differs from the current one only in part settings, `partSettings` commands
  go instead — the simulation is not reset. The core applies `partSettings` on top of the previous
  part settings, so the interface sends all settings with defaults: otherwise a setting removed
  from the file would stay as before (found by the end-to-end test `debounce`). On pause after `partSettings`
  a step of zero length runs, as after a part command (decision 64).
- A core refusal (`CONFIG_INVALID`, `SETTINGS_INVALID` — for example, a role with an error in a hand-edited
  `fpgasim.json`) shows as a notice in the "Messages" tab; the previous setup stays.
- While the core is loaded, the source with which the build configured it (`resolved.constraints`) is in effect:
  a `.cst` file created or deleted after it takes effect with the next build, and until then the dialog
  shows a warning. Before the first build the source is determined from the project files.

### 66. The "Pin binding" dialog and export to `.cst`

- The table rows are all port bits in the order of `resolved.ports`. Before the first build there are no ports,
  and the dialog asks to build the project.
- Two ports cannot be bound to one pin: choosing a taken pin is rejected with an explanation,
  and the file does not change. A forbidden pin (59–62) can be bound, and a warning stands under the row;
  the same `PIN_FORBIDDEN` warning then comes from the server with the check.
- The pin list holds all pins of the board file with name and state, not only the header contacts:
  design ports are also bound to the onboard parts.
- Export: the file `<top module>.cst` (with a number if the name is taken), and the field `pins` is removed
  from the file; if `design.constraints` is set or the project has another `.cst`, the name of the new file is
  written into it. The core is not touched:
  the binding is the same. `resolved` in the interface memory is marked as coming from this file, so that the
  table does not empty before the next build. A repeated build gives the same `resolved.pins`
  (end-to-end test) and hits the cache.

### 67. Breadboard field

- The field stands to the right of the board in the same Canvas and appears when the breadboard has a part: an empty
  field would take a quarter of the width from the board drawing. A cell is 9 mm, two columns, as many rows as
  fit the board height; a part with a cell outside these limits widens the field.
- The interface chooses the cell of a new part (the first free one). Rearranging parts with the mouse is not
  done: the same motion is taken by dragging a wire. The cell can be changed in `fpgasim.json`.
- A line goes from a part to a header contact; for a pin that is not on the headers (buttons S1, S2,
  clock) there is no line, and the pin number is written under the part.
- Dragging from a part to a header contact changes the pin of parts with one pin that are not
  controlled by the mouse (the LED, the probe). For a button and a switch a mouse press is a part
  command, and the pin changes in the dialog. Spec section 9.4 is extended.
- Under the drawing are the buttons "+ Part" and "Binding" and the part list with a settings button on each
  (breadboard parts first).

### 68. Part dialog: add, edit, built-in parts

- One dialog for three cases: a new breadboard part, editing a breadboard part, a built-in board
  part (the field `boardParts`: "enabled" and settings; the pins of a built-in part do not change).
- The settings form is built from the field `settings` of the part description: a list for `enum`, a checkbox for
  `boolean`, an input field for a number and a string; the values are checked for type, list and bounds before
  writing (`settingProblem`), and the core makes the same checks.
- The type list holds the types that have a widget, and if the core is loaded, also a model in it
  (`partTypes` from `ready`): `uart` and `ws2812` appeared at stage 7 (decision 80).
- A part name is unique among breadboard and built-in parts: in `configure` they go as one list.
  A part from `fpgasim.json` with a taken name does not go to the core.
- Only differences are written to the file: for a breadboard part — from the description defaults, for a built-in one — from
  the board file. A `boardParts` record without differences is removed.
- A disabled built-in part does not go into `configure` and is drawn pale.

### 69. Switch and probe widgets

- The switch changes position on a click and on the key from the `key` setting; the position is read
  from the part state byte. The probe is a circle with the level color and a tip; the hint has the label
  from the `label` setting, the level, the share and the frequency. The probe net is visible in the "Nets" tab; it got into the signal
  panel and into the recording at stage 8 (decision 82).

### 70. Example `debounce`; `togglesMin` in `expect.json`; parts in the example runners

- The design: a synchronizer of two flip-flops, an edge counter without suppression and a counter with suppression
  (a level is accepted when it held for 270,000 clock cycles — 10 ms). The button bounce is `bounceMs: 5`
  of the built-in part `s1` in the `fpgasim.json` of the example.
- Why "at least 3 per press with release": the bounce interval is at most 2 ms, so within
  5 ms the contact manages to open and close at least once both after the press and after the release.
- The lower bound `togglesMin` is added to `expect.json`: the exact number of edges without suppression
  depends on the random number generator of the part, while the criterion is "more than 1". Spec section 11.2
  is extended. The least significant bit of the counter toggles on each of its increments, so the number
  of toggles of the pin equals the number of triggers.
- Both runners (`tools/headless`, `tools/native/run_examples.py`) compose `configure`
  with the changes from `boardParts` and the parts from `parts`, as the interface does.

### 71. Project settings dialog and top module choice

Deferred to stage 6 by the stage 5 entry (decision 61).

- The dialog (the "⚙" button in the top bar) writes the field `design`: the top module, the visibility, the binding
  file, the design files, the parameters and the macros (one per line "NAME = value"). A default value
  is not written to the file. The board is shown without a choice: there is only one. The design settings take effect with a build.
- At `TOP_AMBIGUOUS` the message has buttons with the candidates: a click writes `design.top` and starts
  a build.
- The project menu with export is done at stage 10 (decision 98).

### 72. Additions to `window.__fpgasim` at stage 6

- `state().builds` is the number of `/v1/build` requests since the project was opened (it checks "without a build").
- `binding()` — the binding source, the file, the table rows, the bound pins, the warnings.
- `parts()` — the drawing parts with the place (`board`, `breadboard`) and the "enabled" flag.
- `pins()` got `point` — the contact center; `part(id)` got `on` for a switch and `level` for a probe.
- `file(path)` — the saved content of a project file.

### 73. Fixes from the independent review of stage 6

A second agent checked the branch by `git diff main...HEAD`. It found no blocking defects. Fixed:

- **A `fpgasim.json` valid as JSON but not per schema crashed the page.** A part without `pins`, a `null`
  entry in `parts` or `pins` caused an exception when drawing and stopped the core reconfiguration queue.
  Now entries of the wrong form are skipped when reading (`breadboardParts`, `bindPins`,
  `projectParts`) — the server reports them with the message `CONFIG_INVALID`; a failure of one reconfiguration
  does not stop the next ones.
- **Saving a `fpgasim.json` with a JSON error reset the simulation** and removed the binding and the parts.
  Now with an unparsable file the drawing and the core stay as before (spec section 9.5, item 2).
- **The numeric settings field did not accept a fraction:** "0.5" by characters turned into 5. A number in the form
  is stored as text while it is typed, and turns into a setting at check and write.
- **A bit name in the `pins` field** is parsed as the server does: `clk[0]` for a one-bit port and `led[01]`
  bind, a multi-bit port without a bit number is `PINS_NO_PORT`.
- **The "pin taken" check** runs on the text that is written (together with the unsaved
  edit of the editor), not on the saved file.
- **The binding source** until the next build is the one the core is configured with (decision 65): before,
  a `.cst` created after a build emptied the table, and the next edit of the parts removed the binding.
  Deleting and renaming `fpgasim.json` reconfigures the core at once.
- **Simulator notices** are erased at `configure` without a build, as at a build.
- **A part cell** from the file is accepted within 8 × 64; outside it the part gets a free cell.
- **The project settings dialog** shows the autodetection result of the last build: the top module,
  the design files, the testbenches, the binding file (spec section 2.5).
- **Tests.** Unit: a bit name as the server parses it, entries of the wrong form, number input by characters.
  End-to-end: a `fpgasim.json` with a JSON error and with an unfinished part while the simulation runs.

The second review pass (on the commit with the fixes above) found no blocking defects. Fixed:

- **The dialog lost an unsaved edit of `fpgasim.json`:** it showed the saved file and wrote it
  as a whole. Now the edit of this file is saved before the dialog opens.
- **Export to `.cst`** does not start if `fpgasim.json` does not parse (before, the file was created
  and the field `pins` stayed). If the project already has another `.cst`, the new file is written
  into `design.constraints`: otherwise the next build would give `CST_AMBIGUOUS`.
- **"Edit .cst"** opens the file by the project if the file of the last build is renamed or deleted.
- **A string parameter of digits** (`"8"`) is shown in quotes in the settings dialog and stays
  a string: the server passes the numbers and the strings of parameters differently.
- **File writes go one at a time** (saving edits and writing from the dialog): a write that started earlier
  does not return the old text to the storage.
- **The write from the dialog** does not erase entries of the wrong form from `parts`: the server reports them.
- **The probe label** (the `label` setting) is drawn under it in the drawing (spec section 6.5).
- **A disabled built-in button** gets no keys. The sign "→" in a part label is moved
  to the dictionary. Settings changed while the core was starting reach it after the start.


## 2026-11-19. Stage 7: UART and WS2812

### 74. The author confirmed the spec additions made at stage 6

On 2026-11-19 the author confirmed three spec additions from the stage 6 branch (decisions 67 and 70): the breadboard field
appears only when there are parts (section 9.4); dragging a wire does not work for a button
and a switch, and their pin changes in the dialog (section 9.4); the field `togglesMin` in `expect.json`
(section 11.2). The item "for the author" of the stage 6 entry is closed.

### 75. Part `uart`: what spec section 6.3 does not cover

- **Bytes leave in a batch.** Received bytes collect in a 1024-byte buffer in the part. They leave
  as one PART_DATA at the end of a chunk (`onChunkEnd`) or when the buffer is full. At 115,200 baud,
  one message per byte would mean 11,520 messages per second.
- **Bit times count from the start of the frame** by division (`k × 10^12 / baud`), not by adding
  the bit length: the rounding error does not accumulate.
- **Baud estimation window:** the last 64 intervals between edges. The estimate is recomputed
  every 16 edges once the window is full. Spec section 6.3 called any difference of more than 10%
  between the shortest pulse and the bit a mismatch. Review showed a false alarm: at the correct
  baud, byte `0x30` gives a shortest pulse of two bits. So a pulse longer than a bit counts as
  a mismatch only if it is not a multiple of the bit. Cost: a line speed that is an exact integer
  factor below the setting raises no event (garbage in the terminal and `framingError` reveal it).
  The `baudMismatch` event fires at most once per second of simulation time. Its data: `baud`
  (the estimate) and `setting` (the part setting). A settings change clears the window.
- **`framingError`** fires at most once per 100 ms of simulation time, with data `{ "count": N }`.
  At a wrong baud, a framing error occurs on every byte.
- **Transmit queue:** at most 65,536 bytes, extra bytes are dropped. The part accepts bytes both
  from the `send` command and from the PART_DATA message (channel 0) from the interface. The
  interface sends the command.
- **`lineEnding`** is not read by the core: the interface terminal appends the end-of-line bytes.
- Spec section 6.3 is updated.

### 76. Part `ws2812`: what spec section 6.4 does not cover

- **A pulse outside both windows** is read by the nearest window (boundary 525 ns) and counts as
  an error. The color stays visible, so the learner sees both the error and the result.
- **Latching** is one wake-up per pause: 50 µs after the falling edge. If the line toggled in that
  time, the wake-up moves. There is no wake-up cancellation on every bit.
- **Data of the `timingError` event** is the first error of the frame: `highNs` or `periodNs`,
  `bit`, `count` (errors in the frame), `total` (since the start). The period is checked from edge
  to edge inside a frame. The last bit of a frame has no period.
- **LEDs that the data did not reach** keep their color, like a real strip.
- **State in a frame:** u16 LED count, u16 reserve, u32 error counter, RGB triples.
- Spec section 6.4 is updated.

### 77. Part expectations in `expect.json`

The `parts` field (spec section 11.2 is updated): `text`, `bytes`, `colors`, `errors`, `events`.
The set of part event names must match the list. Without the `events` field, no events may occur.
So an example without errors also checks that `baudMismatch` and `timingError` are absent. Three
places run the comparison: `tools/native/run_examples.py`, `tools/headless/run.mjs`,
`e2e/tests/stage7.spec.ts`.

### 78. Stage 7 examples

- `uart_hello`: one line per second, the first with the first clock cycle. The line is idle
  between lines: a 2.1 s run is comparable to `blink3` in speed.
- `uart_echo`: the receiver reads a bit in the middle, with one wait register. Sending a bit
  (234 clock cycles) is shorter than the terminal bit (234.4 clock cycles), so 256 bytes in a row
  are not lost.
- `ws2812_rainbow`: a strip of eight LEDs is a breadboard part on pin 76 (the example's
  `fpgasim.json`). The board has one built-in LED, and the example does not change its `count`.
- `ws2812_badtiming`: the high time of a zero bit is 14 clock cycles (519 ns), between the windows.
  A 0.9 ms run gives two full frames and a third that has not started. The error counter does not
  depend on chunk boundaries.
- **The criterion "9600 versus 115,200"** is checked by a core unit test on a stub engine with
  a given signal shape (`core/tests/script_engine.h`) and by an end-to-end test: the setting of
  the built-in part changes in the dialog on `uart_hello`. There is no separate example: section 12
  of the spec lists four.

### 79. Runtime version 0.2.0; built-in UART and WS2812 in every `configure`

> **Changed later.** The runtime version since decision 109 is 0.2.1. Server deployments with
> both versions are done.

- `core/VERSION` is raised to 0.2.0 (decision 30): the build image label and the cache key change.
  The build server needed a deployment (`make deploy-server`, done in stage 8): without it, the
  production server serves a core without the `uart` and `ws2812` parts.
- The built-in parts `uart` and `ws2812` now go into the `configure` of every project: pins 69, 70
  and 79 appeared in the "Nets" tab. The part holds pin 70 at one (UART line idle).

### 80. Stage 7 interface

- **Terminal log** (`web/src/sim/terminal.ts`) lies next to the frames, outside React state. The
  tab reads it once per display frame. The limit is 256 KB, the screen shows the last 64 KB, and
  the whole log goes into the file. The log starts anew together with the simulation. Otherwise
  the end-to-end test and the learner would see bytes of the previous run.
- **Terminal tab:** one per enabled UART part from `fpgasim.json` and the board file. It is
  visible before the build too. A click on the UART icon on the board opens the tab
  (`PartWidget.tab`).
- **Part events** appear among the simulator notices, one line per part and event kind. A repeat
  updates the line at most once per 250 ms. `ws2812_badtiming` sends about 3000 events per second
  of simulation time: a line per event would make the list useless.
- **Part dialog:** for a part with several pins (UART), each pin may stay unconnected. A new part
  of this kind has its pins unconnected, and a part cannot be added without any pin.
- **WS2812 layout:** the widget fits in a breadboard cell (8.2 mm). A strip is rows of 16. A ring
  has the first LED at the top, clockwise. A matrix takes its width from the `width` setting. The
  color on screen goes through the power 0.45: a real LED already glows visibly at a low value.
- **`PartWidget`:** `hint` receives the pointer position (the color of the LED under it), and
  `status` also returns lists of rows (colors).
- **`window.__fpgasim`:** `part(id)` returns `colors`, `errors` (WS2812), `received`, `sent`,
  `queued`, `terminal` (UART); `partEvents(id)`; `bottomTab()`.

### 81. Fixes from the independent review of stage 7

> **Changed later.** The item on the end-to-end runner of `expect.json` is replaced by decision
> 102: the common runner also compares pins.

The review by a second agent over `git diff main...HEAD` found no blocking defects. Fixed:

- **False `baudMismatch` at the correct baud** on bytes without single bits (decision 75).
- **The `baudMismatch` limiter** was reset by the estimate "within 10%", and the event could fire
  more than once per second.
- **Changing the UART baud on the fly** corrupted the byte being sent and the byte being received.
  Now the frame being received is dropped, and the byte being sent restarts after one idle bit.
- **Changing `order` of WS2812** did not change the shown colors until the next frame. The part
  stores the triples in arrival order and applies the order when it returns the state.
- **The bit number in `timingError` by period** was one too high. Now it is the bit whose period
  was measured.
- **Events of the previous project** could get into the messages of the new one (250 ms window).
  The event queue is cleared when the simulation stops.
- **The event limit in `window.__fpgasim`** is 100 per part: a stream of `timingError` does not
  push out UART events.
- **Terminal output** is appended, not replaced as a whole: mouse selection is kept.
- **Tests.** The end-to-end check "a key in the input line does not press the button" read the
  state after release and checked nothing. Now the key is held. Added unit tests: bytes `0x30`
  without an event, a baud change in the middle of a byte, a color order change, counters after
  reset. The server test `test_info` compares the runtime version with `core/VERSION`.

Not fixed, accepted as is:

- `timingError` fires on every latch (up to 3000 per second of simulation time): spec section 6.4
  requires it. The interface updates the line at most once per 250 ms.
- A UART transmit queue over 65,536 bytes drops the extra bytes without a message.
- In a ring and a strip of 256 LEDs, an LED on screen is smaller than 0.5 mm: the widget must fit
  in a breadboard cell.
- The end-to-end runner of `expect.json` compares only the `parts` field: the `nets` and `notices`
  fields of the stage 7 examples are empty, and the other examples are checked by the end-to-end
  tests of stages 4–6.
- The speed criterion of `uart_hello` is checked by measurement, with no automatic check:
  comparing two speeds on a shared machine would give false failures.

## 2026-11-19. Stage 8: signals and waveforms

### 82. Signal tree and watch

Recording in the core was made in stage 2 (decision 25). Stage 8 is the interface and its own
criteria. The core code and the protocol did not change, and `core/VERSION` stays the same.

- **The tree** is built from the path points in the `signals` response. The interface requests it
  once after the core loads. Next to it stands the group "Board pins": all nets of the current
  `configure` under the names `pin:N` with the name of the port bit. Spec section 6.5 speaks of
  the probe net. All nets are shown, because recording accepts any net of `configure`, and the
  probe is only a way to add a free pin to it.
- The screen shows at most 400 tree rows. Search finds the rest. The expansion of groups is not
  remembered.
- **The watch** is stored in the `watch` field of `fpgasim.json`. Without a `radix` field, the
  number system is decimal: the learner compares a counter with the number of clock cycles. The
  default is recorded in spec section 2.2.
- The name `pin:N` is allowed in `watch`: the value of such a row is the net level from the frame.
  It is not passed to the core (the `watch` command accepts only `sig` numbers).
- The watch list goes to the core with the `watch` command after every `configure` and after an
  edit of `fpgasim.json`. The interface leaves the `watch` field of the `configure` message empty.
  So a watch change does not change `configure` and does not restart the simulation.
- On pause, after `watch`, a step of zero length runs. Without it, the value would appear only
  with the next frame (the same technique as for part commands, decision 64).
- A signal from the file may be missing in the loaded core (another build, `ports` mode). The row
  stays in the list without a value. Memory is not watched and not recorded: the buttons are
  disabled.

### 83. Waveform model

- Each signal has its own arrays: times (`Float64Array`, picoseconds) and values (`Uint32Array`,
  words of 32 bits). Entry number 0 is the value at the start of the span. It does not count as
  a change.
- Time is a number, not a `bigint`: it is exact up to 2^53 ps (2.5 hours of simulation time), and
  search and drawing run without conversions. Beyond this limit, a time rounds to units of
  picoseconds.
- Model from the core record: the first changes of the first `TRACE` are the values at the start
  of the span. The same values at the start of the following messages are skipped (decision 25).

### 84. VCD: export and parsing

- Scopes are parts of the signal path (`top.u_good.q` gives scopes `top`, `u_good` and variable
  `q`). The board pin `pin:15` is written as variable `pin15` in scope `pins`: third-party
  programs read a colon in a variable name in different ways. Our own parser gives the name
  `pins.pin15` for such a file.
- The values at the start of the span go in a `$dumpvars` block at the start time. Changes at the
  same time stand after the block and count as changes. The last line is the time of the end of
  the span. The number of value lines after `$dumpvars` equals the number of changes in the
  record.
- Parsing: the time step comes from `$timescale`. Bits X and Z read as 0 (the simulator has two
  states). Variables of type `real`, `event`, `string` are skipped. One code shared by several
  variables gives several signals with shared data. A repeat of the previous value does not count
  as a change.
- The third-party parser for the acceptance criterion is `pyvcd` (group `dev` in
  `server/pyproject.toml`, the server test image). The end-to-end test saves the exported file and
  runs `tools/wave/read_vcd.py` in this image.

### 85. When the interface requests record data

- There is one record (decision 25). The data is requested whole with the `recordFetch` command:
  when the recording ends (`done`, `stopped`), when the simulation stops (pause, end of a step),
  at the first message about the record, and at every `recordState` while there are at most
  100,000 changes. Sending a larger record every second would slow the simulation down. Such
  a record is shown after a pause or a stop.
- Requests do not overlap: `TRACE` carries no request number, so the host runs them one at
  a time.
- During recording, `recordState` arrives at most once per second of real time, and after a step
  on pause it does not arrive. The number of changes and the span in the status line come from the
  received data.
- `reset` and `configure` erase the record in the core without a message: the interface removes
  its state itself. The waveform stays on screen until the next recording, so the learner can
  inspect and export it.
- A name from `record.signals` that is missing in the loaded core (a signal of another build,
  a board pin without a net in `configure`) does not go into `recordStart`. The row shows
  "not recorded". If no name fits, or there is no trigger condition signal, "Record" explains this
  in the panel and does not start the recording. A refusal by the core (`RECORD_INVALID`) is shown
  there too.
- The data of a finished record is requested once: it no longer changes.

### 86. Waveform panel

- The panel rows are `record.signals` in file order. Reordering and deleting a row edit the file.
  Deleting a row removes the trigger condition on that signal.
- Mode, depth, window (in milliseconds) and trigger condition are written to `record` on change.
  For a multi-bit signal, only "on change" is available in the condition (spec section 2.4).
- The number system of a waveform row is hexadecimal by default and is kept until the project
  closes: `record.signals` of section 2.4 has no place for it, and the stage does not change the
  format.
- The view window follows the recorded span until the user moves it. "Fit all" restores
  following. The wheel zooms around the pointer, with Shift it pans. Keys: `+`, `−`, arrows, `F`,
  `Esc` (remove cursors). Cursor A is a click, cursor B is Shift and click. The value under
  cursor A stands in the signal row.
- Changes less than a pixel apart merge into a filled span. The number of spans of a row is at
  most twice the Canvas width, so the drawing speed does not depend on the record length.
- The hint about slowdown when recording a fast signal (spec section 5.5) stands at the record
  status line.
- The evaluation of embedding Surfer (an optional task of the stage) was not done.

### 87. Additions to `window.__fpgasim` in stage 8

`signals()`, `watch()`, `record()`, `wave()`, `waveChanges(name, from, count)`, `waveView()`,
`vcd()`; `bottomTab()` also returns `"signals"` and `"waves"`. The field shapes are in
`web/src/debug/api.ts`.

### 88. Fixes from the independent review of stage 8

> **Changed later.** The items on `parseVcd` and on the VCD file are replaced by decision 92.

Review by a second agent over `git diff main...HEAD`. Fixed:

- **False `BAD_STATE` on build and on `configure` while running, with a non-empty watch:** the
  zero-length step after `watch` went out when the core was already running. A refusal of this
  step is no longer shown.
- **A finished record was requested again** on every `state` message without `running` (a step,
  a part command on pause). For a record of 2,000,000 changes, that is tens of megabytes per step.
- **Two quick edits of the record list** erased each other: the list was read at the moment of the
  click, not at the moment the file was written.
- **A board pin without a net in `configure`** in the record list cancelled the whole recording
  with a core refusal.
- **A trigger condition signal that is missing in the build** was dropped silently, and the
  recording ran without the condition.
- **A refusal of the `watch` command** did not allow sending the list again.
- The short names of number systems in waveform rows go through the dictionary.

Not fixed, accepted as is:

- Parsing a record of 2,000,000 changes creates a temporary object per change (`decodeTrace`).
  The memory per request was not measured. Now there is one request per finished record.
- Two changes of a signal at the same time are drawn as a span one pixel wide.
- `parseVcd` reads a `$dumpoff` block as normal values and keeps all words of the file in memory.
  This matters for the testbench VCD (stage 9) and does not affect the stage 8 export.
- Editing the record settings from the panel replaces invalid values of the `record` fields with
  defaults.
- For a trigger condition signal that is missing in the core signal list, the panel offers all
  kinds of edge. The core refuses with an explanation.
- The Icarus file sample in the unit test is written by hand. The real file appeared in stage 9
  (decision 92).

## 2026-11-19. Stage 9: testbench

### 89. The `testbench` operation: what is compiled and where it runs

> **Changed later.** The choice of the testbench root is extended by decision 95: if the word
> search for the root finds none, the root is the last testbench of the file.

- **Root module.** Spec section 8.3 names the flag `-s <module>` but does not say which module to
  take. The roots are the modules of the testbench file whose name does not occur in this file
  outside their own text. The testbench names itself (`$dumpvars(0, tb_top)`): such a mention does
  not count. In a file with a design and a testbench (`TB_MIXED`), the root is only the testbench.
  If there is none, the error is `TB_NO_MODULE`.
- **Files.** `resolved.files` and the chosen testbench go into the compilation. Other testbenches
  do not: two testbenches with a module `tb_top` would otherwise interfere with each other. The
  job sees include files and data files.
- **Parameters.** `design.defines` and `design.includeDirs` go to Icarus. `design.parameters` do
  not: Icarus accepts parameters only for the root, and here the root is the testbench.
- **A project with a binding error.** The testbench needs no top module, `.cst` or board. The
  shared part of project parsing (`_project_files`) ends with the list of files. A project whose
  build fails on `TOP_AMBIGUOUS` or on a `.cst` error can still run a testbench.
- **Run folder.** The project files in the job folder belong to the service, and the job does not
  write there. The testbench runs in the copy `/work/run`: its files (`$dumpfile`, `$fopen`)
  appear there too.
- **No cache.** A testbench is short, and its result depends on time (`timeout`).
- **Request limit.** 30 runs per minute per key, counted separately from builds: a testbench takes
  the same job queue.

### 90. Icarus Verilog messages

- Icarus messages have no codes and no columns. The source is the new value `source: "iverilog"`
  (spec section 7.6 is updated). The code is `ERROR` or `WARNING`, like Verilator messages without
  a code. `spec/diagnostics.json` has no such codes, so the interface shows the original text.
- A line `file:line: text` without the word `warning` is an error: this is how Icarus writes
  `syntax error` and `Include file … not found`. Continuation lines (the text starts with a colon)
  and summary lines (`2 error(s) during elaboration.`, `I give up.`) are skipped.
- If compilation failed and no errors are found in the output, the result is `TOOLCHAIN_FAILED`
  with the last 40 lines.
- New codes in the table: `TB_NO_MODULE`, `TB_TIMEOUT`, `TB_OOM`, `TB_DISK_LIMIT`,
  `TB_VCD_TOO_LARGE`. The explanations are written, and the author reads them with the rest.

### 91. Time, output and the waveform file

- **Time.** The job itself watches the 20 s: the count runs from its start and includes
  compilation. The job stops `vvp` and returns the output that the testbench managed to print. The
  service waits 3 s longer and stops the container only if the job did not answer. Measured: the
  answer to an endless testbench arrives after about 21 s (the criterion is no later than 25 s).
- **Output.** `vvp` writes to a pseudo-terminal, not to a pipe: to a pipe it writes in blocks, and
  the output of a stopped testbench would be lost in its buffer. Newline translation is off. The
  job keeps the first 256 KB and reads and discards the rest. Error output goes to the same place.
- **`exitCode`** is `null` if `vvp` did not start or was stopped by a signal. Spec section 8.3 is
  updated.
- **Waveform file.** The name is taken from `$dumpfile("…")` in the text of the files, then
  `dump.vcd` is tried (the Icarus default name). Only a regular file inside the run folder is
  taken. The server cannot find a name that the testbench assembles from parts: then `vcd` is
  `null`.
- **Size.** `vvp` has a file size limit (20 MB + 1 byte), and the signal `SIGXFSZ` is ignored:
  a write over the limit fails with an error, the testbench keeps running and prints its result.
  A file over 20 MB is not saved, and the response has the warning `TB_VCD_TOO_LARGE`.
- **Storage.** `<data>/testbench/tb-<32 characters>/dump.vcd`, retention is one hour from the write
  time. A shared limit of 1 GB is added beyond the spec: 30 runs per minute of 20 MB each would
  otherwise take 36 GB in an hour. The values are in `/v1/info` (`tb_*`).
- Memory of 512 MB and one core are flags of the job container. Running out of memory gives
  `TB_OOM`, `status: "failed"`.

### 92. The "Testbench" tab and the waveform from VCD

- **The file list** of the tab is `resolved.testbenches` of the last server response: the
  interface does not parse Verilog. When a project opens, the interface sends `/v1/check` and takes
  only the file roles from the response. This request does not touch the messages, the editor
  marks or the check counter.
- **"Run"** saves the edits and sends the saved files, like a build (decision 46). The simulation
  in the browser stays untouched.
- **The messages** of the run are shown in the tab as the same rows as in the "Messages" tab.
  A click moves the editor to the line. They do not go into the common build message list: the
  next project check replaces it.
- **Waveform.** There is one panel (decision 86), so a VCD file takes all of it. The rows are the
  signals of the file itself, the first 100. The control line says how many are left outside the
  panel. The rows live in memory: `record.signals` in `fpgasim.json` belongs to the core record.
  While a file is shown, the core record data does not go into the panel. "Back to simulator
  recording" requests it again.
- **VCD parsing.** `parseVcd` reads words one by one and does not keep a list of them (the remark
  of decision 88). Measured in Node: a 20 MB file with 1.1 million changes takes 0.3 s. A real
  Icarus 12 file (testbench `blink3`) lies in `web/src/wave/testdata/` and is parsed by a unit
  test. A `$dumpall` block before the first time stamp (parameter values) gives the values at the
  start. A `$dumpoff` block is still read as X values, that is, zeros.
- **The third-party parser** `tools/wave/read_vcd.py` reads X and Z as 0: without this, it did not
  parse the Icarus file.

### 93. Example testbenches

- The `blink3` counters count to 13.5 million clock cycles. The text of `top.v` is fixed by
  spec section 2.7. The testbench sets the counters two clock cycles before the boundary by
  assignment through a hierarchical name (`dut.cnt_a = …`) and checks the boundary: the counter
  clears and the LED toggles.
- The `shift_chain` testbench creates the instances `chain_good` and `chain_bad` directly, without
  the divider by 8,388,608 from `top`.
- The output is one line `PASS: N checks` or lines `FAIL: …`. After it, Icarus prints its own
  line about `$finish`. The tests check for the `PASS` line, not the whole output.
- `expect.json` has no field for a testbench: the format of section 11.2 did not change. The
  expected text stands in the comment at the start of the testbench and in the server tests.

### 94. File list: icons and marks

Deferred from stage 5 to stage 9 (spec section 9.3). The file kind icon goes by extension. The
marks "top" and "testbench" go by the server response: the field `topFile` is added to `resolved`
(spec section 8.3 is updated). Before the first server response, there are no marks.

### 95. Fixes from the independent review of stage 9

> **Changed later.** Taking both job slots with one key is closed by decision 165: a fair queue.

Review by a second agent over `git diff main...HEAD`, by reading code only. Fixed:

- **A testbench could replace the job result.** The folder `/work` is writable for the testbench.
  A file in place of `/work/out`, or a name too long in `$dumpfile`, crashed the job after `vvp`,
  and the service read the `result.json` that the testbench itself wrote: arbitrary `stdout`,
  `status`, `exitCode`. Now the job catches any failure of its own and always writes the result
  itself, and it frees the place `/work/out` before writing. A foreign file could not get the
  service file this way (`O_NOFOLLOW`).
- **Testbench root.** If the modules of a file name each other by hierarchical names, the word
  search finds no root. Now the root is the last testbench of the file.
- **Files for `` `include ``.** The testbench job also sees Verilog files outside `design.files`,
  like a build.
- **A refusal to show a waveform** goes through the dictionary. A key refusal (401) resets the
  key.
- **A tab without a testbench list** (the server did not answer, or there is an error in
  `fpgasim.json`) explains this and gives the button "Request again".

Not fixed, accepted as is:

- "No later than 25 s" holds when the job queue is free: the queue wait (up to 60 s) comes on top.
  One key can take both job slots with endless testbenches: the limit of 30 runs per minute does
  not prevent this. The spec has no separate limit of concurrent jobs per key.
- If a container starts for longer than 3 s, the service stops it before the job does: the answer
  is `timeout` without the testbench output.
- There is no test for `TB_DISK_LIMIT` (added on 2026-11-22: `test_testbench_disk_limit`). The 404
  answer after an hour is checked on the storage, not through HTTP.

## 2026-11-19. Stage 10: folder on disk and archives

### 96. Which files a project takes from a folder, an archive and single files

Spec section 2.1 names the file types but does not say what to do with the rest of a folder's
content. A lesson folder (`~/fpga/lesson00_blink`) holds, next to `top.v`, the build output for the
board: `top.json` and `top_pnr.json` (over 1 MB), `top.fs`, `tb.vvp`, `tb_top.vcd`, `pnr.log`, and
the folder `.vscode`.

- **Folder on disk:** the project takes the design (`.v`, `.sv`, `.vh`, `.svh`), the binding
  (`.cst`), memory data (`.hex`, `.mem`) and `fpgasim.json` in the root. Hidden files and folders,
  `impl` (the Gowin IDE output) and `node_modules` are not traversed. Reason: the build output
  changes on every `make` and would trigger a rebuild, and by size it does not fit the server
  limits. Other files (`Makefile`) are not visible in a folder project: the rule of section 2.1
  "other files are shown" is narrowed for a folder.
- **Archive and single files:** any text in UTF-8 is taken. If all files of an archive lie in one
  top-level folder named like the archive itself (`lesson.zip` with a folder `lesson`: this is how
  macOS and Windows pack a folder), this folder is removed from the paths. A project archive where
  all files lie in one subfolder returns this way with the same paths. macOS service files
  (`__MACOSX`, `.DS_Store`, `._*`) are not taken. Other files with a dot at the start of the name
  are taken.
- **Common rules:** the name follows decision 61, the limits are from section 8.5 (200 files,
  512 KB per file, 2 MB per project). A file with a zero byte or invalid UTF-8 counts as binary.
  A byte order mark stays in the text: the export returns the file byte for byte the same. The
  report above the file list (`window.__fpgasim.transfer()`) shows what was not taken and why.

### 97. Project in a folder: disk, browser copy, access, rebuild

- **The source of truth is the folder.** The `files` storage holds a copy of the content and
  unsaved edits (decision 46). Saving, creating, renaming and deleting a file, writing
  `fpgasim.json` from the dialogs, and "Export as .cst" write first to disk, then to the copy.
  An unsaved edit is not written to disk.
- **Polling** once per second (section 9.2): a folder traversal that compares the modification time
  and size with the mark. A file is read only if the mark is different. The project's own write
  updates the mark at once, so it does not count as an outside change. Traversals and disk writes
  run one at a time.
- **Outside change.** The new text becomes the saved content. An unsaved edit of this file stays in
  the editor. Without an edit, the editor shows the new text. A file deleted from disk is deleted
  from the project. A file with an unsaved edit stays, and saving writes it into the folder again.
  The traversal skips a file whose disk write has started. If `fpgasim.json` changed, the settings
  apply at once.
- **"Rebuild on change"** is a checkbox in the top bar, only for a folder project. It is stored in
  the project record (`autoBuild`) and is on by default: this is why people open a folder. The
  build starts 500 ms after the last found change. If a build is running, it starts after it. If
  the checkbox is off, a check without a build runs (section 9.5, item 5). A rebuild on a folder
  change, unlike the "Build" button, does not save unsaved browser edits: otherwise an edit from
  the browser would be written to disk over an edit from VS Code. The build takes the saved
  content.
- **New file in a folder.** A file can be created, uploaded or renamed only to a path that a folder
  project takes from disk (decision 96), and only if the folder has no such file yet. Otherwise the
  file would vanish from the project at the traversal or would overwrite a file outside the project
  (`top.json`, text not in UTF-8).
- **Access.** When opening from the list, the browser asks for permission at once (a user click).
  When opening by address after a reload, the workspace is replaced by the reason and the button
  "Reopen folder". A traversal failure (the folder was deleted or renamed) is shown the same way.
  While there is no access, files are neither read nor written, so the copy and the folder do not
  diverge.
- **Choosing the same folder again** opens the previous project (`isSameEntry`). Deleting a folder
  project only removes it from the list. The interface does not touch the folder.
- The end-to-end tests check this with a folder from the private browser storage. The permission is
  replaced so that after a reload the browser "asks". Item 11 of section 15.1 is confirmed on this
  test bench: a file change gives a build in under 3 s. The author checks it on a real lesson
  folder with an edit in VS Code.

### 98. Changed files count from the content at project creation

Section 9.2 requires an export of "only changed files" but does not say what to count from.

- The file record got an optional field `base`: the content at project creation (an example,
  an archive, files, a folder at first opening). A changed file is one whose text differs from
  `base`, or that has no `base`: the file was created, uploaded or renamed after the project was
  created.
- Deleted files do not go into the export: there is no way to show them in an archive.
- Changed files are exported as the archive `<project>-changed.zip`, the whole project as
  `<project>.zip`, and the open file under its own name. Before the export, edits are saved: the
  export contains what is visible in the editor. If there are no changed files, the menu says so.
- The exchange format and the `spec/` schemas are not affected: this is the internal browser
  storage.

### 99. File upload and drag and drop

Deferred by decision 61 to stage 10.

- The button in the "Files" area uploads files into the open project. A file with the same path is
  replaced together with its unsaved edit. Files beyond 200 are not taken.
- Files dropped on the projects screen give a new project. One `.zip` archive gives a project from
  the archive. No end-to-end test checks the drag and drop: Playwright does not drop files from
  disk. The same function is checked through the file input. On 2026-11-22 a test was added by the
  method of decision 166: a `DataTransfer` with files is assembled on the page and sent to the
  projects screen.

### 100. Fixes from the independent review of stage 10

Review by a second agent over `git diff main...HEAD`, by reading code only. Fixed:

- **A rebuild on a folder change saved browser edits** to disk over an edit from VS Code. Now such
  a rebuild does not save edits (decision 97). The end-to-end test checks this.
- **A new file could overwrite a folder file outside the project**, or vanish at the traversal
  (`notes.txt`, `top.v.bak`, `impl/…`). Now the name is checked by the rule of decision 96 and by
  presence in the folder.
- **Saving during a traversal** could return the old text to the editor: the traversal read the
  disk before the write. The traversal skips files whose write has started.
- **A failure to write to the folder on save** lost fresh edits of other files. They are now
  written to the browser storage as unsaved.
- **A project archive where all files are in one subfolder** returned without this subfolder. Files
  with a dot at the start of the name were not returned (decision 96).
- A double click on "Reopen folder" started a second polling timer. A traversal after a project
  change could touch files of the new project. A file deleted from disk lost its unsaved edit.
  A folder dropped on the screen gave an unhandled error. A write failure on creating, renaming,
  deleting, uploading a file and on writing `fpgasim.json` was not caught.

Not fixed, accepted as is:

- An IndexedDB failure during a traversal is shown as "folder unavailable".
- The 2 MB limit per project is not checked when polling a folder: beyond it, the server refuses
  the build with a clear reason.
- An archive is unpacked into memory whole before the sizes are checked.

## 2026-11-19. Stage 11: deployment and acceptance of version 1

### 101. Static deployment and the content security policy

- `make deploy-web` calls `deploy/deploy-web.sh`: a Vite build with the `VITE_BUILD_URL` of the
  production server, creation of the Pages project `fpga-sim` on first run, and
  `wrangler pages deploy` to the `main` branch. The author binds the own domain in the Cloudflare
  panel: the wrangler login gives no right to write DNS records. The procedure is in
  `docs/deploy-web.md`.
- `web/public/_headers`, besides what spec section 10.1 names, contains: `style-src 'self'
  'unsafe-inline'` (the CodeMirror editor creates styles on the fly), `worker-src 'self'`,
  `img-src 'self' data:` (the CodeMirror message mark icons are `data:` images),
  `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `frame-ancestors 'none'`, and also
  `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer` and
  `Strict-Transport-Security: max-age=31536000`.
- The end-to-end test bench serves the interface with the same headers: `vite preview` reads
  `_headers` (`web/vite.config.ts`) and puts the address of the local server into `connect-src`.
  So all end-to-end tests run under the policy, not only the stage 11 test.

### 102. The `make e2e-prod` suite

> **Changed later.** Since decision 108, `make e2e-prod` measures speed in `ports` mode.

- The tests of the production URLs lie in `e2e/prod/`, the settings in
  `e2e/playwright.prod.config.ts`. The suite of the local test bench does not run against the
  production URLs: it is built for a fresh server (request counters, cache, limits) and replaces
  parts of the browser.
- Contents: static headers and the secure context (`showDirectoryPicker` exists, the "Open folder"
  button is enabled); a build, a run and the testbench `blink3`; four concurrent sessions; each
  lesson 2–10 with a cold build, a run of `expect.json` in the browser, and the speed at the
  multiplier "maximum".
- The cold build of a lesson goes as a request to the server with a marker comment added to
  `top.v`: otherwise a repeated run gets an answer from the cache and gives no build time.
- In the browser, the duty cycle is known for the last step, not for the whole run. So the
  end-to-end test compares `dutyMin` and `dutyMax` only in a run without actions (then there is one
  step). The run without a browser always compares them. The end-to-end test of lessons does not
  compare the fields `notices` and `build.codes`: they are empty for all lessons, and the run
  without a browser compares them.

### 103. Author's lessons in `examples/lessons/`

- `tools/lessons/import.sh` copies from `~/fpga/lessonNN_*` (numbers 02–10) the files of the
  design, binding and memory data: the same rule as for a folder project (decision 96). `Makefile`,
  `top.sdc` and the build output for the board are not copied. There are 32 lessons. The folders
  `lesson00_*` and `fpga_lesson04` are not in the set (spec section 12 names lessons 2–10).
- `expect.json` files are composed from the comment at the start of `top.v` and from the design
  code. The numbers are derived by calculation, then checked by a run. The lessons have no
  `fpgasim.json` file. *Clarified on 2026-11-22: lessons 02, 03, 06, 07 have it, decision 169.*
- `make test-examples` (a build through the server, both visibility modes) and the end-to-end tests
  (three lessons on the local test bench, all of them in `make e2e-prod`) run the lessons. The
  lessons are not added to the core tests (`tools/native/run_examples.py`): there the `.cst`
  parsing and the top module search are simplified and built for single-file examples.
- In the "From example" list, the lessons stand as a separate group "Lessons" before the group
  "Examples". By default the first example of the repository is chosen, as before.
- What the `expect.json` of the lessons does not cover:
  - `lesson02_vote`, `lesson03_two_of_four`: the inputs on pins 73 and 74 are wires on the header.
    Without `fpgasim.json`, there is no part on these pins, and the input reads as 0. The part of
    the truth table reachable with the buttons S1 and S2 is checked. A full check is possible with
    a "switch" part on the breadboard, but that is already `fpgasim.json`.
  - `lesson06_press`: button bounce is off in the simulator until it is turned on in the button
    settings. A counter without debouncing counts exactly one press. The extra triggers that the
    lesson was written for are not visible without `fpgasim.json`.
  - `lesson07_ped`: the pedestrian LEDs on pins 73 and 74 are checked as pin levels. Without
    `fpgasim.json`, there are no "LED" parts on the breadboard.
  - The lesson testbenches (`tb_top.v`) are not part of the checks: the stage criterion is
    `expect.json`.

### 104. Quick help

Spec section 12 names a "quick help page" but not its form. A "Help" dialog is built: a button on
the projects screen and in the top bar of the workspace, seven sections with steps. The texts are
in the dictionary (`help.*`). There is no separate page with an address: the dialog is available
from any place in the application and needs no routing.

### 105. Request retry in the example run without a browser

`tools/headless/run.mjs` repeats the request to the server once on a network failure. Reason:
a run of lesson 7 takes 15–25 s, the server closes an idle connection in that time, and the next
build request over it failed (`fetch failed`). The expectations of the examples did not change.

### 106. Fixes from the independent review of stage 11

Review by a second agent over `git diff main...HEAD`, by reading code only. It found no wrong
numbers in `expect.json` and no errors in the code. Fixed:

- **PWM in `lesson08_buttons` and `lesson08_gamma` was not checked.** Added the mean duty cycle
  (fraction of time at one) of pin 15 over the run. For `lesson08_gamma`, the bounds tell a gamma
  table from a multiplication by 17. The browser does not compare this value (the run has actions,
  decision 102).
- **Debouncing was not checked:** the expectations of `lesson06_press` and `lesson06_debounce`
  were the same. A 2 ms button pulse between polls is added to lesson 6 and to `lesson07_lock`.
  `lesson06_press` counts it (four presses instead of three), the designs with debouncing do not.
  `lesson06_stable` gets one more 5 ms pulse over the poll moment: only the stability counter cuts
  it off. In lessons 8–10, the same debounce block is not checked separately.
- **Security policy:** `blob:` is removed from `worker-src` (the Worker is created from its own
  file). `Strict-Transport-Security` is added. The proposal to remove `data:` from `img-src` is not
  accepted: the end-to-end test showed that the CodeMirror mark icons are `data:` images.
- **Help without a field in `window.__fpgasim`:** added the method `help()` (spec section 9.7).
- `deploy/deploy-web.sh` reads the whole project list before the search. `tools/lessons/import.sh`
  reports that there are no lessons in the folder.

Accepted as is: `lesson02_vote` and `lesson03_two_of_four` are checked by one scenario
(decision 103). The lengths of the individual steps of the gamma table are not checked.

## 2026-11-19. After acceptance of version 1

### 107. Chunks run back to back at any multiplier while the core cannot keep up (2026-11-19)

> **Changed later.** The condition of the `SLOW` notice is changed by decision 109: it arrives only
> when the lag is over 10%.

The author's remark at acceptance: `lesson07_ped` at multiplier 1 showed `SLOW` and the ratio
0.72×, although at multiplier `max` the same lesson ran at 1.04× in the same Chrome.

Cause. Decision 49 enabled back-to-back chunks only for the multiplier `max`. At a numeric
multiplier, the host called `fs_tick` every 16 ms, and the chunk budget is 12 ms: the core computed
at most 75% of the time. A lesson that runs slower than 1.33× at `max` lagged at multiplier 1,
although it could keep up. The statement of decision 49 "at multiplier 1 the ratio equals one by
construction" holds only for light designs.

Fix. In `web/src/sim/worker.ts`, the next chunk is scheduled without waiting for the timer in the
`running` state at any multiplier, while a chunk lasts at least 6 ms. When the core keeps up with
the target, a chunk is short, and the computation runs by the timer, as before. The core, the
protocol and the formats did not change. Spec section 5.3 and the table of section 4.8 are
clarified. End-to-end test: at the unreachable multiplier 1000, the speed of `blink3` is at least
90% of the speed at `max` (73% before the fix).

The table of section 3 of `docs/v1-report.md` was measured at `max` and does not depend on the fix.
The `SLOW` notice stays for lessons that run slower than real time even at `max`.

### 108. The default visibility mode is `ports` (2026-11-19)

The author's decision at acceptance. Assumption 5 of spec section 15.1 ("the speed loss allows
keeping the `all` mode by default") was not confirmed on the lessons: in the author's Chrome,
`lesson07_ped` in the `all` mode runs at 1.04× at the multiplier "maximum" and gets the `SLOW`
notice in the first seconds. In the `ports` mode, it holds 1.00× at multiplier 1. In the table of
section 3 of `docs/v1-report.md` (mode `all`, Chromium without a window), `lesson10_uart` runs at
0.91× on mains power, and on battery 13 lessons of 29 run slower than real time. The fallback from
the spec is applied: the default is `ports`, and the debug mode is a button.

What changed:

- Server (`resolve.py`): without `design.visibility` and without `options.visibility`, the build
  runs in the `ports` mode. The schema `spec/fpgasim.schema.json` did not change: it records no
  default. The table of section 2.4 and section 7.3 of the spec are corrected.
- Interface: in the project settings, the default is "ports only". Only `"all"` is written to the
  file. In the "Signals" tab in the `ports` mode, there is the button "Show internal signals and
  rebuild": it writes `design.visibility: "all"` and starts a build. The help is extended.
- Tests: the end-to-end tests that need internal signals turn on the `all` mode explicitly.

Consequences. After the server deployment, a project without the field `design.visibility` builds
in the `ports` mode: watching and recording internal signals do not work in such a project until
the mode is turned on with the button. The examples and lessons contain no such field. The run
without a browser (`make test-examples`) sets the mode explicitly and checks both. `make e2e-prod`
does not set the mode: after this decision, it measures speed in the `ports` mode.

### 109. The `SLOW` notice fires on a lag over 10% in three seconds (2026-11-19)

The author's decision at acceptance. The previous condition: the chunk target was not reached for
three seconds in a row. It fired also at the ratio 0.98× (a lesson at the speed limit, WebAssembly
code warm-up after the start) and alarmed where the lag is not noticeable.

The new condition (`core/src/runtime/runtime.cpp`): within a window of three seconds of real time,
the simulation time grew by less than 90% of the set value. The windows run back to back. The
notice arrives once and re-arms after a window without a lag, after a speed change and after
a new start. At the multiplier `max`, a design with a clock has no notice, as before.

The protocol and the formats did not change: the code `SLOW` and its fields are the same. The text
of spec section 4.7 is clarified. `core/VERSION` is raised to 0.2.1 (decision 30): the build image
label and the cache key change, otherwise the server would serve from the build cache with the
previous core. The server deployment is done: `20261119-2107-c1740f0`.

### 110. Note about a board device without a model: code `DEVICE_NOT_MODELED` (2026-11-20)

Spec section 3.2 promised a note "the device will appear in version N" when a port is bound to
a pin from `devices`. The note had no code, and the server did not read the `devices` field.

- The server (`server/fpgasim_server/resolve.py`, the check of pins against the board) issues the
  warning `DEVICE_NOT_MODELED` with the fields `port`, `pin`, `device`, `since`. The source and
  place are as for `PIN_FORBIDDEN`: `cst` with the line of the binding file, or `project` for the
  `pins` field.
- The display level in `spec/diagnostics.json` is "note". The build runs, and the status does
  not change.
- A device with `since: null` (flash memory) gives no note: there is no version. Its pins are
  forbidden, and the author gets `PIN_FORBIDDEN`. A forbidden pin gets no second message.
- A device without pins in the board file (SDRAM) gives no note: nothing can be bound to it.
- The board file format and the protocol did not change. The binding is not part of the cache key,
  so the note arrives on a cache hit too.
- The binding dialog in the interface does not show the note: it is visible in the "Messages"
  tab after a build. Showing it in the dialog is recorded in "Open: deferred" of
  `docs/progress.md`.

## 2026-11-20. Interface design

The author's task. The author accepted the layout and decisions 112–114 on 2026-11-20, and the
finished look the same day. The project with the screen layout and the comparison of approaches
was removed by cleanup: `git show e35eac8:docs/design-2026-11.md`.

Reasons. The author's remarks: the look is "too plain"; the help scrolls together with its close
button; the menu of the top bar is inconvenient; the gear is not visible; there is no dark theme;
it is unclear what to press and what to expect. The previous screen did not show the user path
(edit code, build, run, watch): there was no main action, and "Run" before a build was disabled
without an explanation. The build result and the simulation state stood as gray text in the lower
corner. After a file edit, the simulation ran on the old build silently. The link between the step
kind list and the "Step" button, and between the four icons above the file list and the open file,
was not readable. The actions of the bottom tabs looked like text. Recording a waveform needed
two tabs. The board drawing took a third of the area.

### 111. Interface on Tailwind and shadcn, light and dark theme

The author chose a full migration out of three options (own variables in the previous CSS; shadcn
fully; Radix only for the menu). The author's reason: groundwork for the future.

- Tailwind 4 through `@tailwindcss/vite`. The shadcn components on Radix lie in
  `web/src/components/ui/` and are edited as own code (sizes are tightened: element height 28 px).
  Icons are `lucide-react`. The shared screen elements are in `web/src/app/kit.tsx`, the form rows
  in `web/src/app/form.tsx`. The previous `web/src/styles.css` (1026 lines) is replaced by theme
  variables and the CodeMirror editor style.
- The fonts Inter and JetBrains Mono come from the packages `@fontsource-variable/*`, and the files
  lie in the build. `web/public/_headers` did not change: `style-src 'self' 'unsafe-inline'` is
  already there (decision 101), and the fonts come from the own address. The ligatures of the
  monospace font are off: "<=" in Verilog reads by characters.
- Theme: light, dark, as in the system. The choice is stored in `localStorage` (`fpgasim.theme`),
  not in `fpgasim.json`: it is a property of the workspace, not of the project. The class `dark`
  on the root element switches the variables. Canvas reads the colors through `themeColor()`
  (`web/src/app/theme.ts`). The board in the drawing keeps its colors in both themes. The area
  background, the pin labels, the breadboard field and the wires change with the theme.
- Editor highlighting uses the `tok-*` classes (`classHighlighter` from `@lezer/highlight`), and
  the colors are theme variables.
- Choice lists are a Radix Select (`Choice` in `kit.tsx`), not `<select>`. The selected value
  stands in the attribute `data-value` of the list button, and an item is `role=option` with
  `data-value`. The end-to-end tests choose an item with the helper `choose`
  (`e2e/tests/stand.ts`). Checkboxes are `role=checkbox`.
- Dialogs are a Radix Dialog, not `<dialog>`: the title and the bottom row are pinned. The board
  button keys do not act while focus is in a dialog or in a list (`[role=dialog]`,
  `[role=listbox]`).
- The `fpgasim.json` format, the protocol and the server did not change.

### 112. "Run" builds an unbuilt or changed project

Before, "Run" was disabled before the first build without an explanation, and after a file edit it
ran the previous build. Now "Run" on a project that is not built or is changed since the build
performs a build and, on success, starts the simulation (`runOrBuild` in
`web/src/app/actions.ts`). On failure, item 2 of spec section 9.5 applies: the "Messages" tab and
a jump to the first error. The "Build" button stays. Spec section 9.5 is updated.

### 113. "Run" and "Pause" are one button

This is how spec section 9.3 draws it. While a simulation or a step runs, the button is "Pause"
(`data-testid="pause"`), otherwise "Run" (`data-testid="run"`). There are never two buttons on the
screen at once.

### 114. The "changed since build" mark

Next to "Build" stands the build mark: not built, building, built, changed since build, error.
"Changed" means that the fingerprint of the sources differs from the fingerprint of the build from
which the core is loaded. The fingerprint includes the project files with an unsaved edit and the
`design` field of `fpgasim.json`. The binding (`pins`), the parts and the layout are not included:
they act without a build (spec section 9.5, item 4). A `fpgasim.json` file without the `design`
field equals no file. The state is read in `window.__fpgasim.state().stale`.

### 115. Project menu, file actions, projects screen

- The project name in the top bar is a menu button: "Rename", "Project settings", three kinds of
  export. The separate pencil, gear and "Export" are removed. If there are no changed files, the
  menu stays open with an explanation, as before.
- "New file" and "Upload files to project" stand in the header of the "Files" area. "Rename" and
  "Delete" are in the menu of a file row (the "⋯" button and the right mouse button). The previous
  four icons acted on the open file, and the link was not readable.
- "Binding" and "Part" stand in the header of the "Board" area. The margins of the drawing are
  smaller, and the zoom limit is raised from 14 to 18 (`web/src/board/layout.ts`): the board and
  the pin labels are larger. The list "not simulated" is collapsed by default.
- "From example" on the projects screen is a menu with the groups "Lessons" and "Examples".
  Choosing an item creates a project at once. There is no default example any more, so in the
  stage 11 test the check "`blink3` is chosen in the list" is replaced by a check of the menu
  contents.
- In the "Waveforms" tab, the "Signal" button adds a signal to the recording without a switch to
  the "Signals" tab. Empty tabs show the button of the next step.
- The help texts that named the removed elements (gear, "+ Part", the icons "▶", "⏸") are
  corrected to the new names. The author accepted the previous text on 2026-11-19.

### 116. Screenshots in the help

2026-11-20. The author asked to extend the help with a description of the interface with
screenshots and chose the contents: four groups of screens, screenshots in the "Help" dialog,
a set per interface theme, the previous text of the sections.

- There are eight screenshots: the projects screen, the workspace, the board with the breadboard,
  the "Pin binding" dialog, the UART terminal, the tabs "Signals", "Waveforms", "Testbench". They
  stand under the text of the sections "Getting started", "Build", "Board and breadboard" and
  "Signals, waveforms, testbench". The contents per section are set in
  `web/src/app/HelpDialog.tsx`, the captions are `help.shot.*` in the dictionary.
- The files lie in `web/public/help/<name>-light.png` and `<name>-dark.png` and are served from the
  own address: the content policy (`img-src 'self' data:`) does not change. The help shows the set
  of the current theme. A click on a screenshot opens it in a new tab at full size.
- The scenario `e2e/tests/help-shots.spec.ts` takes the screenshots on the local test bench:
  `HELP_SHOTS=1 e2e/run.sh tests/help-shots`. Without the variable, the scenario is skipped and
  does not touch the files in `make e2e`. Reason: after a change of the look, the screenshots are
  retaken with one command, not by hand. The screenshots are taken at density 2: they are sharp on
  Retina screens, and all 16 files take 2.1 MB.
- The scenario writes the screenshot sizes to `web/src/app/helpShots.json`. The help sets them in
  `<img>`: the text does not shift while the picture loads, and a jump to a section from the list
  on the left hits the target.
- `help()` in `window.__fpgasim` got the field `shots` (spec section 9.7 is corrected).

## 2026-11-20. Accounts and projects on the server

### 117. Accounts and projects on the server: scope and task

2026-11-20. The author called the issuing of keys inconvenient (login to the VPS, the key is shown
once, links by hand, no accounting) and chose: sign-in by login and password; the author is the
only administrator; shared work is one login for two people; the administrator views the projects
of users and copies them to the own account; all projects "in the browser" are saved to the server
automatically. The goal is not to lose work.

- The task is `docs/tz-accounts.md`. Its section 8 lists the decisions of the author and the
  decisions of the implementer. The stages move them here as they are done.
- Spec section 15.2 assigned accounts to version 3 and assumed a separate service. The work started
  earlier by the author's command. There is no separate service: the SQLite database is in the
  `api` service (up to ten users).
- Before handover, an independent agent in the role of the implementer read the task. Its ten
  remarks are taken into account: a conflict when saving an edit that was started on an old
  version of a file; a file created anew under the path of a deleted one; a lost server response;
  the database generation for restoring from a copy; a project open in one tab; the server does
  not forget what is deleted.

### 118. Accounts are an SQLite database in the `api` service

2026-11-20. Decision 5 of section 8 of `docs/tz-accounts.md`, done in stage 1. The accounts, the
sessions and (since stage 3) the projects lie in the SQLite file
`/var/lib/fpgasim/accounts/accounts.db`. Access goes through the standard library module
`sqlite3`, and the server module is `server/fpgasim_server/accounts.py`. There is no separate
service. Reason: up to ten users. A separate service adds a container, a deployment and a point of
failure for no benefit.

### 119. The session token goes in the `Authorization` header, no cookie

2026-11-20. Decision 6 of section 8 of `docs/tz-accounts.md`, done in stage 1. The server looks up
the value `Authorization: Bearer …` first among the sessions, then among the keys. Reason: the
client already sends the key this way. The static files and the server stand at different
addresses.

### 120. Keys stay

2026-11-20. Decision 7 of section 8 of `docs/tz-accounts.md`, done in stage 1. `keys.toml`, the
`key …` commands and the `#key=…` link work as before. A key gives the build operations and does
not give the account operations (403 `FORBIDDEN`). Reason: 35 end-to-end tests and the
measurements work by key.

### 121. Sign-in limits and session lifetime are in `Limits`

2026-11-20. Stage 1 of accounts. The task names the values (section 3.1: 10 failures per login,
30 per address, a window of 15 minutes; section 2.3: 90 days; section 3.6: 60 requests per minute)
but not the place. They lie in `Limits` (`server/fpgasim_server/config.py`) under the names
`login_failures_per_login`, `login_failures_per_address`, `login_window_seconds`, `session_days`,
`account_requests_per_minute`, are set in `config.toml` and are returned in `/v1/info`, like the
other limits. Reason: section 9 of the task calls these values a choice of the implementer. The
author changes them without a code edit. The tests set small values instead of sending dozens of
requests.

- The per-minute request counters are kept by kind of sign-in: the key `taras` and the account
  `taras` are counted separately. Reason: the name of a key owner and a login are different
  namespaces.
- The limit of 60 per minute applies to sign-out, password change and the operations of section
  3.4. Sign-in does not pass through it: before sign-in there is no account, and sign-in is limited
  by the failure counter.

### 122. Operations on one's own account are for a session only

2026-11-20. Stage 1 of accounts. The task does not say what to answer to a key on
`POST /v1/auth/logout` and `POST /v1/auth/password`. The answer is 403 `FORBIDDEN`, like for the
operations of section 3.4. Reason: a key has no session and no password. Signing out in the key
mode is erasing the key in the browser (section 5.1), and no request to the server is needed.

- An administrator who changed the own password with the operation
  `POST /v1/admin/users/{own login}/password` keeps the session from which the password was changed.
  The other sessions are deleted. Reason: `POST /v1/auth/password` acts the same way (section 2.3).
- A wrong current password goes into the failure counter of the login (section 3.1). When the login
  is locked, a password change answers 429 `LOGIN_LOCKED` without checking the password. Otherwise
  a password change would become a way around the lock for guessing.

### 123. Restoring the database from a copy

2026-11-20. Stage 1 of accounts, the command `fpgasim-admin db restore <file>` (section 3.8 of the
task).

- The copy is read with SQLite means (`Connection.backup`) into a file next to the database. The
  check and the new generation are written in it, then it replaces the database with one rename.
  Reason: a copy may be in WAL mode with an unmerged journal next to it, and a plain file copy loses
  the journal. The copy file does not change.
- The check "a database of this schema": `user_version` equals the service version, five tables
  have the same columns in the same order, `meta` has the generation, and `PRAGMA quick_check`
  passes. Otherwise it refuses, and the database and the database folder do not change.
- The previous database is not erased: it stays next to the new one as
  `accounts-before-restore-<YYYYMMDD-hhmmss>.db`. Reason: restoring a wrong copy would otherwise
  erase data with no way back. The author removes these files.
- `deploy/fpgasim-admin db …` starts a one-off container (`docker compose run --rm --no-deps`) and
  does not enter the running one: the task requires stopping the service before the restore, and
  `exec` into a stopped service is impossible. Stage 6 in `docs/deploy-server.md` describes the
  procedure for the author.

### 124. A database connection per operation

2026-11-20. Stage 1 of accounts. The service opens an SQLite connection for every operation and
closes it afterwards. Reason: the database is written both by the service and by `fpgasim-admin`.
After `db restore`, the next operation opens the new database and does not hold the old file. The
cost is fractions of a millisecond per request.

- A database failure while parsing the `Authorization` header does not break sign-in by key: the
  value is checked among the keys, and the reason is written to the log line in the field
  `accountsError`. Reason: section 0.4 of the task forbids breaking sign-in by key.
- The database is created in a folder with mode 700, and the file has mode 600: it holds password
  hashes. The folder `/var/lib/fpgasim/accounts` on the VPS is created by `deploy/remote.sh` (the
  task names `deploy.sh`, but the service folders are created by `remote.sh`, which `deploy.sh`
  starts on the VPS).

### 125. `fpgasim-admin user` and the prohibitions of section 3.4

2026-11-20. Stage 1 of accounts. The utility is the administrator's fallback path from the VPS.
The prohibition "disable the last enabled administrator" applies in it too (`user disable`). The
prohibition on "own account" does not exist: the utility has no own account. `user add` without
`--name` takes the display name equal to the login. `user passwd` deletes all sessions of the
account. Reason: the utility must not leave the service without an administrator, otherwise it can
be restored only by editing the database by hand.

### 126. Fixes of stage 1 after an independent check

2026-11-20. A second agent checked the diff of stage 1 and confirmed defects by running them.
Fixed:

- Passwords are checked one at a time (`Service.password_lock`). Before, the lock was checked
  before the hash was computed, and the failure was recorded after: of 60 simultaneous sign-in
  attempts, the correct password at number 46 passed, although the limit is 10 failures.
- A database failure while checking a session gives 503 `BUSY`, not 401: on 401 the interface
  considers the session finished and erases the sign-in data. Sign-in by key works as before when
  the database fails.
- A session is opened with a repeated check of the account in one transaction: an account that was
  deleted, disabled, or had its password changed while the password was being checked gets no
  session (before, a session with the old password, or a 500 answer).
- `db restore` erases the sessions from the copy: some of them may have been closed after the copy.
- A login that does not match the account rule goes into the failure counter as one line. The dummy
  hash for an unknown login is computed outside the event loop.
- The queue for the password check is limited to 16 waiting requests. Extra requests get 503
  `BUSY`. Reason: the checks run one at a time, and a stream of sign-in attempts would otherwise
  delay the sign-in of the others.
- One address takes at most 4 places of the password check queue, and a locked login or address
  does not enter the queue. Reason: a burst of sign-ins from one address would otherwise fill the
  whole queue.

### 127. Projects on the server: limits, request checks, trash

2026-11-20. Stage 3 of accounts (sections 3.2–3.6 of `docs/tz-accounts.md`). The task names the
operations and the values but not these details.

- The values lie in `Limits` and are returned in `/v1/info`, like decision 121: `max_projects`
  (100), `sync_requests_per_minute` (120), `trash_days` (30), `backups_kept` (14), `max_file_rows`
  (1000). Reason: section 3.6 requires keeping the limits in `Limits`. The trash retention and the
  number of copies are of the same kind, and the tests set small values.
- Request counting: `sync` has its own (120 per minute). `GET /v1/projects`, `DELETE` and the
  operations of section 3.5 go into the common count of write operations (60 per minute,
  decision 121).
- The project identifier is a UUID in the canonical form `8-4-4-4-12` of hexadecimal characters.
  Letter case does not matter, and it is stored as sent. The project name is 1 to 128 characters
  without control characters. The board is 1 to 64 characters of Latin letters, digits and
  `_ . -`. A violation gives 400. The `sync` body is limited in the same way as the build body
  (`read_project`). A path given twice in `changes` gives 400.
- A deletion (`content: null`) of a path that has no record on the server, with any `baseRev`, goes
  into `applied` with revision 0: no record is created, and the project revision does not grow.
  A deletion of an already deleted file, with any `baseRev`, is `applied` with the current revision
  of the file, and the record does not change. The limit `max_file_rows` (1000) is the number of
  all file records of the project, including the records of deleted files. An excess after the
  changes rolls the request back, and the answer is 413 `PROJECT_TOO_LARGE`. Reason: the records of
  deleted files are not erased (section 2.6), and the limit of 200 files counts only live ones.
  Without these rules, a client would grow the `files` table without a limit. Step 4 of section 3.3
  and the table of section 3.6 of the task are updated (instruction of the lead agent,
  2026-11-20).
- The number of files and the project size count live files: the records of deleted files
  (`content IS NULL`) are not included.
- `DELETE` sets only `deleted_at`: the project revision and `modified` do not change. A repeated
  request does not move the trash retention. The deletion is visible by `deleted: true` in the
  list and in the `sync` response.
- A `restore` after which the account would have more than 100 projects outside the trash gives
  413 `PROJECT_TOO_LARGE`, like creating a project. Restoring a project that is not in the trash
  is `ok` without changes.
- The list of section 3.5 carries the field `purged` for every project, and the field `deletedAt`
  for a project in the trash. Reason: the "Users" page (stage 5) must tell a project that can be
  returned from an erased one without sending a `restore` at random.
- The project list is ordered by `modified`, newest first.

### 128. Trash cleanup and database copies: a task inside the service

2026-11-20. Stage 3 of accounts (sections 2.5, 2.6).

- The task starts at service start (`lifespan` of FastAPI) and checks once an hour. Trash cleanup
  runs once per UTC day. A copy is written if there is no copy for the current UTC day yet. The
  time is the clock of the accounts database (`AccountStore.clock`), and the tests replace it.
  Reason: no cron and no systemd. The hourly check survives a service restart and a time shift
  without skipping a day.
- The copy is written by `Connection.backup` into the temporary file
  `.accounts-<YYYYMMDD>.db.partial` and renamed: an unfinished copy does not count as the copy of
  the day. The file has mode 600, and the folder 700 (the copy holds password hashes). The last 14
  by name are kept. The folder `/var/lib/fpgasim/backup` is created by `deploy/remote.sh`.
- Each task runs on its own: a failure of one is written to the log (`op` = `trash-purge` or
  `backup`, `result` = `INTERNAL`, field `error`) and does not stop the other or the service.
  A failed cleanup repeats at the next check. The log gets failures, a copy that was made, and
  a cleanup that erased at least one project.
- The cleanup erases the file rows with content. The project row and the records of deleted files
  stay (section 2.6).

### 129. `last_build`, project log, `make backup-accounts`

> **Changed later.** Changed by decision 159: the copy file is read not by `ssh … cat` but by
> a one-off container through SSH, because the copy belongs to `root`.

2026-11-20. Stage 3 of accounts (sections 2.5, 3.7).

- `last_build` is updated at the start of a `build` or `testbench` request from a session, after
  the request limit check. A request that is rejected later as invalid also counts. `check` and
  requests by key do not touch `last_build`. A database failure does not stop the build: the reason
  goes to the log in the field `accountsError`. Reason: the field shows when the user last worked,
  not the outcome of the build.
- A `sync` log line carries `project` (the identifier), `projectBytes` (the size of the sent
  content in UTF-8), `applied` and `conflicts` (numbers). `project-delete` and the operations of
  section 3.5 on a project carry `project`. The content and the file paths do not go into the log.
- `make backup-accounts` is the script `deploy/backup-accounts.sh`. It finds the last
  `accounts-YYYYMMDD.db` over SSH and takes it as a `ssh … cat` stream into a temporary file,
  checks the SQLite header, and only then gives it a name in `.fpgasim/backup/` (folder 700, file
  600). The variable `SSH` replaces the SSH command: this is how the script was checked on a local
  folder without a VPS.

### 140. Fixes of stage 3 after an independent check

2026-11-20. A second agent checked the diff of stage 3. In ordinary work, it found no loss of edits
and no access to other people's projects. Four remarks are confirmed by running and fixed:

- The `sync` request carries the database generation. Before, after `db restore`, an edit with
  a revision of the previous generation matched the new one by number and overwrote it without
  a conflict. Now, with another generation, the server applies nothing and answers `stale`. A
  request with revisions without a generation gives 400. The request format of section 3.3 of the
  task is updated.
- The trash of an account holds at most 100 projects (beyond the limit, the files of the oldest
  are erased), and the project rows of an account over all time number at most 10,000. Before, the
  cycle "create a project, delete it" grew the database without a limit.
- `since` and `baseRev` are limited to 2^53: a larger number gave a 500 answer.
- A `sync` request has at most 1000 changes: a request with 250,000 changes held the event loop for
  1.3 s.


### 130. The login of the saved session in `localStorage`

2026-11-20. Stage 2 of accounts. Next to the session token (`fpgasim.session`, section 2.3 of
`docs/tz-accounts.md`), the browser stores the login of the account, `fpgasim.login`. The same
function sets and erases them. Reason: when the server did not answer at start, the interface uses
the login to decide which projects "in the browser" are visible (section 4.2), and it opens a
project from the address `#p=…` only for its own account. Without the login, all projects of the
account would have to be hidden until the server answers. The login is not a secret: it is shown in
the account menu.

### 131. The 401 refusal and a session that ended

2026-11-20. Stage 2 of accounts.

- A 401 answer to a build, check or testbench on a sign-in by session erases the token at once: it
  is no longer valid, and after a reload the page would show the sign-in. The account (login, name)
  stays known while a project is open. With it, a sign-in of the same account in the dialog of the
  bar continues the work, and a sign-in of another account closes the project (section 5.2).
  Closing a project with an expired session leads to the sign-in form.
- On a sign-in by key, 401 acts as before: the key is erased, and after the project closes the
  sign-in form is visible. There is no bar: section 5.2 speaks of a session.
- A saved key (not from a link) that the server rejected gives the sign-in form without a refusal
  text. Section 5.1 names the text "The key from the link is not valid" only for a link.
- The text of the error `UNAUTHORIZED` in the status line is "the server rejected the sign-in: sign
  in again" instead of "the server did not accept the key": a refusal happens to a session too.
- The bar is the first row of the workspace grid, not a wrapper around it. With a wrapper, the
  "Board" area in the stage 6 test ("`fpgasim.json` with an error…") got zero height, and the
  drawing vanished.

### 132. Accounts of the development bench and the end-to-end tests

2026-11-20. Stage 2 of accounts. `tools/dev/server.sh` creates the administrator `admin` and the
user `user` with the `fpgasim-admin` utility. The passwords lie next to the development key:
`.fpgasim/<mode>/admin.password` and `user.password` (the folder is not in Git). If the account
exists in the database but the password file does not, the utility issues a new password
(`user passwd`). The `with` mode passes the variables `FPGASIM_ADMIN_LOGIN`,
`FPGASIM_ADMIN_PASSWORD`, `FPGASIM_USER_LOGIN`, `FPGASIM_USER_PASSWORD` to the command. `make dev`
prints the paths of the password files. The end-to-end tests that change a password, disable or
delete an account create a separate account for themselves through the server: the shared accounts
of the bench stay intact for the other tests.

### 133. Look of the "Users" page

2026-11-20. Stage 2 of accounts. The task (section 5.6) gives no details. Chosen:

- The time of sign-in and build: "today 18:40", "yesterday 18:40", otherwise the date and time; "—"
  if it never happened.
- The prohibited actions of section 3.4: "Disable" and "Delete" in the row menu are disabled, and
  a hint gives the reason. Demotion is in the "Edit" dialog: the item "user" in the role list is
  disabled, and the reason is written under the list. The interface computes the prohibition from
  the list of accounts. The server checks it on its own (section 3.4).
- "Enable" and "Disable" act without confirmation: the action is reversible.
- A refusal to read the list (a network failure, 429 at the limit of 60 requests per minute) is
  shown as the server text above the table.
- "Copy" puts two lines into the clipboard: the login and the password.
- The item "Projects" in the row menu appears in stage 5 (section 7, stage 2).
- `users()` in `window.__fpgasim` returns the table rows while the page is open. On other screens,
  it returns an empty list.

### 134. The check "no color literals"

2026-11-20. Stage 2 of accounts. The criterion "the sign-in form and the 'Users' page have no color
literals" is checked by two tests. The unit test (`web/src/app/accounts.test.ts`) searches the
sources of the new files for color literals (`#…`, `rgb(`, `oklch(` and Tailwind palette classes).
The end-to-end test (`e2e/tests/accounts.spec.ts`) compares, in the light and the dark theme, the
text and background color of the form and the table with the variables `--foreground` and
`--background` of the chosen theme. Reason: the end-to-end tests read state, not pixels (the
section "Browser checks" of `CLAUDE.md`), and a literal is visible only in the source.

### 141. Sync mechanism in the browser (stage 4 of accounts)

2026-11-20. Sections 4.1–4.5 of `docs/tz-accounts.md`. Section 4.1 of the task is corrected by
these decisions.

- The exchange is run by the module `web/src/project/sync.ts`. The fields and the parsing of the
  response in one transaction are in `web/src/project/store.ts`. The storage itself marks what is
  unsent in the same transactions in which it changes files, and reports the change (`onChange`).
  The workspace actions do not call the sync, so a call cannot be skipped.
- An edit started on an old version of a file is recognized by the replacement counter
  `remoteSeq`, not by the field `draftRev` from the first edition of the task. Reason: the
  workspace keeps files in memory, and an edit may fail to reach the storage (the write runs 300 ms
  after input) before another person's change arrives. The workspace itself names the counter at
  save time, so there is no window.
- The field `sent` stores the content of the earliest send without a response, not its SHA-256.
  Reason: the comparison runs inside an IndexedDB transaction, and the SHA-256 computation in the
  browser is asynchronous and closes the transaction. The field lives only until the server
  responds.
- The sync state is not in the storage: it is computed.
- A deletion on the server does not erase a file with an unsaved edit of the editor: this is
  a conflict.
- A project open in another tab is not opened by the second tab. The second tab shows a line on the
  projects screen, not a separate screen.
- The requests of one project run in turn. Per run, there are at most four requests in a row.
- `window.__fpgasim` got `sync()`, `syncNow()`, `projects()` and `busyProject()`.
- The look of a conflict, the marks in the list and the messages about a deleted project are
  stage 5. The state for them already exists: `sync`, `syncNotice`, `busyProject` in the
  application state, `resolveConflict` in the storage.

### 142. Fixes of stage 4 after an independent check

2026-11-20. A second agent checked the diff of stage 4. It found no scenario in which saved content
is overwritten by another person's version without a conflict. The defects it found are fixed:

- A stopped exchange kept sending requests and took the client of the new sign-in: a request of
  account A could leave under the token of account B and create the project of A in account B.
  Now the exchange is bound to the client of its own sign-in and, after it stops, sends no requests
  and writes nothing to the storage.
- A deletion after a lost response was silently cancelled: the project or a new file came back from
  the server. The browser remembers a send without a response (`asked`, `sent`, `sentDeleted`) and
  carries the deletion to the server. A server version equal to its own send does not count as
  a conflict.
- An editor edit that was not yet in the storage was lost when a file or a project was deleted on
  another device. The workspace writes the edits before it parses the response. The record of
  a deleted file is created anew. An erased project with an edit is created anew from the files of
  the workspace.
- A project opened during its own request showed old files. After opening, the workspace compares
  the files with the storage. A response for a project that another tab opened during the request
  is not parsed.
- The server did not answer at page load: the exchange did not start without a "Retry" button.
  Now the sign-in repeats by itself when the network returns, and every 30 s.
- A change of the database generation cancelled an unsent file deletion: the deletions now stay.
- A 413 refusal repeated every 30 s: now a repeat happens only after a change or after the project
  is opened.
- The server did not accept a project name longer than 128 characters, and the project never left:
  the name is shortened.
- Sync requests have a wait limit of 30 s: a hung request does not hold the exchange queue.
- Saving into a project that no longer exists does not create a file without a project.
- Tests: 17 unit tests for these scenarios. The end-to-end reload test now proves the send after
  load. Added an end-to-end test "the server did not answer at load".


### 150. Sync marks and the conflict dialog (stage 5 of accounts)

2026-11-20. Sections 5.4 and 5.5 of `docs/tz-accounts.md`.

- The state icon in the project list stands in a separate column "Server". The hint is the text of
  the mark. The states `pending` and `syncing` are shown with one text, "Uploading". Before the
  first exchange with the server, there is no state and no icon. Reason: section 5.4 names five
  texts for the six states of section 4.5.
- In the status line, the mark is a button only for "Conflict" (opens the dialog) and "Offline"
  (repeats the request). The other states are text.
- A file with a conflict is marked in the file list with the mark "conflict". A file deleted in the
  browser is not in the list: its conflict is visible in the mark and in the dialog.
- The interface reads the list of conflicts from the storage again when the sync state, the file
  list or the open project changes, and after every action in the dialog. The dialog opens by
  itself for a conflict that the interface sees for the first time. A second conflict that arrives
  when the state is already `conflict` does not change the state: its dialog opens after the
  version of the first file is chosen, or on a click on the mark. Reason: the sync mechanism
  reports a state change, not every response, and stage 5 does not change the mechanism.
- "My version" in the dialog is the text visible in the editor, with the unsaved edit. "Keep mine"
  first saves this edit, then sends the file. Reason: the user chooses what the user saw.
- "Later", the cross and Esc close the dialog the same way. Then the dialog of the next file in the
  queue opens.
- "Download both" saves `<name>.mine.<extension>` and `<name>.server.<extension>`. The version
  "File deleted" is not downloaded.
- `window.__fpgasim` got `conflicts()` (the paths with a conflict and the path of the open dialog)
  and `syncNotice()`.

### 151. "Sign out" sends first, and a dialog appears if sending failed

2026-11-20. Section 5.3 of `docs/tz-accounts.md`.

- With unsent work, "Sign out" first sends it (waits up to 5 s). The dialog "Not everything is
  saved on the server" appears only if sending failed. Reason: usually the edit of the last seconds
  is unsent (saving to the server runs after 2 s). Without an attempt, the dialog would appear on
  almost every sign-out right after work.
- "Upload and sign out" waits up to 20 s for the upload. A refusal names the reason: "The server
  does not respond…" (state `offline`, `pending` or `syncing`) or "Not uploaded: <projects>…"
  (a conflict, a server refusal).
- Unsent work counts over all projects of the account in the browser (section 4.1). A project
  deleted by the user whose `DELETE` request has not gone through yet is not included: section 4.1
  does not name it.
- `window.__fpgasim` got `exitDialog()`.

### 152. Viewing the work of users as an administrator

2026-11-20. Section 5.6 of `docs/tz-accounts.md`.

- The project list of a user is a dialog on the "Users" page (the item "Projects" of the row menu),
  not a separate screen.
- "Open to view" exists also for a project in the trash: its files still lie on the server. An
  erased project (`purged`) has no actions.
- After "Open to view", the copy opens in the workspace. "‹ Projects" leads to the projects screen,
  where the copy stands in the group "Viewing": a separate table under the own projects, with the
  column "Owner". "Make my own copy" is a button in the copy's row. Deleting a copy works like
  deleting a project, without a request to the server.
- Opening the same project again erases the previous copy together with its unsaved edit.
- Above the workspace of a copy stands the bar "View-only copy of user …'s project".
- The interface computes the time until a project in the trash is erased: `deletedAt` plus 30 days
  (section 2.6, the constant `TRASH_DAYS` in `web/src/app/accounts.ts`). Reason: the response of
  section 3.5 does not carry the retention. A value from `/v1/info` would have to be kept in the
  state for one line.
- The storage methods `createView` and `claimView` are appended at the end of `ProjectStore`. The
  client got `userProjects`, `adminProject`, `restoreProject`. `window.__fpgasim`: the field `view`
  in `project()` (only for a copy: the earlier tests compare the whole response of `project()`) and
  in `projects()` (`null` for other projects), the method `userProjects()`.

### 153. Messages about a project deleted on another device

2026-11-20. Section 4.4, item 6 of `docs/tz-accounts.md`. The copy is erased: a line on the
projects screen (the open project is closed). The edits are saved as a new project: a bar above the
workspace. Both are closed with the cross. The project name is not in the text: the state
`syncNotice` of the stage 4 mechanism does not carry it, and stage 5 does not change the mechanism.

### 154. End-to-end tests of stage 5

> **Changed later.** The copies were merged on 2026-11-20 (decision 157): `sync.spec.ts` takes the
> helpers from `devices.ts`.

2026-11-20. The tests are `e2e/tests/sync-ui.spec.ts`. The helpers of two devices (`freshUser`,
`sharedProject`, `editAndSave` and others) are in the new file `e2e/tests/devices.ts`. Their copies
in `e2e/tests/sync.spec.ts` are not touched. Reason: another agent was checking and fixing the
stage 4 branch at that time, and an edit of `sync.spec.ts` would give a merge conflict. Merging the
copies comes after both branches are merged. The test holds the state `pending` with the lock
`fpgasim-sync` (section 4.3): while the test page holds it, the change waits to be sent.

### 155. Help and the acceptance test of accounts (stage 6)

2026-11-20.

- The help got the section "Sign-in and saving to the server" (six items). `help()` reports eight
  sections. The expectation of the help test in `e2e/tests/stage11.spec.ts` is corrected for the
  change of the requirement.
- The help screenshots are taken under the account `user` of the bench: they show the account
  button and the icons of saving to the server. Without the accounts of the bench, the scenario
  takes them by key, as before.
- The acceptance test of an account takes the login and the password from `FPGASIM_USER_LOGIN` and
  `FPGASIM_USER_PASSWORD`, like the bench tests. Without them, it is skipped, and `make e2e-prod`
  works by key as before. Before it works, the test moves the projects of the account to the trash:
  an interrupted run does not break the next one.

### 156. Wrapper `deploy/fpgasim-admin`: the Compose command as an array

2026-11-20. The first server deployment with accounts showed: the stage 1 wrapper did not work for
any command (`exec compose: not found`). In it, `compose` was a shell function, and `exec` does not
run a function. The tests did not see this: the wrapper works only on the VPS. Now the Compose
command lies in an array. Checked with a stub `docker` command (both branches: `exec` and `run` for
`db …`) and on the VPS.

### 157. A file mark shrinks before the name; the two-device helpers in one file

2026-11-20. In the narrow "Files" area, the name took only the rest of the row (`flex-1`, basis 0),
and the marks did not shrink: `top.v` with the mark "conflict" read as "top…". Now the name takes
space by its content (`flex-auto`) and only it gets the extra space, so the marks are still pressed
to the right. When space is short, the mark shrinks: the shrink weight of the mark is 1,000,000,
that of the name 1, and the smallest width of the mark is 2 rem ("conf…"). The shortage is divided
by weight times width: at a mark weight of 100, the name lost a fraction of a pixel and got an
ellipsis. The weight of the name cannot be below 1: when the sum of the weights is below 1, the
elements give up only that share of the shortage, and a long name without a mark would stick out of
the row. A long name shrinks when the mark has reached its smallest width. The full text of the
mark is in the hint, as before. The check is in the test of the conflict dialog
`e2e/tests/sync-ui.spec.ts`: the name `top.v` next to the mark is not shortened.

The helpers of two devices: `e2e/tests/sync.spec.ts` takes them from `e2e/tests/devices.ts`, and the
copy is deleted (the reason was decision 154: the branches of stages 4 and 5 are merged).

### 158. The author's answers: sign-out dialog, database copy, administrator limit

> **Changed later.** The database copy outside the VPS is done by decision 160: daily, in R2.

2026-11-20. The author answered three open questions on accounts:

- The dialog "Not everything is saved on the server" stays as it is (decision 151): "Sign out" first
  sends the work by itself, and the dialog is visible only when sending is refused.
- An automatic copy of the accounts database outside the VPS is not needed yet: the copies lie on
  the VPS, and `make backup-accounts` fetches them to the Mac by hand.
- The limit of 60 requests per minute applies also to the administrator operations (section 3.4):
  it protects the server, and it is enough for the manual work of the administrator.

### 159. `make backup-accounts` reads the copy with a one-off container

2026-11-20. The service runs in a container as `root`, so the daily copies in
`/var/lib/fpgasim/backup` belong to `root` with mode 600. The SSH user `taras` could not read them,
and `make backup-accounts` stopped at a read error (the script had not been run on the VPS before,
decision 129). Now `deploy/backup-accounts.sh` reads the file with the command
`docker compose … run --rm --no-deps -T --entrypoint cat api`, like `fpgasim-admin db …`
(decision 156). The list of copies is still read directly: the folder belongs to `taras`. The
permissions on the VPS did not change: the copy holds password hashes. Rejected: `docker exec` into
the running container, which does not work while the service is stopped, and the copy is needed
exactly at a failure; changing the owner of the files in the service, which needs a server
deployment and a change of the database permissions. The check on a local folder uses
`REMOTE_CAT=cat` and a stub SSH command.

### 160. Daily copy of the accounts database to R2

2026-11-20. The author changed the answer of decision 158: a copy outside the VPS is needed. Once
a day, the cron of the user `taras` on the VPS runs `deploy/offsite-r2.sh`. The latest copy from
`/var/lib/fpgasim/backup` goes to Cloudflare R2, bucket `hermes-backups`, prefix `fpgasim/`,
retention 30 days.

- The bucket and the token are the same as for the copies of another service on this host. The
  token already lies on the host, so a shared token does not widen access. A bucket of its own would
  need a bucket and a token in the Cloudflare panel from the author. Rotation deletes only inside
  the prefix `fpgasim/`.
- The file is read by a one-off container (decision 159) and goes into the bucket as a
  `rclone rcat` stream, without a temporary file with password hashes. The container call is cut
  off from input (`< /dev/null`): otherwise `docker compose run` eats the input of the caller.
- Success is an object in the bucket of the same size, not a return code: on R2 an empty listing
  gives code 0. A copy that is not from today (UTC) also gives code 1: it means the service stopped
  writing daily copies.
- The time is 03:50 UTC: the daily copy of the service is written in the first hour of the UTC day,
  and the copies of the other service go at 03:40.
- The log is `/var/lib/fpgasim/deploy/offsite-r2.log`, inside the paths allowed to the project. The
  script is in `/opt/fpgasim` after `make deploy-server`. Outside the project paths are only the
  cron line of the user and the reading of the rclone profile.
- `make backup-accounts` stays as a fallback path.

Checked on the VPS on 2026-11-20 with the prefix `fpgasim-selftest` (an object of 53,248 B, SQLite
header; the prefix was deleted afterwards) and on a local folder with a stub `rclone` (an outdated
copy gives code 1).

## 2026-11-20. Board Tang Nano 9K

### 161. Board Tang Nano 9K: scope and board choice

2026-11-20. The author gave the command to start the 9K board and answered the scope questions.

- The board is chosen at project creation: the "New project" button opens a menu with a list of
  boards. There is no board change in the project settings. *Changed on 2026-11-22: the board
  changes in "Project settings", decision 167.*
- The project board is set by the field `board` of `fpgasim.json`, as on the server. The project
  record in the database keeps a copy for the project list. The interface reads the field at
  project creation (empty, from an example, from an archive, from a folder, from files) and at
  every save of `fpgasim.json`: an edit of the field in the editor changes the drawing and the
  record. Reason: before the second board, the record and the file could not diverge. With two
  boards, the server would parse the binding for one board while the drawing showed another.
- An empty project for 20K is created without `fpgasim.json`, as before. For 9K, it is created with
  the file `{ "format": 1, "board": "tang-nano-9k" }`.
- The 9K drawing is drawn by the same code from the `geometry` of the board file. The size is
  70 × 26 mm. The position of the elements is approximate.
- There is one example: `examples/buttons_9k` (buttons and LEDs). Lessons 0–10 stay for 20K.
- There is no built-in WS2812 on 9K. The part `ws2812` is available on the breadboard. The list of
  part types does not depend on the board.
- The board data comes from the reference site of the course. The board size is not named on the
  site: it is taken from the case description on GitHub (`sabas0ba/printables`, 70.00 × 26.00 mm).

### 162. Pin standard in the board file

2026-11-20. On 9K, bank 3 is powered from 1.8 V: the buttons, the LEDs and pins 79–86. The export
to `.cst` wrote `IO_TYPE=LVCMOS33` for every pin. The author chose a format change: a pin in the
board file got the optional field `standard`. The export to `.cst` writes it, and without it the
`io.standard` of the board. The 20K file did not change, and the format version stayed `1`: the
field is optional.

Rejected: keeping `LVCMOS33` with an explanation in `note`, because the exported file for 9K would
have to be edited by hand. Not done: a server note when `IO_TYPE` in the project `.cst` does not
match the pin standard. The author chose the variant without it.

### 163. The 9K buttons are pulled up on the board

2026-11-20. The author asked to check the pull-up of the 9K buttons against the Sipeed schematic
(`Tang_Nano_9k_3672_Schematic.pdf`, the sheet with the block "Button x 2"). On the schematic: the
net `PIN3_IOT2A_BUTTON_S1_1V8` has a 10 kΩ resistor R4 to 1.8 V, a 100 nF capacitor C4 to ground,
and a button to ground. The net `PIN4_IOL5A_JTAG_SEL_S2_1V8` is the same with R2 and C3. The
pull-up is on the board.

The built-in 9K buttons are described with `idle: "drive"`: a released button holds 1. Before the
fix, it was `idle: "release"` per `docs/vision.md` ("`PULL_MODE=UP` is needed"). A project without
`PULL_MODE` read 0 and got a notice about a floating input, which the board does not have.
`PULL_MODE=UP` in `.cst` stays valid and changes nothing. The 100 nF capacitor is not modeled:
bounce is set by the setting `bounceMs`, which is 0 by default.

The reference designators on the schematic are swapped: the element S2 is connected to the net
`…BUTTON_S1…` (pin 3), and the element S1 to the net `…S2…` (pin 4). In the board file, S1 = pin 3
and S2 = pin 4: by the net names and by the reference site of the course.

## 2026-11-21. The author's tasks after 9K

### 164. Checking IO_TYPE against the pin standard

2026-11-21. The author asked to make the note that decision 162 deferred. The server compares
`IO_TYPE` from `IO_PORT` in the project `.cst` with the pin standard: the field `standard` of the
pin in the board file, and without it `io.standard`. A mismatch gives the warning `CST_IO_TYPE`
(source `cst`, the line of `IO_PORT`, fields `port`, `pin`, `given`, `expected`). The build runs,
and the simulation does not change. The display level is "warning": on a real board, a wrong
standard gives wrong levels on the pin.

Letter case does not matter: Gowin accepts `lvcmos33`. Without `IO_TYPE` there is no note: the
default standard is set by the Gowin environment, not by the project. A binding from the `pins`
field has no `IO_TYPE` key. A forbidden pin gets only `PIN_FORBIDDEN`. A value longer than 32
characters is cut in the text and in `given`. The board file format, `fpgasim.json` and the protocol
did not change: a code is added to the table `spec/diagnostics.json`. The 20K lessons in `~/fpga`
write only `LVCMOS33` and get no notes.


### 165. Fair job queue

2026-11-21. The author asked to close an item of decision 95: one key or one account can take both
job slots with endless testbenches, and the others wait up to 60 s and get `BUSY`.

The limit "one job in progress per owner" was rejected: a check (`check`) runs at every file save
and takes a slot, like a build. With such a limit, a learner's check would wait for the learner's
own build (up to 60 s) on a free server. The author chose a fair queue.

The rule: a free slot is taken at once. A freed slot goes first to an owner who has no job in
progress at the moment, and among equals to the one who joined the queue earlier. One owner on
a free server takes both slots, as before. A single waiter without jobs gets a slot no later than
the end of one job. Several waiters without jobs get slots in turn. The owner is a key or an
account, separately (decision 121). A shared build of identical projects (one for all waiters)
is taken by the one who requested it first. The wait is still no longer than 60 s, then `BUSY`. The
protocol, the error codes and the interface did not change. The class `FairSlots` is in
`server/fpgasim_server/jobs.py`.

## 2026-11-22. The author's tasks

### 166. Dragging files into an open project

2026-11-22. The author chose an item from "Open: deferred": a file cannot be dragged into an open
project, and only the button "Upload files to project" took it (decision 99).

Files dropped anywhere in the workspace are uploaded into the open project by the same function as
the button: a file with the same path is replaced together with its unsaved edit, binary files and
files beyond 200 are not taken, and the result is the same upload message. A `.zip` archive is not
unpacked into an open project: it is binary and is skipped, as with an upload by the button. A
project from an archive is still made by dragging onto the projects screen. While files are dragged
over the window, the hint "Release to upload files to the project" is visible over the workspace.

The handlers stand on the capture phase and cancel the event. Without this, CodeMirror accepts the
dropped file itself and inserts its text into the open file. A drag without files (selected text in
the editor) is not touched. The check object has `fileDrop()`. The end-to-end test assembles
a `DataTransfer` with files on the page and sends `dragover` and `drop` to the editor: Playwright
does not drop files from disk.

### 167. Changing the board in the project settings

2026-11-22. The author chose an item from "Open: deferred": the project board was changed only by
editing the field `board` in `fpgasim.json`. A project for 20K with a `.cst` for 9K gave binding
errors, and the way to fix it was not visible. Spec section 9.3 names the board among the project
settings.

- In the "Project settings" dialog, the board is chosen from the list of boards (`Choice`). Saving
  writes the field `board` through the same `fpgasim.json` edit as the other settings. The drawing
  and the board copy in the project record change by the same path as with an edit of the field in
  the editor (decision 161).
- The field is touched only if the board was changed. The default board (20K) is not written to the
  file: the field is removed, as in an empty project for 20K.
- The binding (the `.cst` file, the field `pins`) and the changes of the board parts
  (`boardParts`) do not change: the pin numbers differ between boards, and a replacement cannot be
  guessed. While another board is chosen, a warning is visible under the list: the binding was
  written for the previous board, check the numbers. The errors that name the extra numbers are the
  same `CST_NO_PIN` and `PINS_NO_PIN`. Their explanations in `spec/diagnostics.json` now name the
  board change in "Project settings".
- The end-to-end test is `e2e/tests/board9k.spec.ts`: 20K → 9K → 20K, the file, the drawing, the
  project board.

### 168. English interface language

2026-11-22. The author is preparing a submission to international hackathons: the judges read
English. The spec named Latvian as the second language. English is added first, by the same path
(spec section 9.1). The design is `docs/superpowers/specs/2026-11-22-i18n-en-design.md`, the plan
is `docs/superpowers/plans/2026-11-22-i18n-en.md`.

- The languages are `ru` and `en`. The dictionary `web/src/i18n/en.json` has the same keys and
  substitutions as `ru.json`. If a key is missing in the dictionary of a language, the string is
  taken from `ru.json`. No library is taken: the strings are already ready for a second language
  (numbers after a colon, no plural forms).
- The language is chosen once at load (`web/src/i18n/language.ts`): the address parameter `lang`
  (saved as the choice), the saved choice (`localStorage`, key `fpgasim.language`), the list of
  browser languages (the first one of `ru*` and `en*`). If there is none, Russian. The author chose
  the last rule: a learner in Latvia with a browser in Latvian or Ukrainian must not get English
  without warning. The author confirmed the rule, knowing that Chrome often adds English to the
  list by itself (`lv, en-US, en`): such a learner gets English and returns to Russian with the
  switch.
- The language is changed with a switch next to the theme switch (the projects screen with the
  sign-in, the top bar of the workspace). It writes the choice, saves the unsaved editor edits at
  once, and reloads the page: the canvas labels and the strings assembled in advance do not update
  by themselves. The account menu did not fit: a sign-in by a link with a key does not have it.
- The names "Русский" and "English" are written in the code, not in the dictionary: a language name
  is written in that language itself in any interface.
- Numbers and dates use the locale `ru-RU` or `en-US` by language. `<html lang>` follows the
  language.
- The part descriptions and the diagnostics table got `en`. In the board file, `pins.*.note` and
  `devices[].label` are text per language (`$defs/text` from `spec/part.schema.json`), the author's
  choice. `clocks[].label` and `shared[].users[]` stayed strings: neither the interface nor the
  server shows them. The board format version stayed 1: board files come only from the repository.
- In the note `DEVICE_NOT_MODELED`, the server puts the whole device label into the argument
  `device`. The interface substitution chooses the language. The source text of the note is in
  Russian, as before.
- Not translated: the text of server and core errors (the interface shows its own text by code, and
  the Russian text is visible only for codes without a dictionary string), the code and the comments
  of the examples and lessons.
- The help screenshots are taken in two languages: `web/public/help/<name>-<theme>-en.png`, the
  sizes are in `web/src/app/helpShots.en.json` (`HELP_LANG=en` for
  `e2e/tests/help-shots.spec.ts`).
- Tests: the earlier ones run in Russian explicitly (Playwright `locale: "ru-RU"`, Vitest
  `src/test-setup.ts`). The completeness of English is checked by
  `web/src/i18n/dictionaries.test.ts`, the language choice by `web/src/i18n/language.test.ts`, and
  the end-to-end test is `e2e/tests/language.spec.ts`.

### 169. `fpgasim.json` for lessons 02, 03, 06, 07

2026-11-22. The author chose the item "Tests that do not exist": the `expect.json` files of four
lessons checked only part of the behavior (decision 103). The author chose to keep `fpgasim.json`
in the lesson folder, not in copies for the tests: a project from a lesson shows at once the parts
that the lesson speaks about. Number 168 is taken by the branch of the English interface language.

- `lesson02_vote`: the switch `vote3` on pin 73. `lesson03_two_of_four`: the switches `in3` and
  `in4` on pins 73 and 74. The run goes through all combinations of inputs in Gray code, 1 ms per
  combination (8 and 16). The expectations are the toggles, the final level and the duty cycle of
  LED0. The duty cycle with a tolerance of 0.01 tells a truth table apart down to one row. In the
  browser, the duty cycle is not compared in a run with actions (decision 102).
- `lesson06_press`: the bounce of button S1 is 5 ms, as in the example `debounce`. The bounce
  generator in the core is repeatable, so the count is exact: 24 triggers for five presses instead
  of 4 without bounce. The expectations cover all six LEDs.
- `lesson07_ped`: the LEDs `ped_r` (red) and `ped_g` (green) on pins 73 and 74 light at 1. The
  expectations by pin stay the same: the state of an LED is not compared in `expect.json`.
- The parts stand in the cells (0, 0) and (0, 1) of the breadboard field.
- `runLesson` (`e2e/tests/expect.ts`) requires `fpgasim.json` in the project exactly when it lies in
  the lesson folder. The cold build in `e2e/prod/prod.spec.ts` passes it in the field `config`. The
  local end-to-end set also runs `lesson03_two_of_four`: the switches from `fpgasim.json` in the
  browser.
- Without `fpgasim.json`, the new expectations of lessons 03 and 06 are not met: checked by a run.

### 170. README in English

2026-11-22. The author chose to prepare for the hackathon: all hackathons considered require a
README and a video in English. The project documents stay in Russian. The README is an exception:
the judges read it. GitHub shows `README.md`, so `README.md` is in English, the previous Russian
text is moved to `README.ru.md`, and the files link to each other. The screenshots in the README are
the screenshots of the English help from `web/public/help/`, without copies. The README does not
promise open source code, a license or sign-in without an account: the author did not make these
decisions. The limits of the simulator are taken from the `limits.*` strings of the dictionary
`en.json`. The video script is `docs/video-script.md`.

### 171. Access key for the hackathon judges

2026-11-22. The Cognizant rules require free access of the judges to the working project, without
limits, until the end of the evaluation. The author chose a key by link out of three options.
Rejected: a guest sign-in for any visitor (new code on the server and in the interface, protection
of the VPS from overload) and a shared account (the judges see and edit each other's projects).

- The key `judges` is issued with the command `fpgasim-admin key add judges` straight into the
  macOS keychain, service `fpgasim-judges`. It was not printed on the screen. The code did not
  change: the key gives the build, the run, the testbench and the examples, and the projects lie
  only in the browser (section 2.4 of `docs/tz-accounts.md`).
- The link is `https://fpga-sim.scriptorium.cc/?lang=en#key=<key>`: the language comes from the
  address parameter, the key from the part after `#`. The page erases the key from the address.
- The limit of builds per minute counts per key: all judges share one limit.
- After the evaluation ends, the key is disabled (`key disable judges`).
- Check: `/v1/info` with the key gives 200. The `make e2e-prod` tests "static" and "blink3: build,
  run and testbench" passed with the key `judges`.
- The text for the submission form is `docs/submission.md`.

### 172. Repository language is English

2026-11-22. Before open-sourcing the code, the author decided that commit and merge messages,
comments, docstrings and all of `docs/` are in English. The author chose the scope with buttons.

- Translated: all of `docs/`; comments and docstrings in `web/`, `server/`, `core/`, `tools/`,
  `e2e/`, `deploy/` and the `Makefile`. Comments that only restated the code were deleted.
- Stay Russian: test names, messages printed by scripts, server and core error texts without a
  dictionary entry, code and comments of `examples/` and the lessons, `web/src/i18n/ru.json`,
  `README.ru.md`. Earlier commit messages stay as they are.
- Not translated: `server/templates/**` (their comments go into the generated shim, which a test
  compares with stored output) and test data under `server/tests/`.
- The code change is checked mechanically: the sources with comments and docstrings removed are
  identical before and after.
- `CLAUDE.md` states the rule (section "Стиль"); the section names of `docs/progress.md` it cites
  are the English ones.

### 173. Host names in site settings, not in the code

2026-11-22. Before open-sourcing, the author chose to remove every host name of the author's deployment
from the code, including the schema identifiers. Rejected: keeping the defaults and only describing the
variables (forks would talk to the author's server by default).

- One deployment is described by the site settings file `~/.config/fpgasim/site.env` (another path:
  `FPGASIM_SITE_ENV`); the format is `deploy/site.env.example`. Keys: `FPGASIM_WEB_URL`,
  `FPGASIM_BUILD_URL`, `VPS`, `FPGASIM_PAGES_PROJECT`, `FPGASIM_BACKUP_BUCKET`. The scripts in `deploy/`,
  `tools/bench/run_vps.sh` and the `e2e-prod` target read it through `deploy/site.sh` (the Makefile does not
  include it: a make include would win over the environment). Variables set
  in the environment win over the file. A missing value stops the script with a message.
- CORS: the service reads `FPGASIM_CORS_ORIGINS` (comma-separated), then `server.cors_origins` of
  `config.toml`, then the default `http://localhost:5173`. `make deploy-server` writes
  `/var/lib/fpgasim/deploy/site.env` on the VPS with `FPGASIM_CORS_ORIGINS=<FPGASIM_WEB_URL>,http://localhost:5173`
  and the backup bucket; `remote.sh` puts the origins into `compose.env`, Compose passes them to the
  service. The production server had no `config.toml` and lived on the old default, so the behavior
  stays the same.
- `deploy/offsite-r2.sh` takes the bucket from the same `site.env`; the cron line on the VPS does not change.
- `web/public/_headers` holds the mark `__BUILD_URL__` in `connect-src`; the Vite build writes
  `VITE_BUILD_URL` in its place, `vite preview` writes `FPGASIM_SERVER`. `deploy/deploy-web.sh` checks
  the result.
- The nginx vhost is the example `deploy/nginx-build.conf.example` with `build.example.org`.
- `make e2e-prod` takes `FPGASIM_WEB_URL` and `FPGASIM_BUILD_URL` from the site settings.
- Schemas: `$id` is the path inside `spec/` (`fpgasim.schema.json`, `protocol/run.schema.json`); the
  references between schemas were already relative or became relative. `tools/spec/check.mjs` now
  requires `$id` to equal that path. No project file refers to a schema by URL, so the documents
  themselves do not change.
- Documents keep the author's addresses where they describe the author's deployment or history
  (README "Try it", the decision and progress logs, the hackathon texts).

### 174. Open source: MIT, a new public repository

2026-11-22. The author chose with buttons:

- License MIT (`LICENSE`). The course lessons in `examples/lessons/` are the author's own course and go
  under the same license.
- The public repository starts with one commit of the current tree; its author email is the GitHub
  noreply address. The private repository with the full history becomes `Rekotek/fpga-sim-private`
  and stays closed: it holds personal details that cannot be removed from the history. The dated
  history (needed for the hackathon rule "significantly updated after 2026-11-11") stays there; the
  public tree keeps dates in `docs/progress.md` and `docs/decisions.md`.
- Left in the files on purpose: the admin login `taras` in examples and tests, the macOS keychain
  service names, the backup bucket name in the logs, the VPS model and the demo addresses. None is a
  secret; sign-in needs a password and locks after failed attempts.
- `CLAUDE.md` and `AGENTS.md` are in English.
- Checked before publishing: gitleaks over the whole history and the final tree (two false positives:
  the password alphabet and a dictionary key), the real keys and passwords from the keychain against
  all history objects (no match), the shapes of issued keys and passwords (none).

### 175. The assistant: own panel, the author's key on the server

2026-11-22. The author asked for an assistant that reads the code, the messages and the board state and
gives advice. Design: `docs/superpowers/specs/2026-11-22-assistant-design.md`. The spike was
throwaway code outside git; it was removed after the merge.

- Approach: an own "Assistant" tab, not the agentic-web runtime of the hackathon (the assistant is wanted
  regardless of it), and the author's Anthropic key on the server, not a key of each user (students should
  not need one).
- The browser runs the tool loop: the simulation state exists only there. The server operation
  `POST /v1/assistant` is a stateless relay: key, system prompt, tool definitions, model, effort, limits.
- Model `claude-sonnet-5-5`, effort `medium` by default, both in `[assistant]` of `config.toml`. The spike
  answered four cases (inverted LED, button without pull, wrong blink period from the waveform, missing
  `;`) correctly at 1–2 cents per first question. Refusals go to the fallback model (`fallbacks: "default"`).
- Limits are the same for everyone, keys included: 20 requests a minute, 400,000 tokens a day per key or
  account, 4,000,000 a day for the server (about $10 at Sonnet prices).
- One call in flight per key or account and at most four on the server, in their own threads; one model
  attempt of at most 100 s, so the server answers before nginx cuts the request at 150 s (final review of
  the branch).
- The assistant only advises: it does not edit, build, run or press buttons.
- The key file is written by `fpgasim-admin assistant key` from standard input; the spend report is
  `fpgasim-admin assistant usage`.

### 176. Assistant token counts in their own SQLite file

2026-11-22. The design put the daily counts into the account database. They live in
`<data folder>/assistant/usage.db` instead: the account database has a strict schema check and backup
restore, and a new table would need a schema migration and make the old backups unrestorable, for data
that is only a spend counter. The file is not in the database backups; losing it resets the counts.

### 177. A scripted model for the assistant tests

2026-11-22. `model = "fake"` in `[assistant]` gives a model without a key or network: it asks for
`list_files` and `get_board`, then answers "Тестовый ответ. Инструменты: list_files, get_board.";
`#сбой` in the question makes it fail. `tools/dev/server.sh with` (the end-to-end bench) turns it on, so
`make check` makes no paid calls. The real model is checked by hand with `e2e/manual/assistant-live.spec.ts`.

### 178. The assistant tool step stays on the screen; the tools used under each answer

2026-11-23. The live check found that the step in progress ("Reading a file…", spec section 9.3) was never on
the screen: the tools are synchronous and take under a millisecond, so `ask()` set the step and cleared it
before React rendered.

- Before each tool, `ask()` shows the step and waits `pause` from its dependencies: 300 ms in the panel
  (`STEP_MS` in `AssistantPanel.tsx`), one macrotask in the unit tests. One frame would let the browser render
  the step, but a person cannot read a 16 ms line. A timer, not `requestAnimationFrame`: frames stop in a
  background tab, timers only slow down. Ten tool calls add at most 3 s to an answer that takes seconds anyway.
- After the wait, a reset drops the turn and "Stop" closes this and the remaining calls with a stop result.
- Under each answer a line lists the tools used, in the order of first use, a repeated tool with its count
  ("The assistant looked at: the file list, a file ×3"). The spec did not have it; the step alone vanishes
  with the answer, and the list shows what the advice rests on.
