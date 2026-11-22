// A project in a folder without access (spec section 9.2): after a page reload the browser asks
// for permission again. Until it is granted, a "Reopen folder" button replaces the workspace.
import { FolderOpenIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { t } from "../i18n";
import type { ProjectRecord } from "../project/store";
import { closeProject, reconnectFolder } from "./actions";
import { useApp } from "./state";

export function FolderBanner({ project }: { project: ProjectRecord }) {
  const folder = useApp((s) => s.folder);
  if (!folder || folder.access === "granted") return null;
  // The browser has not yet answered about access: a short moment, so the banner does not flicker.
  if (folder.access === "checking") return <main className="h-full bg-panel" data-testid="folder-checking" />;
  const name = project.folder?.name ?? project.name;
  const text =
    folder.access === "lost"
      ? t("folder.lost", { name, error: folder.error ?? "" })
      : t(folder.access === "denied" ? "folder.denied" : "folder.prompt", { name });
  return (
    <main className="flex h-full items-start justify-center bg-panel px-4 pt-24" data-testid="folder-banner">
      <div className="flex max-w-xl flex-col gap-3 rounded-lg border bg-background p-6">
        <FolderOpenIcon className="size-6 text-muted-foreground" aria-hidden="true" />
        <p className="text-base font-medium" data-testid="folder-banner-text">
          {text}
        </p>
        <p className="text-muted-foreground">{t("folder.blockedHint")}</p>
        <div className="mt-1 flex gap-2">
          <Button type="button" onClick={() => void reconnectFolder()} data-testid="folder-reopen">
            {t("folder.reopen")}
          </Button>
          <Button type="button" variant="outline" onClick={() => void closeProject()}>
            {t("workspace.back")}
          </Button>
        </div>
      </div>
    </main>
  );
}
