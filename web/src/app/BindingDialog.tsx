// The "Pin binding" dialog (spec section 9.3): port bit, direction, pin, pull. The binding
// from the pins field is edited here and goes to the core without a build; when a .cst is active the table is read-only.
// The port list comes from the server with the last build.
import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { boardById } from "../project/assets";
import type { Pull } from "../sim/messages";
import { bindPort, currentBinding, currentSource, editCst, exportCst, fileSource } from "./actions";
import { Choice } from "./kit";
import { Modal, pinLabel } from "./Modal";
import { useApp } from "./state";

const PULLS: readonly Pull[] = ["none", "up", "down"];
// Dense table: small capital headers, rows as tall as the choice list.
const TH = "h-7 px-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase";
const TD = "px-2 py-1 align-top";

export function BindingDialog() {
  // The binding is computed from these state fields: the subscription redraws the table when they change.
  useApp((s) => s.config);
  useApp((s) => s.resolved);
  useApp((s) => s.files);
  const board = useApp((s) => boardById(s.project?.board ?? ""));
  const [problem, setProblem] = useState<{ name: string; code: string } | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const binding = currentBinding();
  const source = currentSource();
  const editable = source.kind === "pins";
  // The project files name a different source than the one the core is configured with: a build is needed.
  const stale = JSON.stringify(fileSource()) !== JSON.stringify(source);
  const pins = Object.entries(board?.pins ?? {}).sort(([a], [b]) => Number(a) - Number(b));

  const change = (name: string, pin: number | null, pull: Pull): void => {
    setProblem(null);
    setExported(null);
    void bindPort(name, pin, pull).then((code) => {
      if (code) setProblem({ name, code });
    });
  };

  return (
    <Modal
      testid="binding"
      title={t("binding.title")}
      wide
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            disabled={!editable || !binding || binding.pins.length === 0}
            onClick={() => {
              void exportCst().then(setExported);
            }}
            data-testid="binding-export"
          >
            <DownloadIcon />
            {t("binding.export")}
          </Button>
          {exported !== null && (
            <span className="min-w-0 text-xs text-success" data-testid="binding-exported">
              {t("binding.exported", { file: exported })}
            </span>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {source.kind === "cst" && (
          <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground" data-testid="binding-source">
            {t("binding.fromCst", { file: source.file })}
            <Button type="button" variant="outline" size="sm" onClick={editCst} data-testid="binding-edit-cst">
              {t("binding.editCst")}
            </Button>
          </p>
        )}
        {source.kind === "ambiguous" && (
          <p className="text-xs text-destructive" data-testid="binding-source">
            {t("binding.ambiguous", { files: source.files })}
          </p>
        )}
        {source.kind === "pins" && (
          <p className="text-xs text-muted-foreground" data-testid="binding-source">
            {t("binding.fromPins")}
          </p>
        )}
        {stale && (
          <p className="rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-warning" data-testid="binding-stale">
            {t("binding.stale")}
          </p>
        )}
        {!binding ? (
          <p className="py-6 text-center text-muted-foreground" data-testid="binding-empty">
            {t("binding.noBuild")}
          </p>
        ) : (
          <Table data-testid="binding-table">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className={TH}>{t("binding.column.port")}</TableHead>
                <TableHead className={TH}>{t("binding.column.dir")}</TableHead>
                <TableHead className={TH}>{t("binding.column.pin")}</TableHead>
                <TableHead className={TH}>{t("binding.column.pull")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {binding.rows.map((row) => {
                const warnings = binding.problems.filter((p) => p.name === row.name);
                return (
                  <TableRow key={row.name} data-port={row.name}>
                    <TableCell className={cn(TD, "pt-2 font-mono")}>{row.name}</TableCell>
                    <TableCell className={cn(TD, "pt-2 text-muted-foreground")}>
                      {t(`binding.dir.${row.dir}`)}
                    </TableCell>
                    <TableCell className={cn(TD, "whitespace-normal")}>
                      <Choice
                        value={row.pin === null ? "" : String(row.pin)}
                        disabled={!editable}
                        label={t("binding.column.pin")}
                        size="sm"
                        className="w-72 font-mono text-xs"
                        onChange={(value) => {
                          change(row.name, value === "" ? null : Number(value), row.pull);
                        }}
                        options={[
                          { value: "", label: t("binding.unbound") },
                          ...pins.map(([pin, info]) => {
                            const user = binding.rows.find((r) => r.pin === Number(pin) && r.name !== row.name);
                            return {
                              value: pin,
                              label: pinLabel(pin, info) + (user ? t("binding.takenBy", { port: user.name }) : ""),
                            };
                          }),
                        ]}
                        testid={`bind-pin-${row.name}`}
                      />
                      {problem?.name === row.name && (
                        <p className="mt-1 max-w-72 text-xs text-destructive" data-testid="bind-error">
                          {t(`binding.refused.${problem.code}` as "binding.refused.twice")}
                        </p>
                      )}
                      {warnings.map((w) => (
                        <p
                          key={w.code}
                          className="mt-1 max-w-72 text-xs text-warning"
                          data-testid="bind-warning"
                          data-code={w.code}
                        >
                          {t(`binding.problem.${w.code}`, { pin: w.pin })}
                        </p>
                      ))}
                    </TableCell>
                    <TableCell className={TD}>
                      <Choice
                        value={row.pull}
                        disabled={!editable || row.pin === null}
                        label={t("binding.column.pull")}
                        size="sm"
                        className="w-24 text-xs"
                        onChange={(value) => {
                          change(row.name, row.pin, value as Pull);
                        }}
                        options={PULLS.map((pull) => ({ value: pull, label: t(`binding.pull.${pull}`) }))}
                        testid={`bind-pull-${row.name}`}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </Modal>
  );
}
