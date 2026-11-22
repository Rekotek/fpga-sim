// The "Files" area (spec section 9.3): the project file list, create, rename, delete,
// upload. Create and upload sit in the area header; rename and delete are in the menu of
// the file row (the "⋯" button or right mouse button).
import {
  BracesIcon,
  Binary,
  FileCodeIcon,
  FileIcon,
  MoreHorizontalIcon,
  PinIcon,
  PlusIcon,
  UploadIcon,
} from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { create } from "zustand";
import { Button } from "@/components/ui/button";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { createFile, deleteFile, renameFile, selectFile, uploadFiles, type FileProblem } from "./actions";
import { IconButton, Problem, Tip } from "./kit";
import { useApp } from "./state";
import { TransferReport } from "./Transfer";

type Problem = FileProblem | null;

// What the user is doing with the list now: creating a file, or renaming or deleting the file at path.
type Mode = { kind: "none" } | { kind: "create" } | { kind: "rename"; path: string } | { kind: "delete"; path: string };
const useFileMode = create<{ mode: Mode }>(() => ({ mode: { kind: "none" } }));
const setMode = (mode: Mode): void => {
  useFileMode.setState({ mode });
};
const closeMode = (): void => {
  setMode({ kind: "none" });
};

// File kind by extension (spec section 2.1), for the icon in the list.
type FileKind = "verilog" | "header" | "constraints" | "config" | "data" | "other";
const KINDS: Record<string, FileKind> = {
  v: "verilog",
  sv: "verilog",
  vh: "header",
  svh: "header",
  cst: "constraints",
  json: "config",
  hex: "data",
  mem: "data",
};
const fileKind = (path: string): FileKind => KINDS[/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? ""] ?? "other";

const KIND_ICON: Record<FileKind, [typeof FileIcon, string]> = {
  verilog: [FileCodeIcon, "text-primary"],
  header: [FileCodeIcon, "text-muted-foreground"],
  constraints: [PinIcon, "text-warning"],
  config: [BracesIcon, "text-muted-foreground"],
  data: [Binary, "text-muted-foreground"],
  other: [FileIcon, "text-muted-foreground"],
};

// File name field: Enter applies, Escape cancels; the reason for a refusal shows below the field.
function NameInput(props: { initial: string; apply: (name: string) => Promise<Problem> }) {
  const [name, setName] = useState(props.initial);
  const [problem, setProblem] = useState<Problem>(null);
  const submit = async (): Promise<void> => {
    const result = await props.apply(name);
    if (result) setProblem(result);
    else closeMode();
  };
  return (
    <div className="px-1.5 py-1">
      <Input
        autoFocus
        className="font-mono text-xs"
        value={name}
        aria-label={t("files.name")}
        aria-invalid={problem !== null}
        placeholder={t("files.placeholder")}
        onChange={(event) => {
          setName(event.target.value);
          setProblem(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") void submit();
          if (event.key === "Escape") closeMode();
        }}
        onBlur={closeMode}
        data-testid="file-name-input"
      />
      {problem && (
        <Problem className="mt-1 text-xs" data-testid="file-problem">
          {t(`files.problem.${problem}`)}
        </Problem>
      )}
    </div>
  );
}

// Area actions for its header: new file and upload files into the project.
export function FileActions() {
  const upload = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton
        label={t("files.create")}
        size="icon-sm"
        onClick={() => {
          setMode({ kind: "create" });
        }}
        data-testid="file-create"
      >
        <PlusIcon />
      </IconButton>
      <IconButton
        label={t("files.upload")}
        size="icon-sm"
        onClick={() => upload.current?.click()}
        data-testid="file-upload"
      >
        <UploadIcon />
      </IconButton>
      <input
        ref={upload}
        type="file"
        multiple
        hidden
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) void uploadFiles(files);
        }}
        data-testid="file-upload-input"
      />
    </>
  );
}

function Mark({
  title,
  testid,
  tone = "text-primary",
  children,
}: {
  title: string;
  testid: string;
  tone?: string;
  children: ReactNode;
}) {
  // When space is short, the label shrinks (with an ellipsis), not the file name: the label shrink weight is 1 000 000, the name's is 1.
  // The shortfall is shared by weight times width; with a label weight of 100 the name lost a fraction of a pixel
  // and got an ellipsis. The name weight cannot be below 1: a long name without a label would stop shrinking.
  return (
    <Tip text={title}>
      <span
        className={cn(
          "min-w-8 shrink-[1000000] truncate rounded-sm border border-current/40 px-1 text-[10.5px] leading-4 font-medium",
          tone,
        )}
        data-testid={testid}
      >
        {children}
      </span>
    </Tip>
  );
}

function FileRow({ path, dirty }: { path: string; dirty: boolean }) {
  const active = useApp((s) => s.activePath === path);
  // The server names the file roles: the file with the top module and the testbenches (spec section 2.5).
  const top = useApp((s) => s.topFile === path);
  const testbench = useApp((s) => s.testbenches?.includes(path) ?? false);
  // A file with a mismatch (accounts spec section 5.4, docs/tz-accounts.md).
  const conflict = useApp((s) => s.conflictPaths.includes(path));
  const mode = useFileMode((s) => s.mode);
  const [Icon, tone] = KIND_ICON[fileKind(path)];
  const rename = (): void => {
    setMode({ kind: "rename", path });
  };
  const remove = (): void => {
    setMode({ kind: "delete", path });
  };
  if (mode.kind === "rename" && mode.path === path) {
    return (
      <li>
        <NameInput initial={path} apply={(name) => renameFile(path, name)} />
      </li>
    );
  }
  if (mode.kind === "delete" && mode.path === path) {
    return (
      <li className="flex items-center gap-1 rounded-sm bg-destructive/10 px-1.5 py-0.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">{path}</span>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          autoFocus
          onClick={() => {
            closeMode();
            void deleteFile(path);
          }}
          onBlur={closeMode}
          data-testid="file-delete-confirm"
        >
          {t("files.deleteConfirm")}
        </Button>
      </li>
    );
  }
  return (
    <li>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            className={cn(
              "group flex h-7 items-center rounded-sm hover:bg-accent",
              active && "bg-selected hover:bg-selected",
            )}
          >
            <button
              type="button"
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm pr-1 pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              title={dirty ? t("workspace.unsaved") : undefined}
              aria-current={active}
              onClick={() => {
                selectFile(path);
              }}
              data-testid="file"
            >
              <Icon className={cn("size-3.5 shrink-0", tone)} aria-hidden="true" />
              <span className="min-w-8 flex-auto truncate font-mono text-xs" data-testid="file-path">
                {path}
                {dirty ? " •" : ""}
              </span>
              {conflict && (
                <Mark title={t("files.mark.conflict.title")} testid="file-mark-conflict" tone="text-destructive">
                  {t("files.mark.conflict")}
                </Mark>
              )}
              {top && (
                <Mark title={t("files.mark.top.title")} testid="file-mark-top">
                  {t("files.mark.top")}
                </Mark>
              )}
              {testbench && (
                <Mark title={t("files.mark.testbench.title")} testid="file-mark-testbench">
                  {t("files.mark.testbench")}
                </Mark>
              )}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={cn(
                    "mr-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                    active && "opacity-100",
                  )}
                  aria-label={t("files.actions", { path })}
                  data-testid="file-menu"
                >
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              {/* The menu closed for the name field or a confirmation: focus does not return to the menu button. */}
              <DropdownMenuContent
                align="start"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                }}
              >
                <DropdownMenuItem onSelect={rename} data-testid="file-rename">
                  {t("files.renameItem")}
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={remove} data-testid="file-delete">
                  {t("files.deleteItem")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <ContextMenuItem onSelect={rename}>{t("files.renameItem")}</ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={remove}>
            {t("files.deleteItem")}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </li>
  );
}

export function FileList() {
  const files = useApp((s) => s.files);
  const creating = useFileMode((s) => s.mode.kind === "create");
  return (
    <nav className="overflow-auto">
      <TransferReport />
      {creating && <NameInput initial="" apply={createFile} />}
      {files.length === 0 && !creating && <p className="p-2.5 text-xs text-muted-foreground">{t("files.empty")}</p>}
      <ul className="flex flex-col gap-px p-1">
        {files.map((file) => (
          <FileRow key={file.path} path={file.path} dirty={file.dirty} />
        ))}
      </ul>
    </nav>
  );
}
