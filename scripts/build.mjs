// Assembles the browser extension (extension/dist, load it unpacked) and copies the overlay
// into the Worker's static assets.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { icon } from "./icons.mjs";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "extension/dist");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
cpSync(path.join(root, "extension/src"), dist, { recursive: true, filter: (src) => !src.endsWith(".ts") });
await build({ entryPoints: [path.join(root, "extension/src/background.ts")], bundle: true, format: "esm", target: "chrome120", outfile: path.join(dist, "background.js"), logLevel: "silent" });
cpSync(path.join(root, "client"), dist, { recursive: true });
for (const s of [16, 48, 128]) writeFileSync(path.join(dist, `icon${s}.png`), icon(s));

mkdirSync(path.join(root, "worker/public"), { recursive: true });
cpSync(path.join(root, "client"), path.join(root, "worker/public"), { recursive: true });
console.log("extension/dist and worker/public are ready");
