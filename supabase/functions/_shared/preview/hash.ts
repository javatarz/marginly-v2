import type { UnzippedFile } from "./unzip.ts";

const encoder = new TextEncoder();

/**
 * SHA-256 over the unzipped files in sorted path order, per ADR-0005, with `.css`
 * excluded by extension per ADR-0012. The framing — each file as its UTF-8 path, a
 * NUL, its byte length as eight big-endian bytes, then its bytes — is what makes the
 * digest unambiguous rather than a plain concatenation that two different file sets
 * could both produce. Changing it invalidates every stored Version hash.
 */
export async function hashFiles(
  files: readonly UnzippedFile[],
): Promise<string> {
  const framed = files
    .filter((file) => !isStylesheet(file.path))
    .toSorted((left, right) =>
      Number(left.path > right.path) - Number(left.path < right.path)
    )
    .flatMap((file) => [
      encoder.encode(file.path),
      new Uint8Array([0]),
      lengthPrefix(file.bytes.length),
      file.bytes,
    ]);

  const digest = await crypto.subtle.digest("SHA-256", concat(framed));

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function isStylesheet(path: string): boolean {
  return path.toLowerCase().endsWith(".css");
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const joined = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

function lengthPrefix(length: number): Uint8Array {
  const prefix = new Uint8Array(8);
  new DataView(prefix.buffer).setBigUint64(0, BigInt(length));
  return prefix;
}
