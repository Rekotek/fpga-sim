"""Shared tools for the server tests.

Tests marked docker run real jobs in the build image (FPGASIM_IMAGE).
The data folder must be visible to Docker at the same path as to the tests: FPGASIM_TEST_DIR sets it
(make test-server), by default .fpgasim/tests in the repository root.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import uuid
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from fpgasim_server.accounts import hash_password, new_password
from fpgasim_server.api import create_app
from fpgasim_server.config import Limits, Settings
from fpgasim_server.keys import KeyRecord, hash_key, new_key, write_keys

REPO = Path(__file__).resolve().parents[2]
PROJECTS = Path(__file__).resolve().parent / "projects"
TEST_DIR = Path(os.environ.get("FPGASIM_TEST_DIR", REPO / ".fpgasim" / "tests"))


def build_image() -> str:
    image = os.environ.get("FPGASIM_IMAGE")
    if not image:
        image = subprocess.run(
            [str(REPO / "tools" / "bench" / "image.sh"), "--name-full"], capture_output=True, text=True, check=True
        ).stdout.strip()
    return image


def load_project(name: str) -> dict[str, Any]:
    """Build request from the folder server/tests/projects/<name> or examples/<name>."""
    root = PROJECTS / name
    if not root.is_dir():
        root = REPO / "examples" / name
    files = []
    config = None
    for path in sorted(p for p in root.rglob("*") if p.is_file()):
        rel = path.relative_to(root).as_posix()
        if rel == "fpgasim.json":
            config = json.loads(path.read_text(encoding="utf-8"))
        elif rel != "expect.json":
            files.append({"path": rel, "content": path.read_text(encoding="utf-8")})
    return {"files": files, "config": config, "options": {"visibility": None}}


class Env:
    """A service on its own data folder with its own key file."""

    def __init__(self, root: Path, limits: Limits | None = None) -> None:
        self.root = root
        root.mkdir(parents=True)
        self.key = new_key()
        self.disabled_key = new_key()
        self.keys_file = root / "keys.toml"
        write_keys(
            self.keys_file,
            {
                "tester": KeyRecord("tester", hash_key(self.key), True),
                "former": KeyRecord("former", hash_key(self.disabled_key), False),
            },
        )
        self.settings = Settings(
            image=build_image(),
            limits=limits or Limits(),
            data_dir=root / "data",
            keys_file=self.keys_file,
            share_dir=REPO,
        )
        self.log: list[dict[str, Any]] = []
        self.app = create_app(self.settings, self.log.append)
        self.client = TestClient(self.app)
        self.auth = {"Authorization": f"Bearer {self.key}"}

    @property
    def service(self) -> Any:  # noqa: ANN401
        return self.app.state.service

    def add_user(self, login: str, role: str = "user", name: str | None = None) -> str:
        """Creates an account directly in the database; returns the password."""
        password = new_password()
        self.service.accounts.add_user(login, name or login, role, hash_password(password))
        return password

    def login(self, login: str, password: str) -> dict[str, str]:
        """Login with name and password; returns a header with the session token."""
        response = self.client.post("/v1/auth/login", json={"login": login, "password": password})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['token']}"}

    def post(self, op: str, body: dict[str, Any]) -> dict[str, Any]:
        response = self.client.post(f"/v1/{op}", json=body, headers=self.auth)
        assert response.status_code == 200, response.text
        return response.json()

    def build(self, name: str, **changes: Any) -> dict[str, Any]:  # noqa: ANN401
        return self.post("build", {**load_project(name), **changes})

    def check(self, name: str, **changes: Any) -> dict[str, Any]:  # noqa: ANN401
        return self.post("check", {**load_project(name), **changes})


@pytest.fixture(scope="session")
def test_root() -> Iterator[Path]:
    root = TEST_DIR / uuid.uuid4().hex[:12]
    root.mkdir(parents=True)
    yield root
    shutil.rmtree(root, ignore_errors=True)


@pytest.fixture(scope="session")
def env(test_root: Path) -> Env:
    """A shared service for all tests: the cache persists between tests, as on a running server."""
    return Env(test_root / "shared")


@pytest.fixture
def make_env(test_root: Path) -> Iterator[Any]:
    """A separate service with its own limits and an empty cache."""

    def make(**limits: Any) -> Env:  # noqa: ANN401
        return Env(test_root / uuid.uuid4().hex[:12], replace(Limits(), **limits))

    yield make


def codes(body: dict[str, Any]) -> list[str]:
    return [d["code"] for d in body["diagnostics"]]


def one(body: dict[str, Any], code: str) -> dict[str, Any]:
    found = [d for d in body["diagnostics"] if d["code"] == code]
    assert len(found) == 1, f"ожидалось одно сообщение {code}, получено: {codes(body)}"
    return found[0]
