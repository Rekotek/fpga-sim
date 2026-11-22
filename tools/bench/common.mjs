// Shared numbers of the benchmark for Node, the page and result merging.
export const HALF_STEPS = 113_400_000; // 2.1 s of simulation time at 27 MHz
export const RUNS = 5; // measured runs; one warm-up run comes before them
export const EXPECT_LED = [4, 8, 16, 0, 0, 0]; // check numbers from spec section 2.7: do not weaken

// The first run is a warm-up. Every run must give the check numbers.
export function summarize(runs) {
  for (const r of runs) {
    if (r.error) throw new Error(r.error);
    if (r.halfSteps !== HALF_STEPS || JSON.stringify(r.toggles.led) !== JSON.stringify(EXPECT_LED)) {
      throw new Error(`неверные переключения: ${JSON.stringify(r.toggles)} за ${r.halfSteps} полутактов`);
    }
  }
  const mcps = runs.slice(1).map((r) => r.mcps);
  const sorted = [...mcps].sort((a, b) => a - b);
  return {
    mcps,
    median: sorted[Math.floor(sorted.length / 2)],
    best: sorted[sorted.length - 1],
    toggles: runs[runs.length - 1].toggles.led,
    ok: true,
  };
}
