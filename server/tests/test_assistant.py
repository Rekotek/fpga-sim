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


# --- The /v1/assistant operation -----------------------------------------------------

import json  # noqa: E402
from typing import Any  # noqa: E402

QUESTION = [{"role": "user", "content": "Почему горит LED0?"}]


def assistant_env(make_env: Any, **limits: Any) -> Any:  # noqa: ANN401
    env = make_env(**limits)
    env.service.model = FakeModel()
    return env


def ask(env: Any, messages: list[dict[str, Any]], headers: dict[str, str] | None = None) -> Any:  # noqa: ANN401
    return env.client.post("/v1/assistant", json={"messages": messages, "language": "ru"}, headers=headers or env.auth)


def test_помощник_отвечает_через_инструменты(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env)
    first = ask(env, QUESTION)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["stop_reason"] == "tool_use"
    assert body["usage"] == {"input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0}
    results = [{"type": "tool_result", "tool_use_id": b["id"], "content": "{}"} for b in body["content"]]
    history = [*QUESTION, {"role": "assistant", "content": body["content"]}, {"role": "user", "content": results}]
    second = ask(env, history)
    assert second.status_code == 200, second.text
    assert second.json()["content"][0]["text"].startswith("Тестовый ответ")
    assert env.service.usage.tokens_today("key:tester") == 240
    info = env.client.get("/v1/info", headers=env.auth).json()
    assert info["assistant"] == {"enabled": True, "model": "fake"}
    assert info["limits"]["assistant_tokens_per_day"] == 400_000


def test_помощник_выключен(make_env: Any) -> None:  # noqa: ANN401
    env = make_env()
    assert env.service.model is None
    response = ask(env, QUESTION)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "ASSISTANT_OFF"
    assert env.client.get("/v1/info", headers=env.auth).json()["assistant"] == {"enabled": False, "model": None}


def test_дневной_лимит_пользователя(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env, assistant_tokens_per_day=100)
    assert ask(env, QUESTION).status_code == 200
    refused = ask(env, QUESTION)
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "ASSISTANT_LIMIT"
    assert "00:00 UTC" in refused.json()["error"]["text"]
    password = env.add_user("ann")
    assert ask(env, QUESTION, env.login("ann", password)).status_code == 200


def test_общий_дневной_лимит(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env, assistant_tokens_per_day_total=100)
    assert ask(env, QUESTION).status_code == 200
    password = env.add_user("ann")
    refused = ask(env, QUESTION, env.login("ann", password))
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "ASSISTANT_LIMIT"


def test_лимит_в_минуту(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env, assistant_requests_per_minute=1)
    assert ask(env, QUESTION).status_code == 200
    refused = ask(env, QUESTION)
    assert refused.status_code == 429
    assert refused.json()["error"]["code"] == "RATE_LIMITED"


def test_сбой_модели(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env)
    response = ask(env, [{"role": "user", "content": "#сбой"}])
    assert response.status_code == 502
    assert response.json()["error"] == {"code": "ASSISTANT_FAILED", "text": "Помощник не ответил: тестовый сбой"}
    assert env.service.usage.tokens_today("key:tester") == 0


def test_длинный_разговор(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env)
    long = [{"role": "user", "content": "a"}, {"role": "assistant", "content": []}] * 30 + QUESTION
    response = ask(env, long)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "ASSISTANT_TOO_LONG"
    broken = ask(env, [*QUESTION, *QUESTION])
    assert broken.status_code == 400
    huge = ask(env, [{"role": "user", "content": "x" * (1024 * 1024 + 1)}])
    assert huge.status_code == 413


def test_журнал_без_текста(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env)
    ask(env, QUESTION)
    record = [r for r in env.log if r["op"] == "assistant"][-1]
    assert record["result"] == "ok"
    assert record["model"] == "fake"
    assert (record["tokensIn"], record["tokensOut"], record["cacheRead"], record["cacheWrite"]) == (100, 20, 0, 0)
    assert record["stopReason"] == "tool_use"
    assert "LED0" not in json.dumps(record, ensure_ascii=False)


def test_без_входа_нельзя(make_env: Any) -> None:  # noqa: ANN401
    env = assistant_env(make_env)
    assert ask(env, QUESTION, {"Authorization": "Bearer wrong"}).status_code == 401


# --- The spend report -----------------------------------------------------------------


def test_отчёт_о_расходе(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    from fpgasim_server.accounts import now_ms
    from fpgasim_server.admin import main
    from fpgasim_server.usage import cost

    monkeypatch.setenv("FPGASIM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("FPGASIM_CONFIG", str(tmp_path / "none.toml"))
    store = UsageStore(tmp_path / "assistant" / "usage.db", now_ms)
    store.add("session:ann", "claude-sonnet-5-5", Usage(1_000_000, 0, 0, 0))
    store.add("key:judges", "mystery", Usage(10, 20, 30, 40))
    assert cost("claude-sonnet-5-5", Usage(1_000_000, 0, 0, 0)) == 2.0
    assert cost("mystery", Usage(1, 1, 1, 1)) is None
    assert main(["assistant", "usage", "--days", "1"]) == 0
    lines = capsys.readouterr().out.strip().splitlines()
    today = store.day()
    assert f"{today}\tkey:judges\tmystery\t10\t20\t30\t40\t—" in lines
    assert f"{today}\tsession:ann\tclaude-sonnet-5-5\t1000000\t0\t0\t0\t$2.0000" in lines
    assert lines[-1] == f"{today}\tитого\t\t1000010\t20\t30\t40\t$2.0000"


def test_ключ_помощника_из_ввода(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    import io

    from fpgasim_server.admin import main

    key_file = tmp_path / "etc" / "anthropic.key"
    config = tmp_path / "config.toml"
    config.write_text(f'[assistant]\nkey_file = "{key_file}"\n')
    monkeypatch.setenv("FPGASIM_CONFIG", str(config))
    monkeypatch.setattr("sys.stdin", io.StringIO("not-a-key\n"))
    assert main(["assistant", "key"]) == 1
    assert not key_file.exists()
    monkeypatch.setattr("sys.stdin", io.StringIO("  sk-ant-api03-secret\n"))
    assert main(["assistant", "key"]) == 0
    assert key_file.read_text() == "sk-ant-api03-secret\n"
    assert key_file.stat().st_mode & 0o777 == 0o600
    out = capsys.readouterr()
    assert "secret" not in out.out + out.err
    assert str(key_file) in out.out
