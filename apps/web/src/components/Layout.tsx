import { NavLink, Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../auth";

export function RequireAuth() {
  const { account, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!account) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Layout />;
}

function Layout() {
  const { account } = useAuth();
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
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <span className="muted small hide-sm">{account?.email}</span>
      </header>
      <main className="container">
        <Outlet />
      </main>
    </div>
  );
}
