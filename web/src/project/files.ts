// Project files from outside (spec section 9.2): a .zip archive, single files and a folder on disk.
// Here are the rules for which files go into a project, and archive packing; storage and disk are in other modules.
import { unzipSync, zipSync } from "fflate";
import type { ProjectFile } from "../build/types";
import { filePathProblem } from "../app/speed";
import { CONFIG_FILE } from "./config";

// Limits of spec section 8.5: the server would not accept a larger project anyway.
export const MAX_FILES = 200;
export const MAX_FILE_BYTES = 512 * 1024;
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;

// Files that a project in a folder takes from disk (decision 96): the design, the binding, memory data
// and fpgasim.json in the root. The rest in a lesson folder is build output for the board (top.json, top.fs,
// logs, VCD): not part of the project, and its change must not trigger a rebuild.
const FOLDER_TYPES = /\.(v|sv|vh|svh|cst|hex|mem)$/i;

export function folderFileWanted(path: string): boolean {
  return path === CONFIG_FILE || FOLDER_TYPES.test(path);
}

// Folders a project in a folder does not enter: hidden ones (.git, .vscode) and Gowin build output.
export function folderDirWanted(name: string): boolean {
  return !name.startsWith(".") && name !== "node_modules" && name !== "impl";
}

// A path a project in a folder takes from disk: the file kind, folders on the path and a non-hidden name.
export function folderPathWanted(path: string): boolean {
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  return !name.startsWith(".") && parts.every(folderDirWanted) && folderFileWanted(path);
}

// The reason a file is not taken into the project. folder: a project in a folder does not store such files,
// read: the file cannot be read (for example, a dropped folder).
export type SkipReason = "name" | "binary" | "size" | "count" | "total" | "folder" | "read";

export interface Skipped {
  path: string;
  reason: SkipReason;
}

export interface Imported {
  files: ProjectFile[];
  skipped: Skipped[];
}

const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const encoder = new TextEncoder();

// The file text in UTF-8 or null if it is not text. The byte order mark stays in the text:
// an export must return the file byte for byte the same.
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

export const encodeText = (text: string): Uint8Array => encoder.encode(text);

// Selecting files by project rules: the name by the rule of decision 61, UTF-8 text, server limits.
// Files go in path order, so that selection over the limits does not depend on the archive order.
export function importFiles(entries: readonly { path: string; bytes: Uint8Array }[]): Imported {
  const files: ProjectFile[] = [];
  const skipped: Skipped[] = [];
  let total = 0;
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const { path, bytes } of sorted) {
    if (filePathProblem(path, []) !== null) skipped.push({ path, reason: "name" });
    else if (bytes.length > MAX_FILE_BYTES) skipped.push({ path, reason: "size" });
    else if (files.some((f) => f.path === path)) skipped.push({ path, reason: "name" });
    else if (files.length >= MAX_FILES) skipped.push({ path, reason: "count" });
    else if (total + bytes.length > MAX_PROJECT_BYTES) skipped.push({ path, reason: "total" });
    else {
      const content = decodeText(bytes);
      if (content === null) skipped.push({ path, reason: "binary" });
      else {
        files.push({ path, content });
        total += bytes.length;
      }
    }
  }
  return { files, skipped };
}

// Service content of macOS archives: the __MACOSX folder, .DS_Store and ._* files.
const archiveNoise = (path: string): boolean =>
  path.split("/").some((part) => part === "__MACOSX" || part === ".DS_Store" || part.startsWith("._"));

// Parsing a .zip archive. If all files lie in one top-level folder named like the archive itself
// (this is how macOS and Windows pack a folder: lesson.zip with a lesson folder), that folder is stripped from the paths.
// A project archive where all files are in one subfolder thus comes back with the same paths.
// An invalid archive is an exception.
export function readArchive(data: Uint8Array, name = ""): Imported {
  const raw = unzipSync(data);
  const entries = Object.entries(raw)
    .filter(([path]) => !path.endsWith("/") && !archiveNoise(path))
    .map(([path, bytes]) => ({ path: path.replace(/^\/+/, ""), bytes }));
  const first = entries[0]?.path.split("/")[0];
  const nested =
    first !== undefined &&
    first === name.replace(/\.zip$/i, "") &&
    entries.every((e) => e.path.startsWith(`${first}/`));
  return importFiles(nested ? entries.map((e) => ({ ...e, path: e.path.slice(first.length + 1) })) : entries);
}

// A project archive: files as is, in UTF-8, project paths.
export function writeArchive(files: readonly ProjectFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.path] = encodeText(file.content);
  return zipSync(entries, { level: 6 });
}

// An export file name from the project name: without characters that file systems dislike.
export function downloadName(name: string, suffix: string): string {
  const base = name.trim().replace(/[\\/:*?"<>|\p{Cc}]+/gu, "_") || "project";
  return `${base}${suffix}`;
}
