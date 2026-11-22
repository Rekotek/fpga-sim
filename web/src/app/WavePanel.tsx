// The "Waveforms" tab (spec section 9.6): recording control, signal rows and Canvas.
// The model, the view window and the cursors live outside React state (wave/session.ts); Canvas
// redraws on a screen frame when they changed.
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CircleIcon,
  DownloadIcon,
  ListTreeIcon,
  MaximizeIcon,
  PlusIcon,
  SquareIcon,
  Undo2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "../i18n";
import { MAX_DEPTH, MAX_RECORD_SIGNALS, recordSettings, triggerEdges, type RecordEdge } from "../wave/config";
import { RADIXES, formatValue, isRadix, type Radix } from "../wave/format";
import { indexAt, valueAt, type WaveSignal } from "../wave/model";
import { WAVE_RADIX, setView, showAll, touchWaves, waves } from "../wave/session";
import { pinOfName } from "../wave/tree";
import {
  AXIS_HEIGHT,
  ROW_HEIGHT,
  drawWave,
  panView,
  timeAtX,
  zoomView,
  type WaveColors,
  type WaveRow,
} from "../wave/view";
import {
  addRecordSignal,
  closeTestbenchWave,
  downloadVcd,
  moveRecordSignal,
  moveVcdRow,
  removeRecordSignal,
  removeVcdRow,
  setRecordSettings,
  startRecord,
  stopRecord,
} from "./actions";
import { formatHz, formatInteger, formatPs } from "./format";
import { Choice, EmptyState, FieldLabel, IconButton, Problem, Toolbar } from "./kit";
import { useApp } from "./state";
import { themeColor, useTheme } from "./theme";
import { useFrame } from "./useFrame";

// Canvas colors come from theme variables (styles.css) on every redraw.
const waveColors = (): WaveColors => ({
  line: themeColor("--wave-line"),
  bus: themeColor("--wave-bus"),
  dense: themeColor("--wave-dense"),
  text: themeColor("--foreground"),
  grid: themeColor("--wave-grid"),
  axis: themeColor("--muted-foreground"),
  cursorA: themeColor("--wave-cursor-a"),
  cursorB: themeColor("--wave-cursor-b"),
});
const DRAG_PX = 3; // mouse shift from which a press counts as a drag
const MS_PS = 1e9;
const MAX_ADD_ROWS = 200; // rows in the add-signal list; search finds the rest
const STATUS = "text-xs whitespace-nowrap text-muted-foreground tabular-nums";

const signalOf = (name: string): WaveSignal | null => waves.model?.signals.find((s) => s.name === name) ?? null;
const radixOf = (name: string): Radix => waves.radix.get(name) ?? WAVE_RADIX;

// Panel rows: the recording list from fpgasim.json, and for a testbench file the signals of the file itself;
// the row data is the model signal with the same name.
function waveRows(names: readonly string[]): WaveRow[] {
  return names.map((name) => ({ signal: signalOf(name), radix: radixOf(name) }));
}

function cursorText(): string {
  const { cursorA: a, cursorB: b } = waves;
  if (a === null) return t("waves.cursors.none");
  if (b === null) return t("waves.cursors.a", { a: formatPs(a) });
  const delta = Math.abs(b - a);
  const args = { a: formatPs(a), b: formatPs(b), delta: formatPs(delta) };
  return delta === 0 ? t("waves.cursors.same", args) : t("waves.cursors.ab", { ...args, freq: formatHz(1e12 / delta) });
}

// The number in the input is written to settings on blur and on Enter.
function NumberField(props: {
  value: number;
  min: number;
  max?: number;
  step?: string;
  testId: string;
  onCommit(value: number): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (): void => {
    if (draft === null) return;
    const value = Number(draft.replace(",", "."));
    setDraft(null);
    if (Number.isFinite(value) && value >= props.min && value <= (props.max ?? Infinity)) props.onCommit(value);
  };
  return (
    <Input
      type="number"
      className="h-6 w-24 px-1.5 font-mono text-xs text-foreground tabular-nums"
      min={props.min}
      max={props.max}
      step={props.step ?? "1"}
      value={draft ?? String(props.value)}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") commit();
      }}
      data-testid={props.testId}
    />
  );
}

// Cursor row: the text updates on a screen frame, without a React redraw.
function Cursors() {
  const cursors = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const text = cursorText();
    if (cursors.current && cursors.current.textContent !== text) cursors.current.textContent = text;
  });
  return <span className={STATUS} ref={cursors} data-testid="wave-cursors" />;
}

// "Fit all" and "Export VCD": shared buttons for the core recording and the testbench file.
function ViewButtons() {
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={showAll} data-testid="wave-fit">
        <MaximizeIcon />
        {t("waves.fit")}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={downloadVcd} data-testid="wave-vcd">
        <DownloadIcon />
        {t("waves.vcd")}
      </Button>
    </>
  );
}

// The panel shows the testbench VCD file: there is no recording control, only a return to the core recording.
function VcdControls({ file, hidden }: { file: string; hidden: number }) {
  return (
    <Toolbar className="shrink-0">
      <span className="text-muted-foreground" data-testid="wave-source">
        {t("waves.vcd.source", { file })}
      </span>
      <Button type="button" variant="outline" size="sm" onClick={closeTestbenchWave} data-testid="wave-close-vcd">
        <Undo2Icon />
        {t("waves.vcd.close")}
      </Button>
      <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
        <ViewButtons />
        {hidden > 0 && (
          <span className={STATUS} data-testid="wave-hidden">
            {t("waves.vcd.hidden", { count: formatInteger(hidden) })}
          </span>
        )}
        <Cursors />
      </div>
    </Toolbar>
  );
}

// The "Signal" button: search over the signals of the loaded core and add to the recording list.
// Memory does not go into the recording; signals already added are marked and disabled.
function AddSignal() {
  const signals = useApp((s) => s.signals);
  const config = useApp((s) => s.config);
  const [search, setSearch] = useState("");
  const recorded = recordSettings(config).signals;
  const full = recorded.length >= MAX_RECORD_SIGNALS;
  const query = search.trim().toLowerCase();
  const found = signals.filter((s) => s.kind !== "memory" && s.path.toLowerCase().includes(query));
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" title={t("waves.add.hint")} data-testid="waves-add-signal">
          <PlusIcon />
          {t("waves.add")}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex max-h-80 w-96 max-w-[90vw] flex-col gap-0 p-0">
        <div className="shrink-0 border-b p-1.5">
          <Input
            autoFocus
            type="search"
            value={search}
            placeholder={t("signals.search")}
            aria-label={t("signals.search")}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
            data-testid="waves-add-search"
          />
        </div>
        {full && (
          <p className="shrink-0 border-b bg-warning-soft px-2 py-1 text-xs">
            {t("waves.add.full", { max: MAX_RECORD_SIGNALS })}
          </p>
        )}
        {found.length === 0 ? (
          <p className="p-3 text-muted-foreground">{t(signals.length === 0 ? "waves.add.noCore" : "waves.add.none")}</p>
        ) : (
          <ul className="min-h-0 flex-1 overflow-auto py-1">
            {found.slice(0, MAX_ADD_ROWS).map((signal) => {
              const added = recorded.includes(signal.path);
              return (
                <li key={signal.path}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 px-2 py-0.5 text-left font-mono text-xs outline-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50"
                    disabled={added || full}
                    title={added ? t("waves.add.added") : signal.path}
                    onClick={() => {
                      void addRecordSignal(signal.path);
                    }}
                    data-testid="waves-add-item"
                    data-signal={signal.path}
                    data-added={added}
                  >
                    <CheckIcon className={added ? "size-3.5 shrink-0 text-success" : "invisible size-3.5 shrink-0"} />
                    <span className="min-w-0 flex-1 truncate">{signal.path}</span>
                    {signal.width > 1 && (
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {t("signals.width", { width: signal.width })}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
            {found.length > MAX_ADD_ROWS && (
              <li className="px-2 py-1 text-xs text-muted-foreground">
                {t("signals.more", { shown: MAX_ADD_ROWS, total: found.length })}
              </li>
            )}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

function Controls() {
  const config = useApp((s) => s.config);
  const loaded = useApp((s) => s.sim.loaded);
  const record = useApp((s) => s.record);
  const error = useApp((s) => s.recordError);
  const signals = useApp((s) => s.signals);
  const settings = recordSettings(config);
  const trigger = settings.trigger;
  // The start condition may be on a signal outside the recording list (decision 25).
  const triggerNames =
    trigger && !settings.signals.includes(trigger.signal) ? [...settings.signals, trigger.signal] : settings.signals;
  const widthOf = (name: string): number =>
    pinOfName(name) !== null ? 1 : (signals.find((s) => s.path === name)?.width ?? 1);
  const active = record?.state === "armed" || record?.state === "recording";
  const span = record ? formatPs(Number(BigInt(record.toPs) - BigInt(record.fromPs))) : "";
  const field = "flex items-center gap-1.5 text-muted-foreground";
  return (
    <Toolbar className="shrink-0">
      <Button
        type="button"
        size="sm"
        disabled={!loaded}
        onClick={() => {
          void startRecord();
        }}
        data-testid="wave-start"
      >
        <CircleIcon className="fill-current" />
        {t("waves.start")}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!active} onClick={stopRecord} data-testid="wave-stop">
        <SquareIcon className="fill-current" />
        {t("waves.stop")}
      </Button>
      <AddSignal />
      <div className={field}>
        <span>{t("waves.mode")}</span>
        <Choice
          size="sm"
          className="text-foreground"
          value={settings.mode}
          label={t("waves.mode")}
          onChange={(value) => {
            void setRecordSettings({ mode: value === "window" ? "window" : "ring" });
          }}
          options={[
            { value: "ring", label: t("waves.mode.ring") },
            { value: "window", label: t("waves.mode.window") },
          ]}
          testid="wave-mode"
        />
      </div>
      <FieldLabel>
        {t("waves.depth")}
        <NumberField
          value={settings.depth}
          min={1}
          max={MAX_DEPTH}
          testId="wave-depth"
          onCommit={(value) => {
            void setRecordSettings({ depth: Math.round(value) });
          }}
        />
      </FieldLabel>
      {settings.mode === "window" && (
        <FieldLabel>
          {t("waves.window")}
          <NumberField
            value={settings.windowPs / MS_PS}
            min={1 / MS_PS}
            step="any"
            testId="wave-window"
            onCommit={(value) => {
              void setRecordSettings({ windowPs: Math.max(1, Math.round(value * MS_PS)) });
            }}
          />
        </FieldLabel>
      )}
      <div className={field}>
        <span>{t("waves.trigger")}</span>
        <Choice
          size="sm"
          className="max-w-56 font-mono text-foreground"
          value={trigger?.signal ?? ""}
          label={t("waves.trigger")}
          onChange={(signal) => {
            const edges = triggerEdges(widthOf(signal));
            const edge = trigger && edges.includes(trigger.edge) ? trigger.edge : (edges[0] ?? "change");
            void setRecordSettings({ trigger: signal === "" ? null : { signal, edge } });
          }}
          options={[
            { value: "", label: t("waves.trigger.none") },
            ...triggerNames.map((name) => ({ value: name, label: name })),
          ]}
          testid="wave-trigger"
        />
        {trigger && (
          <Choice
            size="sm"
            className="text-foreground"
            value={trigger.edge}
            label={t("waves.trigger")}
            onChange={(value) => {
              void setRecordSettings({ trigger: { signal: trigger.signal, edge: value as RecordEdge } });
            }}
            options={triggerEdges(widthOf(trigger.signal)).map((edge) => ({
              value: edge,
              label: t(`waves.edge.${edge}`),
            }))}
            testid="wave-edge"
          />
        )}
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-x-2 gap-y-1">
        <ViewButtons />
        <span
          className={STATUS}
          title={record?.state === "recording" ? t("waves.hint.slow") : undefined}
          data-testid="wave-status"
          data-state={record?.state ?? "none"}
        >
          {t(`waves.state.${record?.state ?? "none"}`, { changes: formatInteger(record?.changes ?? 0), span })}
        </span>
        <Cursors />
      </div>
      {error !== null && (
        <Problem className="basis-full" data-testid="wave-error">
          {error}
        </Problem>
      )}
    </Toolbar>
  );
}

function Names({ names, vcd }: { names: readonly string[]; vcd: boolean }) {
  const signals = useApp((s) => s.signals);
  // Row width in bits: for a board pin it is 1, for a signal it comes from the core signal list or from the recording.
  // A testbench file has its own signals: their width comes only from the file.
  const widthOf = (name: string): number =>
    vcd
      ? (signalOf(name)?.width ?? 0)
      : pinOfName(name) !== null
        ? 1
        : (signals.find((s) => s.path === name)?.width ?? signalOf(name)?.width ?? 0);
  const move = (name: string, delta: number): void => {
    if (vcd) moveVcdRow(name, delta);
    else void moveRecordSignal(name, delta);
  };
  const list = useRef<HTMLUListElement>(null);
  const [, redraw] = useState(0);
  const seen = useRef({ version: -1, names: "" });
  useFrame(() => {
    // After the row list changes, the cells are new: they are filled even without a model change.
    const key = names.join("\n");
    if (seen.current.version === waves.version && seen.current.names === key) return;
    seen.current = { version: waves.version, names: key };
    // The value under cursor A; without a cursor, the value at the end of the span.
    const at = waves.cursorA ?? waves.model?.toPs ?? 0;
    // The value cell is found by data-testid: the data-value attribute is also on the number base list.
    list.current?.querySelectorAll<HTMLElement>('[data-testid="wave-value"]').forEach((cell) => {
      const name = cell.dataset.value ?? "";
      const signal = signalOf(name);
      const text = signal
        ? formatValue(valueAt(signal, indexAt(signal, at)), signal.width, radixOf(name))
        : waves.model
          ? t("waves.missing")
          : "";
      if (cell.textContent !== text) cell.textContent = text;
    });
  });
  return (
    <ul ref={list} data-testid="wave-rows">
      {names.map((name, i) => (
        <li
          key={name}
          className="flex items-center gap-0.5 border-t border-border/60 pr-1 pl-2"
          style={{ height: `${String(ROW_HEIGHT)}px` }}
          data-testid="wave-row"
          data-name={name}
        >
          {/* A long name is cut on the left: the end of the path matters more than the start. */}
          <span className="min-w-0 flex-1 truncate text-left font-mono text-xs [direction:rtl]" title={name}>
            <bdi>{name}</bdi>
          </span>
          <span
            className="mx-1 max-w-28 truncate font-mono text-xs tabular-nums"
            data-testid="wave-value"
            data-value={name}
          />
          <Choice
            size="sm"
            className="h-5.5 gap-1 px-1.5"
            value={radixOf(name)}
            label={t("signals.column.radix")}
            disabled={widthOf(name) === 1}
            onChange={(value) => {
              if (!isRadix(value)) return;
              waves.radix.set(name, value);
              touchWaves();
              redraw((n) => n + 1);
            }}
            options={RADIXES.map((radix) => ({ value: radix, label: t(`radix.short.${radix}`) }))}
            testid="wave-radix"
          />
          <IconButton
            label={t("waves.up")}
            size="icon-xs"
            disabled={i === 0}
            onClick={() => {
              move(name, -1);
            }}
            data-testid="wave-up"
          >
            <ArrowUpIcon />
          </IconButton>
          <IconButton
            label={t("waves.down")}
            size="icon-xs"
            disabled={i === names.length - 1}
            onClick={() => {
              move(name, 1);
            }}
            data-testid="wave-down"
          >
            <ArrowDownIcon />
          </IconButton>
          <IconButton
            label={t(vcd ? "waves.vcd.remove" : "waves.remove")}
            size="icon-xs"
            onClick={() => {
              if (vcd) removeVcdRow(name);
              else void removeRecordSignal(name);
            }}
            data-testid="wave-remove"
          >
            <XIcon />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

function Canvas({ names }: { names: readonly string[] }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawn = useRef({ version: -1, width: 0, height: 0, names: "", theme: -1 });
  // A theme change changes the colors: the counter makes Canvas redraw.
  const theme = useTheme((s) => s.revision);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const height = AXIS_HEIGHT + names.length * ROW_HEIGHT;

  useFrame(() => {
    const element = canvas.current;
    if (!element) return;
    const width = element.clientWidth;
    const key = names.join("\n");
    const last = drawn.current;
    if (
      last.version === waves.version &&
      last.width === width &&
      last.height === height &&
      last.names === key &&
      last.theme === theme
    )
      return;
    drawn.current = { version: waves.version, width, height, names: key, theme };
    const scale = window.devicePixelRatio || 1;
    element.width = Math.round(width * scale);
    element.height = Math.round(height * scale);
    const ctx = element.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    drawWave(ctx, {
      model: waves.model,
      rows: waveRows(names),
      view: waves.view,
      width,
      height,
      cursorA: waves.cursorA,
      cursorB: waves.cursorB,
      colors: waveColors(),
      formatTime: formatPs,
    });
  });

  // The wheel zooms around the pointer; with Shift or on sideways scroll, it pans.
  // The handler is attached directly: in React it is passive and cannot cancel page scrolling.
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      const model = waves.model;
      if (!model) return;
      event.preventDefault();
      const width = element.clientWidth;
      const span = waves.view.toPs - waves.view.fromPs;
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        const delta = event.shiftKey && event.deltaX === 0 ? event.deltaY : event.deltaX;
        setView(panView(waves.view, (delta * span) / Math.max(1, width), model));
      } else {
        const anchor = timeAtX(waves.view, event.offsetX, width);
        setView(zoomView(waves.view, Math.exp(event.deltaY * 0.0015), anchor, model));
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("wheel", onWheel);
    };
  }, []);

  return (
    <canvas
      ref={canvas}
      className="block w-full cursor-crosshair touch-none outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
      style={{ height: `${String(height)}px` }}
      tabIndex={0}
      aria-label={t("waves.canvas")}
      title={t("waves.canvas")}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, moved: false };
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        const model = waves.model;
        if (!from || !model) return;
        const dx = event.clientX - from.x;
        if (!from.moved && Math.abs(dx) < DRAG_PX) return;
        const width = event.currentTarget.clientWidth;
        const span = waves.view.toPs - waves.view.fromPs;
        setView(panView(waves.view, (-dx * span) / Math.max(1, width), model));
        drag.current = { x: event.clientX, moved: true };
      }}
      onPointerUp={(event) => {
        const from = drag.current;
        drag.current = null;
        if (!from || from.moved || !waves.model) return;
        // A click sets cursor A; with Shift, cursor B.
        const box = event.currentTarget.getBoundingClientRect();
        const at = Math.round(timeAtX(waves.view, event.clientX - box.left, box.width));
        if (event.shiftKey) waves.cursorB = at;
        else waves.cursorA = at;
        touchWaves();
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const model = waves.model;
        if (!model || event.ctrlKey || event.metaKey || event.altKey) return;
        const view = waves.view;
        const span = view.toPs - view.fromPs;
        const middle = waves.cursorA ?? (view.fromPs + view.toPs) / 2;
        const anchor = middle >= view.fromPs && middle <= view.toPs ? middle : (view.fromPs + view.toPs) / 2;
        if (event.key === "+" || event.key === "=") setView(zoomView(view, 0.5, anchor, model));
        else if (event.key === "-" || event.key === "_") setView(zoomView(view, 2, anchor, model));
        else if (event.key === "ArrowLeft") setView(panView(view, -span * 0.1, model));
        else if (event.key === "ArrowRight") setView(panView(view, span * 0.1, model));
        else if (event.code === "KeyF" || event.key === "Home") showAll();
        else if (event.key === "Escape") {
          waves.cursorA = null;
          waves.cursorB = null;
          touchWaves();
        } else return;
        event.preventDefault();
      }}
      data-testid="wave-canvas"
    />
  );
}

export function WavePanel() {
  const config = useApp((s) => s.config);
  const vcd = useApp((s) => s.vcdWave);
  const names = vcd ? vcd.rows : recordSettings(config).signals;
  return (
    <section className="flex min-h-0 flex-col" data-testid="waves">
      {vcd ? <VcdControls file={vcd.file} hidden={vcd.hidden} /> : <Controls />}
      {names.length === 0 ? (
        <EmptyState
          action={
            vcd ? undefined : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  useApp.setState({ bottomTab: "signals" });
                }}
                data-testid="waves-to-signals"
              >
                <ListTreeIcon />
                {t("waves.toSignals")}
              </Button>
            )
          }
        >
          {t(vcd ? "waves.vcd.empty" : "waves.empty")}
        </EmptyState>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-[340px_minmax(0,1fr)] content-start items-start overflow-y-auto">
          <div className="border-r">
            <div style={{ height: `${String(AXIS_HEIGHT)}px` }} />
            <Names names={names} vcd={vcd !== null} />
          </div>
          <Canvas names={names} />
        </div>
      )}
    </section>
  );
}
