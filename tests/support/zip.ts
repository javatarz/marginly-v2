import { crc32 } from "node:zlib";

/**
 * A minimal, dependency-free ZIP writer for tests — stored (uncompressed) entries
 * only, which is all a fixture needs and keeps this file self-contained rather than
 * adding a zip library to the Next.js side for one integration test.
 */
export type ZipEntry = {
  readonly path: string;
  readonly content: string | Uint8Array;
};

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

export function buildZip(entries: readonly ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const data = typeof entry.content === "string"
      ? encoder.encode(entry.content)
      : entry.content;
    const crc = crc32(data) >>> 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, LOCAL_FILE_SIGNATURE, true);
    local.setUint16(4, 20, true); // version needed to extract
    local.setUint16(6, 0, true); // general purpose flag
    local.setUint16(8, 0, true); // compression method: stored
    local.setUint16(10, 0, true); // mod time
    local.setUint16(12, 0, true); // mod date
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true); // compressed size
    local.setUint32(22, data.length, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra field length

    localParts.push(new Uint8Array(local.buffer), nameBytes, data);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, CENTRAL_DIRECTORY_SIGNATURE, true);
    central.setUint16(4, 20, true); // version made by
    central.setUint16(6, 20, true); // version needed to extract
    central.setUint16(8, 0, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, 0, true);
    central.setUint16(14, 0, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, nameBytes.length, true);
    central.setUint16(30, 0, true); // extra field length
    central.setUint16(32, 0, true); // comment length
    central.setUint16(34, 0, true); // disk number start
    central.setUint16(36, 0, true); // internal attributes
    central.setUint32(38, 0, true); // external attributes
    central.setUint32(42, offset, true); // relative offset of local header

    centralParts.push(new Uint8Array(central.buffer), nameBytes);

    offset += local.byteLength + nameBytes.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((sum, part) => sum + part.length, 0);

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, END_OF_CENTRAL_DIRECTORY_SIGNATURE, true);
  end.setUint16(4, 0, true);
  end.setUint16(6, 0, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralDirectorySize, true);
  end.setUint32(16, centralDirectoryOffset, true);
  end.setUint16(20, 0, true);

  return concat([...localParts, ...centralParts, new Uint8Array(end.buffer)]);
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
