// Rules for moving files into a project and a .zip archive (spec section 9.2, decision 96).
import { zipSync } from "fflate";
import { expect, test } from "vitest";
import {
  MAX_FILE_BYTES,
  decodeText,
  downloadName,
  encodeText,
  folderDirWanted,
  folderFileWanted,
  folderPathWanted,
  importFiles,
  readArchive,
  writeArchive,
} from "./files";

const bytes = (text: string): Uint8Array => encodeText(text);

test("архив, выгруженный и прочитанный обратно, даёт те же файлы побайтно", () => {
  const files = [
    { path: "fpgasim.json", content: '{\n  "format": 1\n}\n' },
    { path: "rtl/top.v", content: "﻿module top;\r\n// Привет\r\nendmodule\r\n" },
    { path: "top.cst", content: "" },
    { path: "README.md", content: "без перевода строки в конце" },
  ];
  const back = readArchive(writeArchive(files));
  expect(back.skipped).toEqual([]);
  expect(back.files).toEqual([...files].sort((a, b) => a.path.localeCompare(b.path)));
  for (const file of back.files) {
    const original = files.find((f) => f.path === file.path);
    expect(encodeText(file.content)).toEqual(encodeText(original?.content ?? "?"));
  }
});

test("папка верхнего уровня с именем архива и служебные файлы macOS снимаются", () => {
  const data = zipSync({
    "lesson/top.v": bytes("module top; endmodule\n"),
    "lesson/sub/a.vh": bytes("`define A 1\n"),
    "lesson/.gitignore": bytes("*.fs\n"),
    "lesson/.DS_Store": bytes("x"),
    "lesson/._top.v": bytes("x"),
    "__MACOSX/lesson/._top.v": bytes("x"),
    "lesson/": new Uint8Array(),
  });
  expect(readArchive(data, "lesson.zip").files.map((f) => f.path)).toEqual([".gitignore", "sub/a.vh", "top.v"]);
});

test("проект, где все файлы в одной подпапке, возвращается из архива с теми же путями", () => {
  const files = [
    { path: "rtl/a.v", content: "1" },
    { path: "rtl/top.v", content: "2" },
  ];
  expect(readArchive(writeArchive(files), "project-changed.zip").files).toEqual(files);
});

test("два файла в разных папках верхнего уровня оставляют пути как есть", () => {
  const result = readArchive(zipSync({ "a/top.v": bytes("1"), "b/top.v": bytes("2") }), "a.zip");
  expect(result.files.map((f) => f.path)).toEqual(["a/top.v", "b/top.v"]);
});

test("не текст, неверное имя и слишком большой файл не берутся, с причиной", () => {
  const result = importFiles([
    { path: "top.v", bytes: bytes("module top; endmodule\n") },
    { path: "top.fs", bytes: new Uint8Array([0x30, 0x00, 0x31]) },
    { path: "bad.bin", bytes: new Uint8Array([0xff, 0xfe, 0xfd]) },
    { path: "имя.v", bytes: bytes("") },
    { path: "big.v", bytes: new Uint8Array(MAX_FILE_BYTES + 1).fill(0x41) },
  ]);
  expect(result.files.map((f) => f.path)).toEqual(["top.v"]);
  expect(result.skipped).toEqual([
    { path: "bad.bin", reason: "binary" },
    { path: "big.v", reason: "size" },
    { path: "top.fs", reason: "binary" },
    { path: "имя.v", reason: "name" },
  ]);
});

test("больше 200 файлов: лишние не берутся", () => {
  const entries = Array.from({ length: 205 }, (_, i) => ({
    path: `f${String(i).padStart(3, "0")}.v`,
    bytes: bytes(""),
  }));
  const result = importFiles(entries);
  expect(result.files).toHaveLength(200);
  expect(result.skipped.map((s) => s.reason)).toEqual(Array(5).fill("count"));
});

test("проект больше 2 МБ: файлы сверх предела не берутся", () => {
  const big = new Uint8Array(500 * 1024).fill(0x41);
  const result = importFiles(Array.from({ length: 5 }, (_, i) => ({ path: `m${String(i)}.hex`, bytes: big })));
  expect(result.files).toHaveLength(4);
  expect(result.skipped).toEqual([{ path: "m4.hex", reason: "total" }]);
});

test("неверный архив — исключение", () => {
  expect(() => readArchive(bytes("это не архив"))).toThrow();
});

test("текст UTF-8 с меткой порядка байтов сохраняет метку", () => {
  expect(decodeText(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe("﻿A");
  expect(decodeText(new Uint8Array([0xc3]))).toBeNull();
});

test("проект в папке берёт схему, привязку, данные памяти и fpgasim.json в корне", () => {
  for (const path of ["top.v", "rtl/a.sv", "inc.vh", "x.svh", "top.cst", "rom.hex", "ram.mem", "fpgasim.json"]) {
    expect(folderFileWanted(path)).toBe(true);
  }
  for (const path of ["top.json", "top_pnr.json", "top.fs", "tb_top.vcd", "pnr.log", "Makefile", "sub/fpgasim.json"]) {
    expect(folderFileWanted(path)).toBe(false);
  }
  expect([".git", ".vscode", "impl", "node_modules", "rtl"].map(folderDirWanted)).toEqual([
    false,
    false,
    false,
    false,
    true,
  ]);
});

test("путь файла проекта в папке: вид, папки по пути, скрытое имя", () => {
  expect(["top.v", "rtl/a.sv", "fpgasim.json"].map(folderPathWanted)).toEqual([true, true, true]);
  expect(["notes.txt", "impl/x.v", ".git/a.v", "rtl/.x.v", "top.v.bak"].map(folderPathWanted)).toEqual([
    false,
    false,
    false,
    false,
    false,
  ]);
});

test("имя файла выгрузки без запретных знаков", () => {
  expect(downloadName("blink3", ".zip")).toBe("blink3.zip");
  expect(downloadName('a/b:c*"d', "-changed.zip")).toBe("a_b_c_d-changed.zip");
  expect(downloadName("  ", ".zip")).toBe("project.zip");
});
