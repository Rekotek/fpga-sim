// Sync indicators, the mismatch dialog, the exit dialog and messages about a remote project
// (accounts spec sections 4.4, 5.3–5.5, docs/tz-accounts.md).
import {
  CloudAlertIcon,
  CloudCheckIcon,
  CloudOffIcon,
  CloudUploadIcon,
  EyeIcon,
  GitCompareArrowsIcon,
  InfoIcon,
  XIcon,
} from "lucide-react";
import { useEffect, useState, type ComponentType } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import type { SyncState, SyncStatus } from "../project/sync";
import {
  conflictVersions,
  downloadConflict,
  dropSyncNotice,
  keepMine,
  postponeConflict,
  sendAndSignOut,
  showConflicts,
  staySignedIn,
  syncNow,
  takeServer,
} from "./actions";
import { IconButton, Problem, Tip } from "./kit";
import { DialogFrame } from "./Modal";
import { useApp } from "./state";

const ICON: Record<SyncState, [ComponentType<{ className?: string }>, string]> = {
  synced: [CloudCheckIcon, "text-success"],
  pending: [CloudUploadIcon, "text-muted-foreground"],
  syncing: [CloudUploadIcon, "text-primary"],
  offline: [CloudOffIcon, "text-warning"],
  conflict: [GitCompareArrowsIcon, "text-destructive"],
  error: [CloudAlertIcon, "text-destructive"],
};

// Indicator text: the same in the project list tooltip and in the status bar (section 5.4).
export function syncText(status: SyncStatus): string {
  if (status.state === "error") return t("sync.state.error", { text: status.error ?? "" });
  return t(`sync.state.${status.state}`);
}

// State icon in the project list; with no state (access-key sign-in, project in a folder) it is empty.
export function SyncBadge({ id }: { id: string }) {
  const status = useApp((s) => s.sync[id]);
  if (!status) return null;
  const [Icon, tone] = ICON[status.state];
  const text = syncText(status);
  return (
    <Tip text={text}>
      <span
        className={cn("inline-flex items-center", tone)}
        role="img"
        aria-label={text}
        data-testid="project-sync"
        data-state={status.state}
      >
        <Icon className="size-4" />
      </span>
    </Tip>
  );
}

// Indicator as text in the workspace status bar. "Conflict" opens the dialog, "Offline"
// repeats the request.
export function SyncIndicator() {
  const status = useApp((s) => (s.project ? s.sync[s.project.id] : undefined));
  if (!status) return null;
  const [Icon, tone] = ICON[status.state];
  const text = syncText(status);
  const action =
    status.state === "conflict"
      ? { hint: t("sync.showConflict"), run: showConflicts }
      : status.state === "offline"
        ? { hint: t("sync.retry"), run: () => void syncNow() }
        : null;
  const body = (
    <>
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </>
  );
  const common = { "data-testid": "sync-status", "data-state": status.state };
  return action ? (
    <Tip text={action.hint}>
      <button
        type="button"
        className={cn(
          "flex min-w-0 items-center gap-1.5 rounded-sm px-1 underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50",
          tone,
        )}
        onClick={action.run}
        {...common}
      >
        {body}
      </button>
    </Tip>
  ) : (
    <span className={cn("flex min-w-0 items-center gap-1.5 px-1", status.state !== "synced" && tone)} {...common}>
      {body}
    </span>
  );
}

// Message of section 4.4, item 6: the project was deleted on another device. On the projects screen
// the copy is erased; in the workspace the edits are saved as a new project.
export function SyncNotice({ where }: { where: "projects" | "workspace" }) {
  const notice = useApp((s) => s.syncNotice);
  if (notice === null || (notice === "deleted") !== (where === "projects")) return null;
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-warning",
        where === "workspace" && "border-b bg-warning-soft px-3 py-1",
      )}
      role="status"
      data-testid="sync-notice"
      data-kind={notice}
    >
      <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{t(`sync.notice.${notice}`)}</span>
      <IconButton label={t("dialog.close")} size="icon-sm" onClick={dropSyncNotice}>
        <XIcon />
      </IconButton>
    </p>
  );
}

// A strip above the workspace for a temporary copy of another user's project (section 5.6).
export function ViewBanner() {
  const owner = useApp((s) => s.project?.viewOf?.login ?? null);
  if (owner === null) return null;
  return (
    <p
      className="flex items-center gap-2 border-b bg-panel px-3 py-1 text-muted-foreground"
      role="status"
      data-testid="view-banner"
    >
      <EyeIcon className="size-4 shrink-0" aria-hidden="true" />
      {t("view.banner", { login: owner })}
    </p>
  );
}

function Version({ label, text, testid }: { label: string; text: string | null; testid: string }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{label}</h3>
      {text === null ? (
        <p
          className="flex min-h-40 items-center justify-center rounded-md border border-dashed text-muted-foreground"
          data-testid={testid}
          data-deleted="true"
        >
          {t("conflict.deleted")}
        </p>
      ) : (
        <textarea
          readOnly
          spellCheck={false}
          className="min-h-40 w-full flex-1 resize-y rounded-md border bg-background p-2 font-mono text-xs text-foreground"
          rows={14}
          value={text}
          data-testid={testid}
        />
      )}
    </section>
  );
}

// Mismatch dialog for one file (section 5.5). Open while the file path is in the state.
export function ConflictDialog() {
  const path = useApp((s) => s.conflictOpen);
  const more = useApp((s) => Math.max(0, s.conflictPaths.length - 1));
  const [versions, setVersions] = useState<{ path: string; mine: string | null; server: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    void conflictVersions(path).then((found) => {
      if (live) setVersions(found ? { path, ...found } : null);
    });
    return () => {
      live = false;
    };
  }, [path]);
  if (path === null) return null;
  const shown = versions?.path === path ? versions : null;
  const act = (work: (p: string) => Promise<void>) => () => {
    setBusy(true);
    void work(path).finally(() => {
      setBusy(false);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) postponeConflict();
      }}
    >
      <DialogFrame
        testid="conflict-dialog"
        title={t("conflict.title", { path })}
        wide
        footer={
          <>
            {more > 0 && <span className="text-xs text-muted-foreground">{t("conflict.more", { count: more })}</span>}
            <span className="flex-1" />
            <Button type="button" variant="ghost" onClick={postponeConflict} data-testid="conflict-later">
              {t("conflict.later")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!shown}
              onClick={act(downloadConflict)}
              data-testid="conflict-download"
            >
              {t("conflict.download")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !shown}
              onClick={act(takeServer)}
              data-testid="conflict-server"
            >
              {t("conflict.takeServer")}
            </Button>
            <Button type="button" disabled={busy || !shown} onClick={act(keepMine)} data-testid="conflict-mine">
              {t("conflict.keepMine")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3 sm:flex-row" data-path={path} data-testid="conflict-versions">
          <Version label={t("conflict.mine")} text={shown ? shown.mine : ""} testid="conflict-mine-text" />
          <Version label={t("conflict.server")} text={shown ? shown.server : ""} testid="conflict-server-text" />
        </div>
      </DialogFrame>
    </Dialog>
  );
}

// The "Not everything is saved on the server" dialog on sign-out with unsent work (section 5.3).
export function ExitDialog() {
  const ask = useApp((s) => s.exitAsk);
  if (!ask) return null;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) staySignedIn();
      }}
    >
      <DialogFrame
        testid="exit-dialog"
        title={t("exit.title")}
        footer={
          <>
            <span className="flex-1" />
            <Button type="button" variant="outline" onClick={staySignedIn} data-testid="exit-stay">
              {t("exit.stay")}
            </Button>
            <Button type="button" disabled={ask.busy} onClick={() => void sendAndSignOut()} data-testid="exit-send">
              {t(ask.busy ? "exit.sending" : "exit.send")}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p>{t("exit.text")}</p>
          {ask.problem && <Problem data-testid="exit-problem">{ask.problem}</Problem>}
        </div>
      </DialogFrame>
    </Dialog>
  );
}
