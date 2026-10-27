// Builds the extension and zips it for the Chrome Web Store as commentlayer-<version>.zip.
// The store copy drops dev-only host matches (localhost) from the manifest.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
execFileSync("node", [path.join(root, "scripts/build.mjs")], { stdio: "inherit" });

const stage = mkdtempSync(path.join(tmpdir(), "commentlayer-"));
cpSync(path.join(root, "extension/dist"), stage, { recursive: true });
const manifestPath = path.join(stage, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
for (const cs of manifest.content_scripts) cs.matches = cs.matches.filter((m) => !m.includes("localhost"));
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const out = path.join(root, `commentlayer-${manifest.version}.zip`);
rmSync(out, { force: true });
execFileSync("zip", ["-qr", out, "."], { cwd: stage });
rmSync(stage, { recursive: true, force: true });
console.log(`wrote ${path.relative(root, out)}`);
