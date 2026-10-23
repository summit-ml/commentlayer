import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Persistence, StoreData } from "./core";

export * from "./core";

/** Absolute path to the overlay's static files, for whatever serves them. */
export const CLIENT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client");

/** Keeps `comments.json` and `versions.json` in a directory. Writes are atomic. */
export function filePersistence(dataDir: string): Persistence {
  const FILE = path.join(dataDir, "comments.json");
  const VFILE = path.join(dataDir, "versions.json");
  const read = <T>(file: string, fallback: T): T => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return fallback;
    }
  };
  const writeJson = (file: string, data: unknown) =>
    fs.promises.writeFile(`${file}.tmp`, JSON.stringify(data, null, 2)).then(() => fs.promises.rename(`${file}.tmp`, file));
  return {
    async load() {
      fs.mkdirSync(dataDir, { recursive: true });
      return { comments: read(FILE, []), versions: read(VFILE, []) } satisfies StoreData;
    },
    async save(data) {
      await Promise.all([writeJson(FILE, data.comments), writeJson(VFILE, data.versions)]);
    },
  };
}
