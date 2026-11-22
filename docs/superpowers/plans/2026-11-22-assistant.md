# Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An "Assistant" tab that answers questions about the open project with Claude, through a new
server operation that holds the author's Anthropic key and enforces token limits.

**Architecture:** The browser runs the tool loop (tools read the live project state); the server operation
`POST /v1/assistant` is a stateless relay: it adds the key, system prompt, tool definitions, model and
effort, makes one Messages API call, counts tokens in its own SQLite file and enforces limits. A scripted
fake model (setting `model = "fake"`) serves tests without paid calls.

**Tech Stack:** Python 3.12, FastAPI, `anthropic` SDK, SQLite; TypeScript, React, zustand, Vitest,
Playwright.

**Spec:** `docs/superpowers/specs/2026-11-22-assistant-design.md` (read it first). Spike for reference:
branch `spike/assistant` (`tools/spike/assistant_proxy.py`, `web/src/assistant/assistant.ts`).

## Global Constraints

- Defaults: model `claude-sonnet-5-5`, effort `medium`, adaptive thinking, `max_tokens` 16000, automatic
  prompt caching, `fallbacks: "default"` with beta `server-side-fallback-2026-07-01`; `enabled = false`.
- Limits: 20 assistant requests per minute per key/account; 400,000 tokens per key/account per UTC day;
  4,000,000 tokens per server per UTC day; all four token kinds count at full weight; same for everyone.
- Request: at most 1 MB body and 60 messages; at most 10 model calls per question (browser side).
- Tool result text cut at 60,000 characters with a note.
- Key file default `/etc/fpgasim/anthropic.key`; never logged, never returned.
- Errors: 503 `ASSISTANT_OFF`, 429 `RATE_LIMITED`, 429 `ASSISTANT_LIMIT`, 502 `ASSISTANT_FAILED`, 413
  `ASSISTANT_TOO_LONG`. Server error texts are Russian, like all server texts.
- Interface strings only in `web/src/i18n/ru.json` and `en.json`; theme colors only; code, comments and
  docs in English (decision 172); test names in Russian.
- Shared API image: run checks with `API_IMAGE=fpgasim-api:assistant FPGASIM_API_IMAGE=fpgasim-api:assistant`
  and remove that tag at the end.

**Deviation from the design (record as a decision):** the daily counts go to a separate SQLite file
`<data_dir>/assistant/usage.db`, not into the accounts database. Reason: the accounts database has a
strict schema version check and backup restore; a new table would need a schema migration and would make
old backups unrestorable, for data that is only a spend counter.

## Review Focus

1. A history whose last assistant turn has `tool_use` without matching `tool_result` (Stop pressed, cap hit,
   page error): the next question must still work — Task 6 closes pending calls; Task 2 rejects a user
   turn that is not text/tool_result.
2. Day change at UTC midnight: counts reset for the new day, yesterday's rows stay for the report — Task 1
   test `test_счётчик_нового_дня`.
3. Key file missing or empty while `enabled = true`: 503 `ASSISTANT_OFF`, `/v1/info` says disabled — Task 3.
4. Upstream API failure or timeout: 502 with a short Russian text, nothing counted, no traceback to the
   client — Task 3 with a fake model that raises.
5. Closing the project or switching project id mid-answer: the late reply must not land in the new
   project's conversation — Task 6 test with a conversation generation counter.

---

### Task 1: Settings and usage store (server)

**Files:**
- Modify: `server/fpgasim_server/config.py` (new `AssistantSettings`, `Limits` fields, `Settings.assistant`,
  `load_settings` reads `[assistant]`)
- Create: `server/fpgasim_server/usage.py`
- Test: `server/tests/test_assistant.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class AssistantSettings: enabled: bool = False; model: str = "claude-sonnet-5-5";
    effort: str = "medium"; key_file: Path = Path("/etc/fpgasim/anthropic.key")`
  - `Limits.assistant_requests_per_minute: int = 20`, `Limits.assistant_tokens_per_day: int = 400_000`,
    `Limits.assistant_tokens_per_day_total: int = 4_000_000`
  - `Settings.assistant: AssistantSettings`; `load_settings` rejects unknown keys in `[assistant]` with
    `ValueError` like `[limits]`.
  - `class Usage(NamedTuple): input: int; output: int; cache_read: int; cache_write: int` with
    `total -> int` (sum of all four).
  - `class UsageStore: __init__(path: Path, clock: Callable[[], int])` (ms clock);
    `add(owner: str, model: str, usage: Usage) -> None`; `tokens_today(owner: str) -> int`;
    `tokens_today_total() -> int`; `report(days: int) -> list[dict]` with keys `day`, `owner`, `model`,
    `input`, `output`, `cacheRead`, `cacheWrite`. `owner` is `Principal.limit_id` (`session:login` /
    `key:name`). Day = UTC date `YYYY-MM-DD` from the clock. Table keyed by (day, owner, model), upsert-add.
    File mode 600, folder 700.

- [ ] **Step 1: Write failing tests** in `server/tests/test_assistant.py`:
  `test_настройки_помощника_по_умолчанию` (defaults above; `load_settings` with a config containing
  `[assistant] enabled = true, model = "fake"` gives those values; an unknown key raises `ValueError`),
  `test_учёт_токенов` (two `add` calls for one owner sum in `tokens_today`; another owner adds to
  `tokens_today_total` only), `test_счётчик_нового_дня` (clock moved past UTC midnight: `tokens_today` is 0,
  `report(2)` has both days).
- [ ] **Step 2:** Run `make test-server` with the branch image tag (Global Constraints); expect the new tests to fail.
- [ ] **Step 3:** Implement the settings and `usage.py`.
- [ ] **Step 4:** Run the tests; expect PASS.
- [ ] **Step 5:** Commit `server: assistant settings and token accounting`.

### Task 2: Model call and request checks (server)

**Files:**
- Create: `server/fpgasim_server/assistant.py`
- Modify: `server/pyproject.toml`, `server/uv.lock` (add `anthropic`)
- Test: `server/tests/test_assistant.py`

**Interfaces:**
- Consumes: `AssistantSettings`, `Usage` (Task 1).
- Produces:
  - `SYSTEM_PROMPT: str` (spike prompt plus "Answer in {language}." filled from the request),
    `TOOLS: list[dict]` — the five tools of spec 6.2 with the spike's schemas.
  - `class Reply(NamedTuple): content: list[dict]; stop_reason: str; usage: Usage; model: str`
  - `class Model(Protocol): def call(self, messages: list[dict], language: str) -> Reply` (sync; the
    endpoint runs it with `asyncio.to_thread`).
  - `class AnthropicModel(Model): __init__(settings: AssistantSettings, key: str)` — `client.beta.messages.create`
    with the Global Constraints parameters, `tool_choice` not set, `timeout=120`, `max_retries=2`;
    `content` is `model_dump(mode="json", exclude_none=True)` blocks, passed through unchanged.
  - `class FakeModel(Model)`: if the last user turn is text → reply `stop_reason="tool_use"` with two
    `tool_use` blocks `list_files` and `get_board` (ids `fake_1`, `fake_2`, input `{}`); if it is
    `tool_result` blocks → reply text `"Тестовый ответ. Инструменты: list_files, get_board."` with
    `stop_reason="end_turn"`; a question containing `#сбой` raises `ModelFailed`. Usage
    `Usage(100, 20, 0, 0)` per call.
  - `class ModelFailed(Exception)`; `AnthropicModel` maps `anthropic.APIError` subclasses to it with a short
    reason (status code or "нет связи"), never the API message body.
  - `def make_model(settings: AssistantSettings) -> Model | None` — `"fake"` → `FakeModel()`; otherwise the
    key file's stripped text, or `None` when the file is missing/empty or `enabled` is false.
  - `def check_messages(messages: Any) -> list[dict]` raising `ValueError` (Russian text): list of 1..60
    dicts; roles alternate starting and ending with `user`; user content is a non-empty string or a list of
    blocks of type `text` or `tool_result`; assistant content is a list (passed through).

- [ ] **Step 1: Failing tests:** `test_проверка_разговора` (valid two-turn tool exchange accepted; a
  history ending with `assistant`, 61 messages, a user `image` block, and two user turns in a row each raise
  `ValueError`), `test_тестовая_модель` (FakeModel tool_use then text, exact text above),
  `test_нет_ключа_нет_модели` (enabled with missing key file → `make_model` returns `None`; `enabled=false`
  → `None`; `model="fake"` with `enabled=true` → `FakeModel`).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Add `anthropic` to dependencies (`uv add anthropic` in `server/`), rebuild the branch API
  image (`make image-api API_IMAGE=fpgasim-api:assistant`), implement `assistant.py`.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `server: assistant model call and history checks`.

### Task 3: Operation `POST /v1/assistant`, limits, log, info (server)

**Files:**
- Modify: `server/fpgasim_server/api.py`
- Test: `server/tests/test_assistant.py`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `POST /v1/assistant` with body `{"messages": [...], "language": "ru"|"en"}` → `{"content",
  "stop_reason", "usage": {"input","output","cacheRead","cacheWrite"}}`; `/v1/info` gains
  `"assistant": {"enabled": bool, "model": str}`; `Service.model: Model | None` (built in `__init__`,
  replaceable in tests); `Service.usage: UsageStore` at `settings.data_dir / "assistant" / "usage.db"`.
- Order in the handler: auth (session or key, like build) → `rate_limit(limit_id, "assistant")` (new key in
  the limit map: `assistant_requests_per_minute`) → body read with a 1 MB cap → `check_messages` (413
  `ASSISTANT_TOO_LONG` for count, 400 `BAD_REQUEST` otherwise) → model `None` → 503 `ASSISTANT_OFF` → daily
  limits (owner, then total) → 429 `ASSISTANT_LIMIT` "Дневной лимит помощника исчерпан, он обновится в 00:00 UTC"
  → call in a thread → `ModelFailed` → 502 `ASSISTANT_FAILED` → `usage.add` → response.
- Log record fields: `op: "assistant"`, `model`, `tokensIn`, `tokensOut`, `cacheRead`, `cacheWrite`,
  `stopReason`; `result` `"ok"`; never messages.

- [ ] **Step 1: Failing tests** (an `Env` whose service has `model = FakeModel()` and a fresh `UsageStore`):
  `test_помощник_отвечает_через_инструменты` (two posts: tool_use then the text; usage counted 240 tokens),
  `test_помощник_выключен` (model `None` → 503 `ASSISTANT_OFF`; `/v1/info` `assistant.enabled` false),
  `test_дневной_лимит_пользователя` (limit 100 tokens: first call ok, second 429 `ASSISTANT_LIMIT`; another
  key still ok), `test_общий_дневной_лимит`, `test_лимит_в_минуту` (limit 1 → second 429 `RATE_LIMITED`),
  `test_сбой_модели` (`#сбой` → 502, nothing counted), `test_длинный_разговор` (61 messages → 413),
  `test_журнал_без_текста` (log line has token fields and no question text anywhere in `json.dumps(record)`),
  `test_вход_по_сессии` (a session token works too).
- [ ] **Step 2:** Run; expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run; expect PASS.
- [ ] **Step 5:** Commit `server: assistant operation with limits`.

### Task 4: `fpgasim-admin assistant usage` (server)

**Files:**
- Modify: `server/fpgasim_server/admin.py`, `server/fpgasim_server/usage.py` (`PRICES`)
- Test: `server/tests/test_assistant.py`

**Interfaces:**
- Consumes: `UsageStore.report` (Task 1), `load_settings` for the data folder.
- Produces: `fpgasim-admin assistant usage [--days N]` (default 7). Output: one tab-separated line per
  (day, owner, model): `day owner model input output cacheRead cacheWrite cost`, then `day итого … cost`.
  `PRICES: dict[str, tuple[float, float, float, float]]` USD per million (input, output, cache read, cache
  write): `claude-sonnet-5-5: (2.0, 10.0, 0.10, 2.5)`, `claude-opus-5-5: (4.0, 20.0, 0.20, 5.0)`,
  `claude-haiku-5-5: (0.10, 0.50, 0.01, 0.125)`; unknown model → cost `—`. Cost printed `$0.0000`.

- [ ] **Step 1: Failing test** `test_отчёт_о_расходе` (store with two owners on one day; `main(["assistant",
  "usage", "--days", "1"])` with `FPGASIM_DATA_DIR` set prints both owners and a total line; the sonnet cost
  for `Usage(1_000_000, 0, 0, 0)` is `$2.0000`).
- [ ] **Step 2:** Run; expect FAIL. **Step 3:** Implement. **Step 4:** Run; PASS.
- [ ] **Step 5:** Commit `server: spend report in fpgasim-admin`.

### Task 5: Client, info state and browser tools (web)

**Files:**
- Modify: `web/src/build/types.ts` (`InfoResponse.assistant?`, `AssistantReply`),
  `web/src/build/client.ts` (`assistant()`), `web/src/app/state.ts` (`assistant: {enabled: boolean;
  model: string} | null` set in `checkCredential` of `web/src/app/actions.ts`; `BottomTab` gains
  `"assistant"`), `web/src/app/actions.ts` (export `serverClient(): BuildClient | null`)
- Create: `web/src/assistant/tools.ts`
- Test: `web/src/assistant/tools.test.ts`

**Interfaces:**
- Produces:
  - `BuildClient.assistant(messages: AssistantMessage[], language: string): Promise<AssistantReply>` (POST,
    timeout 150 s); `type AssistantBlock = { type: string; [key: string]: unknown }`;
    `type AssistantMessage = { role: "user" | "assistant"; content: string | AssistantBlock[] }`;
    `interface AssistantReply { content: AssistantBlock[]; stop_reason: string; usage: { input: number;
    output: number; cacheRead: number; cacheWrite: number } }`.
  - `runTool(name: string, input: Record<string, unknown>, source: ToolSource): { text: string; error: boolean }`
    where `ToolSource` is an interface of plain readers (`files()`, `file(path)`, `topFile()`,
    `testbenches()`, `build()`, `messages()`, `notices()`, `board()`, `parts()`, `binding()`, `pins()`,
    `run()`, `wave()`, `waveChanges(name, from, count)`, `signals()`), and `liveSource(): ToolSource` built
    from the same readers the debug API uses (spike `assistant.ts` shows each). Result JSON over 60,000
    characters is cut and ends with `\n[обрезано: N знаков]`. Unknown tool → `error: true`.
- [ ] **Step 1: Failing tests** with a fixture `ToolSource`: each of the five tools returns the fields of spec
  6.2; `get_board` keeps only enabled parts and only bound pins; `get_waveform` without recording returns
  `recorded: false` and `available`; long file is cut with the note; unknown tool is an error.
- [ ] **Step 2:** `cd web && npx vitest run src/assistant`; FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `web: assistant client and browser tools`.

### Task 6: Conversation, panel, Markdown, debug API (web)

**Files:**
- Create: `web/src/assistant/conversation.ts`, `web/src/assistant/AssistantPanel.tsx`,
  `web/src/assistant/Markdown.tsx`
- Modify: `web/src/app/Workspace.tsx` (tab after "Testbench", only when `assistant?.enabled`),
  `web/src/app/actions.ts` (`closeProject` and project id change call `resetConversation()`),
  `web/src/debug/api.ts` + `web/src/debug/fpgasim.ts` (`assistant()`), `web/src/i18n/ru.json`, `en.json`
- Test: `web/src/assistant/conversation.test.ts`

**Interfaces:**
- Consumes: Task 5.
- Produces:
  - `useConversation` (zustand): `{ turns: Turn[]; busy: boolean; step: string | null; history:
    AssistantMessage[]; generation: number }`;
    `interface Turn { question: string; answer: string; tools: string[]; tokens: number; error: string | null;
    stopped: boolean }`.
  - `ask(question: string, deps?: { call: (m, lang) => Promise<AssistantReply>; source: ToolSource }): Promise<void>`
    — loop of at most 10 calls; tool errors as `is_error: true`; `stop()` sets a flag checked between calls;
    on stop, cap, or error any `tool_use` without a result gets an error `tool_result`
    (`"остановлено пользователем"` / `"достигнут предел вызовов"` / the error text) so `history` stays valid;
    a reply arriving after `resetConversation()` (generation changed) is dropped; `stop_reason` `"refusal"`
    ends the turn with `error = t("assistant.refused")`.
  - `stop(): void`, `resetConversation(): void`.
  - `DebugApi.assistant(): { question: string; answer: string; tools: string[]; tokens: number;
    error: string | null }[]`.
  - Strings (`ru`/`en`, same keys): `assistant.title`, `assistant.notice` ("Вопрос и файлы проекта уходят в
    Anthropic, чтобы получить ответ." / "Your question and the project files go to Anthropic to get the
    answer."), `assistant.placeholder`, `assistant.ask`, `assistant.stop`, `assistant.reset`,
    `assistant.empty`, `assistant.step.<tool>` for the five tools ("Читаю файлы проекта…" etc.),
    `assistant.thinking`, `assistant.refused`, `assistant.tokens` ("{count} токенов"), `assistant.stopped`, `assistant.capped`.
  - `Markdown({ text }: { text: string })`: headings `#`–`###`, `-`/`1.` lists, `**bold**`, inline code,
    fenced code blocks; everything else plain text; no HTML injection (build React nodes, never
    `dangerouslySetInnerHTML`); theme classes only.
- [ ] **Step 1: Failing tests** in `conversation.test.ts` with a fake `call`: two-step tool exchange
  produces the answer and `tools`; `stop()` mid-loop leaves a history whose last user turn has a
  `tool_result` for every `tool_use`; 10-call cap sets `capped`; a reply after `resetConversation()` is
  dropped; tool error goes back as `is_error: true`.
- [ ] **Step 2:** FAIL. **Step 3:** Implement the store, then the panel and Markdown (layout like
  `TestbenchPanel`: `Toolbar` with "New conversation"; scrollable turns; notice line; `Textarea` with Enter
  to send, Shift+Enter newline; "Stop" while busy; tokens under each answer in muted small text).
- [ ] **Step 4:** `npx vitest run` and `npx tsc --noEmit -p .` and `npx eslint src`; PASS.
- [ ] **Step 5:** Commit `web: assistant panel`.

### Task 7: End-to-end test on the bench

**Files:**
- Modify: `tools/dev/server.sh` (in `with` mode the generated `config.toml` always gets
  `[assistant]\nenabled = true\nmodel = "fake"`; the CORS line stays as now)
- Create: `e2e/tests/assistant.spec.ts`
- Create: `e2e/manual/assistant-live.spec.ts` + `e2e/manual/playwright.config.ts` (the spike's
  `measure.spec.ts` adapted to the new tab; run by hand against `make dev` with a real key; not in
  `testDir` of the main config)

**Interfaces:** consumes the panel test ids: `tab-assistant`, `assistant-input`, `assistant-ask`,
`assistant-stop`, `assistant-reset`, `assistant-answer`, and `window.__fpgasim.assistant()`.

- [ ] **Step 1:** Write `assistant.spec.ts`: open `blink3` with the key, build, open the tab, ask "Почему
  мигает?"; poll `assistant()` until one turn with `tools` `["list_files","get_board"]` and answer
  `"Тестовый ответ. Инструменты: list_files, get_board."`; the answer is visible in `assistant-answer`;
  the notice line is visible; ask "#сбой" → the turn has an error and the panel shows it; "New conversation"
  empties `assistant()`; going back to the projects screen and opening the project again shows an empty
  conversation.
- [ ] **Step 2:** `make e2e E2E_ARGS="tests/assistant.spec.ts"` with the branch image tag; PASS.
- [ ] **Step 3:** Commit `e2e: assistant tab`.

### Task 8: Documents

**Files:** `docs/tz-v1.md` (8.3 new operation and `/v1/info` field, 8.5 three limits, 8.7 log fields, 9.3
the tab, 9.7 `assistant()`), `docs/tz-accounts.md` (3.8 `assistant usage`), `docs/decisions.md` (decision
175: assistant through the server with the author's key — approach, model and effort as settings, browser
tool loop; decision 176: usage counts in a separate SQLite file, reason above; decision 177: fake model for
tests; each with date 2026-11-22 and a table-of-contents line), `docs/deploy-server.md` (how to put the key
file and enable), `docs/progress.md` ("After acceptance" entry).

- [ ] **Step 1:** Write the sections. **Step 2:** Commit `docs: assistant`.

### Task 9: Full check and live check

- [ ] `make check` with `API_IMAGE=fpgasim-api:assistant FPGASIM_API_IMAGE=fpgasim-api:assistant`; all green.
- [ ] Live: `make dev`-like stand with `config.toml` `[assistant] enabled = true` and a key file copied from the
  keychain (`security find-generic-password -s fpgasim-anthropic -w`) into the stand folder; run
  `e2e/manual/assistant-live.spec.ts` for the four spike cases on Sonnet 5.5 `medium`; look at one screenshot.
- [ ] Remove the key file copy, stop the stand, remove the `fpgasim-api:assistant` tag.
