import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./auth";
import { RequireAuth } from "./components/Layout";
import { Login, Signup } from "./pages/Auth";
import { Home } from "./pages/Home";
import { ItemDetail } from "./pages/ItemDetail";
import { EditItem, NewItem } from "./pages/ItemEditor";
import { Settings } from "./pages/Settings";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <Home /> },
  { path: "/login", element: <Login /> },
  { path: "/signup", element: <Signup /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/items/new", element: <NewItem /> },
      { path: "/items/:id", element: <ItemDetail /> },
      { path: "/items/:id/edit", element: <EditItem /> },
      { path: "/settings", element: <Settings /> },
    ],
  },
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
);
