import {
  configure,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip-js/zip-js";

configure({ useWebWorkers: false });

export type UnzippedFile = {
  readonly path: string;
  readonly bytes: Uint8Array;
};

export async function unzip(zip: Uint8Array): Promise<readonly UnzippedFile[]> {
  const reader = new ZipReader(new Uint8ArrayReader(zip));
  try {
    const files: UnzippedFile[] = [];
    for (const entry of await reader.getEntries()) {
      if (entry.directory) {
        continue;
      }
      files.push({
        path: entry.filename,
        bytes: await entry.getData!(new Uint8ArrayWriter()),
      });
    }
    return files;
  } finally {
    await reader.close();
  }
}
