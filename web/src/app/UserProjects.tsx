// A user's projects on the "Users" page (accounts spec section 5.6, docs/tz-accounts.md): name, board,
// change time, the "in trash" flag and the time until erasure; "Open to view" and "Restore
// from trash".
import { ArchiveRestoreIcon, EyeIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { AdminProject } from "../build/client";
import { t } from "../i18n";
import { boardById } from "../project/assets";
import { closeUserProjects, restoreUserProject, viewUserProject } from "./actions";
import { purgeDays } from "./accounts";
import { formatDate } from "./format";
import { Problem } from "./kit";
import { DialogFrame } from "./Modal";
import { useApp } from "./state";

const TH = "px-3 py-2 text-left text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";
const TD = "px-3 py-1.5";

function stateText(project: AdminProject): string {
  if (project.purged) return t("userProjects.purged");
  if (project.deletedAt !== undefined) return t("userProjects.trash", { days: purgeDays(project.deletedAt) });
  return t("userProjects.active");
}

function Row({
  project,
  busy,
  run,
}: {
  project: AdminProject;
  busy: boolean;
  run: (work: () => Promise<string | null>) => void;
}) {
  const trashed = project.deletedAt !== undefined || project.purged;
  return (
    <tr
      className={cn("border-b last:border-b-0", trashed && "text-muted-foreground")}
      data-testid="user-project-row"
      data-id={project.id}
      data-trashed={String(trashed)}
    >
      <td className={cn(TD, "font-medium")}>{project.name}</td>
      <td className={cn(TD, "whitespace-nowrap text-muted-foreground")}>
        {boardById(project.board)?.name ?? project.board}
      </td>
      <td className={cn(TD, "whitespace-nowrap text-muted-foreground tabular-nums")}>{formatDate(project.modified)}</td>
      <td className={cn(TD, trashed && "text-warning")} data-testid="user-project-state">
        {stateText(project)}
      </td>
      <td className="w-px px-2 py-1 text-right whitespace-nowrap">
        <span className="inline-flex gap-1">
          {project.deletedAt !== undefined && !project.purged && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                run(() => restoreUserProject(project.id));
              }}
              data-testid="user-project-restore"
            >
              <ArchiveRestoreIcon />
              {t("userProjects.restore")}
            </Button>
          )}
          {!project.purged && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                run(() => viewUserProject(project.id));
              }}
              data-testid="user-project-view"
            >
              <EyeIcon />
              {t("userProjects.view")}
            </Button>
          )}
        </span>
      </td>
    </tr>
  );
}

export function UserProjectsDialog() {
  const list = useApp((s) => s.userProjects);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!list) return null;
  const run = (work: () => Promise<string | null>) => {
    setBusy(true);
    setProblem(null);
    void work().then((error) => {
      setBusy(false);
      setProblem(error);
    });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeUserProjects();
      }}
    >
      <DialogFrame testid="user-projects-dialog" title={t("userProjects.title", { login: list.login })} wide>
        <div className="flex flex-col gap-3">
          {list.error && <Problem data-testid="user-projects-problem">{list.error}</Problem>}
          {problem && <Problem data-testid="user-projects-problem">{problem}</Problem>}
          {list.projects === null ? (
            !list.error && <p className="text-muted-foreground">{t("userProjects.loading")}</p>
          ) : list.projects.length === 0 ? (
            <p className="text-muted-foreground" data-testid="user-projects-empty">
              {t("userProjects.empty")}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-background">
              <table className="w-full border-collapse" data-testid="user-project-list">
                <thead className="border-b bg-panel">
                  <tr>
                    <th className={TH}>{t("projects.column.name")}</th>
                    <th className={TH}>{t("projects.column.board")}</th>
                    <th className={TH}>{t("projects.column.modified")}</th>
                    <th className={TH}>{t("userProjects.column.state")}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.projects.map((project) => (
                    <Row key={project.id} project={project} busy={busy} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </DialogFrame>
    </Dialog>
  );
}
