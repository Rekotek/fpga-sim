// UART and WS2812 widgets: parsing state from a frame and the WS2812 LED layout.
import { describe, expect, it } from "vitest";
import { createWidget } from "./index";
import { uartCounters } from "./uart";
import { colorHex, ledLayout, ledState } from "./ws2812";

describe("UART", () => {
  it("счётчики читаются из блока детали в кадре", () => {
    const state = new Uint8Array(12);
    const v = new DataView(state.buffer);
    v.setUint32(0, 300, true);
    v.setUint32(4, 256, true);
    v.setUint32(8, 7, true);
    expect(uartCounters(state)).toEqual({ received: 300, sent: 256, queued: 7 });
    expect(uartCounters(undefined)).toEqual({ received: 0, sent: 0, queued: 0 });
    expect(uartCounters(new Uint8Array(3))).toEqual({ received: 0, sent: 0, queued: 0 });
  });

  it("у типов uart и ws2812 есть свои виджеты; щелчок по UART открывает терминал", () => {
    expect(createWidget("uart").plain).toBeUndefined();
    expect(createWidget("uart").tab).toBe("terminal");
    expect(createWidget("ws2812").plain).toBeUndefined();
    expect(createWidget("ws2812").tab).toBeUndefined();
    expect(createWidget("lcd").plain).toBe(true);
  });
});

describe("WS2812", () => {
  it("цвета и счётчик ошибок читаются из блока детали", () => {
    const state = new Uint8Array([2, 0, 0, 0, 46, 1, 0, 0, 255, 128, 0, 1, 2, 3]);
    const parsed = ledState(state);
    expect(parsed.errors).toBe(302);
    expect(parsed.colors.map(colorHex)).toEqual(["#ff8000", "#010203"]);
    expect(ledState(undefined)).toEqual({ colors: [], errors: 0 });
  });

  it("лента: ряд по центру, длинная лента переносится по 16", () => {
    const strip = ledLayout(8, "strip", 8);
    expect(strip.places).toHaveLength(8);
    expect(new Set(strip.places.map((p) => p.y)).size).toBe(1);
    expect(strip.places[0]?.x).toBeCloseTo(-(strip.places[7]?.x ?? 0));
    expect(strip.box.w).toBeLessThanOrEqual(8.2 + 1e-9);
    const long = ledLayout(40, "strip", 8);
    expect(new Set(long.places.map((p) => p.y.toFixed(3))).size).toBe(3);
    expect(long.box.w).toBeLessThanOrEqual(8.2 + 1e-9);
  });

  it("матрица: ширина из настройки; кольцо: первый светодиод сверху", () => {
    const matrix = ledLayout(12, "matrix", 4);
    expect(new Set(matrix.places.map((p) => p.x.toFixed(3))).size).toBe(4);
    expect(new Set(matrix.places.map((p) => p.y.toFixed(3))).size).toBe(3);
    const ring = ledLayout(12, "ring", 8);
    expect(ring.places[0]?.x).toBeCloseTo(0);
    expect(ring.places[0]?.y ?? 0).toBeLessThan(0);
    expect(ring.places[3]?.x ?? 0).toBeGreaterThan(0);
    const radii = ring.places.map((p) => Math.hypot(p.x, p.y));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1e-9);
    // 256 LEDs fit in a breadboard cell with any layout.
    for (const layout of ["strip", "ring", "matrix"]) {
      const made = ledLayout(256, layout, 16);
      expect(made.places).toHaveLength(256);
      expect(Math.max(made.box.w, made.box.h)).toBeLessThanOrEqual(8.2 + 1e-9);
    }
  });

  it("виджет отдаёт цвета и подсказку со значением цвета под указателем", () => {
    const widget = createWidget("ws2812");
    const config = {
      id: "ws",
      type: "ws2812",
      label: "WS",
      pins: { din: 79 },
      settings: { count: 2, layout: "strip" },
    };
    widget.layout(config, undefined);
    const state = new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 255]);
    const view = { config, nets: {}, state, running: true, nowMs: 0 };
    expect(widget.status?.(view)).toEqual({ colors: ["#ff0000", "#0000ff"], errors: 0 });
    const places = ledLayout(2, "strip", 8).places;
    const lines = widget.hint?.(view, places[1]) ?? [];
    expect(lines).toContainEqual({ key: "hint.ws2812.color", args: { index: 1, color: "#0000ff" } });
    expect((widget.hint?.(view, { x: 50, y: 50 }) ?? []).some((l) => l.key === "hint.ws2812.color")).toBe(false);
  });
});
