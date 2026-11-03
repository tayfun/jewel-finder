import { CONDITION_LABELS, formatMoney, type DuplicatePair, type ItemWithListings } from "@jf/shared";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { ListingBadges, StatusBadge } from "../components/Badges";
import { useLoad } from "../hooks";

/** Review items that look like the same thing entered twice: merge them, or say they're different. */
export function Duplicates() {
  const pairs = useLoad(() => api<{ pairs: DuplicatePair[] }>("/api/duplicates").then((r) => r.pairs), []);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [merged, setMerged] = useState(0);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError("");
    try {
      await fn();
      await pairs.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function keep(pair: DuplicatePair, keepItem: ItemWithListings, drop: ItemWithListings) {
    const message =
      `Merge "${drop.title}" into "${keepItem.title}"?\n\n` +
      `"${keepItem.title}" keeps its own details and photos, and gets the other's listings, tags and any details it's missing. ` +
      `"${drop.title}" is then deleted.`;
    if (!confirm(message)) return;
    return act(`${pair.a.id}|${pair.b.id}`, async () => {
      await api(`/api/items/${keepItem.id}/merge`, { json: { otherId: drop.id } });
      setMerged((n) => n + 1);
    });
  }

  const list = pairs.data;
  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/" className="muted small">
            ← Inventory
          </Link>
          <h1>Possible duplicates</h1>
        </div>
      </div>
      <p className="muted">
        Items that look like the same thing entered twice, for example imported from both Vinted and eBay. Merge them into one
        item (its listings come along), or mark them as different so they aren't suggested again.
      </p>
      {merged > 0 && <p className="notice">Merged {merged} pair{merged === 1 ? "" : "s"}.</p>}
      {error && <p className="error">{error}</p>}
      {pairs.error && <p className="error">{pairs.error.message}</p>}
      {list && list.length === 0 && (
        <div className="empty card">
          <p>No possible duplicates. 🎉</p>
          <Link to="/" className="button">
            Back to inventory
          </Link>
        </div>
      )}
      <div className={`dup-list ${pairs.loading ? "loading" : ""}`}>
        {list?.map((pair) => {
          const key = `${pair.a.id}|${pair.b.id}`;
          return (
            <section key={key} className="card dup-pair">
              <div className="dup-why">
                <strong>{pair.score >= 0.95 ? "Very likely the same item" : "Likely the same item"}</strong>
                {pair.reasons.map((r) => (
                  <span key={r} className="badge">
                    {r}
                  </span>
                ))}
              </div>
              <div className="dup-items">
                {[
                  [pair.a, pair.b],
                  [pair.b, pair.a],
                ].map(([item, other]) => (
                  <DupItem key={item!.id} item={item!} disabled={!!busy} onKeep={() => keep(pair, item!, other!)} />
                ))}
              </div>
              <div className="form-actions">
                <button
                  disabled={!!busy}
                  onClick={() => act(key, () => api("/api/duplicates/dismiss", { json: { a: pair.a.id, b: pair.b.id } }))}
                >
                  {busy === key ? "Saving…" : "Not duplicates"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function DupItem({ item, disabled, onKeep }: { item: ItemWithListings; disabled: boolean; onKeep: () => void }) {
  const { settings } = useAccount();
  const details = [
    item.brand,
    item.size,
    item.colour,
    item.condition && CONDITION_LABELS[item.condition],
    item.book?.isbn && `ISBN ${item.book.isbn}`,
  ].filter(Boolean);
  return (
    <div className="dup-item">
      <Link to={`/items/${item.id}`} className="thumb">
        {item.images[0] ? <img src={`/images/${item.images[0]}`} alt="" loading="lazy" /> : <span>No photo</span>}
      </Link>
      <div className="dup-body">
        <Link to={`/items/${item.id}`} className="item-title" title={item.title}>
          {item.title}
        </Link>
        <div className="muted small">{details.join(" · ") || item.sku}</div>
        <div className="item-card-foot">
          <strong>{formatMoney(item.price, settings.currency)}</strong>
          {item.status !== "in_stock" && <StatusBadge status={item.status} />}
        </div>
        <ListingBadges listings={item.listings} />
        <div className="muted small">
          {item.images.length} photo{item.images.length === 1 ? "" : "s"} · added {new Date(item.createdAt).toLocaleDateString()}
        </div>
        <button className="primary" disabled={disabled} onClick={onKeep}>
          Keep this one
        </button>
      </div>
    </div>
  );
}
