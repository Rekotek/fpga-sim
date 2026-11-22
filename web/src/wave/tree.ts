// Signal tree (spec section 4.5): built from the dots in the path. Next to the design signals sits
// a group of board pins: nets of the current configure under the names pin:N (spec section 6.5).
import type { SignalInfo } from "../sim/messages";

export interface TreePin {
  pin: number;
  port: string | null; // design port bit name
}

export interface TreeRow {
  key: string; // group path or signal name
  depth: number;
  label: string;
  group: boolean;
  open: boolean; // for a group
  name: string | null; // name for watch and record: signal path or pin:N
  signal: SignalInfo | null;
  pin: TreePin | null;
}

export const PINS_GROUP = "pin:";

export const pinName = (pin: number): string => `pin:${String(pin)}`;

export const pinOfName = (name: string): number | null => {
  const match = /^pin:(\d+)$/.exec(name);
  return match ? Number(match[1]) : null;
};

interface Node {
  key: string;
  label: string;
  groups: Map<string, Node>;
  leaves: SignalInfo[];
}

const matches = (text: string, filter: string): boolean => text.toLowerCase().includes(filter);

// Tree rows from top to bottom. With a search, matching signals and their groups remain, all groups
// are open; without a search, a group in closed is collapsed.
export function treeRows(
  signals: readonly SignalInfo[],
  pins: readonly TreePin[],
  search: string,
  closed: ReadonlySet<string>,
  pinsLabel: string,
): TreeRow[] {
  const filter = search.trim().toLowerCase();
  const root: Node = { key: "", label: "", groups: new Map(), leaves: [] };
  for (const signal of signals) {
    if (filter !== "" && !matches(signal.path, filter)) continue;
    const parts = signal.path.split(".");
    let node = root;
    for (const part of parts.slice(0, -1)) {
      let next = node.groups.get(part);
      if (!next) {
        next = { key: node.key === "" ? part : `${node.key}.${part}`, label: part, groups: new Map(), leaves: [] };
        node.groups.set(part, next);
      }
      node = next;
    }
    node.leaves.push(signal);
  }

  const rows: TreeRow[] = [];
  const isOpen = (key: string): boolean => filter !== "" || !closed.has(key);
  const walk = (node: Node, depth: number): void => {
    for (const signal of node.leaves) {
      rows.push({
        key: signal.path,
        depth,
        label: signal.path.slice(signal.path.lastIndexOf(".") + 1),
        group: false,
        open: false,
        name: signal.path,
        signal,
        pin: null,
      });
    }
    for (const group of node.groups.values()) {
      const open = isOpen(group.key);
      rows.push({ key: group.key, depth, label: group.label, group: true, open, name: null, signal: null, pin: null });
      if (open) walk(group, depth + 1);
    }
  };
  walk(root, 0);

  const shown = pins.filter(
    (p) => filter === "" || matches(pinName(p.pin), filter) || (p.port !== null && matches(p.port, filter)),
  );
  if (shown.length > 0) {
    const open = isOpen(PINS_GROUP);
    rows.push({
      key: PINS_GROUP,
      depth: 0,
      label: pinsLabel,
      group: true,
      open,
      name: null,
      signal: null,
      pin: null,
    });
    if (open) {
      for (const pin of shown) {
        const name = pinName(pin.pin);
        rows.push({ key: name, depth: 1, label: name, group: false, open: false, name, signal: null, pin });
      }
    }
  }
  return rows;
}
