import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The first sign-up (worker cold start + PBKDF2) can take several seconds on slow machines.
  test: { testTimeout: 30_000 },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { JWT_SECRET: "test-secret", GEMINI_API_KEY: "test-gemini-key" } },
    }),
  ],
});
