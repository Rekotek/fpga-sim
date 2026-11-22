"""Build cache (spec section 8.4): one folder per build, eviction of the least recently used.

    <cache>/<buildId>/meta.json     build result: state, messages, ports
    <cache>/<buildId>/sim.wasm      present only for a successful build
    <cache>/<buildId>/sim.mjs

An entry appears whole: it is assembled in a temporary folder and renamed.
The change time of meta.json is the time of last use.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import time
import uuid
from pathlib import Path
from typing import Any

BUILD_ID_RE = re.compile(r"[0-9a-f]{64}")
ARTIFACTS = {"sim.wasm": "application/wasm", "sim.mjs": "text/javascript"}
COPY_CHUNK = 1024 * 1024


def copy_untrusted(source: Path, target: Path, max_bytes: int) -> None:
    """Copies a file created by the job. The job folder is untrusted data.

    A symbolic link, a special file and a file over the limit are rejected: the service runs with more
    rights than the job and would expose a foreign file through a link (for example the key file).
    """
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode):
            raise OSError(f"{source.name}: не обычный файл")
        if info.st_size > max_bytes:
            raise OSError(f"{source.name}: {info.st_size} байт, больше предела {max_bytes}")
        with os.fdopen(fd, "rb", closefd=False) as src, target.open("wb") as dst:
            left = max_bytes
            while chunk := src.read(min(COPY_CHUNK, left + 1)):
                left -= len(chunk)
                if left < 0:
                    raise OSError(f"{source.name}: больше предела {max_bytes} байт")
                dst.write(chunk)
    finally:
        os.close(fd)


def read_untrusted(source: Path, max_bytes: int) -> bytes:
    """Reads a small job file with the same checks as copy_untrusted."""
    fd = os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise OSError(f"{source.name}: не обычный файл или больше {max_bytes} байт")
        with os.fdopen(fd, "rb", closefd=False) as src:
            return src.read(max_bytes)
    finally:
        os.close(fd)


class BuildCache:
    def __init__(self, root: Path, max_bytes: int, max_artifact_bytes: int = 64 * 1024 * 1024) -> None:
        self.root = root
        self.max_bytes = max_bytes
        self.max_artifact_bytes = max_artifact_bytes
        root.mkdir(parents=True, exist_ok=True)
        # Leftovers of interrupted writes.
        for leftover in root.glob("tmp-*"):
            shutil.rmtree(leftover, ignore_errors=True)

    def get(self, build_id: str) -> dict[str, Any] | None:
        meta = self.root / build_id / "meta.json"
        try:
            doc = json.loads(meta.read_text(encoding="utf-8"))
            os.utime(meta)
        except (OSError, ValueError):
            return None
        return doc

    def artifact(self, build_id: str, name: str) -> Path | None:
        if not BUILD_ID_RE.fullmatch(build_id) or name not in ARTIFACTS:
            return None
        path = self.root / build_id / name
        if not path.is_file():
            return None
        try:
            os.utime(self.root / build_id / "meta.json")
        except OSError:
            return None
        return path

    def put(self, build_id: str, meta: dict[str, Any], artifacts_dir: Path | None) -> None:
        tmp = self.root / f"tmp-{uuid.uuid4().hex}"
        tmp.mkdir()
        try:
            if artifacts_dir is not None:
                if artifacts_dir.is_symlink():
                    raise OSError("папка файлов сборки подменена ссылкой")
                for name in ARTIFACTS:
                    copy_untrusted(artifacts_dir / name, tmp / name, self.max_artifact_bytes)
            (tmp / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
            target = self.root / build_id
            if target.exists():
                shutil.rmtree(target, ignore_errors=True)
            tmp.rename(target)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self.evict(keep=build_id)

    def evict(self, keep: str | None = None) -> list[str]:
        """Deletes long-unused entries while the cache is over the limit. Returns the deleted ones."""
        entries: list[tuple[float, int, Path]] = []
        total = 0
        for entry in self.root.iterdir():
            if not BUILD_ID_RE.fullmatch(entry.name):
                continue
            try:
                size = sum(f.stat().st_size for f in entry.iterdir())
                used = (entry / "meta.json").stat().st_mtime
            except OSError:
                continue
            entries.append((used, size, entry))
            total += size
        removed: list[str] = []
        for _, size, entry in sorted(entries, key=lambda e: e[0]):
            if total <= self.max_bytes:
                break
            if entry.name == keep:
                continue
            shutil.rmtree(entry, ignore_errors=True)
            total -= size
            removed.append(entry.name)
        return removed


TB_ID_RE = re.compile(r"tb-[0-9a-f]{32}")
TB_DUMP = "dump.vcd"


class TestbenchStore:
    """Testbench waveform files (spec section 8.3): kept for an hour, then deleted.

        <root>/tb-<32 chars>/dump.vcd

    Besides the age limit, the total size is capped: when it is exceeded, the oldest are deleted.
    """

    __test__ = False  # the name starts with Test, but this is not a pytest suite

    def __init__(self, root: Path, keep_seconds: float, max_bytes: int, max_file_bytes: int) -> None:
        self.root = root
        self.keep_seconds = keep_seconds
        self.max_bytes = max_bytes
        self.max_file_bytes = max_file_bytes
        root.mkdir(parents=True, exist_ok=True)
        for leftover in root.glob("tmp-*"):
            shutil.rmtree(leftover, ignore_errors=True)
        self.evict()

    def put(self, dump: Path) -> str:
        """Accepts a job file (untrusted data) and returns the entry name."""
        run_id = f"tb-{uuid.uuid4().hex}"
        tmp = self.root / f"tmp-{uuid.uuid4().hex}"
        tmp.mkdir()
        try:
            if dump.parent.is_symlink():
                raise OSError("папка файлов задания подменена ссылкой")
            copy_untrusted(dump, tmp / TB_DUMP, self.max_file_bytes)
            tmp.rename(self.root / run_id)
        finally:
            shutil.rmtree(tmp, ignore_errors=True)
        self.evict(keep=run_id)
        return run_id

    def get(self, run_id: str, name: str) -> Path | None:
        if not TB_ID_RE.fullmatch(run_id) or name != TB_DUMP:
            return None
        path = self.root / run_id / name
        try:
            if time.time() - path.stat().st_mtime > self.keep_seconds:
                return None
        except OSError:
            return None
        return path

    def evict(self, keep: str | None = None) -> None:
        now = time.time()
        entries: list[tuple[float, int, Path]] = []
        total = 0
        for entry in self.root.iterdir():
            if not TB_ID_RE.fullmatch(entry.name):
                continue
            try:
                info = (entry / TB_DUMP).stat()
            except OSError:
                shutil.rmtree(entry, ignore_errors=True)
                continue
            if now - info.st_mtime > self.keep_seconds:
                shutil.rmtree(entry, ignore_errors=True)
                continue
            entries.append((info.st_mtime, info.st_size, entry))
            total += info.st_size
        for _, size, entry in sorted(entries, key=lambda e: e[0]):
            if total <= self.max_bytes:
                break
            if entry.name == keep:
                continue
            shutil.rmtree(entry, ignore_errors=True)
            total -= size
