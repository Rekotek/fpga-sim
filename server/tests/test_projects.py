"""Projects on the server: (docs/tz-accounts.md, sections 2.5, 2.6, 3.2, 3.3).

Time is replaced: the account database clock (AccountStore.clock) drives the trash, database backups, last_build.
"""

from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

import pytest
from conftest import Env
from fastapi.testclient import TestClient
from fpgasim_server import admin, projects
from fpgasim_server.accounts import hash_password
from test_accounts import DAY_MS, Clock


@pytest.fixture
def acc(make_env: Any) -> Env:  # noqa: ANN401
    """A service with an empty database and a replaced clock."""
    env = make_env()
    env.clock = Clock()
    env.service.accounts.clock = env.clock
    return env


def new_id() -> str:
    return str(uuid.uuid4())


def change(path: str, content: str | None, base_rev: int = 0) -> dict[str, Any]:
    return {"path": path, "content": content, "baseRev": base_rev}


def sync_response(env: Env, headers: dict[str, str], pid: str, body: dict[str, Any]) -> Any:  # noqa: ANN401
    """A sync request. If the test does not set the database generation, it is the current one:
    the client knows it from earlier responses.
    """
    if "generation" not in body:
        body = {**body, "generation": env.service.accounts.generation()}
    return env.client.post(f"/v1/projects/{pid}/sync", json=body, headers=headers)


def sync(
    env: Env,
    headers: dict[str, str],
    pid: str,
    since: int,
    changes: list[dict[str, Any]] | None = None,
    meta: dict[str, str] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {"since": since, "changes": changes or []}
    if meta is not None:
        body["meta"] = meta
    response = sync_response(env, headers, pid, body)
    assert response.status_code == 200, response.text
    return plain(response.json())


def plain(body: dict[str, Any]) -> dict[str, Any]:
    """A response without the durationMs field: the request log adds it to every response."""
    return {k: v for k, v in body.items() if k != "durationMs"}


META = {"name": "blink3", "board": "tang-nano-20k"}


def create(env: Env, headers: dict[str, str], files: dict[str, str] | None = None) -> tuple[str, dict[str, Any]]:
    pid = new_id()
    files = {"top.v": "module top; endmodule\n"} if files is None else files
    body = sync(env, headers, pid, 0, [change(p, c) for p, c in files.items()], META)
    return pid, body


def file_rows(env: Env, pid: str) -> dict[str, tuple[str | None, int]]:
    with sqlite3.connect(env.service.accounts.path) as db:
        return {p: (c, r) for p, c, r in db.execute("SELECT path, content, rev FROM files WHERE project = ?", (pid,))}


def project_row(env: Env, pid: str) -> tuple[Any, ...]:
    with sqlite3.connect(env.service.accounts.path) as db:
        return db.execute("SELECT name, board, rev, deleted_at, purged FROM projects WHERE id = ?", (pid,)).fetchone()


@pytest.fixture
def misha(acc: Env) -> dict[str, str]:
    return acc.login("misha", acc.add_user("misha"))


# --- Sync, trash, backups ----------------------------------------------------


def test_first_sync_creates_project_and_list_shows_it(acc: Env, misha: dict[str, str]) -> None:
    pid, body = create(acc, misha, {"top.v": "module top; endmodule\n", "lib/uart.v": "module uart; endmodule\n"})
    assert body["deleted"] is False
    assert (body["name"], body["board"], body["rev"]) == ("blink3", "tang-nano-20k", 2)
    assert body["applied"] == [{"path": "top.v", "rev": 1}, {"path": "lib/uart.v", "rev": 2}]
    assert body["conflicts"] == [] and body["remote"] == []
    assert body["modified"] == acc.clock.now
    listed = acc.client.get("/v1/projects", headers=misha).json()
    assert listed["generation"] == body["generation"] == acc.service.accounts.generation()
    assert listed["projects"] == [
        {"id": pid, "name": "blink3", "board": "tang-nano-20k", "rev": 2, "modified": acc.clock.now, "deleted": False}
    ]
    assert acc.service.accounts.user("misha")["projects"] == 1


def test_sync_without_changes_at_current_rev_is_empty(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha)
    body = sync(acc, misha, pid, created["rev"])
    assert (body["applied"], body["conflicts"], body["remote"]) == ([], [], [])
    assert body["rev"] == created["rev"]


def test_second_client_gets_remote_change(acc: Env, misha: dict[str, str]) -> None:
    # Two devices of one account: the second has its own session.
    token = acc.service.accounts.open_session("misha")
    assert token is not None
    other = {"Authorization": f"Bearer {token}"}
    pid, created = create(acc, misha, {"a.v": "1", "b.v": "1"})
    since = created["rev"]
    first = sync(acc, misha, pid, since, [change("a.v", "2", 1)])
    second = sync(acc, other, pid, since)
    assert second["remote"] == [{"path": "a.v", "rev": first["rev"], "content": "2"}]
    assert second["rev"] == first["rev"]


def test_two_clients_change_different_files(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha, {"a.v": "1", "b.v": "1"})
    since = created["rev"]
    first = sync(acc, misha, pid, since, [change("a.v", "a2", 1)])
    second = sync(acc, misha, pid, since, [change("b.v", "b2", 2)])
    assert first["conflicts"] == [] and second["conflicts"] == []
    assert second["applied"] == [{"path": "b.v", "rev": 4}]
    # The second client gets the first client's edit; its own edit is not in remote.
    assert second["remote"] == [{"path": "a.v", "rev": 3, "content": "a2"}]
    assert file_rows(acc, pid) == {"a.v": ("a2", 3), "b.v": ("b2", 4)}


def test_same_file_changed_differently_conflicts_and_retry_applies(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha, {"a.v": "1"})
    since = created["rev"]
    sync(acc, misha, pid, since, [change("a.v", "first", 1)])
    second = sync(acc, misha, pid, since, [change("a.v", "second", 1)])
    assert second["applied"] == []
    assert second["conflicts"] == [{"path": "a.v", "rev": 2, "content": "first"}]
    assert second["remote"] == []  # a file with a conflict does not go to remote
    assert file_rows(acc, pid) == {"a.v": ("first", 2)}
    retry = sync(acc, misha, pid, second["rev"], [change("a.v", "second", second["conflicts"][0]["rev"])])
    assert retry["applied"] == [{"path": "a.v", "rev": 3}] and retry["conflicts"] == []
    assert file_rows(acc, pid) == {"a.v": ("second", 3)}


def test_same_content_from_two_clients_is_not_conflict(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha, {"a.v": "1"})
    since = created["rev"]
    sync(acc, misha, pid, since, [change("a.v", "same", 1)])
    second = sync(acc, misha, pid, since, [change("a.v", "same", 1)])
    # The file revision is the current one on the server; the project revision does not grow.
    assert second["applied"] == [{"path": "a.v", "rev": 2}] and second["conflicts"] == []
    assert second["remote"] == [] and second["rev"] == 2


def test_file_deletion_reaches_second_client_and_edit_of_deleted_conflicts(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha, {"a.v": "1", "b.v": "1"})
    since = created["rev"]
    deleted = sync(acc, misha, pid, since, [change("a.v", None, 1)])
    assert deleted["applied"] == [{"path": "a.v", "rev": 3}]
    second = sync(acc, misha, pid, since)
    assert second["remote"] == [{"path": "a.v", "rev": 3, "content": None}]
    edit = sync(acc, misha, pid, since, [change("a.v", "edited", 1)])
    assert edit["conflicts"] == [{"path": "a.v", "rev": 3, "content": None}]
    assert file_rows(acc, pid)["a.v"] == (None, 3)
    # Both "deleted": no conflict.
    both = sync(acc, misha, pid, since, [change("a.v", None, 1)])
    assert both["applied"] == [{"path": "a.v", "rev": 3}] and both["conflicts"] == []


def test_file_recreated_under_deleted_path_is_accepted(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha, {"a.v": "1"})
    gone = sync(acc, misha, pid, created["rev"], [change("a.v", None, 1)])
    again = sync(acc, misha, pid, gone["rev"], [change("a.v", "new", 0)])
    assert again["applied"] == [{"path": "a.v", "rev": 3}] and again["conflicts"] == []
    assert file_rows(acc, pid) == {"a.v": ("new", 3)}
    # baseRev 0 over a live file is a conflict, not an overwrite.
    clash = sync(acc, misha, pid, again["rev"], [change("a.v", "other", 0)])
    assert clash["conflicts"] == [{"path": "a.v", "rev": 3, "content": "new"}]


def test_generation_in_answers_changes_after_restore(acc: Env, misha: dict[str, str], tmp_path: Any) -> None:  # noqa: ANN401
    store = acc.service.accounts
    pid, created = create(acc, misha)
    listed = acc.client.get("/v1/projects", headers=misha).json()
    assert created["generation"] == listed["generation"] == store.generation()
    backup = tmp_path / "copy.db"
    with sqlite3.connect(store.path) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    assert admin.main(["--db", str(store.path), "db", "restore", str(backup)]) == 0
    headers = acc.login("misha", password_of(acc, "misha"))
    after = sync(acc, headers, pid, 0)
    assert after["generation"] != created["generation"]
    assert acc.client.get("/v1/projects", headers=headers).json()["generation"] == after["generation"]


def test_rename_reaches_second_client(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha)
    since = created["rev"]
    renamed = sync(acc, misha, pid, since, meta={"name": "blink4", "board": "tang-nano-20k"})
    assert (renamed["name"], renamed["rev"]) == ("blink4", since + 1)
    second = sync(acc, misha, pid, since)
    assert (second["name"], second["board"], second["rev"]) == ("blink4", "tang-nano-20k", since + 1)
    # The same meta again does not change the revision.
    same = sync(acc, misha, pid, renamed["rev"], meta={"name": "blink4", "board": "tang-nano-20k"})
    assert same["rev"] == renamed["rev"]


def test_foreign_project_404_and_key_403(acc: Env, misha: dict[str, str]) -> None:
    anna = acc.login("anna", acc.add_user("anna"))
    pid, created = create(acc, misha)
    missing = new_id()
    for target in (pid, missing):
        response = sync_response(acc, anna, target, {"since": 0, "changes": [change("x.v", "x")]})
        assert (response.status_code, response.json()["error"]["code"]) == (404, "NOT_FOUND")
        deleted = acc.client.delete(f"/v1/projects/{target}", headers=anna)
        assert (deleted.status_code, deleted.json()["error"]["code"]) == (404, "NOT_FOUND")
    # "Absent" and "foreign" are not told apart.
    texts = {sync_response(acc, anna, t, {"since": 0, "changes": []}).text for t in (pid, missing)} | {
        acc.client.delete(f"/v1/projects/{t}", headers=anna).text for t in (pid, missing)
    }
    assert len(texts) == 1
    # A foreign project with meta is not created anew under another account.
    taken = sync_response(acc, anna, pid, {"since": 0, "meta": META, "changes": []})
    assert taken.status_code == 404
    for response in (
        sync_response(acc, acc.auth, pid, {"since": 0, "changes": []}),
        acc.client.delete(f"/v1/projects/{pid}", headers=acc.auth),
        acc.client.get("/v1/projects", headers=acc.auth),
    ):
        assert (response.status_code, response.json()["error"]["code"]) == (403, "FORBIDDEN")
    assert project_row(acc, pid) == ("blink3", "tang-nano-20k", created["rev"], None, 0)
    assert file_rows(acc, pid) == {"top.v": ("module top; endmodule\n", 1)}


def test_project_over_2mb_after_changes_gives_413_and_writes_nothing(acc: Env, misha: dict[str, str]) -> None:
    big = "x" * (500 * 1024)
    pid, created = create(acc, misha, {f"f{i}.v": big for i in range(3)})
    before_files, before_project = file_rows(acc, pid), project_row(acc, pid)
    # Each file is within the limit, the project after the changes is over 2 MB.
    response = sync_response(
        acc,
        misha,
        pid,
        {
            "since": created["rev"],
            "meta": {"name": "renamed", "board": "tang-nano-20k"},
            "changes": [change("f0.v", big + "y", 1), change("f3.v", big), change("f4.v", big)],
        },
    )
    assert (response.status_code, response.json()["error"]["code"]) == (413, "PROJECT_TOO_LARGE")
    assert file_rows(acc, pid) == before_files and project_row(acc, pid) == before_project
    # A new project over 2 MB is not created at all.
    other = new_id()
    response = sync_response(
        acc, misha, other, {"since": 0, "meta": META, "changes": [change(f"g{i}.v", big) for i in range(5)]}
    )
    assert response.status_code == 413
    assert project_row(acc, other) is None
    # A file over 512 KB and more than 200 files give 413 too.
    too_big = sync_response(acc, misha, pid, {"since": 0, "changes": [change("huge.v", "x" * (512 * 1024 + 1))]})
    assert too_big.status_code == 413 and "huge.v" in too_big.json()["error"]["text"]
    assert too_big.json()["error"]["args"] == {"reason": "fileTooLarge", "path": "huge.v", "kilobytes": 512}


def test_too_many_files_gives_413(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(max_files=3)
    headers = env.login("misha", env.add_user("misha"))
    pid, _ = create(env, headers, {"a.v": "1", "b.v": "1", "c.v": "1"})
    response = sync_response(env, headers, pid, {"since": 3, "changes": [change("d.v", "1")]})
    assert response.status_code == 413
    # Deleted files do not count toward the file count.
    ok = sync_response(env, headers, pid, {"since": 3, "changes": [change("a.v", None, 1), change("d.v", "1")]})
    assert ok.status_code == 200, ok.text


def test_101st_project_gives_413(acc: Env, misha: dict[str, str]) -> None:
    ids = [create(acc, misha, {})[0] for _ in range(100)]
    response = sync_response(acc, misha, new_id(), {"since": 0, "meta": META, "changes": []})
    assert (response.status_code, response.json()["error"]["code"]) == (413, "PROJECT_TOO_LARGE")
    assert "100" in response.json()["error"]["text"]
    assert response.json()["error"]["args"] == {"reason": "tooManyProjects", "limit": 100}
    # A project in the trash does not count toward the number.
    assert acc.client.delete(f"/v1/projects/{ids[0]}", headers=misha).status_code == 200
    assert sync_response(acc, misha, new_id(), {"since": 0, "meta": META, "changes": []}).status_code == 200


def test_delete_then_sync_is_deleted_and_admin_restore_revives(acc: Env, misha: dict[str, str]) -> None:
    boss = acc.login("boss", acc.add_user("boss", role="admin"))
    pid, created = create(acc, misha, {"a.v": "1"})
    for _ in range(2):  # a repeated DELETE answers the same
        response = acc.client.delete(f"/v1/projects/{pid}", headers=misha)
        assert (response.status_code, plain(response.json())) == (200, {"status": "ok"})
    gone = sync(acc, misha, pid, created["rev"], [change("a.v", "lost?", 1)], META)
    assert gone == {"deleted": True, "rev": created["rev"], "generation": acc.service.accounts.generation()}
    assert file_rows(acc, pid) == {"a.v": ("1", 1)}  # the changes are not applied
    listed = acc.client.get("/v1/projects", headers=misha).json()["projects"]
    assert [(p["id"], p["deleted"]) for p in listed] == [(pid, True)]
    assert acc.service.accounts.user("misha")["projects"] == 0

    restored = acc.client.post(f"/v1/admin/projects/{pid}/restore", headers=boss)
    assert (restored.status_code, plain(restored.json())) == (200, {"status": "ok"})
    body = sync(acc, misha, pid, created["rev"], [change("a.v", "2", 1)])
    assert body["deleted"] is False and body["rev"] == created["rev"] + 2  # restore +1, edit +1
    assert body["applied"] == [{"path": "a.v", "rev": created["rev"] + 2}]


def test_purge_after_30_days_in_trash(acc: Env, misha: dict[str, str]) -> None:
    boss = acc.login("boss", acc.add_user("boss", role="admin"))
    pid, created = create(acc, misha, {"a.v": "1", "b.v": "1"})
    sync(acc, misha, pid, created["rev"], [change("b.v", None, 2)])
    young, _ = create(acc, misha)
    acc.client.delete(f"/v1/projects/{pid}", headers=misha)
    acc.clock.advance(10 * DAY_MS)
    acc.client.delete(f"/v1/projects/{young}", headers=misha)
    acc.clock.advance(20 * DAY_MS)
    assert acc.service.projects.purge_trash() == 0  # exactly 30 days: not older yet
    acc.clock.advance(1)
    assert acc.service.projects.purge_trash() == 1
    # The files are erased; the deleted file record and the project row stay.
    assert file_rows(acc, pid) == {"b.v": (None, 3)}
    assert project_row(acc, pid)[3:] == (created["modified"], 1)
    assert project_row(acc, young)[4] == 0
    gone = sync(acc, misha, pid, 0, [change("a.v", "back")], META)
    assert gone["deleted"] is True
    assert file_rows(acc, pid) == {"b.v": (None, 3)}
    restore = acc.client.post(f"/v1/admin/projects/{pid}/restore", headers=boss)
    assert (restore.status_code, restore.json()["error"]["code"]) == (404, "NOT_FOUND")
    assert acc.client.get("/v1/projects", headers=misha).json()["projects"][-1]["deleted"] is True


def test_backup_created_rotated_and_readable(acc: Env, misha: dict[str, str]) -> None:
    create(acc, misha)
    folder = acc.settings.data_dir / "backup"
    first = acc.service.projects.backup(folder)
    assert first is not None and first.name == "accounts-20261118.db"  # the day of the test clock, UTC
    assert acc.service.projects.backup(folder) is None  # a backup for this day already exists
    names = [first.name]
    for _ in range(14):
        acc.clock.advance(DAY_MS)
        made = acc.service.projects.backup(folder)
        assert made is not None
        names.append(made.name)
    kept = sorted(p.name for p in folder.glob("accounts-*.db"))
    assert len(kept) == 14 and names[0] not in kept and kept == sorted(names[1:])
    assert not list(folder.glob(".*partial"))
    newest = folder / names[-1]
    assert oct(newest.stat().st_mode & 0o777) == "0o600"
    with sqlite3.connect(newest) as db:
        assert db.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        assert db.execute("SELECT login FROM users").fetchall() == [("misha",)]
        assert db.execute("SELECT count(*) FROM projects").fetchone()[0] == 1


def test_admin_reads_user_project_and_user_is_forbidden(acc: Env, misha: dict[str, str]) -> None:
    boss = acc.login("boss", acc.add_user("boss", role="admin"))
    pid, created = create(acc, misha, {"top.v": "module top; endmodule\n", "old.v": "x"})
    sync(acc, misha, pid, created["rev"], [change("old.v", None, 2)])
    trashed, _ = create(acc, misha)
    acc.client.delete(f"/v1/projects/{trashed}", headers=misha)

    listed = acc.client.get("/v1/admin/users/misha/projects", headers=boss)
    assert listed.status_code == 200
    body = listed.json()
    assert body["generation"] == acc.service.accounts.generation()
    by_id = {p["id"]: p for p in body["projects"]}
    assert by_id[trashed]["deleted"] is True and by_id[trashed]["deletedAt"] == acc.clock.now
    assert by_id[pid]["deleted"] is False and "deletedAt" not in by_id[pid]
    project = plain(acc.client.get(f"/v1/admin/projects/{pid}", headers=boss).json())
    assert project == {
        "id": pid, "login": "misha", "name": "blink3", "board": "tang-nano-20k", "rev": 3,
        "modified": acc.clock.now, "files": [{"path": "top.v", "content": "module top; endmodule\n"}],
    }  # fmt: skip
    assert acc.client.get("/v1/admin/users/nobody/projects", headers=boss).status_code == 404
    assert acc.client.get(f"/v1/admin/projects/{new_id()}", headers=boss).status_code == 404

    for headers in (misha, acc.auth):
        for method, url in (
            ("GET", "/v1/admin/users/misha/projects"),
            ("GET", f"/v1/admin/projects/{pid}"),
            ("POST", f"/v1/admin/projects/{trashed}/restore"),
        ):
            response = acc.client.request(method, url, headers=headers)
            assert (response.status_code, response.json()["error"]["code"]) == (403, "FORBIDDEN"), (method, url)
    assert project_row(acc, trashed)[3] is not None  # restore by the user did not pass


def test_failure_mid_sync_leaves_no_partial_changes(
    acc: Env, misha: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    pid, created = create(acc, misha, {"a.v": "1", "b.v": "1"})
    before_files, before_project = file_rows(acc, pid), project_row(acc, pid)
    real = projects.write_file
    calls = []

    def failing(*args: Any) -> None:  # noqa: ANN401
        calls.append(args[2])
        if len(calls) == 2:
            raise RuntimeError("сбой посреди sync")
        real(*args)

    monkeypatch.setattr(projects, "write_file", failing)
    response = sync_response(
        acc,
        misha,
        pid,
        {
            "since": created["rev"],
            "meta": {"name": "renamed", "board": "tang-nano-20k"},
            "changes": [change("a.v", "2", 1), change("b.v", "2", 2), change("c.v", "new")],
        },
    )
    assert calls == ["a.v", "b.v"]  # the first change was written before the failure
    assert (response.status_code, response.json()["error"]["code"]) == (500, "INTERNAL")
    assert file_rows(acc, pid) == before_files and project_row(acc, pid) == before_project
    # A new project does not remain on a failure either.
    calls.clear()
    other = new_id()
    response = sync_response(
        acc, misha, other, {"since": 0, "meta": META, "changes": [change("a", "1"), change("b", "1")]}
    )
    assert response.status_code == 500 and project_row(acc, other) is None
    monkeypatch.undo()
    assert sync(acc, misha, pid, created["rev"], [change("a.v", "2", 1)])["applied"] == [{"path": "a.v", "rev": 3}]


# --- Deleted file records do not grow without limit ------------------------------------


@pytest.mark.parametrize("base_rev", [0, 5])
def test_deleting_unknown_path_creates_no_record(acc: Env, misha: dict[str, str], base_rev: int) -> None:
    pid, created = create(acc, misha, {"a.v": "1"})
    body = sync(acc, misha, pid, created["rev"], [change("ghost.v", None, base_rev)])
    assert body["applied"] == [{"path": "ghost.v", "rev": 0}] and body["conflicts"] == []
    assert body["rev"] == created["rev"] and body["remote"] == []
    assert file_rows(acc, pid) == {"a.v": ("1", 1)}
    assert project_row(acc, pid)[2] == created["rev"]
    # Deleting an already deleted file: applied with the current revision, the record does not change.
    gone = sync(acc, misha, pid, created["rev"], [change("a.v", None, 1)])
    again = sync(acc, misha, pid, gone["rev"], [change("a.v", None, 0)])
    assert again["applied"] == [{"path": "a.v", "rev": gone["rev"]}] and again["rev"] == gone["rev"]
    assert file_rows(acc, pid) == {"a.v": (None, gone["rev"])}


def test_file_records_including_deleted_are_limited(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(max_file_rows=4)
    headers = env.login("misha", env.add_user("misha"))
    pid, created = create(env, headers, {"a.v": "1", "b.v": "1"})
    rev = sync(env, headers, pid, created["rev"], [change("a.v", None, 1), change("b.v", None, 2)])["rev"]
    rev = sync(env, headers, pid, rev, [change("c.v", "1"), change("d.v", "1")])["rev"]
    before_files, before_project = file_rows(env, pid), project_row(env, pid)
    assert len(before_files) == 4  # two live records and two records of deleted files
    response = sync_response(env, headers, pid, {"since": rev, "changes": [change("c.v", None, 3), change("e.v", "1")]})
    assert (response.status_code, response.json()["error"]["code"]) == (413, "PROJECT_TOO_LARGE")
    assert "записей файлов" in response.json()["error"]["text"]
    assert file_rows(env, pid) == before_files and project_row(env, pid) == before_project
    # Editing existing paths does not touch the limit.
    assert sync(env, headers, pid, rev, [change("a.v", "back", 0)])["applied"][0]["path"] == "a.v"
    assert env.client.get("/v1/info", headers=headers).json()["limits"]["max_file_rows"] == 4


# --- Other requirements ----------------------------------------------------


def test_remote_skips_applied_and_conflicts(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha, {"a.v": "1", "b.v": "1", "c.v": "1"})
    sync(acc, misha, pid, created["rev"], [change("a.v", "x", 1), change("b.v", "x", 2), change("c.v", "x", 3)])
    # A client with since = 0: a.v matches, b.v conflicts, c.v was not sent.
    body = sync(acc, misha, pid, 0, [change("a.v", "x", 1), change("b.v", "y", 2)])
    assert body["applied"] == [{"path": "a.v", "rev": 4}]
    assert body["conflicts"] == [{"path": "b.v", "rev": 5, "content": "x"}]
    assert body["remote"] == [{"path": "c.v", "rev": 6, "content": "x"}]


@pytest.mark.parametrize(
    ("pid", "body"),
    [
        ("not-a-uuid", {"since": 0, "changes": []}),
        (None, {"since": 0, "changes": [change("../x.v", "x")]}),
        (None, {"since": 0, "changes": [change("a.v", "1"), change("a.v", "2")]}),
        (None, {"since": -1, "changes": []}),
        (None, {"since": 0, "changes": [{"path": "a.v", "baseRev": 0}]}),  # content is required
        (None, {"since": 0, "meta": {"name": "", "board": "tang-nano-20k"}, "changes": []}),
    ],
)
def test_bad_sync_requests_give_400(acc: Env, misha: dict[str, str], pid: str | None, body: dict[str, Any]) -> None:
    response = sync_response(acc, misha, pid or new_id(), body)
    assert (response.status_code, response.json()["error"]["code"]) == (400, "BAD_REQUEST")


def test_sync_rate_limited_separately(make_env: Any) -> None:  # noqa: ANN401
    env = make_env(sync_requests_per_minute=3, account_requests_per_minute=100)
    headers = env.login("misha", env.add_user("misha"))
    pid, _ = create(env, headers)  # the first request
    statuses = [sync_response(env, headers, pid, {"since": 0, "changes": []}).status_code for _ in range(3)]
    assert statuses == [200, 200, 429]
    assert env.client.get("/v1/projects", headers=headers).status_code == 200
    assert env.settings.limits.sync_requests_per_minute == 3
    info = env.client.get("/v1/info", headers=headers).json()
    assert info["limits"]["max_projects"] == 100 and info["limits"]["sync_requests_per_minute"] == 3


def test_build_and_testbench_from_session_update_last_build(acc: Env, misha: dict[str, str]) -> None:
    assert acc.service.accounts.user("misha")["lastBuild"] is None
    response = acc.client.post("/v1/build", json={"files": [], "config": None}, headers=misha)
    assert response.status_code == 200
    assert acc.service.accounts.user("misha")["lastBuild"] == acc.clock.now
    acc.clock.advance(5000)
    acc.client.post("/v1/testbench", json={"files": [], "testbench": "tb.v"}, headers=misha)
    assert acc.service.accounts.user("misha")["lastBuild"] == acc.clock.now
    # check does not count as a build; it does not touch the account key.
    acc.clock.advance(5000)
    acc.client.post("/v1/check", json={"files": [], "config": None}, headers=misha)
    acc.client.post("/v1/build", json={"files": [], "config": None}, headers=acc.auth)
    assert acc.service.accounts.user("misha")["lastBuild"] == acc.clock.now - 5000


def test_log_has_project_ops_without_content(acc: Env, misha: dict[str, str]) -> None:
    secret = "module secret_content_marker; endmodule"
    pid, _ = create(acc, misha, {"top.v": secret})
    acc.client.get("/v1/projects", headers=misha)
    acc.client.delete(f"/v1/projects/{pid}", headers=misha)
    records = acc.log[-3:]
    assert [(r["op"], r["auth"], r["owner"], r["result"]) for r in records] == [
        ("sync", "session", "misha", "ok"),
        ("projects", "session", "misha", "ok"),
        ("project-delete", "session", "misha", "ok"),
    ]
    assert records[0]["projectBytes"] == len(secret.encode()) and records[0]["project"] == pid
    assert "secret_content_marker" not in json.dumps(acc.log, ensure_ascii=False)
    token = misha["Authorization"].split()[1]
    assert token not in json.dumps(acc.log)


def test_maintenance_runs_daily_and_survives_failure(acc: Env, misha: dict[str, str]) -> None:
    service = acc.service
    pid, _ = create(acc, misha)
    acc.client.delete(f"/v1/projects/{pid}", headers=misha)
    records = service.maintenance()
    assert [(r["op"], r["result"]) for r in records] == [("backup", "ok")]  # the trash is empty
    assert service.maintenance() == []  # the same day: the backup exists, the cleanup ran
    acc.clock.advance(31 * DAY_MS)
    records = service.maintenance()
    assert [(r["op"], r.get("purged"), r["result"]) for r in records] == [
        ("trash-purge", 1, "ok"),
        ("backup", None, "ok"),
    ]

    def broken() -> int:
        raise sqlite3.OperationalError("disk I/O error")

    service.projects.purge_trash = broken
    acc.clock.advance(DAY_MS)
    records = service.maintenance()
    # A cleanup failure goes to the log and does not stop the backup; the cleanup repeats at the next check.
    assert [(r["op"], r["result"]) for r in records] == [("trash-purge", "INTERNAL"), ("backup", "ok")]
    assert "disk I/O error" in records[0]["error"]
    assert [r["op"] for r in service.maintenance()] == ["trash-purge"]


def test_service_start_makes_first_backup(acc: Env) -> None:
    """The first backup is made at service start if there is no backup for the current day."""
    folder = acc.settings.data_dir / "backup"
    with TestClient(acc.app) as client:
        assert client.get("/v1/health").status_code == 200
        for _ in range(100):
            if list(folder.glob("accounts-*.db")):
                break
            time.sleep(0.05)
    assert [p.name for p in folder.glob("accounts-*.db")] == ["accounts-20261118.db"]
    assert any(r.get("op") == "backup" and r["result"] == "ok" for r in acc.log)


def password_of(env: Env, login: str) -> str:
    """A new account password directly in the database: a password known to the test for the second login."""
    password = "restored-pass"
    env.service.accounts.set_password(login, hash_password(password))
    return password


def test_stale_generation_applies_nothing(acc: Env, misha: dict[str, str], tmp_path: Any) -> None:  # noqa: ANN401
    """After db restore an edit with a revision of the previous generation does not overwrite a new edit."""
    store = acc.service.accounts
    pid, created = create(acc, misha, {"a.v": "X"})
    old_generation = created["generation"]
    backup = tmp_path / "copy.db"
    with sqlite3.connect(store.path) as src, sqlite3.connect(backup) as dst:
        src.backup(dst)
    assert sync(acc, misha, pid, 1, [change("a.v", "Y-old", 1)])["rev"] == 2  # client A, before the restore
    assert admin.main(["--db", str(store.path), "db", "restore", str(backup)]) == 0
    headers = acc.login("misha", password_of(acc, "misha"))
    assert sync(acc, headers, pid, 1, [change("a.v", "Q-new", 1)])["rev"] == 2  # client C, the new generation
    # Client A sends an edit with revision 2 of the previous generation: the number matches, but the generation differs.
    body = {"since": 2, "generation": old_generation, "changes": [change("a.v", "A-edit", 2)]}
    response = sync_response(acc, headers, pid, body)
    assert response.status_code == 200
    assert plain(response.json()) == {"stale": True, "generation": store.generation()}
    assert file_rows(acc, pid)["a.v"] == ("Q-new", 2)
    # A project that is absent from the database is not created by a request of the previous generation.
    fresh = new_id()
    stale = sync_response(acc, headers, fresh, {"since": 0, "generation": old_generation, "meta": META, "changes": []})
    assert plain(stale.json())["stale"] is True
    assert project_row(acc, fresh) is None


def test_revisions_require_generation(acc: Env, misha: dict[str, str]) -> None:
    pid, created = create(acc, misha)
    for body in (
        {"since": created["rev"], "generation": None, "changes": []},
        {"since": 0, "generation": None, "changes": [change("top.v", "x", 1)]},
    ):
        assert sync_response(acc, misha, pid, body).status_code == 400
    # The first device request carries no revisions and does not know the generation.
    assert sync_response(acc, misha, pid, {"since": 0, "generation": None, "changes": []}).status_code == 200


def test_sync_request_bounds(acc: Env, misha: dict[str, str]) -> None:
    pid, _ = create(acc, misha)
    too_big = sync_response(acc, misha, pid, {"since": 2**63, "changes": []})
    assert (too_big.status_code, too_big.json()["error"]["code"]) == (400, "BAD_REQUEST")
    many = [change(f"f{i}.v", None) for i in range(1001)]
    assert sync_response(acc, misha, pid, {"since": 0, "changes": many}).status_code == 400


def test_trash_is_limited(make_env: Any) -> None:  # noqa: ANN401
    """The account trash is limited: past the limit the files of the projects deleted earliest are erased."""
    env = make_env(max_trashed_projects=2, max_project_rows=4)
    env.clock = Clock()
    env.service.accounts.clock = env.clock
    headers = env.login("misha", env.add_user("misha"))
    ids = []
    for _ in range(3):
        pid, _ = create(env, headers)
        assert env.client.delete(f"/v1/projects/{pid}", headers=headers).status_code == 200
        env.clock.advance(1000)
        ids.append(pid)
    with sqlite3.connect(env.service.accounts.path) as db:
        purged = dict(db.execute("SELECT id, purged FROM projects"))
        files = {pid: db.execute("SELECT count(*) FROM files WHERE project = ?", (pid,)).fetchone()[0] for pid in ids}
    assert [purged[pid] for pid in ids] == [1, 0, 0]
    assert [files[pid] for pid in ids] == [0, 1, 1]
    # Project rows of an account: at most the limit, including erased ones.
    create(env, headers)
    over = sync_response(env, headers, new_id(), {"since": 0, "meta": META, "changes": []})
    assert (over.status_code, over.json()["error"]["code"]) == (413, "PROJECT_TOO_LARGE")
