// Acceptance criteria of stage 10 (spec section 12): a folder on disk (replaced by a folder from the private
// browser storage), rebuild on change, writing fpgasim.json to the folder, repeated permission
// request, archive round trip byte by byte, export of changed files, a browser without folders.
import { readFileSync } from "node:fs";
import { expect, test, type Download, type Page, type TestInfo } from "@playwright/test";
import {
  build,
  choose,
  createFromExample,
  openProjectMenu,
  openSettings,
  openWithKey,
  replaceEditorText,
  sim,
  simWith,
} from "./stand";

const example = (name: string): string =>
  readFileSync(new URL(`../../examples/blink3/${name}`, import.meta.url), "utf8");
const BLINK = { "top.v": example("top.v"), "top.cst": example("top.cst"), "tb_top.v": example("tb_top.v") };

// showDirectoryPicker returns the lesson folder from the private browser storage. The folder permission
// is replaced: before the first request the browser "asks", after it grants (like the real Chrome
// after a page reload). The flag lives until the reload.
async function stubFolder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let granted = false;
    const proto = FileSystemHandle.prototype as unknown as Record<string, unknown>;
    proto.queryPermission = () => Promise.resolve(granted ? "granted" : "prompt");
    proto.requestPermission = () => {
      granted = true;
      return Promise.resolve("granted");
    };
    (window as unknown as Record<string, unknown>).showDirectoryPicker = async () =>
      (await navigator.storage.getDirectory()).getDirectoryHandle("lesson", { create: true });
  });
}

// Write a file to the lesson folder; content: text or bytes.
async function writeDisk(page: Page, path: string, content: string | number[]): Promise<void> {
  await page.evaluate(
    async ([path, content]) => {
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("lesson", { create: true });
      const parts = path.split("/");
      const name = parts.pop() ?? path;
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await writable.write(typeof content === "string" ? content : new Uint8Array(content));
      await writable.close();
    },
    [path, content] as const,
  );
}

async function readDisk(page: Page, path: string): Promise<string | null> {
  return page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("lesson", { create: true });
    try {
      return await (await (await dir.getFileHandle(name)).getFile()).text();
    } catch {
      return null;
    }
  }, path);
}

async function removeDisk(page: Page, path: string): Promise<void> {
  await page.evaluate(async (name) => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("lesson", { create: true });
    await dir.removeEntry(name);
  }, path);
}

const paths = (page: Page) => sim(page, (api) => api.files().map((f) => f.path));
const builds = (page: Page) => sim(page, (api) => api.state().builds);

async function openLesson(page: Page): Promise<void> {
  await stubFolder(page);
  await openWithKey(page);
  for (const [path, text] of Object.entries(BLINK)) await writeDisk(page, path, text);
  // Board build output and service folders do not go into the project (decision 96).
  await writeDisk(page, "top.json", '{"creator": "Yosys"}');
  await writeDisk(page, "top.fs", [0x31, 0x00, 0x30]);
  await writeDisk(page, ".vscode/settings.json", "{}");
  await writeDisk(page, "impl/pnr/top.v", "module junk; endmodule\n");
  await page.getByTestId("folder-open").click();
  await expect(page.getByTestId("project-name")).toHaveText("lesson");
  expect(await sim(page, (api) => api.project())).toEqual({ name: "lesson", kind: "folder" });
  await expect.poll(() => sim(page, (api) => api.folder()?.access)).toBe("granted");
  expect(await paths(page)).toEqual(["tb_top.v", "top.cst", "top.v"]);
  expect(await sim(page, (api) => api.transfer()?.skipped ?? [])).toEqual([]);
  await expect(page.getByTestId("auto-build")).toBeChecked();
}

test("изменение файла в папке пересобирает проект не позже чем через 3 с", async ({ page }) => {
  await openLesson(page);
  expect(await build(page)).toBe("ok");
  const before = await builds(page);

  // An edit "in VS Code": the file changes on disk, bypassing the interface.
  const changed = BLINK["top.v"].replace("module top", "// правка снаружи\nmodule top");
  await writeDisk(page, "top.v", changed);
  const started = Date.now();
  await expect.poll(() => builds(page), { timeout: 3000, intervals: [100] }).toBe(before + 1);
  expect(Date.now() - started).toBeLessThan(3000);
  expect(await sim(page, (api) => api.file("top.v"))).toBe(changed);
  await expect.poll(() => sim(page, (api) => api.state().build.status), { timeout: 60_000 }).toBe("ok");
  // The file open in the editor shows the new text.
  expect(await sim(page, (api) => api.editor().path)).toBe("top.v");
  await expect(page.locator(".cm-content")).toContainText("правка снаружи");

  // A new and a deleted file on disk appear and disappear in the file list.
  await writeDisk(page, "extra.vh", "`define EXTRA 1\n");
  await expect.poll(() => paths(page)).toEqual(["extra.vh", "tb_top.v", "top.cst", "top.v"]);
  await removeDisk(page, "extra.vh");
  await expect.poll(() => paths(page)).toEqual(["tb_top.v", "top.cst", "top.v"]);
  await expect.poll(() => builds(page), { timeout: 5000 }).toBeGreaterThanOrEqual(before + 2);
  await expect.poll(() => sim(page, (api) => api.state().build.status), { timeout: 60_000 }).toBe("ok");

  // An unsaved edit in the browser: a rebuild on a change of another file from outside does not write it
  // to disk, and a file changed from outside does not erase the edit in the editor.
  await replaceEditorText(page, `${BLINK["top.v"]}// правка в браузере\n`);
  await expect.poll(() => sim(page, (api) => api.editor().dirty)).toEqual(["top.v"]);
  const third = await builds(page);
  await writeDisk(page, "top.cst", `${BLINK["top.cst"]}// снаружи\n`);
  await expect.poll(() => builds(page), { timeout: 3000 }).toBe(third + 1);
  await expect.poll(() => sim(page, (api) => api.state().build.status), { timeout: 60_000 }).toBe("ok");
  expect(await readDisk(page, "top.v")).toBe(changed);
  expect(await sim(page, (api) => api.editor().dirty)).toEqual(["top.v"]);
  await writeDisk(page, "top.v", BLINK["top.v"]);
  await expect.poll(() => sim(page, (api) => api.file("top.v"))).toBe(BLINK["top.v"]);
  await expect(page.locator(".cm-content")).toContainText("правка в браузере");
  expect(await readDisk(page, "top.v")).toBe(BLINK["top.v"]);

  // The switch is off: a change does not rebuild, it is checked without a build.
  await page.getByTestId("auto-build").uncheck();
  const quiet = await builds(page);
  const changes = await sim(page, (api) => api.folder()?.changes ?? 0);
  await writeDisk(page, "top.v", changed);
  await expect.poll(() => sim(page, (api) => api.folder()?.changes ?? 0)).toBe(changes + 1);
  await page.waitForTimeout(1500);
  expect(await builds(page)).toBe(quiet);
});

test("настройки и правки редактора записываются в папку", async ({ page }) => {
  await openLesson(page);
  expect(await readDisk(page, "fpgasim.json")).toBeNull();
  await openSettings(page);
  await choose(page.getByTestId("settings-visibility"), "all");
  await page.getByTestId("settings-save").click();
  await expect.poll(() => readDisk(page, "fpgasim.json")).not.toBeNull();
  const config = await readDisk(page, "fpgasim.json");
  expect(config).toBe(await sim(page, (api) => api.file("fpgasim.json")));
  expect(JSON.parse(config ?? "{}")).toMatchObject({ design: { visibility: "all" } });

  // Saving an edit (Ctrl/Cmd+S) writes the file to the folder; its own write does not count as an outside change.
  await page
    .getByTestId("file")
    .filter({ has: page.getByText("top.cst", { exact: true }) })
    .click();
  await expect.poll(() => sim(page, (api) => api.editor().path)).toBe("top.cst");
  const text = `${BLINK["top.cst"]}// сохранено из интерфейса\n`;
  await replaceEditorText(page, text);
  const before = await builds(page);
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => readDisk(page, "top.cst")).toBe(text);
  await page.waitForTimeout(2000);
  expect(await builds(page)).toBe(before);

  // A file of a kind that the project in a folder does not keep, and a file that lies in the folder outside the project,
  // cannot be created: the first would vanish on a scan, the second would be overwritten.
  for (const [name, problem] of [
    ["notes.txt", "только файлы схемы"],
    ["top.json", "только файлы схемы"],
    ["impl/pnr/top.v", "только файлы схемы"],
  ] as const) {
    await page.getByTestId("file-create").click();
    await page.getByTestId("file-name-input").fill(name);
    await page.getByTestId("file-name-input").press("Enter");
    await expect(page.getByTestId("file-problem")).toContainText(problem);
    await page.getByTestId("file-name-input").press("Escape");
  }
  await writeDisk(page, "old.v", [0xcf, 0xf0, 0xe8]); // text not in UTF-8: not taken into the project
  await page.getByTestId("file-create").click();
  await page.getByTestId("file-name-input").fill("old.v");
  await page.getByTestId("file-name-input").press("Enter");
  await expect(page.getByTestId("file-problem")).toContainText("уже есть");
  await page.getByTestId("file-name-input").press("Escape");
  expect(await readDisk(page, "top.json")).toBe('{"creator": "Yosys"}');

  // A file created in the interface appears on disk; a deleted one disappears.
  await page.getByTestId("file-create").click();
  await page.getByTestId("file-name-input").fill("rtl/extra.v");
  await page.getByTestId("file-name-input").press("Enter");
  await expect.poll(() => paths(page)).toContain("rtl/extra.v");
  expect(
    await page.evaluate(async () => {
      const root = await (await navigator.storage.getDirectory()).getDirectoryHandle("lesson");
      return (await (await (await root.getDirectoryHandle("rtl")).getFileHandle("extra.v")).getFile()).size;
    }),
  ).toBe(0);
});

test("после перезагрузки страницы доступ к папке открывается кнопкой", async ({ page }) => {
  await openLesson(page);
  await page.reload();
  await expect(page.getByTestId("folder-banner")).toBeVisible();
  expect(await sim(page, (api) => api.folder()?.access)).toBe("prompt");
  await expect(page.getByTestId("folder-banner-text")).toContainText("lesson");
  // While there is no access, the file on disk changes; after permission the project takes it from disk.
  await writeDisk(page, "top.cst", "// новая привязка\n");
  await page.getByTestId("folder-reopen").click();
  await expect(page.getByTestId("project-name")).toHaveText("lesson");
  await expect.poll(() => sim(page, (api) => api.folder()?.access)).toBe("granted");
  await expect.poll(() => sim(page, (api) => api.file("top.cst"))).toBe("// новая привязка\n");
  // A folder opened a second time is the same project, not a new one.
  await page.getByTestId("back").click();
  await page.getByTestId("folder-open").click();
  await expect(page.getByTestId("project-name")).toHaveText("lesson");
  await page.getByTestId("back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);
});

// A downloaded file under the suggested name: the archive upload takes the project name from the file name.
async function saved(download: Download, info: TestInfo): Promise<string> {
  const path = info.outputPath(download.suggestedFilename());
  await download.saveAs(path);
  return path;
}

async function download(page: Page, item: string): Promise<Download> {
  await openProjectMenu(page);
  const waiting = page.waitForEvent("download");
  await page.getByTestId(item).click();
  return waiting;
}

const NOTES = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("строка 1\r\nстрока 2", "utf8")]);

test("архив, выгруженный и загруженный обратно, даёт те же файлы побайтно", async ({ page }, testInfo) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  // Upload of files into the project: text with a byte order mark and CRLF is taken, binary is not.
  await page.getByTestId("file-upload-input").setInputFiles([
    { name: "notes.txt", mimeType: "text/plain", buffer: NOTES },
    { name: "top.fs", mimeType: "application/octet-stream", buffer: Buffer.from([0x31, 0x00]) },
  ]);
  await expect.poll(() => paths(page)).toContain("notes.txt");
  expect(await sim(page, (api) => api.transfer()?.skipped)).toEqual([{ path: "top.fs", reason: "binary" }]);
  await expect(page.getByTestId("transfer-skipped")).toHaveCount(1);
  const original = await sim(page, (api) => api.files());

  const zip = await download(page, "export-archive");
  expect(zip.suggestedFilename()).toBe("blink3.zip");
  const zipPath = await saved(zip, testInfo);

  await page.getByTestId("back").click();
  await page.getByTestId("archive-input").setInputFiles(zipPath);
  await expect(page.getByTestId("project-name")).toHaveText("blink3");
  const back = await sim(page, (api) => api.files());
  expect(back).toEqual(original);
  // Byte by byte: the example files equal the repository files, the uploaded one equals the source bytes.
  const bytes = new Map(back.map((f) => [f.path, Buffer.from(f.content, "utf8")]));
  for (const [path, text] of Object.entries(BLINK))
    expect(bytes.get(path)?.equals(Buffer.from(text, "utf8"))).toBe(true);
  expect(bytes.get("notes.txt")?.equals(NOTES)).toBe(true);
  await page.getByTestId("back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(2);
});

// Dragging files from disk into the open project (decision 166). Playwright does not drop files
// from disk, so the DataTransfer with files is built on the page, and the dragover and drop events
// go to the editor: this checks that the editor does not insert the file text into the open file.
async function dropFiles(page: Page, files: { name: string; text: string }[], events: string[]): Promise<void> {
  const transfer = await page.evaluateHandle((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([f.text], f.name, { type: "text/plain" }));
    return data;
  }, files);
  for (const type of events) await page.locator(".cm-content").dispatchEvent(type, { dataTransfer: transfer });
}

test("файлы, брошенные в открытый проект, загружаются в него", async ({ page }) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  const top = await sim(page, (api) => api.files().find((f) => f.path === "top.v")?.content);

  await dropFiles(page, [{ name: "extra.vh", text: "`define EXTRA 1\n" }], ["dragover"]);
  await expect(page.getByTestId("file-drop-hint")).toBeVisible();
  expect(await sim(page, (api) => api.fileDrop())).toBe(true);
  await dropFiles(page, [{ name: "extra.vh", text: "`define EXTRA 1\n" }], ["drop"]);
  await expect(page.getByTestId("file-drop-hint")).toHaveCount(0);
  expect(await sim(page, (api) => api.fileDrop())).toBe(false);
  await expect.poll(() => paths(page)).toEqual(["extra.vh", "tb_top.v", "top.cst", "top.v"]);
  // The editor got no event: no file path is inserted into top.v, no edits.
  expect(await sim(page, (api) => api.files().find((f) => f.path === "top.v")?.content)).toBe(top);
  expect(await sim(page, (api) => api.editor())).toMatchObject({ path: "extra.vh", dirty: [] });

  // A file with the same path is replaced, as with a button upload.
  await dropFiles(page, [{ name: "extra.vh", text: "`define EXTRA 2\n" }], ["dragover", "drop"]);
  await expect
    .poll(() => sim(page, (api) => api.files().find((f) => f.path === "extra.vh")?.content))
    .toBe("`define EXTRA 2\n");
});

// Dragging files from disk onto the projects screen (decision 99): the same way as into an open
// project, only the events go to the screen itself. Files go as bytes: the archive is binary.
async function dropOnProjects(page: Page, files: { name: string; bytes: number[] }[]): Promise<void> {
  const transfer = await page.evaluateHandle((files) => {
    const data = new DataTransfer();
    for (const f of files) data.items.add(new File([new Uint8Array(f.bytes)], f.name));
    return data;
  }, files);
  for (const type of ["dragover", "drop"]) await page.getByRole("main").dispatchEvent(type, { dataTransfer: transfer });
}

const bytesOf = (text: string): number[] => [...Buffer.from(text, "utf8")];

test("файлы, брошенные на экран проектов, дают новый проект, архив — проект из архива", async ({ page }, testInfo) => {
  await openWithKey(page);
  await expect(page.getByTestId("project-new")).toBeVisible();
  // Project files: a new project with these files; a binary file is not taken.
  await dropOnProjects(page, [
    { name: "top.v", bytes: bytesOf(BLINK["top.v"]) },
    { name: "top.cst", bytes: bytesOf(BLINK["top.cst"]) },
    { name: "top.fs", bytes: [0x31, 0x00] },
  ]);
  await expect(page.getByTestId("project-name")).toHaveText("Новый проект");
  await expect.poll(() => paths(page)).toEqual(["top.cst", "top.v"]);
  expect(await sim(page, (api) => api.files().find((f) => f.path === "top.v")?.content)).toBe(BLINK["top.v"]);
  expect(await sim(page, (api) => api.transfer()?.skipped)).toEqual([{ path: "top.fs", reason: "binary" }]);

  // One .zip archive: a project from the archive with the same files.
  const zip = await download(page, "export-archive");
  const zipBytes = [...readFileSync(await saved(zip, testInfo))];
  await page.getByTestId("back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(1);
  await dropOnProjects(page, [{ name: "drop.zip", bytes: zipBytes }]);
  await expect(page.getByTestId("project-name")).toHaveText("drop");
  await expect.poll(() => paths(page)).toEqual(["top.cst", "top.v"]);
  expect(await sim(page, (api) => api.files().find((f) => f.path === "top.cst")?.content)).toBe(BLINK["top.cst"]);
  await page.getByTestId("back").click();
  await expect(page.getByTestId("project-row")).toHaveCount(2);
});

test("выгрузка изменённых файлов и открытого файла", async ({ page }, testInfo) => {
  await openWithKey(page);
  await createFromExample(page, "blink3");
  expect(await sim(page, (api) => api.changedFiles())).toEqual([]);
  await openProjectMenu(page);
  await page.getByTestId("export-changed").click();
  await expect(page.getByTestId("export-nothing")).toBeVisible();
  await page.keyboard.press("Escape");

  // An edit without saving is exported too: the export saves edits first.
  const edited = BLINK["top.v"].replace("module top", "// правка\nmodule top");
  await replaceEditorText(page, edited);
  await page.getByTestId("file-create").click();
  await page.getByTestId("file-name-input").fill("extra.v");
  await page.getByTestId("file-name-input").press("Enter");
  await expect.poll(() => sim(page, (api) => api.changedFiles())).toEqual(["extra.v", "top.v"]);

  const zip = await download(page, "export-changed");
  expect(zip.suggestedFilename()).toBe("blink3-changed.zip");
  const zipPath = await saved(zip, testInfo);

  await page
    .getByTestId("file")
    .filter({ has: page.getByText("top.v", { exact: true }) })
    .click();
  const single = await download(page, "export-file");
  expect(single.suggestedFilename()).toBe("top.v");
  expect(readFileSync(await single.path(), "utf8")).toBe(edited);

  await page.getByTestId("back").click();
  await page.getByTestId("archive-input").setInputFiles(zipPath);
  await expect(page.getByTestId("project-name")).toHaveText("blink3-changed");
  expect(await sim(page, (api) => api.files())).toEqual([
    { path: "extra.v", content: "" },
    { path: "top.v", content: edited },
  ]);
});

test("неверный архив: проект не создаётся, показан отказ", async ({ page }) => {
  await openWithKey(page);
  await page
    .getByTestId("archive-input")
    .setInputFiles({ name: "broken.zip", mimeType: "application/zip", buffer: Buffer.from("не архив") });
  await expect(page.getByTestId("transfer-error")).toContainText("broken.zip");
  await expect(page.getByTestId("project-row")).toHaveCount(0);
});

test("без showDirectoryPicker пункт «Открыть папку» выключен и показано пояснение", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "showDirectoryPicker", { value: undefined, configurable: true });
  });
  await openWithKey(page);
  await expect(page.getByTestId("folder-open")).toBeDisabled();
  await expect(page.getByTestId("folder-unsupported")).toBeVisible();
  await expect(page.getByTestId("folder-unsupported")).toContainText("Chrome или Edge");
  // The archive works without folders too.
  await expect(page.getByTestId("archive-load")).toBeEnabled();
  expect(await simWith(page, 0, () => typeof (window as unknown as Record<string, unknown>).showDirectoryPicker)).toBe(
    "undefined",
  );
});
