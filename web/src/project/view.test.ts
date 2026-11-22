// A temporary copy of another user's project for the administrator (accounts spec section 5.6 (docs/tz-accounts.md)).
import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "vitest";
import { ProjectStore, unsentWork } from "./store";

let dbName = "";
let counter = 0;

beforeEach(() => {
  counter += 1;
  dbName = `fpgasim-view-test-${String(counter)}`;
});

const SOURCE = { login: "misha", id: "11111111-1111-4111-8111-111111111111", name: "blink3", board: "tang-nano-20k" };
const FILES = [{ path: "top.v", content: "module top; endmodule\n" }];

test("копия для просмотра принадлежит администратору, без sync и без отметок отправки", async () => {
  const store = await ProjectStore.open(dbName);
  const changed: string[] = [];
  store.onChange = (id) => changed.push(id);
  const view = await store.createView(SOURCE, FILES, "taras");
  expect(view.account).toBe("taras");
  expect(view.viewOf).toEqual({ login: "misha", id: SOURCE.id });
  expect(view.sync).toBeUndefined();
  const files = await store.listFiles(view.id);
  expect(files.map((f) => [f.path, f.content, f.base, f.dirty])).toEqual([
    ["top.v", "module top; endmodule\n", "module top; endmodule\n", undefined],
  ]);
  // Editing the copy does not go to the server.
  await store.saveFile(view.id, "top.v", "// правка\n");
  expect(changed).toEqual([]);
  expect(await store.syncedProjects("taras")).toEqual([]);
  // Sign-in of another account does not accept the copy: it has an owner.
  expect(await store.adoptProjects("misha")).toBe(0);
  store.close();
});

test("повторное открытие того же проекта заменяет копию", async () => {
  const store = await ProjectStore.open(dbName);
  const first = await store.createView(SOURCE, FILES, "taras");
  const second = await store.createView(SOURCE, [{ path: "top.v", content: "// новое\n" }], "taras");
  const projects = await store.listProjects();
  expect(projects.map((p) => p.id)).toEqual([second.id]);
  expect(await store.listFiles(first.id)).toEqual([]);
  expect((await store.listFiles(second.id)).map((f) => f.content)).toEqual(["// новое\n"]);
  store.close();
});

test("«Сделать своей копией»: новый идентификатор, sync, все файлы ждут отправки, правка цела", async () => {
  const store = await ProjectStore.open(dbName);
  const changed: string[] = [];
  store.onChange = (id) => changed.push(id);
  const view = await store.createView(SOURCE, FILES, "taras");
  await store.putDraft(view.id, "top.v", "// правка редактора\n");
  const id = await store.claimView(view.id);
  expect(id).not.toBeNull();
  expect(id).not.toBe(view.id);
  expect(await store.getProject(view.id)).toBeUndefined();
  const own = await store.getProject(id ?? "");
  expect(own?.viewOf).toBeUndefined();
  expect(own?.account).toBe("taras");
  expect(own?.sync).toEqual({ rev: 0, generation: "", meta: true, deletes: [] });
  const files = await store.listFiles(id ?? "");
  expect(files.map((f) => [f.path, f.dirty, f.draft])).toEqual([["top.v", true, "// правка редактора\n"]]);
  expect(own && unsentWork(own, files)).toBe(true);
  expect(changed).toEqual([id]);
  // An ordinary project does not become a copy.
  expect(await store.claimView(id ?? "")).toBeNull();
  store.close();
});
