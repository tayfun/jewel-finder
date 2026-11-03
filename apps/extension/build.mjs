// Builds the extension. Content scripts must be classic scripts (IIFE);
// the background service worker is an ES module.
//
//   node build.mjs          → dist/       "Jewel Finder (dev)", talks to http://localhost:8787
//   node build.mjs --prod   → dist-prod/  "Jewel Finder", talks to the deployed Worker
//   API_URL=https://… node build.mjs      → dist-prod/ for any other deployment
//
// The two builds match different hosts, so both can be loaded in Chrome side by side.
import * as esbuild from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");
const PROD_API_URL = "https://jewel-finder.tayfun-sen.workers.dev";
const API_URL = (process.env.API_URL ?? (process.argv.includes("--prod") ? PROD_API_URL : "http://localhost:8787")).replace(/\/$/, "");
const apiOrigin = new URL(API_URL);
const dev = ["localhost", "127.0.0.1"].includes(apiOrigin.hostname);
const outdir = dev ? "dist" : "dist-prod";
// Chrome match patterns ignore ports, so this also covers the Vite dev server on :5173.
const appPattern = `${apiOrigin.protocol}//${apiOrigin.hostname}/*`;

const VINTED = ["co.uk", "fr", "de", "es", "it", "nl", "be", "at", "pl", "lt", "cz", "sk", "hu", "ro", "pt", "lu", "ie", "se", "dk", "fi", "gr", "hr", "com"];
const EBAY = ["co.uk", "com", "de", "fr", "it", "es", "ie", "at", "nl", "be", "ch", "pl", "com.au", "ca"];
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

const manifest = {
  manifest_version: 3,
  name: dev ? "Jewel Finder (dev)" : "Jewel Finder",
  description: "List your Jewel Finder inventory on Vinted and eBay, and import the listings you already have.",
  version: pkg.version ?? "0.1.0",
  minimum_chrome_version: "116",
  icons: { 16: "icons/16.png", 48: "icons/48.png", 128: "icons/128.png" },
  action: { default_title: "Jewel Finder" },
  side_panel: { default_path: "sidepanel.html" },
  background: { service_worker: "background.js", type: "module" },
  permissions: ["storage", "sidePanel"],
  // The Worker (your inventory); for imports, Vinted's and eBay's photo CDNs and eBay's description frames.
  host_permissions: [`${API_URL}/*`, "https://*.vinted.net/*", "https://i.ebayimg.com/*", "https://*.ebaydesc.com/*"],
  content_scripts: [
    { matches: VINTED.map((tld) => `https://www.vinted.${tld}/*`), js: ["vinted.js"], run_at: "document_idle" },
    { matches: EBAY.map((tld) => `https://www.ebay.${tld}/*`), js: ["ebay.js"], run_at: "document_idle", all_frames: false },
    { matches: [appPattern], js: ["bridge.js"], run_at: "document_start" },
  ],
};

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
writeFileSync(`${outdir}/manifest.json`, JSON.stringify(manifest, null, 2));
cpSync("src/sidepanel/sidepanel.html", `${outdir}/sidepanel.html`);
cpSync("src/sidepanel/sidepanel.css", `${outdir}/sidepanel.css`);
cpSync("icons", `${outdir}/icons`, { recursive: true });

const common = {
  bundle: true,
  target: "chrome116",
  define: { __API_URL__: JSON.stringify(API_URL) },
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  logLevel: "info",
};

const builds = [
  { ...common, entryPoints: { background: "src/background.ts" }, format: "esm", outdir },
  {
    ...common,
    entryPoints: {
      vinted: "src/content/vinted.ts",
      ebay: "src/content/ebay.ts",
      bridge: "src/content/bridge.ts",
      sidepanel: "src/sidepanel/sidepanel.ts",
    },
    format: "iife",
    outdir,
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
  console.log(`Watching ${outdir}/ (API_URL=${API_URL})`);
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log(`Built ${outdir}/ for API_URL=${API_URL}`);
}
