"""The assistant's model call (decision 175, docs/superpowers/specs/2026-11-22-assistant-design.md).

The browser runs the tool loop: it sends the whole conversation, the server adds the system prompt,
the tool definitions, the model and the effort, and makes one Messages API call. The tools run in the
browser on the live project state; their definitions live here so that the browser cannot change them.
"""

from __future__ import annotations

from typing import Any, NamedTuple, Protocol

from .config import AssistantSettings
from .usage import Usage

MAX_MESSAGES = 60
MAX_TOKENS = 16_000
FALLBACK_BETA = "server-side-fallback-2026-07-01"
LANGUAGES = {"ru": "Russian", "en": "English"}

SYSTEM_PROMPT = """You are the assistant inside FPGA SIM, a browser simulator of Verilog designs for the Sipeed \
Tang Nano 20K and 9K boards. The user is learning digital design. They ask why their design behaves the \
way it does, or how to do something on the board.

How to work:
- Look before you answer. Use the tools to read the project files, the build messages, the board \
description and the live state of the pins. Do not guess what the code says.
- Ground every claim about the board in get_board: which pin is wired to what, and the activeLevel of each \
on-board part. activeLevel 0 means the part is active when the pin is 0 (an LED lights at 0); a button with \
activeLevel 1 drives 1 while pressed. Mention the pull settings from the binding when inputs are involved.
- If you need signal history, call get_waveform. If nothing was recorded, tell the user how to record \
(the Signals tab: "Record" on a signal; then the Waveforms tab: Record, then Stop) instead of inventing values.
- You only advise. You cannot edit files, build, run or press buttons. Show the exact lines to change.
- Be short: the cause first, then the fix, then one sentence on why. Use Markdown with code blocks for \
Verilog and .cst lines.
- Answer in {language}."""

NO_INPUT: dict[str, Any] = {"type": "object", "properties": {}, "additionalProperties": False}

TOOLS: list[dict[str, Any]] = [
    {
        "name": "list_files",
        "description": "List the project files with their sizes, the top module file and the testbenches.",
        "input_schema": NO_INPUT,
    },
    {
        "name": "read_file",
        "description": "Read one project file (Verilog, .cst constraints, fpgasim.json).",
        "input_schema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "Path as returned by list_files."}},
            "required": ["path"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_messages",
        "description": "Build status and the messages of the last build and of the running simulation: "
        "errors and warnings with file and line, and simulator notices such as floating inputs.",
        "input_schema": NO_INPUT,
    },
    {
        "name": "get_board",
        "description": "The board: enabled on-board and breadboard parts with their pins and settings "
        "(activeLevel), the pin binding (port, direction, pin, pull), the live level of every bound pin, and "
        "whether the simulation runs.",
        "input_schema": NO_INPUT,
    },
    {
        "name": "get_waveform",
        "description": "Signal changes of the simulator recording (not of a testbench). Without signals, returns "
        "whether a recording exists, its time range, the recorded signal names and the recordable ones.",
        "input_schema": {
            "type": "object",
            "properties": {
                "signals": {"type": "array", "items": {"type": "string"}},
                "max_changes": {"type": "integer", "description": "Per signal, default 50."},
            },
            "additionalProperties": False,
        },
    },
]


class Reply(NamedTuple):
    content: list[dict[str, Any]]
    stop_reason: str
    usage: Usage
    model: str


class ModelFailed(Exception):  # noqa: N818 — the name states what happened
    """The model call failed; the text is short and safe to show."""


class Model(Protocol):
    name: str  # the configured model, shown in /v1/info

    def call(self, messages: list[dict[str, Any]], language: str) -> Reply: ...


def check_messages(messages: Any) -> list[dict[str, Any]]:  # noqa: ANN401 — request data before the check
    """The conversation from the browser: roles alternate, it starts and ends with the user.

    A user turn is text or tool results; assistant turns are what the server returned and pass unchanged.
    """
    if not isinstance(messages, list) or not messages:
        raise ValueError("Разговор пуст")
    if len(messages) > MAX_MESSAGES:
        raise ValueError("Разговор слишком длинный: начните новый")
    for i, message in enumerate(messages):
        if not isinstance(message, dict) or message.get("role") != ("user" if i % 2 == 0 else "assistant"):
            raise ValueError("Реплики разговора должны чередоваться, начиная с вопроса")
        content = message.get("content")
        if message["role"] == "assistant":
            if not isinstance(content, list):
                raise ValueError("Ответ помощника в разговоре повреждён")
            continue
        if isinstance(content, str):
            if not content.strip():
                raise ValueError("Пустой вопрос")
            continue
        if (
            not isinstance(content, list)
            or not content
            or not all(isinstance(b, dict) and b.get("type") in ("text", "tool_result") for b in content)
        ):
            raise ValueError("Вопрос может содержать только текст и результаты инструментов")
    if messages[-1]["role"] != "user":
        raise ValueError("Разговор должен заканчиваться вопросом")
    return messages


def last_text(messages: list[dict[str, Any]]) -> str | None:
    """The text of the last user turn; None when it holds tool results."""
    content = messages[-1]["content"]
    if isinstance(content, str):
        return content
    texts = [b.get("text", "") for b in content if b.get("type") == "text"]
    return "\n".join(texts) if texts else None


class FakeModel:
    """The scripted model of the tests (decision 177): no key, no network, no cost."""

    name = "fake"

    def call(self, messages: list[dict[str, Any]], language: str) -> Reply:
        question = last_text(messages)
        usage = Usage(100, 20, 0, 0)
        if question is not None and "#сбой" in question:
            raise ModelFailed("тестовый сбой")
        if question is not None:
            content = [
                {"type": "tool_use", "id": "fake_1", "name": "list_files", "input": {}},
                {"type": "tool_use", "id": "fake_2", "name": "get_board", "input": {}},
            ]
            return Reply(content, "tool_use", usage, "fake")
        text = "Тестовый ответ. Инструменты: list_files, get_board."
        return Reply([{"type": "text", "text": text}], "end_turn", usage, "fake")


class AnthropicModel:
    """Claude through the Messages API with the author's key (decision 175)."""

    def __init__(self, settings: AssistantSettings, key: str) -> None:
        import anthropic  # the package loads only when the assistant is on

        self.settings = settings
        self.name = settings.model
        self.anthropic = anthropic
        self.client = anthropic.Anthropic(api_key=key, timeout=120, max_retries=2)

    def call(self, messages: list[dict[str, Any]], language: str) -> Reply:
        errors = self.anthropic
        try:
            response = self.client.beta.messages.create(
                model=self.settings.model,
                max_tokens=MAX_TOKENS,
                system=SYSTEM_PROMPT.format(language=LANGUAGES.get(language, "the language of the question")),
                tools=TOOLS,  # type: ignore[arg-type]
                messages=messages,  # type: ignore[arg-type]
                thinking={"type": "adaptive"},
                output_config={"effort": self.settings.effort},  # type: ignore[typeddict-item]
                cache_control={"type": "ephemeral"},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except errors.APIStatusError as e:
            raise ModelFailed(f"сервис модели ответил {e.status_code}") from e
        except errors.APIConnectionError as e:
            raise ModelFailed("нет связи с сервисом модели") from e
        u = response.usage
        usage = Usage(
            u.input_tokens or 0,
            u.output_tokens or 0,
            u.cache_read_input_tokens or 0,
            u.cache_creation_input_tokens or 0,
        )
        content = [block.model_dump(mode="json", exclude_none=True) for block in response.content]
        return Reply(content, response.stop_reason or "end_turn", usage, response.model)


def make_model(settings: AssistantSettings) -> Model | None:
    """The model in effect; None when the assistant is off or has no key."""
    if not settings.enabled:
        return None
    if settings.model == "fake":
        return FakeModel()
    try:
        key = settings.key_file.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return AnthropicModel(settings, key) if key else None
