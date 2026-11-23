# Design: the assistant in FPGA SIM

Date: 2026-11-22. Status: draft for the author's approval. Builder check done 2026-11-22.
Evidence: the throwaway spike in branch `spike/assistant` (`tools/spike/REPORT.md` there).

## 1. Intent

A person learning Verilog gets stuck on questions like "why is the LED on when it should be off" (0 and 1
mixed up) or "how do I connect the button so it works". Today they have only the build messages and
their own guesses. The assistant answers such questions from the real state of their project: the code,
the build messages, the board description and the live pin levels, and a recorded waveform when needed.

Who: the author now; later, possibly, students of lessons the author may teach. The author pays for the
model calls with the author's own Anthropic key on the server, so a student needs no key of their own.

What success looks like: the four spike cases (inverted LED, button without pull, wrong blink period read
from the waveform, missing `;`) are answered correctly in the production interface, at a cost the author
can see and cap.

## 2. Goals, non-goals, anti-goals

Goals:
- An "Assistant" tab in the bottom panel: a question box, the conversation, a "New conversation" button.
- The model decides what to read. It calls tools that run in the browser on the live project state.
- The server holds the key, the instructions and the tool definitions, calls the model, counts tokens
  and enforces limits.
- The model and the effort level are server settings, changeable without a new release.

Non-goals (this version):
- The assistant does not change files, build, run, press buttons or record. It only advises and says
  which lines to change and which buttons to press.
- No user-supplied keys (BYOK) and no other providers than Anthropic.
- No agentic-web runtime, manifest or `.network.json` (the hackathon is undecided; see section 9).
- Conversations are not stored on the server or synced between devices.

Anti-goals (failure even if it works):
- The Anthropic key reaches the browser, the repository or the log.
- One user, a script or a leaked access key can spend the author's money without a cap.
- The assistant states board facts it did not read from the board description (pin roles, active levels).
- Project contents or questions go to the server log.

## 3. Constraints

- Project rules in `CLAUDE.md`: interface strings only through `ru.json`/`en.json`; theme colors only;
  `Choice` for selection lists; Verilog is never parsed in the interface; a new visible behavior gets a
  method in `window.__fpgasim`; every decision outside the spec goes to `docs/decisions.md`.
- A new server operation changes the server API: it is described in `docs/tz-v1.md` section 8 (8.3
  operations, 8.5 limits, 8.7 log) and the interface tab in section 9.3. `spec/` has no server API schemas
  (only the core protocol), so no schema changes.
- The interface already may talk to the build server (CSP `connect-src` has it). The browser never talks
  to Anthropic directly, so the CSP does not change.
- The server image gets the `anthropic` Python package (a new dependency in `server/pyproject.toml`).
- The VPS rules: only `/etc/fpgasim`, `/var/lib/fpgasim`, `/opt/fpgasim` and the project's Compose project.
- Model facts: Claude Sonnet 5.5 (`claude-sonnet-5-5`), $2 / $10 per million input/output tokens; its
  default effort is `high`, so `medium` must be set explicitly. Forced `tool_choice` is not supported on it
  (use `auto`). Thinking blocks must be passed back unchanged in later requests of the same conversation.

## 4. Approaches considered

1. **The agentic-web runtime from the hackathon** (foreign JavaScript with its own chat UI, BYOK in the
   browser). Fits the hackathon; looks foreign in the interface; the spec is still changing.
2. **Own panel, user's key in the browser** (BYOK). No cost for the author; every student needs a key.
3. **Own panel, the author's key on the server.** A student opens the tab and asks; the author pays and
   sets limits; needs server work and a server deployment.

The author chose 3 (2026-11-22): own panel, because the assistant is wanted regardless of the hackathon,
and the server key, because students should not need a key of their own.

## 5. Decided by the author

- Approach 3 above.
- Model `claude-sonnet-5-5`, effort `medium` by default (spike: about 1–2 cents per first question on a
  15-line project, all four cases correct, 5–10 s per answer).
- Start with the Anthropic key; watch the token use before changing the model.
- The assistant sees the code, the messages and the board state, and can ask for the waveform.
- The same limits for everyone: accounts (the administrator included) and access keys. Keys may use the
  assistant; each key and each account has its own count.
- The author sees the spend with a `fpgasim-admin` command (6.6).

## 6. The design

### 6.1. Flow

The browser runs the tool loop; the server is a stateless relay with the key and the limits.

1. The user asks. The browser sends `POST /v1/assistant` with the whole conversation so far
   (`messages` in the Anthropic format, thinking blocks included unchanged) and the interface language.
2. The server checks auth and limits, adds the system prompt, the tool definitions, the model and the
   effort, and makes one Messages API call.
3. The server returns `content`, `stop_reason` and a usage summary; it records the tokens.
4. If `stop_reason` is `tool_use`, the browser runs the requested tools on the live state, appends the
   assistant turn and the `tool_result` blocks, and posts again. At most 10 calls per question; then the
   panel says the assistant stopped and shows what it has.

Why the loop is in the browser: the simulation state, the pins and the waveform exist only there.

### 6.2. Tools (run in the browser)

As in the spike, with the same names and inputs:

| Tool | Returns |
|---|---|
| `list_files` | paths and sizes, the top file, the testbench files |
| `read_file(path)` | one file's text |
| `get_messages` | build status, visible diagnostics (code, level, file, line, text, explanation), simulator notices |
| `get_board` | board id, enabled parts with pins and settings (`activeLevel`), the binding (port, direction, pin, pull), live level of each bound pin, simulation run state and time |
| `get_waveform(signals?, max_changes?)` (the live core recording only, not a testbench waveform) | without `signals`: whether a recording exists, its range, recorded and recordable signal names; with `signals`: up to `max_changes` (default 50) changes per signal |

A tool result over 60,000 characters is cut, with a note saying so. A tool error goes back as a
`tool_result` with `is_error: true`.

### 6.3. Server operation `POST /v1/assistant`

- Auth: a session or a key, like `/v1/build`.
- Request: `{ "messages": [...], "language": "ru" | "en" }`. At most 1 MB and 60 messages; otherwise 413
  with a text that asks to start a new conversation.
- The server checks that `messages` alternate roles, start with a user turn and contain only block types
  the browser may send (`text`, `tool_result`, and the assistant blocks it got back). Not more: the history
  is the user's own conversation and only affects their own answers.
- The call: model and effort from settings, adaptive thinking, `max_tokens` 16,000, the system prompt and
  tools fixed in the server code, automatic prompt caching, refusal fallback with
  `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
- Response: `{ "content": [...], "stop_reason": "...", "usage": { "input": n, "output": n, "cacheRead": n,
  "cacheWrite": n } }`.
- Errors: 503 `ASSISTANT_OFF` when there is no key or the setting is off; 429 `RATE_LIMITED` for the
  per-minute limit; 429 `ASSISTANT_LIMIT` when a daily token limit is reached (text says when it resets);
  502 `ASSISTANT_FAILED` when the API fails (no API error text to the user beyond a short reason).
- The system prompt: the spike's prompt, plus "answer in the user's language" fed from `language`.

### 6.4. Limits and accounting

New values in `Limits` (`server/fpgasim_server/config.py`), set in `/etc/fpgasim/config.toml`, returned in
`/v1/info`:

| What | Default |
|---|---|
| Assistant requests from one key or account | 20 per minute |
| Tokens from one key or account per day (input + output, cache reads counted at full weight) | 400,000 |
| Tokens of the whole server per day | 4,000,000 |

At the spike's rate (about 7,000 tokens and 1.5 cents per question) the per-user value is about 50
questions a day, and the server value caps spend near $10 a day.

All four token kinds (input, output, cache read, cache write) count toward the daily limits at full
weight *(builder's call: simple and errs on the side of the author's money)*.

The daily counts live in the accounts database (a new table: day, owner kind and name, input, output,
cache read, cache write tokens), so they survive a restart. The day is the UTC day. The check happens
before the call against the count so far; one call may overshoot by its own size.

### 6.5. Settings and the key

- `config.toml`, section `[assistant]`: `enabled` (default `false`), `model` (default `claude-sonnet-5-5`),
  `effort` (default `medium`).
- The key: the file `/etc/fpgasim/anthropic.key`, mode 600, owner the service user; its path can be
  overridden in `config.toml`. No key file means `ASSISTANT_OFF`. The key is never logged or returned.
- `/v1/info` gets `assistant: { "enabled": bool, "model": "..." }`; the interface hides the tab when
  `enabled` is false.

### 6.6. Log and the spend report

`fpgasim-admin assistant usage [--days N]` (default 7) prints, from the accounting table, one row per UTC day
and owner (kind and name) with the four token counts and an approximate cost, and a total per day. The
prices per model are a table in the server code next to the settings; a model without a price prints
tokens only. The command is described with the other `fpgasim-admin` commands (accounts spec section 3.8).

The log:

One line per `/v1/assistant` request with the usual fields and `op: "assistant"`, `model`, the four
token counts, `stopReason`, duration and outcome. No messages, questions, answers or tool results.

### 6.7. Interface

- The "Assistant" tab after "Testbench" in the bottom panel, shown when `/v1/info` says enabled.
- Above the box, one line: "Questions and the project files go to Anthropic to get the answer."
- Answers render Markdown (headings, lists, inline code, code blocks) with theme colors.
- While waiting, a line with the step ("Reading top.v…", from the tool names); a "Stop" button ends
  the loop after the current call.
- Under each answer: tokens of that question, in small muted text. No money figures in the interface.
- The conversation belongs to the open project and lives in memory only. "New conversation", closing the
  project, a change of the project id and a page reload clear it. A new build does not. *(Builder's call,
  2026-11-22: old tool results describe one project; carrying them into another mixes the two.)*
- "Stop" and the 10-call cap close any pending `tool_use` with an error `tool_result` ("stopped by the
  user" / "call limit reached"), so the history stays valid for the next question.
- Errors show in the panel with the server's text.
- `window.__fpgasim.assistant()` returns the turns (question, answer, tools used, token counts, error) for
  end-to-end tests.

### 6.8. Tests

- Server: pytest with a fake Anthropic client: auth, request validation, limits (per minute, per user per
  day, server per day, day change), accounting rows, `ASSISTANT_OFF`, log line without content.
- Interface: unit tests of the tool functions against a fixture state.
- End-to-end on the bench: the server runs with a fake model (a setting that returns scripted replies,
  including a `tool_use` turn), so `make check` makes no paid calls. One scenario per tool.
- A manual check script with the real model (like the spike's `measure.spec.ts`), run by hand, not in
  `make check`.

### 6.9. Deployment

`make deploy-server` (new dependency, new operation) and `make deploy-web`. Before enabling: put the key
file on the VPS, set `enabled = true`. Then `make e2e-prod`, and one real question in the browser.

## 7. Left to the builder

- Markdown rendering: extend `web/src/app/Rich.tsx` or add a small renderer; no new heavy dependency.
- The exact wording of the system prompt, kept close to the spike's.
- The table and column names, and where the accounting code lives.
- How the fake model is switched on for tests (a setting not exposed in production).
- Layout details of the panel within the project's look.

## 8. Open risks

- Long conversations grow the input on every call; the 60-message cap and the daily limit bound it.
  Compaction is out of scope.
- The spike ran one sample per case; quality on larger projects is unmeasured.
- Sonnet 5.5's safety classifiers may refuse some requests; the fallback covers most, the panel shows the
  rest as an error.

## 9. Relation to the hackathon

Not part of this work. If the author enters, the browser tools of 6.2 can be reused as site actions of an
agentic-web network; the panel and the server relay would stay as they are.
