"""Running jobs in one-shot containers (spec section 8.1).

The service creates a job folder, puts the request and the project files in it, starts a container
with docker run and waits for it to end. Foreign code runs only inside the container.
The job folder path must be the same in the service container and on the host: the volume is bound by it.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import shutil
import subprocess
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .cache import read_untrusted
from .config import Settings

JOB_USER = "10001:10001"
MAX_RESULT_BYTES = 8 * 1024 * 1024
JOB_LABEL = "fpgasim.jobs"
# How long a job lives beyond the build limit if the service did not stop it (for example, the service restarted).
JOB_GRACE_SECONDS = 15
# The service margin over the testbench time: container start and stop. The job itself watches
# the time and returns the testbench output; the service stops the container only if the job did not finish.
TB_GRACE_SECONDS = 3
DISK_CHECK_SECONDS = 1.0


def tree_bytes(root: Path) -> int:
    """Size of a job folder: regular files, without following links."""
    total = 0
    stack = [root]
    while stack:
        try:
            with os.scandir(stack.pop()) as entries:
                for entry in entries:
                    if entry.is_dir(follow_symlinks=False):
                        stack.append(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        total += entry.stat(follow_symlinks=False).st_size
        except OSError:
            continue
    return total


class Busy(Exception):
    """The job queue did not free up in the allotted time."""


class FairSlots:
    """Job slots with a fair queue (decision 165).

    A free slot is taken at once. A freed slot goes first to the owner who has no jobs running now,
    and among equals to whoever queued earlier. On an idle server one owner takes all the slots,
    but does not hold them while owners without jobs wait. The owner is
    the key or the account, as with the per-minute limits (decision 121).
    """

    def __init__(self, capacity: int) -> None:
        self.capacity = capacity
        self.running: dict[str, int] = {}
        self._busy = 0
        self._waiting: list[tuple[str, asyncio.Future[None]]] = []

    def full(self) -> bool:
        return self._busy >= self.capacity

    async def acquire(self, owner: str, timeout: float) -> None:
        """A slot for the owner's job; TimeoutError if no slot came within timeout seconds."""
        # A free slot with a non-empty queue does not happen: release hands it to a waiter at once.
        if not self.full():
            self._take(owner)
            return
        entry = (owner, asyncio.get_running_loop().create_future())
        self._waiting.append(entry)
        try:
            await asyncio.wait_for(asyncio.shield(entry[1]), timeout)
        except BaseException:
            if entry[1].done():
                # The slot was given at the same moment the wait ended: it is returned.
                self.release(owner)
            else:
                self._waiting.remove(entry)
            raise

    def release(self, owner: str) -> None:
        self._busy -= 1
        left = self.running[owner] - 1
        if left:
            self.running[owner] = left
        else:
            del self.running[owner]
        while self._waiting and not self.full():
            index = next((i for i, (o, _) in enumerate(self._waiting) if o not in self.running), 0)
            waiter, future = self._waiting.pop(index)
            self._take(waiter)
            future.set_result(None)

    def _take(self, owner: str) -> None:
        self._busy += 1
        self.running[owner] = self.running.get(owner, 0) + 1


@dataclass
class JobOutcome:
    # ok, verilator_failed, toolchain_failed, oom, too_large, timeout, disk; the testbench also has compile_failed
    status: str
    result: dict[str, Any]
    out_dir: Path  # /work/out of the job; exists while the context is open
    wall_ms: float
    waited_ms: float


@dataclass
class JobStats:
    started: int = 0
    running: int = 0
    max_running: int = 0
    queued: int = 0  # jobs that had to wait in the queue


@dataclass(frozen=True)
class JobBudget:
    """Time, memory and cores of one job."""

    seconds: float  # service limit: past it the container is stopped
    memory_mb: int
    cpus: int
    job_seconds: int  # limit of the job itself (maxSeconds)


def budget_for(settings: Settings, op: str) -> JobBudget:
    limits = settings.limits
    if op == "testbench":
        seconds = limits.tb_seconds + TB_GRACE_SECONDS
        return JobBudget(seconds, limits.tb_memory_mb, limits.tb_cpus, int(seconds) + JOB_GRACE_SECONDS)
    return JobBudget(
        limits.build_seconds, limits.build_memory_mb, limits.build_cpus, int(limits.build_seconds) + JOB_GRACE_SECONDS
    )


def docker_command(settings: Settings, name: str, job_dir: Path, op: str) -> list[str]:
    budget = budget_for(settings, op)
    return [
        "docker", "run", "--rm", "--name", name,
        # The image must be on the machine: the service does not pull it. The label tells jobs of this service apart
        # from jobs of another service running on the same machine (tests, a local server).
        "--pull", "never", "--label", f"{JOB_LABEL}={settings.data_dir}",
        "--network", "none",
        "--cpus", str(budget.cpus),
        "--memory", f"{budget.memory_mb}m", "--memory-swap", f"{budget.memory_mb}m",
        "--pids-limit", "256", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
        "--user", JOB_USER, "--read-only", "--tmpfs", "/tmp:size=256m",
        # The job user has no home folder, and Emscripten and clang look for it.
        "-e", "HOME=/tmp",
        "-v", f"{job_dir}:/work",
        settings.image, "/opt/fpgasim/bin/job", op,
    ]  # fmt: skip


def _prepare(job_dir: Path, request: dict[str, Any], sources: dict[str, str]) -> None:
    src = job_dir / "src"
    src.mkdir(parents=True)
    for path, text in sources.items():
        target = src / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8")
    (job_dir / "request.json").write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")
    # The job runs as another user: it reads everything, writes to the folder root.
    for root, dirs, names in os.walk(job_dir):
        for d in dirs:
            os.chmod(Path(root) / d, 0o755)
        for n in names:
            os.chmod(Path(root) / n, 0o644)
    os.chmod(job_dir, 0o777)


class JobRunner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.jobs_dir = settings.data_dir / "jobs"
        self.jobs_dir.mkdir(parents=True, exist_ok=True)
        # Job folders hold users' sources, and the service takes build files from them:
        # other users of the machine have no access there. The job container gets the folder bound
        # directly; it does not need access to the parent.
        os.chmod(self.jobs_dir, 0o700)
        self.cleanup_leftovers()
        self._slots = FairSlots(settings.limits.concurrent_jobs)
        self.stats = JobStats()

    def cleanup_leftovers(self) -> None:
        """Leftovers of a previous service run: job containers and their folders (spec section 8.1).

        The service may have been stopped in the middle of a job (deployment, crash). It finds its containers by label.
        """
        try:
            found = subprocess.run(
                ["docker", "ps", "-q", "--filter", f"label={JOB_LABEL}={self.settings.data_dir}"],
                capture_output=True, text=True, timeout=20,
            )  # fmt: skip
            ids = found.stdout.split()
            if ids:
                subprocess.run(["docker", "kill", *ids], capture_output=True, timeout=30)
        except (OSError, subprocess.SubprocessError):
            pass
        for leftover in self.jobs_dir.iterdir():
            shutil.rmtree(leftover, ignore_errors=True)

    @contextlib.asynccontextmanager
    async def job(
        self, op: str, request: dict[str, Any], sources: dict[str, str], owner: str = ""
    ) -> AsyncIterator[JobOutcome]:
        limits = self.settings.limits
        budget = budget_for(self.settings, op)
        queued_at = time.monotonic()
        if self._slots.full():
            self.stats.queued += 1
        try:
            await self._slots.acquire(owner, limits.queue_seconds)
        except TimeoutError:
            raise Busy from None
        waited_ms = (time.monotonic() - queued_at) * 1000
        job_id = uuid.uuid4().hex
        job_dir = self.jobs_dir / job_id
        name = f"fpgasim-job-{job_id}"
        self.stats.started += 1
        self.stats.running += 1
        self.stats.max_running = max(self.stats.max_running, self.stats.running)
        proc: asyncio.subprocess.Process | None = None
        try:
            payload = {
                **request,
                "maxWasmBytes": limits.max_wasm_bytes,
                "jobs": budget.cpus,
                "maxSeconds": budget.job_seconds,
            }
            await asyncio.to_thread(_prepare, job_dir, payload, sources)
            started = time.monotonic()
            proc = await asyncio.create_subprocess_exec(
                *docker_command(self.settings, name, job_dir, op),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            timed_out = False
            over_disk = False

            async def watch_disk() -> None:
                # The job folder is on the machine disk, and the container file system does not limit it:
                # a job that writes too much is stopped.
                nonlocal over_disk
                while True:
                    await asyncio.sleep(DISK_CHECK_SECONDS)
                    if await asyncio.to_thread(tree_bytes, job_dir) > limits.job_disk_bytes:
                        over_disk = True
                        killer = await asyncio.create_subprocess_exec(
                            "docker", "kill", name, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                        )
                        await killer.wait()
                        return

            watcher = asyncio.create_task(watch_disk())
            try:
                output, _ = await asyncio.wait_for(proc.communicate(), budget.seconds)
            except TimeoutError:
                timed_out = True
                killer = await asyncio.create_subprocess_exec(
                    "docker", "kill", name, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
                )
                await killer.wait()
                try:
                    output, _ = await asyncio.wait_for(proc.communicate(), 20)
                except TimeoutError:
                    # docker kill did not find the container (not created yet):
                    # what remains is to kill docker run itself.
                    proc.kill()
                    output, _ = await proc.communicate()
            watcher.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await watcher
            # The last check is after the job: a short job could fit between checks.
            if not over_disk and await asyncio.to_thread(tree_bytes, job_dir) > limits.job_disk_bytes:
                over_disk = True
            wall_ms = (time.monotonic() - started) * 1000
            result: dict[str, Any] = {}
            status: str
            result_file = job_dir / "result.json"
            if over_disk:
                status = "disk"
            elif timed_out:
                status = "timeout"
            elif os.path.lexists(result_file):
                # The job folder is untrusted data: the result is read without following links and with a limit.
                try:
                    raw = await asyncio.to_thread(read_untrusted, result_file, MAX_RESULT_BYTES)
                    result = json.loads(raw.decode("utf-8"))
                    if not isinstance(result, dict):
                        raise ValueError("итог задания — не объект")
                    status = str(result.get("status", "toolchain_failed"))
                except (OSError, ValueError) as e:
                    status, result = "toolchain_failed", {"log": f"итог задания не читается: {e}"}
            elif proc.returncode == 137:
                # The container was killed by the kernel: the job ran out of memory.
                status = "oom"
            elif proc.returncode == 124:
                # The job's own time limit fired.
                status = "timeout"
            else:
                status = "toolchain_failed"
                tail = output.decode("utf-8", "replace").splitlines()[-40:]
                result = {"log": "\n".join([f"контейнер задания завершился с кодом {proc.returncode}", *tail])}
            yield JobOutcome(status, result, job_dir / "out", wall_ms, waited_ms)
        finally:
            try:
                if proc is not None and proc.returncode is None:
                    # The handler was cancelled (the service is stopping): the container must not keep running.
                    # A client disconnect does not get here: uvicorn does not cancel the handler, the build
                    # runs to the end and lands in the cache.
                    with contextlib.suppress(Exception):
                        killer = await asyncio.shield(
                            asyncio.create_subprocess_exec(
                                "docker", "kill", name,
                                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                            )
                        )  # fmt: skip
                        await asyncio.shield(killer.wait())
            finally:
                # A repeated cancel during docker kill must not lose the slot: the owner would stay
                # "with a job running" and lose its place in the queue (decision 165).
                self.stats.running -= 1
                self._slots.release(owner)
            await asyncio.to_thread(shutil.rmtree, job_dir, True)
