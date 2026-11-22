// Workspace layout (spec section 9.3): width of the "Files" and "Board" areas, height of the bottom
// panel, collapsed areas. Remembered per project in the browser's localStorage.
export type Area = "files" | "editor" | "board";

export interface Layout {
  files: number; // pixels
  board: number;
  bottom: number;
  collapsed: Record<Area, boolean>;
}

export const DEFAULT_LAYOUT: Layout = {
  files: 170,
  board: 440,
  bottom: 210,
  collapsed: { files: false, editor: false, board: false },
};

const LIMITS = { files: [110, 420], board: [260, 1100], bottom: [80, 700] } as const;
export type Edge = keyof typeof LIMITS;

const clamp = (value: number, [low, high]: readonly [number, number]): number =>
  Math.round(Math.min(high, Math.max(low, value)));

// Border shift: the "Files" area grows to the right, "Board" to the left, the bottom panel upward.
// The window sets the upper limit: the neighboring areas keep at least REST pixels.
const REST = 240;

export function resizeLayout(
  layout: Layout,
  edge: Edge,
  size: number,
  viewport?: { width: number; height: number },
): Layout {
  const low: number = LIMITS[edge][0];
  let high: number = LIMITS[edge][1];
  if (viewport) {
    const other = edge === "files" ? layout.board : edge === "board" ? layout.files : 0;
    const room = (edge === "bottom" ? viewport.height : viewport.width - other) - REST;
    high = Math.max(low, Math.min(high, room));
  }
  return { ...layout, [edge]: clamp(size, [low, high]) };
}

export function toggleArea(layout: Layout, area: Area): Layout {
  return { ...layout, collapsed: { ...layout.collapsed, [area]: !layout.collapsed[area] } };
}

// Layout from a saved value: everything missing or of a wrong shape takes the default.
export function parseLayout(text: string | null): Layout {
  let saved: unknown;
  try {
    saved = text === null ? null : (JSON.parse(text) as unknown);
  } catch {
    saved = null;
  }
  if (typeof saved !== "object" || saved === null) return DEFAULT_LAYOUT;
  const fields = saved as Record<string, unknown>;
  const size = (edge: Edge): number =>
    typeof fields[edge] === "number" && Number.isFinite(fields[edge])
      ? clamp(fields[edge], LIMITS[edge])
      : DEFAULT_LAYOUT[edge];
  const collapsed = (
    typeof fields.collapsed === "object" && fields.collapsed !== null ? fields.collapsed : {}
  ) as Record<string, unknown>;
  return {
    files: size("files"),
    board: size("board"),
    bottom: size("bottom"),
    collapsed: {
      files: collapsed.files === true,
      editor: collapsed.editor === true,
      board: collapsed.board === true,
    },
  };
}

const storageKey = (project: string): string => `fpgasim.layout.${project}`;

// Storage may be unavailable (private browser mode): then the layout lives until the page closes.
export function loadLayout(project: string): Layout {
  try {
    return parseLayout(localStorage.getItem(storageKey(project)));
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function saveLayout(project: string, layout: Layout): void {
  try {
    localStorage.setItem(storageKey(project), JSON.stringify(layout));
  } catch {
    // The layout will not be saved; this does not hinder work.
  }
}

export function dropLayout(project: string): void {
  try {
    localStorage.removeItem(storageKey(project));
  } catch {
    // Nothing to erase.
  }
}
