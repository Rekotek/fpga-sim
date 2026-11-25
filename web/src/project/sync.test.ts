// Project sync (accounts spec sections 4.3–4.4 (docs/tz-accounts.md)) against an in-memory stub server.
// Each "device" has its own IndexedDB database and its own ProjectSync; timers are off, requests go
// on call.
import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "vitest";
import { ServerError } from "../build/client";
import { ProjectStore, unsavedWork, type FileRecord } from "./store";
import {
  ProjectSync,
  type RemoteProject,
  type SyncAnswer,
  type SyncApi,
  type SyncHooks,
  type SyncRequest,
} from "./sync";

// ---- Stub server: the rules of section 3.3 ----

interface ServerFile {
  content: string | null;
  rev: number;
}

interface ServerProject {
  name: string;
  board: string;
  rev: number;
  deleted: boolean;
  files: Map<string, ServerFile>;
}

class FakeServer implements SyncApi {
  generation = "gen-1";
  projectsById = new Map<string, ServerProject>();
  requests: { id: string; body: SyncRequest }[] = [];
  listed = 0;
  // Failure of the next sync request: before handling (the request did not arrive) or after (the answer is lost).
  failBefore: ServerError | null = null;
  loseReply = false;
  // An action during a request: after handling on the server, before the answer returns.
  during: (() => Promise<void>) | null = null;

  async projects(): Promise<{ generation: string; projects: RemoteProject[] }> {
    this.listed += 1;
    if (this.failBefore) throw this.failBefore;
    return Promise.resolve({
      generation: this.generation,
      projects: [...this.projectsById].map(([id, p]) => ({
        id,
        name: p.name,
        board: p.board,
        rev: p.rev,
        modified: 1,
        deleted: p.deleted,
      })),
    });
  }

  async sync(id: string, body: SyncRequest): Promise<SyncAnswer> {
    this.requests.push({ id, body: structuredClone(body) });
    if (this.failBefore) {
      const error = this.failBefore;
      this.failBefore = null;
      throw error;
    }
    const answer = this.handle(id, body);
    if (this.during) {
      const work = this.during;
      this.during = null;
      await work();
    }
    if (this.loseReply) {
      this.loseReply = false;
      throw new ServerError(0, "NETWORK", "ответ потерян");
    }
    return answer;
  }

  async remove(id: string): Promise<void> {
    const project = this.projectsById.get(id);
    if (!project) throw new ServerError(404, "NOT_FOUND", "Проекта нет");
    project.deleted = true;
    return Promise.resolve();
  }

  private handle(id: string, body: SyncRequest): SyncAnswer {
    if (body.generation === null && (body.since > 0 || body.changes.some((c) => c.baseRev > 0))) {
      throw new ServerError(400, "BAD_REQUEST", "нет поколения");
    }
    if (body.generation !== null && body.generation !== this.generation) {
      return { stale: true, generation: this.generation };
    }
    let project = this.projectsById.get(id);
    if (!project) {
      if (!body.meta) throw new ServerError(404, "NOT_FOUND", "Проекта нет");
      project = { ...body.meta, rev: 0, deleted: false, files: new Map() };
      this.projectsById.set(id, project);
    }
    if (project.deleted) return { deleted: true, rev: project.rev, generation: this.generation };
    if (body.meta && (body.meta.name !== project.name || body.meta.board !== project.board)) {
      project.name = body.meta.name;
      project.board = body.meta.board;
      project.rev += 1;
    }
    const applied: { path: string; rev: number }[] = [];
    const conflicts: { path: string; rev: number; content: string | null }[] = [];
    for (const change of body.changes) {
      const current = project.files.get(change.path);
      const rev = current?.rev ?? 0;
      const content = current?.content ?? null;
      if (change.content === null && content === null) applied.push({ path: change.path, rev });
      else if (rev === change.baseRev || (change.baseRev === 0 && current !== undefined && content === null)) {
        project.rev += 1;
        project.files.set(change.path, { content: change.content, rev: project.rev });
        applied.push({ path: change.path, rev: project.rev });
      } else if (content === change.content) applied.push({ path: change.path, rev });
      else conflicts.push({ path: change.path, rev, content });
    }
    const answered = new Set([...applied, ...conflicts].map((c) => c.path));
    const remote = [...project.files]
      .filter(([path, file]) => file.rev > body.since && !answered.has(path))
      .map(([path, file]) => ({ path, rev: file.rev, content: file.content }));
    return {
      deleted: false,
      generation: this.generation,
      rev: project.rev,
      name: project.name,
      board: project.board,
      modified: 1,
      applied,
      conflicts,
      remote,
    };
  }

  content(id: string, path: string): string | null | undefined {
    return this.projectsById.get(id)?.files.get(path)?.content;
  }
}

// ---- Device ----

interface Device {
  store: ProjectStore;
  sync: ProjectSync;
  events: string[];
  file(id: string, path: string): Promise<FileRecord | undefined>;
  paths(id: string): Promise<string[]>;
}

let counter = 0;
let server: FakeServer;
const noTimer = (): ReturnType<typeof setTimeout> => 0 as unknown as ReturnType<typeof setTimeout>;

beforeEach(() => {
  server = new FakeServer();
});

interface DeviceOptions {
  account?: string;
  api?: SyncApi;
  hooks?: Partial<SyncHooks>;
  timer?: (work: () => void, ms: number) => ReturnType<typeof setTimeout>;
}

async function device(options: DeviceOptions = {}): Promise<Device> {
  counter += 1;
  const store = await ProjectStore.open(`fpgasim-sync-test-${String(counter)}`);
  const events: string[] = [];
  const hooks: SyncHooks = {
    files: (id, paths) => events.push(`files:${paths.join(",")}`),
    project: () => undefined,
    gone: (id, copy) => events.push(copy === null ? "gone" : "copied"),
    list: () => events.push("list"),
    unauthorized: () => events.push("unauthorized"),
    ...options.hooks,
  };
  const sync = new ProjectSync(
    store,
    options.api ?? server,
    options.account ?? "misha",
    hooks,
    options.timer ?? noTimer,
  );
  return {
    store,
    sync,
    events,
    file: async (id, path) => (await store.listFiles(id)).find((f) => f.path === path),
    paths: async (id) => (await store.listFiles(id)).map((f) => f.path),
  };
}

const FILES = [
  { path: "top.v", content: "module top; endmodule\n" },
  { path: "uart.v", content: "module uart; endmodule\n" },
];

// The project is created on device a and received by device b.
async function shared(): Promise<{ a: Device; b: Device; id: string }> {
  const a = await device();
  const b = await device();
  const project = await a.store.createProject("blink3", "tang-nano-20k", FILES, undefined, "misha");
  await a.sync.syncProject(project.id);
  await b.sync.syncAll();
  return { a, b, id: project.id };
}

const state = (d: Device, id: string): string | undefined => d.sync.status(id)?.state;

// ---- Ordinary exchange ----

test("новый проект уходит на сервер и появляется на втором устройстве с теми же файлами", async () => {
  const { a, b, id } = await shared();
  expect(server.content(id, "top.v")).toBe("module top; endmodule\n");
  expect(state(a, id)).toBe("synced");
  expect(await b.paths(id)).toEqual(["top.v", "uart.v"]);
  const got = await b.file(id, "top.v");
  expect([got?.content, got?.base, got?.dirty]).toEqual([
    "module top; endmodule\n",
    "module top; endmodule\n",
    undefined,
  ]);
  expect((await b.store.getProject(id))?.name).toBe("blink3");
  expect(state(b, id)).toBe("synced");
});

test("запрос без изменений ничего не меняет", async () => {
  const { a, id } = await shared();
  const before = server.projectsById.get(id)?.rev;
  await a.sync.syncProject(id);
  expect(server.projectsById.get(id)?.rev).toBe(before);
  expect(server.requests.at(-1)?.body.changes).toEqual([]);
});

test("правка первого устройства приходит второму; правки разных файлов сливаются", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "top.v", "A");
  await b.store.saveFile(id, "uart.v", "B");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  await a.sync.syncProject(id);
  for (const d of [a, b]) {
    expect((await d.file(id, "top.v"))?.content).toBe("A");
    expect((await d.file(id, "uart.v"))?.content).toBe("B");
    expect(state(d, id)).toBe("synced");
  }
  expect(b.events).toContain("files:top.v");
});

test("правка одного файла на двух устройствах: расхождение, текст второго не изменён, сервер цел", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "top.v", "A");
  await b.store.saveFile(id, "top.v", "B");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  const file = await b.file(id, "top.v");
  expect(file?.content).toBe("B");
  expect(file?.conflict?.content).toBe("A");
  expect(state(b, id)).toBe("conflict");
  expect(server.content(id, "top.v")).toBe("A");
  // A file with a conflict is not sent until the user chooses a version.
  const sentBefore = server.requests.length;
  await b.sync.syncProject(id);
  expect(server.requests.slice(sentBefore).every((r) => r.body.changes.length === 0)).toBe(true);
});

test("«оставить мою» отправляет версию браузера; «взять с сервера» заменяет содержимое и правку", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "top.v", "A");
  await a.store.saveFile(id, "uart.v", "A2");
  await b.store.saveFile(id, "top.v", "B");
  await b.store.saveFile(id, "uart.v", "B2");
  await b.store.putDraft(id, "uart.v", "B2 и правка");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  await b.store.resolveConflict(id, "top.v", "mine");
  await b.store.resolveConflict(id, "uart.v", "server");
  await b.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("B");
  const taken = await b.file(id, "uart.v");
  expect([taken?.content, taken?.draft, taken?.conflict]).toEqual(["A2", undefined, undefined]);
  expect(state(b, id)).toBe("synced");
  await a.sync.syncProject(id);
  expect((await a.file(id, "top.v"))?.content).toBe("B");
});

test("одинаковая правка на двух устройствах расхождения не даёт", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "top.v", "same");
  await b.store.saveFile(id, "top.v", "same");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  expect(state(b, id)).toBe("synced");
  expect((await b.file(id, "top.v"))?.dirty).toBeUndefined();
});

// ---- Deletion and rename ----

test("удаление файла приходит второму устройству; переименование — удаление и создание", async () => {
  const { a, b, id } = await shared();
  await a.store.deleteFile(id, "uart.v");
  await a.store.renameFile(id, "top.v", "main.v");
  await a.sync.syncProject(id);
  expect([server.content(id, "uart.v"), server.content(id, "top.v")]).toEqual([null, null]);
  await b.sync.syncProject(id);
  expect(await b.paths(id)).toEqual(["main.v"]);
  expect((await a.store.getProject(id))?.sync?.deletes).toEqual([]);
});

test("файл, созданный заново под путём удалённого, уходит без расхождения", async () => {
  const { a, b, id } = await shared();
  await a.store.deleteFile(id, "uart.v");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  // On device a: after the accepted deletion; on device b: after the deletion received from the server.
  await b.store.saveFile(id, "uart.v", "снова");
  await b.sync.syncProject(id);
  expect(state(b, id)).toBe("synced");
  expect(server.content(id, "uart.v")).toBe("снова");
});

test("файл удалён и создан заново до отправки: для сервера это правка прежнего файла", async () => {
  const { a, id } = await shared();
  await a.store.deleteFile(id, "uart.v");
  await a.store.saveFile(id, "uart.v", "новый");
  expect((await a.store.getProject(id))?.sync?.deletes).toEqual([]);
  await a.sync.syncProject(id);
  expect(server.content(id, "uart.v")).toBe("новый");
  expect(state(a, id)).toBe("synced");
});

test("я удалил файл, на сервере его изменили: расхождение хранится в записи удаления", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "uart.v", "A");
  await a.sync.syncProject(id);
  await b.store.deleteFile(id, "uart.v");
  await b.sync.syncProject(id);
  const entry = (await b.store.getProject(id))?.sync?.deletes[0];
  expect(entry?.conflict?.content).toBe("A");
  expect(state(b, id)).toBe("conflict");
  expect(server.content(id, "uart.v")).toBe("A");
  // "Take from server" returns the file to the project.
  await b.store.resolveConflict(id, "uart.v", "server");
  await b.sync.syncProject(id);
  expect((await b.file(id, "uart.v"))?.content).toBe("A");
  expect(state(b, id)).toBe("synced");
});

test("правка файла, удалённого на сервере, даёт расхождение с «файл удалён»", async () => {
  const { a, b, id } = await shared();
  await a.store.deleteFile(id, "uart.v");
  await a.sync.syncProject(id);
  await b.store.saveFile(id, "uart.v", "B");
  await b.sync.syncProject(id);
  expect((await b.file(id, "uart.v"))?.conflict).toEqual({ rev: expect.any(Number) as number, content: null });
  await b.store.resolveConflict(id, "uart.v", "mine");
  await b.sync.syncProject(id);
  expect(server.content(id, "uart.v")).toBe("B");
});

test("удаление на сервере не стирает файл с несохранённой правкой редактора", async () => {
  const { a, b, id } = await shared();
  await b.store.putDraft(id, "uart.v", "правка");
  await a.store.deleteFile(id, "uart.v");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  const file = await b.file(id, "uart.v");
  expect([file?.draft, file?.conflict?.content]).toEqual(["правка", null]);
});

// ---- Changes during a request ----

test("файл изменён, пока шёл запрос: он остаётся неотправленным и уходит следующим запросом", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.during = async () => {
    await a.store.saveFile(id, "top.v", "v2");
  };
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v2");
  expect(state(a, id)).toBe("synced");
});

test("чужая правка пришла на файл, изменённый во время запроса: расхождение", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "uart.v", "A");
  await a.sync.syncProject(id);
  server.during = async () => {
    await b.store.saveFile(id, "uart.v", "B");
  };
  await b.sync.syncProject(id);
  const file = await b.file(id, "uart.v");
  expect([file?.content, file?.conflict?.content]).toEqual(["B", "A"]);
});

test("файл удалён, пока шёл запрос с его правкой: удаление уходит следующим запросом", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.during = async () => {
    await a.store.deleteFile(id, "top.v");
  };
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBeNull();
  expect(await a.paths(id)).toEqual(["uart.v"]);
});

test("чужая правка пришла на файл, удалённый во время запроса: расхождение, удаление не отменено", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "uart.v", "A");
  await a.sync.syncProject(id);
  server.during = async () => {
    await b.store.deleteFile(id, "uart.v");
  };
  await b.sync.syncProject(id);
  expect(await b.paths(id)).toEqual(["top.v"]);
  expect((await b.store.getProject(id))?.sync?.deletes[0]?.conflict?.content).toBe("A");
});

// ---- An unsaved editor edit and a content replacement by the server ----

test("правка начата до чужого изменения: её сохранение даёт расхождение, чужая версия цела", async () => {
  const { a, b, id } = await shared();
  // The workspace of device b loaded the file (the replacement counter is undefined) and began an edit.
  const seen = (await b.file(id, "top.v"))?.remoteSeq;
  await b.store.putDraft(id, "top.v", "B поверх старого", seen);
  await a.store.saveFile(id, "top.v", "A");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  const replaced = await b.file(id, "top.v");
  expect([replaced?.content, replaced?.draft]).toEqual(["A", "B поверх старого"]);
  // Saving the edit: the workspace names the counter it saw when the edit began.
  await b.store.saveFile(id, "top.v", "B поверх старого", seen);
  await b.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("A");
  expect((await b.file(id, "top.v"))?.conflict?.content).toBe("A");
  expect(state(b, id)).toBe("conflict");
});

test("правка, которой нет в хранилище, тоже даёт расхождение: счётчик называет рабочее место", async () => {
  const { a, b, id } = await shared();
  const seen = (await b.file(id, "top.v"))?.remoteSeq; // the workspace of b loaded the file
  await a.store.saveFile(id, "top.v", "A");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id); // the content in the storage of b is replaced, the workspace does not know yet
  await b.store.saveFile(id, "top.v", "B", seen);
  await b.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("A");
  expect(state(b, id)).toBe("conflict");
});

test("файл создан на этом устройстве (замен не было): правка до чужого изменения даёт расхождение", async () => {
  const { a, b, id } = await shared();
  expect((await a.file(id, "top.v"))?.remoteSeq).toBeUndefined();
  await b.store.saveFile(id, "top.v", "B");
  await b.sync.syncProject(id);
  await a.sync.syncProject(id); // the storage of a received "B", the workspace of a still holds the old text
  await a.store.saveFile(id, "top.v", "A поверх старого", 0);
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("B");
  expect(state(a, id)).toBe("conflict");
});

test("сохранение после того, как рабочее место увидело замену, расхождения не даёт", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "top.v", "A");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  const seen = (await b.file(id, "top.v"))?.remoteSeq ?? 0;
  await b.store.saveFile(id, "top.v", "A и B", seen);
  await b.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("A и B");
  expect(state(b, id)).toBe("synced");
});

test("своя принятая правка счётчик замен не меняет: следующее сохранение расхождения не даёт", async () => {
  const { a, id } = await shared();
  const seen = (await a.file(id, "top.v"))?.remoteSeq ?? 0;
  await a.store.saveFile(id, "top.v", "v1", seen);
  await a.sync.syncProject(id);
  await a.store.saveFile(id, "top.v", "v2", seen);
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v2");
  expect(state(a, id)).toBe("synced");
});

// ---- Failures ----

test("нет сети: состояние offline, правка в браузере цела и доходит после возврата сети", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(0, "NETWORK", "нет сети");
  await a.sync.syncProject(id);
  expect(state(a, id)).toBe("offline");
  expect((await a.file(id, "top.v"))?.content).toBe("v1");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v1");
  expect(state(a, id)).toBe("synced");
});

test("ответ потерян, файл сохранён ещё раз: расхождения с собой нет", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.loseReply = true;
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v1");
  expect(state(a, id)).toBe("offline");
  await a.store.saveFile(id, "top.v", "v2");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v2");
  expect(state(a, id)).toBe("synced");
  expect((await a.file(id, "top.v"))?.sent).toBeUndefined();
});

test("ответ потерян, а затем файл изменило другое устройство: это настоящее расхождение", async () => {
  const { a, b, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.loseReply = true;
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  await b.store.saveFile(id, "top.v", "чужое");
  await b.sync.syncProject(id);
  await a.store.saveFile(id, "top.v", "v2");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("чужое");
  expect((await a.file(id, "top.v"))?.conflict?.content).toBe("чужое");
});

test("401: правка остаётся, рабочее место узнаёт о конце сеанса", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(401, "UNAUTHORIZED", "сеанс кончился");
  await a.sync.syncProject(id);
  expect(a.events).toContain("unauthorized");
  expect((await a.file(id, "top.v"))?.dirty).toBe(true);
});

test("413: состояние error с текстом отказа на языке интерфейса (решение 183)", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(413, "PROJECT_TOO_LARGE", "Проект больше 2 МБ", {
    reason: "projectTooLarge",
    megabytes: 2,
  });
  await a.sync.syncProject(id);
  expect(a.sync.status(id)).toEqual({ state: "error", error: "Проект больше 2 МБ" });
});

test("413 без args (сервер до решения 183): текст по коду", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(413, "PROJECT_TOO_LARGE", "Проект больше 2 МБ");
  await a.sync.syncProject(id);
  expect(a.sync.status(id)).toEqual({ state: "error", error: "Проект больше, чем принимает сервер" });
});

test("404: сервер проекта не знает, проект отправляется заново целиком", async () => {
  const { a, id } = await shared();
  server.projectsById.delete(id);
  await a.store.saveFile(id, "top.v", "v1");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v1");
  expect(server.content(id, "uart.v")).toBe("module uart; endmodule\n");
  expect(state(a, id)).toBe("synced");
});

// ---- Database generation ----

test("база восстановлена из копии: правка со старой ревизией не затирает новую", async () => {
  const { a, b, id } = await shared();
  // A database copy is made here. Then a writes an edit, and the database is restored from the copy.
  const copy = structuredClone([...(server.projectsById.get(id)?.files ?? [])]);
  const rev = server.projectsById.get(id)?.rev ?? 0;
  await a.store.saveFile(id, "top.v", "A до восстановления");
  await a.sync.syncProject(id);
  const project = server.projectsById.get(id);
  if (!project) throw new Error("нет проекта");
  project.files = new Map(copy);
  project.rev = rev;
  server.generation = "gen-2";
  // Device b signs in again and writes a new edit: its revision number matches the old one on a.
  await b.sync.syncAll();
  await b.store.saveFile(id, "top.v", "B после восстановления");
  await b.sync.syncProject(id);
  await a.store.saveFile(id, "top.v", "A снова");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("B после восстановления");
  expect((await a.file(id, "top.v"))?.conflict?.content).toBe("B после восстановления");
  expect((await a.store.getProject(id))?.sync?.generation).toBe("gen-2");
  // Files that match the server give no conflicts.
  expect((await a.file(id, "uart.v"))?.conflict).toBeUndefined();
});

test("смена поколения в списке проектов сбрасывает ревизии до первого запроса sync", async () => {
  const { a, id } = await shared();
  server.generation = "gen-2";
  await a.sync.syncAll();
  const first = server.requests.find((r) => r.body.generation === "gen-2");
  expect(first?.body.since).toBe(0);
  expect(first?.body.changes.every((c) => c.baseRev === 0)).toBe(true);
  expect(state(a, id)).toBe("synced");
});

// ---- Project and list ----

test("смена имени проекта приходит второму устройству", async () => {
  const { a, b, id } = await shared();
  await a.store.renameProject(id, "blink4");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  expect((await b.store.getProject(id))?.name).toBe("blink4");
  expect((await a.store.getProject(id))?.sync?.meta).toBe(false);
});

test("удаление проекта убирает его со второго устройства", async () => {
  const { a, b, id } = await shared();
  await a.store.deleteProject(id);
  expect((await a.store.getProject(id))?.sync?.trashed).toBe(true);
  await a.sync.syncProject(id);
  expect(await a.store.getProject(id)).toBeUndefined();
  expect(server.projectsById.get(id)?.deleted).toBe(true);
  await b.sync.syncAll();
  expect(await b.store.getProject(id)).toBeUndefined();
  expect(b.events).toContain("gone");
});

test("проект удалён на другом устройстве, а здесь есть несохранённая правка: копия с новым идентификатором", async () => {
  const { a, b, id } = await shared();
  await b.store.putDraft(id, "top.v", "правка редактора");
  await a.store.deleteProject(id);
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  expect(await b.store.getProject(id)).toBeUndefined();
  expect(b.events).toContain("copied");
  const [copy] = await b.store.syncedProjects("misha");
  expect(copy && copy.id !== id).toBe(true);
  const file = copy ? await b.file(copy.id, "top.v") : undefined;
  expect([file?.draft, file?.serverRev]).toEqual(["правка редактора", undefined]);
  if (copy) {
    await b.sync.syncProject(copy.id);
    expect(server.content(copy.id, "top.v")).toBe("module top; endmodule\n");
  }
});

test("проект, не созданный на сервере, удаляется без запроса", async () => {
  const a = await device();
  const project = await a.store.createProject("p", "tang-nano-20k", FILES, undefined, "misha");
  await a.store.deleteProject(project.id);
  expect(await a.store.getProject(project.id)).toBeUndefined();
});

test("вход принимает ничьи проекты: они получают владельца и уходят на сервер", async () => {
  const a = await device();
  const project = await a.store.createProject("старый", "tang-nano-20k", FILES);
  expect(project.sync).toBeUndefined();
  expect(await a.store.adoptProjects("misha")).toBe(1);
  await a.sync.syncAll();
  expect(server.content(project.id, "top.v")).toBe("module top; endmodule\n");
  expect(state(a, project.id)).toBe("synced");
});

test("чужая запись и проекты без синхронизации в обмен не идут", async () => {
  const a = await device({ account: "misha" });
  await a.store.createProject("анна", "tang-nano-20k", FILES, undefined, "anna");
  await a.store.createProject("ничей", "tang-nano-20k", FILES);
  const folder = {} as FileSystemDirectoryHandle;
  await a.store.createProject("папка", "tang-nano-20k", FILES, folder);
  await a.sync.syncAll();
  expect(server.requests).toEqual([]);
  expect(server.projectsById.size).toBe(0);
});

test("список не получен: проекты остаются, запрос повторяется позже", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(0, "NETWORK", "нет сети");
  await a.sync.syncAll();
  expect((await a.file(id, "top.v"))?.dirty).toBe(true);
  server.failBefore = null;
  await a.sync.syncAll();
  expect(server.content(id, "top.v")).toBe("v1");
});

test("несохранённая работа: правка редактора считается, отправленный проект — нет", async () => {
  const { a, id } = await shared();
  const project = await a.store.getProject(id);
  if (!project) throw new Error("нет проекта");
  expect(unsavedWork(project, await a.store.listFiles(id))).toBe(false);
  await a.store.putDraft(id, "top.v", "правка");
  expect(unsavedWork(project, await a.store.listFiles(id))).toBe(true);
});

// ---- Stopping the exchange ----

test("обмен остановлен во время запроса: ответ не разбирается, новых запросов нет", async () => {
  const a = await device();
  const project = await a.store.createProject("p", "tang-nano-20k", FILES, undefined, "misha");
  server.during = () => {
    a.sync.stop();
    return Promise.resolve();
  };
  await a.sync.syncProject(project.id);
  expect((await a.store.getProject(project.id))?.sync?.rev).toBe(0);
  expect((await a.file(project.id, "top.v"))?.dirty).toBe(true);
  const sentBefore = server.requests.length;
  await a.sync.syncProject(project.id);
  await a.sync.syncAll();
  expect(server.requests.length).toBe(sentBefore);
});

test("обмен остановлен, пока запрос получал 404: второго запроса с созданием проекта нет", async () => {
  const a = await device();
  const project = await a.store.createProject("p", "tang-nano-20k", FILES, undefined, "misha");
  await a.sync.syncProject(project.id);
  server.projectsById.delete(project.id);
  await a.store.saveFile(project.id, "top.v", "v1");
  const sentBefore = server.requests.length;
  server.failBefore = new ServerError(404, "NOT_FOUND", "Проекта нет");
  const stop = a.sync.syncProject(project.id);
  a.sync.stop();
  await stop;
  expect(server.requests.length - sentBefore).toBeLessThanOrEqual(1);
  expect(server.projectsById.has(project.id)).toBe(false);
});

test("проект за время запроса открыла другая вкладка: ответ не разбирается", async () => {
  let calls = 0;
  const a = await device({
    hooks: {
      busy: () => {
        calls += 1;
        return Promise.resolve(calls > 1); // free before the request, busy after the answer
      },
    },
  });
  const project = await a.store.createProject("p", "tang-nano-20k", FILES, undefined, "misha");
  await a.sync.syncProject(project.id);
  expect(server.content(project.id, "top.v")).toBe("module top; endmodule\n");
  expect((await a.store.getProject(project.id))?.sync?.rev).toBe(0);
});

// ---- Deletion after a lost answer ----

test("новый проект отправлен, ответ потерян, проект удалён: удаление доходит до сервера", async () => {
  const a = await device();
  const project = await a.store.createProject("p", "tang-nano-20k", FILES, undefined, "misha");
  server.loseReply = true;
  await a.sync.syncProject(project.id);
  expect(server.projectsById.has(project.id)).toBe(true);
  await a.store.deleteProject(project.id);
  expect((await a.store.getProject(project.id))?.sync?.trashed).toBe(true);
  await a.sync.syncAll();
  expect(server.projectsById.get(project.id)?.deleted).toBe(true);
  expect(await a.store.getProject(project.id)).toBeUndefined();
});

test("новый файл отправлен, ответ потерян, файл удалён: он не возвращается с сервера", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "new.v", "новый");
  server.loseReply = true;
  await a.sync.syncProject(id);
  expect(server.content(id, "new.v")).toBe("новый");
  await a.store.deleteFile(id, "new.v");
  await a.sync.syncProject(id);
  expect(await a.paths(id)).toEqual(["top.v", "uart.v"]);
  expect(server.content(id, "new.v")).toBeNull();
  expect(state(a, id)).toBe("synced");
});

test("новый файл отправлен, ответ потерян, файл переименован: на сервере и в браузере один файл", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "new.v", "новый");
  server.loseReply = true;
  await a.sync.syncProject(id);
  await a.store.renameFile(id, "new.v", "other.v");
  await a.sync.syncProject(id);
  expect(await a.paths(id)).toEqual(["other.v", "top.v", "uart.v"]);
  expect([server.content(id, "new.v"), server.content(id, "other.v")]).toEqual([null, "новый"]);
  expect(state(a, id)).toBe("synced");
});

test("правка отправлена, ответ потерян, файл удалён: расхождения с собственной отправкой нет", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.loseReply = true;
  await a.sync.syncProject(id);
  await a.store.deleteFile(id, "top.v");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBeNull();
  expect(state(a, id)).toBe("synced");
});

test("удаление отправлено, ответ потерян, файл создан заново: расхождения с собственным удалением нет", async () => {
  const { a, id } = await shared();
  await a.store.deleteFile(id, "top.v");
  server.loseReply = true;
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBeNull();
  await a.store.saveFile(id, "top.v", "снова");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("снова");
  expect(state(a, id)).toBe("synced");
  expect((await a.file(id, "top.v"))?.sentDeleted).toBeUndefined();
});

test("удаление отправлено, ответ потерян, а файл на сервере потом создал другой: настоящее расхождение", async () => {
  const { a, b, id } = await shared();
  await a.store.deleteFile(id, "top.v");
  server.loseReply = true;
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  await b.store.saveFile(id, "top.v", "чужой");
  await b.sync.syncProject(id);
  await a.store.saveFile(id, "top.v", "мой");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("чужой");
  expect(state(a, id)).toBe("conflict");
});

test("смена поколения базы не отменяет неотправленное удаление файла", async () => {
  const { a, id } = await shared();
  await a.store.deleteFile(id, "uart.v");
  server.generation = "gen-2";
  await a.sync.syncAll();
  // The restored database has the file: a deletion without a revision gives a conflict, the file does not return by itself.
  expect(await a.paths(id)).toEqual(["top.v"]);
  expect((await a.store.getProject(id))?.sync?.deletes[0]?.conflict?.content).toBe("module uart; endmodule\n");
});

// ---- An editor edit that is not in storage yet ----

test("правка записана в хранилище перед разбором ответа: удаление файла на сервере её не стирает", async () => {
  const { a, id } = await shared();
  // The workspace of device b holds the edit only in memory; it writes it before parsing the answer.
  let store: ProjectStore | null = null;
  const b = await device({
    hooks: {
      before: async (project) => {
        await store?.putDraft(project, "uart.v", "правка в памяти", 1);
      },
    },
  });
  await b.sync.syncAll();
  store = b.store;
  await a.store.deleteFile(id, "uart.v");
  await a.sync.syncProject(id);
  await b.sync.syncProject(id);
  const file = await b.file(id, "uart.v");
  expect([file?.draft, file?.conflict?.content]).toEqual(["правка в памяти", null]);
});

test("запись удалённого файла создаётся заново для правки редактора", async () => {
  const { a, id } = await shared();
  await a.store.deleteFile(id, "uart.v");
  await a.store.reviveFile(id, "uart.v", "module uart; endmodule\n", "правка");
  const file = await a.file(id, "uart.v");
  expect([file?.content, file?.draft, file?.dirty]).toEqual(["module uart; endmodule\n", "правка", true]);
  // The call does not touch an existing record.
  await a.store.reviveFile(id, "top.v", "x", "y");
  expect((await a.file(id, "top.v"))?.draft).toBeUndefined();
});

test("сохранение в проект, которого уже нет, файл без проекта не создаёт", async () => {
  const a = await device();
  expect(await a.store.saveFile("нет-такого", "top.v", "x")).toBe(0);
  expect(await a.store.listFiles("нет-такого")).toEqual([]);
});

// ---- Server rejection and retries ----

test("5xx: состояние offline, как при обрыве сети", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(503, "BUSY", "Сервер занят");
  await a.sync.syncProject(id);
  expect(state(a, id)).toBe("offline");
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v1");
});

test("413: запрос не повторяется, пока проект не изменился", async () => {
  const { a, id } = await shared();
  await a.store.saveFile(id, "top.v", "v1");
  server.failBefore = new ServerError(413, "PROJECT_TOO_LARGE", "Проект больше 2 МБ");
  await a.sync.syncProject(id);
  const sentBefore = server.requests.length;
  await a.sync.syncProject(id);
  await a.sync.syncAll();
  expect(server.requests.length).toBe(sentBefore);
  expect(state(a, id)).toBe("error");
  // A project change lifts the ban.
  await a.store.saveFile(id, "top.v", "v2");
  a.sync.schedule(id);
  await a.sync.syncProject(id);
  expect(server.content(id, "top.v")).toBe("v2");
  expect(state(a, id)).toBe("synced");
});

test("запуск через 2 с после изменения; повтор после сбоя связи через 5, 15, 60 и снова 60 с", async () => {
  const delays: number[] = [];
  const timer = (work: () => void, ms: number): ReturnType<typeof setTimeout> => {
    delays.push(ms);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  };
  const a = await device({ timer });
  const project = await a.store.createProject("p", "tang-nano-20k", FILES, undefined, "misha");
  a.sync.schedule(project.id);
  expect(delays).toEqual([2000]);
  for (let i = 0; i < 4; i += 1) {
    server.failBefore = new ServerError(0, "NETWORK", "нет сети");
    await a.sync.syncProject(project.id);
  }
  expect(delays).toEqual([2000, 5000, 15_000, 60_000, 60_000]);
  // Success resets the retry count.
  await a.sync.syncProject(project.id);
  server.failBefore = new ServerError(0, "NETWORK", "нет сети");
  await a.store.saveFile(project.id, "top.v", "v1");
  await a.sync.syncProject(project.id);
  expect(delays.at(-1)).toBe(5000);
});

test("имя проекта длиннее предела сервера укорачивается при создании и переименовании", async () => {
  const a = await device();
  const project = await a.store.createProject("я".repeat(200), "tang-nano-20k", FILES, undefined, "misha");
  expect(Array.from(project.name).length).toBe(128);
  await a.store.renameProject(project.id, "x".repeat(300));
  expect((await a.store.getProject(project.id))?.name.length).toBe(128);
  await a.sync.syncProject(project.id);
  expect(state(a, project.id)).toBe("synced");
});
