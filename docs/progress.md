# Progress log

The first section says where we are now. Format of a new entry: the date, what was done, what was
postponed and why, which decisions were made (details are in `docs/decisions.md`).

## Where we are now (2026-11-23)

**Version 1 is complete.** All stages of spec section 12 (0–11) are done and merged into `main`; the
summary is `docs/v1-report.md`. New work follows the author's task, and its entry is appended to section
"After acceptance". What runs on the production URLs: section "Deployments".

Latest work: the "Assistant" tab (decisions 175–177) and its fixes after the live check on production
(decisions 178–180), both deployed on 2026-11-23.

## Next tasks

The author has named no tasks. Open items are in the "Open" sections below. The postponed work of
version 2 is spec section 15.2: do not start it without the author's command. The hackathon Open Agentic
Web Challenge: do not start without the author's command.

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

One line per piece of work: what changed and where its reasons are. The full entries (test counts,
live checks, what was checked against a breakage) are in Git history: `git show 5fc1666:docs/progress.md`;
the older detailed stage entries: `git show c1740f0:docs/progress.md` (version 1) and
`git show c593f96:docs/progress.md` (accounts).

- **2026-11-19.** Speed with a numeric multiplier (decision 107, `a2b64ba`); the default visibility mode
  `ports` (decision 108, `450eecb`); the `SLOW` notice softened, core 0.2.1 (decision 109, `c1740f0`).
- **2026-11-20.** `DEVICE_NOT_MODELED` for a port bound to an unmodelled onboard part (decision 110).
  Interface design on Tailwind and shadcn, light and dark themes (decisions 111–115, `e35eac8`). Help
  screenshots per theme and language, taken by `HELP_SHOTS=1 e2e/run.sh tests/help-shots` (decision 116).
- **2026-11-20. Accounts and projects on the server** (`docs/tz-accounts.md`).

  | Stage | What | Merge into `main` | Decisions |
  |---|---|---|---|
  | 1 | Server: accounts and sessions | `4ea7bd9` | 118–126 |
  | 3 | Server: projects, trash, database backups | `76a8702` | 127–129, 140 |
  | 2 | Sign-in interface and the "Users" page | `7071a40` | 130–134 |
  | 4 | Sync in the browser | `3ae196a` | 141, 142 |
  | 5 | Sync indicators, conflict, viewing of work | `b883009` | 150–154 |
  | 6 | Documents, help, acceptance test | `b16756d`, `b54b66b`, `8c14e6f` | 155 |
  | — | The `deploy/fpgasim-admin` wrapper | `0a199d9` | 156 |

  Small fixes after accounts (decision 157, `2bef771`); the author's answers on the unsaved dialog and the
  administrator's request limit (decision 158); the daily database copy to R2 (decisions 159, 160).
- **2026-11-20–21. Tang Nano 9K** (decisions 161–163): `boards/tang-nano-9k.json`, the `standard` pin field,
  the "New project" menu with boards, the example `buttons_9k`, built-in buttons with `idle: "drive"`; the
  9K project in `e2e/prod/prod.spec.ts`.
- **2026-11-21.** The `CST_IO_TYPE` warning (decision 164); the fair job queue `FairSlots` (decision 165);
  the probe color in the dark theme (`--board-probe`); 26 unused dictionary strings removed.
- **2026-11-22.** Dragging files into an open project (decision 166); changing the board in project
  settings (decision 167); tests of dragging onto the projects screen, `TB_DISK_LIMIT`, `$stop` and
  `$fatal`, undo before save. The English interface language (decision 168); `fpgasim.json` for lessons
  02, 03, 06, 07 (decision 169); the English README and the video script `docs/video-script.md`
  (decision 170); the hackathon judges' key `judges` and `docs/submission.md` (decision 171; disable the
  key after the evaluation); documents in English (decision 172); host names in the site settings
  (decision 173); open source under MIT (decision 174).
- **2026-11-22–23. Assistant** (decisions 175–177, `7df404f`): the "Assistant" tab asks Claude Sonnet 5.5
  about the open project; the browser runs the five tools. The real model is checked by hand
  (`e2e/manual/assistant-live.spec.ts`). Not done: storing conversations, a spend screen in the interface.
  Live check on production 2026-11-23: three questions on `lesson07_ped` answered correctly; the defects
  found went into the fixes below.
- **2026-11-23. Assistant fixes** (decisions 178–180, `5fc1666`): the tool step stays on the screen and the
  tools used are listed under each answer; Markdown code inside bold and list numbering; tab names in the
  language of the answer; the tokens of every model of a refusal fallback; 502 for any SDK failure;
  `max_changes` at most 500; a non-UTF-8 key file turns the assistant off; "New conversation" off during an
  answer; the tab raises a low bottom panel; the end-to-end test covers all five tools. The author checked
  the assistant on the production URL on 2026-11-23 after the deployment: it works. Not checked: the shape
  of `usage.iterations` on a real fallback (no refusal happened).
- **2026-11-23.** The local service test image has a tag per repository directory,
  `fpgasim-api:dev-<number>` from `tools/dev/api-image.sh` (decision 181): `make image-api` in one worktree no
  longer replaces the image under a `make check` in another. Nothing to deploy.
- **2026-11-23.** The tab icon: a white chip on the primary blue, `web/public/favicon.svg` (decision 182).
  Reaches the production URL after `make deploy-web`.
- **2026-11-25.** The explanation of `BOARD_UNKNOWN` in `spec/diagnostics.json` names both boards,
  `tang-nano-20k` and `tang-nano-9k`, in both languages. Deployed: static files `20261125-2019-85df444`.
- **2026-11-25.** Server and core refusals and core notices in the interface language (decision 183): the
  core and the server add the optional field `args` (`reason` and values) to a refusal, the interface takes
  its own string by the reason, core notices by the code. The Russian `text` stays for the log and
  `fpgasim-admin`; the output of Verilator and Icarus stays as it is. Core 0.2.2. Reaches the production URL
  after `make deploy-server` and `make deploy-web`.

## Deployments

Now (2026-11-25): build server `20261123-1604-5fc1666` (the assistant fixes, decisions 178–180) and
static files `20261125-2019-85df444` (the tab icon and the `BOARD_UNKNOWN` explanation); after it
`make e2e-prod` gave 38 of 38 with `FPGASIM_USER_LOGIN` and `FPGASIM_USER_PASSWORD` set. The assistant is enabled: `/etc/fpgasim/config.toml` holds only
`[assistant] enabled = true`, the key is `/etc/fpgasim/anthropic.key`; `/v1/info` answers
`{"enabled": true, "model": "claude-sonnet-5-5"}`. Without `FPGASIM_USER_LOGIN` and
`FPGASIM_USER_PASSWORD` in the environment the two `accounts.spec.ts` tests skip; the login is `e2e`, the
password is the keychain service `fpgasim-e2e-prod-user`.
The previous server is `20261123-0703-7df404f` (the assistant, decisions 175–177).

The database copy in R2 (decision 160) runs daily from cron at 03:50 UTC; on 2026-11-23 the log
(`/var/lib/fpgasim/deploy/offsite-r2.log`) says object `fpgasim/accounts-20261123.db`, matches, "сбоев: 0".
Restore from R2 was checked on 2026-11-20 (`docs/deploy-server.md`, section "Copy in R2").

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

- The code and comments of examples and lessons are in Russian (the author's choice: only the
  interface).
- `clocks[].label` and `shared[].users[]` in board files are strings: on first display, convert
  them to text per language.

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
