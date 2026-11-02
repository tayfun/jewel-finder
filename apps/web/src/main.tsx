import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { AuthProvider } from "./auth";
import { RequireAuth } from "./components/Layout";
import { Inventory } from "./pages/Inventory";
import { ItemDetail } from "./pages/ItemDetail";
import { EditItem, NewItem } from "./pages/ItemEditor";
import { Login } from "./pages/Login";
import { Settings } from "./pages/Settings";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    element: <RequireAuth />,
    children: [
      { path: "/", element: <Inventory /> },
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
