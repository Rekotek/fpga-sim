// Button (spec section 6.2): pressed by mouse and by key; Shift on click latches the press.
import type { HintLine, PartView, PartWidget, SendCommand, WidgetBox, WidgetPointerEvent } from "./types";

const SIZE = 3.0; // mm
const CAP = 0.95;

export class ButtonWidget implements PartWidget {
  private key = "";
  private byPointer = false; // the mouse holds the button
  private byKey = false; // a key holds the button
  private latched = false; // the press is latched by a Shift click

  layout(part: { settings: Record<string, unknown> }): WidgetBox {
    this.key = typeof part.settings.key === "string" ? part.settings.key.toLowerCase() : "";
    return { x: -SIZE / 2, y: -SIZE / 2, w: SIZE, h: SIZE };
  }

  hitTest(x: number, y: number): boolean {
    return Math.abs(x) <= SIZE / 2 && Math.abs(y) <= SIZE / 2;
  }

  // Whether the button is pressed as the interface sees it: what it last sent to the core.
  private get held(): boolean {
    return this.byPointer || this.byKey || this.latched;
  }

  private change(action: () => void, send: SendCommand): void {
    const before = this.held;
    action();
    if (this.held !== before) send(this.held ? "press" : "release");
  }

  onPointer(event: WidgetPointerEvent, send: SendCommand): void {
    this.change(() => {
      if (event.kind !== "down") {
        this.byPointer = false;
      } else if (this.latched) {
        // A click on a latched button releases it.
        this.latched = false;
      } else if (event.shift) {
        this.latched = true;
      } else {
        this.byPointer = true;
      }
    }, send);
  }

  // A key is recognized both by character and by keyboard position: with Shift held, "1" arrives as "!",
  // and without a position check the release would not reach the button.
  private matches(event: KeyboardEvent): boolean {
    if (this.key === "") return false;
    const upper = this.key.toUpperCase();
    return event.key.toLowerCase() === this.key || event.code === `Digit${upper}` || event.code === `Key${upper}`;
  }

  // The window lost focus: it will get no key or mouse release. The latch stays.
  drop(send: SendCommand): void {
    this.change(() => {
      this.byPointer = false;
      this.byKey = false;
    }, send);
  }

  // The core restarted the simulation (reset, new build) and released the button itself.
  reset(): void {
    this.byPointer = false;
    this.byKey = false;
    this.latched = false;
  }

  onKey(event: KeyboardEvent, send: SendCommand): void {
    if (!this.matches(event)) return;
    if (event.type === "keydown" && event.repeat) return;
    this.change(() => {
      this.byKey = event.type === "keydown";
    }, send);
  }

  draw(ctx: CanvasRenderingContext2D, view: PartView): void {
    const pressed = this.pressed(view);
    ctx.fillStyle = "#c9ccd1";
    ctx.strokeStyle = "#6d737c";
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.roundRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE, 0.35);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = pressed ? "#1f5fbf" : "#2b2f36";
    ctx.beginPath();
    ctx.arc(0, 0, pressed ? CAP * 0.82 : CAP, 0, 2 * Math.PI);
    ctx.fill();
    if (this.latched) {
      ctx.strokeStyle = "#1f5fbf";
      ctx.lineWidth = 0.2;
      ctx.beginPath();
      ctx.roundRect(-SIZE / 2 - 0.25, -SIZE / 2 - 0.25, SIZE + 0.5, SIZE + 0.5, 0.5);
      ctx.stroke();
    }
  }

  hint(view: PartView): HintLine[] {
    const lines: HintLine[] = [{ key: "hint.part", args: { label: view.config.label, pin: view.config.pins.out } }];
    if (this.key !== "") lines.push({ key: "hint.key", args: { key: this.key.toUpperCase() } });
    lines.push({ key: "hint.latch" });
    return lines;
  }

  status(view: PartView): Record<string, number | boolean> {
    return { pressed: this.pressed(view), latched: this.latched };
  }

  // Until the core sends a state, what the interface sent is shown.
  private pressed(view: PartView): boolean {
    const byte = view.state?.[0];
    return byte === undefined ? this.held : byte !== 0;
  }
}
