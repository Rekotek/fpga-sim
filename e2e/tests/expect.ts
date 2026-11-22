// Run expect.json in the browser (spec section 11.2): actions, run, expectations for pins and parts.
// The same check is in tools/headless/run.mjs; the stage 7 tests keep their own copy for parts.
import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { pickExample, sim, simWith } from "./stand";

type Matcher = number | string | boolean | { min?: number; max?: number };

interface NetExpect {
  toggles?: number;
  togglesMin?: number;
  level?: number;
  dutyMin?: number;
  dutyMax?: number;
}

interface PartExpect {
  text?: string;
  bytes?: number[];
  colors?: string[];
  errors?: number;
  events?: (string | { event: string; data?: Record<string, Matcher> })[];
}

export interface Expect {
  run: { ps: string };
  actions: {
    atPs: string;
    part: string;
    cmd: string;
    args?: Record<string, unknown>;
  }[];
  nets: Record<string, NetExpect>;
  parts: Record<string, PartExpect>;
}

// dir is the example folder from the repository root: "examples/blink3", "examples/lessons/lesson04_blink".
export const readExpect = (dir: string): Expect =>
  JSON.parse(readFileSync(new URL(`../../${dir}/expect.json`, import.meta.url), "utf8")) as Expect;

// Step to the given simulation time and wait for its end.
export async function stepTo(page: Page, target: bigint): Promise<void> {
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
  const now = BigInt(await sim(page, (api) => api.state().time));
  if (target <= now) return;
  await simWith(page, (target - now).toString(), (api, value) => api.command({ t: "step", unit: "time", ps: value }));
  await expect.poll(() => sim(page, (api) => api.state().time), { timeout: 120_000 }).toBe(target.toString());
  await expect.poll(() => sim(page, (api) => api.state().stepping)).toBe(false);
}

function matches(want: Matcher, got: unknown): boolean {
  if (typeof want !== "object") return got === want;
  return typeof got === "number" && got >= (want.min ?? got) && got <= (want.max ?? got);
}

// The project is built and paused at zero. The duty cycle in the browser is known for the last step,
// so dutyMin and dutyMax are checked only in a run without actions: then one step covers the whole run.
export async function checkExpect(page: Page, expected: Expect): Promise<void> {
  for (const action of expected.actions) {
    await stepTo(page, BigInt(action.atPs));
    await simWith(page, action, (api, a) => api.command({ t: "part", part: a.part, cmd: a.cmd, args: a.args ?? {} }));
  }
  await stepTo(page, BigInt(expected.run.ps));
  for (const [pin, want] of Object.entries(expected.nets)) {
    const got = await simWith(page, Number(pin), (api, n) => api.net(n));
    expect(got, `вывод ${pin}`).not.toBeNull();
    if (!got) continue;
    if (want.toggles !== undefined) expect(got.toggles, `вывод ${pin}: переключения`).toBe(want.toggles);
    if (want.togglesMin !== undefined)
      expect(got.toggles, `вывод ${pin}: переключения`).toBeGreaterThanOrEqual(want.togglesMin);
    if (want.level !== undefined) expect(got.level, `вывод ${pin}: уровень`).toBe(want.level);
    if (expected.actions.length === 0) {
      if (want.dutyMin !== undefined) expect(got.duty, `вывод ${pin}: доля`).toBeGreaterThanOrEqual(want.dutyMin);
      if (want.dutyMax !== undefined) expect(got.duty, `вывод ${pin}: доля`).toBeLessThanOrEqual(want.dutyMax);
    }
  }
  for (const [id, want] of Object.entries(expected.parts)) {
    const got = await simWith(page, id, (api, name) => api.part(name));
    expect(got, `деталь ${id}`).not.toBeNull();
    if (want.text !== undefined) expect(String.fromCharCode(...(got?.terminal ?? []))).toBe(want.text);
    if (want.bytes !== undefined) expect(got?.terminal).toEqual(want.bytes);
    if (want.colors !== undefined) expect(got?.colors).toEqual(want.colors);
    if (want.errors !== undefined) expect(got?.errors).toBe(want.errors);
    const wanted = (want.events ?? []).map((e) => (typeof e === "string" ? { event: e } : e));
    const seen = await simWith(page, id, (api, name) => api.partEvents(name));
    expect([...new Set(seen.map((e) => e.event))].sort()).toEqual([...new Set(wanted.map((e) => e.event))].sort());
    for (const item of wanted) {
      const fields = Object.entries(item.data ?? {});
      const found = seen.some((e) => e.event === item.event && fields.every(([k, v]) => matches(v, e.data[k])));
      expect(found, `событие ${item.event} с данными ${JSON.stringify(item.data)}`).toBe(true);
    }
  }
}

// A lesson from the example list is built and passes its expect.json. fpgasim.json is in the project
// if and only if it lies in the lesson folder: breadboard parts and button settings (decision 169).
export async function runLesson(page: Page, name: string): Promise<void> {
  await pickExample(page, name);
  await expect(page.getByTestId("project-name")).toHaveText(name);
  const paths = await sim(page, (api) => api.files().map((f) => f.path));
  expect(paths).toContain("top.v");
  const config = existsSync(new URL(`../../examples/lessons/${name}/fpgasim.json`, import.meta.url));
  expect(paths.includes("fpgasim.json"), "fpgasim.json в проекте").toBe(config);
  await page.getByTestId("build").click();
  const status = () => sim(page, (api) => api.state().build.status);
  await expect.poll(status, { timeout: 90_000 }).toMatch(/^(ok|failed|error)$/);
  expect(await status(), JSON.stringify(await sim(page, (api) => api.state().build))).toBe("ok");
  await expect.poll(() => sim(page, (api) => api.state().run)).toBe("paused");
  await checkExpect(page, readExpect(`examples/lessons/${name}`));
}
