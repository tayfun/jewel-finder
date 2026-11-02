import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Source maps are uploaded to Sentry (then deleted, so they're never served) only when
// SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_WEB_PROJECT are set (scripts/deploy.mjs loads .env.sentry).
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);
// `pnpm run deploy -- --dry-run` builds with debug IDs but talks to Sentry not at all.
const dryRun = process.env.SENTRY_DRY_RUN === "1";

export default defineConfig({
  plugins: [
    react(),
    uploadSourceMaps &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_WEB_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        telemetry: false,
        release: dryRun ? { create: false, finalize: false, setCommits: false, deploy: false } : undefined,
        sourcemaps: {
          disable: dryRun ? "disable-upload" : false,
          filesToDeleteAfterUpload: ["./dist/**/*.map"],
        },
      }),
  ],
  build: { sourcemap: uploadSourceMaps ? "hidden" : false },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8787",
      "/images": "http://localhost:8787",
    },
  },
});
