// WS2812 (spec section 6.4): LEDs in a layout (strip, ring, matrix) with colors from the frame.
// State from the frame: u16 LED count, u16 reserve, u32 error counter, RGB triples.
import type { HintLine, PartView, PartWidget, StatusValue, WidgetBox } from "./types";

const EXTENT = 8.2; // mm: the largest widget size, it fits in a breadboard cell
const PITCH = 1.7; // mm: LED pitch when there is room
const STRIP_ROW = 16; // LEDs per strip row

export interface LedPlace {
  x: number;
  y: number;
}

export interface LedLayout {
  places: LedPlace[];
  size: number; // LED side, mm
  box: WidgetBox;
}

function grid(count: number, columns: number): LedLayout {
  const rows = Math.ceil(count / columns);
  const pitch = Math.min(PITCH, EXTENT / Math.max(columns, rows));
  const places: LedPlace[] = [];
  for (let i = 0; i < count; i += 1) {
    places.push({
      x: ((i % columns) - (columns - 1) / 2) * pitch,
      y: (Math.floor(i / columns) - (rows - 1) / 2) * pitch,
    });
  }
  const w = columns * pitch;
  const h = rows * pitch;
  return { places, size: pitch * 0.82, box: { x: -w / 2, y: -h / 2, w, h } };
}

// LED positions in millimeters relative to the part point.
export function ledLayout(count: number, layout: unknown, width: unknown): LedLayout {
  const n = Math.max(1, Math.min(256, Math.floor(count)));
  if (layout === "matrix") {
    const columns = typeof width === "number" && width >= 1 ? Math.min(Math.floor(width), n) : Math.min(8, n);
    return grid(n, columns);
  }
  if (layout === "ring" && n > 2) {
    // The first LED is at the top, then clockwise.
    const radius = Math.min(EXTENT / 2 - 0.5, (n * PITCH) / (2 * Math.PI));
    const size = Math.min(PITCH, (2 * Math.PI * radius) / n) * 0.82;
    const places = Array.from({ length: n }, (_, i) => {
      const angle = (2 * Math.PI * i) / n - Math.PI / 2;
      return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
    });
    const half = radius + size / 2;
    return { places, size, box: { x: -half, y: -half, w: 2 * half, h: 2 * half } };
  }
  return grid(n, Math.min(n, STRIP_ROW));
}

export interface LedState {
  colors: [number, number, number][];
  errors: number;
}

export function ledState(state: Uint8Array | undefined): LedState {
  if (!state || state.length < 8) return { colors: [], errors: 0 };
  const v = new DataView(state.buffer, state.byteOffset, state.byteLength);
  const colors: [number, number, number][] = [];
  for (let at = 8; at + 2 < state.length; at += 3)
    colors.push([state[at] ?? 0, state[at + 1] ?? 0, state[at + 2] ?? 0]);
  return { colors, errors: v.getUint32(4, true) };
}

export function colorHex(color: readonly number[]): string {
  return `#${color.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

// On-screen brightness: a real LED already glows visibly at a small value.
const shown = (c: number): number => Math.round(255 * Math.pow(c / 255, 0.45));

export class Ws2812Widget implements PartWidget {
  private made: LedLayout = ledLayout(1, "strip", 8);

  layout(part: { settings: Record<string, unknown> }): WidgetBox {
    const count = typeof part.settings.count === "number" ? part.settings.count : 1;
    this.made = ledLayout(count, part.settings.layout, part.settings.width);
    return this.made.box;
  }

  hitTest(x: number, y: number): boolean {
    const { box } = this.made;
    return x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h;
  }

  draw(ctx: CanvasRenderingContext2D, view: PartView): void {
    const { places, size } = this.made;
    const { colors } = ledState(view.state);
    places.forEach((place, i) => {
      const [r, g, b] = (colors[i] ?? [0, 0, 0]).map(shown) as [number, number, number];
      const lit = Math.max(r, g, b) / 255;
      if (lit > 0.02) {
        const glow = ctx.createRadialGradient(place.x, place.y, size * 0.2, place.x, place.y, size * 1.1);
        glow.addColorStop(0, `rgba(${String(r)}, ${String(g)}, ${String(b)}, ${String(0.6 * lit)})`);
        glow.addColorStop(1, `rgba(${String(r)}, ${String(g)}, ${String(b)}, 0)`);
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(place.x, place.y, size * 1.1, 0, 2 * Math.PI);
        ctx.fill();
      }
      // The body is white, the die in the middle glows in the color.
      ctx.fillStyle = "#e8e9ec";
      ctx.strokeStyle = "#6d737c";
      ctx.lineWidth = Math.min(0.1, size * 0.08);
      ctx.beginPath();
      ctx.roundRect(place.x - size / 2, place.y - size / 2, size, size, size * 0.15);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = lit > 0.02 ? `rgb(${String(r)}, ${String(g)}, ${String(b)})` : "#3a3f47";
      ctx.beginPath();
      ctx.arc(place.x, place.y, size * 0.33, 0, 2 * Math.PI);
      ctx.fill();
    });
  }

  // Index of the LED under a point (in part coordinates) or −1.
  private ledAt(at: { x: number; y: number } | undefined): number {
    if (!at) return -1;
    const reach = this.made.size / 2 + 0.1;
    return this.made.places.findIndex((p) => Math.abs(at.x - p.x) <= reach && Math.abs(at.y - p.y) <= reach);
  }

  hint(view: PartView, at?: { x: number; y: number }): HintLine[] {
    const { colors, errors } = ledState(view.state);
    const lines: HintLine[] = [
      { key: "hint.part", args: { label: view.config.label, pin: view.config.pins.din } },
      { key: "hint.ws2812.count", args: { count: this.made.places.length } },
    ];
    const index = this.ledAt(at);
    const color = colors[index];
    if (color) lines.push({ key: "hint.ws2812.color", args: { index, color: colorHex(color) } });
    if (errors > 0) lines.push({ key: "hint.ws2812.errors", args: { errors } });
    return lines;
  }

  status(view: PartView): Record<string, StatusValue> {
    const { colors, errors } = ledState(view.state);
    return { colors: colors.map(colorHex), errors };
  }
}
