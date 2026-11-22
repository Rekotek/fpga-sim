// Board drawing on a Canvas (spec section 9.4): outline, USB connector, chip, headers with numbers
// and pin states, built-in parts in their own coordinates. The object lives outside React: it is read by
// drawing on every screen frame and by window.__fpgasim. The board itself is one color in both themes; everything
// drawn on the area background (pin labels, the breadboard field, wires) takes theme colors.
import { themeColor } from "../app/theme";
import { localized, t } from "../i18n";
import { partDescription, type Board } from "../project/assets";
import { BREADBOARD_COLUMNS, withDefaults, type PartItem } from "../project/config";
import { createWidget } from "../parts";
import type { HintLine, PartConfig, PartView, PartWidget, SendCommand, StatusValue, WidgetBox } from "../parts/types";
import type { Live } from "../sim/host";
import {
  CELL,
  PAD,
  boardContacts,
  boardExtent,
  breadboardField,
  cellCenter,
  fitBoard,
  pinState,
  type Contact,
  type Field,
  type Fit,
  type PinState,
} from "./layout";

interface ScenePart {
  config: PartConfig;
  widget: PartWidget;
  box: WidgetBox;
  x: number;
  y: number;
  interactive: boolean;
  origin: "board" | "breadboard";
  enabled: boolean;
}

// A request to bind a breadboard part pin: the result of dragging from a part to a header pad.
export interface BindRequest {
  part: string;
  role: string;
  pin: number;
}

export type SendPart = (part: string, cmd: string, args?: Record<string, unknown>) => void;

const PIN_COLORS: Record<PinState, string> = {
  busy: "#3d8bff",
  free: "#3fae5a",
  onboard: "#9aa3ad",
  header: "#9aa3ad",
  clock: "#b07cff",
  forbidden: "#e5484d",
  unknown: "#9aa3ad",
};
const LEVEL_HIGH = "#ffd84a";
const LEVEL_LOW = "#14171c";
const FONT = "system-ui, sans-serif";

// Length of the common start of labels; at least one character of each label stays.
export function commonPrefix(labels: readonly string[]): number {
  const shortest = Math.min(...labels.map((text) => text.length));
  let length = 0;
  while (length < shortest - 1 && labels.every((text) => text[length] === labels[0]?.[length])) length += 1;
  return length;
}

export class BoardScene {
  readonly contacts: Contact[];
  private parts: ScenePart[] = [];
  private field: Field | null = null; // breadboard field; null while it has no parts
  private fit: Fit = { scale: 1, dx: 0, dy: 0 };
  private active: ScenePart | null = null; // the part the mouse is pressed on
  private drag: { part: ScenePart; x: number; y: number } | null = null; // wire from a breadboard part
  private hoverPin: number | null = null;

  constructor(readonly board: Board) {
    this.contacts = boardContacts(board);
  }

  // Drawing parts: built-in ones in board file coordinates, breadboard parts in field cells.
  // A widget of a part with the same name and type stays: it remembers the press and the smoothed brightness.
  setParts(items: readonly PartItem[]): void {
    const cells = items.flatMap((item) => (item.position ? [item.position] : []));
    const field = cells.length > 0 ? breadboardField(this.board, cells, BREADBOARD_COLUMNS) : null;
    const previous = this.parts;
    this.field = field;
    this.parts = items.map((item) => {
      const desc = partDescription(item.type);
      const config: PartConfig = {
        id: item.id,
        type: item.type,
        label: item.label,
        pins: item.pins,
        settings: withDefaults(desc, item.settings),
      };
      const kept = previous.find((p) => p.config.id === item.id && p.config.type === item.type);
      const widget = kept?.widget ?? createWidget(item.type);
      const box = widget.layout(config, desc);
      const geometry = this.board.parts.find((p) => p.id === item.id)?.geometry;
      const at = item.position && field ? cellCenter(field, item.position) : (geometry ?? { x: 0, y: 0 });
      return {
        config,
        widget,
        box,
        x: at.x,
        y: at.y,
        interactive: "onPointer" in widget && item.enabled,
        origin: item.origin,
        enabled: item.enabled,
      };
    });
    if (this.active && !this.parts.includes(this.active)) this.active = null;
    this.drag = null;
  }

  // ---- Drawing ----

  draw(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    ratio: number,
    live: Live | null,
    nowMs: number,
  ): void {
    const fit = fitBoard(boardExtent(this.board, this.field), width, height);
    this.fit = fit;
    const g = this.board.geometry;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const toBoard = (): void => {
      ctx.setTransform(ratio * fit.scale, 0, 0, ratio * fit.scale, ratio * fit.dx, ratio * fit.dy);
    };
    // The label is set in millimeters but drawn in pixels: a small font blurs under scaling.
    const size = Math.min(15, Math.max(8, fit.scale * 1.35));
    const label = (text: string, x: number, y: number, align: CanvasTextAlign, color: string, scale = 1): void => {
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.font = `${String(size * scale)}px ${FONT}`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = color;
      ctx.fillText(text, fit.dx + x * fit.scale, fit.dy + y * fit.scale);
      toBoard();
    };

    toBoard();
    ctx.fillStyle = "#23272e";
    ctx.strokeStyle = "#0e1013";
    ctx.lineWidth = 0.2;
    ctx.beginPath();
    ctx.roundRect(0, 0, g.width, g.height, 1.2);
    ctx.fill();
    ctx.stroke();
    // The USB connector protrudes past the top edge.
    ctx.fillStyle = "#b9bec6";
    ctx.strokeStyle = "#7c838d";
    ctx.beginPath();
    ctx.roundRect(g.usb.x - 4.5, g.usb.y - 1.6, 9, 6.2, 1);
    ctx.fill();
    ctx.stroke();
    const half = g.chip.size / 2;
    ctx.fillStyle = "#0f1114";
    ctx.strokeStyle = "#4a515c";
    ctx.beginPath();
    ctx.roundRect(g.chip.x - half, g.chip.y - half, g.chip.size, g.chip.size, 0.4);
    ctx.fill();
    ctx.stroke();
    label(this.board.fpga?.ideName ?? "", g.chip.x, g.chip.y, "center", "#8a9099");

    for (const contact of this.contacts) {
      const net = contact.pin === null ? undefined : live?.byPin.get(contact.pin);
      const state = contact.pin === null ? null : pinState(this.board, contact.pin, Boolean(net?.port));
      const color = state ? PIN_COLORS[state] : contact.power === "GND" ? "#6d737c" : "#c9772b";
      ctx.fillStyle = net ? (net.level ? LEVEL_HIGH : LEVEL_LOW) : state ? "#2f343c" : color;
      ctx.strokeStyle = color;
      ctx.lineWidth = contact.pin !== null && contact.pin === this.hoverPin ? 0.45 : 0.28;
      ctx.beginPath();
      ctx.rect(contact.x - PAD / 2, contact.y - PAD / 2, PAD, PAD);
      ctx.fill();
      ctx.stroke();
      if (state === "forbidden") {
        ctx.beginPath();
        ctx.moveTo(contact.x - PAD / 2, contact.y - PAD / 2);
        ctx.lineTo(contact.x + PAD / 2, contact.y + PAD / 2);
        ctx.stroke();
      }
      const outside = contact.side === "left" ? contact.x - PAD / 2 - 0.7 : contact.x + PAD / 2 + 0.7;
      label(
        contact.pin === null ? (contact.power ?? "") : String(contact.pin),
        outside,
        contact.y,
        contact.side === "left" ? "right" : "left",
        themeColor(contact.pin === null ? "--board-label" : "--board-pin-label"),
      );
    }

    // Breadboard field: cells and lines from parts to header pads.
    const field = this.field;
    if (field) {
      ctx.fillStyle = themeColor("--board-field");
      ctx.strokeStyle = themeColor("--board-field-line");
      ctx.lineWidth = 0.15;
      ctx.beginPath();
      ctx.roundRect(field.x, field.y, field.columns * CELL, field.rows * CELL, 0.8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = themeColor("--board-field-dot");
      for (let cx = 0; cx < field.columns; cx += 1) {
        for (let cy = 0; cy < field.rows; cy += 1) {
          const c = cellCenter(field, { x: cx, y: cy });
          ctx.beginPath();
          ctx.arc(c.x, c.y, 0.25, 0, 2 * Math.PI);
          ctx.fill();
        }
      }
      ctx.lineWidth = 0.22;
      for (const part of this.parts) {
        if (part.origin !== "breadboard") continue;
        for (const pin of Object.values(part.config.pins)) {
          const contact = this.contacts.find((c) => c.pin === pin);
          if (!contact) continue;
          ctx.strokeStyle = themeColor(live?.byPin.get(pin)?.level ? "--board-wire-high" : "--board-wire");
          ctx.beginPath();
          ctx.moveTo(part.x, part.y);
          ctx.lineTo(contact.x, contact.y);
          ctx.stroke();
        }
      }
      if (this.drag) {
        ctx.strokeStyle = "#3d8bff";
        ctx.setLineDash([0.6, 0.4]);
        ctx.beginPath();
        ctx.moveTo(this.drag.part.x, this.drag.part.y);
        ctx.lineTo(this.drag.x, this.drag.y);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Parts: built-in and on the breadboard. A disabled built-in part is drawn pale.
    for (const part of this.parts) {
      ctx.save();
      ctx.translate(part.x, part.y);
      if (!part.enabled) ctx.globalAlpha = 0.25;
      part.widget.draw(ctx, this.view(part, part.enabled ? live : null, nowMs));
      ctx.restore();
    }
    // Part labels. A part without its own widget gets its label on a gray plate of its size.
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.font = `${String(size * 0.8)}px ${FONT}`;
    const rows = new Map<string, ScenePart[]>();
    for (const part of this.parts) {
      if (part.origin === "breadboard") {
        // Under a breadboard part go its name and, one line below, the pin numbers: on one line the labels
        // of neighboring cells would overlap.
        const pins = Object.values(part.config.pins).join(", ");
        const below = part.y + part.box.y + part.box.h + 0.9;
        // For a probe the label is the label setting (spec section 6.5), if it is set.
        const own = part.config.type === "probe" ? part.config.settings.label : "";
        const title = typeof own === "string" && own !== "" ? own : part.config.label;
        const color = themeColor("--board-label");
        label(title, part.x, below, "center", color, 0.8);
        label(t("board.partPins", { pins }), part.x, below + (size * 0.95) / fit.scale, "center", color, 0.8);
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        if (!part.widget.plain) continue;
      }
      if (!part.widget.plain) {
        const row = `${part.config.type}:${String(part.y)}`;
        rows.set(row, [...(rows.get(row) ?? []), part]);
        continue;
      }
      const w = ctx.measureText(part.config.label).width + 10;
      const h = size * 0.8 + 6;
      ctx.fillStyle = "#737a84";
      ctx.beginPath();
      ctx.roundRect(fit.dx + part.x * fit.scale - w / 2, fit.dy + part.y * fit.scale - h / 2, w, h, 3);
      ctx.fill();
      label(part.config.label, part.x, part.y, "center", "#f2f3f5", 0.8);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    }
    // Parts of one type in a row (LEDs): if labels do not fit the pitch, the common start
    // of the label is written once to the left of the row, and the differing endings stay under the parts.
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      const labels = row.map((part) => part.config.label);
      const first = row[0];
      const second = row[1];
      let prefix = 0;
      if (first && second) {
        const pitch = (second.x - first.x) * fit.scale;
        const widest = Math.max(...labels.map((text) => ctx.measureText(text).width));
        if (widest + 4 > pitch) prefix = commonPrefix(labels);
      }
      for (const part of row) {
        const below = part.y + part.box.y + part.box.h + 0.9;
        label(part.config.label.slice(prefix), part.x, below, "center", "#c9ccd1", 0.8);
      }
      if (prefix > 0 && first) {
        const below = first.y + first.box.y + first.box.h + 0.9;
        label(first.config.label.slice(0, prefix), first.x + first.box.x - 0.5, below, "right", "#c9ccd1", 0.8);
      }
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  private view(part: ScenePart, live: Live | null, nowMs: number): PartView {
    const nets: PartView["nets"] = {};
    for (const [role, pin] of Object.entries(part.config.pins)) nets[role] = live?.byPin.get(pin);
    return {
      config: part.config,
      nets,
      state: live?.parts.get(part.config.id),
      running: live?.running ?? false,
      nowMs,
    };
  }

  // ---- Mouse and keyboard ----

  private toMm(px: number, py: number): { x: number; y: number } {
    return { x: (px - this.fit.dx) / this.fit.scale, y: (py - this.fit.dy) / this.fit.scale };
  }

  private partAt(px: number, py: number): ScenePart | undefined {
    const { x, y } = this.toMm(px, py);
    return this.parts.find((part) => {
      const lx = x - part.x;
      const ly = y - part.y;
      if (part.widget.hitTest) return part.widget.hitTest(lx, ly);
      return lx >= part.box.x && lx <= part.box.x + part.box.w && ly >= part.box.y && ly <= part.box.y + part.box.h;
    });
  }

  private contactAt(px: number, py: number): Contact | undefined {
    const { x, y } = this.toMm(px, py);
    const reach = PAD / 2 + 0.3;
    return this.contacts.find((c) => Math.abs(x - c.x) <= reach && Math.abs(y - c.y) <= reach);
  }

  private sender(part: ScenePart, send: SendPart): SendCommand {
    return (cmd, args) => {
      send(part.config.id, cmd, args);
    };
  }

  // Returns true if the press landed on a part driven by the mouse, or started
  // a wire drag. A wire is dragged from a breadboard part without mouse control (LED,
  // probe); for a button and a switch the pin is changed in a dialog.
  pointerDown(px: number, py: number, shift: boolean, send: SendPart): boolean {
    const part = this.partAt(px, py);
    if (!part) return false;
    if (part.interactive && part.widget.onPointer) {
      this.active = part;
      part.widget.onPointer({ kind: "down", shift }, this.sender(part, send));
      return true;
    }
    if (part.origin !== "breadboard" || Object.keys(part.config.pins).length !== 1) return false;
    this.drag = { part, ...this.toMm(px, py) };
    return true;
  }

  pointerMove(px: number, py: number): void {
    if (this.drag) this.drag = { part: this.drag.part, ...this.toMm(px, py) };
  }

  // Mouse release. If a wire from a breadboard part is released on a header pad with an FPGA pin,
  // returns a binding request.
  pointerUp(kind: "up" | "cancel", shift: boolean, send: SendPart): BindRequest | null {
    const part = this.active;
    this.active = null;
    part?.widget.onPointer?.({ kind, shift }, this.sender(part, send));
    const drag = this.drag;
    this.drag = null;
    if (!drag || kind !== "up") return null;
    const reach = PAD / 2 + 0.3;
    const contact = this.contacts.find((c) => Math.abs(drag.x - c.x) <= reach && Math.abs(drag.y - c.y) <= reach);
    const role = Object.keys(drag.part.config.pins)[0];
    if (!contact || contact.pin === null || role === undefined) return null;
    return { part: drag.part.config.id, role, pin: contact.pin };
  }

  // The part under the pointer whose click opens a bottom panel tab (UART terminal).
  tabAt(px: number, py: number): { part: string; tab: "terminal" } | null {
    const part = this.partAt(px, py);
    return part?.enabled && part.widget.tab ? { part: part.config.id, tab: part.widget.tab } : null;
  }

  key(event: KeyboardEvent, send: SendPart): void {
    // A disabled built-in part does not go to the core: it gets no keys.
    for (const part of this.parts) if (part.enabled) part.widget.onKey?.(event, this.sender(part, send));
  }

  // The window lost focus: a key or mouse release will not reach it.
  drop(send: SendPart): void {
    this.active = null;
    this.drag = null;
    for (const part of this.parts) part.widget.drop?.(this.sender(part, send));
  }

  // The simulation restarted: the core reset the parts, widgets forget presses.
  reset(): void {
    this.active = null;
    for (const part of this.parts) part.widget.reset?.();
  }

  // What is under the pointer: tooltip lines and the pointer shape.
  hover(px: number, py: number, live: Live | null, nowMs: number): { lines: HintLine[]; clickable: boolean } | null {
    const part = this.partAt(px, py);
    this.hoverPin = null;
    if (part) {
      const at = this.toMm(px, py);
      const local = { x: at.x - part.x, y: at.y - part.y };
      const lines = part.widget.hint?.(this.view(part, live, nowMs), local) ?? [
        { key: "hint.partOnly", args: { label: part.config.label } },
      ];
      const opens = part.widget.tab !== undefined && part.enabled;
      return { lines, clickable: part.interactive || part.origin === "breadboard" || opens };
    }
    const contact = this.contactAt(px, py);
    if (!contact) return null;
    if (contact.pin === null)
      return { lines: [{ key: "hint.power", args: { name: contact.power } }], clickable: false };
    this.hoverPin = contact.pin;
    const info = this.board.pins[String(contact.pin)];
    const net = live?.byPin.get(contact.pin);
    const lines: HintLine[] = [{ key: "hint.pin", args: { pin: contact.pin, name: info?.name ?? "" } }];
    lines.push({ key: `hint.state.${pinState(this.board, contact.pin, Boolean(net?.port))}` });
    if (info?.note) lines.push({ key: "hint.note", args: { note: localized(info.note) } });
    if (net?.port) lines.push({ key: "hint.port", args: { port: net.name ?? net.port } });
    if (net) lines.push({ key: "hint.level", args: { level: net.level } });
    return { lines, clickable: false };
  }

  leave(): void {
    this.hoverPin = null;
  }

  // ---- Data for window.__fpgasim ----

  partStatus(id: string, live: Live | null): Record<string, StatusValue> | null {
    const part = this.parts.find((p) => p.config.id === id);
    if (!part) return null;
    return part.widget.status?.(this.view(part, part.enabled ? live : null, performance.now())) ?? {};
  }

  // Drawing parts: name, type, pins, place (board or breadboard), whether enabled.
  partList(): { id: string; type: string; pins: Record<string, number>; origin: string; enabled: boolean }[] {
    return this.parts.map((p) => ({
      id: p.config.id,
      type: p.config.type,
      pins: p.config.pins,
      origin: p.origin,
      enabled: p.enabled,
    }));
  }

  // Part center in drawing area pixels: an end-to-end test clicks at this point.
  partCenter(id: string): { x: number; y: number } | null {
    const part = this.parts.find((p) => p.config.id === id);
    if (!part) return null;
    return { x: this.fit.dx + part.x * this.fit.scale, y: this.fit.dy + part.y * this.fit.scale };
  }

  // Header pads; point is the pad center in drawing area pixels.
  pins(live: Live | null): { pin: number; state: PinState; level: number | null; point: { x: number; y: number } }[] {
    return this.contacts.flatMap((c) => {
      if (c.pin === null) return [];
      const net = live?.byPin.get(c.pin);
      const point = { x: this.fit.dx + c.x * this.fit.scale, y: this.fit.dy + c.y * this.fit.scale };
      return [
        { pin: c.pin, state: pinState(this.board, c.pin, Boolean(net?.port)), level: net ? net.level : null, point },
      ];
    });
  }
}
