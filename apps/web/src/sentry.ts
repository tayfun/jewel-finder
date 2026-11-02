import * as Sentry from "@sentry/react";
import { useEffect } from "react";
import { createRoutesFromChildren, matchRoutes, useLocation, useNavigationType } from "react-router";

const dsn = import.meta.env.VITE_SENTRY_DSN;
const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT ?? import.meta.env.MODE;

// Imported first in main.tsx so errors during startup are caught too.
if (dsn) {
  Sentry.init({
    dsn,
    environment,
    integrations: [
      Sentry.reactRouterBrowserTracingIntegration({
        useEffect,
        useLocation,
        useNavigationType,
        createRoutesFromChildren,
        matchRoutes,
      }),
    ],
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
    // Same-origin /api calls carry trace headers, so browser and Worker spans join up.
    tracePropagationTargets: [/^\/api\//],
    // No request/response bodies or cookies; the account id is set in auth.tsx.
    dataCollection: { userInfo: false, cookies: false, httpBodies: [] },
  });
}

export { Sentry };
