// Screen 2, "Workspace" (spec section 9.3): top bar, the "Files" area, the editor and the "Board" area
// with movable borders, a bottom panel with tabs, a status bar. Any of the three top
// areas can be collapsed; the layout is remembered per project.
import { useEffect, useRef, type DragEvent, type ReactNode } from "react";
import { ChevronsLeftIcon, ChevronsRightIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BoardActions, BoardView } from "../board/BoardView";
import { t } from "../i18n";
import type { ProjectRecord } from "../project/store";
import { build, editor, save, setLayout, uploadFiles } from "./actions";
import { BindingDialog } from "./BindingDialog";
import { FileActions, FileList } from "./FileList";
import { IconButton, Tip } from "./kit";
import { resizeLayout, toggleArea, type Area, type Edge } from "./layout";
import { MessagesPanel } from "./MessagesPanel";
import { NetsTable } from "./NetsTable";
import { PartDialog } from "./PartDialog";
import { SettingsDialog } from "./SettingsDialog";
import { SignalsPanel } from "./SignalsPanel";
import { useApp, type BottomTab } from "./state";
import { TerminalPanel } from "./TerminalPanel";
import { TestbenchPanel } from "./TestbenchPanel";
import { boardById } from "../project/assets";
import { projectParts } from "../project/config";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { WavePanel } from "./WavePanel";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { diagnosticLevel } from "./diagnostics";
import { FolderBanner } from "./FolderBanner";
import { SessionBanner } from "./SessionBanner";
import { ConflictDialog, SyncNotice, ViewBanner } from "./SyncUi";

const COLLAPSED = "28px";
const SPLIT = "3px";

function EditorPane() {
  const place = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!place.current) return;
    editor.mount(place.current);
    return () => {
      editor.unmount();
    };
  }, []);
  return <div className="editor min-h-0 min-w-0 overflow-hidden" ref={place} data-testid="editor" />;
}

// Border between areas: dragging resizes the neighboring area.
function Splitter({ edge }: { edge: Edge }) {
  const start = useRef<{ at: number; size: number } | null>(null);
  const vertical = edge === "bottom";
  return (
    <div
      className={cn(
        "touch-none bg-border transition-colors hover:bg-primary active:bg-primary",
        vertical ? "cursor-row-resize" : "cursor-col-resize",
      )}
      role="separator"
      aria-orientation={vertical ? "horizontal" : "vertical"}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { at: vertical ? event.clientY : event.clientX, size: useApp.getState().layout[edge] };
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const from = start.current;
        if (!from) return;
        const delta = (vertical ? event.clientY : event.clientX) - from.at;
        // "Files" grows to the right; "Board" and the bottom panel grow the other way.
        const size = edge === "files" ? from.size + delta : from.size - delta;
        setLayout(resizeLayout(useApp.getState().layout, edge, size, { width: innerWidth, height: innerHeight }));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
      data-testid={`splitter-${edge}`}
    />
  );
}

// A workspace area: a header with a title and area actions, a collapse button.
function AreaFrame(props: { area: Area; title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  const { area } = props;
  const collapsed = useApp((s) => s.layout.collapsed[area]);
  const toggle = (): void => {
    setLayout(toggleArea(useApp.getState().layout, area));
  };
  if (collapsed) {
    return (
      <section className="grid min-h-0 min-w-0" data-testid={`area-${area}`}>
        <Tip text={t("area.expand")}>
          <button
            type="button"
            className="flex flex-col items-center gap-2 bg-panel py-2 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label={t("area.expand")}
            onClick={toggle}
            data-testid={`area-toggle-${area}`}
          >
            <ChevronsRightIcon className="size-3.5" />
            <span className="text-[11px] font-semibold tracking-wider uppercase [writing-mode:vertical-rl]">
              {t(`area.${area}`)}
            </span>
          </button>
        </Tip>
      </section>
    );
  }
  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)]" data-testid={`area-${area}`}>
      <header className="flex h-8 items-center gap-1 border-b bg-panel pr-1 pl-2.5">
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
          {props.title ?? t(`area.${area}`)}
        </h3>
        {props.actions}
        <IconButton label={t("area.collapse")} size="icon-sm" onClick={toggle} data-testid={`area-toggle-${area}`}>
          <ChevronsLeftIcon />
        </IconButton>
      </header>
      <div className="grid min-h-0 min-w-0 overflow-hidden">{props.children}</div>
    </section>
  );
}

// Header of the editor area: the open file name and a mark for an unsaved edit.
function EditorTitle() {
  const active = useApp((s) => s.activePath);
  const dirty = useApp((s) => s.files.some((f) => f.path === s.activePath && f.dirty));
  if (active === null) return t("area.editor");
  return (
    <span
      className="font-mono text-xs font-medium tracking-normal text-foreground normal-case"
      title={dirty ? t("workspace.unsaved") : undefined}
    >
      {active}
      {dirty && <span className="ml-1.5 text-warning">{t("symbol.dirty")}</span>}
    </span>
  );
}

function BottomPanel() {
  const tab = useApp((s) => s.bottomTab);
  const count = useApp((s) => s.diagnostics.filter((d) => diagnosticLevel(d) !== "hidden").length + s.notices.length);
  // The counter is red if the messages include an error, otherwise yellow.
  const hasError = useApp((s) => s.diagnostics.some((d) => diagnosticLevel(d) === "error"));
  const config = useApp((s) => s.config);
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  // One tab per enabled UART part, on the terminal tab (spec section 9.3).
  const assistant = useApp((s) => s.assistant?.enabled === true);
  const uarts = board ? projectParts(board, config).filter((p) => p.type === "uart" && p.enabled) : [];
  const terminal = tab.startsWith("terminal:") ? uarts.find((p) => `terminal:${p.id}` === tab) : undefined;
  // The tab's part was removed or disabled: the messages show.
  const fixed =
    tab === "nets" || tab === "signals" || tab === "waves" || tab === "testbench" || (assistant && tab === "assistant");
  const shown: BottomTab = fixed || terminal ? tab : "messages";
  const tabs: { id: BottomTab; testid: string; label: ReactNode }[] = [
    {
      id: "messages",
      testid: "tab-messages",
      label: (
        <>
          <span aria-hidden="true">{t("messages.title")}</span>
          <span className="sr-only">{t("messages.count", { count })}</span>
          {count > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "rounded-full px-1.5 font-mono text-[11px] leading-4 font-medium",
                hasError ? "bg-destructive/12 text-destructive" : "bg-warning-soft text-warning",
              )}
              data-testid="messages-count"
            >
              {count}
            </span>
          )}
        </>
      ),
    },
    { id: "nets", testid: "tab-nets", label: t("nets.title") },
    { id: "signals", testid: "tab-signals", label: t("signals.title") },
    { id: "waves", testid: "tab-waves", label: t("waves.title") },
    { id: "testbench", testid: "tab-testbench", label: t("testbench.title") },
    ...(assistant ? [{ id: "assistant" as BottomTab, testid: "tab-assistant", label: t("assistant.title") }] : []),
    ...uarts.map((p) => ({
      id: `terminal:${p.id}` as BottomTab,
      testid: `tab-terminal-${p.id}`,
      label: t("terminal.tab", { label: p.label }),
    })),
  ];
  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
      <div className="flex gap-0.5 overflow-x-auto border-b bg-panel px-1.5" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={shown === item.id}
            className={cn(
              "-mb-px flex h-8 items-center gap-1.5 border-b-2 border-transparent px-2.5 font-medium whitespace-nowrap text-muted-foreground outline-none hover:text-foreground focus-visible:bg-accent",
              shown === item.id && "border-primary text-foreground",
            )}
            onClick={() => {
              useApp.setState({ bottomTab: item.id });
            }}
            data-testid={item.testid}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="grid min-h-0 min-w-0 overflow-hidden">
        {terminal ? (
          <TerminalPanel key={terminal.id} part={terminal.id} />
        ) : shown === "nets" ? (
          <NetsTable />
        ) : shown === "signals" ? (
          <SignalsPanel />
        ) : shown === "waves" ? (
          <WavePanel />
        ) : shown === "testbench" ? (
          <TestbenchPanel />
        ) : shown === "assistant" ? (
          <AssistantPanel />
        ) : (
          <MessagesPanel />
        )}
      </div>
    </div>
  );
}

// Workspace shortcuts: Ctrl/Cmd+Enter builds, Ctrl/Cmd+S saves.
// The editor handles them itself and marks the event as handled.
function useHotkeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || !(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key === "Enter") void build();
      // The key is also recognized by position: in the Russian layout it types "ы".
      else if (event.key.toLowerCase() === "s" || event.code === "KeyS") void save();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}

// Workspace dialogs: the one whose kind is in the state is open. The key recreates the part form
// when moving from one part to another.
function Dialogs() {
  const dialog = useApp((s) => s.dialog);
  if (dialog?.kind === "binding") return <BindingDialog />;
  if (dialog?.kind === "settings") return <SettingsDialog />;
  if (dialog?.kind === "part") return <PartDialog key={dialog.part ?? ""} part={dialog.part} />;
  return null;
}

export function Workspace({ project }: { project: ProjectRecord }) {
  const blocked = useApp((s) => s.folder !== null && s.folder.access !== "granted");
  if (!blocked) return <Desk project={project} />;
  return (
    <div className="flex h-full flex-col">
      <SessionBanner />
      <div className="min-h-0 flex-1">
        <FolderBanner project={project} />
      </div>
    </div>
  );
}

// Dragging files from disk into an open project (decision 166): dropped files are uploaded,
// like the "Upload files to project" button. The handlers run in the capture phase and cancel
// the event: CodeMirror skips a canceled event and does not insert the file text into the open file.
// A drag without files (selected text inside the editor) is left alone.
function hasFiles(event: DragEvent): boolean {
  return event.dataTransfer.types.includes("Files");
}

const setOver = (fileDrop: boolean): void => {
  useApp.setState({ fileDrop });
};

const dropHandlers = {
  onDragOverCapture: (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!useApp.getState().fileDrop) setOver(true);
  },
  onDragLeaveCapture: (event: DragEvent) => {
    // The pointer left the workspace, rather than moving to a neighboring element inside it.
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
  },
  onDropCapture: (event: DragEvent) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setOver(false);
    const files = [...event.dataTransfer.files];
    if (files.length > 0) void uploadFiles(files);
  },
};

function DropHint() {
  return (
    <div
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-6"
      data-testid="file-drop-hint"
    >
      <p className="rounded-lg border-2 border-dashed border-primary bg-panel px-6 py-4 font-medium shadow-sm">
        {t("files.dropHint")}
      </p>
    </div>
  );
}

function Desk({ project }: { project: ProjectRecord }) {
  const layout = useApp((s) => s.layout);
  const fileDrop = useApp((s) => s.fileDrop);
  useHotkeys();
  // The project was closed during a drag: the hint must not outlive the workspace.
  useEffect(
    () => () => {
      setOver(false);
    },
    [],
  );
  const { files, editor: editorOff, board } = layout.collapsed;
  // Free space goes to the editor; if it is collapsed, to the board; if that is collapsed too, to the files.
  const columns = [
    files ? COLLAPSED : editorOff && board ? "minmax(0, 1fr)" : `${String(layout.files)}px`,
    SPLIT,
    editorOff ? COLLAPSED : "minmax(0, 1fr)",
    SPLIT,
    board ? COLLAPSED : editorOff ? "minmax(0, 1fr)" : `${String(layout.board)}px`,
  ].join(" ");
  return (
    <div
      className="grid h-full"
      style={{ gridTemplateRows: `auto auto minmax(0, 1fr) ${SPLIT} ${String(layout.bottom)}px auto` }}
      {...dropHandlers}
      data-testid="workspace"
    >
      {/* The "Session ended" strip (accounts spec section 5.2, docs/tz-accounts.md), "Project deleted on another
          device" (section 4.4) and "Copy for viewing" (section 5.6); without them the row is empty. */}
      <div>
        <SessionBanner />
        <SyncNotice where="workspace" />
        <ViewBanner />
      </div>
      <TopBar project={project} />
      <div className="grid min-h-0" style={{ gridTemplateColumns: columns }}>
        <AreaFrame area="files" actions={<FileActions />}>
          <FileList />
        </AreaFrame>
        <Splitter edge="files" />
        <AreaFrame area="editor" title={<EditorTitle />}>
          <EditorPane />
        </AreaFrame>
        <Splitter edge="board" />
        <AreaFrame area="board" actions={<BoardActions />}>
          <BoardView />
        </AreaFrame>
      </div>
      <Splitter edge="bottom" />
      <BottomPanel />
      <StatusBar />
      <Dialogs />
      <ConflictDialog />
      {fileDrop && <DropHint />}
    </div>
  );
}
