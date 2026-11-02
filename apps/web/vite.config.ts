import { sentryVitePlugin } from "@sentry/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Source maps are uploaded to Sentry (then deleted, so they're never served) only when
// SENTRY_AUTH_TOKEN, SENTRY_ORG and SENTRY_PROJECT are set in the build environment.
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  plugins: [
    react(),
    uploadSourceMaps &&
      sentryVitePlugin({
        org: process.env.SENTRY_ORG,
        project: process.env.SENTRY_PROJECT,
        authToken: process.env.SENTRY_AUTH_TOKEN,
        sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
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
