/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN for the web app. Unset = error reporting off. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
}
