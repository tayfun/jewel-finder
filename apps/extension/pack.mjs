// Zips the production build (dist-prod/) for the Chrome Web Store, and for manual installs:
//
//   node pack.mjs   → release/stock-and-list-<version>.zip
//
// Run `node build.mjs --prod` first (`pnpm release:ext` does both).
import { zipSync } from "fflate";
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const dir = "dist-prod";
const files = {};
const walk = (d) => {
  for (const name of readdirSync(d)) {
    const path = join(d, name);
    if (statSync(path).isDirectory()) walk(path);
    else files[relative(dir, path)] = readFileSync(path);
  }
};
walk(dir);
if (!files["manifest.json"]) throw new Error(`${dir}/manifest.json missing: run node build.mjs --prod first`);

const { version } = JSON.parse(files["manifest.json"].toString());
mkdirSync("release", { recursive: true });
const out = `release/stock-and-list-${version}.zip`;
writeFileSync(out, zipSync(files, { level: 9 }));
console.log(`Packed ${out} (${Object.keys(files).length} files)`);
