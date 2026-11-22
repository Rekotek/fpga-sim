// Top bar (spec section 9.3) in the order of work: project, build and its state, simulation
// control (run or pause, step, reset), speed and the actual ratio; on the right, theme and help.
import {
  ChevronLeftIcon,
  HammerIcon,
  LanguagesIcon,
  MonitorIcon,
  MoonIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  SunIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { currentLanguage, setLanguage, t, type Language } from "../i18n";
import type { ProjectRecord } from "../project/store";
import { build, closeProject, currentSimulation, pause, resetSimulation, runOrBuild, setSpeed, step } from "./actions";
import { formatRatio } from "./format";
import { HelpButton } from "./HelpDialog";
import { Choice, IconButton, Tip } from "./kit";
import { AutoBuild, ProjectMenu } from "./ProjectMenu";
import { SPEEDS, STEP_CHOICES, parseSpeed, speedLabel, speedValue, stepCommand, type StepChoice } from "./speed";
import { useApp } from "./state";
import { setTheme, useTheme, type ThemeChoice } from "./theme";
import { useFrame } from "./useFrame";

function Divider() {
  return <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />;
}

// Build state next to the "Build" button: it shows which build the simulation runs on.
export type BuildBadgeState = "none" | "building" | "ok" | "stale" | "failed";

export function buildBadgeState(s: { status: string; stale: boolean; loaded: boolean }): BuildBadgeState {
  if (s.status === "building") return "building";
  if (s.status === "failed" || s.status === "error") return "failed";
  if (s.stale) return "stale";
  return s.loaded ? "ok" : "none";
}

const BADGE: Record<BuildBadgeState, string> = {
  none: "bg-muted text-muted-foreground",
  building: "bg-muted text-muted-foreground",
  ok: "bg-success-soft text-success",
  stale: "bg-warning-soft text-warning",
  failed: "bg-destructive/12 text-destructive",
};

function BuildBadge() {
  const state = useApp((s) => buildBadgeState({ status: s.build.status, stale: s.stale, loaded: s.sim.loaded }));
  const hint = state === "none" || state === "stale" || state === "failed" ? t(`build.hint.${state}`) : undefined;
  return (
    <Tip text={hint}>
      <span
        className={cn(
          "inline-flex h-5 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
          BADGE[state],
        )}
        data-state={state}
        data-testid="build-badge"
      >
        <span className={cn("size-1.5 rounded-full bg-current", state === "building" && "animate-pulse")} />
        {t(`build.state.${state}`)}
      </span>
    </Tip>
  );
}

// "Run" and "Pause" are one button: if the simulation or a step is running, it pauses, otherwise it runs. Running an unbuilt
// or changed project builds it first.
function RunButton() {
  const loaded = useApp((s) => s.sim.loaded);
  const runState = useApp((s) => s.sim.run);
  const stepping = useApp((s) => s.stepping);
  const stale = useApp((s) => s.stale);
  const building = useApp((s) => s.build.status === "building");
  const hasKey = useApp((s) => s.authStatus === "ok");
  // Pause interrupts a long step too: during a step the core stays in the paused state.
  if (runState === "running" || stepping) {
    return (
      <Tip text={t("workspace.pauseHint")}>
        <Button type="button" variant="outline" className="min-w-22" onClick={pause} data-testid="pause">
          <PauseIcon />
          {t("workspace.pause")}
        </Button>
      </Tip>
    );
  }
  const needsBuild = !loaded || stale;
  const disabled = needsBuild ? building || !hasKey : runState !== "paused";
  return (
    <Tip text={t(needsBuild ? "workspace.runBuildHint" : "workspace.runHint")}>
      <span className="inline-flex">
        <Button
          type="button"
          className="min-w-22"
          onClick={runOrBuild}
          disabled={disabled}
          data-builds={needsBuild}
          data-testid="run"
        >
          <PlayIcon className="fill-current" />
          {t("workspace.run")}
        </Button>
      </span>
    </Tip>
  );
}

// "Step" and the step kind are one compound button: the action on the left, the list of kinds on the right.
function StepControl() {
  const ready = useApp((s) => s.sim.loaded && s.sim.run === "paused" && !s.stepping);
  const clocked = useApp((s) => s.clocked);
  const [choice, setChoice] = useState<StepChoice>("cycle1");
  const [timeMs, setTimeMs] = useState("1");
  const message = stepCommand(choice, timeMs);
  // A design without a clock cannot step by clock cycles: the core answers BAD_STATE.
  const possible = message !== null && (message.unit !== "cycle" || clocked);
  return (
    <span className="flex items-center gap-1.5">
      <span className="inline-flex">
        <Button
          type="button"
          variant="outline"
          className="rounded-r-none"
          disabled={!ready || !possible}
          onClick={() => {
            if (message) step(message);
          }}
          data-testid="step"
        >
          {t("workspace.stepWith", { kind: t(`step.${choice}`) })}
        </Button>
        <Choice
          bare
          className="-ml-px rounded-l-none px-1.5"
          value={choice}
          label={t("workspace.stepKind")}
          onChange={(value) => {
            setChoice(value as StepChoice);
          }}
          options={STEP_CHOICES.map((c) => ({ value: c, label: t(`step.${c}`) }))}
          testid="step-kind"
        />
      </span>
      {choice === "time" && (
        <label className="flex items-center gap-1 text-muted-foreground">
          <Input
            className="w-16 font-mono"
            value={timeMs}
            inputMode="decimal"
            onChange={(event) => {
              setTimeMs(event.target.value);
            }}
            data-testid="step-time"
          />
          {t("step.ms")}
        </label>
      )}
    </span>
  );
}

function SpeedControl() {
  const speed = useApp((s) => s.speed);
  const listed = SPEEDS.includes(speed);
  const [custom, setCustom] = useState(false);
  const [text, setText] = useState("");
  const apply = (): void => {
    const value = parseSpeed(text);
    if (value !== null) setSpeed(value);
  };
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{t("workspace.speed")}</span>
      <Choice
        className="min-w-20"
        value={custom || !listed ? "custom" : speedValue(speed)}
        label={t("workspace.speed")}
        onChange={(value) => {
          setCustom(value === "custom");
          if (value === "custom") setText(speed === "max" ? "1" : String(speed));
          else setSpeed(value === "max" ? "max" : Number(value));
        }}
        options={[
          ...SPEEDS.map((s) => ({ value: speedValue(s), label: s === "max" ? t("speed.max") : speedLabel(s) })),
          {
            value: "custom",
            label: !listed && !custom && speed !== "max" ? speedLabel(speed) : t("speed.custom"),
          },
        ]}
        testid="speed"
      />
      {custom && (
        <Input
          className="w-16 font-mono"
          value={text}
          inputMode="decimal"
          aria-label={t("speed.custom")}
          onChange={(event) => {
            setText(event.target.value);
          }}
          onBlur={apply}
          onKeyDown={(event) => {
            if (event.key === "Enter") apply();
          }}
          data-testid="speed-custom"
        />
      )}
    </span>
  );
}

// The actual speed ratio is taken from the last frame, bypassing React.
function Ratio() {
  const running = useApp((s) => s.sim.run === "running");
  const place = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const live = currentSimulation()?.live;
    if (!place.current) return;
    const text = running && live ? t("workspace.ratio", { ratio: formatRatio(live.ratio) }) : "";
    if (place.current.textContent !== text) place.current.textContent = text;
  });
  return (
    <span
      className="min-w-20 font-mono text-xs text-muted-foreground tabular-nums not-empty:before:mr-1 not-empty:before:content-[attr(data-label)]"
      data-label={t("workspace.ratioLabel")}
      ref={place}
      title={t("workspace.ratioHint")}
      data-testid="ratio"
    />
  );
}

const THEMES: [ThemeChoice, typeof SunIcon][] = [
  ["light", SunIcon],
  ["dark", MoonIcon],
  ["system", MonitorIcon],
];

// Language names are written in the languages themselves and do not go to the dictionary (decision 168).
const LANGUAGE_NAMES: [Language, string][] = [
  // eslint-disable-next-line no-restricted-syntax -- a language name is written in that language and is the same in any interface (decision 168)
  ["ru", "Русский"],
  ["en", "English"],
];

export function LanguageToggle() {
  const choice = currentLanguage();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("language.title")} data-testid="language-toggle">
          <LanguagesIcon />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => {
            if (value !== choice) void setLanguage(value as Language);
          }}
        >
          {LANGUAGE_NAMES.map(([lang, name]) => (
            <DropdownMenuRadioItem key={lang} value={lang} lang={lang} data-testid={`language-${lang}`}>
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThemeToggle() {
  const choice = useTheme((s) => s.choice);
  const Current = THEMES.find(([name]) => name === choice)?.[1] ?? MonitorIcon;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t("theme.title")} data-testid="theme-toggle">
          <Current />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={choice}
          onValueChange={(value) => {
            setTheme(value as ThemeChoice);
          }}
        >
          {THEMES.map(([name]) => (
            <DropdownMenuRadioItem key={name} value={name} data-testid={`theme-${name}`}>
              {t(`theme.${name}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TopBar({ project }: { project: ProjectRecord }) {
  const building = useApp((s) => s.build.status === "building");
  const hasKey = useApp((s) => s.authStatus === "ok");
  const checkingKey = useApp((s) => s.authStatus === "checking");
  const expired = useApp((s) => s.sessionExpired);
  const loaded = useApp((s) => s.sim.loaded);
  return (
    <header className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-b px-2 py-1.5">
      <IconButton label={t("workspace.back")} onClick={() => void closeProject()} data-testid="back">
        <ChevronLeftIcon />
      </IconButton>
      <ProjectMenu project={project} />
      <Divider />
      <Tip text={t("workspace.buildHint")}>
        <span className="inline-flex">
          <Button
            type="button"
            variant="outline"
            onClick={() => void build()}
            disabled={building || !hasKey}
            data-testid="build"
          >
            <HammerIcon />
            {t("workspace.build")}
          </Button>
        </span>
      </Tip>
      <BuildBadge />
      <Divider />
      <RunButton />
      <StepControl />
      <IconButton
        label={t("workspace.resetHint")}
        variant="outline"
        onClick={resetSimulation}
        disabled={!loaded}
        data-testid="reset"
      >
        <RotateCcwIcon />
      </IconButton>
      <Divider />
      <SpeedControl />
      <Ratio />
      <AutoBuild />
      {!hasKey && !checkingKey && !expired && <span className="text-destructive">{t("workspace.noKey")}</span>}
      <span className="flex-1" />
      <LanguageToggle />
      <ThemeToggle />
      <HelpButton />
    </header>
  );
}
