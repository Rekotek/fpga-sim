// Screen 1, "Projects" (spec section 9.3): list, new project, example, folder on disk, archive;
// files and an archive can be dropped on the screen (spec section 9.2).
import { ChevronDownIcon, CopyPlusIcon, FolderOpenIcon, PlusIcon, Trash2Icon, UploadIcon, XIcon } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { boardById, listBoards, listExamples } from "../project/assets";
import type { ProjectRecord } from "../project/store";
import { folderSupported } from "../project/folder";
import {
  claimViewProject,
  createEmptyProject,
  createFromExample,
  deleteProject,
  dropAdopted,
  dropBusyProject,
  importArchive,
  importDropped,
  openFolder,
  openProject,
} from "./actions";
import { formatDate } from "./format";
import { HelpButton } from "./HelpDialog";
import { AccountMenu } from "./AccountMenu";
import { LoginForm } from "./LoginForm";
import { IconButton, Tip } from "./kit";
import { useApp } from "./state";
import { SyncBadge, SyncNotice } from "./SyncUi";
import { LanguageToggle, ThemeToggle } from "./TopBar";
import { TransferReport } from "./Transfer";

const examples = listExamples();

// Top right: server state, account menu, theme and help.
export function Status() {
  const serverOk = useApp((s) => s.serverOk);
  const server = serverOk === null ? "server.unknown" : serverOk ? "server.ok" : "server.down";
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-muted-foreground" data-testid="status">
      <span className={cn("flex items-center gap-1.5", serverOk === false && "text-destructive")}>
        <span
          className={cn(
            "size-1.5 rounded-full",
            serverOk === null ? "bg-muted-foreground/50" : serverOk ? "bg-success" : "bg-destructive",
          )}
        />
        {t(server)}
      </span>
      <AccountMenu />
      <span className="flex items-center">
        <LanguageToggle />
        <ThemeToggle />
        <HelpButton />
      </span>
    </div>
  );
}

// The number of projects that sign-in took over from "nobody's" (accounts spec section 4.2, docs/tz-accounts.md), on one line.
function Adopted() {
  const adopted = useApp((s) => s.adopted);
  const access = useApp((s) => s.access);
  if (adopted === 0 || access.kind !== "session") return null;
  return (
    <p className="flex items-center gap-2 text-muted-foreground" data-testid="adopted-notice" data-count={adopted}>
      {t("account.adopted", { login: access.user.login, count: adopted })}
      <IconButton label={t("dialog.close")} size="icon-sm" onClick={dropAdopted}>
        <XIcon />
      </IconButton>
    </p>
  );
}

// The project did not open: it is open in another tab of this browser (accounts spec section 4.3, docs/tz-accounts.md).
function BusyProject() {
  const name = useApp((s) => s.busyProject);
  if (name === null) return null;
  return (
    <p className="flex items-center gap-2 text-warning" role="status" data-testid="project-busy">
      {t("sync.busy", { name })}
      <IconButton label={t("dialog.close")} size="icon-sm" onClick={dropBusyProject}>
        <XIcon />
      </IconButton>
    </p>
  );
}

// Two-click project deletion: the first click asks, the second deletes. A project in a folder is only
// removed from the list: the interface does not touch the folder on disk.
function DeleteButton({ id, folder }: { id: string; folder: boolean }) {
  const [asking, setAsking] = useState(false);
  return asking ? (
    <Button
      type="button"
      variant="destructive"
      size="sm"
      autoFocus
      onClick={() => void deleteProject(id)}
      onBlur={() => {
        setAsking(false);
      }}
      data-testid="project-delete-confirm"
    >
      {t(folder ? "projects.removeFolderConfirm" : "projects.deleteConfirm")}
    </Button>
  ) : (
    <IconButton
      label={t(folder ? "projects.removeFolder" : "projects.delete")}
      size="icon-sm"
      className="text-muted-foreground hover:text-destructive"
      onClick={() => {
        setAsking(true);
      }}
      data-testid="project-delete"
    >
      <Trash2Icon />
    </IconButton>
  );
}

// "New project": choosing a board creates an empty project at once (spec section 9.3).
function NewProjectMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="lg" data-testid="project-new">
          <PlusIcon />
          {t("projects.new")}
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <DropdownMenuLabel className="text-xs text-muted-foreground">{t("projects.new.board")}</DropdownMenuLabel>
        {listBoards().map((board) => (
          <DropdownMenuItem
            key={board.id}
            onSelect={() => void createEmptyProject(board.id)}
            data-board={board.id}
            data-testid="project-new-board"
          >
            {board.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// "From example": the list of the author's lessons and the repository examples; a choice creates a project at once.
function ExampleMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="lg" data-testid="example-menu">
          {t("projects.fromExample")}
          <ChevronDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-56 overflow-y-auto">
        {([true, false] as const).map((lesson, index) => (
          <DropdownMenuGroup key={String(lesson)} data-testid="example-group">
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {t(lesson ? "projects.group.lessons" : "projects.group.examples")}
            </DropdownMenuLabel>
            {examples
              .filter((e) => e.lesson === lesson)
              .map((e) => (
                <DropdownMenuItem
                  key={e.name}
                  className="font-mono text-xs"
                  onSelect={() => void createFromExample(e.name)}
                  data-example={e.name}
                  data-testid="example-item"
                >
                  {e.name}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// "Open folder": in Safari and Firefox the item is visible but disabled, with an explanation (spec section 9.2).
function FolderButton() {
  const supported = folderSupported();
  return (
    <Tip text={supported ? t("projects.openFolderHint") : undefined}>
      <span className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="lg"
          disabled={!supported}
          onClick={() => void openFolder()}
          data-testid="folder-open"
        >
          <FolderOpenIcon />
          {t("projects.openFolder")}
        </Button>
      </span>
    </Tip>
  );
}

function ArchiveButton() {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="lg"
        onClick={() => input.current?.click()}
        data-testid="archive-load"
      >
        <UploadIcon />
        {t("projects.loadArchive")}
      </Button>
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importArchive(file);
        }}
        data-testid="archive-input"
      />
    </>
  );
}

const TH = "px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";
const TD = "px-3 py-1.5";

// Project row: a click opens the project. extra holds the cells that tell the list groups apart.
function ProjectRow({ project, extra, actions }: { project: ProjectRecord; extra: ReactNode; actions?: ReactNode }) {
  return (
    <tr
      className="cursor-pointer border-b last:border-b-0 hover:bg-accent/60"
      onClick={() => void openProject(project.id, true)}
      data-testid={project.viewOf ? "view-row" : "project-row"}
      data-id={project.id}
    >
      <td className={TD}>
        <button
          type="button"
          className="rounded-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring/50"
          title={t("projects.open")}
          data-testid="project-open"
        >
          {project.name}
        </button>
      </td>
      <td className={cn(TD, "text-muted-foreground")}>{boardById(project.board)?.name ?? project.board}</td>
      <td className={cn(TD, "text-muted-foreground tabular-nums")}>{formatDate(project.modified)}</td>
      {extra}
      <td
        className="w-px px-2 py-1 text-right whitespace-nowrap"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <span className="inline-flex items-center gap-1">
          {actions}
          <DeleteButton id={project.id} folder={project.kind === "folder"} />
        </span>
      </td>
    </tr>
  );
}

// Temporary copies of user projects for the administrator (accounts spec section 5.6, docs/tz-accounts.md).
function ViewList({ projects }: { projects: ProjectRecord[] }) {
  if (projects.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-muted-foreground">{t("projects.group.view")}</h2>
      <div className="overflow-hidden rounded-lg border bg-background">
        <table className="w-full border-collapse" data-testid="view-list">
          <thead className="border-b bg-panel">
            <tr>
              <th className={TH}>{t("projects.column.name")}</th>
              <th className={TH}>{t("projects.column.board")}</th>
              <th className={TH}>{t("projects.column.modified")}</th>
              <th className={TH}>{t("projects.column.owner")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <ProjectRow
                key={p.id}
                project={p}
                extra={
                  <td className={cn(TD, "font-mono text-muted-foreground")} data-testid="view-owner">
                    {p.viewOf?.login}
                  </td>
                }
                actions={
                  <IconButton
                    label={t("projects.claim")}
                    size="icon-sm"
                    className="text-muted-foreground"
                    onClick={() => void claimViewProject(p.id)}
                    data-testid="project-claim"
                  >
                    <CopyPlusIcon />
                  </IconButton>
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProjectList() {
  const all = useApp((s) => s.projects);
  const session = useApp((s) => s.access.kind === "session");
  const projects = all.filter((p) => !p.viewOf);
  const views = all.filter((p) => p.viewOf);
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <NewProjectMenu />
        <ExampleMenu />
        <FolderButton />
        <ArchiveButton />
      </div>
      {!folderSupported() && (
        <p className="text-xs text-muted-foreground" data-testid="folder-unsupported">
          {t("projects.noFolder")}
        </p>
      )}
      <Adopted />
      <BusyProject />
      <SyncNotice where="projects" />
      <TransferReport />
      {projects.length === 0 ? (
        <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-6 py-12 text-center">
          <p className="text-base font-medium">{t("projects.emptyTitle")}</p>
          <p className="text-muted-foreground">{t("projects.empty")}</p>
          <p className="mt-2 text-xs text-muted-foreground">{t("projects.dropHint")}</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border bg-background">
            <table className="w-full border-collapse" data-testid="project-list">
              <thead className="border-b bg-panel">
                <tr>
                  <th className={TH}>{t("projects.column.name")}</th>
                  <th className={TH}>{t("projects.column.board")}</th>
                  <th className={TH}>{t("projects.column.modified")}</th>
                  <th className={TH}>{t("projects.column.kind")}</th>
                  {session && <th className={TH}>{t("projects.column.sync")}</th>}
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <ProjectRow
                    key={p.id}
                    project={p}
                    extra={
                      <>
                        <td className={cn(TD, "text-muted-foreground")}>
                          {t(p.kind === "browser" ? "projects.kind.browser" : "projects.kind.folder")}
                        </td>
                        {session && (
                          <td className={TD}>
                            <SyncBadge id={p.id} />
                          </td>
                        )}
                      </>
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("projects.dropHint")}</p>
        </>
      )}
      <ViewList projects={views} />
    </section>
  );
}

// Files dropped on the screen: an archive or project files.
function onDrop(event: DragEvent): void {
  event.preventDefault();
  const files = [...event.dataTransfer.files];
  if (files.length > 0) void importDropped(files);
}

export function ProjectsScreen() {
  const authStatus = useApp((s) => s.authStatus);
  return (
    <main
      className="min-h-full bg-panel"
      onDragOver={(event) => {
        event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-8">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[11px] font-medium tracking-widest text-muted-foreground uppercase">
              {t("app.title")}
            </p>
            <h1 className="text-xl font-semibold">{t("projects.title")}</h1>
          </div>
          <Status />
        </header>
        {authStatus === "ok" ? <ProjectList /> : authStatus === "checking" ? null : <LoginForm />}
      </div>
    </main>
  );
}
