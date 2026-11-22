# Progress log

The first section says where we are now. Format of a new entry: the date, what was done, what was
postponed and why, which decisions were made (details are in `docs/decisions.md`).

## Where we are now (2026-11-22)

What runs on the production URLs: section "Deployments".
Latest work: accounts and projects on the server (2026-11-20, `docs/tz-accounts.md`), the
Tang Nano 9K board (2026-11-20, decisions 161–163), the `IO_TYPE` check (decision 164), the fair job
queue (decision 165), dragging files into an open project and changing the board in project settings
(2026-11-22, decisions 166–167), tests for dragging onto the projects screen, `TB_DISK_LIMIT`,
`$stop` and `$fatal`, undo before save, the English interface language (2026-11-22, decision 168),
`fpgasim.json` for lessons 02, 03, 06, 07 (decision 169), the English README (decision 170), the
access key for the hackathon judges (decision 171). The list is in section "After acceptance".

**Version 1 is complete.** All stages of spec section 12 (0–11) are done and merged into `main`.
There are no further stages in the spec: new work follows the author's task, and its entry is
appended to section "After acceptance". The summary of the version is `docs/v1-report.md`: what is
deployed, the acceptance criteria, speed per lesson, what is postponed.

The detailed stage entries (what was done, criteria tables, test counts, live check) were removed
from this file in the cleanup of 2026-11-19. To get them: `git show c1740f0:docs/progress.md`.

## Next tasks

The author has named no tasks. Open items are in the "Open" sections below. The postponed work of
version 2 is spec section 15.2: do not start it without the author's command.

## Stages

| Stage | Date | What | Merge into `main` | Decisions |
|---|---|---|---|---|
| 0 | 2026-11-18 | Measuring speed and build time (`docs/stage0-report.md`) | — | 1–13 |
| 1 | 2026-11-18 | Repository skeleton and formats | `c309745`, `13a2697` | 14–18 |
| 2 | 2026-11-18 | Core on an ordinary machine | `1f4e3bb` | 19–29 |
| 3 | 2026-11-18 | Build server | `45cef34`, `45398cf` | 30–45 |
| 4 | 2026-11-19 | Interface skeleton and running in the browser | `f42485f`, `222635c` | 46–52 |
| 5 | 2026-11-19 | Board, LEDs, buttons, time control | `ce31452` | 53–64 |
| 6 | 2026-11-19 | Breadboard and pin binding | `32cc89a` | 65–73 |
| 7 | 2026-11-19 | UART and WS2812 | `637a463` | 74–81 |
| 8 | 2026-11-19 | Signals and waveforms | `3bfffcd` | 82–88 |
| 9 | 2026-11-19 | Testbench | `517f7dc` | 89–95 |
| 10 | 2026-11-19 | Folder on disk and archives | `c021185` | 96–100 |
| 11 | 2026-11-19 | Deployment and acceptance of version 1 | `2e907b8` | 101–106 |

## After acceptance

- **2026-11-19. Speed with a numeric multiplier** (decision 107, merge `a2b64ba`). The host calls
  chunks one after another at any multiplier while the core lags. `lesson07_ped` at multiplier 1 in
  `all` mode in the author's Chrome: was 0.72×, now 0.98–1.00×.
- **2026-11-19. The default visibility mode is `ports`** (decision 108, merge `450eecb`). The
  "Show internal signals and rebuild" button is on the "Signals" tab. The end-to-end tests of stages
  6, 8 and 10 and two server tests set the `all` mode explicitly; the expectations about signals did
  not change.
- **2026-11-19. The `SLOW` notice is softened** (decision 109, merge `c1740f0`). Core 0.2.1.
- **2026-11-19. Documents cleanup.** The spec was checked against the code, the log was compressed,
  and decisions got pointers to the decisions that replaced them.
- **2026-11-20. Note on an onboard part without a model** (decision 110). Binding a design port to
  a pin of a device from `devices` with a `since` version gives the warning `DEVICE_NOT_MODELED` at
  the "notice" level. Server test: project `server/tests/projects/device_pin`. Postponed: showing
  the notice in the binding dialog — the task did not require changing the interface.
- **2026-11-20. Interface design** (decisions 111–115, merge `e35eac8`). The interface moved to
  Tailwind and shadcn; light and dark themes; a top bar in the order of work: the project menu,
  "Build" with a build mark, one "Run" / "Pause" button, a composite step button. "Run" builds a
  project that is not built or was changed. File actions are in the row menu; the board buttons are
  in the area header; the drawing is larger; in help and dialogs the header is pinned; on the
  "Waveforms" tab a signal is added with the "Signal" button. Spec section 9.3 and item 1 of
  section 9.5 were corrected. End-to-end tests: lists are chosen with the `choose` helper, and
  `e2e/tests/design.spec.ts` was added. The author accepted the look on 2026-11-20. Postponed: a
  part dialog on a click in the drawing, the size of WS2812 and the strip, showing
  `DEVICE_NOT_MODELED` in the binding dialog — the task concerned the look and the order of
  elements; the items stay in "Open: deferred".
- **2026-11-20. Screenshots in help** (decision 116). Four help sections hold eight screenshots
  with captions, a separate set for the light and dark themes. The screenshots are taken by the
  script `e2e/tests/help-shots.spec.ts` (`HELP_SHOTS=1 e2e/run.sh tests/help-shots`). Tests: a unit
  test (every screenshot has files for both themes, a size and a caption) and an end-to-end test of
  stage 11 (the screenshots load, the set follows the theme). Merge `e981366`, deployed 2026-11-20.
  Postponed: a detailed description of every button — the author chose the existing text with
  screenshots.
- **2026-11-20. Accounts and projects on the server** (`docs/tz-accounts.md`, stages 1–6).
  Sign-in with login and password, the "Users" page, sync of "in browser" projects with the server,
  conflicts, viewing of work by the administrator, daily database backups. The detailed stage
  entries were removed in the cleanup of 2026-11-20; to get them:
  `git show c593f96:docs/progress.md`.

  | Stage | What | Merge into `main` | Decisions |
  |---|---|---|---|
  | 1 | Server: accounts and sessions | `4ea7bd9` | 118–126 |
  | 3 | Server: projects, trash, database backups | `76a8702` | 127–129, 140 |
  | 2 | Sign-in interface and the "Users" page | `7071a40` | 130–134 |
  | 4 | Sync in the browser | `3ae196a` | 141, 142 |
  | 5 | Sync indicators, conflict, viewing of work | `b883009` | 150–154 |
  | 6 | Documents, help, acceptance test | `b16756d`, `b54b66b`, `8c14e6f` | 155 |
  | — | The `deploy/fpgasim-admin` wrapper | `0a199d9` | 156 |

- **2026-11-20. Small fixes after accounts** (decision 157, merge `2bef771`). In the "Files" area,
  when space runs short, the label shrinks, not the file name. The wrapping of the board name in the
  dialog of a user's projects did not reproduce (window width 1280 and 900).
- **2026-11-20. The author's answers** (decision 158): the dialog "Not everything is saved on the
  server" stays as it is, and the limit of 60 requests per minute applies to the administrator too.
- **2026-11-20. Database backups outside the VPS** (decisions 159, 160). A documents cleanup against
  the live VPS showed that `make backup-accounts` did not read the backup (the file belongs to
  `root`, mode 600). Now it reads it through a one-off container, and the daily copy goes to R2:
  `deploy/offsite-r2.sh` from the cron of the user `taras`, bucket `hermes-backups`, prefix
  `fpgasim/`, 30 days. Both paths and the restore from R2 were checked on the VPS.

- **2026-11-20. Tang Nano 9K board** (decisions 161, 162; spec section 3.3). The file
  `boards/tang-nano-9k.json`; a pin in the board format got the optional field `standard`, and the
  export to `.cst` writes `LVCMOS18` for the 1.8 V bank. The "New project" button became a menu
  with boards. The project's board is set by the `board` field of `fpgasim.json`. The example
  `examples/buttons_9k`. Tests: `e2e/tests/board9k.spec.ts`, the server test
  `test_board_from_config_tang_nano_9k`, unit tests of the export.
- **2026-11-20. Pull-up of the 9K buttons** (decision 163). The Sipeed schematic showed 10 kΩ
  resistors from the buttons to 1.8 V. The built-in 9K buttons got `idle: "drive"`: a project
  without `PULL_MODE=UP` reads a released button as 1 and gets no notice about a floating input.
  Test: `e2e/tests/board9k.spec.ts`, a project without `PULL_MODE`.
- **2026-11-21. A 9K project in the acceptance set.** The test `buttons_9k` was added to
  `e2e/prod/prod.spec.ts`: the project's board, a build on the production server, `expect.json`,
  the key "2" for the button S2. The test passed on the production URLs on 2026-11-21 (deployment
  `20261120-2137-f66175e`). No deployment is needed: the change is only in tests and documents.
- **2026-11-21. Checking `IO_TYPE` against the pin standard** (decision 164; spec sections 2.6 and
  7.6). The server issues the warning `CST_IO_TYPE` if `IO_TYPE` in `IO_PORT` does not match the pin
  standard in the board file. The display level is "important", the mark is on the `IO_PORT` line,
  and the build goes on. Tests: project `server/tests/projects/cst_io_type`, a unit test for 9K in
  `test_board_from_config_tang_nano_9k`. Live check on `make dev`: `buttons_9k` with
  `IO_TYPE=LVCMOS33` on `btn_s1` gives a line in the messages panel. Deployed: server and static
  files `20261121-1007-baa31e0`.
- **2026-11-21. Login collision in `freshUser`.** `e2e/tests/devices.ts` joined a prefix,
  `Date.now() % 1_000_000` and a counter without a separator: two calls gave one login
  (`…12345`+`1` and `…1234`+`51`), and the test failed at account creation. Now the login is the
  prefix, the full time in base36 and the counter through "-" (about 14 characters against a limit
  of 32). No deployment is needed: the change is only in tests.
- **2026-11-21. Dictionary cleanup.** 26 strings of removed elements were deleted from
  `web/src/i18n/ru.json` (`symbol.*`, `files.kind.*`, `export.menu`, `files.rename`,
  `files.delete`, `files.cancel`, `workspace.reset`, `workspace.step`, `projects.group.own`,
  `projects.actions`). A string counted as removed if its key is in the code neither as a literal
  nor under the prefix of a composite key (`` `help.${name}.title` `` and similar). Strings under
  such prefixes were not checked. There are no visible changes. Deployed with static files
  `20261121-2138-7ab1d1f`.
- **2026-11-21. Probe contrast in the dark theme.** The outline and tip of the probe
  (`web/src/parts/probe.ts`) take their color from the new theme variable `--board-probe`: in the
  light theme the previous `#4a515c`, in the dark theme `#aeb7c4` (was `#4a515c` on the `#1b2029`
  field). The level fill (1, 0, no net) did not change. Live check on `make dev`: the example
  `buttons`, probes on pins 15, 16 and 27, button S1 pressed, breadboard screenshots in both themes.
  Deployed with static files `20261121-2138-7ab1d1f`.
- **2026-11-21. Fair job queue** (decision 165; spec section 8.5). A freed job slot goes first to a
  key or an account with no jobs running. One owner no longer holds both slots while others wait.
  The class `FairSlots` in `server/fpgasim_server/jobs.py`, tests `test_fair_slots_*` in
  `server/tests/test_units.py`. The limit "one job per owner" was rejected: the check on save would
  wait for the same student's build. Deployed: server `20261121-2210-28336dc`.
- **2026-11-22. Breadboard parts in the dark theme.** The button, switch, LED, UART, WS2812 and
  probe were captured on `make dev` in both themes (the example `buttons`, one part of each kind).
  All are readable on the dark field: the bodies of the button, switch and WS2812 are light; the
  dark UART body is set off by the outline `#6d737c` and a light terminal mark, like the UART on the
  board itself. The body colors are the colors of the real parts, the same in both themes; no change
  is needed. No deployment is needed.
- **2026-11-22. Dragging files into an open project** (decision 166). Files dropped into the
  workspace are uploaded as with the "Upload files to project" button; a hint is visible during the
  drag. The editor does not paste a dropped file. End-to-end test in `e2e/tests/stage10.spec.ts`. A
  `.zip` archive is not unpacked into an open project: it is binary, as with an upload by the
  button.
- **2026-11-22. Changing the board in project settings** (decision 167). In "Project settings" the
  board is chosen from a list; saving writes the `board` field in `fpgasim.json`, and the drawing
  and the board in the project list change. The binding and the changes to the board's parts are not
  touched: a warning under the list says to check the pin numbers. The explanations of `CST_NO_PIN`
  and `PINS_NO_PIN` name the board change. End-to-end test in `e2e/tests/board9k.spec.ts`. It takes
  effect after `make deploy-web`.
- **2026-11-22. Test of dragging files onto the projects screen** (decision 99). The end-to-end
  test in `e2e/tests/stage10.spec.ts` builds a `DataTransfer` on the page, like the test of
  decision 166: files give a new project without the binary `top.fs`, one `.zip` archive gives a
  project from the archive with the archive's name. The test was checked against a breakage: a
  handler that does not accept one file makes it fail. The change is only in tests; no deployment is
  needed.
- **2026-11-22. `TB_DISK_LIMIT` test** (decision 95). `test_testbench_disk_limit` in
  `server/tests/test_testbench.py`: the testbench writes 2 MB into the job folder with a limit of
  1 MB; the response is one `TB_DISK_LIMIT` message with the limit, and the job folder is removed.
  An ordinary testbench fits within the same limit. The test was checked against a breakage: without
  the `disk` branch in `api.py` the response is `TOOLCHAIN_FAILED`, and the test fails. The change
  is only in tests; no deployment is needed.
- **2026-11-22. `$stop` and `$fatal` test** (decision 29). The engine check designs
  `core/tests/designs/stopcheck` and `fatalcheck` call `$stop` at clock cycle 101 and `$fatal` at
  clock cycle 51; `tools/native/run_examples.py` waits for the notice `MODEL_FINISH` and the same
  clock cycle number in the `all` and `ports` modes. The test was checked against a breakage:
  without `fatalOnError(false)` in `engine_verilator.h` the process aborts ("Aborting..."), and four
  runs fail. The change is only in tests; `core/VERSION` did not change; no deployment is needed.
- **2026-11-22. Test "an edit was undone and saved at once"** (a finding of the stage 4 review). An
  end-to-end test in `e2e/tests/stage4.spec.ts`: an edit of `top.v` is written to storage, it is
  undone (`Ctrl+Z`) and saved at once (`Ctrl+S`) while the timer write of the undo has not fired
  yet; after a reload the file matches the original and is not marked unsaved. The test was checked
  against a breakage: without writing the undone edit in `saveAllNow` (`web/src/app/actions.ts`) the
  undone edit comes back, and the test fails in five runs out of five; with it the test passes in
  ten out of ten. The end of the write is not visible in the debug object, so the test waits 600 ms
  after the save. The change is only in tests; no deployment is needed.
- **2026-11-22. English interface language** (decision 168, branch `feat/i18n-en`). The author is
  preparing a hackathon submission. The dictionary `en.json`, a switch next to the theme switch, the
  URL parameter `?lang=en`; a browser with neither `ru` nor `en` in its language list gets Russian.
  Parts, diagnostics, pin labels and board devices come with English; board format: the `note` and
  `label` of devices are text per language. Help screenshots in two languages. The existing tests
  run in Russian explicitly. Deployment: first the static files, then the server (the board file in
  the image, `resolve.py`), then `make e2e-prod`: the new interface accepts a device label in the
  `DEVICE_NOT_MODELED` notice both as a string and as an object, while the old one would show the
  object as JSON. Postponed — "Open: deferred", block "English language".
- **2026-11-22. Full check of lessons 02, 03, 06, 07** (decision 169). The lesson folders got
  `fpgasim.json`: switches on pins 73 and 74 for `lesson02_vote` and `lesson03_two_of_four`, S1
  bounce for `lesson06_press`, pedestrian LEDs for `lesson07_ped`. The `expect.json` of lessons 02
  and 03 run through the whole truth table, and `lesson06_press` expects 24 triggers from the
  bounce. The lesson tests in the browser compare `fpgasim.json` with the lesson folder; the local
  set also runs `lesson03_two_of_four`. Without `fpgasim.json` the expectations of lessons 03 and 06
  fail (checked). A deployment of static files is needed: a project from a lesson on the production
  URL gets its parts after `make deploy-web`, and until then `make e2e-prod` fails on these lessons.
- **2026-11-22. English README** (decision 170). `README.md` is an English text for the hackathon
  judges: purpose, features, simulator limits, structure, development commands. The previous
  Russian text is `README.ru.md`. The video script is `docs/video-script.md`. The Cognizant
  hackathon's rules on video are taken from the rules page saved during the hackathon search: the
  video is under two minutes, on YouTube, explained by the participant. The script was not run in
  the browser. The GitHub repository description is empty — the author fills it in.
- **2026-11-22. Access key for the hackathon judges** (decision 171). The author chose a key in a
  link instead of a guest sign-in and a shared account. The key `judges` was issued on the
  production server and is in the macOS keychain (service `fpgasim-judges`). The code did not
  change. The `make e2e-prod` tests "static" and "blink3" passed with this key. A paragraph for the
  judges is in the README, the text of the instruction for the submission form is
  `docs/submission.md`. After the evaluation ends, disable the key.
- **2026-11-22. Testbench time uses the interface language's decimal separator.** The status line
  read "in 0,3 s" in the English interface; `statusText` in `web/src/app/TestbenchPanel.tsx` now
  calls `formatSeconds` from `format.ts`. New unit test `web/src/app/numbers.test.ts`: no component
  in `web/src/app/` formats numbers with `toFixed` or a hand-made comma. English help screenshots
  re-taken (`testbench-*-en.png`; `projects-*-en.png` and `workspace-*-en.png` differ only
  in the date). Checked in the browser: "in 0.3 s" in English, "за 0,7 с" in Russian. Needs
  `make deploy-web`.
- **2026-11-22. Documents in English** (decision 172). All of `docs/` is translated. The structure
  of every file (headings, tables, code blocks, decision numbers, dates) was checked against the
  Russian original by a script; the spec `docs/tz-v1.md` also got an independent review of the
  translation. Personal details (a family account name, names of other services on the shared VPS)
  were removed before the translation. The Russian originals are in Git history before this merge.
- **2026-11-22. Host names out of the code** (decision 173). Site settings file
  `~/.config/fpgasim/site.env` (example `deploy/site.env.example`), CORS from `FPGASIM_CORS_ORIGINS`,
  `_headers` with a build-time mark, nginx vhost as an example, relative schema `$id`. README section
  "Self-hosting". The author's own settings file was created on the author's Mac. Needs
  `make deploy-server` (CORS now comes from the deployment) and `make deploy-web`.
- **2026-11-22. Prepared for open source** (decision 174). MIT license, `CLAUDE.md` and `AGENTS.md` in
  English, a separate review of all code comments for relevance (51 files: stage history removed, four
  comments that contradicted the code fixed). Server `20261122-1828-840a063` and static files
  `20261122-1828-840a063` deployed; CORS comes from the site settings; `make e2e-prod` 38 of 38; a manual
  run of the R2 copy matched.

## Deployments

Now (2026-11-22): build server `20261122-1407-1b51331` (English interface language, decision 168),
static files `20261122-1519-cf5fab8` (`fpgasim.json` for lessons 02, 03, 06, 07, decision 169).
`make e2e-prod` against this pair: 38 of 38 on the first run. The previous static files
`20261122-1407-1b51331` with the same server also gave 38 of 38. On the production URL a browser
with `en-US` gets English, `lv-LV` gets Russian, `?lang=en` gets English. When the server
`20261121-1007-baa31e0` was deployed, a `/v1/check` request with the project
`server/tests/projects/cst_io_type` returned `CST_IO_TYPE` for `led[0]`, line 6.

The database backup in R2 (decision 160): the cron line of the user `taras` was added on 2026-11-20,
the first run by hand — object `fpgasim/accounts-20261120.db`, 53,248 B, matches. Restore from R2
was checked: `rclone copyto` into a temporary folder gave an intact SQLite file. The first run from
cron went through on 2026-11-21 at 03:50 UTC: object `fpgasim/accounts-20261121.db`, 122,880 B,
matches, the log says "failures: 0".

Accounts on the production server: `taras` (administrator), `e2e` (acceptance tests) and user
accounts. The passwords of `taras` and `e2e` are in the macOS keychain, services
`fpgasim-admin-taras` and `fpgasim-e2e-prod-user`. The key of the acceptance tests is the service
`fpgasim-e2e-prod` (the name on the server is `e2e-prod3`). The hackathon judges' key is the service
`fpgasim-judges` (the name on the server is `judges`, decision 171). The procedure is in
`docs/deploy-web.md`.

The list of server deployments is `/var/lib/fpgasim/deploy/releases` on the VPS; of static files,
the Cloudflare panel. What was found on earlier deployments:

- A server deployment without the tools-image cache on the VPS takes about 13 minutes (2026-11-20,
  the cause of the cache loss is not established).
- The first `make e2e-prod` run right after the deployment of 2026-11-20 gave 33 of 35, the repeat
  35 of 35. The cause is not established: the error log was not saved.

## Open: for the author

Checks that an agent cannot do. None of them blocks work.

- Go through the remaining lessons 2–10 in the application (on 2026-11-19 the author went through
  some lessons, including `lesson07_ped` and `lesson10_rainbow`).
- Check operation on a student's laptop: the speed of `lesson07_ped` and `lesson10_uart` at
  multiplier 1 in the default mode and after the "Show internal signals and rebuild" button.
- Accounts (2026-11-20): the password of the account `taras` is in the macOS keychain
  (`security find-generic-password -s fpgasim-admin-taras -w`); change it in the account menu.
  Remaining: sign in as a user account from another device; open one project on two devices and edit
  in turn; cause a conflict by editing one file without a network.
- Compare the drawing with the real board: LED color, sizes, positions of parts (assumption 10 of
  spec section 15.1, decision 53). It is fixed in `boards/tang-nano-20k.json`.
- The 9K board: open the example `buttons_9k` on the production URL; on a real board check the
  clock, buttons, LEDs and the positions of parts on the drawing (the data came from the course site
  and the Sipeed schematic, not checked on a board). It is fixed in `boards/tang-nano-9k.json`.
- Check `uart_hello` and `ws2812_rainbow` on a real board: a line in the PC terminal at 115,200
  baud, the strip on pin 76.
- Proofread the explanations of messages: the `explain` field in `spec/diagnostics.json` (68 shown
  codes as of 2026-11-22, including six `TB_*`, `DEVICE_NOT_MODELED` and `CST_IO_TYPE`).
- Check that with a lesson folder open, the build output for the board (`top.json`, `top.fs`) does
  not get into the project, and that an edit of `top.v` in an outside editor triggers a rebuild. The
  author checked writing from the browser into the folder on 2026-11-19.
- Proofread the help items corrected for the new element names (`help.start.2`, `help.start.4`,
  `help.build.3`, `help.build.4`, `help.run.1`, `help.board.3`, `help.limits.2`). On 2026-11-20 the
  author read the help quickly and named no remarks.

## Open: deferred

A summary list. Version 1 items beyond spec section 15.2; some are repeated in section 7 of
`docs/v1-report.md`.

English language (decision 168):

- The text of server and core errors is in Russian. The interface shows its own text by code; the
  Russian text is visible for codes without a string in the dictionary (mostly `BAD_REQUEST` of the
  users form) and in the part settings checks of the core (`core/src/runtime/registry.cpp`; changing
  the core requires changing `core/VERSION`). The Icarus summary "Ещё N предупреждений не
  показано" ("N more warnings not shown") arrives as text.
- The code and comments of examples and lessons are in Russian (the author's choice: only the
  interface).
- `clocks[].label` and `shared[].users[]` in board files are strings: on first display, convert
  them to text per language.
- The explanation of `BOARD_UNKNOWN` in `spec/diagnostics.json` says "this version has one board" —
  there are already two boards (in both languages).

Test rig:

- The service image `fpgasim-api:dev` is one per machine. A session on another branch that ran
  `make image-api` replaces it in the middle of someone else's `make check`: on 2026-11-22 the
  end-to-end test of the English interface failed against the server from `main`. The workaround is
  its own tag and the variable `FPGASIM_API_IMAGE` for `e2e/run.sh`. The fix is a tag per branch or
  directory in the `Makefile`.

The 9K board:

- There are no lessons for 9K: `~/fpga` holds only lessons for 20K.
- The source does not name the purpose of pins 31, 32, 63, 79–85; the pins of flash memory, PSRAM
  and JTAG are not in the board file.

Interface:

- Design work (the author's decision): a part dialog on a click in the drawing; the size of WS2812
  in the drawing and of the strip on the breadboard (a 9 mm cell).
- Moving parts between cells with the mouse: motion is taken by dragging a wire (decision 67). The
  cell is changed in `fpgasim.json`.
- For a part with several pins (UART on the breadboard), dragging a wire does not work: the pins are
  chosen in the dialog.
- The notice `DEVICE_NOT_MODELED` in the binding dialog: for now it is visible only on the
  "Messages" tab after a build (decision 110).
- `devices` on the drawing itself: in the board file they have no coordinates, and the format needs
  a change (decision 53).
- Entering hexadecimal codes in the terminal line; keeping the terminal log between runs (decision
  80).
- The number base of a waveform row and the expansion of tree groups are not remembered between
  sessions.
- Above 100,000 changes, a waveform is shown only after a pause or stop (decision 85).
- The testbench VCD file's signals beyond the first 100; a `$dumpoff` block reads as zeros, and the
  states X and Z are not shown (decision 84).
- An evaluation of embedding Surfer (an optional task of stage 8).
- A third visibility mode "ports and selected signals" (the author's idea, `docs/v1-report.md`,
  section 7).

Server and core:

- `fpgasim-admin db restore` is not checked on the VPS; the server tests check it on a local
  database.
- `$finish` in a design without a clock is not noticed (decision 29).
- The 2 MB limit is not checked when polling a folder; an IndexedDB failure during the walk is shown
  as an unavailable folder (decision 100).

Tests that do not exist:

- The lessons' testbenches and the core's test set do not run the lessons (decision 103).

## Working notes

- The VPS has no `make` and no passwordless sudo: the author runs the root steps in his own
  terminal (`ssh -t fpga-build …`). `/etc/fpgasim` belongs to root.
- The directory `bench/out/` (the rig's built cores) is not stored in Git. To open `bench.html`,
  first run `make bench-mac`.
- Widgets read a part's state from `Simulation.live.parts` (bytes from the frame) and nets from
  `live.byPin`; drawing runs in `requestAnimationFrame` (`web/src/app/useFrame.ts`), not through
  React.
- Run Prettier for files outside `web/` from the root with `--config web/.prettierrc.json`: without
  it, it takes a line width of 80.
- An end-to-end test gets the key and addresses from `e2e/run.sh`; `npx playwright test` directly
  does not work.
- The development rig (`tools/dev/server.sh`) creates the accounts `admin` and `user`; the passwords
  are next to the key: `.fpgasim/<mode>/admin.password` and `user.password`.
- The build limit per key is 30 per minute. An end-to-end test that builds a project twice hits it:
  the `all` mode in tests is chosen before the first build.
- `make e2e-prod` takes the key and the account from the environment: the whole command is in
  `docs/deploy-web.md`.
- Run `make e2e-prod` under `caffeinate -i -s`: Mac sleep and a change of network address give
  `net::ERR_NETWORK_CHANGED` in Chromium. Do not add retries in `e2e/playwright.prod.config.ts`:
  they mask a failure.
- Measure speed in ordinary Chrome by clicks and a screenshot. A long script on the page through an
  extension slows the tab itself (a measurement gave 0.25× instead of 1.00×).
