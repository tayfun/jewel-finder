import {
  CONDITION_LABELS,
  MARKETPLACES,
  LISTING_STATUS_LABELS,
  MARKETPLACE_LABELS,
  PACKAGE_SIZE_LABELS,
  formatMoney,
  parseListingUrl,
  type ItemWithListings,
  type Listing,
  type Marketplace,
} from "@jf/shared";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { BOOK_FIELDS } from "../book";
import { Autofill } from "../components/Autofill";
import { StatusBadge } from "../components/Badges";
import { Lightbox } from "../components/Lightbox";
import { delistViaExtension, listViaExtension, useExtension } from "../extension";
import { useLoad } from "../hooks";

export function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useAccount();
  const { data: item, setData, error, reload } = useLoad(() => api<ItemWithListings>(`/api/items/${id}`), [id]);
  const [photo, setPhoto] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autofill, setAutofill] = useState(false);
  const [viewer, setViewer] = useState(false);
  const extension = useExtension();
  const imageCount = item?.images.length ?? 0;

  // ←/→ step through photos on the page too (the lightbox handles its own keys while open).
  useEffect(() => {
    if (imageCount < 2 || viewer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      if (e.key === "ArrowLeft") setPhoto((p) => (p - 1 + imageCount) % imageCount);
      else if (e.key === "ArrowRight") setPhoto((p) => (p + 1) % imageCount);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageCount, viewer]);

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

  /** Marks the item sold, then opens any listings still live elsewhere so the seller can end them. */
  function markSold(marketplace?: Marketplace) {
    return act(async () => {
      const updated = await api<ItemWithListings>(`/api/items/${item!.id}/sold`, { json: marketplace ? { marketplace } : {} });
      setData(updated);
      if (!extension) return;
      for (const l of updated.listings) {
        if (l.status === "ending" && l.url) await delistViaExtension(updated.id, l.marketplace);
      }
    });
  }
  const profit = item.price != null && item.cost != null ? item.price - item.cost : null;
  const details: [string, string][] = (
    [
      ["SKU", item.sku],
      ["Brand", item.brand],
      ["Category", item.category],
      ["Size", item.size],
      ["Colour", item.colour],
      ["Condition", item.condition ? CONDITION_LABELS[item.condition] : ""],
      [
        "Postage",
        [item.packageSize && PACKAGE_SIZE_LABELS[item.packageSize], item.weightGrams && `${item.weightGrams} g`]
          .filter(Boolean)
          .join(" · "),
      ],
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
              <div className="main-photo-wrap">
                <button
                  className="main-photo-button"
                  onClick={() => setViewer(true)}
                  aria-label="View photo full screen"
                  title="Click to view full screen"
                >
                  <img className="main-photo" src={`/images/${item.images[Math.min(photo, item.images.length - 1)]}`} alt="" />
                </button>
                {item.images.length > 1 && (
                  <>
                    <button
                      className="photo-nav prev"
                      onClick={() => setPhoto((p) => (p - 1 + item.images.length) % item.images.length)}
                      aria-label="Previous photo"
                    >
                      ‹
                    </button>
                    <button
                      className="photo-nav next"
                      onClick={() => setPhoto((p) => (p + 1) % item.images.length)}
                      aria-label="Next photo"
                    >
                      ›
                    </button>
                    <span className="photo-count">
                      {Math.min(photo, item.images.length - 1) + 1} / {item.images.length}
                    </span>
                  </>
                )}
              </div>
              {item.images.length > 1 && (
                <div className="thumbs">
                  {item.images.map((k, i) => (
                    <button key={k} className={i === photo ? "active" : ""} onClick={() => setPhoto(i)}>
                      <img src={`/images/${k}`} alt="" />
                    </button>
                  ))}
                </div>
              )}
              {viewer && (
                <Lightbox
                  images={item.images}
                  index={Math.min(photo, item.images.length - 1)}
                  onIndex={setPhoto}
                  onClose={() => setViewer(false)}
                />
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
                  <button key={m} onClick={() => markSold(m)}>
                    Sold on {MARKETPLACE_LABELS[m]}
                  </button>
                ))}
                <button onClick={() => markSold()}>Sold elsewhere</button>
              </div>
              <p className="muted small">
                {extension
                  ? "Any other live listings open in new tabs, ready for you to end them."
                  : "Any other live listings are flagged so you can end them."}
              </p>
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

  async function delist(m: Marketplace) {
    setBusy(m);
    setError(null);
    try {
      await delistViaExtension(item.id, m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function markEnded(m: Marketplace) {
    setError(null);
    try {
      await api(`/api/items/${item.id}/listings/${m}`, { method: "PUT", json: { status: "ended" } });
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
          <Link to="/extension">Install the Jewel Finder Chrome extension</Link> to fill in and end Vinted and eBay
          listings for you.
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
                <span className={`badge ls-${l?.status ?? "none"}`}>{l ? LISTING_STATUS_LABELS[l.status] : "Not listed"}</span>
                {l?.url && (
                  <a href={l.url} target="_blank" rel="noreferrer" className="small">
                    View ↗
                  </a>
                )}
              </div>
              {l?.error && <p className="error small">{l.error}</p>}
              {l?.status === "ending" && (
                <p className="small reason">
                  Sold elsewhere but still live here. End it so it can't sell twice.
                </p>
              )}
              <div className="actions">
                {l?.status === "ending" && (
                  <>
                    <button
                      className="primary"
                      disabled={!!busy || !extension || !l.url}
                      title={
                        !l.url
                          ? "No listing link saved: end it by hand"
                          : !extension
                            ? "Extension not detected"
                            : `Open the listing on ${MARKETPLACE_LABELS[m]} to end it`
                      }
                      onClick={() => delist(m)}
                    >
                      {busy === m ? "Opening…" : `End on ${MARKETPLACE_LABELS[m]}`}
                    </button>
                    <button onClick={() => markEnded(m)}>I've ended it</button>
                  </>
                )}
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
                {l?.status !== "listed" && l?.status !== "sold" && l?.status !== "ending" && (
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
