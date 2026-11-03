import { Sentry } from "./sentry";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./auth";
import { RequireAuth } from "./components/Layout";
import { ErrorScreen, RouteError } from "./components/ErrorScreen";
import { Login, Signup } from "./pages/Auth";
import { Home } from "./pages/Home";
import { ItemDetail } from "./pages/ItemDetail";
import { EditItem, NewItem } from "./pages/ItemEditor";
import { Extension } from "./pages/Extension";
import { Privacy } from "./pages/Privacy";
import { Settings } from "./pages/Settings";
import "./styles.css";

// Navigation spans are named after route patterns (/items/:id) instead of raw URLs.
const createRouter = Sentry.wrapCreateBrowserRouter(createBrowserRouter);

const router = createRouter([
  {
    errorElement: <RouteError />,
    children: [
  { path: "/", element: <Home /> },
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <Signup /> },
  { path: "/privacy", element: <Privacy /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/items/new", element: <NewItem /> },
      { path: "/items/:id", element: <ItemDetail /> },
      { path: "/items/:id/edit", element: <EditItem /> },
      { path: "/settings", element: <Settings /> },
      { path: "/extension", element: <Extension /> },
    ],
  },
    ],
  },
]);

createRoot(document.getElementById("root")!, {
  onUncaughtError: Sentry.reactErrorHandler(),
  onCaughtError: Sentry.reactErrorHandler(),
  onRecoverableError: Sentry.reactErrorHandler(),
}).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorScreen />}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
