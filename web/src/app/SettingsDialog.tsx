// The "Project settings" dialog (spec section 9.3): board, top module, parameters, macros, design files,
// pin binding file, visibility mode. It writes the design field of fpgasim.json; the design settings
// take effect with the next build.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "../i18n";
import { DEFAULT_BOARD, boardById, listBoards } from "../project/assets";
import { parsePairs, printPairs, type DesignConfig } from "../project/config";
import { openDialog, updateConfig } from "./actions";
import { FieldProblem, FormGrid, FormNote, FormRow } from "./form";
import { Choice } from "./kit";
import { Modal } from "./Modal";
import { useApp } from "./state";

const FORM = "settings-form";
// A multi-line field: file, parameter and macro names are monospace.
const AREA = "min-h-0 resize-y font-mono text-xs";

export function SettingsDialog() {
  const design = useApp((s) => s.config?.design);
  const broken = useApp((s) => s.config === null);
  const current = useApp((s) => s.project?.board ?? DEFAULT_BOARD);
  const files = useApp((s) => s.files);
  // Candidates from the TOP_AMBIGUOUS message of the last build or check are a hint for the field.
  const found = useApp((s) => s.diagnostics.find((d) => d.code === "TOP_AMBIGUOUS")?.args?.candidates);
  const candidates = Array.isArray(found) ? found.map(String) : [];
  const resolved = useApp((s) => s.resolved);
  const csts = files.map((f) => f.path).filter((path) => path.endsWith(".cst"));
  const [board, setBoard] = useState(current);
  const [top, setTop] = useState(design?.top ?? "");
  const [visibility, setVisibility] = useState(design?.visibility ?? "ports");
  const [constraints, setConstraints] = useState(
    design?.constraints === false ? "false" : typeof design?.constraints === "string" ? design.constraints : "",
  );
  const [sources, setSources] = useState((design?.files ?? []).join("\n"));
  const [parameters, setParameters] = useState(printPairs(design?.parameters, "parameters"));
  const [defines, setDefines] = useState(printPairs(design?.defines, "defines"));
  const [failed, setFailed] = useState(false);

  const parsedParameters = parsePairs(parameters, "parameters");
  const parsedDefines = parsePairs(defines, "defines");
  const topValid = top.trim() === "" || /^[A-Za-z_][A-Za-z0-9_$]*$/.test(top.trim());
  const valid = parsedParameters !== null && parsedDefines !== null && topValid && !broken;

  const save = async (): Promise<void> => {
    if (!parsedParameters || !parsedDefines) return;
    const list = sources
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "");
    const done = await updateConfig((config) => {
      const fields = new Map<string, unknown>(Object.entries(config.design ?? {}));
      // The default value is not written to the file: the field is removed.
      const put = (name: keyof DesignConfig & string, value: unknown, empty: boolean): void => {
        if (empty) fields.delete(name);
        else fields.set(name, value);
      };
      put("top", top.trim(), top.trim() === "");
      put("visibility", visibility, visibility === "ports");
      put("constraints", constraints === "false" ? false : constraints, constraints === "");
      put("files", list, list.length === 0);
      put("parameters", parsedParameters, Object.keys(parsedParameters).length === 0);
      put("defines", parsedDefines, Object.keys(parsedDefines).length === 0);
      // The board field changes only if the board was changed. The default board is not written to the file,
      // as for an empty project under 20K (decision 161).
      if (board !== current && board === DEFAULT_BOARD) delete config.board;
      else if (board !== current) config.board = board;
      if (fields.size > 0) config.design = Object.fromEntries(fields);
      else delete config.design;
    });
    if (done) openDialog(null);
    else setFailed(true);
  };

  const constraintFiles = [
    ...new Set([...csts, ...(constraints !== "" && constraints !== "false" ? [constraints] : [])]),
  ];

  return (
    <Modal
      testid="settings"
      title={t("settings.title")}
      footer={
        <>
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">{t("settings.rebuild")}</p>
          <Button type="submit" form={FORM} disabled={!valid} data-testid="settings-save">
            {t("dialog.save")}
          </Button>
        </>
      }
    >
      <FormGrid
        id={FORM}
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) void save();
        }}
      >
        <FormRow label={t("settings.board")}>
          <Choice
            value={board}
            label={t("settings.board")}
            onChange={setBoard}
            options={listBoards().map((item) => ({ value: item.id, label: item.name }))}
            testid="settings-board"
          />
        </FormRow>
        {board !== current && (
          <FormNote tone="warning" data-testid="settings-board-note">
            {t("settings.boardChanged", { board: boardById(current)?.name ?? current })}
          </FormNote>
        )}
        <FormRow label={t("settings.top")} htmlFor="settings-top">
          <Input
            id="settings-top"
            className="font-mono"
            value={top}
            list="settings-top-candidates"
            placeholder={t("settings.auto")}
            aria-invalid={!topValid}
            onChange={(event) => {
              setTop(event.target.value);
            }}
            data-testid="settings-top"
          />
          <datalist id="settings-top-candidates">
            {candidates.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
          {!topValid && <FieldProblem>{t("settings.badTop")}</FieldProblem>}
        </FormRow>
        <FormRow label={t("settings.visibility")}>
          <Choice
            value={visibility}
            label={t("settings.visibility")}
            onChange={(value) => {
              setVisibility(value as "all" | "ports");
            }}
            options={[
              { value: "ports", label: t("settings.visibility.ports") },
              { value: "all", label: t("settings.visibility.all") },
            ]}
            testid="settings-visibility"
          />
        </FormRow>
        <FormRow label={t("settings.constraints")}>
          <Choice
            value={constraints}
            label={t("settings.constraints")}
            onChange={setConstraints}
            options={[
              { value: "", label: t("settings.constraints.auto") },
              { value: "false", label: t("settings.constraints.none") },
              ...constraintFiles.map((path) => ({ value: path, label: path })),
            ]}
            testid="settings-constraints"
          />
        </FormRow>
        <FormRow label={t("settings.files")} htmlFor="settings-files">
          <Textarea
            id="settings-files"
            className={AREA}
            rows={3}
            value={sources}
            placeholder={t("settings.filesHint")}
            onChange={(event) => {
              setSources(event.target.value);
            }}
            data-testid="settings-files"
          />
        </FormRow>
        <FormRow label={t("settings.parameters")} htmlFor="settings-parameters">
          <Textarea
            id="settings-parameters"
            className={AREA}
            rows={3}
            value={parameters}
            placeholder={t("settings.pairsHint")}
            aria-invalid={parsedParameters === null}
            onChange={(event) => {
              setParameters(event.target.value);
            }}
            data-testid="settings-parameters"
          />
          {parsedParameters === null && <FieldProblem>{t("settings.badPairs")}</FieldProblem>}
        </FormRow>
        <FormRow label={t("settings.defines")} htmlFor="settings-defines">
          <Textarea
            id="settings-defines"
            className={AREA}
            rows={3}
            value={defines}
            placeholder={t("settings.definesHint")}
            aria-invalid={parsedDefines === null}
            onChange={(event) => {
              setDefines(event.target.value);
            }}
            data-testid="settings-defines"
          />
          {parsedDefines === null && <FieldProblem>{t("settings.badPairs")}</FieldProblem>}
        </FormRow>
        {resolved?.top !== undefined && (
          <FormNote className="border-t pt-3" data-testid="settings-resolved">
            {t("settings.resolved", {
              top: resolved.top,
              files: resolved.files ?? [],
              testbenches: resolved.testbenches?.length ? resolved.testbenches : t("settings.none"),
              constraints: resolved.constraints ?? t("settings.none"),
            })}
          </FormNote>
        )}
        {(broken || failed) && <FormNote tone="problem">{t("config.broken")}</FormNote>}
      </FormGrid>
    </Modal>
  );
}
