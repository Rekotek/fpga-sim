// Part widget (spec section 9.4). Drawn on a Canvas in part coordinates: the unit is a millimeter,
// the origin is the part geometry point in the board file. Data comes from the last core frame.
import type { PartDescription } from "../project/assets";
import type { LiveNet } from "../sim/host";

export interface PartConfig {
  id: string;
  type: string;
  label: string;
  pins: Record<string, number>;
  settings: Record<string, unknown>; // with defaults from the part description
}

// Widget rectangle in millimeters relative to the part point.
export interface WidgetBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PartView {
  config: PartConfig;
  nets: Record<string, LiveNet | undefined>; // by pin role
  state: Uint8Array | undefined; // state bytes from the frame (spec section 6)
  running: boolean; // the simulation runs; on pause the widget shows the instantaneous state
  nowMs: number; // real time of the screen frame
}

export interface WidgetPointerEvent {
  kind: "down" | "up" | "cancel";
  shift: boolean;
}

export type SendCommand = (cmd: string, args?: Record<string, unknown>) => void;

// A tooltip line: a dictionary key and substitutions. The widget holds no interface text.
export interface HintLine {
  key: string;
  args?: Record<string, unknown>;
}

// A value for window.__fpgasim: a number, a flag or a list of strings (WS2812 colors).
export type StatusValue = number | boolean | string[];

export interface PartWidget {
  // The type has no widget: the drawing itself renders a gray plate with a label.
  readonly plain?: boolean;
  // A click on a part opens its tab in the bottom panel (UART terminal).
  readonly tab?: "terminal";
  layout(part: PartConfig, desc: PartDescription | undefined): WidgetBox;
  draw(ctx: CanvasRenderingContext2D, view: PartView): void;
  hitTest?(x: number, y: number): boolean;
  onPointer?(event: WidgetPointerEvent, send: SendCommand): void;
  onKey?(event: KeyboardEvent, send: SendCommand): void;
  // The window lost focus: the widget releases what the mouse and key held.
  drop?(send: SendCommand): void;
  // The simulation restarted: the widget forgets its state and sends nothing to the core.
  reset?(): void;
  // Hover tooltip; at is the pointer point in part coordinates, mm.
  hint?(view: PartView, at?: { x: number; y: number }): HintLine[];
  // Data for window.__fpgasim (spec section 9.7): brightness, press, colors, counters.
  status?(view: PartView): Record<string, StatusValue>;
}
