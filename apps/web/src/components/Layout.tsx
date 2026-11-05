import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth";
import { useExtensionReloaded } from "../extension";
import { ThemeToggle } from "./ThemeToggle";
import { Loader } from "./Loader";
import { Logo } from "./Brand";

export function RequireAuth() {
  const { account, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loader full label="Loading Stock & List…" />;
  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

/** The signed-in app chrome. Renders `children` when given, otherwise the matched child route. */
export function Layout({ children }: { children?: ReactNode }) {
  const { account } = useAuth();
  const extensionReloaded = useExtensionReloaded();
  const { pathname } = useLocation();
  // Phones: the links live behind a menu button instead of a sideways-scrolling row.
  const [menuOpen, setMenuOpen] = useState(false);
  const header = useRef<HTMLElement>(null);
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!header.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, [menuOpen]);

  return (
    <div className="app">
      <header className={`topbar${menuOpen ? " menu-open" : ""}`} ref={header}>
        <NavLink to="/" className="brand">
          <Logo size={34} />
        </NavLink>
        <nav id="app-nav" onClick={(e) => (e.target as HTMLElement).closest("a") && setMenuOpen(false)}>
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
          <button
            className="icon-button menu-button"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="app-nav"
            onClick={() => setMenuOpen((o) => !o)}
          >
            {menuOpen ? "✕" : "☰"}
          </button>
        </div>
      </header>
      <main className="container">
        {extensionReloaded && (
          <p className="notice">
            The Stock & List extension was updated. Reload this page so it can talk to the new version.{" "}
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
