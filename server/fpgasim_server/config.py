"""Build server settings: the limits of spec section 8.5 and paths.

Values come from a TOML file (by default /etc/fpgasim/config.toml, the path is set by
FPGASIM_CONFIG); what the file lacks comes from the defaults below. Example file:

    [limits]
    build_seconds = 60
    concurrent_jobs = 2

    [server]
    cors_origins = ["https://sim.example.org", "http://localhost:5173"]

    [assistant]
    enabled = true
    model = "claude-sonnet-5-5"
    effort = "medium"
    key_file = "/etc/fpgasim/anthropic.key"

The environment variables FPGASIM_IMAGE, FPGASIM_DATA_DIR, FPGASIM_KEYS, FPGASIM_SHARE, FPGASIM_ACCOUNTS
override the file: Compose and the tests set them. FPGASIM_CORS_ORIGINS (a comma-separated list)
overrides cors_origins: the deployment passes the interface address of its site this way (decision 173).
"""

from __future__ import annotations

import dataclasses
import os
import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

PROTOCOL_VERSION = 1
REPO_ROOT = Path(__file__).resolve().parents[2]
TAG_RE = re.compile(r"vl(?P<verilator>[\d.]+)-em(?P<emscripten>[\d.]+)-rt(?P<runtime>[\w.]+)$")


@dataclass(frozen=True)
class Limits:
    max_files: int = 200
    max_file_bytes: int = 512 * 1024
    max_project_bytes: int = 2 * 1024 * 1024
    build_seconds: float = 60
    build_memory_mb: int = 2048
    build_cpus: int = 2
    max_wasm_bytes: int = 16 * 1024 * 1024
    job_disk_bytes: int = 512 * 1024 * 1024
    concurrent_jobs: int = 2
    queue_seconds: float = 60
    builds_per_minute: int = 30
    checks_per_minute: int = 240
    cache_bytes: int = 2 * 1024 * 1024 * 1024
    # Testbench (spec section 8.5).
    tb_seconds: float = 20
    tb_memory_mb: int = 512
    tb_cpus: int = 1
    tb_output_bytes: int = 256 * 1024
    tb_vcd_bytes: int = 20 * 1024 * 1024
    tb_keep_seconds: float = 3600  # retention of a waveform file
    tb_store_bytes: int = 1024 * 1024 * 1024  # all stored waveform files
    # Accounts (accounts spec section 3.6 (docs/tz-accounts.md), decision 121).
    account_requests_per_minute: int = 60  # login, password and user operations from one account
    login_failures_per_login: int = 10  # failed logins for one login per window
    login_failures_per_address: int = 30  # failed logins from one address per window
    login_window_seconds: int = 15 * 60
    session_days: int = 90  # a session stays valid this many days from the last request
    # Projects on the server (accounts spec sections 2.5, 2.6, 3.6 (docs/tz-accounts.md), decision 127).
    max_projects: int = 100  # projects of an account outside the trash
    sync_requests_per_minute: int = 120  # sync requests from one account
    trash_days: int = 30  # trash retention: after it the project files are erased
    backups_kept: int = 14  # daily database backups
    max_file_rows: int = 1000  # file records of a project, including records of deleted ones
    max_trashed_projects: int = 100  # projects of an account in the trash; past the limit the oldest are erased
    max_project_rows: int = 10_000  # projects of an account over all time, including erased ones
    # The assistant (decision 175): the same for every account and key, each counted separately.
    assistant_requests_per_minute: int = 20
    assistant_tokens_per_day: int = 400_000  # one key or account per UTC day, all token kinds
    assistant_tokens_per_day_total: int = 4_000_000  # the whole server per UTC day
    # Model calls in flight on the whole server; one per key or account. They run in their own threads.
    assistant_calls_at_once: int = 4


@dataclass(frozen=True)
class AssistantSettings:
    """The assistant (decision 175). model "fake" is the scripted model of the tests (decision 177)."""

    enabled: bool = False
    model: str = "claude-sonnet-5-5"
    effort: str = "medium"
    key_file: Path = Path("/etc/fpgasim/anthropic.key")


@dataclass(frozen=True)
class Settings:
    image: str  # build image, for example fpgasim-build:vl5.050-em7.0.0-rt0.1.0
    limits: Limits = field(default_factory=Limits)
    data_dir: Path = Path("/var/lib/fpgasim")
    keys_file: Path = Path("/etc/fpgasim/keys.toml")
    share_dir: Path = REPO_ROOT  # folder with boards/ and spec/
    cors_origins: tuple[str, ...] = ("http://localhost:5173",)  # the site address comes from the deployment
    accounts_db: Path | None = None  # None: <data_dir>/accounts/accounts.db
    assistant: AssistantSettings = field(default_factory=AssistantSettings)

    @property
    def accounts_file(self) -> Path:
        """The account database (accounts spec section 2.1, docs/tz-accounts.md)."""
        return self.accounts_db or default_accounts_db(self.data_dir)

    @property
    def toolchain(self) -> str:
        """Image tag: it is also the toolchain field in the cache key (spec section 8.2)."""
        return self.image.rsplit(":", 1)[-1]

    @property
    def versions(self) -> dict[str, str | int]:
        m = TAG_RE.search(self.toolchain)
        parts = m.groupdict() if m else {"verilator": "", "emscripten": "", "runtime": ""}
        return {"toolchain": self.toolchain, **parts, "protocol": PROTOCOL_VERSION}

    @property
    def runtime(self) -> str:
        return str(self.versions["runtime"])


def default_accounts_db(data_dir: Path) -> Path:
    return data_dir / "accounts" / "accounts.db"


def read_config(env: dict[str, str]) -> tuple[Path, dict]:
    path = Path(env.get("FPGASIM_CONFIG", "/etc/fpgasim/config.toml"))
    doc: dict = {}
    if path.exists():
        with path.open("rb") as f:
            doc = tomllib.load(f)
    return path, doc


def accounts_db_path(env: dict[str, str] | None = None) -> Path:
    """Path of the account database without the other settings: fpgasim-admin uses it.

    Order: variable FPGASIM_ACCOUNTS, setting server.accounts_db, the data folder.
    """
    env = dict(os.environ) if env is None else env
    _, doc = read_config(env)
    server = doc.get("server", {})
    return Path(env.get("FPGASIM_ACCOUNTS") or server.get("accounts_db") or default_accounts_db(data_dir_path(env)))


def assistant_key_path(env: dict[str, str] | None = None) -> Path:
    """The assistant key file without the other settings: setting assistant.key_file or the default."""
    env = dict(os.environ) if env is None else env
    _, doc = read_config(env)
    return Path(doc.get("assistant", {}).get("key_file", AssistantSettings.key_file))


def data_dir_path(env: dict[str, str] | None = None) -> Path:
    """The data folder without the other settings: variable FPGASIM_DATA_DIR, setting server.data_dir."""
    env = dict(os.environ) if env is None else env
    _, doc = read_config(env)
    return Path(env.get("FPGASIM_DATA_DIR") or doc.get("server", {}).get("data_dir", "/var/lib/fpgasim"))


def cors_origins(env: dict[str, str], server: dict) -> tuple[str, ...]:
    """Allowed interface origins: FPGASIM_CORS_ORIGINS, then server.cors_origins, then the default."""
    if given := [o.strip() for o in env.get("FPGASIM_CORS_ORIGINS", "").split(",") if o.strip()]:
        return tuple(given)
    return tuple(server.get("cors_origins", Settings.cors_origins))


def load_settings(env: dict[str, str] | None = None) -> Settings:
    env = dict(os.environ) if env is None else env
    path, doc = read_config(env)
    known = {f.name for f in dataclasses.fields(Limits)}
    given = doc.get("limits", {})
    if unknown := sorted(set(given) - known):
        raise ValueError(f"{path}: неизвестные ограничения: {unknown}")
    server = doc.get("server", {})
    assistant = doc.get("assistant", {})
    if unknown := sorted(set(assistant) - {f.name for f in dataclasses.fields(AssistantSettings)}):
        raise ValueError(f"{path}: неизвестные настройки помощника: {unknown}")
    if "key_file" in assistant:
        assistant = {**assistant, "key_file": Path(assistant["key_file"])}
    image = env.get("FPGASIM_IMAGE") or server.get("image")
    if not image:
        raise ValueError("не задан образ сборки: переменная FPGASIM_IMAGE или server.image в файле настроек")
    return Settings(
        image=image,
        limits=Limits(**given),
        data_dir=Path(env.get("FPGASIM_DATA_DIR") or server.get("data_dir", "/var/lib/fpgasim")),
        keys_file=Path(env.get("FPGASIM_KEYS") or server.get("keys_file", "/etc/fpgasim/keys.toml")),
        share_dir=Path(env.get("FPGASIM_SHARE") or server.get("share_dir", REPO_ROOT)),
        cors_origins=cors_origins(env, server),
        accounts_db=accounts_db_path(env),
        assistant=AssistantSettings(**assistant),
    )
