# Version 1: final report

Date: 2026-11-19. Stage 11 of spec section 12. This is a snapshot at the acceptance day; the current
decisions are in `docs/decisions.md`, and the open items and what is deployed now are in
`docs/progress.md`.

## 1. What is deployed

| What | Where | State |
|---|---|---|
| Interface static files | Cloudflare Pages, project `fpga-sim`, `https://fpga-sim.scriptorium.cc` | deployment `20261119-2035-450eecb` (`main`, decisions 107 and 108) |
| Build server | VPS `fpga-build`, `https://fpga-build.scriptorium.cc` | deployment `20261119-2107-c1740f0` (`main`, decisions 108 and 109, core 0.2.1) |

Deployment and rollback procedure: `docs/deploy-web.md`, `docs/deploy-server.md`.

## 2. Acceptance criteria

| Criterion | How it was checked | Result |
|---|---|---|
| `make e2e-prod` passes against the production URLs | runs on 2026-11-19 against deployments `7defce7`, `a2b64ba`, `450eecb` and against server `c1740f0` (core 0.2.1) with static files `450eecb`: each 35 tests out of 35 | met |
| Every lesson 2–10 builds without `fpgasim.json` and passes its `expect.json` | 32 lessons: `make test-examples` (local server, modes `all` and `ports`, 64 runs) and `make e2e-prod` (production server, Chromium) | met; what the expectations do not cover is in section 4 |
| Four simultaneous sessions build and run different projects without errors | end-to-end test: four browser contexts, projects `blink3`, `uart_hello`, `lesson05_runner`, `lesson10_color`; the builds start at once, each session has its own `buildId`, simulation time grows, there are no console errors and no policy violations. Passes on the local stand and on the production URLs | met |
| The report contains speed and build time for each lesson | section 3 | met |

Besides the criteria, `make e2e-prod` checks: the static headers (content security policy,
`nosniff`), the secure context and the enabled "Open folder" button, removal of the key from the
address bar, and the build, run and testbench of `blink3` on the production server
(`PASS: 8 checks`).

## 3. Build time and speed per lesson

Measurement conditions:

- **Visibility mode.** The main columns are `ports` mode, the default after decision 108: a
  `make e2e-prod` run against deployment `450eecb`, Mac on mains power (`pmset`:
  `lowpowermode 0`). A run against server `c1740f0` gave the same results (from 1.74× to 2.95×);
  the table was not recalculated.
- **Build time** is the field `durationMs` of the production server's response to a cold build (a
  marker comment is added to `top.v`, so the cache does not hit). VPS Hetzner CX33.
- **Speed** is Chromium 159 without a window (Playwright) on a Mac Apple M2 Max, the page from the
  production URL, the "maximum" multiplier, 3 s of real time after a 0.5 s ramp-up. A ratio of
  1.00× is the board's real time (27 million clock cycles/s).
- **The last two columns** are the ratio in `all` mode (the former default) in runs of the same
  day: on mains power against deployment `7defce7`, and on battery in low power mode
  (`lowpowermode 1`) against deployment `086f436`. On mains power, `ports` mode is faster than
  `all` mode by a factor of 1.30–1.97. On battery, `ports` mode was not measured.
- **Regular Chrome is slower than Chromium without a window.** In the author's Chrome,
  `lesson07_ped` in `all` mode ran at 1.04× with the "maximum" multiplier (1.10× in the table).
  With multiplier 1, before the fix of decision 107, it ran at 0.72×; after it, at 0.98–1.00×
  with the notice `SLOW` in the first seconds. In `ports` mode the author got 1.0× with
  multiplier 1.

| Lesson | Build, s | `sim.wasm`, KB | Million clock cycles/s | Ratio, `ports` | `all`, mains | `all`, battery |
|---|---:|---:|---:|---:|---:|---:|
| `lesson02_gates` | 4.11 | 360 | — | no clock | — | — |
| `lesson02_vote` | 4.24 | 360 | — | no clock | — | — |
| `lesson03_two_of_four` | 4.07 | 360 | — | no clock | — | — |
| `lesson04_blink` | 4.14 | 359 | 74.52 | 2.76× | 2.01× | 1.42× |
| `lesson04_blink3` | 4.27 | 360 | 76.32 | 2.83× | 2.00× | 1.38× |
| `lesson05_chain` | 4.10 | 360 | 79.24 | 2.93× | 1.84× | 1.28× |
| `lesson05_runner` | 4.23 | 359 | 74.14 | 2.75× | 1.95× | 1.36× |
| `lesson06_counter` | 4.41 | 360 | 76.55 | 2.84× | 1.54× | 1.07× |
| `lesson06_debounce` | 4.32 | 360 | 76.88 | 2.85× | 1.66× | 1.15× |
| `lesson06_press` | 4.17 | 359 | 72.16 | 2.67× | 1.84× | 1.28× |
| `lesson06_runner_dir` | 4.22 | 361 | 64.47 | 2.39× | 1.60× | 1.10× |
| `lesson06_stable` | 4.21 | 360 | 75.38 | 2.79× | 1.56× | 1.09× |
| `lesson07_cross` | 4.15 | 360 | 69.08 | 2.56× | 1.45× | 1.01× |
| `lesson07_lock` | 4.37 | 360 | 75.34 | 2.79× | 1.47× | 1.02× |
| `lesson07_ped` | 4.27 | 361 | 46.29 | 1.71× | 1.10× | 0.77× |
| `lesson07_traffic` | 4.09 | 360 | 68.87 | 2.55× | 1.52× | 1.05× |
| `lesson08_breathe` | 4.15 | 360 | 62.03 | 2.30× | 1.77× | 1.22× |
| `lesson08_buttons` | 4.17 | 360 | 60.53 | 2.24× | 1.39× | 0.96× |
| `lesson08_gamma` | 4.13 | 360 | 59.90 | 2.22× | 1.40× | 0.97× |
| `lesson08_levels` | 4.10 | 360 | 55.26 | 2.05× | 1.48× | 1.02× |
| `lesson08_pause` | 4.19 | 360 | 61.85 | 2.29× | 1.55× | 1.07× |
| `lesson09_bright` | 4.22 | 361 | 55.47 | 2.05× | 1.13× | 0.77× |
| `lesson09_cmd` | 4.20 | 361 | 55.36 | 2.05× | 1.17× | 0.82× |
| `lesson09_echo` | 4.19 | 360 | 57.89 | 2.14× | 1.18× | 0.83× |
| `lesson09_hello` | 4.38 | 360 | 58.85 | 2.18× | 1.23× | 0.87× |
| `lesson09_tx_byte` | 4.24 | 360 | 62.77 | 2.32× | 1.25× | 0.88× |
| `lesson10_breathe` | 4.12 | 360 | 61.26 | 2.27× | 1.30× | 0.90× |
| `lesson10_buttons` | 4.17 | 360 | 60.06 | 2.22× | 1.17× | 0.82× |
| `lesson10_color` | 4.19 | 360 | 59.54 | 2.21× | 1.47× | 1.03× |
| `lesson10_pause` | 4.25 | 360 | 59.83 | 2.22× | 1.19× | 0.84× |
| `lesson10_rainbow` | 4.36 | 360 | 59.45 | 2.20× | 1.37× | 0.96× |
| `lesson10_uart` | 4.22 | 361 | 48.43 | 1.79× | 0.91× | 0.63× |

Build result in `ports` mode: from 4.07 to 4.41 s, median 4.20 s (the spec's threshold is 15 s).

Speed result in `ports` mode on mains power: all 29 lessons with a clock run faster than real time
with the "maximum" multiplier, from 1.71× (`lesson07_ped`) to 2.93×. In `all` mode on mains power,
one lesson ran slower than real time (`lesson10_uart`, 0.91×); on battery in low power mode, 13
lessons out of 29 did (from 0.63× to 0.97×).

**What this means for the student.** In the default mode, a lesson at multiplier 1× runs in real
time with a margin of at least 1.7 times on the author's Mac on mains power. The button "Show
internal signals and rebuild" turns on `all` mode: in it, lessons 7, 9 and 10 run at the limit of
real time or slower, the status bar shows the actual ratio, and the behavior of the design stays
correct. On a student's laptop and on battery, the margin of `ports` mode has not been checked.

Assumption 5 of spec section 15.1 ("the speed loss allows keeping `all` mode as the default") was
confirmed in stage 0 on `blink3` and was not confirmed on the lessons. The spec's fallback path
applies: the default is `ports` and the debug mode is a button (decision 108).

## 4. What the lessons' `expect.json` do not cover

Details: decision 103.

| Lesson | What is not checked | Reason |
|---|---|---|
| `lesson08_buttons`, `lesson08_gamma` | brightness at each level separately | the mean PWM share over the run was checked; it tells a gamma table from multiplication by 17, but not each table row |
| lessons 8–10 with buttons | debounce | the same block as in lesson 6; a separate pulse does not check it |
| all lessons | the `tb_top.v` testbenches | the stage criterion is `expect.json`; the testbench was checked on the production server on `blink3` |

Inputs on pins 73 and 74 (`lesson02_vote`, `lesson03_two_of_four`), bounce in `lesson06_press` and
the pedestrian LEDs in `lesson07_ped` are checked since 2026-11-22: these lessons have an
`fpgasim.json` (decision 169).

No behavior that version 1 parts cannot check at all was found in lessons 2–10: the cases with
pins 73 and 74 and with bounce are covered by a part on the breadboard or a button setting.

## 5. Keys

As of 2026-11-20, the keys `taras` (the author), `e2e-prod2` and `e2e-prod3` (acceptance tests) are
enabled; `agent-check` and `e2e-prod` are disabled (`e2e-prod` ended up in an agent session
transcript). The author issues keys to students: the command and the link format are in
`docs/deploy-web.md`. The agent does not issue keys: the permission mode rejects this command on the
VPS. The key `e2e-prod3` is stored in the macOS keychain (service `fpgasim-e2e-prod`):
`make e2e-prod` takes it from there. There is no copy of the key `e2e-prod2` anywhere; the author
may disable it.

## 6. For the author

- Go through lessons 2–10 in the application at `https://fpga-sim.scriptorium.cc`.
- Check operation on a student's laptop, including the speed ratio on `lesson07_ped` and
  `lesson10_uart` at multiplier 1× in the default mode and after the button "Show internal signals
  and rebuild" (section 3).
- Check "Open folder" on the production URL with a real lesson folder: the end-to-end test checks
  only that the button is enabled.
- Review the text of the short help (the "Help" button).
- Items from earlier stages that remain with the author: `docs/progress.md`.

## 7. What is deferred

The list in spec section 15.2 did not change. Beyond it, these items remain from the version 1
stages:

- selecting signals from the testbench VCD file beyond the first 100; X and Z states in the
  waveform;
- a limit on simultaneous jobs per key; done on 2026-11-21 with a fair queue (decision 165);
- an assessment of embedding Surfer (an optional task of stage 8);
- an end-to-end check of dragging files onto the projects screen; done on 2026-11-22
  (`e2e/tests/stage10.spec.ts`);
- the core test suite does not run the lessons (decision 103).
- the note "the device will appear in version N" when binding a port to a pin from `devices`
  (spec section 3.2) is not done: the binding is allowed silently, and the version is visible only
  in the board's device list. The author's decision of 2026-11-19: do it. Done on 2026-11-20
  (decision 110); showing it in the binding dialog is deferred;
- a third visibility mode, "ports and selected signals" (the author's idea of 2026-11-19):
  Verilator marks only the signals from the list as accessible (`public_flat_rw` in a `.vlt` file),
  and the rest of the design is simplified. It requires a signal list without an `all` build, a
  rebuild when the list changes, a change to the `fpgasim.json` format and to the cache key; the
  speed loss was not measured;
- for the design work (the author's decision of 2026-11-19): open the part dialog by clicking the
  part on the drawing; now it opens only with the ✎ icon in the "Parts" list, and the author did
  not find it;
- for the design work: the WS2812 LED on the drawing is small, and the color change in
  `lesson10_rainbow` is hard to notice.
