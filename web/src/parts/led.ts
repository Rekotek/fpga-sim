// LED (spec section 6.1): a circle with color and glow by brightness. Brightness per batch is the share
// of time the net was at the active level; the display is smoothed with a time constant of 30 ms.
// On pause, the instantaneous pin level is shown.
import type { LiveNet } from "../sim/host";
import type { HintLine, PartView, PartWidget, WidgetBox } from "./types";

const SMOOTH_MS = 30;
const RADIUS = 0.7; // mm
const GLOW = 2.4;

const COLORS: Record<string, [number, number, number]> = {
  red: [255, 48, 32],
  green: [48, 220, 64],
  blue: [48, 120, 255],
  yellow: [255, 220, 32],
  orange: [255, 150, 24],
  white: [245, 245, 255],
};
const FALLBACK: [number, number, number] = [255, 48, 32];

// Nothing drives the net (no FPGA, no part): the pin is disconnected on the board, the LED is off.
const DRIVEN = 0b11;

// Brightness from the last frame: the share of time at the active level.
export function ledBrightness(activeLevel: unknown, net: LiveNet | undefined): number {
  if (!net || (net.flags & DRIVEN) === 0) return 0;
  return activeLevel === 0 ? 1 - net.duty : net.duty;
}

// Brightness on pause: the LED shows the pin level at that moment. The frame after a step carries the share
// for the whole step, and by it the LED after a long step would look dark at an active level.
export function ledLevel(activeLevel: unknown, net: LiveNet | undefined): number {
  if (!net || (net.flags & DRIVEN) === 0) return 0;
  return net.level === (activeLevel === 0 ? 0 : 1) ? 1 : 0;
}

// Display smoothing: an exponential step with a time constant of 30 ms.
export function smoothBrightness(shown: number, raw: number, dtMs: number): number {
  if (dtMs <= 0) return shown;
  return shown + (raw - shown) * (1 - Math.exp(-dtMs / SMOOTH_MS));
}

export class LedWidget implements PartWidget {
  private shown = 0;
  private lastMs: number | null = null;

  layout(): WidgetBox {
    return { x: -RADIUS, y: -RADIUS, w: 2 * RADIUS, h: 2 * RADIUS };
  }

  hitTest(x: number, y: number): boolean {
    return x * x + y * y <= RADIUS * RADIUS * 1.6;
  }

  draw(ctx: CanvasRenderingContext2D, view: PartView): void {
    const raw = view.running ? this.raw(view) : ledLevel(view.config.settings.activeLevel, view.nets.in);
    this.shown = this.lastMs === null ? raw : smoothBrightness(this.shown, raw, view.nowMs - this.lastMs);
    this.lastMs = view.nowMs;
    const [r, g, b] = COLORS[String(view.config.settings.color)] ?? FALLBACK;
    const rgb = `${String(r)}, ${String(g)}, ${String(b)}`;
    if (this.shown > 0.004) {
      const glow = ctx.createRadialGradient(0, 0, RADIUS * 0.4, 0, 0, GLOW);
      glow.addColorStop(0, `rgba(${rgb}, ${String(0.75 * this.shown)})`);
      glow.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, GLOW, 0, 2 * Math.PI);
      ctx.fill();
    }
    // Body: dark at rest, the color grows with brightness.
    const mix = (c: number): string => String(Math.round(40 + (c - 40) * this.shown));
    ctx.fillStyle = `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
    ctx.strokeStyle = `rgba(${rgb}, 0.9)`;
    ctx.lineWidth = 0.14;
    ctx.beginPath();
    ctx.arc(0, 0, RADIUS, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }

  hint(view: PartView): HintLine[] {
    const net = view.nets.in;
    const lines: HintLine[] = [{ key: "hint.part", args: { label: view.config.label, pin: view.config.pins.in } }];
    if (net) {
      lines.push({ key: "hint.level", args: { level: net.level } });
      lines.push({ key: "hint.duty", args: { percent: Math.round(net.duty * 100) } });
      lines.push({ key: "hint.frequency", args: { hz: net.rate / 2 } });
    }
    return lines;
  }

  status(view: PartView): Record<string, number | boolean> {
    return { brightness: this.raw(view), shown: this.shown };
  }

  private raw(view: PartView): number {
    return ledBrightness(view.config.settings.activeLevel, view.nets.in);
  }
}
