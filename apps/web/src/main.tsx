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
import { Duplicates } from "./pages/Duplicates";
import { Import } from "./pages/Import";
import { ListByHand } from "./pages/ListByHand";
import { Relist } from "./pages/Relist";
import { Privacy } from "./pages/Privacy";
import { About } from "./pages/About";
import { CursorGlow } from "./components/CursorGlow";
import { Settings } from "./pages/Settings";
import { Admin } from "./pages/Admin";
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
  { path: "/about", element: <About /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/items/new", element: <NewItem /> },
      { path: "/items/:id", element: <ItemDetail /> },
      { path: "/items/:id/edit", element: <EditItem /> },
      { path: "/items/:id/list/:marketplace", element: <ListByHand /> },
      { path: "/settings", element: <Settings /> },
      { path: "/extension", element: <Extension /> },
      { path: "/import", element: <Import /> },
      { path: "/duplicates", element: <Duplicates /> },
      { path: "/relist", element: <Relist /> },
      { path: "/admin", element: <Admin /> },
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
        <CursorGlow />
      </AuthProvider>
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
