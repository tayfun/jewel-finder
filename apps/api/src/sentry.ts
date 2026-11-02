import type { CloudflareOptions } from "@sentry/cloudflare";

/**
 * Shared Sentry options for the Worker and the Durable Object.
 * With no SENTRY_DSN (local dev, tests) the SDK stays initialised but sends nothing.
 */
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN || undefined,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_ENVIRONMENT === "production" ? 0.1 : 1.0,
    // Keep personal data out: no request/response bodies (login passwords, listings), cookies,
    // auto-detected user info, SQL values or Gemini prompts. We attach only the account id.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpBodies: [],
      databaseQueryData: false,
      genAI: { inputs: false, outputs: false },
    },
  };
}
