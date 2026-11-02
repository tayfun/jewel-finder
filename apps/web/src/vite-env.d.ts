/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Sentry DSN for the web app. Unset = error reporting off. */
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_SENTRY_ENVIRONMENT?: string;
  /** Chrome Web Store URL of the extension. Unset = offer the zip for a manual install. */
  readonly VITE_EXTENSION_URL?: string;
}
