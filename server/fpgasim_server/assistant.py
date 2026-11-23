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
MAX_CHANGES = 500  # get_waveform; the browser clamps to the same bound (web/src/assistant/tools.ts)
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
(the {signals} tab: "{to_record}" on a signal; then the {waves} tab: "{start}", then "{stop}") instead of \
inventing values.
- Name tabs and buttons exactly as written here: these are the labels of the user's interface.
- You only advise. You cannot edit files, build, run or press buttons. Show the exact lines to change.
- Be short: the cause first, then the fix, then one sentence on why. Use Markdown with code blocks for \
Verilog and .cst lines.
- Answer in {language}."""

# The interface labels the prompt names, from web/src/i18n/<language>.json (keys in the comments); a test keeps
# them equal to the dictionaries. The model would otherwise name the tabs in English in a Russian interface.
UI_LABELS: dict[str, dict[str, str]] = {
    "ru": {
        "signals": "Сигналы",  # signals.title
        "to_record": "В запись",  # signals.toRecord
        "waves": "Осциллограммы",  # waves.title
        "start": "Записать",  # waves.start
        "stop": "Стоп",  # waves.stop
    },
    "en": {
        "signals": "Signals",
        "to_record": "Record",
        "waves": "Waveforms",
        "start": "Record",
        "stop": "Stop",
    },
}


def system_prompt(language: str) -> str:
    """The system prompt in the language of the answer; an unknown language gets the English labels."""
    labels = UI_LABELS.get(language, UI_LABELS["en"])
    return SYSTEM_PROMPT.format(language=LANGUAGES.get(language, "the language of the question"), **labels)


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
                "max_changes": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_CHANGES,
                    "description": f"Per signal, default 50, at most {MAX_CHANGES}.",
                },
            },
            "additionalProperties": False,
        },
    },
]


class Reply(NamedTuple):
    content: list[dict[str, Any]]
    stop_reason: str
    usage: Usage  # all attempts of the call together
    model: str
    # Tokens per model when more than one model ran (a refusal fallback); empty means all of `usage` is `model`'s.
    spent: tuple[tuple[str, Usage], ...] = ()


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


# "#все" in a question makes the scripted model call all five tools (the end-to-end test of every tool).
ALL_TOOLS: list[tuple[str, dict[str, Any]]] = [
    ("list_files", {}),
    ("read_file", {"path": "top.v"}),
    ("get_messages", {}),
    ("get_board", {}),
    ("get_waveform", {}),
]


class FakeModel:
    """The scripted model of the tests (decision 177): no key, no network, no cost."""

    name = "fake"

    def call(self, messages: list[dict[str, Any]], language: str) -> Reply:
        question = last_text(messages)
        usage = Usage(100, 20, 0, 0)
        if question is not None and "#сбой" in question:
            raise ModelFailed("тестовый сбой")
        if question is not None and "#все" in question:
            content = [
                {"type": "tool_use", "id": f"fake_{name}", "name": name, "input": tool_input}
                for name, tool_input in ALL_TOOLS
            ]
            return Reply(content, "tool_use", usage, "fake")
        if question is not None:
            content = [
                {"type": "tool_use", "id": "fake_1", "name": "list_files", "input": {}},
                {"type": "tool_use", "id": "fake_2", "name": "get_board", "input": {}},
            ]
            return Reply(content, "tool_use", usage, "fake")
        results = [b for b in messages[-1]["content"] if b.get("type") == "tool_result"]
        if len(results) == len(ALL_TOOLS):
            # The answer names the tools whose results came back as errors.
            failed = [str(b["tool_use_id"]).removeprefix("fake_") for b in results if b.get("is_error")]
            names = ", ".join(name for name, _ in ALL_TOOLS)
            text = f"Тестовый ответ. Инструменты: {names}. Ошибки: {', '.join(failed) or 'нет'}."
            return Reply([{"type": "text", "text": text}], "end_turn", usage, "fake")
        text = "Тестовый ответ. Инструменты: list_files, get_board."
        return Reply([{"type": "text", "text": text}], "end_turn", usage, "fake")


class AnthropicModel:
    """Claude through the Messages API with the author's key (decision 175)."""

    def __init__(self, settings: AssistantSettings, key: str) -> None:
        import anthropic  # the package loads only when the assistant is on

        self.settings = settings
        self.name = settings.model
        self.anthropic = anthropic
        # nginx cuts a request at 150 s: one attempt of at most 100 s lets the server answer with its own text.
        self.client = anthropic.Anthropic(api_key=key, timeout=100, max_retries=0)

    def call(self, messages: list[dict[str, Any]], language: str) -> Reply:
        errors = self.anthropic
        try:
            response = self.client.beta.messages.create(
                model=self.settings.model,
                max_tokens=MAX_TOKENS,
                system=system_prompt(language),
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
        except errors.AnthropicError as e:
            # Any other failure of the SDK (a reply it cannot read) is the model service's, not the server's.
            raise ModelFailed(f"ошибка клиента модели: {type(e).__name__}") from e
        spent = attempts(response.usage, self.settings.model, response.model)
        usage = Usage(*(sum(column) for column in zip(*(u for _, u in spent), strict=True)))
        content = [block.model_dump(mode="json", exclude_none=True) for block in response.content]
        return Reply(
            content, response.stop_reason or "end_turn", usage, response.model, tuple(spent) if len(spent) > 1 else ()
        )


def attempts(usage: Any, primary: str, served: str) -> list[tuple[str, Usage]]:  # noqa: ANN401 — SDK usage
    """Tokens of each model of one call, in the order of first use.

    With a refusal fallback the top-level usage covers only the attempt that produced the message;
    `usage.iterations` lists every attempt, the declined one included. An entry without a model is the
    configured model's; without iterations, the whole usage is the model that answered.
    """
    entries = [e for e in (getattr(usage, "iterations", None) or []) if hasattr(e, "input_tokens")]
    named = [(getattr(e, "model", None) or primary, e) for e in entries] or [(served, usage)]
    by_model: dict[str, Usage] = {}
    for name, e in named:
        u = Usage(
            e.input_tokens or 0,
            e.output_tokens or 0,
            getattr(e, "cache_read_input_tokens", 0) or 0,
            getattr(e, "cache_creation_input_tokens", 0) or 0,
        )
        prev = by_model.get(name, Usage(0, 0, 0, 0))
        by_model[name] = Usage(*(x + y for x, y in zip(prev, u, strict=True)))
    return list(by_model.items())


def make_model(settings: AssistantSettings) -> Model | None:
    """The model in effect; None when the assistant is off or has no key."""
    if not settings.enabled:
        return None
    if settings.model == "fake":
        return FakeModel()
    try:
        key = settings.key_file.read_text(encoding="utf-8").strip()
    except (OSError, UnicodeDecodeError):
        # A missing or broken key file turns the assistant off; it does not stop the server.
        return None
    return AnthropicModel(settings, key) if key else None
