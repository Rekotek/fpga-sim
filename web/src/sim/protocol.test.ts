// TypeScript encoding and parsing of binary messages are checked against the reference files
// spec/protocol/vectors/ (spec section 11.1): the C++ core produces the same bytes.
/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  KIND_FRAME,
  KIND_PART_DATA,
  KIND_TRACE,
  decodeHeader,
  decodeMessage,
  encodeFrame,
  encodePartData,
  encodeTrace,
  type Frame,
  type PartData,
  type Trace,
} from "./protocol";

interface Vector {
  file: string;
  kind: "FRAME" | "TRACE" | "PART_DATA";
  seq: number;
  timePs: string;
  frame?: {
    spanPs: string;
    cycle: number;
    realUs: number;
    ratio: number;
    nets: { level: number; flags: number; toggles: number; duty: number }[];
    watch: { sig: number; width: number; words: number[] }[];
    parts: { index: number; state: number[] }[];
  };
  trace?: {
    record: number;
    fromPs: string;
    toPs: string;
    changes: { timePs: string; index: number; words: number[] }[];
  };
  partData?: { part: number; channel: number; bytes: number[] };
}

const DIR = new URL("../../../spec/protocol/vectors/", import.meta.url);
const vectors = (JSON.parse(readFileSync(new URL("vectors.json", DIR), "utf8")) as { vectors: Vector[] }).vectors;
const fileBytes = (vector: Vector): Uint8Array => new Uint8Array(readFileSync(new URL(vector.file, DIR)));

function toFrame(v: NonNullable<Vector["frame"]>): Frame {
  return {
    spanPs: BigInt(v.spanPs),
    cycle: BigInt(v.cycle),
    realUs: v.realUs,
    ratio: v.ratio,
    nets: v.nets,
    watch: v.watch,
    parts: v.parts.map((p) => ({ index: p.index, state: Uint8Array.from(p.state) })),
  };
}

function toTrace(v: NonNullable<Vector["trace"]>): Trace {
  return {
    record: v.record,
    fromPs: BigInt(v.fromPs),
    toPs: BigInt(v.toPs),
    changes: v.changes.map((c) => ({ timePs: BigInt(c.timePs), index: c.index, words: c.words })),
  };
}

function toPartData(v: NonNullable<Vector["partData"]>): PartData {
  return { part: v.part, channel: v.channel, bytes: Uint8Array.from(v.bytes) };
}

describe("эталонные двоичные сообщения", () => {
  test("в наборе есть все три вида", () => {
    expect(new Set(vectors.map((v) => v.kind))).toEqual(new Set(["FRAME", "TRACE", "PART_DATA"]));
  });

  test.each(vectors.map((v) => [v.file, v] as const))("%s: кодирование даёт байты файла", (_file, vector) => {
    const time = BigInt(vector.timePs);
    let encoded: Uint8Array;
    if (vector.frame) encoded = encodeFrame(vector.seq, time, toFrame(vector.frame));
    else if (vector.trace) encoded = encodeTrace(vector.seq, time, toTrace(vector.trace));
    else if (vector.partData) encoded = encodePartData(vector.seq, time, toPartData(vector.partData));
    else throw new Error(`в описании ${vector.file} нет содержимого`);
    expect([...encoded]).toEqual([...fileBytes(vector)]);
  });

  test.each(vectors.map((v) => [v.file, v] as const))("%s: разбор файла даёт описание", (_file, vector) => {
    const bytes = fileBytes(vector);
    const message = decodeMessage(bytes);
    expect(message?.header).toEqual({
      protocol: 1,
      kind: { FRAME: KIND_FRAME, TRACE: KIND_TRACE, PART_DATA: KIND_PART_DATA }[vector.kind],
      seq: vector.seq,
      timePs: BigInt(vector.timePs),
      length: bytes.length - 24,
    });
    if (message?.kind === KIND_FRAME) expect(message.frame).toEqual(toFrame(vector.frame ?? never()));
    else if (message?.kind === KIND_TRACE) expect(message.trace).toEqual(toTrace(vector.trace ?? never()));
    else if (message?.kind === KIND_PART_DATA) expect(message.partData).toEqual(toPartData(vector.partData ?? never()));
    else throw new Error("сообщение не разобрано");
  });
});

function never(): never {
  throw new Error("вид сообщения не совпал с описанием");
}

describe("чужие и обрезанные байты", () => {
  const frame = fileBytes(vectors.find((v) => v.file === "frame.bin") ?? never());

  test("сообщение без метки не разбирается", () => {
    const bytes = frame.slice();
    bytes[0] = 0;
    expect(decodeHeader(bytes)).toBeNull();
    expect(decodeMessage(bytes)).toBeNull();
  });

  test("обрезанное сообщение не разбирается", () => {
    expect(decodeHeader(frame.slice(0, 23))).toBeNull();
    expect(decodeMessage(frame.slice(0, frame.length - 1))).toBeNull();
  });

  test("сообщение неизвестного вида пропускается", () => {
    const bytes = frame.slice();
    bytes[3] = 9;
    expect(decodeHeader(bytes)?.kind).toBe(9);
    expect(decodeMessage(bytes)).toBeNull();
  });
});
