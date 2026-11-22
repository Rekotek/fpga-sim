// Geometry of the board drawing (spec section 9.4): pin positions of the headers and fitting into the area.
// All sizes are in millimeters, as in the geometry field of the board file.
import type { Board } from "../project/assets";

export interface Contact {
  header: string;
  side: "left" | "right";
  x: number;
  y: number;
  pin: number | null; // FPGA pin number; null is a power pin
  power: string | null;
}

// Margins around the board outline: room for pin numbers and LED glow. The margins are narrow so that
// the board fills almost the whole area: the "GND" label fits at the side, the USB connector protrusion at the top.
const SIDE = 4.5;
const TOP = 2.2;
const BOTTOM = 1.5;

export const PAD = 1.7; // side of a header pad

export function boardContacts(board: Board): Contact[] {
  const g = board.geometry;
  return board.headers.flatMap((header) => {
    const side = header.id === "right" ? "right" : "left";
    const x = side === "left" ? g.headerLeftX : g.headerRightX;
    return header.contacts.map((contact, i) => ({
      header: header.id,
      side,
      x,
      y: g.headerFirstY + i * g.headerPitch,
      pin: contact.pin ?? null,
      power: contact.power ?? null,
    }));
  });
}

export interface Extent {
  x: number;
  y: number;
  w: number;
  h: number;
}

// The breadboard field (spec section 9.4) sits to the right of the board: cells of CELL × CELL millimeters.
export const CELL = 9;
const FIELD_GAP = 1.5;

export interface Field {
  x: number; // top-left corner of the field, mm
  y: number;
  columns: number;
  rows: number;
}

// The field by occupied cells; at least as many rows as fit next to the board.
export function breadboardField(board: Board, cells: readonly { x: number; y: number }[], columns: number): Field {
  const g = board.geometry;
  return {
    x: g.width + SIDE + FIELD_GAP,
    y: 0,
    columns: Math.max(columns, ...cells.map((c) => c.x + 1)),
    rows: Math.max(Math.floor(g.height / CELL), ...cells.map((c) => c.y + 1)),
  };
}

export function cellCenter(field: Field, cell: { x: number; y: number }): { x: number; y: number } {
  return { x: field.x + (cell.x + 0.5) * CELL, y: field.y + (cell.y + 0.5) * CELL };
}

// Drawing area: the board with margins and, if the breadboard has parts, the breadboard field on the right.
export function boardExtent(board: Board, field: Field | null = null): Extent {
  const g = board.geometry;
  const base = { x: -SIDE, y: -TOP, w: g.width + 2 * SIDE, h: g.height + TOP + BOTTOM };
  if (!field) return base;
  return {
    ...base,
    w: field.x + field.columns * CELL + FIELD_GAP - base.x,
    h: Math.max(base.h, field.y + field.rows * CELL + BOTTOM - base.y),
  };
}

// Millimeters to area pixels: xPx = dx + xMm * scale.
export interface Fit {
  scale: number;
  dx: number;
  dy: number;
}

const MAX_SCALE = 18; // a larger board is no easier to read

export function fitBoard(extent: Extent, width: number, height: number): Fit {
  const scale = Math.max(1, Math.min(width / extent.w, height / extent.h, MAX_SCALE));
  return {
    scale,
    dx: (width - extent.w * scale) / 2 - extent.x * scale,
    dy: Math.max(0, (height - extent.h * scale) / 2) - extent.y * scale,
  };
}

// Pin state for color and tooltip: use by a design port outranks the state from the board file.
export type PinState = "busy" | "free" | "onboard" | "header" | "clock" | "forbidden" | "unknown";

export function pinState(board: Board, pin: number, bound: boolean): PinState {
  const status = board.pins[String(pin)]?.status;
  if (status === "forbidden") return "forbidden";
  if (bound) return "busy";
  if (status === "free" || status === "onboard" || status === "header" || status === "clock") return status;
  return "unknown";
}
