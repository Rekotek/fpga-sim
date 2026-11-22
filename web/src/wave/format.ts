// Writing a signal value in the chosen radix (spec section 2.2: bin, hex, dec, sdec).
export type Radix = "bin" | "hex" | "dec" | "sdec";

export const RADIXES: readonly Radix[] = ["bin", "hex", "dec", "sdec"];

export const isRadix = (value: unknown): value is Radix => RADIXES.includes(value as Radix);

// A value from 32-bit words, least significant word first.
export function wordsToBigInt(words: ArrayLike<number>, offset = 0, count = words.length - offset): bigint {
  let value = 0n;
  for (let k = count - 1; k >= 0; k -= 1) value = (value << 32n) | BigInt((words[offset + k] ?? 0) >>> 0);
  return value;
}

// Binary and hexadecimal output is padded with zeros to the width; signed decimal
// reads the value as two's complement. A one-bit signal is 0 or 1 in every radix.
export function formatValue(value: bigint, width: number, radix: Radix): string {
  if (width <= 1) return value === 0n ? "0" : "1";
  if (radix === "bin") return value.toString(2).padStart(width, "0");
  if (radix === "hex")
    return value
      .toString(16)
      .toUpperCase()
      .padStart(Math.ceil(width / 4), "0");
  if (radix === "sdec" && (value >> BigInt(width - 1)) & 1n) return (value - (1n << BigInt(width))).toString();
  return value.toString();
}
