// Switch (spec section 6.2): changes position on click and on the key from the key setting.
import type { HintLine, PartView, PartWidget, SendCommand, WidgetBox, WidgetPointerEvent } from "./types";

const W = 3.6; // mm
const H = 2.0;

export class SwitchWidget implements PartWidget {
  private key = "";
  private on = false; // the position the interface last sent to the core

  layout(part: { settings: Record<string, unknown> }): WidgetBox {
    this.key = typeof part.settings.key === "string" ? part.settings.key.toLowerCase() : "";
    return { x: -W / 2, y: -H / 2, w: W, h: H };
  }

  hitTest(x: number, y: number): boolean {
    return Math.abs(x) <= W / 2 && Math.abs(y) <= H / 2;
  }

  private toggle(view: boolean, send: SendCommand): void {
    this.on = !view;
    send("set", { on: this.on });
  }

  onPointer(event: WidgetPointerEvent, send: SendCommand): void {
    if (event.kind === "down") this.toggle(this.on, send);
  }

  onKey(event: KeyboardEvent, send: SendCommand): void {
    if (this.key === "" || event.type !== "keydown" || event.repeat) return;
    const upper = this.key.toUpperCase();
    if (event.key.toLowerCase() !== this.key && event.code !== `Digit${upper}` && event.code !== `Key${upper}`) return;
    this.toggle(this.on, send);
  }

  // The core restarted the simulation and returned the switch to the off position.
  reset(): void {
    this.on = false;
  }

  draw(ctx: CanvasRenderingContext2D, view: PartView): void {
    const on = this.shown(view);
    ctx.fillStyle = on ? "#1f5fbf" : "#8a9099";
    ctx.strokeStyle = "#4a515c";
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.roundRect(-W / 2, -H / 2, W, H, H / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f2f3f5";
    ctx.beginPath();
    ctx.arc(on ? W / 2 - H / 2 : -W / 2 + H / 2, 0, H / 2 - 0.25, 0, 2 * Math.PI);
    ctx.fill();
  }

  hint(view: PartView): HintLine[] {
    const lines: HintLine[] = [{ key: "hint.part", args: { label: view.config.label, pin: view.config.pins.out } }];
    lines.push({ key: this.shown(view) ? "hint.switchOn" : "hint.switchOff" });
    if (this.key !== "") lines.push({ key: "hint.key", args: { key: this.key.toUpperCase() } });
    return lines;
  }

  status(view: PartView): Record<string, number | boolean> {
    return { on: this.shown(view) };
  }

  // Until the core sends a state, what the interface sent is shown.
  private shown(view: PartView): boolean {
    const byte = view.state?.[0];
    if (byte !== undefined) this.on = byte !== 0;
    return this.on;
  }
}
