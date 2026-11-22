// UART terminal log (spec section 6.3): bytes the part received from the FPGA (PART_DATA, channel 0).
// The log sits next to the frames, outside React state: the terminal tab reads it per screen frame.

export const TERMINAL_LIMIT = 256 * 1024; // bytes in the log; on overflow the second half stays

export class Terminal {
  private buffer = new Uint8Array(1024);
  private length = 0;
  version = 0; // grows on every log change
  dropped = 0; // bytes dropped from the start

  append(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    if (this.length + bytes.length > TERMINAL_LIMIT) {
      const keep = Math.max(0, Math.min(this.length, TERMINAL_LIMIT / 2 - bytes.length));
      this.buffer.copyWithin(0, this.length - keep, this.length);
      this.dropped += this.length - keep;
      this.length = keep;
      if (bytes.length > TERMINAL_LIMIT / 2) {
        this.dropped += bytes.length - TERMINAL_LIMIT / 2;
        bytes = bytes.subarray(bytes.length - TERMINAL_LIMIT / 2);
      }
    }
    if (this.length + bytes.length > this.buffer.length) {
      const next = new Uint8Array(
        Math.min(TERMINAL_LIMIT, Math.max(this.buffer.length * 2, this.length + bytes.length)),
      );
      next.set(this.buffer.subarray(0, this.length));
      this.buffer = next;
    }
    this.buffer.set(bytes, this.length);
    this.length += bytes.length;
    this.version += 1;
  }

  clear(): void {
    this.length = 0;
    this.dropped = 0;
    this.version += 1;
  }

  bytes(): Uint8Array {
    return this.buffer.subarray(0, this.length);
  }
}

// Text view: UTF-8; carriage return is skipped, other control characters become a dot.
export function terminalText(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "·");
}

// Hex view: 16 bytes per line.
export function terminalHex(bytes: Uint8Array): string {
  const lines: string[] = [];
  for (let at = 0; at < bytes.length; at += 16) {
    const row: string[] = [];
    for (const byte of bytes.subarray(at, at + 16)) row.push(byte.toString(16).padStart(2, "0"));
    lines.push(row.join(" "));
  }
  return lines.join("\n");
}

export type LineEnding = "none" | "lf" | "crlf";

// Input line bytes: UTF-8 and a line ending by the lineEnding part setting.
export function inputBytes(text: string, ending: LineEnding): number[] {
  const bytes = [...new TextEncoder().encode(text)];
  if (ending === "lf") bytes.push(10);
  if (ending === "crlf") bytes.push(13, 10);
  return bytes;
}
