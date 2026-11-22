// The configure message (spec section 4.4) from the pin binding, the board file and fpgasim.json: built-in parts
// with changes from boardParts and breadboard parts go in one list.
// Same logic as in tools/headless/core.mjs (makeConfigure).
import type { Board } from "../project/assets";
import type { Binding, PartItem } from "../project/config";
import type { Configure, ConfigureNet } from "./messages";

// Parts whose types the core lacks (partTypes from ready) and disabled parts do not go into configure.
export function makeConfigure(
  board: Board,
  binding: Pick<Binding, "pins" | "clock">,
  items: readonly PartItem[],
  partTypes: readonly string[],
): Configure {
  const nets: ConfigureNet[] = binding.pins.map((p) => ({ pin: p.pin, port: p.port, bit: p.bit, pull: p.pull }));
  const pins = new Set(nets.map((n) => n.pin));
  const parts = items
    .filter((p) => p.enabled && partTypes.includes(p.type))
    .map((p) => ({ id: p.id, type: p.type, pins: p.pins, settings: p.settings }));
  for (const part of parts) {
    for (const pin of Object.values(part.pins)) {
      if (!pins.has(pin)) {
        nets.push({ pin, pull: "none" });
        pins.add(pin);
      }
    }
  }
  const clock = binding.clock ? { port: binding.clock.port, hz: binding.clock.hz } : null;
  return { t: "configure", board: board.id, clock, nets, parts, watch: [] };
}

// Whether two configure messages differ only in part settings: then partSettings is enough, with no reset.
export function settingsOnly(before: Configure, after: Configure): string[] | null {
  const strip = (c: Configure): string =>
    JSON.stringify({ ...c, parts: c.parts.map((p) => ({ ...p, settings: null })) });
  if (strip(before) !== strip(after)) return null;
  return after.parts
    .filter((part, i) => JSON.stringify(part.settings) !== JSON.stringify(before.parts[i]?.settings))
    .map((part) => part.id);
}
