import { describe, expect, it } from "vitest";
import { TERMINAL_LIMIT, Terminal, inputBytes, terminalHex, terminalText } from "./terminal";

describe("журнал терминала", () => {
  it("копит байты и растит номер версии", () => {
    const log = new Terminal();
    log.append(new Uint8Array([72, 105]));
    log.append(new Uint8Array([]));
    log.append(new Uint8Array([33]));
    expect([...log.bytes()]).toEqual([72, 105, 33]);
    expect(log.version).toBe(2);
    log.clear();
    expect(log.bytes().length).toBe(0);
    expect(log.version).toBe(3);
  });

  it("при переполнении оставляет последние байты", () => {
    const log = new Terminal();
    const block = new Uint8Array(1000);
    let total = 0;
    while (total <= TERMINAL_LIMIT) {
      block.fill(total / 1000);
      log.append(block);
      total += 1000;
    }
    expect(log.bytes().length).toBeLessThanOrEqual(TERMINAL_LIMIT);
    expect(log.bytes().length + log.dropped).toBe(total);
    // The last block is intact.
    expect(log.bytes().at(-1)).toBe((total / 1000 - 1) & 255);
    log.append(new Uint8Array(TERMINAL_LIMIT).fill(7));
    expect(log.bytes().length).toBe(TERMINAL_LIMIT / 2);
    expect(log.bytes().every((b) => b === 7)).toBe(true);
  });
});

describe("показ и ввод терминала", () => {
  it("текст: UTF-8, без возврата каретки, управляющие знаки точкой", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("Привет\r\nok\t!"), 0, 7]);
    expect(terminalText(bytes)).toBe("Привет\nok\t!··");
  });

  it("шестнадцатеричные коды по 16 в строке", () => {
    const bytes = Uint8Array.from({ length: 18 }, (_, i) => i * 15);
    expect(terminalHex(bytes)).toBe("00 0f 1e 2d 3c 4b 5a 69 78 87 96 a5 b4 c3 d2 e1\nf0 ff");
    expect(terminalHex(new Uint8Array())).toBe("");
  });

  it("строка ввода получает конец строки по настройке", () => {
    expect(inputBytes("Hi", "none")).toEqual([72, 105]);
    expect(inputBytes("Hi", "lf")).toEqual([72, 105, 10]);
    expect(inputBytes("Hi", "crlf")).toEqual([72, 105, 13, 10]);
    expect(inputBytes("я", "none")).toEqual([0xd1, 0x8f]);
  });
});
