// The "Testbench" tab (spec section 9.3): file choice, "Run", text output, compiler messages
// and the "Show waveform" button. The server runs the testbench (spec section 8.3).
import { ActivityIcon, PlayIcon, RefreshCwIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../i18n";
import { currentTestbench, loadFileRoles, runTestbench, selectTestbench, showTestbenchWave } from "./actions";
import { formatInteger, formatSeconds } from "./format";
import { Choice, EmptyState, Problem, Tip, Toolbar } from "./kit";
import { Message } from "./MessagesPanel";
import { useApp, type TestbenchState } from "./state";

// Result line: run state, exit code and time.
function statusText(run: TestbenchState): string {
  if (run.status === "none") return "";
  const seconds = formatSeconds(run.durationMs ?? 0);
  if (run.status === "ok") return t("testbench.status.ok", { code: String(run.exitCode ?? ""), seconds });
  if (run.status === "error") return t("testbench.status.error", { text: run.errorText ?? "" });
  return t(`testbench.status.${run.status}`, { seconds });
}

export function TestbenchPanel() {
  const files = useApp((s) => s.testbenches);
  const run = useApp((s) => s.testbench);
  const selected = useApp(() => currentTestbench());
  // The server decides the testbench list. It is requested when the project opens; if there was no answer
  // (the server did not respond), the tab requests it again.
  useEffect(() => {
    if (files === null) void loadFileRoles();
  }, [files]);
  const running = run.status === "running";
  const passed = run.status === "ok" && run.exitCode === 0;
  const failed = run.status !== "none" && !running && !passed;
  return (
    <section className="flex min-h-0 flex-col" data-testid="testbench">
      <Toolbar className="shrink-0">
        <Button
          type="button"
          size="sm"
          disabled={selected === null || running}
          onClick={() => {
            void runTestbench();
          }}
          data-testid="testbench-run"
        >
          <PlayIcon />
          {t("testbench.run")}
        </Button>
        <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <span>{t("testbench.file")}</span>
          <Choice
            size="sm"
            className="font-mono text-foreground"
            value={selected ?? ""}
            label={t("testbench.file")}
            disabled={!files?.length || running}
            onChange={selectTestbench}
            options={(files ?? []).map((path) => ({ value: path, label: path }))}
            testid="testbench-file"
          />
        </div>
        <Tip text={run.status === "ok" && run.vcd === null ? t("testbench.wave.none") : undefined}>
          <span className="inline-flex">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={run.vcd === null}
              onClick={() => {
                void showTestbenchWave();
              }}
              data-testid="testbench-wave"
            >
              <ActivityIcon />
              {t("testbench.wave")}
            </Button>
          </span>
        </Tip>
        <span
          className={cn(
            "tabular-nums",
            passed ? "font-medium text-success" : failed ? "text-destructive" : "text-muted-foreground",
          )}
          data-testid="testbench-status"
          data-status={run.status}
        >
          {statusText(run)}
        </span>
        {run.status !== "error" && run.errorText !== null && (
          <Problem data-testid="testbench-error">{run.errorText}</Problem>
        )}
      </Toolbar>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {files !== null && files.length === 0 && <EmptyState>{t("testbench.empty")}</EmptyState>}
        {files === null && (
          <EmptyState
            action={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void loadFileRoles();
                }}
              >
                <RefreshCwIcon />
                {t("testbench.retry")}
              </Button>
            }
          >
            <span data-testid="testbench-unknown">{t("testbench.unknown")}</span>
          </EmptyState>
        )}
        {run.diagnostics.length > 0 && (
          <ul className="shrink-0" data-testid="testbench-messages">
            {run.diagnostics.map((diagnostic, i) => (
              <Message key={i} diagnostic={diagnostic} />
            ))}
          </ul>
        )}
        {(run.stdout !== "" || run.truncated) && (
          <pre
            className="m-0 flex-1 bg-terminal px-2 py-1.5 font-mono text-xs leading-[1.4] break-all whitespace-pre-wrap text-terminal-foreground"
            data-testid="testbench-output"
          >
            {run.stdout}
            {run.truncated && (
              <span className="italic opacity-70" data-testid="testbench-truncated">
                {"\n"}
                {t("testbench.truncated", { bytes: formatInteger(new TextEncoder().encode(run.stdout).length) })}
              </span>
            )}
          </pre>
        )}
      </div>
    </section>
  );
}
