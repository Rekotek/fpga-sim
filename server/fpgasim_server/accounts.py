"""Accounts and sessions (accounts spec sections 2.1–2.3, docs/tz-accounts.md).

SQLite database: accounts, sessions, projects and files (the project operations are in projects.py),
the database generation. The password is stored as a scrypt hash, the session token as its own SHA-256: neither
the password nor the token is in the database in plain text.

Each operation opens its own connection: the service and fpgasim-admin write to one database,
and replacing the database with a backup (db restore) takes effect at the next operation without reopening connections.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import secrets
import shutil
import sqlite3
import time
from collections import deque
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE users (
  login       TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,
  password    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  created     INTEGER NOT NULL,
  last_login  INTEGER,
  last_build  INTEGER
);
CREATE TABLE sessions (
  token_sha256 TEXT PRIMARY KEY,
  login        TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
  created      INTEGER NOT NULL,
  last_used    INTEGER NOT NULL
);
CREATE INDEX sessions_login ON sessions(login);
CREATE TABLE projects (
  id         TEXT PRIMARY KEY,
  login      TEXT NOT NULL REFERENCES users(login) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  board      TEXT NOT NULL,
  rev        INTEGER NOT NULL,
  modified   INTEGER NOT NULL,
  deleted_at INTEGER,
  purged     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX projects_login ON projects(login);
CREATE TABLE files (
  project  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path     TEXT NOT NULL,
  content  TEXT,
  rev      INTEGER NOT NULL,
  modified INTEGER NOT NULL,
  PRIMARY KEY (project, path)
);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""

# Tables and columns of the schema: db restore uses them to recognise a database of this schema.
TABLES = {
    "users": ["login", "name", "role", "password", "enabled", "created", "last_login", "last_build"],
    "sessions": ["token_sha256", "login", "created", "last_used"],
    "projects": ["id", "login", "name", "board", "rev", "modified", "deleted_at", "purged"],
    "files": ["project", "path", "content", "rev", "modified"],
    "meta": ["key", "value"],
}

LOGIN_RE = re.compile(r"[a-z0-9_-]{1,32}")
ROLES = ("admin", "user")
MIN_PASSWORD = 8
MAX_PASSWORD = 128
MAX_NAME = 64

SCRYPT_N = 2**15
SCRYPT_R = 8
SCRYPT_P = 1
SCRYPT_MAXMEM = 128 * 1024 * 1024
PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
LAST_USED_STEP_MS = 60_000  # a session's last_used is updated at most once a minute

DAY_MS = 24 * 3600 * 1000


class AccountsError(Exception):
    """Operation refusal: the status and response code of section 3, a message for a human."""

    def __init__(self, status: int, code: str, text: str, reason: str | None = None, **values: str | int) -> None:
        super().__init__(text)
        self.status = status
        self.code = code
        self.text = text
        # The response field args (decision 183): the interface picks its string by reason and substitutes values.
        self.values: dict[str, str | int] | None = {"reason": reason, **values} if reason else None


class SchemaTooNew(Exception):  # noqa: N818 — the name states the cause, not the kind of error
    """The database was created by a newer service version: it must not be opened."""


def now_ms() -> int:
    return int(time.time() * 1000)


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def new_token() -> str:
    """A session token is 32 random bytes in base64url, like a key."""
    return b64url(secrets.token_bytes(32))


def new_generation() -> str:
    return b64url(secrets.token_bytes(16))


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_password() -> str:
    """A server-generated password: 10 chars of the form xxxxx-xxxxx (section 2.2)."""
    chars = "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(10))
    return f"{chars[:5]}-{chars[5:]}"


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(
        password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, maxmem=SCRYPT_MAXMEM, dklen=32
    )
    salt64 = base64.b64encode(salt).decode("ascii")
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${salt64}${base64.b64encode(digest).decode('ascii')}"


def verify_password(password: str, stored: str) -> bool:
    """Compare with a hash from the database. A corrupt hash string is a refusal, not an exception."""
    try:
        kind, n, r, p, salt64, hash64 = stored.split("$")
        if kind != "scrypt":
            return False
        expected = base64.b64decode(hash64)
        digest = hashlib.scrypt(
            password.encode("utf-8"),
            salt=base64.b64decode(salt64),
            n=int(n),
            r=int(r),
            p=int(p),
            maxmem=SCRYPT_MAXMEM,
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest, expected)


_dummy_hash: str | None = None


def dummy_hash() -> str:
    """A hash for an unknown login: the response time does not reveal whether the login exists."""
    global _dummy_hash
    if _dummy_hash is None:
        _dummy_hash = hash_password(secrets.token_urlsafe(16))
    return _dummy_hash


def verify_login(password: str, stored: str | None) -> bool:
    """Password check at login; stored = None means no such login.

    A hash is computed for an unknown login too: the response time does not reveal whether the login exists.
    Called outside the event loop: the placeholder hash is computed here on the first call.
    """
    ok = verify_password(password, stored if stored is not None else dummy_hash())
    return ok and stored is not None


def check_login(login: str) -> str:
    if not isinstance(login, str) or not LOGIN_RE.fullmatch(login):
        raise AccountsError(400, "BAD_REQUEST", "Логин: от 1 до 32 знаков, строчная латиница, цифры, _ и -", "loginInvalid")
    return login


def check_name(name: str) -> str:
    name = name.strip() if isinstance(name, str) else ""
    if not 1 <= len(name) <= MAX_NAME or any(ord(c) < 32 or ord(c) == 127 for c in name):
        raise AccountsError(400, "BAD_REQUEST", f"Имя: от 1 до {MAX_NAME} знаков", "nameInvalid", max=MAX_NAME)
    return name


def check_role(role: str) -> str:
    if role not in ROLES:
        raise AccountsError(400, "BAD_REQUEST", "Роль: admin или user", "roleInvalid")
    return role


def check_password(password: str) -> str:
    if not isinstance(password, str) or not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        raise AccountsError(400, "BAD_REQUEST", f"Пароль: от {MIN_PASSWORD} до {MAX_PASSWORD} знаков", "passwordInvalid", min=MIN_PASSWORD, max=MAX_PASSWORD)
    return password


@dataclass(frozen=True)
class Session:
    login: str
    token_sha256: str


def user_view(row: sqlite3.Row) -> dict[str, Any]:
    """Account shape in responses (section 3). There is never a password field."""
    return {
        "login": row["login"],
        "name": row["name"],
        "role": row["role"],
        "enabled": bool(row["enabled"]),
        "created": row["created"],
        "lastLogin": row["last_login"],
        "lastBuild": row["last_build"],
        "projects": row["projects"],
    }


USER_SELECT = """
SELECT u.*, (SELECT count(*) FROM projects p WHERE p.login = u.login AND p.deleted_at IS NULL) AS projects
FROM users u
"""


def connect(path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(path, timeout=10, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """A transaction that takes the write lock at the first step: check and change are not separated."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def schema_problem(conn: sqlite3.Connection) -> str | None:
    """The reason the database is not of this schema; None means the schema matches."""
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version != SCHEMA_VERSION:
        return f"номер схемы {version}, а сервис знает {SCHEMA_VERSION}"
    for table, columns in TABLES.items():
        found = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
        if found != columns:
            return f"таблица {table}: столбцы {found}, ожидались {columns}"
    row = conn.execute("SELECT value FROM meta WHERE key = 'generation'").fetchone()
    if row is None:
        return "в таблице meta нет поколения базы"
    return None


class LoginGuard:
    """Failed-login counters in process memory (section 3.1)."""

    def __init__(self, clock: Callable[[], int], per_login: int, per_address: int, window_ms: int) -> None:
        self.clock = clock
        self.per_login = per_login
        self.per_address = per_address
        self.window_ms = window_ms
        self._failures: dict[str, deque[int]] = {}

    def _recent(self, key: str) -> deque[int]:
        failures = self._failures.setdefault(key, deque())
        now = self.clock()
        while failures and now - failures[0] >= self.window_ms:
            failures.popleft()
        if not failures:
            del self._failures[key]
            return deque()
        return failures

    def locked(self, login: str, address: str) -> bool:
        return (
            len(self._recent(f"login:{login}")) > self.per_login
            or len(self._recent(f"addr:{address}")) > self.per_address
        )

    def fail(self, login: str, address: str) -> None:
        now = self.clock()
        if len(self._failures) > 10_000:
            # Guessing random logins does not pile up counters: stale ones are removed.
            for key in [k for k, v in self._failures.items() if now - v[-1] >= self.window_ms]:
                del self._failures[key]
        for key in (f"login:{login}", f"addr:{address}"):
            self._failures.setdefault(key, deque()).append(now)

    def succeed(self, login: str) -> None:
        self._failures.pop(f"login:{login}", None)


class AccountStore:
    """The account database. Time is clock() in milliseconds; tests replace it."""

    def __init__(self, path: Path, session_days: int = 90, clock: Callable[[], int] = now_ms) -> None:
        self.path = path
        self.session_ms = session_days * DAY_MS
        self.clock = clock
        self._open()

    @contextmanager
    def db(self) -> Iterator[sqlite3.Connection]:
        """Own connection per operation (decision 124); projects use it too (projects.py)."""
        with self._db() as conn:
            yield conn

    @contextmanager
    def _db(self) -> Iterator[sqlite3.Connection]:
        conn = connect(self.path)
        try:
            yield conn
        finally:
            conn.close()

    def _open(self) -> None:
        """Creates the database and brings the schema to its version; does not open a newer schema."""
        # The database holds password hashes: its own folder is closed to others, and so is the database file.
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with self._db() as conn:
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise SchemaTooNew(
                    f"база {self.path} схемы {version} новее, чем знает сервис ({SCHEMA_VERSION}): "
                    "сервис не запущен, чтобы не испортить её; выложите сервис новее или восстановите копию"
                )
            conn.execute("PRAGMA journal_mode = WAL")
            if version == 0:
                # executescript ends the transaction itself, so the schema commands run one by one.
                with transaction(conn):
                    for statement in SCHEMA.split(";"):
                        if statement.strip():
                            conn.execute(statement)
                    conn.execute("INSERT INTO meta (key, value) VALUES ('generation', ?)", (new_generation(),))
                    conn.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        os.chmod(self.path, 0o600)

    # --- Reading ---------------------------------------------------------------------

    def generation(self) -> str:
        with self._db() as conn:
            return conn.execute("SELECT value FROM meta WHERE key = 'generation'").fetchone()[0]

    def user(self, login: str) -> dict[str, Any] | None:
        with self._db() as conn:
            row = conn.execute(USER_SELECT + " WHERE u.login = ?", (login,)).fetchone()
            return user_view(row) if row else None

    def users(self) -> list[dict[str, Any]]:
        with self._db() as conn:
            return [user_view(row) for row in conn.execute(USER_SELECT + " ORDER BY u.login")]

    def password_hash(self, login: str) -> tuple[str, bool] | None:
        """Password hash and the "enabled" flag; None means no such account."""
        with self._db() as conn:
            row = conn.execute("SELECT password, enabled FROM users WHERE login = ?", (login,)).fetchone()
            return (row["password"], bool(row["enabled"])) if row else None

    # --- Sessions --------------------------------------------------------------------

    def open_session(self, login: str, password_hash: str | None = None) -> str | None:
        """A new session of the account; returns the token. The login time is recorded.

        password_hash is the hash the password was checked against. The hash is computed outside the transaction,
        so the account is checked again: if it was deleted, disabled or got a new password, there is no session (None).
        is checked again: if it was deleted, disabled or got a new password, there is no session (None).
        """
        token = new_token()
        now = self.clock()
        with self._db() as conn, transaction(conn):
            row = conn.execute("SELECT password, enabled FROM users WHERE login = ?", (login,)).fetchone()
            if row is None or not row["enabled"] or (password_hash is not None and row["password"] != password_hash):
                return None
            conn.execute(
                "INSERT INTO sessions (token_sha256, login, created, last_used) VALUES (?, ?, ?, ?)",
                (hash_token(token), login, now, now),
            )
            conn.execute("UPDATE users SET last_login = ? WHERE login = ?", (now, login))
        return token

    def session(self, token: str) -> Session | None:
        """A valid session by token. An expired session is deleted."""
        digest = hash_token(token)
        now = self.clock()
        with self._db() as conn:
            row = conn.execute(
                "SELECT s.login, s.last_used, u.enabled FROM sessions s JOIN users u ON u.login = s.login "
                "WHERE s.token_sha256 = ?",
                (digest,),
            ).fetchone()
            if row is None:
                return None
            if now - row["last_used"] >= self.session_ms or not row["enabled"]:
                conn.execute("DELETE FROM sessions WHERE token_sha256 = ?", (digest,))
                return None
            if now - row["last_used"] >= LAST_USED_STEP_MS:
                conn.execute("UPDATE sessions SET last_used = ? WHERE token_sha256 = ?", (now, digest))
            return Session(row["login"], digest)

    def close_session(self, token_sha256: str) -> None:
        with self._db() as conn:
            conn.execute("DELETE FROM sessions WHERE token_sha256 = ?", (token_sha256,))

    def note_build(self, login: str) -> None:
        """Time of the account session's last build or testbench request (section 3.7)."""
        with self._db() as conn:
            conn.execute("UPDATE users SET last_build = ? WHERE login = ?", (self.clock(), login))

    # --- Account changes -------------------------------------------------------------

    def set_password(self, login: str, password_hash: str, keep_session: str | None = None) -> None:
        """A new password hash; the account's sessions are deleted, except keep_session (SHA-256 of the token)."""
        with self._db() as conn, transaction(conn):
            if conn.execute("UPDATE users SET password = ? WHERE login = ?", (password_hash, login)).rowcount == 0:
                raise AccountsError(404, "NOT_FOUND", f"Пользователя {login} нет", "userMissing", login=login)
            conn.execute("DELETE FROM sessions WHERE login = ? AND token_sha256 IS NOT ?", (login, keep_session))

    def add_user(self, login: str, name: str, role: str, password_hash: str) -> dict[str, Any]:
        check_login(login)
        name = check_name(name)
        check_role(role)
        with self._db() as conn, transaction(conn):
            if conn.execute("SELECT 1 FROM users WHERE login = ?", (login,)).fetchone():
                raise AccountsError(409, "EXISTS", f"Логин {login} уже занят", "loginTaken", login=login)
            conn.execute(
                "INSERT INTO users (login, name, role, password, enabled, created) VALUES (?, ?, ?, ?, 1, ?)",
                (login, name, role, password_hash, self.clock()),
            )
            return user_view(conn.execute(USER_SELECT + " WHERE u.login = ?", (login,)).fetchone())

    def update_user(self, actor: str | None, login: str, changes: dict[str, Any]) -> dict[str, Any]:
        """Change of name, role, "enabled" flag (section 3.4).

        actor is the login of the administrator who changes the account; None is the fpgasim-admin utility.
        Bans: disabling or demoting one's own account; disabling or demoting the last
        enabled administrator. Disabling deletes the account's sessions.
        """
        values: dict[str, Any] = {}
        if "name" in changes:
            values["name"] = check_name(changes["name"])
        if "role" in changes:
            values["role"] = check_role(changes["role"])
        if "enabled" in changes:
            if not isinstance(changes["enabled"], bool):
                raise AccountsError(400, "BAD_REQUEST", "Поле enabled: true или false", "enabledInvalid")
            values["enabled"] = 1 if changes["enabled"] else 0
        with self._db() as conn, transaction(conn):
            row = conn.execute("SELECT role, enabled FROM users WHERE login = ?", (login,)).fetchone()
            if row is None:
                raise AccountsError(404, "NOT_FOUND", f"Пользователя {login} нет", "userMissing", login=login)
            disabling = values.get("enabled") == 0 and row["enabled"]
            demoting = values.get("role") == "user" and row["role"] == "admin"
            if disabling or demoting:
                self._check_admin_kept(conn, actor, login, row, "Disable" if disabling else "Demote")
            if values:
                assignments = ", ".join(f"{column} = ?" for column in values)
                conn.execute(f"UPDATE users SET {assignments} WHERE login = ?", (*values.values(), login))
            if disabling:
                conn.execute("DELETE FROM sessions WHERE login = ?", (login,))
            return user_view(conn.execute(USER_SELECT + " WHERE u.login = ?", (login,)).fetchone())

    def delete_user(self, actor: str | None, login: str) -> None:
        """Deletes an account together with sessions and projects (foreign key cascade)."""
        with self._db() as conn, transaction(conn):
            row = conn.execute("SELECT role, enabled FROM users WHERE login = ?", (login,)).fetchone()
            if row is None:
                raise AccountsError(404, "NOT_FOUND", f"Пользователя {login} нет", "userMissing", login=login)
            self._check_admin_kept(conn, actor, login, row, "Delete")
            conn.execute("DELETE FROM users WHERE login = ?", (login,))

    @staticmethod
    def _check_admin_kept(conn: sqlite3.Connection, actor: str | None, login: str, row: sqlite3.Row, action: str) -> None:
        """action is Disable, Demote or Delete: the end of the interface reason."""
        verb = {"Disable": "отключить", "Demote": "понизить", "Delete": "удалить"}[action]
        if actor == login:
            raise AccountsError(400, "BAD_REQUEST", f"Нельзя {verb} свою учётную запись", f"self{action}")
        if row["role"] == "admin" and row["enabled"]:
            admins = conn.execute("SELECT count(*) FROM users WHERE role = 'admin' AND enabled = 1").fetchone()[0]
            if admins <= 1:
                raise AccountsError(
                    400, "BAD_REQUEST", f"Нельзя {verb} последнего включённого администратора", f"lastAdmin{action}"
                )


# --- Restore from a backup (section 3.8) ---------------------------------------


def discard(db: Path) -> None:
    for path in (db, Path(f"{db}-wal"), Path(f"{db}-shm"), Path(f"{db}-journal")):
        path.unlink(missing_ok=True)


def restore(db_path: Path, backup: Path, clock: Callable[[], int] = now_ms) -> Path | None:
    """Replaces the database with a backup and writes a new generation.

    A file that is not a database of this schema is rejected (AccountsError); the database does not change.
    The previous database stays alongside as accounts-before-restore-<time>.db (decision 123);
    its path is returned; None means there was no previous database.
    """
    if not backup.is_file():
        raise AccountsError(400, "BAD_REQUEST", f"Файла {backup} нет")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    # The backup is copied with SQLite tools (with the backup's WAL journal, if any) to a file next
    # to the database; the check and the generation change run on it. The backup file does not change.
    staged = db_path.with_name(f".{db_path.name}.restore")
    discard(staged)
    try:
        src = sqlite3.connect(backup)
        try:
            conn = sqlite3.connect(staged, isolation_level=None)
            try:
                src.backup(conn)
                problem = schema_problem(conn)
                if problem is None and conn.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                    problem = "проверка целостности не прошла"
                if problem is not None:
                    raise AccountsError(400, "BAD_REQUEST", f"{backup} — не база этой схемы: {problem}")
                conn.execute("UPDATE meta SET value = ? WHERE key = 'generation'", (new_generation(),))
                # Sessions from the backup do not return: some may have been closed after the backup
                # (logout, password change, account disable). Users log in again.
                conn.execute("DELETE FROM sessions")
                conn.execute("PRAGMA journal_mode = WAL")
            finally:
                conn.close()
        finally:
            src.close()
    except sqlite3.DatabaseError as e:
        discard(staged)
        raise AccountsError(400, "BAD_REQUEST", f"{backup} — не база SQLite: {e}") from None
    except BaseException:
        discard(staged)
        raise
    kept: Path | None = None
    if db_path.exists():
        # The previous database: the WAL journal is merged into the file so it does not overlay the backup.
        # A corrupt database
        # (the one being restored) may refuse to merge: then the journal is kept alongside as is.
        try:
            conn = sqlite3.connect(db_path, isolation_level=None)
            try:
                conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                conn.close()
        except sqlite3.DatabaseError:
            pass
        stamp = datetime.fromtimestamp(clock() / 1000, UTC).strftime("%Y%m%d-%H%M%S")
        kept = db_path.with_name(f"accounts-before-restore-{stamp}.db")
        for src, dst in ((db_path, kept), (Path(f"{db_path}-wal"), Path(f"{kept}-wal"))):
            if src.exists() and src.stat().st_size > 0:
                shutil.copyfile(src, dst)
                os.chmod(dst, 0o600)
    for suffix in ("-wal", "-shm"):
        Path(f"{db_path}{suffix}").unlink(missing_ok=True)
    os.chmod(staged, 0o600)
    staged.replace(db_path)
    return kept
