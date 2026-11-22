// The project storage on a stub IndexedDB.
import "fake-indexeddb/auto";
import { beforeEach, expect, test } from "vitest";
import { ProjectStore } from "./store";

let dbName = "";
let counter = 0;

beforeEach(() => {
  counter += 1;
  dbName = `fpgasim-test-${String(counter)}`;
});

const FILES = [
  { path: "top.v", content: "module top; endmodule\n" },
  { path: "top.cst", content: "" },
];

test("проект и файлы переживают повторное открытие базы", async () => {
  let store = await ProjectStore.open(dbName);
  const project = await store.createProject("blink3", "tang-nano-20k", FILES);
  store.close();

  store = await ProjectStore.open(dbName);
  expect(await store.listProjects()).toEqual([project]);
  expect((await store.listFiles(project.id)).map((f) => [f.path, f.content])).toEqual([
    ["top.cst", ""],
    ["top.v", "module top; endmodule\n"],
  ]);
  store.close();
});

test("несохранённая правка хранится рядом с содержимым и переживает повторное открытие", async () => {
  let store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.putDraft(project.id, "top.v", "module top; wire a; endmodule\n");
  store.close();

  store = await ProjectStore.open(dbName);
  const file = (await store.listFiles(project.id)).find((f) => f.path === "top.v");
  expect(file?.content).toBe("module top; endmodule\n");
  expect(file?.draft).toBe("module top; wire a; endmodule\n");
  store.close();
});

test("правка, равная содержимому, стирается; правка несуществующего файла не создаёт его", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.putDraft(project.id, "top.v", "x");
  await store.putDraft(project.id, "top.v", "module top; endmodule\n");
  await store.putDraft(project.id, "missing.v", "x");
  const files = await store.listFiles(project.id);
  expect(files.map((f) => f.path)).toEqual(["top.cst", "top.v"]);
  expect(files.every((f) => f.draft === undefined)).toBe(true);
  store.close();
});

test("сохранение делает правку содержимым и обновляет время проекта", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.putDraft(project.id, "top.v", "new");
  await new Promise((resolve) => setTimeout(resolve, 5));
  await store.saveFile(project.id, "top.v", "new");
  const file = (await store.listFiles(project.id)).find((f) => f.path === "top.v");
  expect(file?.content).toBe("new");
  expect(file?.draft).toBeUndefined();
  expect((await store.getProject(project.id))?.modified).toBeGreaterThan(project.modified);
  store.close();
});

test("удаление проекта стирает его файлы и не трогает чужие", async () => {
  const store = await ProjectStore.open(dbName);
  const a = await store.createProject("a", "tang-nano-20k", FILES);
  const b = await store.createProject("b", "tang-nano-20k", FILES);
  await store.deleteProject(a.id);
  expect((await store.listProjects()).map((p) => p.id)).toEqual([b.id]);
  expect(await store.listFiles(a.id)).toEqual([]);
  expect(await store.listFiles(b.id)).toHaveLength(2);
  store.close();
});

test("переименование файла переносит содержимое и несохранённую правку", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.putDraft(project.id, "top.v", "draft");
  await store.renameFile(project.id, "top.v", "main.v");
  await store.renameFile(project.id, "missing.v", "other.v");
  const files = await store.listFiles(project.id);
  expect(files.map((f) => f.path)).toEqual(["main.v", "top.cst"]);
  expect(files[0]?.draft).toBe("draft");
  expect(files[0]?.content).toBe(FILES.find((f) => f.path === "top.v")?.content);
  store.close();
});

test("удаление файла и переименование проекта", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.deleteFile(project.id, "top.cst");
  expect((await store.listFiles(project.id)).map((f) => f.path)).toEqual(["top.v"]);
  await store.renameProject(project.id, "урок 4");
  expect((await store.getProject(project.id))?.name).toBe("урок 4");
  store.close();
});

test("исходное содержимое: сохранение его не трогает, переименованный файл считается новым", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.saveFile(project.id, "top.v", "module top; wire a; endmodule\n");
  await store.saveFile(project.id, "new.v", "");
  await store.renameFile(project.id, "top.cst", "pins.cst");
  const files = new Map((await store.listFiles(project.id)).map((f) => [f.path, f]));
  expect(files.get("top.v")?.base).toBe("module top; endmodule\n");
  expect(files.get("new.v")?.base).toBeUndefined();
  expect(files.get("pins.cst")?.base).toBeUndefined();
  store.close();
});

test("содержимое с диска оставляет несохранённую правку, если она отличается", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  await store.putDraft(project.id, "top.v", "правка");
  await store.diskContent(project.id, "top.v", "с диска");
  let file = (await store.listFiles(project.id)).find((f) => f.path === "top.v");
  expect([file?.content, file?.draft, file?.base]).toEqual(["с диска", "правка", "module top; endmodule\n"]);
  // The edit matched the new content: it is no longer needed.
  await store.diskContent(project.id, "top.v", "правка");
  file = (await store.listFiles(project.id)).find((f) => f.path === "top.v");
  expect([file?.content, file?.draft]).toEqual(["правка", undefined]);
  store.close();
});

test("переключатель пересборки хранится в записи проекта", async () => {
  const store = await ProjectStore.open(dbName);
  const project = await store.createProject("p", "tang-nano-20k", FILES);
  expect(project.autoBuild).toBeUndefined();
  await store.setAutoBuild(project.id, false);
  expect((await store.getProject(project.id))?.autoBuild).toBe(false);
  store.close();
});

test("вход принимает ничьи проекты в браузере; проекты записей и в папке не трогаются", async () => {
  const store = await ProjectStore.open(dbName);
  const free = await store.createProject("free", "tang-nano-20k", FILES);
  const mine = await store.createProject("mine", "tang-nano-20k", FILES, undefined, "b");
  expect(mine.account).toBe("b");
  expect(free.account).toBeUndefined();

  expect(await store.adoptProjects("a")).toBe(1);
  expect((await store.getProject(free.id))?.account).toBe("a");
  expect((await store.getProject(mine.id))?.account).toBe("b");
  // A repeated sign-in has nothing left to take.
  expect(await store.adoptProjects("a")).toBe(0);
  store.close();
});
