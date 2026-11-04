import type { ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth";
import { useExtensionReloaded } from "../extension";
import { ThemeToggle } from "./ThemeToggle";

export function RequireAuth() {
  const { account, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

/** The signed-in app chrome. Renders `children` when given, otherwise the matched child route. */
export function Layout({ children }: { children?: ReactNode }) {
  const { account } = useAuth();
  const extensionReloaded = useExtensionReloaded();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          <img src="/favicon.svg" alt="" width={22} height={22} />
          Jewel Finder
        </NavLink>
        <nav>
          <NavLink to="/" end>
            Inventory
          </NavLink>
          <NavLink to="/items/new">Add item</NavLink>
          <NavLink to="/import">Import</NavLink>
          <NavLink to="/relist">Relist</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {account?.isAdmin && <NavLink to="/admin">Admin</NavLink>}
        </nav>
        <div className="topbar-end">
          <span className="muted small hide-sm">{account?.email}</span>
          <ThemeToggle />
        </div>
      </header>
      <main className="container">
        {extensionReloaded && (
          <p className="notice">
            The Jewel Finder extension was updated. Reload this page so it can talk to the new version.{" "}
            <button className="link" onClick={() => location.reload()}>
              Reload
            </button>
          </p>
        )}
        {children ?? <Outlet />}
      </main>
    </div>
  );
}
