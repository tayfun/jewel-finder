import { CONDITION_LABELS, formatMoney, type DismissedPair, type DuplicatePair, type ItemWithListings } from "@jf/shared";
import { useState } from "react";
import { Link } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { ListingBadges, StatusBadge } from "../components/Badges";
import { useLoad } from "../hooks";

/** Review items that look like the same thing entered twice: merge them, or say they're different. */
export function Duplicates() {
  const pairs = useLoad(() => api<{ pairs: DuplicatePair[] }>("/api/duplicates").then((r) => r.pairs), []);
  const dismissed = useLoad(() => api<{ pairs: DismissedPair[] }>("/api/duplicates/dismissed").then((r) => r.pairs), []);
  const [busy, setBusy] = useState("");
  // Errors are shown next to the pair they're about, not at the top of a long page.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [merged, setMerged] = useState(0);
  /** The pair just marked "not duplicates", so a mis-click can be undone right away. */
  const [justDismissed, setJustDismissed] = useState<{ a: string; b: string } | null>(null);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setErrors(({ [key]: _, ...rest }) => rest);
    try {
      await fn();
      await Promise.all([pairs.reload(), dismissed.reload()]);
    } catch (e) {
      setErrors((errs) => ({ ...errs, [key]: (e as Error).message }));
    } finally {
      setBusy("");
    }
  }

  function merge(pair: DuplicatePair, keepItem: ItemWithListings, drop: ItemWithListings) {
    const message =
      `Merge these two into one item?\n\n` +
      `Keeps: "${keepItem.title}", with its own details and photos, plus the other's listings, tags and any details it's missing.\n` +
      `Deletes: "${drop.title}".`;
    if (!confirm(message)) return;
    return act(pairKey(pair), async () => {
      await api(`/api/items/${keepItem.id}/merge`, { json: { otherId: drop.id } });
      setMerged((n) => n + 1);
      setJustDismissed(null);
    });
  }

  function notDuplicates(pair: DuplicatePair) {
    return act(pairKey(pair), async () => {
      await api("/api/duplicates/dismiss", { json: { a: pair.a.id, b: pair.b.id } });
      setJustDismissed({ a: pair.a.id, b: pair.b.id });
    });
  }

  function undo(pair: { a: string; b: string }, key: string) {
    return act(key, async () => {
      await api("/api/duplicates/undismiss", { json: pair });
      setJustDismissed(null);
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
      {justDismissed && (
        <p className="notice">
          Marked as not duplicates: both items stay.{" "}
          <button className="link" disabled={!!busy} onClick={() => undo(justDismissed, "undo")}>
            Undo
          </button>
          {errors.undo && <span className="error"> {errors.undo}</span>}
        </p>
      )}
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
          const key = pairKey(pair);
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
                  <DupItem key={item!.id} item={item!} disabled={!!busy} onMerge={() => merge(pair, item!, other!)} />
                ))}
              </div>
              {errors[key] && <p className="error">{errors[key]}</p>}
              <div className="form-actions">
                <button disabled={!!busy} onClick={() => notDuplicates(pair)}>
                  {busy === key ? "Saving…" : "Not duplicates"}
                </button>
              </div>
            </section>
          );
        })}
      </div>
      {!!dismissed.data?.length && (
        <details className="card dup-dismissed">
          <summary>
            Marked as not duplicates <span className="muted">({dismissed.data.length})</span>
          </summary>
          <p className="muted small">Undo to see a pair above again, so you can merge it.</p>
          <ul>
            {dismissed.data.map((p) => {
              const key = `dismissed:${pairKey(p)}`;
              return (
                <li key={key}>
                  <span className="dup-dismissed-titles">
                    <Link to={`/items/${p.a.id}`}>{p.a.title}</Link>
                    <span className="muted"> and </span>
                    <Link to={`/items/${p.b.id}`}>{p.b.title}</Link>
                  </span>
                  <span className="muted small">{new Date(p.dismissedAt).toLocaleDateString()}</span>
                  <button className="small" disabled={!!busy} onClick={() => undo({ a: p.a.id, b: p.b.id }, key)}>
                    {busy === key ? "Saving…" : "Undo"}
                  </button>
                  {errors[key] && <span className="error small">{errors[key]}</span>}
                </li>
              );
            })}
          </ul>
        </details>
      )}
    </>
  );
}

const pairKey = (p: { a: { id: string }; b: { id: string } }) => `${p.a.id}|${p.b.id}`;

function DupItem({ item, disabled, onMerge }: { item: ItemWithListings; disabled: boolean; onMerge: () => void }) {
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
        <button className="primary" disabled={disabled} onClick={onMerge} title="Merge the other item into this one">
          Merge into this one
        </button>
      </div>
    </div>
  );
}
