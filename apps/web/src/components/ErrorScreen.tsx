import { useEffect } from "react";
import { isRouteErrorResponse, Link, useRouteError } from "react-router";
import { Sentry } from "../sentry";

/** Shown when something crashes. Errors are reported to Sentry by the caller. */
export function ErrorScreen({ title = "Something went wrong", detail }: { title?: string; detail?: string }) {
  return (
    <div className="error-screen">
      <div className="card">
        <h1>{title}</h1>
        <p className="muted">{detail ?? "We've been notified and will look into it. Reloading the page usually helps."}</p>
        <div className="actions">
          <button className="primary" onClick={() => window.location.reload()}>
            Reload
          </button>
          <a href="/" className="button">
            Go to inventory
          </a>
        </div>
      </div>
    </div>
  );
}

/** React Router's errorElement: it swallows route errors, so report them here. */
export function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  useEffect(() => {
    if (!notFound) Sentry.captureException(error);
  }, [error, notFound]);
  if (notFound) {
    return (
      <div className="error-screen">
        <div className="card">
          <h1>Page not found</h1>
          <p className="muted">That page doesn't exist.</p>
          <Link to="/" className="button primary">
            Go to inventory
          </Link>
        </div>
      </div>
    );
  }
  return <ErrorScreen />;
}
