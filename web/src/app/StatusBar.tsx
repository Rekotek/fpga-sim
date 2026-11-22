// Status bar (spec section 9.3): simulation state, simulation time, clock cycle number, build result,
// a permanent note on limits with a link to the explanation. Time and clock cycle are read from the last
// frame, bypassing React.
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { t, tOr } from "../i18n";
import { currentSimulation } from "./actions";
import { formatInteger, formatSeconds, simSeconds } from "./format";
import { LimitsButton } from "./LimitsDialog";
import { useApp, type BuildState } from "./state";
import { SyncIndicator } from "./SyncUi";
import { useFrame } from "./useFrame";

function buildText(build: BuildState, now: number): string {
  switch (build.status) {
    case "none":
      return t("status.build.none");
    case "building":
      return t("status.build.building", { seconds: formatSeconds(now - (build.startedAt ?? now)) });
    case "ok":
      return build.cached
        ? t("status.build.cached")
        : t("status.build.ok", { seconds: formatSeconds(build.durationMs ?? 0) });
    case "failed":
      return t("status.build.failed");
    case "error": {
      const args = { code: build.errorCode, text: build.errorText };
      return t("status.build.error", { text: tOr(`error.${build.errorCode ?? ""}`, "error.UNKNOWN", args) });
    }
  }
}

function BuildStatus() {
  const build = useApp((s) => s.build);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (build.status !== "building") return;
    const timer = setInterval(() => {
      setNow(performance.now());
    }, 100);
    return () => {
      clearInterval(timer);
    };
  }, [build.status]);
  const bad = build.status === "failed" || build.status === "error";
  return (
    <span className={cn("truncate", bad && "text-destructive")} data-testid="build-status">
      {buildText(build, now)}
    </span>
  );
}

const DOT: Record<string, string> = {
  running: "bg-success",
  paused: "bg-warning",
  finished: "bg-muted-foreground",
  idle: "bg-muted-foreground/50",
};

export function StatusBar() {
  const runState = useApp((s) => s.sim.run);
  const loaded = useApp((s) => s.sim.loaded);
  const live = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const data = currentSimulation()?.live;
    if (!live.current) return;
    const text = data ? t("status.sim", { seconds: simSeconds(data.timePs), cycle: formatInteger(data.cycle) }) : "";
    if (live.current.textContent !== text) live.current.textContent = text;
  });
  return (
    <footer className="flex items-center gap-4 border-t bg-panel px-2.5 py-1 text-xs text-muted-foreground">
      {loaded ? (
        <span className="flex items-center gap-1.5 whitespace-nowrap" data-state={runState} data-testid="run-state">
          <span className={cn("size-1.5 rounded-full", DOT[runState])} />
          {t(`status.run.${runState}`)}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className={cn("size-1.5 rounded-full", DOT.idle)} />
          {t("status.sim.none")}
        </span>
      )}
      <span className="font-mono whitespace-nowrap tabular-nums" ref={live} />
      <BuildStatus />
      <SyncIndicator />
      <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
        {t("status.limits")}
        <LimitsButton />
      </span>
    </footer>
  );
}
