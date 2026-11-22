# FPGA SIM

A web simulator of Verilog designs for the Sipeed Tang Nano 20K and Tang Nano 9K boards.
The build runs on the server (Verilator → WebAssembly); the simulation runs in the browser.

## Main documents

- `docs/tz-v1.md` — the spec. It is the source of truth.
- `docs/tz-accounts.md` — the accounts spec: accounts and projects on the server.
- `docs/vision.md` — vision and architecture. Its decisions are not reopened.
- `docs/decisions.md` — decisions made along the way. Before a change, find the decisions on your topic
  in its table of contents and read them: the file is large and is not read in full.
- `docs/progress.md` — the progress log. Its first section says where we are now.

## How to work

Version 1 is complete: the stages of spec section 12 are done. Work now follows the author's tasks.

1. Read the first sections of `docs/progress.md`: where we are, next tasks, what is open.
2. Do only the task the author named. Write what you find along the way into the "Open: …" sections
   of the same file, not into the change.
3. A task is done when `make check` passes and the visible behavior is checked in a browser.
4. At the end, add an entry to the "After acceptance" section of `docs/progress.md`: what was done,
   what was postponed and why.
5. Record every decision that is not in the spec in `docs/decisions.md`, with the date and the reason,
   and add a line to its table of contents.
6. A change in `web/`, `examples/`, `boards/`, `parts/` or `spec/` reaches the production URL after
   `make deploy-web`; a change in `core/` or `server/` after `make deploy-server`. A change in `boards/`
   needs both deployments: the interface and the server (it is in the image) both read the board file.
   A change in `core/` needs a new `core/VERSION`: otherwise the server serves the build cache made with
   the old core. After a deployment run `make e2e-prod`. Deployment, merge and push happen only on the
   author's command.

## Do not

- Change the formats (`fpgasim.json`, board file, part description, protocol) without changing the
  schemas in `spec/` and the spec section in `docs/tz-v1.md`.
- Weaken or delete a test to make it pass. If an acceptance criterion cannot be met, stop and describe
  the reason in `docs/progress.md`.
- Parse Verilog in the interface: everything about the design comes from the server and the core.
- Call the engine or another part from a part: only through nets.
- Write interface strings in component code: only through `web/src/i18n/ru.json` and `en.json`
  (keys and placeholders match in both dictionaries, decision 168).
- Keep keys, URLs with keys, the contents of `/etc/fpgasim` or host names of a deployment in the
  repository. Host names are in the site settings (`deploy/site.env.example`, decision 173).
- Touch anything on the VPS except `/opt/fpgasim`, `/etc/fpgasim`, `/var/lib/fpgasim`, the project's own
  Compose project and its own images.
- Ask the author for lesson texts. The lesson code is in `~/fpga/lessonNN_*`; the expected behavior is
  described in the comment at the top of `top.v`.

## Items to verify

Spec section 15 lists assumptions. If the assumption behind your task did not hold, do not work around
it silently: describe the mismatch in `docs/decisions.md`, propose a replacement and continue only if the
replacement does not change the formats or the protocol. Otherwise stop and tell the author.

## Commands

- `make dev` — server on localhost:8080 and interface on localhost:5173
- `make check` — style, types and all tests; run it before finishing
- `make test-core` / `test-server` / `test-web` / `test-examples` / `e2e`
- `make bench` — speed and build time measurement
- `make deploy-server` / `deploy-web` — deployment; addresses and the SSH host are in the site settings
  `~/.config/fpgasim/site.env` (example `deploy/site.env.example`, decision 173)

Do not install Verilator, Emscripten or Icarus on the Mac: they are in the build image (`make image`);
the core and server tests run in the container.

## Style

- C++20, clang-format, no exceptions and no memory allocation in the simulation loop.
- Python 3.12, ruff, type annotations, pytest.
- TypeScript in strict mode, ESLint, Prettier. Core frames do not go into React state.
- Interface look: Tailwind and shadcn components (`web/src/components/ui/`), shared elements in
  `web/src/app/kit.tsx`. Colors only from the theme variables in `web/src/styles.css` (in Canvas,
  `themeColor()`): a color literal breaks the dark theme. A selection list is `Choice`, not `<select>`
  (decision 111).
- Names in code, comments, docstrings, commit and merge messages, and `docs/` are in English (decision
  172). Russian stays in: test names, messages printed by scripts, code and comments of `examples/` and
  the lessons, the `ru.json` dictionary, `README.ru.md`.
- Commit message: "area: what was done", for example "web: …", "server: …", "core: …", "docs: …".

## Checking in a browser

End-to-end tests read the state through `window.__fpgasim`, not by pixels. A new visible element of
behavior gets a method or a field in this object.
