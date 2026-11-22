// Benchmark: Mac power mode at the time of measuring.
// On battery macOS may turn on low-power mode, which lowers the CPU clock
// and the simulation speed by about a quarter. Without this record two measurements are not comparable.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function powerState() {
  if (process.platform !== "darwin") return null;
  try {
    const batt = execSync("pmset -g batt", { encoding: "utf8" });
    const all = execSync("pmset -g", { encoding: "utf8" });
    const low = /lowpowermode\s+(\d)/.exec(all);
    return {
      source: /AC Power/.test(batt) ? "сеть" : /Battery Power/.test(batt) ? "батарея" : null,
      lowPowerMode: low ? low[1] === "1" : null,
    };
  } catch {
    return null;
  }
}

// A measurement counts as clean if the mode is the same at the start and at the end.
export function powerSpan(start, end) {
  return { start, end, stable: JSON.stringify(start) === JSON.stringify(end) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(powerState()));
