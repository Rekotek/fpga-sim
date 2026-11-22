"""Build service (spec section 8): the operations health, info, check, build, testbench, artifacts.

Accounts and sessions (docs/tz-accounts.md, section 3.1): login, logout, password change,
administrator operations on users. Projects on the server (sections 3.2, 3.3): list, sync,
trash, user projects for the administrator; the service process also runs the daily trash cleanup
and the database backup.

Start: uvicorn --factory fpgasim_server.api:create_app
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import json
import sys
import time
from collections import deque
from collections.abc import AsyncIterator, Awaitable, Callable
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import ClientDisconnect

from .accounts import (
    LOGIN_RE,
    AccountsError,
    AccountStore,
    LoginGuard,
    check_login,
    check_password,
    hash_password,
    new_password,
    verify_login,
)
from .assistant import Model, ModelFailed, check_messages, make_model
from .cache import ARTIFACTS, TB_DUMP, BuildCache, TestbenchStore
from .config import Settings, load_settings
from .diagnostics import Diagnostic, diag, has_errors, load_gowin_primitives, parse_iverilog, parse_verilator
from .jobs import Busy, JobOutcome, JobRunner
from .keys import KeyStore
from .projects import Change, ProjectStore
from .resolve import CONFIG_FILE, DESIGN_EXT, Resolution, bind, resolve, resolve_testbench
from .usage import Usage, UsageStore

MAX_PATH_BYTES = 1024
MAX_NAME_BYTES = 255  # limit of a file name in the server file system
HTTP_CODES = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
}
MAX_SMALL_BODY = 64 * 1024  # body of login and user operation requests
MAX_ASSISTANT_BODY = 1024 * 1024  # the conversation sent to the assistant (decision 175)
MAINTENANCE_SECONDS = 3600  # how often the background task checks whether to clean the trash and back up the database
BAD_CREDENTIALS = "Неверный логин или пароль"
MAX_PASSWORD_QUEUE = 16  # one password check takes about 70 ms
MAX_PASSWORD_QUEUE_PER_ADDRESS = 4
LOGIN_LOCKED = "Слишком много неудачных попыток входа, повторите позже"


class ApiError(Exception):
    def __init__(self, status: int, code: str, text: str) -> None:
        super().__init__(text)
        self.status = status
        self.code = code
        self.text = text


class FileIn(BaseModel):
    path: str
    content: str


class BuildOptions(BaseModel):
    visibility: Literal["all", "ports"] | None = None


class BuildRequest(BaseModel):
    files: list[FileIn]
    config: dict[str, Any] | None = None
    options: BuildOptions = BuildOptions()


class TestbenchRequest(BaseModel):
    __test__ = False  # the name starts with Test, but this is not a pytest suite

    files: list[FileIn]
    config: dict[str, Any] | None = None
    testbench: str


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginRequest(Strict):
    login: StrictStr
    password: StrictStr


class PasswordRequest(Strict):
    current: StrictStr
    new: StrictStr


class NewUserRequest(Strict):
    login: StrictStr
    name: StrictStr
    role: StrictStr


class UserChangeRequest(Strict):
    name: StrictStr | None = None
    role: StrictStr | None = None
    enabled: StrictBool | None = None


MAX_REV = 2**53  # a revision is an integer that JSON carries exactly and SQLite accepts
MAX_SYNC_CHANGES = 1000  # changes in one sync request: this many file records a project allows


class SyncMeta(Strict):
    name: StrictStr
    board: StrictStr


class SyncChange(Strict):
    path: StrictStr
    content: StrictStr | None  # null means the file is deleted; the field is required
    baseRev: StrictInt = Field(ge=0, le=MAX_REV)  # noqa: N815 — protocol field name


class SyncRequest(Strict):
    since: StrictInt = Field(ge=0, le=MAX_REV)
    generation: StrictStr | None = Field(default=None, max_length=64)
    meta: SyncMeta | None = None
    changes: list[SyncChange] = Field(max_length=MAX_SYNC_CHANGES)


@dataclasses.dataclass(frozen=True)
class Principal:
    """Who sent the request: an account session or a key (accounts spec section 2.3, docs/tz-accounts.md)."""

    auth: Literal["session", "key"]
    owner: str  # login for a session, owner name for a key
    session: str | None = None  # SHA-256 of the session token

    @property
    def limit_id(self) -> str:
        """Request counters: a key and an account with the same name are counted separately."""
        return f"{self.auth}:{self.owner}"


def error_response(status: int, code: str, text: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "text": text}}, status_code=status)


def valid_path(path: str) -> bool:
    """A relative path, separator "/", no ".." and no empty parts (spec section 2.1)."""
    try:
        size = len(path.encode("utf-8"))
    except UnicodeEncodeError:
        return False
    if not path or size > MAX_PATH_BYTES or "\\" in path or any(ord(c) < 32 or ord(c) == 127 for c in path):
        return False
    return all(part not in ("", ".", "..") and len(part.encode("utf-8")) <= MAX_NAME_BYTES for part in path.split("/"))


def default_log(record: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(record, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class Service:
    """Service state: cache, job queue, keys, request counters."""

    def __init__(self, settings: Settings, log: Callable[[dict[str, Any]], None] = default_log) -> None:
        self.settings = settings
        self.log = log
        self.keys = KeyStore(settings.keys_file)
        # The account database opens first: a schema newer than known stops the start.
        self.accounts = AccountStore(settings.accounts_file, settings.limits.session_days)
        self.projects = ProjectStore(self.accounts, settings.limits)
        # Passwords are checked one at a time: the lock check, the hash computation and the failure record are
        # not interleaved
        # with other attempts, otherwise a batch of simultaneous requests bypasses the attempt limit.
        # The queue to the check is bounded: a flood of login attempts does not hold other login requests longer than
        # a few seconds, the extra ones get 503.
        self.password_lock = asyncio.Lock()
        self.password_waiting = 0
        self._password_by_address: dict[str, int] = {}
        self.login_guard = LoginGuard(
            lambda: self.accounts.clock(),
            settings.limits.login_failures_per_login,
            settings.limits.login_failures_per_address,
            settings.limits.login_window_seconds * 1000,
        )
        self.cache = BuildCache(
            settings.data_dir / "cache", settings.limits.cache_bytes, max_artifact_bytes=settings.limits.max_wasm_bytes
        )
        self.testbenches = TestbenchStore(
            settings.data_dir / "testbench",
            settings.limits.tb_keep_seconds,
            settings.limits.tb_store_bytes,
            settings.limits.tb_vcd_bytes,
        )
        self.runner = JobRunner(settings)
        self.gowin = load_gowin_primitives(settings.share_dir)
        self._recent: dict[str, deque[float]] = {}
        self._inflight: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._purged_day: str | None = None  # day (UTC) of the last trash cleanup
        # The assistant (decision 175): None when it is off or has no key; tests put a fake model here.
        self.model: Model | None = make_model(settings.assistant)
        self.usage = UsageStore(settings.data_dir / "assistant" / "usage.db", lambda: self.accounts.clock())
        # Model calls wait on the network for up to 100 s: their own threads keep the shared pool free for
        # logins and builds. Owners with a call in flight: one call each, the daily check sees its result.
        self.assistant_pool = ThreadPoolExecutor(settings.limits.assistant_calls_at_once, "assistant")
        self.assistant_owners: set[str] = set()

    # --- Request checks -------------------------------------------------------------

    def principal(self, request: Request, record: dict[str, Any]) -> Principal:
        """The Authorization header value is looked up first among sessions, then among keys.

        A failure of the account database does not break key login: the cause goes to the log.
        """
        scheme, _, value = request.headers.get("authorization", "").partition(" ")
        value = value.strip()
        if scheme.lower() == "bearer" and value:
            failed = False
            try:
                session = self.accounts.session(value)
            except Exception as e:  # noqa: BLE001
                session = None
                failed = True
                record["accountsError"] = f"{type(e).__name__}: {e}"[:500]
            if session is not None:
                return Principal("session", session.login, session.token_sha256)
            owner = self.keys.owner(value)
            if owner is not None:
                return Principal("key", owner)
            if failed:
                # The value may be a valid session token: a 401 would make the client think
                # the session is over because of a temporary database failure.
                raise ApiError(503, "BUSY", "Сервер занят, повторите позже")
        raise ApiError(401, "UNAUTHORIZED", "Нужен действующий сеанс или ключ: заголовок Authorization: Bearer <метка>")

    def admin(self, principal: Principal) -> None:
        """Operations of accounts spec section 3.4 (docs/tz-accounts.md): only a session with the admin role."""
        user = self.accounts.user(principal.owner) if principal.auth == "session" else None
        if user is None or user["role"] != "admin":
            raise ApiError(403, "FORBIDDEN", "Операция доступна только администратору")

    def rate_limit(self, owner: str, op: str) -> None:
        """At most the set number of requests per minute from one key or account.

        Builds and checks are counted separately: a check runs on every file save (spec section 8.5).
        Login, password and user operations have their own count (accounts spec section 3.6, docs/tz-accounts.md).
        """
        limits = self.settings.limits
        # A testbench takes the job queue like a build: the same limit, its own count.
        limit = {
            "check": limits.checks_per_minute,
            "account": limits.account_requests_per_minute,
            "sync": limits.sync_requests_per_minute,
            "assistant": limits.assistant_requests_per_minute,
        }.get(op, limits.builds_per_minute)
        now = time.monotonic()
        recent = self._recent.setdefault(f"{op}:{owner}", deque())
        while recent and now - recent[0] >= 60:
            recent.popleft()
        if len(recent) >= limit:
            raise ApiError(429, "RATE_LIMITED", "Слишком много запросов за минуту, подождите")
        recent.append(now)

    @contextlib.asynccontextmanager
    async def password_turn(self, login: str, address: str) -> AsyncIterator[None]:
        """The queue to a password check: one check at a time.

        A locked login or address does not enter the queue. One address takes at most
        MAX_PASSWORD_QUEUE_PER_ADDRESS places of MAX_PASSWORD_QUEUE: it does not take login away from the others.
        """
        if self.login_guard.locked(login, address):
            raise ApiError(429, "LOGIN_LOCKED", LOGIN_LOCKED)
        mine = self._password_by_address.get(address, 0)
        if self.password_waiting >= MAX_PASSWORD_QUEUE or mine >= MAX_PASSWORD_QUEUE_PER_ADDRESS:
            raise ApiError(503, "BUSY", "Сервер занят, повторите позже")
        self.password_waiting += 1
        self._password_by_address[address] = mine + 1
        try:
            async with self.password_lock:
                yield
        finally:
            self.password_waiting -= 1
            left = self._password_by_address[address] - 1
            if left:
                self._password_by_address[address] = left
            else:
                del self._password_by_address[address]

    async def read_small[M: BaseModel](self, request: Request, model: type[M]) -> M:
        """A small JSON body (login, password, users)."""
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_SMALL_BODY:
                raise ApiError(400, "BAD_REQUEST", "Тело запроса слишком велико")
        try:
            return model.model_validate_json(bytes(body or b"{}"))
        except ValidationError as e:
            # The field value does not go into the error text: the field may hold a password.
            first = e.errors()[0]
            where = ".".join(str(p) for p in first["loc"]) or "тело"
            raise ApiError(400, "BAD_REQUEST", f"Запрос не разобран: {where}: {first['type']}") from None

    async def read_assistant(self, request: Request) -> tuple[list[dict[str, Any]], str]:
        """The conversation and the interface language of an assistant request."""
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > MAX_ASSISTANT_BODY:
                raise ApiError(413, "ASSISTANT_TOO_LONG", "Разговор слишком длинный: начните новый")
        try:
            data = json.loads(bytes(body))
        except ValueError:
            raise ApiError(400, "BAD_REQUEST", "Запрос не разобран: тело не JSON") from None
        if not isinstance(data, dict):
            raise ApiError(400, "BAD_REQUEST", "Запрос не разобран: тело")
        language = data.get("language")
        try:
            messages = check_messages(data.get("messages"))
        except ValueError as e:
            code, status = ("ASSISTANT_TOO_LONG", 413) if "длинн" in str(e) else ("BAD_REQUEST", 400)
            raise ApiError(status, code, str(e)) from None
        return messages, language if isinstance(language, str) else "ru"

    def assistant_allowed(self, owner: str) -> None:
        """Daily token limits: one key or account, then the whole server (UTC day)."""
        limits = self.settings.limits
        if (
            self.usage.tokens_today(owner) >= limits.assistant_tokens_per_day
            or self.usage.tokens_today_total() >= limits.assistant_tokens_per_day_total
        ):
            raise ApiError(429, "ASSISTANT_LIMIT", "Дневной лимит помощника исчерпан, он обновится в 00:00 UTC")

    async def read_sync(self, request: Request) -> tuple[SyncRequest, int]:
        """The body of a sync request and the size of the sent changes (the projectBytes field of the log).

        Paths are checked by the valid_path rule; the section 3.6 limits are checked by the sync itself
        on the project after the changes.
        """
        limits = self.settings.limits
        max_body = limits.max_project_bytes * 6 + 1024 * 1024  # as in read_project: JSON is larger than the project
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > max_body:
            raise ApiError(413, "PROJECT_TOO_LARGE", "Проект больше допустимого размера")
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > max_body:
                raise ApiError(413, "PROJECT_TOO_LARGE", "Проект больше допустимого размера")
        try:
            req = SyncRequest.model_validate_json(bytes(body))
        except ValidationError as e:
            # The field value does not go into the error text: it may be file content.
            first = e.errors()[0]
            where = ".".join(str(p) for p in first["loc"]) or "тело"
            raise ApiError(400, "BAD_REQUEST", f"Запрос не разобран: {where}: {first['type']}") from None
        seen: set[str] = set()
        total = 0
        for change in req.changes:
            if not valid_path(change.path):
                raise ApiError(400, "BAD_REQUEST", f"Недопустимый путь файла: {change.path[:80]!r}")
            if change.path in seen:
                raise ApiError(400, "BAD_REQUEST", f"Файл {change.path} указан дважды")
            seen.add(change.path)
            total += len(change.content.encode("utf-8")) if change.content is not None else 0
        return req, total

    def maintenance(self) -> list[dict[str, Any]]:
        """Daily tasks (accounts spec sections 2.5, 2.6, docs/tz-accounts.md): trash cleanup and database backup.

        Each task runs on its own: a failure of one does not stop the other and does not crash the service.
        Returns log lines. Time is the account database clock (tests replace it).
        """
        records: list[dict[str, Any]] = []
        day = datetime.fromtimestamp(self.accounts.clock() / 1000, UTC).strftime("%Y%m%d")
        tasks: list[tuple[str, Callable[[], dict[str, Any]]]] = []
        if self._purged_day != day:
            tasks.append(("trash-purge", lambda: {"purged": self.projects.purge_trash()}))
        tasks.append(("backup", self._backup))
        for op, task in tasks:
            record: dict[str, Any] = {"time": datetime.now(UTC).isoformat(timespec="milliseconds"), "op": op}
            try:
                record.update(task())
                record["result"] = "ok"
                if op == "trash-purge":
                    self._purged_day = day
            except Exception as e:  # noqa: BLE001
                record["result"] = "INTERNAL"
                record["error"] = f"{type(e).__name__}: {e}"[:500]
            if record.get("result") != "ok" or record.get("purged") or record.get("backup"):
                records.append(record)
        return records

    def _backup(self) -> dict[str, Any]:
        made = self.projects.backup(self.settings.data_dir / "backup")
        return {"backup": made.name} if made is not None else {}

    async def read_project[R: (BuildRequest, TestbenchRequest)](
        self, request: Request, model: type[R] = BuildRequest
    ) -> tuple[R, dict[str, str], int]:
        limits = self.settings.limits
        # A JSON body is larger than the project: control and non-ASCII characters may be written through \u.
        max_body = limits.max_project_bytes * 6 + 1024 * 1024
        declared = request.headers.get("content-length", "")
        if declared.isdigit() and int(declared) > max_body:
            raise ApiError(413, "PROJECT_TOO_LARGE", "Проект больше допустимого размера")
        body = bytearray()
        async for chunk in request.stream():
            body += chunk
            if len(body) > max_body:
                raise ApiError(413, "PROJECT_TOO_LARGE", "Проект больше допустимого размера")
        try:
            req = model.model_validate_json(bytes(body))
        except ValidationError as e:
            first = e.errors()[0]
            where = ".".join(str(p) for p in first["loc"])
            raise ApiError(400, "BAD_REQUEST", f"Запрос не разобран: {where}: {first['msg']}") from None
        if len(req.files) > limits.max_files:
            raise ApiError(413, "PROJECT_TOO_LARGE", f"В проекте больше {limits.max_files} файлов")
        files: dict[str, str] = {}
        total = 0
        for f in req.files:
            if not valid_path(f.path):
                raise ApiError(400, "BAD_REQUEST", f"Недопустимый путь файла: {f.path[:80]!r}")
            if f.path in files:
                raise ApiError(400, "BAD_REQUEST", f"Файл {f.path} указан дважды")
            if f.path == CONFIG_FILE:
                raise ApiError(400, "BAD_REQUEST", f"{CONFIG_FILE} передаётся полем config, а не файлом")
            size = len(f.content.encode("utf-8"))
            if size > limits.max_file_bytes:
                raise ApiError(413, "PROJECT_TOO_LARGE", f"Файл {f.path} больше {limits.max_file_bytes // 1024} КБ")
            total += size
            files[f.path] = f.content
        for path in files:
            # The same path cannot be both a file and a folder.
            parts = path.split("/")
            for i in range(1, len(parts)):
                if "/".join(parts[:i]) in files:
                    raise ApiError(400, "BAD_REQUEST", f"Путь {'/'.join(parts[:i])} назван и файлом, и папкой")
        if req.config is not None:
            # The settings are also a project file (fpgasim.json): the same limits apply to them.
            size = len(json.dumps(req.config, ensure_ascii=False).encode("utf-8"))
            if size > limits.max_file_bytes:
                raise ApiError(413, "PROJECT_TOO_LARGE", f"{CONFIG_FILE} больше {limits.max_file_bytes // 1024} КБ")
            total += size
        if total > limits.max_project_bytes:
            raise ApiError(413, "PROJECT_TOO_LARGE", f"Проект больше {limits.max_project_bytes // (1024 * 1024)} МБ")
        return req, files, total

    async def resolve(self, req: BuildRequest, files: dict[str, str]) -> Resolution:
        """The project is parsed in a separate thread: a large project does not stop other requests."""
        return await asyncio.to_thread(
            resolve,
            files,
            req.config,
            req.options.visibility,
            share_dir=self.settings.share_dir,
            toolchain=self.settings.toolchain,
            runtime=self.settings.runtime,
        )

    # --- Build ----------------------------------------------------------------------

    def _meta(self, outcome: JobOutcome) -> dict[str, Any]:
        """A job result as a cache entry: state, messages, ports."""
        result = outcome.result
        diagnostics = parse_verilator(result.get("verilatorLog", ""), self.gowin)
        failure: Diagnostic | None = None
        if outcome.status == "timeout":
            seconds = self.settings.limits.build_seconds
            failure = diag(
                "toolchain", "error", "BUILD_TIMEOUT", f"Сборка не уложилась в {seconds:g} с", seconds=seconds
            )
        elif outcome.status == "disk":
            failure = diag(
                "toolchain", "error", "BUILD_DISK_LIMIT", "Сборка заняла на диске больше допустимого",
                limit=self.settings.limits.job_disk_bytes,
            )  # fmt: skip
        elif outcome.status == "oom":
            failure = diag("toolchain", "error", "BUILD_OOM", "Сборке не хватило памяти")
        elif outcome.status == "too_large":
            failure = diag(
                "toolchain", "error", "WASM_TOO_LARGE", "Собранная схема больше допустимого размера",
                bytes=result.get("wasmBytes"), limit=self.settings.limits.max_wasm_bytes,
            )  # fmt: skip
        elif outcome.status == "toolchain_failed" or (outcome.status != "ok" and not has_errors(diagnostics)):
            failure = diag(
                "toolchain", "error", "TOOLCHAIN_FAILED", result.get("log", "") or "Сбой инструментов сборки"
            )
        if failure:
            diagnostics.append(failure)
        return {
            "status": "ok" if outcome.status == "ok" else "failed",
            "outcome": "toolchain_failed" if failure and failure["code"] == "TOOLCHAIN_FAILED" else outcome.status,
            "diagnostics": diagnostics,
            "ports": result.get("ports") if isinstance(result.get("ports"), list) else None,
            "timings": result.get("timings", {}),
            "wasmBytes": result.get("wasmBytes"),
        }

    async def _run_build(self, res: Resolution, owner: str) -> dict[str, Any]:
        assert res.job is not None and res.build_id is not None
        async with self.runner.job("build", res.job, res.sources, owner) as outcome:
            meta = self._meta(outcome)
            # Failures that depend on the server load do not go to the cache: a repeated build may succeed.
            # A Verilator failure is cached only when it named an error in the project itself.
            if outcome.status in ("ok", "too_large") or (
                outcome.status == "verilator_failed" and meta["outcome"] == "verilator_failed"
            ):
                artifacts = outcome.out_dir if outcome.status == "ok" else None
                try:
                    await asyncio.to_thread(self.cache.put, res.build_id, meta, artifacts)
                except OSError as e:
                    # The build files were not accepted (no file, a link instead of a file, size exceeded).
                    failure = diag("toolchain", "error", "TOOLCHAIN_FAILED", f"Файлы сборки не приняты: {e}")
                    return {**meta, "status": "failed", "outcome": "toolchain_failed",
                            "diagnostics": [*meta["diagnostics"], failure]}  # fmt: skip
            return meta

    async def build_meta(self, res: Resolution, owner: str) -> tuple[dict[str, Any], bool]:
        """A cache entry for the project and a hit flag. Identical builds do not run at the same time.

        A shared build takes the job slot behind whoever requested it first.
        """
        assert res.build_id is not None
        meta = await asyncio.to_thread(self.cache.get, res.build_id)
        if meta is not None:
            return meta, True
        pending = self._inflight.get(res.build_id)
        if pending is not None:
            return await asyncio.shield(pending), False
        future: asyncio.Future[dict[str, Any]] = asyncio.get_running_loop().create_future()
        future.add_done_callback(lambda f: f.cancelled() or f.exception())
        self._inflight[res.build_id] = future
        try:
            meta = await self._run_build(res, owner)
            future.set_result(meta)
            return meta, False
        except BaseException as e:
            if not future.done():
                future.set_exception(e if isinstance(e, Exception) else Busy())
            raise
        finally:
            del self._inflight[res.build_id]

    async def check_meta(self, res: Resolution, owner: str) -> dict[str, Any]:
        """Quick check: a ready build from the cache or Verilator without compilation."""
        assert res.job is not None and res.build_id is not None
        meta = await asyncio.to_thread(self.cache.get, res.build_id)
        if meta is not None and meta["outcome"] in ("ok", "verilator_failed"):
            return meta
        async with self.runner.job("check", res.job, res.sources, owner) as outcome:
            return self._meta(outcome)

    # --- Testbench ------------------------------------------------------------------

    async def run_testbench(self, req: TestbenchRequest, files: dict[str, str], owner: str) -> dict[str, Any]:
        """The testbench operation (spec section 8.3): Icarus Verilog in the job, the output and the waveform file."""
        limits = self.settings.limits
        if req.testbench not in files or not req.testbench.lower().endswith(tuple(DESIGN_EXT)):
            raise ApiError(
                400, "BAD_REQUEST", f"Файла тестбенча {req.testbench[:80]!r} нет среди файлов Verilog проекта"
            )
        res = await asyncio.to_thread(
            resolve_testbench, files, req.config, req.testbench, share_dir=self.settings.share_dir
        )
        body: dict[str, Any] = {
            "status": "failed",
            "exitCode": None,
            "stdout": "",
            "truncated": False,
            "diagnostics": list(res.diagnostics),
            "vcd": None,
        }
        if res.failed or res.job is None:
            return body
        job = {
            **res.job,
            "tbSeconds": limits.tb_seconds,
            "maxOutputBytes": limits.tb_output_bytes,
            "maxVcdBytes": limits.tb_vcd_bytes,
        }
        diagnostics: list[Diagnostic] = body["diagnostics"]

        def fail(code: str, original: str, **args: Any) -> None:  # noqa: ANN401
            diagnostics.append(diag("toolchain", "error", code, original, **args))

        async with self.runner.job("testbench", job, res.sources, owner) as outcome:
            result = outcome.result
            diagnostics += parse_iverilog(str(result.get("compilerLog", "")))
            stdout = result.get("stdout")
            body["stdout"] = stdout if isinstance(stdout, str) else ""
            body["truncated"] = result.get("truncated") is True
            exit_code = result.get("exitCode")
            body["exitCode"] = exit_code if isinstance(exit_code, int) else None
            if outcome.status == "ok":
                body["status"] = "ok"
                if result.get("vcdTooLarge") is True:
                    megabytes = limits.tb_vcd_bytes // (1024 * 1024)
                    diagnostics.append(
                        diag(
                            "toolchain", "warning", "TB_VCD_TOO_LARGE",
                            f"Файл осциллограммы больше {megabytes} МБ: он не сохранён",
                            megabytes=megabytes,
                        )
                    )  # fmt: skip
                elif result.get("vcd") is True:
                    try:
                        run_id = await asyncio.to_thread(self.testbenches.put, outcome.out_dir / TB_DUMP)
                        body["vcd"] = f"/v1/artifacts/{run_id}/{TB_DUMP}"
                    except OSError as e:
                        fail("TOOLCHAIN_FAILED", f"Файл осциллограммы не принят: {e}")
            elif outcome.status == "timeout":
                body["status"] = "timeout"
                fail("TB_TIMEOUT", f"Тестбенч не уложился в {limits.tb_seconds:g} с", seconds=limits.tb_seconds)
            elif outcome.status == "compile_failed" and has_errors(diagnostics):
                pass  # the compiler named the errors
            elif outcome.status == "oom":
                fail("TB_OOM", "Тестбенчу не хватило памяти", megabytes=limits.tb_memory_mb)
            elif outcome.status == "disk":
                fail("TB_DISK_LIMIT", "Тестбенч занял на диске больше допустимого", limit=limits.job_disk_bytes)
            else:
                log = result.get("log") or result.get("compilerLog") or "Сбой инструментов тестбенча"
                fail("TOOLCHAIN_FAILED", "\n".join(str(log).splitlines()[-40:]))
        return body

    def response(self, res: Resolution, meta: dict[str, Any] | None) -> dict[str, Any]:
        diagnostics = list(res.diagnostics)
        ok = not res.failed
        if meta is not None:
            diagnostics += meta["diagnostics"]
            ok = ok and meta["status"] == "ok"
            if meta.get("ports") is not None:
                binding = bind(res, meta["ports"])
                diagnostics += binding
                ok = ok and not has_errors(binding)
        return {"status": "ok" if ok else "failed", "diagnostics": diagnostics, "resolved": res.resolved}


def create_app(settings: Settings | None = None, log: Callable[[dict[str, Any]], None] = default_log) -> FastAPI:
    settings = settings or load_settings()
    service = Service(settings, log)

    async def maintenance_loop() -> None:
        """Background tasks inside the service process, without cron: a check every hour, the work once a day."""
        while True:
            try:
                for record in await asyncio.to_thread(service.maintenance):
                    service.log(record)
            except Exception as e:  # noqa: BLE001 — a failure of a background task does not crash the service
                service.log({"op": "maintenance", "result": "INTERNAL", "error": f"{type(e).__name__}: {e}"[:500]})
            await asyncio.sleep(MAINTENANCE_SECONDS)

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(maintenance_loop())
        try:
            yield
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="FPGA SIM build server", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.service = service
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
        max_age=86400,
    )

    @app.exception_handler(ApiError)
    async def api_error(request: Request, e: ApiError) -> JSONResponse:
        return error_response(e.status, e.code, e.text)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, e: StarletteHTTPException) -> JSONResponse:
        return error_response(e.status_code, HTTP_CODES.get(e.status_code, "ERROR"), str(e.detail))

    Handler = Callable[[dict[str, Any], Principal | None], Awaitable[dict[str, Any]]]

    def new_record(op: str) -> dict[str, Any]:
        return {
            "time": datetime.now(UTC).isoformat(timespec="milliseconds"),
            "owner": None,
            "auth": None,
            "op": op,
            "buildId": None,
            "cached": None,
            "result": None,
            "projectBytes": None,
        }

    async def logged(request: Request, op: str, handler: Handler, auth: bool = True) -> JSONResponse:
        """One log line per request (spec section 8.7, accounts spec section 3.7, docs/tz-accounts.md).

        Sources, passwords and session tokens are not written to the log. auth=False is an operation without the
        Authorization header (login).
        """
        started = time.monotonic()
        record = new_record(op)
        try:
            principal = None
            if auth:
                principal = service.principal(request, record)
                record["owner"], record["auth"] = principal.owner, principal.auth
            body = await handler(record, principal)
            body["durationMs"] = round((time.monotonic() - started) * 1000)
            record["result"] = body.get("status", "ok")
            response = JSONResponse(body)
        except AccountsError as e:
            record["result"] = e.code
            response = error_response(e.status, e.code, e.text)
        except ApiError as e:
            record["result"] = e.code
            response = error_response(e.status, e.code, e.text)
        except Busy:
            record["result"] = "BUSY"
            response = error_response(503, "BUSY", "Сервер занят, повторите позже")
        except ClientDisconnect:
            record["result"] = "DISCONNECTED"
            response = error_response(400, "BAD_REQUEST", "Запрос оборван")
        except Exception as e:  # noqa: BLE001
            # An unexpected failure: a response in the general shape of section 8.3,
            # the cause goes to the log, not to the client.
            record["result"] = "INTERNAL"
            record["error"] = f"{type(e).__name__}: {e}"[:500]
            response = error_response(500, "INTERNAL", "Внутренняя ошибка сервера")
        if service.keys.error:
            record["keysError"] = service.keys.error
        record["durationMs"] = round((time.monotonic() - started) * 1000)
        service.log(record)
        return response

    @app.get("/v1/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/v1/info")
    async def info(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            assert principal is not None
            user = service.accounts.user(principal.owner) if principal.auth == "session" else None
            return {
                **settings.versions,
                "limits": dataclasses.asdict(settings.limits),
                "owner": principal.owner,
                "auth": principal.auth,
                "user": user,
                "assistant": {
                    "enabled": service.model is not None,
                    "model": service.model.name if service.model is not None else None,
                },
            }

        return await logged(request, "info", handler)

    # --- Login and session (accounts spec section 3.1, docs/tz-accounts.md) -----------

    def session_of(principal: Principal | None) -> Principal:
        """Operations on the own account: a key is not allowed to use them."""
        assert principal is not None
        if principal.auth != "session":
            raise ApiError(403, "FORBIDDEN", "Операция доступна только после входа по логину и паролю")
        service.rate_limit(principal.limit_id, "account")
        return principal

    def client_address(request: Request) -> str:
        return request.headers.get("x-real-ip") or (request.client.host if request.client else "")

    @app.post("/v1/auth/login")
    async def login(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], _: Principal | None) -> dict[str, Any]:
            req = await service.read_small(request, LoginRequest)
            name = req.login.strip().lower()
            record["login"] = name[:64]
            address = client_address(request)
            guard = service.login_guard
            # A login that breaks the account rule does not exist: it goes into the failure counter as one string,
            # so that long random logins do not take memory.
            known = name if LOGIN_RE.fullmatch(name) else ""
            async with service.password_turn(known, address):
                if guard.locked(known, address):
                    raise ApiError(429, "LOGIN_LOCKED", LOGIN_LOCKED)
                found = service.accounts.password_hash(known) if known else None
                ok = await asyncio.to_thread(verify_login, req.password, found[0] if found else None)
                # The account is checked again when the session opens: while the hash was computed, it could have been
                # deleted, disabled or given a new password.
                token = service.accounts.open_session(known, found[0]) if ok and found and found[1] else None
                if token is None:
                    guard.fail(known, address)
                    if guard.locked(known, address):
                        raise ApiError(429, "LOGIN_LOCKED", LOGIN_LOCKED)
                    raise ApiError(401, "BAD_CREDENTIALS", BAD_CREDENTIALS)
                guard.succeed(known)
            record["owner"], record["auth"] = name, "session"
            return {"token": token, "user": service.accounts.user(name)}

        return await logged(request, "login", handler, auth=False)

    @app.post("/v1/auth/logout")
    async def logout(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = session_of(principal)
            assert me.session is not None
            service.accounts.close_session(me.session)
            return {"status": "ok"}

        return await logged(request, "logout", handler)

    @app.post("/v1/auth/password")
    async def change_password(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = session_of(principal)
            req = await service.read_small(request, PasswordRequest)
            check_password(req.new)
            address = client_address(request)
            async with service.password_turn(me.owner, address):
                if service.login_guard.locked(me.owner, address):
                    raise ApiError(429, "LOGIN_LOCKED", LOGIN_LOCKED)
                found = service.accounts.password_hash(me.owner)
                ok = await asyncio.to_thread(verify_login, req.current, found[0] if found else None)
                if not ok:
                    service.login_guard.fail(me.owner, address)
                    raise ApiError(401, "BAD_CREDENTIALS", "Неверный текущий пароль")
                service.accounts.set_password(me.owner, await asyncio.to_thread(hash_password, req.new), me.session)
            return {"status": "ok"}

        return await logged(request, "password", handler)

    # --- Users (accounts spec section 3.4, docs/tz-accounts.md) -----------------------

    def admin_of(principal: Principal | None, record: dict[str, Any], target: str | None = None) -> Principal:
        assert principal is not None
        service.rate_limit(principal.limit_id, "account")
        service.admin(principal)
        if target is not None:
            record["target"] = target[:64]
            check_login(target)
        return principal

    @app.get("/v1/admin/users")
    async def list_users(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            admin_of(principal, record)
            return {"users": service.accounts.users()}

        return await logged(request, "admin-users", handler)

    @app.post("/v1/admin/users")
    async def add_user(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            admin_of(principal, record)
            req = await service.read_small(request, NewUserRequest)
            record["target"] = req.login[:64]
            check_login(req.login)
            password = new_password()
            user = service.accounts.add_user(
                req.login, req.name, req.role, await asyncio.to_thread(hash_password, password)
            )
            return {"user": user, "password": password}

        return await logged(request, "admin-user-add", handler)

    @app.patch("/v1/admin/users/{target}")
    async def update_user(request: Request, target: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = admin_of(principal, record, target)
            req = await service.read_small(request, UserChangeRequest)
            changes = req.model_dump(exclude_none=True)
            return {"user": service.accounts.update_user(me.owner, target, changes)}

        return await logged(request, "admin-user-update", handler)

    @app.post("/v1/admin/users/{target}/password")
    async def reset_password(request: Request, target: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = admin_of(principal, record, target)
            password = new_password()
            # A session that changed the password stays (section 2.3): it exists only when the account is its own.
            service.accounts.set_password(target, await asyncio.to_thread(hash_password, password), me.session)
            return {"password": password}

        return await logged(request, "admin-user-password", handler)

    @app.delete("/v1/admin/users/{target}")
    async def delete_user(request: Request, target: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = admin_of(principal, record, target)
            service.accounts.delete_user(me.owner, target)
            return {"status": "ok"}

        return await logged(request, "admin-user-delete", handler)

    # --- Projects (accounts spec sections 3.2, 3.3, docs/tz-accounts.md) --------------

    def own_project(record: dict[str, Any], project_id: str) -> str:
        record["project"] = project_id[:64]
        return project_id

    @app.get("/v1/projects")
    async def list_projects(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = session_of(principal)
            return service.projects.of_user(me.owner)

        return await logged(request, "projects", handler)

    @app.post("/v1/projects/{project_id}/sync")
    async def sync_project(request: Request, project_id: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            assert principal is not None
            if principal.auth != "session":
                raise ApiError(403, "FORBIDDEN", "Операция доступна только после входа по логину и паролю")
            service.rate_limit(principal.limit_id, "sync")
            own_project(record, project_id)
            req, record["projectBytes"] = await service.read_sync(request)
            changes = [Change(c.path, c.content, c.baseRev) for c in req.changes]
            meta = (req.meta.name, req.meta.board) if req.meta is not None else None
            # A SQLite transaction waits for the write lock: outside the event loop.
            if req.generation is None and (req.since or any(c.base_rev for c in changes)):
                # Revisions apply only within their database generation:
                # without it there is nothing to compare them with.
                raise ApiError(400, "BAD_REQUEST", "Запрос с ревизиями обязан нести поле generation")
            body = await asyncio.to_thread(
                service.projects.sync, principal.owner, project_id, req.since, meta, changes, req.generation
            )
            if not body.get("stale") and not body["deleted"]:
                record["applied"], record["conflicts"] = len(body["applied"]), len(body["conflicts"])
            return body

        return await logged(request, "sync", handler)

    @app.delete("/v1/projects/{project_id}")
    async def delete_project(request: Request, project_id: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            me = session_of(principal)
            service.projects.delete(me.owner, own_project(record, project_id))
            return {"status": "ok"}

        return await logged(request, "project-delete", handler)

    # --- User projects (accounts spec section 3.5, docs/tz-accounts.md) ----------------

    @app.get("/v1/admin/users/{target}/projects")
    async def user_projects(request: Request, target: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            admin_of(principal, record, target)
            if service.accounts.user(target) is None:
                raise ApiError(404, "NOT_FOUND", f"Пользователя {target} нет")
            return service.projects.of_user(target, admin=True)

        return await logged(request, "admin-projects", handler)

    @app.get("/v1/admin/projects/{project_id}")
    async def admin_project(request: Request, project_id: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            admin_of(principal, record)
            return service.projects.read(own_project(record, project_id))

        return await logged(request, "admin-project", handler)

    @app.post("/v1/admin/projects/{project_id}/restore")
    async def restore_project(request: Request, project_id: str) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            admin_of(principal, record)
            service.projects.restore(own_project(record, project_id))
            return {"status": "ok"}

        return await logged(request, "admin-project-restore", handler)

    # --- Build ----------------------------------------------------------------------

    def note_build(principal: Principal, record: dict[str, Any]) -> None:
        """A build or testbench request from a session updates last_build of the account (section 3.7).

        A database failure does not stop the build: the cause goes to the log.
        """
        if principal.auth != "session":
            return
        try:
            service.accounts.note_build(principal.owner)
        except Exception as e:  # noqa: BLE001
            record["accountsError"] = f"{type(e).__name__}: {e}"[:500]

    @app.post("/v1/check")
    async def check(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            assert principal is not None
            service.rate_limit(principal.limit_id, "check")
            req, files, record["projectBytes"] = await service.read_project(request)
            res = await service.resolve(req, files)
            record["buildId"] = res.build_id
            meta = None if res.failed else await service.check_meta(res, principal.limit_id)
            return service.response(res, meta)

        return await logged(request, "check", handler)

    @app.post("/v1/assistant")
    async def assistant(request: Request) -> JSONResponse:
        """One model call of the assistant (decision 175); the browser runs the tool loop."""

        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            assert principal is not None
            service.rate_limit(principal.limit_id, "assistant")
            messages, language = await service.read_assistant(request)
            model = service.model
            if model is None:
                raise ApiError(503, "ASSISTANT_OFF", "Помощник на сервере выключен")
            owner = principal.limit_id
            service.assistant_allowed(owner)
            if owner in service.assistant_owners:
                raise ApiError(429, "RATE_LIMITED", "Дождитесь ответа помощника на предыдущий вопрос")
            if len(service.assistant_owners) >= settings.limits.assistant_calls_at_once:
                raise ApiError(503, "BUSY", "Помощник занят другими вопросами, повторите через минуту")
            service.assistant_owners.add(owner)
            try:
                loop = asyncio.get_running_loop()
                reply = await loop.run_in_executor(service.assistant_pool, model.call, messages, language)
            except ModelFailed as e:
                raise ApiError(502, "ASSISTANT_FAILED", f"Помощник не ответил: {e}") from None
            finally:
                service.assistant_owners.discard(owner)
            service.usage.add(principal.limit_id, reply.model, reply.usage)
            usage: Usage = reply.usage
            record.update(
                model=reply.model,
                tokensIn=usage.input,
                tokensOut=usage.output,
                cacheRead=usage.cache_read,
                cacheWrite=usage.cache_write,
                stopReason=reply.stop_reason,
            )
            return {
                "content": reply.content,
                "stop_reason": reply.stop_reason,
                "usage": {
                    "input": usage.input,
                    "output": usage.output,
                    "cacheRead": usage.cache_read,
                    "cacheWrite": usage.cache_write,
                },
            }

        return await logged(request, "assistant", handler)

    @app.post("/v1/build")
    async def build(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            assert principal is not None
            service.rate_limit(principal.limit_id, "build")
            note_build(principal, record)
            req, files, record["projectBytes"] = await service.read_project(request)
            res = await service.resolve(req, files)
            record["buildId"] = res.build_id
            meta: dict[str, Any] | None = None
            cached = False
            if not res.failed:
                meta, cached = await service.build_meta(res, principal.limit_id)
            record["cached"] = cached
            body = service.response(res, meta)
            body = {"status": body["status"], "buildId": res.build_id, "cached": cached, **body}
            if body["status"] == "ok":
                base = f"/v1/artifacts/{res.build_id}"
                body["artifacts"] = {"wasm": f"{base}/sim.wasm", "js": f"{base}/sim.mjs"}
            return body

        return await logged(request, "build", handler)

    @app.post("/v1/testbench")
    async def testbench(request: Request) -> JSONResponse:
        async def handler(record: dict[str, Any], principal: Principal | None) -> dict[str, Any]:
            assert principal is not None
            service.rate_limit(principal.limit_id, "testbench")
            note_build(principal, record)
            req, files, record["projectBytes"] = await service.read_project(request, TestbenchRequest)
            return await service.run_testbench(req, files, principal.limit_id)

        return await logged(request, "testbench", handler)

    @app.get("/v1/artifacts/{build_id}/{name}")
    async def artifact(request: Request, build_id: str, name: str) -> Response:
        started = time.monotonic()
        record = new_record("artifacts")
        record["buildId"] = build_id[:64]
        response: Response
        try:
            principal = service.principal(request, record)
            record["owner"], record["auth"] = principal.owner, principal.auth
            if build_id.startswith("tb-"):
                # The testbench waveform file is kept for an hour (spec section 8.3).
                path = await asyncio.to_thread(service.testbenches.get, build_id, name)
                media_type, cache_control = "text/plain; charset=utf-8", "private, max-age=3600"
            else:
                path = await asyncio.to_thread(service.cache.artifact, build_id, name)
                media_type, cache_control = ARTIFACTS.get(name, ""), "public, max-age=31536000, immutable"
            if path is None:
                raise ApiError(404, "NOT_FOUND", "Такого файла сборки нет")
            record["result"] = "ok"
            response = FileResponse(path, media_type=media_type, headers={"Cache-Control": cache_control})
        except ApiError as e:
            record["result"] = e.code
            response = error_response(e.status, e.code, e.text)
        record["durationMs"] = round((time.monotonic() - started) * 1000)
        service.log(record)
        return response

    return app
