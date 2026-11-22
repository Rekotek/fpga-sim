// UART (spec section 6.3): an icon on the board with two line-activity lights. A click on the icon
// opens the terminal tab of this part. State from the frame: received, sent, queued.
import type { HintLine, PartView, PartWidget, WidgetBox } from "./types";

const W = 5.2; // mm
const H = 2.2;
const LAMP = 0.42;

export interface UartCounters {
  received: number;
  sent: number;
  queued: number;
}

// Three u32 numbers from the part block in the frame.
export function uartCounters(state: Uint8Array | undefined): UartCounters {
  if (!state || state.length < 12) return { received: 0, sent: 0, queued: 0 };
  const v = new DataView(state.buffer, state.byteOffset, state.byteLength);
  return { received: v.getUint32(0, true), sent: v.getUint32(4, true), queued: v.getUint32(8, true) };
}

export class UartWidget implements PartWidget {
  readonly tab = "terminal";

  layout(): WidgetBox {
    return { x: -W / 2, y: -H / 2, w: W, h: H };
  }

  hitTest(x: number, y: number): boolean {
    return Math.abs(x) <= W / 2 && Math.abs(y) <= H / 2;
  }

  draw(ctx: CanvasRenderingContext2D, view: PartView): void {
    ctx.fillStyle = "#2b2f36";
    ctx.strokeStyle = "#6d737c";
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.roundRect(-W / 2, -H / 2, W, H, 0.35);
    ctx.fill();
    ctx.stroke();
    // Terminal sign: a prompt and a cursor.
    ctx.strokeStyle = "#c9ccd1";
    ctx.lineWidth = 0.18;
    ctx.beginPath();
    ctx.moveTo(-1.9, -0.45);
    ctx.lineTo(-1.35, 0);
    ctx.lineTo(-1.9, 0.45);
    ctx.moveTo(-1.0, 0.5);
    ctx.lineTo(-0.2, 0.5);
    ctx.stroke();
    // Lights: the line from the FPGA (green) and the line to the FPGA (yellow) are lit while the line has edges.
    this.lamp(ctx, 0.9, (view.nets.fromFpga?.rate ?? 0) > 0, "64, 220, 96");
    this.lamp(ctx, 1.9, (view.nets.toFpga?.rate ?? 0) > 0, "255, 200, 48");
  }

  private lamp(ctx: CanvasRenderingContext2D, x: number, on: boolean, rgb: string): void {
    ctx.fillStyle = on ? `rgb(${rgb})` : `rgba(${rgb}, 0.22)`;
    ctx.beginPath();
    ctx.arc(x, 0, LAMP, 0, 2 * Math.PI);
    ctx.fill();
  }

  hint(view: PartView): HintLine[] {
    const { fromFpga, toFpga } = view.config.pins;
    const counters = uartCounters(view.state);
    const lines: HintLine[] = [{ key: "hint.partOnly", args: { label: view.config.label } }];
    if (fromFpga !== undefined) lines.push({ key: "hint.uart.fromFpga", args: { pin: fromFpga } });
    if (toFpga !== undefined) lines.push({ key: "hint.uart.toFpga", args: { pin: toFpga } });
    lines.push({ key: "hint.uart.baud", args: { baud: view.config.settings.baud } });
    lines.push({ key: "hint.uart.counters", args: { ...counters } });
    lines.push({ key: "hint.uart.open" });
    return lines;
  }

  status(view: PartView): Record<string, number> {
    return { ...uartCounters(view.state) };
  }
}
