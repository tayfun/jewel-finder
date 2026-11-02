import {
  CONDITION_LABELS,
  MARKETPLACES,
  MARKETPLACE_LABELS,
  formatMoney,
  parseListingUrl,
  type ItemWithListings,
  type Listing,
  type Marketplace,
} from "@jf/shared";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { BOOK_FIELDS } from "../book";
import { Autofill } from "../components/Autofill";
import { StatusBadge } from "../components/Badges";
import { listViaExtension, useExtension } from "../extension";
import { useLoad } from "../hooks";

export function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useAccount();
  const { data: item, setData, error, reload } = useLoad(() => api<ItemWithListings>(`/api/items/${id}`), [id]);
  const [photo, setPhoto] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autofill, setAutofill] = useState(false);

  if (error) return <p className="error">{error.message}</p>;
  if (!item) return <p className="muted">Loading…</p>;

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  const money = (v: number | null) => formatMoney(v, settings.currency);
  const profit = item.price != null && item.cost != null ? item.price - item.cost : null;
  const details: [string, string][] = (
    [
      ["SKU", item.sku],
      ["Brand", item.brand],
      ["Category", item.category],
      ["Size", item.size],
      ["Colour", item.colour],
      ["Condition", item.condition ? CONDITION_LABELS[item.condition] : ""],
      ["Quantity", String(item.quantity)],
      ["Tags", item.tags.join(", ")],
    ] as [string, string][]
  ).filter(([, v]) => v);

  return (
    <>
      <div className="page-head">
        <div>
          <Link to="/" className="muted small">
            ← Inventory
          </Link>
          <h1>{item.title}</h1>
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={!item.images.length || autofill}
            title={item.images.length ? "Identify the book from its photos and suggest listing details" : "Add a photo first"}
            onClick={() => setAutofill(true)}
          >
            ✨ Auto-fill from photos
          </button>
          <Link to={`/items/${item.id}/edit`} className="button">
            Edit
          </Link>
          <button
            onClick={() =>
              act(async () => {
                const copy = await api<ItemWithListings>(`/api/items/${item.id}/duplicate`, { method: "POST" });
                navigate(`/items/${copy.id}/edit`);
              })
            }
          >
            Duplicate
          </button>
          {item.status === "archived" ? (
            <button
              onClick={() =>
                act(async () => setData(await api(`/api/items/${item.id}`, { method: "PATCH", json: { status: "in_stock" } })))
              }
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() =>
                act(async () => setData(await api(`/api/items/${item.id}`, { method: "PATCH", json: { status: "archived" } })))
              }
            >
              Archive
            </button>
          )}
          <button
            className="danger"
            onClick={() =>
              confirm(`Delete "${item.title}" and its photos? This can't be undone.`) &&
              act(async () => {
                await api(`/api/items/${item.id}`, { method: "DELETE" });
                navigate("/");
              })
            }
          >
            Delete
          </button>
        </div>
      </div>
      {actionError && <p className="error">{actionError}</p>}
      {autofill && (
        <Autofill
          item={item}
          onClose={() => setAutofill(false)}
          onApplied={(updated) => {
            setData(updated);
            setAutofill(false);
          }}
        />
      )}

      <div className="detail">
        <div className="gallery card">
          {item.images.length ? (
            <>
              <img className="main-photo" src={`/images/${item.images[Math.min(photo, item.images.length - 1)]}`} alt="" />
              {item.images.length > 1 && (
                <div className="thumbs">
                  {item.images.map((k, i) => (
                    <button key={k} className={i === photo ? "active" : ""} onClick={() => setPhoto(i)}>
                      <img src={`/images/${k}`} alt="" />
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="no-photo">
              No photos yet. <Link to={`/items/${item.id}/edit`}>Add some</Link> — marketplaces need at least one.
            </div>
          )}
        </div>

        <div className="detail-side">
          <section className="card">
            <div className="price-row">
              <span className="price">{money(item.price)}</span>
              <StatusBadge status={item.status} />
            </div>
            <div className="muted small">
              Cost {money(item.cost)}
              {profit != null && (
                <>
                  {" · "}
                  <span className={profit >= 0 ? "pos" : "neg"}>Profit {money(profit)}</span>
                </>
              )}
            </div>
            <dl className="details">
              {details.map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>

          {item.book && (
            <section className="card">
              <h2>Book details</h2>
              <dl className="details">
                {BOOK_FIELDS.filter((f) => f.key !== "rarityNotes" && f.show(item.book!)).map((f) => (
                  <div key={f.key}>
                    <dt>{f.label}</dt>
                    <dd>{f.show(item.book!)}</dd>
                  </div>
                ))}
              </dl>
              {item.book.rarityNotes && <p className="small prewrap rarity-notes">{item.book.rarityNotes}</p>}
            </section>
          )}

          <Listings item={item} onChange={reload} />

          {item.status !== "sold" && (
            <section className="card">
              <h2>Sold it?</h2>
              <div className="actions">
                {MARKETPLACES.map((m) => (
                  <button
                    key={m}
                    onClick={() =>
                      act(async () => setData(await api(`/api/items/${item.id}/sold`, { json: { marketplace: m } })))
                    }
                  >
                    Sold on {MARKETPLACE_LABELS[m]}
                  </button>
                ))}
                <button onClick={() => act(async () => setData(await api(`/api/items/${item.id}/sold`, { json: {} })))}>
                  Sold elsewhere
                </button>
              </div>
              <p className="muted small">Other live listings will be marked as ended — remember to remove them.</p>
            </section>
          )}
        </div>
      </div>

      {(item.description || item.notes) && (
        <div className="grid-2">
          {item.description && (
            <section className="card">
              <h2>Description</h2>
              <p className="prewrap">{item.description}</p>
            </section>
          )}
          {item.notes && (
            <section className="card">
              <h2>Private notes</h2>
              <p className="prewrap">{item.notes}</p>
            </section>
          )}
        </div>
      )}
    </>
  );
}

function Listings({ item, onChange }: { item: ItemWithListings; onChange(): void }) {
  const extension = useExtension();
  const [busy, setBusy] = useState<Marketplace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState<Marketplace | null>(null);
  const [url, setUrl] = useState("");

  const byMarket = new Map(item.listings.map((l) => [l.marketplace, l]));

  async function list(m: Marketplace) {
    setBusy(m);
    setError(null);
    try {
      await listViaExtension(item.id, m);
      // The extension records a pending listing; show it.
      setTimeout(onChange, 500);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function saveManual(m: Marketplace) {
    setError(null);
    const parsed = url ? parseListingUrl(m, url) : null;
    if (url && !parsed) return setError(`That doesn't look like a ${MARKETPLACE_LABELS[m]} listing URL`);
    try {
      await api(`/api/items/${item.id}/listings/${m}`, {
        method: "PUT",
        json: { status: "listed", url: parsed?.url ?? null, externalId: parsed?.externalId ?? null },
      });
      setManual(null);
      setUrl("");
      onChange();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(m: Marketplace) {
    await api(`/api/items/${item.id}/listings/${m}`, { method: "DELETE" }).catch((e) => setError(e.message));
    onChange();
  }

  // Why "List on …" can't be used right now, shown under the button.
  const blocked =
    item.status === "sold"
      ? "Item is marked as sold"
      : !item.images.length
        ? "Add a photo first"
        : extension === null
          ? "Checking for the extension…"
          : extension === false
            ? "Extension not detected"
            : null;

  return (
    <section className="card">
      <h2>Marketplaces</h2>
      {extension === false && (
        <p className="notice small">
          Install the Jewel Finder Chrome extension to fill in Vinted and eBay listings automatically.
        </p>
      )}
      <ul className="listings">
        {MARKETPLACES.map((m) => {
          const l: Listing | undefined = byMarket.get(m);
          const canList = !l || l.status === "pending" || l.status === "failed" || l.status === "ended";
          return (
            <li key={m}>
              <div className="listing-head">
                <strong>{MARKETPLACE_LABELS[m]}</strong>
                <span className={`badge ls-${l?.status ?? "none"}`}>{l ? l.status : "not listed"}</span>
                {l?.url && (
                  <a href={l.url} target="_blank" rel="noreferrer" className="small">
                    View ↗
                  </a>
                )}
              </div>
              {l?.error && <p className="error small">{l.error}</p>}
              <div className="actions">
                {canList && (
                  <button
                    className="primary"
                    disabled={!!busy || !!blocked}
                    title={blocked ?? `Open ${MARKETPLACE_LABELS[m]} and fill in this item`}
                    onClick={() => list(m)}
                  >
                    {busy === m ? "Opening…" : l?.status === "pending" ? "Try again" : `List on ${MARKETPLACE_LABELS[m]}`}
                  </button>
                )}
                {l?.status !== "listed" && l?.status !== "sold" && (
                  <button onClick={() => setManual(manual === m ? null : m)}>Already listed?</button>
                )}
                {l && (
                  <button className="link" onClick={() => remove(m)}>
                    Clear
                  </button>
                )}
              </div>
              {canList && blocked && <p className="muted small reason">{blocked}</p>}
              {manual === m && (
                <div className="inline-form">
                  <input
                    placeholder={`${MARKETPLACE_LABELS[m]} listing URL (optional)`}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <button onClick={() => saveManual(m)}>Mark as listed</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="error">{error}</p>}
    </section>
  );
}
