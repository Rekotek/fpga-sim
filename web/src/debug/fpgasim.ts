// The window.__fpgasim object (spec section 9.7): end-to-end tests check behavior through it.
// Available in a development build and with the ?debug=1 parameter.
import {
  changedFiles,
  command,
  currentAccount,
  currentBinding,
  currentScene,
  currentSimulation,
  currentSource,
  currentTestbench,
  editor,
  exportVcd,
  fileContent,
  projectFiles,
  syncNow,
  syncReport,
  watchRows,
} from "../app/actions";
import { recordSettings } from "../wave/config";
import { formatValue } from "../wave/format";
import { modelChanges, signalChanges, valueAt } from "../wave/model";
import { waves } from "../wave/session";
import { diagnosticExplain, diagnosticLevel, diagnosticText, visibleDiagnostics } from "../app/diagnostics";
import { helpState } from "../app/HelpDialog";
import { useApp } from "../app/state";
import { useTheme } from "../app/theme";
import { currentLanguage, setLanguage } from "../i18n";
import { listExamples } from "../project/assets";
import type { DebugApi } from "./api";
import { useConversation } from "../assistant/conversation";

declare global {
  interface Window {
    __fpgasim?: DebugApi;
  }
}

// Also read by the assistant's tools (web/src/assistant/live.ts).
export const api: DebugApi = {
  state() {
    const { sim, build, stepping, stale, checks, builds } = useApp.getState();
    const live = currentSimulation()?.live;
    return {
      run: sim.run,
      loaded: sim.loaded,
      time: live ? live.timePs.toString() : sim.time,
      cycle: live ? Number(live.cycle) : sim.cycle,
      speed: sim.speed,
      ratio: live?.ratio ?? 0,
      stepping,
      stale,
      checks,
      builds,
      build: {
        status: build.status,
        buildId: build.buildId,
        cached: build.cached,
        durationMs: build.durationMs,
        errorCode: build.errorCode,
      },
    };
  },
  net(pin) {
    const net = currentSimulation()?.live.byPin.get(pin);
    return net ? { level: net.level, toggles: net.toggles, duty: net.duty, flags: net.flags } : null;
  },
  part(id) {
    const scene = currentScene();
    const live = currentSimulation()?.live ?? null;
    const status = scene?.partStatus(id, live);
    const point = scene?.partCenter(id);
    if (!status || !point) return null;
    const terminal = live?.terminals.get(id);
    return {
      state: [...(live?.parts.get(id) ?? [])],
      ...status,
      ...(terminal ? { terminal: [...terminal.bytes()] } : {}),
      point,
    };
  },
  partEvents: (id) =>
    (currentSimulation()?.live.events ?? [])
      .filter((e) => e.part === id)
      .map((e) => ({ event: e.event, data: e.data, time: e.time })),
  bottomTab: () => useApp.getState().bottomTab,
  pins: () => currentScene()?.pins(currentSimulation()?.live ?? null) ?? [],
  parts: () => currentScene()?.partList() ?? [],
  binding() {
    const source = currentSource();
    const binding = currentBinding();
    return {
      source: source.kind,
      file: source.kind === "cst" ? source.file : null,
      rows: (binding?.rows ?? []).map((r) => ({ name: r.name, dir: r.dir, pin: r.pin, pull: r.pull })),
      pins: binding?.pins ?? [],
      problems: (binding?.problems ?? []).map((p) => ({ code: p.code, name: p.name, pin: p.pin })),
    };
  },
  fileRoles: () => ({ top: useApp.getState().topFile, testbenches: useApp.getState().testbenches }),
  file: fileContent,
  messages: () =>
    visibleDiagnostics(useApp.getState().diagnostics).map((d) => ({
      code: d.code,
      level: diagnosticLevel(d),
      file: d.file ?? null,
      line: d.line ?? null,
      text: diagnosticText(d),
      explain: diagnosticExplain(d),
    })),
  layout: () => useApp.getState().layout,
  diagnostics: () => useApp.getState().diagnostics,
  signals: () => useApp.getState().signals.map((s) => ({ sig: s.sig, path: s.path, width: s.width, kind: s.kind })),
  watch: () =>
    watchRows().map((row) => ({
      signal: row.signal,
      radix: row.radix,
      value: row.value === null ? null : row.value.toString(),
      text: row.value === null ? null : formatValue(row.value, row.width, row.radix),
    })),
  record() {
    const { record, recordError } = useApp.getState();
    if (!record && recordError === null) return null;
    return {
      id: record?.id ?? null,
      state: record?.state ?? "none",
      changes: record?.changes ?? 0,
      fromPs: record?.fromPs ?? "0",
      toPs: record?.toPs ?? "0",
      error: recordError,
    };
  },
  wave() {
    const model = waves.model;
    if (!model) return null;
    return {
      source: model.source,
      fromPs: String(model.fromPs),
      toPs: String(model.toPs),
      changes: modelChanges(model),
      signals: model.signals.map((s) => ({
        name: s.name,
        width: s.width,
        changes: signalChanges(s),
        initial: valueAt(s, 0).toString(),
        last: valueAt(s, s.times.length - 1).toString(),
      })),
    };
  },
  waveChanges(name, from = 0, count = 1000) {
    const signal = waves.model?.signals.find((s) => s.name === name);
    const out: { t: string; v: string }[] = [];
    if (!signal) return out;
    for (let i = from + 1; i < signal.times.length && out.length < count; i += 1) {
      out.push({ t: String(signal.times[i]), v: valueAt(signal, i).toString() });
    }
    return out;
  },
  waveView: () => ({
    fromPs: waves.view.fromPs,
    toPs: waves.view.toPs,
    cursorA: waves.cursorA,
    cursorB: waves.cursorB,
    rows: useApp.getState().vcdWave?.rows ?? recordSettings(useApp.getState().config).signals,
    vcd: useApp.getState().vcdWave?.file ?? null,
  }),
  testbench() {
    const { testbenches, testbench: run } = useApp.getState();
    return {
      files: testbenches,
      file: currentTestbench(),
      status: run.status,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      stdout: run.stdout,
      truncated: run.truncated,
      diagnostics: run.diagnostics,
      vcd: run.vcd,
      error: run.errorText,
    };
  },
  theme() {
    const { choice, dark } = useTheme.getState();
    return { choice, dark };
  },
  help: helpState,
  examples() {
    return listExamples().map((e) => ({ name: e.name, lesson: e.lesson }));
  },
  files: projectFiles,
  fileDrop: () => useApp.getState().fileDrop,
  changedFiles: () => changedFiles().map((f) => f.path),
  project() {
    const project = useApp.getState().project;
    if (!project) return null;
    // The view field exists only on a temporary copy: earlier project() checks compare the whole object.
    return project.viewOf
      ? { name: project.name, kind: project.kind, view: project.viewOf.login }
      : { name: project.name, kind: project.kind };
  },
  board() {
    return useApp.getState().project?.board ?? null;
  },
  account: currentAccount,
  sync: syncReport,
  syncNow,
  projects() {
    const { projects, sync } = useApp.getState();
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      sync: sync[p.id]?.state ?? null,
      view: p.viewOf?.login ?? null,
    }));
  },
  syncNotice: () => useApp.getState().syncNotice,
  conflicts() {
    const { conflictPaths, conflictOpen } = useApp.getState();
    return { paths: [...conflictPaths], open: conflictOpen };
  },
  exitDialog() {
    const ask = useApp.getState().exitAsk;
    return ask ? { ...ask } : null;
  },
  userProjects() {
    const list = useApp.getState().userProjects;
    if (!list) return null;
    return {
      login: list.login,
      projects:
        list.projects?.map((p) => ({
          id: p.id,
          name: p.name,
          trashed: p.deletedAt !== undefined,
          purged: p.purged,
          deletedAt: p.deletedAt ?? null,
        })) ?? null,
    };
  },
  busyProject: () => useApp.getState().busyProject,
  users() {
    const { users, screen } = useApp.getState();
    if (screen !== "users" || !users) return [];
    return users.map((u) => ({
      login: u.login,
      name: u.name,
      role: u.role,
      enabled: u.enabled,
      lastLogin: u.lastLogin,
      lastBuild: u.lastBuild,
      projects: u.projects,
    }));
  },
  folder() {
    const folder = useApp.getState().folder;
    return folder ? { ...folder } : null;
  },
  transfer() {
    const transfer = useApp.getState().transfer;
    return transfer ? { skipped: transfer.skipped.map((s) => ({ ...s })), error: transfer.error } : null;
  },
  language: currentLanguage,
  setLanguage,
  vcd: exportVcd,
  command,
  assistant: () =>
    useConversation.getState().turns.map((turn) => ({
      question: turn.question,
      answer: turn.answer,
      tools: [...turn.tools],
      tokens: turn.tokens,
      error: turn.error,
    })),
  editor() {
    const dirty = useApp
      .getState()
      .files.filter((f) => f.dirty)
      .map((f) => f.path);
    return { ...editor.snapshot(), dirty };
  },
};

export function installDebug(): void {
  if (import.meta.env.DEV || new URLSearchParams(location.search).get("debug") === "1") window.__fpgasim = api;
}
