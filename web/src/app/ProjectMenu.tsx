// The project menu in the top bar (spec section 9.3): rename, settings and project export
// (spec section 9.2) as an archive, an open file, or only the changed files. For a project in a folder,
// the "Rebuild on change" switch.
import { ChevronDownIcon, DownloadIcon, PencilIcon, SettingsIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { t } from "../i18n";
import type { ProjectRecord } from "../project/store";
import { downloadProject, openDialog, renameProject, setAutoBuild } from "./actions";
import { Tip } from "./kit";
import { useApp } from "./state";

export function ProjectMenu({ project }: { project: ProjectRecord }) {
  const hasFile = useApp((s) => s.activePath !== null);
  const [open, setOpen] = useState(false);
  const [nothing, setNothing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  // The menu closed for renaming: focus goes to the name field, not back to the menu button.
  const renaming = useRef(false);

  if (editing) {
    const finish = (apply: boolean): void => {
      setEditing(false);
      if (apply) void renameProject(name);
    };
    return (
      <Input
        autoFocus
        className="w-56 font-semibold"
        value={name}
        aria-label={t("workspace.rename")}
        onChange={(event) => {
          setName(event.target.value);
        }}
        onBlur={() => {
          finish(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") finish(true);
          if (event.key === "Escape") finish(false);
        }}
        data-testid="project-name-input"
      />
    );
  }

  // After export the menu closes; if there is nothing to export, it stays open with an explanation.
  const choose = (what: "archive" | "file" | "changed") => (event: Event) => {
    event.preventDefault();
    void downloadProject(what).then((done) => {
      if (done) setOpen(false);
      setNothing(!done && what === "changed");
    });
  };
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setNothing(false);
      }}
    >
      <Tip text={t("workspace.projectMenu")}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" className="max-w-72 font-semibold" data-testid="project-menu">
            <span className="truncate" data-testid="project-name">
              {project.name}
            </span>
            <ChevronDownIcon className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </Tip>
      <DropdownMenuContent
        align="start"
        className="min-w-64"
        onCloseAutoFocus={(event) => {
          if (renaming.current) event.preventDefault();
          renaming.current = false;
        }}
      >
        <DropdownMenuItem
          onSelect={() => {
            renaming.current = true;
            setName(project.name);
            setEditing(true);
          }}
          data-testid="project-rename"
        >
          <PencilIcon />
          {t("workspace.renameItem")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            openDialog({ kind: "settings" });
          }}
          data-testid="settings-open"
        >
          <SettingsIcon />
          {t("workspace.settingsItem")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuGroup data-testid="export-menu">
          <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
            <DownloadIcon className="size-3.5" />
            {t("export.title")}
          </DropdownMenuLabel>
          <DropdownMenuItem inset onSelect={choose("archive")} data-testid="export-archive">
            {t("export.archive")}
          </DropdownMenuItem>
          <DropdownMenuItem inset disabled={!hasFile} onSelect={choose("file")} data-testid="export-file">
            {t("export.file")}
          </DropdownMenuItem>
          <DropdownMenuItem inset onSelect={choose("changed")} data-testid="export-changed">
            {t("export.changed")}
          </DropdownMenuItem>
          {nothing && (
            <p className="py-1 pr-2 pl-8 text-xs text-warning" data-testid="export-nothing">
              {t("export.nothing")}
            </p>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AutoBuild() {
  const autoBuild = useApp((s) => s.folder?.autoBuild);
  if (autoBuild === undefined) return null;
  return (
    <Tip text={t("folder.autoBuildHint")}>
      <label className="flex items-center gap-1.5 whitespace-nowrap text-muted-foreground">
        <Checkbox
          checked={autoBuild}
          onCheckedChange={(checked) => void setAutoBuild(checked === true)}
          data-testid="auto-build"
        />
        {t("folder.autoBuild")}
      </label>
    </Tip>
  );
}
