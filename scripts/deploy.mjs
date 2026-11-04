// Production deploy: web app (+ extension zip) → Worker, with source maps uploaded to Sentry when configured.
//
//   pnpm run deploy
//   pnpm run deploy -- --dry-run   # build and inject only; nothing is uploaded or deployed
//
// Sentry settings come from the environment or a git-ignored `.env.sentry` file
// (see `.env.sentry.example`). Without SENTRY_AUTH_TOKEN the deploy still runs,
// just without source maps.
import { execSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
if (existsSync(resolve(root, ".env.sentry"))) process.loadEnvFile(resolve(root, ".env.sentry"));

const env = process.env;
const dryRun = process.argv.includes("--dry-run");
if (dryRun) env.SENTRY_DRY_RUN = "1"; // read by apps/web/vite.config.ts
const sentry = Boolean(env.SENTRY_AUTH_TOKEN);
const run = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit", env });

if (sentry && (!env.SENTRY_ORG || !env.SENTRY_API_PROJECT || !env.SENTRY_WEB_PROJECT)) {
  throw new Error("Set SENTRY_ORG, SENTRY_API_PROJECT and SENTRY_WEB_PROJECT alongside SENTRY_AUTH_TOKEN.");
}
if (!sentry) console.warn("⚠ SENTRY_AUTH_TOKEN not set: deploying without uploading source maps to Sentry.\n");
if (!env.VITE_SENTRY_DSN) console.warn("⚠ VITE_SENTRY_DSN not set: the web app won't report errors.\n");

// 1. Web app. Its Vite config uploads (then deletes) source maps when SENTRY_AUTH_TOKEN is set.
run("pnpm --filter @jf/web build");

// 1b. Extension: the zipped production build, offered on /extension for manual installs
//     until it's in the Chrome Web Store (and the same file you upload there).
run("pnpm --filter @jf/extension release");
const ext = resolve(root, "apps/extension");
const { version } = JSON.parse(readFileSync(resolve(ext, "dist-prod/manifest.json"), "utf8"));
copyFileSync(resolve(ext, `release/stock-and-list-${version}.zip`), resolve(root, "apps/web/dist/stock-and-list-extension.zip"));

// 2. Worker: bundle once, stamp the bundle and its map with matching debug IDs, upload the map,
//    then deploy that exact bundle so the IDs Sentry knows are the ones running.
const api = resolve(root, "apps/api");
run("pnpm exec wrangler deploy --dry-run --outdir dist", api);
if (sentry) {
  const target = `--org ${env.SENTRY_ORG} --project ${env.SENTRY_API_PROJECT}`;
  run("pnpm exec sentry-cli sourcemaps inject dist", api);
  if (dryRun) console.log(`(dry run) would upload dist/*.map to ${env.SENTRY_ORG}/${env.SENTRY_API_PROJECT}`);
  else run(`pnpm exec sentry-cli sourcemaps upload ${target} dist`, api);
}
run(`pnpm exec wrangler deploy dist/index.js --no-bundle${dryRun ? " --dry-run" : ""}`, api);
