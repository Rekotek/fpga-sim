"""Accounts and sessions: (docs/tz-accounts.md, sections 2 and 3).

Time is replaced: the account database clock (AccountStore.clock) drives session and failed-login counting.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Env, load_project
from fpgasim_server import admin
from fpgasim_server.accounts import (
    SCHEMA_VERSION,
    AccountsError,
    AccountStore,
    SchemaTooNew,
    hash_password,
    hash_token,
)
from fpgasim_server.api import create_app

MINUTE_MS = 60_000
DAY_MS = 24 * 60 * MINUTE_MS


class Clock:
    def __init__(self, start: int = 1_795_000_000_000) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def advance(self, ms: int) -> None:
        self.now += ms


@pytest.fixture
def acc(make_env: Any) -> Env:  # noqa: ANN401
    """A service with an empty account database and a replaced clock."""
    env = make_env()
    env.clock = Clock()
    env.service.accounts.clock = env.clock
    return env


def bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def login_response(env: Env, login: str, password: str, **headers: str) -> Any:  # noqa: ANN401
    return env.client.post("/v1/auth/login", json={"login": login, "password": password}, headers=headers)


# --- Login and session -----------------------------------------------------------------


def test_login_returns_token_and_info_shows_session(acc: Env) -> None:
    password = acc.add_user("misha", name="Миша")
    response = login_response(acc, "  Misha ", password)  # case and surrounding spaces do not matter
    assert response.status_code == 200
    body = response.json()
    assert len(body["token"]) == 43
    assert body["user"] == {
        "login": "misha", "name": "Миша", "role": "user", "enabled": True, "created": acc.clock.now,
        "lastLogin": acc.clock.now, "lastBuild": None, "projects": 0,
    }  # fmt: skip
    assert "password" not in json.dumps(body["user"])
    info = acc.client.get("/v1/info", headers=bearer(body["token"])).json()
    assert (info["auth"], info["owner"], info["user"]["login"]) == ("session", "misha", "misha")
    assert info["limits"]["account_requests_per_minute"] == 60
    # The key works as before: auth = key, no account, owner is the key owner's name.
    by_key = acc.client.get("/v1/info", headers=acc.auth).json()
    assert (by_key["auth"], by_key["user"], by_key["owner"]) == ("key", None, "tester")
    assert acc.log[-2]["auth"] == "session" and acc.log[-1]["auth"] == "key"


def test_bad_credentials_are_identical(acc: Env) -> None:
    password = acc.add_user("misha")
    acc.add_user("anna")
    off = acc.add_user("off")
    acc.service.accounts.update_user(None, "off", {"enabled": False})
    answers = [
        login_response(acc, "nosuch", password),
        login_response(acc, "misha", password + "x"),
        login_response(acc, "off", off),
    ]
    assert {r.status_code for r in answers} == {401}
    assert len({r.text for r in answers}) == 1
    assert answers[0].json()["error"]["code"] == "BAD_CREDENTIALS"
    # A failed login writes the login from the request into the login field, not owner.
    assert [(r["op"], r["owner"], r["login"], r["result"]) for r in acc.log[-3:]] == [
        ("login", None, "nosuch", "BAD_CREDENTIALS"),
        ("login", None, "misha", "BAD_CREDENTIALS"),
        ("login", None, "off", "BAD_CREDENTIALS"),
    ]


def test_eleventh_failure_locks_login_until_window_passes(acc: Env) -> None:
    password = acc.add_user("misha")
    statuses = []
    for _ in range(11):
        statuses.append(login_response(acc, "misha", "wrong-password").status_code)
        acc.clock.advance(1000)
    assert statuses == [401] * 10 + [429]
    locked = login_response(acc, "misha", password)
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "LOGIN_LOCKED"
    acc.clock.advance(15 * MINUTE_MS)
    assert login_response(acc, "misha", password).status_code == 200


def test_success_resets_login_counter(acc: Env) -> None:
    password = acc.add_user("misha")
    for _ in range(9):
        assert login_response(acc, "misha", "wrong-password").status_code == 401
    assert login_response(acc, "misha", password).status_code == 200
    for _ in range(10):
        assert login_response(acc, "misha", "wrong-password").status_code == 401


def test_failures_from_one_address_lock_it(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(login_failures_per_address=3)
    password = env.add_user("misha")
    here = {"X-Real-IP": "203.0.113.5"}
    for name in ("a1", "a2", "a3"):
        assert login_response(env, name, "wrong-password", **here).status_code == 401
    assert login_response(env, "a4", "wrong-password", **here).status_code == 429
    assert login_response(env, "misha", password, **here).status_code == 429
    assert login_response(env, "misha", password, **{"X-Real-IP": "203.0.113.6"}).status_code == 200


def test_session_expires_after_90_idle_days(acc: Env) -> None:
    password = acc.add_user("misha")
    headers = acc.login("misha", password)
    # A request before the deadline extends the session: 89 days, then another 89 days.
    for _ in range(2):
        acc.clock.advance(89 * DAY_MS)
        assert acc.client.get("/v1/info", headers=headers).status_code == 200
    acc.clock.advance(90 * DAY_MS)
    response = acc.client.get("/v1/info", headers=headers)
    assert response.status_code == 401 and response.json()["error"]["code"] == "UNAUTHORIZED"
    with sqlite3.connect(acc.service.accounts.path) as db:
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0


def test_last_used_updates_at_most_once_a_minute(acc: Env) -> None:
    headers = acc.login("misha", acc.add_user("misha"))
    db_path = acc.service.accounts.path

    def last_used() -> int:
        with sqlite3.connect(db_path) as db:
            return db.execute("SELECT last_used FROM sessions").fetchone()[0]

    start = last_used()
    acc.clock.advance(30_000)
    acc.client.get("/v1/info", headers=headers)
    assert last_used() == start
    acc.clock.advance(30_000)
    acc.client.get("/v1/info", headers=headers)
    assert last_used() == start + MINUTE_MS


def test_logout_removes_only_its_session(acc: Env) -> None:
    password = acc.add_user("misha")
    first, second = acc.login("misha", password), acc.login("misha", password)
    assert acc.client.post("/v1/auth/logout", headers=first).json()["status"] == "ok"
    assert acc.client.get("/v1/info", headers=first).status_code == 401
    assert acc.client.get("/v1/info", headers=second).status_code == 200
    # A key has no session: logout and password change are not for it.
    assert acc.client.post("/v1/auth/logout", headers=acc.auth).status_code == 403
    assert (
        acc.client.post("/v1/auth/password", json={"current": "x", "new": "y" * 8}, headers=acc.auth).status_code == 403
    )


def test_password_change_keeps_only_current_session(acc: Env) -> None:
    password = acc.add_user("misha")
    current, other = acc.login("misha", password), acc.login("misha", password)
    wrong = acc.client.post("/v1/auth/password", json={"current": "wrong-password", "new": "new-password-1"},
                            headers=current)  # fmt: skip
    assert (wrong.status_code, wrong.json()["error"]["code"]) == (401, "BAD_CREDENTIALS")
    short = acc.client.post("/v1/auth/password", json={"current": password, "new": "short"}, headers=current)
    assert short.status_code == 400
    assert acc.client.get("/v1/info", headers=other).status_code == 200  # the refusals did not touch the sessions
    ok = acc.client.post("/v1/auth/password", json={"current": password, "new": "new-password-1"}, headers=current)
    assert ok.status_code == 200
    assert acc.client.get("/v1/info", headers=current).status_code == 200
    assert acc.client.get("/v1/info", headers=other).status_code == 401
    assert login_response(acc, "misha", password).status_code == 401
    assert login_response(acc, "misha", "new-password-1").status_code == 200


def test_wrong_current_password_counts_as_login_failure(acc: Env) -> None:
    password = acc.add_user("misha")
    headers = acc.login("misha", password)
    for _ in range(11):
        acc.client.post("/v1/auth/password", json={"current": "wrong-password", "new": "new-password-1"},
                        headers=headers)  # fmt: skip
    assert login_response(acc, "misha", password).status_code == 429


def test_disable_removes_all_sessions(acc: Env) -> None:
    admin_headers = acc.login("boss", acc.add_user("boss", role="admin"))
    password = acc.add_user("misha")
    sessions = [acc.login("misha", password), acc.login("misha", password)]
    response = acc.client.patch("/v1/admin/users/misha", json={"enabled": False}, headers=admin_headers)
    assert response.status_code == 200 and response.json()["user"]["enabled"] is False
    assert [acc.client.get("/v1/info", headers=h).status_code for h in sessions] == [401, 401]
    assert login_response(acc, "misha", password).status_code == 401
    acc.client.patch("/v1/admin/users/misha", json={"enabled": True}, headers=admin_headers)
    assert login_response(acc, "misha", password).status_code == 200


# --- Users (section 3.4) ---------------------------------------------------------------

ADMIN_OPS: list[tuple[str, str, dict[str, Any] | None]] = [
    ("get", "/v1/admin/users", None),
    ("post", "/v1/admin/users", {"login": "newbie", "name": "Новичок", "role": "user"}),
    ("patch", "/v1/admin/users/misha", {"name": "Михаил"}),
    ("post", "/v1/admin/users/misha/password", None),
    ("delete", "/v1/admin/users/misha", None),
]


def call(env: Env, method: str, url: str, body: dict[str, Any] | None, headers: dict[str, str]) -> Any:  # noqa: ANN401
    if body is None:
        return env.client.request(method.upper(), url, headers=headers)
    return env.client.request(method.upper(), url, json=body, headers=headers)


@pytest.mark.parametrize(("method", "url", "body"), ADMIN_OPS)
def test_admin_operations_forbidden_for_user_and_key(acc: Env, method: str, url: str, body: Any) -> None:  # noqa: ANN401
    acc.add_user("boss", role="admin")
    user_headers = acc.login("misha", acc.add_user("misha"))
    before = acc.service.accounts.users()
    for headers in (user_headers, acc.auth):
        response = call(acc, method, url, body, headers)
        assert (response.status_code, response.json()["error"]["code"]) == (403, "FORBIDDEN"), headers
        assert response.json()["error"]["args"]["reason"] in ("adminOnly", "passwordSignIn")
    assert acc.service.accounts.users() == before


def test_admin_operations_work(acc: Env) -> None:
    headers = acc.login("boss", acc.add_user("boss", role="admin", name="Тарас"))
    misha_password = acc.add_user("misha")
    misha = acc.login("misha", misha_password)

    created = acc.client.post("/v1/admin/users", json={"login": "newbie", "name": " Новичок ", "role": "user"},
                              headers=headers)  # fmt: skip
    assert created.status_code == 200
    new_password = created.json()["password"]
    assert created.json()["user"]["name"] == "Новичок" and len(new_password) == 11 and new_password[5] == "-"
    assert login_response(acc, "newbie", new_password).status_code == 200
    taken = acc.client.post("/v1/admin/users", json={"login": "newbie", "name": "x", "role": "user"}, headers=headers)
    assert (taken.status_code, taken.json()["error"]["code"]) == (409, "EXISTS")
    assert taken.json()["error"]["args"] == {"reason": "loginTaken", "login": "newbie"}
    reasons = {"loginInvalid", "nameInvalid", "roleInvalid", "requestNotParsed"}
    for bad in ({"login": "Misha!", "name": "x", "role": "user"}, {"login": "a" * 33, "name": "x", "role": "user"},
                {"login": "ok", "name": "", "role": "user"}, {"login": "ok", "name": "x" * 65, "role": "user"},
                {"login": "ok", "name": "x", "role": "root"}, {"login": "ok", "name": "x"}):  # fmt: skip
        refused = acc.client.post("/v1/admin/users", json=bad, headers=headers)
        assert refused.status_code == 400, bad
        assert refused.json()["error"]["args"]["reason"] in reasons, bad
    name_refused = acc.client.post("/v1/admin/users", json={"login": "ok", "name": "", "role": "user"}, headers=headers)
    assert name_refused.json()["error"]["args"] == {"reason": "nameInvalid", "max": 64}

    users = acc.client.get("/v1/admin/users", headers=headers).json()["users"]
    assert [u["login"] for u in users] == ["boss", "misha", "newbie"]
    assert all("password" not in u for u in users)

    patched = acc.client.patch("/v1/admin/users/misha", json={"name": "Михаил", "role": "admin"}, headers=headers)
    assert (patched.json()["user"]["name"], patched.json()["user"]["role"]) == ("Михаил", "admin")
    missing = acc.client.patch("/v1/admin/users/nosuch", json={"name": "x"}, headers=headers)
    assert (missing.status_code, missing.json()["error"]["args"]) == (404, {"reason": "userMissing", "login": "nosuch"})
    assert acc.client.patch("/v1/admin/users/BAD!", json={"name": "x"}, headers=headers).status_code == 400

    reset = acc.client.post("/v1/admin/users/misha/password", headers=headers)
    assert reset.status_code == 200
    assert acc.client.get("/v1/info", headers=misha).status_code == 401  # the account sessions are deleted
    assert login_response(acc, "misha", misha_password).status_code == 401
    assert login_response(acc, "misha", reset.json()["password"]).status_code == 200

    assert acc.client.delete("/v1/admin/users/newbie", headers=headers).json()["status"] == "ok"
    assert acc.service.accounts.user("newbie") is None
    assert login_response(acc, "newbie", new_password).status_code == 401


def test_admin_resets_own_password_and_keeps_session(acc: Env) -> None:
    password = acc.add_user("boss", role="admin")
    headers, other = acc.login("boss", password), acc.login("boss", password)
    assert acc.client.post("/v1/admin/users/boss/password", headers=headers).status_code == 200
    assert acc.client.get("/v1/info", headers=headers).status_code == 200
    assert acc.client.get("/v1/info", headers=other).status_code == 401


def test_admin_restrictions_give_400(acc: Env) -> None:
    headers = acc.login("boss", acc.add_user("boss", role="admin"))
    store = acc.service.accounts
    before = store.user("boss")
    for method, body in (("patch", {"enabled": False}), ("patch", {"role": "user"}), ("delete", None)):
        response = call(acc, method, "/v1/admin/users/boss", body, headers)
        assert (response.status_code, response.json()["error"]["code"]) == (400, "BAD_REQUEST"), (method, body)
        assert "свою" in response.json()["error"]["text"]
        assert response.json()["error"]["args"]["reason"] in ("selfDisable", "selfDemote", "selfDelete")
    assert store.user("boss") == before
    assert acc.client.get("/v1/info", headers=headers).status_code == 200

    # The last enabled administrator: the API cannot reach it (the request is sent by an enabled
    # administrator, and one cannot change one's own account), so the rule is checked on the database.
    for action in (
        lambda: store.update_user("someone", "boss", {"enabled": False}),
        lambda: store.update_user("someone", "boss", {"role": "user"}),
        lambda: store.delete_user("someone", "boss"),
        lambda: store.update_user(None, "boss", {"enabled": False}),
    ):
        with pytest.raises(AccountsError) as e:
            action()
        assert e.value.status == 400 and "последнего" in e.value.text
    assert store.user("boss") == before
    # A second administrator lifts the ban.
    acc.add_user("deputy", role="admin")
    assert store.update_user("deputy", "boss", {"role": "user"})["role"] == "user"


def test_account_operations_rate_limited(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(account_requests_per_minute=3)
    headers = env.login("boss", env.add_user("boss", role="admin"))
    statuses = [env.client.get("/v1/admin/users", headers=headers).status_code for _ in range(4)]
    assert statuses == [200, 200, 200, 429]
    # The build count is separate: info and check keep working.
    assert env.client.get("/v1/info", headers=headers).status_code == 200


def test_cors_allows_new_methods(acc: Env) -> None:
    response = acc.client.options(
        "/v1/admin/users/x",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH"},
    )
    assert response.status_code == 200
    allowed = response.headers["access-control-allow-methods"]
    assert all(m in allowed for m in ("GET", "POST", "PUT", "PATCH", "DELETE"))


# --- Build by session ------------------------------------------------------------------


def test_build_operations_work_with_session(env: Env) -> None:
    session = env.login("builder", env.add_user("builder"))
    for headers in (env.auth, session):
        check = env.client.post("/v1/check", json=load_project("ok"), headers=headers)
        assert check.status_code == 200 and check.json()["status"] == "ok", check.text
        build = env.client.post("/v1/build", json=load_project("ok"), headers=headers)
        assert build.status_code == 200 and build.json()["status"] == "ok", build.text
        wasm = env.client.get(build.json()["artifacts"]["wasm"], headers=headers)
        assert wasm.status_code == 200 and wasm.content[:4] == b"\0asm"
        tb = env.client.post(
            "/v1/testbench", json={**load_project("with_testbench"), "testbench": "tb_top.v"}, headers=headers
        )
        assert tb.status_code == 200 and tb.json()["status"] == "ok", tb.text
    owners = [(r["op"], r["auth"], r["owner"]) for r in env.log[-4:]]
    assert owners == [("check", "session", "builder"), ("build", "session", "builder"),
                      ("artifacts", "session", "builder"), ("testbench", "session", "builder")]  # fmt: skip


# --- Secrets in the log and the database -----------------------------------------------


def test_no_password_or_token_in_log_and_db(acc: Env) -> None:
    password = acc.add_user("boss", role="admin")
    login = login_response(acc, "boss", password).json()
    token = login["token"]
    headers = bearer(token)
    login_response(acc, "boss", "wrong-" + password)
    acc.client.post("/v1/auth/password", json={"current": "bad-" + password, "new": "x" * 10}, headers=headers)
    acc.client.post("/v1/auth/password", json={"current": password, "new": "second-password"}, headers=headers)
    created = acc.client.post("/v1/admin/users", json={"login": "misha", "name": "Миша", "role": "user"},
                              headers=headers).json()  # fmt: skip
    reset = acc.client.post("/v1/admin/users/misha/password", headers=headers).json()
    misha_token = login_response(acc, "misha", reset["password"]).json()["token"]
    acc.client.get("/v1/info", headers=bearer(misha_token))
    acc.client.post("/v1/auth/login", content=b'{"login": "boss", "password": 12345678}')  # wrong field type

    secrets_ = [password, "second-password", created["password"], reset["password"], token, misha_token,
                hash_token(token), hash_token(misha_token)]  # fmt: skip
    log_text = json.dumps(acc.log, ensure_ascii=False)
    assert {r["op"] for r in acc.log} >= {"login", "password", "admin-user-add", "admin-user-password", "info"}
    for secret in secrets_:
        assert secret not in log_text
    db_dir = acc.service.accounts.path.parent
    raw = b"".join(p.read_bytes() for p in db_dir.iterdir() if p.is_file())
    for secret in secrets_[:6]:
        assert secret.encode() not in raw
    with sqlite3.connect(acc.service.accounts.path) as db:
        hashes = [row[0] for row in db.execute("SELECT password FROM users")]
        tokens = [row[0] for row in db.execute("SELECT token_sha256 FROM sessions")]
    assert all(h.startswith("scrypt$32768$8$1$") for h in hashes)
    assert hash_token(misha_token) in tokens and misha_token not in tokens


# --- Utility and database --------------------------------------------------------------


def test_admin_cli_user_add_creates_working_admin(acc: Env, capsys: pytest.CaptureFixture[str]) -> None:
    db = ["--db", str(acc.service.accounts.path)]
    assert admin.main([*db, "user", "add", "x", "--admin"]) == 0
    password = capsys.readouterr().out.strip()
    headers = acc.login("x", password)
    info = acc.client.get("/v1/info", headers=headers).json()
    assert (info["user"]["role"], info["user"]["name"]) == ("admin", "x")
    assert acc.client.get("/v1/admin/users", headers=headers).status_code == 200

    assert admin.main([*db, "user", "add", "x"]) == 1  # the login is taken
    assert admin.main([*db, "user", "add", "y", "--name", "Игрек"]) == 0
    capsys.readouterr()
    assert admin.main([*db, "user", "list"]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert [line.split("\t")[:3] for line in lines] == [["x", "admin", "включена"], ["y", "user", "включена"]]
    assert lines[1].endswith("—") and not lines[0].endswith("—")  # x logged in, y did not

    assert admin.main([*db, "user", "disable", "x"]) == 1  # the last enabled administrator
    assert admin.main([*db, "user", "disable", "y"]) == 0
    assert acc.client.get("/v1/info", headers=headers).status_code == 200
    assert admin.main([*db, "user", "passwd", "x"]) == 0
    new = capsys.readouterr().out.strip().splitlines()[-1]
    assert acc.client.get("/v1/info", headers=headers).status_code == 401  # the sessions are deleted
    assert login_response(acc, "x", new).status_code == 200


def test_newer_schema_stops_service(make_env: Any, tmp_path: Path) -> None:  # noqa: ANN401
    env = make_env()
    db_path = env.service.accounts.path
    with sqlite3.connect(db_path) as db:
        db.execute(f"PRAGMA user_version = {SCHEMA_VERSION + 1}")
    with pytest.raises(SchemaTooNew) as e:
        create_app(env.settings, env.log.append)
    assert f"схемы {SCHEMA_VERSION + 1}" in str(e.value) and "новее" in str(e.value)
    assert admin.main(["--db", str(db_path), "user", "list"]) == 1


def test_db_restore_replaces_db_and_generation(acc: Env, tmp_path: Path) -> None:
    store = acc.service.accounts
    password = acc.add_user("misha")
    backup = tmp_path / "accounts-20261120.db"
    with sqlite3.connect(store.path) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    before = store.generation()
    acc.add_user("later")
    headers = acc.login("misha", password)
    in_backup = store.open_session("misha")  # a session that will get into the backup
    assert in_backup is not None
    with sqlite3.connect(store.path) as src, sqlite3.connect(backup) as dst:
        dst.execute("DELETE FROM sessions")
        dst.execute("INSERT INTO sessions VALUES (?, 'misha', 1, ?)", (hash_token(in_backup), acc.clock.now))

    assert admin.main(["--db", str(store.path), "db", "restore", str(backup)]) == 0
    assert store.generation() != before
    assert [u["login"] for u in store.users()] == ["misha"]
    # A session opened after the backup is not present in the restored database.
    assert acc.client.get("/v1/info", headers=headers).status_code == 401
    # A session from the backup does not return either: it could have been closed after the backup.
    assert acc.client.get("/v1/info", headers=bearer(in_backup)).status_code == 401
    assert acc.client.get("/v1/info", headers=acc.login("misha", password)).status_code == 200
    kept = list(store.path.parent.glob("accounts-before-restore-*.db"))
    assert len(kept) == 1
    with sqlite3.connect(kept[0]) as db:
        assert {row[0] for row in db.execute("SELECT login FROM users")} == {"misha", "later"}


@pytest.mark.parametrize("kind", ["text", "empty", "other-schema", "older-version"])
def test_db_restore_rejects_foreign_file(acc: Env, tmp_path: Path, kind: str) -> None:
    store = acc.service.accounts
    acc.add_user("misha")
    bad = tmp_path / "bad.db"
    if kind == "text":
        bad.write_text("это не база\n" * 100, encoding="utf-8")
    elif kind == "empty":
        bad.write_bytes(b"")
    elif kind == "other-schema":
        with sqlite3.connect(bad) as db:
            db.execute("CREATE TABLE users (login TEXT)")
            db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
    else:
        with sqlite3.connect(store.path) as src, sqlite3.connect(bad) as dst:
            src.backup(dst)
        with sqlite3.connect(bad) as db:
            db.execute("PRAGMA user_version = 0")
    generation = store.generation()
    content = store.path.read_bytes()
    assert admin.main(["--db", str(store.path), "db", "restore", str(bad)]) == 1
    assert store.generation() == generation and store.path.read_bytes() == content
    assert [u["login"] for u in store.users()] == ["misha"]
    assert [p.name for p in store.path.parent.iterdir() if "restore" in p.name] == []


def test_store_opens_existing_db_and_keeps_generation(tmp_path: Path) -> None:
    path = tmp_path / "accounts" / "accounts.db"
    first = AccountStore(path)
    generation = first.generation()
    assert AccountStore(path).generation() == generation
    assert (path.parent.stat().st_mode & 0o777) == 0o700 and (path.stat().st_mode & 0o777) == 0o600
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert db.execute("PRAGMA user_version").fetchone()[0] == SCHEMA_VERSION
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert tables == {"users", "sessions", "projects", "files", "meta"}


def test_key_still_works_when_accounts_db_breaks(make_env: Any) -> None:  # noqa: ANN401
    """A failure of the account database does not break key login (section 0.4)."""
    env = make_env()

    def broken(token: str) -> None:
        raise sqlite3.OperationalError("disk I/O error")

    env.service.accounts.session = broken
    assert env.client.get("/v1/info", headers=env.auth).status_code == 200
    assert "disk I/O error" in env.log[-1]["accountsError"]


def test_session_gets_503_when_accounts_db_breaks(acc: Env) -> None:
    """A database failure does not look like a session end to the client: the answer is 503, not 401."""
    headers = acc.login("misha", acc.add_user("misha"))
    working = acc.service.accounts.session

    def broken(token: str) -> None:
        raise sqlite3.OperationalError("database is locked")

    acc.service.accounts.session = broken
    response = acc.client.get("/v1/info", headers=headers)
    assert (response.status_code, response.json()["error"]["code"]) == (503, "BUSY")
    assert "database is locked" in acc.log[-1]["accountsError"]
    acc.service.accounts.session = working
    assert acc.client.get("/v1/info", headers=headers).status_code == 200


def test_parallel_logins_do_not_bypass_lock(acc: Env) -> None:
    """Simultaneous attempts: after ten failures a correct password from the same batch does not pass.

    Batches of four requests: this many places of the check queue go to one address.
    """
    password = acc.add_user("misha")

    async def bursts() -> list[list[int]]:
        transport = httpx.ASGITransport(app=acc.client.app)
        rounds = [["wrong"] * 4, ["wrong"] * 4, ["wrong", "wrong", "wrong", password]]
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            return [
                [
                    r.status_code
                    for r in await asyncio.gather(
                        *(client.post("/v1/auth/login", json={"login": "misha", "password": p}) for p in group)
                    )
                ]
                for group in rounds
            ]

    # Failures 9 and 10 get 401, the eleventh gets 429; the correct password waits in the queue behind them.
    assert asyncio.run(bursts()) == [[401] * 4, [401] * 4, [401, 401, 429, 429]]
    assert acc.service.password_waiting == 0 and acc.service._password_by_address == {}


def test_password_queue_overflow_gives_503(acc: Env) -> None:
    """The queue to the password check is bounded: extra requests of a batch get 503, the password is not checked."""
    password = acc.add_user("misha")

    async def burst() -> list[int]:
        transport = httpx.ASGITransport(app=acc.client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            answers = await asyncio.gather(
                *(
                    client.post("/v1/auth/login", json={"login": "misha", "password": password if i == 45 else "wrong"})
                    for i in range(60)
                )
            )
        return [r.status_code for r in answers]

    statuses = asyncio.run(burst())
    assert (statuses.count(200), statuses.count(401), statuses.count(503)) == (0, 4, 56)
    assert acc.service.password_waiting == 0 and acc.service._password_by_address == {}


def test_one_address_does_not_take_whole_password_queue(acc: Env) -> None:
    """A batch of logins from one address does not take login away from another address."""
    password = acc.add_user("misha")

    async def burst() -> tuple[list[int], int]:
        transport = httpx.ASGITransport(app=acc.client.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            flood = [
                client.post(
                    "/v1/auth/login",
                    json={"login": f"nobody{i}", "password": "wrong-password"},
                    headers={"X-Real-IP": "203.0.113.5"},
                )
                for i in range(40)
            ]
            mine = client.post(
                "/v1/auth/login", json={"login": "misha", "password": password}, headers={"X-Real-IP": "203.0.113.6"}
            )
            *others, own = await asyncio.gather(*flood, mine)
        return [r.status_code for r in others], own.status_code

    flood, own = asyncio.run(burst())
    assert own == 200
    assert flood.count(401) == 4 and flood.count(503) == 36


@pytest.mark.parametrize("change", ["password", "delete", "disable"])
def test_login_fails_when_account_changes_during_check(acc: Env, change: str) -> None:
    """The account changed its password, was deleted or disabled while the password was checked: no session opens."""
    password = acc.add_user("misha")
    store = acc.service.accounts
    read_hash = store.password_hash

    def read_then_change(login: str) -> Any:  # noqa: ANN401
        found = read_hash(login)
        if change == "password":
            store.set_password(login, hash_password("another-password"))
        elif change == "delete":
            store.delete_user(None, login)
        else:
            store.update_user(None, login, {"enabled": False})
        return found

    store.password_hash = read_then_change
    response = login_response(acc, "misha", password)
    assert (response.status_code, response.json()["error"]["code"]) == (401, "BAD_CREDENTIALS")
    with sqlite3.connect(store.path) as db:
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0


def test_invalid_logins_share_one_failure_counter(acc: Env) -> None:
    """A login that breaks the rule is one line in the failure counter: long logins do not take memory."""
    for name in ("x" * 60_000, "с пробелом", "y" * 33):
        assert login_response(acc, name, "wrong-password").status_code == 401
    assert all(len(key) < 64 for key in acc.service.login_guard._failures)
    assert len(acc.service.login_guard._failures) == 2
