import { formatMoney, ITEM_STATUSES, type ItemStatus, type ItemWithListings, type Stats } from "@jf/shared";
import { Link, useSearchParams } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { ListingBadges, STATUS_LABELS, StatusBadge } from "../components/Badges";
import { useDebounced, useLoad } from "../hooks";
import { useState } from "react";

export function Inventory() {
  const { settings } = useAccount();
  const [params, setParams] = useSearchParams();
  const status = (params.get("status") ?? "in_stock") as ItemStatus | "all";
  const [q, setQ] = useState(params.get("q") ?? "");
  const query = useDebounced(q);

  const stats = useLoad(() => api<Stats>("/api/stats"), []);
  const items = useLoad(() => {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    if (status !== "all") sp.set("status", status);
    return api<{ items: ItemWithListings[] }>(`/api/items?${sp}`).then((r) => r.items);
  }, [query, status]);

  function setStatus(s: string) {
    const next = new URLSearchParams(params);
    next.set("status", s);
    setParams(next, { replace: true });
  }

  const s = stats.data;
  return (
    <>
      <div className="page-head">
        <h1>Inventory</h1>
        <div className="actions">
          <Link to="/import" className="button">
            ⬇ Import listings
          </Link>
          <Link to="/items/new" className="button primary">
            + Add item
          </Link>
        </div>
      </div>

      {s && (
        <div className="stats">
          <Stat label="In stock" value={String(s.byStatus.in_stock)} />
          <Stat label="Listed on Vinted" value={String(s.listed.vinted)} />
          <Stat label="Listed on eBay" value={String(s.listed.ebay)} />
          <Stat label="Stock value" value={formatMoney(s.stockValue, settings.currency)} />
          <Stat
            label="Potential profit"
            value={formatMoney(s.stockValue - s.stockCost, settings.currency)}
            hint="Price minus cost, in-stock items"
          />
          <Stat label="Sold" value={String(s.byStatus.sold)} />
        </div>
      )}

      {s && s.toEnd > 0 && (
        <p className="notice">
          <strong>
            {s.toEnd} listing{s.toEnd === 1 ? " is" : "s are"} still live
          </strong>{" "}
          for items you've sold. End {s.toEnd === 1 ? "it" : "them"} so nobody buys the same item twice:{" "}
          <button className="link" onClick={() => setStatus("sold")}>
            show sold items
          </button>
        </p>
      )}

      {s && s.stale > 0 && (
        <p className="notice">
          <strong>
            {s.stale} listing{s.stale === 1 ? " has" : "s have"} been up a while
          </strong>{" "}
          (over {settings.vintedRelistDays} days on Vinted or {settings.ebayRelistDays} on eBay). Relisting bumps{" "}
          {s.stale === 1 ? "it" : "them"} back to the top. <Link to="/relist">Relist</Link>
        </p>
      )}

      {s && s.duplicates > 0 && (
        <p className="notice">
          <strong>
            {s.duplicates} possible duplicate{s.duplicates === 1 ? "" : "s"}
          </strong>{" "}
          — items that look like the same thing entered twice, e.g. imported from both Vinted and eBay.{" "}
          <Link to="/duplicates">Review</Link>
        </p>
      )}

      <div className="toolbar">
        <input
          type="search"
          placeholder="Search title, brand, SKU, tags…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="tabs" role="tablist">
          {(["all", ...ITEM_STATUSES] as const).map((st) => (
            <button
              key={st}
              role="tab"
              aria-selected={status === st}
              className={status === st ? "active" : ""}
              onClick={() => setStatus(st)}
            >
              {st === "all" ? "All" : STATUS_LABELS[st]}
              {s && st !== "all" ? <span className="count">{s.byStatus[st]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {items.error && <p className="error">{items.error.message}</p>}
      {items.data && items.data.length === 0 && (
        <div className="empty card">
          {query || status !== "in_stock" ? (
            <p>No items match.</p>
          ) : (
            <>
              <p>Your inventory is empty.</p>
              <div className="actions" style={{ justifyContent: "center" }}>
                <Link to="/items/new" className="button primary">
                  Add your first item
                </Link>
                <Link to="/import" className="button">
                  Import from Vinted or eBay
                </Link>
              </div>
            </>
          )}
        </div>
      )}
      <div className={`item-grid ${items.loading ? "loading" : ""}`}>
        {items.data?.map((item) => (
          <Link key={item.id} to={`/items/${item.id}`} className="item-card">
            <div className="thumb">
              {item.images[0] ? <img src={`/images/${item.images[0]}`} alt="" loading="lazy" /> : <span>No photo</span>}
            </div>
            <div className="item-card-body">
              <div className="item-title">{item.title}</div>
              <div className="muted small">
                {[item.brand, item.size].filter(Boolean).join(" · ") || item.sku}
              </div>
              <div className="item-card-foot">
                <strong>{formatMoney(item.price, settings.currency)}</strong>
                {item.status !== "in_stock" && <StatusBadge status={item.status} />}
              </div>
              <ListingBadges listings={item.listings} itemStatus={item.status} settings={settings} />
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="stat" title={hint}>
      <div className="stat-value">{value}</div>
      <div className="muted small">{label}</div>
    </div>
  );
}
