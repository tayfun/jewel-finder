import { ITEM_STATUSES, type AdminOverview, type AdminUser } from "@jf/shared";
import { useMemo, useState } from "react";
import { Navigate } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { STATUS_LABELS } from "../components/Badges";
import { useLoad } from "../hooks";

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function ago(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "yesterday";
  if (days < 60) return `${days} days ago`;
  return fmtDate(ms);
}

const itemCount = (u: AdminUser) => ITEM_STATUSES.reduce((n, s) => n + (u.byStatus[s] ?? 0), 0);

export function Admin() {
  const account = useAccount();
  const overview = useLoad(() => api<AdminOverview>("/api/admin/overview"), []);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const users = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = overview.data?.users ?? [];
    return needle ? all.filter((u) => u.email.includes(needle)) : all;
  }, [overview.data, q]);

  if (!account.isAdmin) return <Navigate to="/" replace />;

  async function setAdmin(user: AdminUser, isAdmin: boolean) {
    if (!isAdmin && !confirm(`Remove admin access for ${user.email}?`)) return;
    setBusy(user.id);
    setError(null);
    try {
      await api(`/api/admin/users/${user.id}/admin`, { method: "PUT", json: { isAdmin } });
      overview.setData((d) => d && { ...d, users: d.users.map((u) => (u.id === user.id ? { ...u, isAdmin } : u)) });
      void overview.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const t = overview.data?.totals;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Admin</h1>
          <p className="muted small">Everyone on Stock & List. Counts update whenever a user changes something or opens the app.</p>
        </div>
      </div>

      {overview.error && <p className="error">{overview.error.message}</p>}
      {t && (
        <>
          <div className="stats">
            <Stat label="Users" value={t.users} />
            <Stat label="New this week" value={t.signups7d} hint={`${t.signups30d} in the last 30 days`} />
            <Stat label="Active this week" value={t.active7d} hint={`${t.active30d} in the last 30 days`} />
            <Stat label="Items" value={t.items} />
            <Stat label="Live on Vinted" value={t.listed.vinted} />
            <Stat label="Live on eBay" value={t.listed.ebay} />
          </div>
          <div className="stats">
            {ITEM_STATUSES.map((s) => (
              <Stat key={s} label={STATUS_LABELS[s]} value={t.byStatus[s]} />
            ))}
            <Stat label="Admins" value={t.admins} />
          </div>
        </>
      )}

      <div className="card">
        <div className="toolbar">
          <input type="search" placeholder="Search by email" value={q} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">
            {overview.data ? `${users.length} of ${overview.data.users.length} users` : "Loading…"}
          </span>
        </div>
        {error && <p className="error">{error}</p>}
        <div className="table-wrap">
          <table className="relist-table admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Joined</th>
                <th>Last active</th>
                <th className="num">Items</th>
                <th className="num">In stock</th>
                <th className="num">Sold</th>
                <th className="num">Live listings</th>
                <th>Admin</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    {u.email}
                    {u.id === account.id && <span className="muted small"> (you)</span>}
                  </td>
                  <td className="num">{fmtDate(u.createdAt)}</td>
                  <td className="num" title={new Date(u.lastSeenAt).toLocaleString()}>
                    {ago(u.lastSeenAt)}
                  </td>
                  <td className="num">{itemCount(u)}</td>
                  <td className="num">{u.byStatus.in_stock ?? 0}</td>
                  <td className="num">{u.byStatus.sold ?? 0}</td>
                  <td className="num">{(u.listed.vinted ?? 0) + (u.listed.ebay ?? 0)}</td>
                  <td>
                    {u.isOwner ? (
                      <span className="badge" title="Listed in the ADMIN_EMAILS secret">
                        Owner
                      </span>
                    ) : u.isAdmin ? (
                      <button
                        className="small"
                        disabled={busy === u.id || u.id === account.id}
                        title={u.id === account.id ? "Ask another admin to remove you" : undefined}
                        onClick={() => setAdmin(u, false)}
                      >
                        Remove admin
                      </button>
                    ) : (
                      <button className="small" disabled={busy === u.id} onClick={() => setAdmin(u, true)}>
                        Make admin
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value.toLocaleString()}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
