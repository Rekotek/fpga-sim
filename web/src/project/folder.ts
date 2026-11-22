// A project in a folder on disk (spec section 9.2): the File System Access API in Chrome and Edge.
// The module only reads and writes files; what follows for the project is decided by actions.ts.
import { MAX_FILES, decodeText, encodeText, folderDirWanted, folderFileWanted, MAX_FILE_BYTES } from "./files";

type Access = "granted" | "prompt" | "denied";

// Parts of the API missing from the TypeScript DOM descriptions.
interface PermissionHandle {
  queryPermission?(options: { mode: "readwrite" }): Promise<Access>;
  requestPermission?(options: { mode: "readwrite" }): Promise<Access>;
}

type DirectoryPicker = (options?: { mode?: "readwrite"; id?: string }) => Promise<FileSystemDirectoryHandle>;

const picker = (): DirectoryPicker | undefined =>
  (window as unknown as { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;

// The browser can open a folder: Safari and Firefox have no showDirectoryPicker.
export const folderSupported = (): boolean => typeof picker() === "function";

// Folder choice by the user. null means the choice was canceled.
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  const show = picker();
  if (!show) return null;
  try {
    return await show({ mode: "readwrite", id: "fpgasim" });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

// Permission to read and write. request means ask the user (needs a user click).
export async function folderAccess(dir: FileSystemDirectoryHandle, request: boolean): Promise<Access> {
  const handle = dir as unknown as PermissionHandle;
  const options = { mode: "readwrite" } as const;
  // Without these methods (private browser storage in old versions) access is always granted.
  const now = handle.queryPermission ? await handle.queryPermission(options) : "granted";
  if (now === "granted" || !request || !handle.requestPermission) return now;
  return handle.requestPermission(options);
}

export interface DiskFile {
  path: string;
  modified: number; // lastModified, ms
  size: number;
  file: FileSystemFileHandle;
}

// Folder walk: project files (decision 96) with the modification time. Depth is limited, the walk
// stops at the file count limit with a margin: the rest would not fit into the project anyway.
export async function scanFolder(dir: FileSystemDirectoryHandle): Promise<DiskFile[]> {
  const out: DiskFile[] = [];
  const walk = async (at: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
    const entries: [string, FileSystemHandle][] = [];
    for await (const entry of at.entries()) entries.push(entry);
    entries.sort((a, b) => a[0].localeCompare(b[0]));
    for (const [name, handle] of entries) {
      if (out.length > MAX_FILES) return;
      const path = prefix + name;
      if (handle.kind === "directory") {
        if (depth < 8 && folderDirWanted(name)) await walk(handle as FileSystemDirectoryHandle, `${path}/`, depth + 1);
      } else if (!name.startsWith(".") && folderFileWanted(path)) {
        const file = handle as FileSystemFileHandle;
        const data = await file.getFile();
        out.push({ path, modified: data.lastModified, size: data.size, file });
      }
    }
  };
  await walk(dir, "", 0);
  return out;
}

// The file text from disk or null: the file is not UTF-8 or is larger than the server limit.
export async function readDiskFile(file: FileSystemFileHandle): Promise<string | null> {
  const data = await file.getFile();
  if (data.size > MAX_FILE_BYTES) return null;
  return decodeText(new Uint8Array(await data.arrayBuffer()));
}

async function parentOf(
  dir: FileSystemDirectoryHandle,
  path: string,
  create: boolean,
): Promise<[FileSystemDirectoryHandle, string]> {
  const parts = path.split("/");
  const name = parts.pop() ?? path;
  let at = dir;
  for (const part of parts) at = await at.getDirectoryHandle(part, { create });
  return [at, name];
}

// Writes a file; folders on the path are created. Returns the file stamp after the write.
export async function writeDiskFile(
  dir: FileSystemDirectoryHandle,
  path: string,
  text: string,
): Promise<{ modified: number; size: number }> {
  const [parent, name] = await parentOf(dir, path, true);
  const file = await parent.getFileHandle(name, { create: true });
  const writable = await file.createWritable();
  await writable.write(encodeText(text) as Uint8Array<ArrayBuffer>);
  await writable.close();
  const data = await file.getFile();
  return { modified: data.lastModified, size: data.size };
}

// Whether the folder has a file or folder at that path.
export async function diskHas(dir: FileSystemDirectoryHandle, path: string): Promise<boolean> {
  try {
    const [parent, name] = await parentOf(dir, path, false);
    for await (const entry of parent.keys()) if (entry === name) return true;
    return false;
  } catch (e) {
    if (e instanceof DOMException && (e.name === "NotFoundError" || e.name === "TypeMismatchError")) return false;
    throw e;
  }
}

// File deletion. If the file is already gone, it is not an error.
export async function removeDiskFile(dir: FileSystemDirectoryHandle, path: string): Promise<void> {
  try {
    const [parent, name] = await parentOf(dir, path, false);
    await parent.removeEntry(name);
  } catch (e) {
    if (!(e instanceof DOMException && e.name === "NotFoundError")) throw e;
  }
}
