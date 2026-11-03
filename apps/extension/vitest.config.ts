import { defineConfig } from "vitest/config";

export default defineConfig({
  // Set by esbuild at build time (build.mjs).
  define: { __API_URL__: JSON.stringify("http://localhost:8787") },
  test: { environment: "happy-dom" },
});
