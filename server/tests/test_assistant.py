"""The assistant (docs/superpowers/specs/2026-11-22-assistant-design.md): settings, token accounting,
history checks, the fake model, the /v1/assistant operation and the spend report."""

from __future__ import annotations

from pathlib import Path

import pytest
from fpgasim_server.config import AssistantSettings, Limits, load_settings
from fpgasim_server.usage import Usage, UsageStore

DAY_MS = 24 * 3600 * 1000
NOON = 1_795_867_200_000  # 2026-11-28 12:00 UTC


class Clock:
    def __init__(self, ms: int = NOON) -> None:
        self.ms = ms

    def __call__(self) -> int:
        return self.ms


def test_настройки_помощника_по_умолчанию(tmp_path: Path) -> None:
    defaults = AssistantSettings()
    assert defaults == AssistantSettings(
        enabled=False, model="claude-sonnet-5-5", effort="medium", key_file=Path("/etc/fpgasim/anthropic.key")
    )
    limits = Limits()
    assert limits.assistant_requests_per_minute == 20
    assert limits.assistant_tokens_per_day == 400_000
    assert limits.assistant_tokens_per_day_total == 4_000_000

    config = tmp_path / "config.toml"
    config.write_text('[assistant]\nenabled = true\nmodel = "fake"\nkey_file = "/tmp/k"\n')
    env = {"FPGASIM_CONFIG": str(config), "FPGASIM_IMAGE": "fpgasim-build:x", "FPGASIM_DATA_DIR": str(tmp_path)}
    settings = load_settings(env)
    assert settings.assistant == AssistantSettings(enabled=True, model="fake", effort="medium", key_file=Path("/tmp/k"))
    assert load_settings({**env, "FPGASIM_CONFIG": str(tmp_path / "none.toml")}).assistant == AssistantSettings()

    config.write_text("[assistant]\ncolour = 1\n")
    with pytest.raises(ValueError, match="colour"):
        load_settings(env)


def test_учёт_токенов(tmp_path: Path) -> None:
    store = UsageStore(tmp_path / "assistant" / "usage.db", Clock())
    store.add("session:ann", "claude-sonnet-5-5", Usage(100, 20, 300, 40))
    store.add("session:ann", "claude-sonnet-5-5", Usage(1, 2, 3, 4))
    store.add("key:judges", "claude-sonnet-5-5", Usage(10, 0, 0, 0))
    assert Usage(1, 2, 3, 4).total == 10
    assert store.tokens_today("session:ann") == 470
    assert store.tokens_today("key:judges") == 10
    assert store.tokens_today("session:bob") == 0
    assert store.tokens_today_total() == 480
    assert (tmp_path / "assistant" / "usage.db").stat().st_mode & 0o777 == 0o600


def test_счётчик_нового_дня(tmp_path: Path) -> None:
    clock = Clock()
    store = UsageStore(tmp_path / "usage.db", clock)
    store.add("session:ann", "claude-sonnet-5-5", Usage(100, 0, 0, 0))
    clock.ms += DAY_MS
    assert store.tokens_today("session:ann") == 0
    assert store.tokens_today_total() == 0
    store.add("session:ann", "claude-sonnet-5-5", Usage(5, 0, 0, 0))
    rows = store.report(2)
    assert [(r["day"], r["owner"], r["input"]) for r in rows] == [
        ("2026-11-28", "session:ann", 100),
        ("2026-11-29", "session:ann", 5),
    ]
    assert set(rows[0]) == {"day", "owner", "model", "input", "output", "cacheRead", "cacheWrite"}
    assert [r["day"] for r in store.report(1)] == ["2026-11-29"]


# --- History checks and the fake model ---------------------------------------------

from fpgasim_server.assistant import FakeModel, ModelFailed, check_messages, make_model  # noqa: E402

TOOL_TURN = [
    {"role": "user", "content": "Почему горит LED0?"},
    {
        "role": "assistant",
        "content": [
            {"type": "thinking", "thinking": "", "signature": "x"},
            {"type": "tool_use", "id": "t1", "name": "list_files", "input": {}},
        ],
    },
    {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": "{}"}]},
]


def test_проверка_разговора() -> None:
    assert check_messages(TOOL_TURN) == TOOL_TURN
    assert check_messages([{"role": "user", "content": [{"type": "text", "text": "a"}]}])
    bad = [
        [],
        "текст",
        TOOL_TURN[:2],  # ends with assistant
        [TOOL_TURN[0], TOOL_TURN[0]],  # two user turns in a row
        [{"role": "user", "content": [{"type": "image", "source": {}}]}],
        [{"role": "user", "content": ""}],
        [{"role": "system", "content": "x"}],
        [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}, {"role": "user", "content": "c"}],
    ]
    for messages in bad:
        with pytest.raises(ValueError):
            check_messages(messages)
    long = [{"role": "user", "content": "a"}, {"role": "assistant", "content": []}] * 30 + [
        {"role": "user", "content": "a"}
    ]
    with pytest.raises(ValueError, match="длин"):
        check_messages(long)


def test_тестовая_модель() -> None:
    model = FakeModel()
    first = model.call([{"role": "user", "content": "Почему?"}], "ru")
    assert first.stop_reason == "tool_use"
    assert [(b["type"], b["name"], b["id"]) for b in first.content] == [
        ("tool_use", "list_files", "fake_1"),
        ("tool_use", "get_board", "fake_2"),
    ]
    assert first.usage == Usage(100, 20, 0, 0)
    second = model.call(TOOL_TURN, "ru")
    assert second.stop_reason == "end_turn"
    assert second.content == [{"type": "text", "text": "Тестовый ответ. Инструменты: list_files, get_board."}]
    with pytest.raises(ModelFailed):
        model.call([{"role": "user", "content": "проверка #сбой"}], "ru")


def test_нет_ключа_нет_модели(tmp_path: Path) -> None:
    key = tmp_path / "anthropic.key"
    assert make_model(AssistantSettings(enabled=True, key_file=key)) is None
    key.write_text("  \n")
    assert make_model(AssistantSettings(enabled=True, key_file=key)) is None
    key.write_text("sk-ant-test\n")
    assert make_model(AssistantSettings(enabled=False, key_file=key)) is None
    assert make_model(AssistantSettings(enabled=True, key_file=key)) is not None
    assert isinstance(make_model(AssistantSettings(enabled=True, model="fake")), FakeModel)
    assert make_model(AssistantSettings(enabled=False, model="fake")) is None
