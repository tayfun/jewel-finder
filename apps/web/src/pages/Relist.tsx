import {
  MARKETPLACE_LABELS,
  formatMoney,
  isStale,
  listingAgeDays,
  mergeChangedItems,
  relistAfterDays,
  type ItemWithListings,
  type Listing,
} from "@jf/shared";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { api, fetchItems } from "../api";
import { useAccount } from "../auth";
import { relistViaExtension, useExtension, useItemChanges } from "../extension";
import { useLoad } from "../hooks";

/** Each relist opens a tab with a form to check and publish, so don't open dozens at once. */
const MAX_AT_ONCE = 10;

interface Row {
  key: string;
  item: ItemWithListings;
  listing: Listing;
  age: number | null;
  stale: boolean;
}

/** Live listings that have been up a while, to relist (bump) one by one or in bulk. */
export function Relist() {
  const { settings } = useAccount();
  const extension = useExtension();
  const items = useLoad(() => api<{ items: ItemWithListings[] }>("/api/items?status=in_stock").then((r) => r.items), []);
  useItemChanges(async (ids) => {
    const changed = await fetchItems(ids);
    items.setData((list) => list && mergeChangedItems(list, changed, (i) => i.status === "in_stock"));
  });
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const item of items.data ?? []) {
      for (const listing of item.listings) {
        if (listing.status !== "listed") continue;
        const stale = isStale(item, listing, settings);
        if (!stale && !showAll) continue;
        out.push({ key: `${item.id}:${listing.marketplace}`, item, listing, age: listingAgeDays(listing), stale });
      }
    }
    return out.sort((a, b) => (b.age ?? -1) - (a.age ?? -1));
  }, [items.data, settings, showAll]);

  const canRelist = (r: Row) => Boolean(r.listing.url && r.item.images.length);
  const selectable = rows.filter(canRelist);
  const picked = selectable.filter((r) => selected.has(r.key));
  const allOn = selectable.length > 0 && picked.length === selectable.length;

  function toggle(key: string, on: boolean) {
    const next = new Set(selected);
    if (on) next.add(key);
    else next.delete(key);
    setSelected(next);
  }

  async function relist(list: Row[]) {
    setBusy(true);
    setErrors([]);
    let n = 0;
    const failed: string[] = [];
    for (const r of list.slice(0, MAX_AT_ONCE)) {
      try {
        await relistViaExtension(r.item.id, r.listing.marketplace);
        n++;
        setSelected((s) => {
          const next = new Set(s);
          next.delete(r.key);
          return next;
        });
      } catch (e) {
        failed.push(`${r.item.title} (${MARKETPLACE_LABELS[r.listing.marketplace]}): ${(e as Error).message}`);
      }
    }
    setOpened(n);
    setErrors(failed);
    setBusy(false);
  }

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/" className="muted small">
            ← Inventory
          </Link>
          <h1>Relist & bump</h1>
        </div>
        <div className="actions">
          <button className="primary" disabled={!picked.length || busy || !extension} onClick={() => void relist(picked)}>
            {busy ? "Opening…" : picked.length ? `Relist ${picked.length} selected` : "Relist selected"}
          </button>
        </div>
      </div>
      <p className="muted">
        Listings sink in search as they get older. Relisting puts the item up again as a new listing, filled in from your
        inventory, and then removes the old one, so it shows up as new. Flagged after {relistAfterDays("vinted", settings)} days
        on Vinted and {relistAfterDays("ebay", settings)} on eBay (<Link to="/settings">change</Link>).
      </p>
      {extension === false && (
        <p className="notice">
          Relisting uses the Jewel Finder Chrome extension. <Link to="/extension">Install it</Link>, then come back here.
        </p>
      )}
      {opened > 0 && (
        <p className="notice">
          Opened {opened} tab{opened === 1 ? "" : "s"}. In each, check the form and publish; Jewel Finder then opens the old
          listing so you can remove it.
          {picked.length > 0 && ` ${picked.length} more selected: press Relist again when you're ready.`}
        </p>
      )}
      {errors.map((e) => (
        <p key={e} className="error">
          {e}
        </p>
      ))}
      {items.error && <p className="error">{items.error.message}</p>}

      <section className="card">
        <div className="toolbar">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={allOn}
              disabled={!selectable.length || busy}
              onChange={(e) => setSelected(e.target.checked ? new Set(selectable.map((r) => r.key)) : new Set())}
            />{" "}
            Select all ({selectable.length})
          </label>
          <label className="checkbox-row">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show all live listings
          </label>
          {picked.length > MAX_AT_ONCE && (
            <span className="muted small">Opens {MAX_AT_ONCE} at a time.</span>
          )}
        </div>
        {items.data && !rows.length ? (
          <p className="muted">{showAll ? "Nothing is live right now." : "Nothing needs relisting. Everything live is still fresh."}</p>
        ) : (
          <div className="table-wrap">
            <table className="relist-table">
              <thead>
                <tr>
                  <th />
                  <th />
                  <th>Item</th>
                  <th>Site</th>
                  <th>Up for</th>
                  <th>Relisted</th>
                  <th>Price</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.item.title}`}
                        disabled={!canRelist(r) || busy}
                        checked={selected.has(r.key)}
                        onChange={(e) => toggle(r.key, e.target.checked)}
                      />
                    </td>
                    <td>{r.item.images[0] ? <img src={`/images/${r.item.images[0]}`} alt="" loading="lazy" /> : <div className="noimg" />}</td>
                    <td>
                      <Link to={`/items/${r.item.id}`} className="item-title" title={r.item.title}>
                        {r.item.title}
                      </Link>
                      {!canRelist(r) && (
                        <div className="muted small">{!r.listing.url ? "No listing link saved" : "Add a photo first"}</div>
                      )}
                    </td>
                    <td>
                      {r.listing.url ? (
                        <a href={r.listing.url} target="_blank" rel="noreferrer">
                          {MARKETPLACE_LABELS[r.listing.marketplace]} ↗
                        </a>
                      ) : (
                        MARKETPLACE_LABELS[r.listing.marketplace]
                      )}
                    </td>
                    <td className={`num ${r.stale ? "stale-text" : ""}`}>{r.age == null ? "—" : `${r.age} day${r.age === 1 ? "" : "s"}`}</td>
                    <td className="num">{r.listing.relistedCount ? `${r.listing.relistedCount}×` : "—"}</td>
                    <td className="num">{formatMoney(r.item.price, settings.currency)}</td>
                    <td>
                      <button disabled={!canRelist(r) || busy || !extension} onClick={() => void relist([r])}>
                        ↻ Relist
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
