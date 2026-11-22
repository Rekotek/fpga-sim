"""Projects on the server (docs/tz-accounts.md, sections 2.5, 2.6, 3.2, 3.3): sync, trash, backups.

The projects and files tables are created by the accounts.py schema. Each operation uses its own connection
(decision 124); sync runs in one BEGIN IMMEDIATE transaction: the revision check,
the write and the limit check are not interleaved with other requests, and a refusal rolls everything back.
"""

from __future__ import annotations

import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .accounts import DAY_MS, AccountsError, AccountStore, transaction
from .config import Limits

# The browser issues the project id (crypto.randomUUID): a UUID in canonical form.
PROJECT_ID_RE = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
MAX_PROJECT_NAME = 128
BOARD_RE = re.compile(r"[A-Za-z0-9_.-]{1,64}")
BACKUP_RE = re.compile(r"accounts-(\d{8})\.db")


def check_project_id(project_id: str) -> str:
    if not PROJECT_ID_RE.fullmatch(project_id):
        raise AccountsError(400, "BAD_REQUEST", "Идентификатор проекта — не UUID")
    return project_id


def check_meta(name: str, board: str) -> tuple[str, str]:
    if not 1 <= len(name) <= MAX_PROJECT_NAME or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise AccountsError(400, "BAD_REQUEST", f"Имя проекта: от 1 до {MAX_PROJECT_NAME} знаков")
    if not BOARD_RE.fullmatch(board):
        raise AccountsError(400, "BAD_REQUEST", "Плата: от 1 до 64 знаков, латиница, цифры, _ . -")
    return name, board


@dataclass(frozen=True)
class Change:
    path: str
    content: str | None
    base_rev: int


def write_file(conn: sqlite3.Connection, project: str, path: str, content: str | None, rev: int, now: int) -> None:
    """Write of one project file. A separate function: a test replaces it to cause a failure in the middle of sync."""
    conn.execute(
        "INSERT INTO files (project, path, content, rev, modified) VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT (project, path) DO UPDATE SET content = excluded.content, rev = excluded.rev, "
        "modified = excluded.modified",
        (project, path, content, rev, now),
    )


def project_view(row: sqlite3.Row) -> dict[str, Any]:
    """A row of the project list (section 3.2)."""
    return {
        "id": row["id"],
        "name": row["name"],
        "board": row["board"],
        "rev": row["rev"],
        "modified": row["modified"],
        "deleted": row["deleted_at"] is not None or bool(row["purged"]),
    }


def generation(conn: sqlite3.Connection) -> str:
    return conn.execute("SELECT value FROM meta WHERE key = 'generation'").fetchone()[0]


class ProjectStore:
    """Projects of accounts in the account database. Time is the AccountStore clock (tests replace it)."""

    def __init__(self, accounts: AccountStore, limits: Limits) -> None:
        self.accounts = accounts
        self.limits = limits

    def now(self) -> int:
        return self.accounts.clock()

    # --- Section 3.2 -----------------------------------------------------------------

    def of_user(self, login: str, admin: bool = False) -> dict[str, Any]:
        """Projects of an account, including the trash and erased ones.
        admin is the section 3.5 view with deletedAt and purged.
        """
        with self.accounts.db() as conn:
            rows = conn.execute(
                "SELECT * FROM projects WHERE login = ? ORDER BY modified DESC, id", (login,)
            ).fetchall()
            projects = []
            for row in rows:
                view = project_view(row)
                if admin:
                    if row["deleted_at"] is not None:
                        view["deletedAt"] = row["deleted_at"]
                    view["purged"] = bool(row["purged"])
                projects.append(view)
            return {"generation": generation(conn), "projects": projects}

    # --- Section 3.3 -----------------------------------------------------------------

    def sync(
        self,
        login: str,
        project_id: str,
        since: int,
        meta: tuple[str, str] | None,
        changes: list[Change],
        client_generation: str | None = None,
    ) -> dict[str, Any]:
        """Project sync: the order of section 3.3, one transaction.

        client_generation is the database generation in which the browser got its revisions. A different generation
        (the database was restored from a backup): nothing is applied, the answer is stale. Otherwise
        an edit with an old
        revision would match a new one by number and overwrite it without a conflict.
        """
        check_project_id(project_id)
        if meta is not None:
            meta = check_meta(*meta)
        now = self.now()
        with self.accounts.db() as conn, transaction(conn):
            gen = generation(conn)
            # Step 1. A foreign project and a nonexistent one get the same answer.
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if row is not None and row["login"] != login:
                raise AccountsError(404, "NOT_FOUND", "Проекта нет")
            if client_generation is not None and client_generation != gen:
                return {"stale": True, "generation": gen}
            if row is None:
                if meta is None:
                    raise AccountsError(404, "NOT_FOUND", "Проекта нет")
                self._check_project_count(conn, login, adding=1)
                conn.execute(
                    "INSERT INTO projects (id, login, name, board, rev, modified) VALUES (?, ?, ?, ?, 0, ?)",
                    (project_id, login, meta[0], meta[1], now),
                )
                row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            # Step 2. Trash and an erased project: nothing is applied.
            if row["deleted_at"] is not None or row["purged"]:
                return {"deleted": True, "rev": row["rev"], "generation": gen}
            rev = row["rev"]
            name, board, modified = row["name"], row["board"], row["modified"]
            # Step 3. Name and board.
            if meta is not None and meta != (name, board):
                name, board = meta
                rev += 1
                modified = now
            # Step 4. File changes.
            applied: list[dict[str, Any]] = []
            conflicts: list[dict[str, Any]] = []
            for change in changes:
                current = conn.execute(
                    "SELECT content, rev FROM files WHERE project = ? AND path = ?", (project_id, change.path)
                ).fetchone()
                current_rev = current["rev"] if current is not None else 0
                current_content = current["content"] if current is not None else None
                deleted_on_server = current is not None and current_content is None
                if change.content is None and current_content is None:
                    # Deleting a path the server does not have (rev 0) or one already deleted (its revision):
                    # the record is neither changed nor created, the project revision does not grow. Otherwise creating
                    # and deleting paths would grow the files table without end.
                    applied.append({"path": change.path, "rev": current_rev})
                elif current_rev == change.base_rev or (change.base_rev == 0 and deleted_on_server):
                    rev += 1
                    modified = now
                    write_file(conn, project_id, change.path, change.content, rev, now)
                    applied.append({"path": change.path, "rev": rev})
                elif current_content == change.content:
                    applied.append({"path": change.path, "rev": current_rev})
                else:
                    conflicts.append({"path": change.path, "rev": current_rev, "content": current_content})
            conn.execute(
                "UPDATE projects SET name = ?, board = ?, rev = ?, modified = ? WHERE id = ?",
                (name, board, rev, modified, project_id),
            )
            # Step 5. Limits: a violation rolls back the whole request.
            self._check_size(conn, project_id)
            # Step 6. Server changes the browser has not received yet.
            answered = {c["path"] for c in applied} | {c["path"] for c in conflicts}
            remote = [
                {"path": r["path"], "rev": r["rev"], "content": r["content"]}
                for r in conn.execute(
                    "SELECT path, rev, content FROM files WHERE project = ? AND rev > ? ORDER BY path",
                    (project_id, since),
                )
                if r["path"] not in answered
            ]
            return {
                "deleted": False,
                "generation": gen,
                "rev": rev,
                "name": name,
                "board": board,
                "modified": modified,
                "applied": applied,
                "conflicts": conflicts,
                "remote": remote,
            }

    def _check_project_count(self, conn: sqlite3.Connection, login: str, adding: int) -> None:
        count, rows = conn.execute(
            "SELECT coalesce(sum(deleted_at IS NULL), 0), count(*) FROM projects WHERE login = ?", (login,)
        ).fetchone()
        if count + adding > self.limits.max_projects:
            raise AccountsError(
                413, "PROJECT_TOO_LARGE", f"Проектов на сервере больше {self.limits.max_projects}: удалите ненужные"
            )
        # Rows of deleted projects stay forever: their number is limited too.
        if rows + adding > self.limits.max_project_rows:
            raise AccountsError(
                413,
                "PROJECT_TOO_LARGE",
                f"У записи больше {self.limits.max_project_rows} проектов, включая удалённые",
            )

    def _check_size(self, conn: sqlite3.Connection, project_id: str) -> None:
        """The section 3.6 limits on a project after changes: file records, file count, sizes."""
        limits = self.limits
        rows = conn.execute("SELECT count(*) FROM files WHERE project = ?", (project_id,)).fetchone()[0]
        if rows > limits.max_file_rows:
            raise AccountsError(
                413,
                "PROJECT_TOO_LARGE",
                f"В проекте больше {limits.max_file_rows} записей файлов, включая удалённые: создайте новый проект",
            )
        count, total, largest = conn.execute(
            "SELECT count(*), coalesce(sum(length(CAST(content AS BLOB))), 0), "
            "coalesce(max(length(CAST(content AS BLOB))), 0) FROM files WHERE project = ? AND content IS NOT NULL",
            (project_id,),
        ).fetchone()
        if count > limits.max_files:
            raise AccountsError(413, "PROJECT_TOO_LARGE", f"В проекте больше {limits.max_files} файлов")
        if largest > limits.max_file_bytes:
            path = conn.execute(
                "SELECT path FROM files WHERE project = ? AND length(CAST(content AS BLOB)) > ? ORDER BY path LIMIT 1",
                (project_id, limits.max_file_bytes),
            ).fetchone()[0]
            raise AccountsError(413, "PROJECT_TOO_LARGE", f"Файл {path} больше {limits.max_file_bytes // 1024} КБ")
        if total > limits.max_project_bytes:
            raise AccountsError(
                413, "PROJECT_TOO_LARGE", f"Проект больше {limits.max_project_bytes // (1024 * 1024)} МБ"
            )

    def delete(self, login: str, project_id: str) -> None:
        """A project to the trash; a repeated request answers the same and does not shift the trash retention."""
        check_project_id(project_id)
        with self.accounts.db() as conn, transaction(conn):
            row = conn.execute("SELECT login FROM projects WHERE id = ?", (project_id,)).fetchone()
            if row is None or row["login"] != login:
                raise AccountsError(404, "NOT_FOUND", "Проекта нет")
            conn.execute(
                "UPDATE projects SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL", (self.now(), project_id)
            )
            # The account trash is limited: past the limit the files of the projects deleted earliest are erased.
            extra = conn.execute(
                "SELECT id FROM projects WHERE login = ? AND deleted_at IS NOT NULL AND purged = 0 "
                "ORDER BY deleted_at DESC, id LIMIT -1 OFFSET ?",
                (login, self.limits.max_trashed_projects),
            ).fetchall()
            for old in extra:
                self._purge(conn, old["id"])

    # --- Section 3.5 -----------------------------------------------------------------

    def read(self, project_id: str) -> dict[str, Any]:
        """A project of any account for an administrator, without deleted files."""
        check_project_id(project_id)
        with self.accounts.db() as conn:
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if row is None:
                raise AccountsError(404, "NOT_FOUND", "Проекта нет")
            files = [
                {"path": f["path"], "content": f["content"]}
                for f in conn.execute(
                    "SELECT path, content FROM files WHERE project = ? AND content IS NOT NULL ORDER BY path",
                    (project_id,),
                )
            ]
            return {
                "id": row["id"],
                "login": row["login"],
                "name": row["name"],
                "board": row["board"],
                "rev": row["rev"],
                "modified": row["modified"],
                "files": files,
            }

    def restore(self, project_id: str) -> None:
        """Restore from the trash: deleted_at is cleared, the revision grows by 1. An erased project gives 404."""
        check_project_id(project_id)
        with self.accounts.db() as conn, transaction(conn):
            row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
            if row is None or row["purged"]:
                raise AccountsError(404, "NOT_FOUND", "Проекта нет или срок корзины вышел")
            if row["deleted_at"] is None:
                return
            self._check_project_count(conn, row["login"], adding=1)
            conn.execute(
                "UPDATE projects SET deleted_at = NULL, rev = rev + 1, modified = ? WHERE id = ?",
                (self.now(), project_id),
            )

    # --- Section 2.6: trash cleanup --------------------------------------------------

    def purge_trash(self) -> int:
        """Erases files of projects that stayed in the trash past the retention; returns the project count.

        The project row stays forever (purged = 1); the records of deleted files (content IS NULL)
        stay too: a device that was offline for long learns about the deletion from them.
        """
        cutoff = self.now() - self.limits.trash_days * DAY_MS
        with self.accounts.db() as conn, transaction(conn):
            ids = [
                r["id"]
                for r in conn.execute(
                    "SELECT id FROM projects WHERE purged = 0 AND deleted_at IS NOT NULL AND deleted_at < ?", (cutoff,)
                )
            ]
            for project_id in ids:
                self._purge(conn, project_id)
            return len(ids)

    @staticmethod
    def _purge(conn: sqlite3.Connection, project_id: str) -> None:
        conn.execute("DELETE FROM files WHERE project = ? AND content IS NOT NULL", (project_id,))
        conn.execute("UPDATE projects SET purged = 1 WHERE id = ?", (project_id,))

    # --- Section 2.5: database backups -----------------------------------------------

    def backup(self, folder: Path) -> Path | None:
        """A backup of the database for the current day (UTC) if there is none yet; the last backups_kept are kept.

        Returns the path of the new backup; None means a backup for that day already exists.
        The backup is written to a temporary
        file and renamed: an incomplete backup does not count as the day's backup.
        """
        day = datetime.fromtimestamp(self.now() / 1000, UTC).strftime("%Y%m%d")
        folder.mkdir(mode=0o700, parents=True, exist_ok=True)
        target = folder / f"accounts-{day}.db"
        made: Path | None = None
        if not target.exists():
            partial = folder / f".accounts-{day}.db.partial"
            partial.unlink(missing_ok=True)
            try:
                with self.accounts.db() as src:
                    dst = sqlite3.connect(partial)
                    try:
                        src.backup(dst)
                    finally:
                        dst.close()
                os.chmod(partial, 0o600)  # the backup holds password hashes
                partial.replace(target)
            except BaseException:
                partial.unlink(missing_ok=True)
                raise
            made = target
        copies = sorted(p for p in folder.iterdir() if BACKUP_RE.fullmatch(p.name))
        for old in copies[: max(0, len(copies) - self.limits.backups_kept)]:
            old.unlink(missing_ok=True)
        return made
