import {
  CONDITION_LABELS,
  MARKETPLACES,
  LISTING_STATUS_LABELS,
  MARKETPLACE_LABELS,
  PACKAGE_SIZE_LABELS,
  formatMoney,
  isStale,
  listingAgeDays,
  type DuplicatePair,
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
import { Pricing } from "../components/Pricing";
import { StatusBadge } from "../components/Badges";
import { Lightbox } from "../components/Lightbox";
import { delistViaExtension, listViaExtension, relistViaExtension, useExtension, useItemChanges } from "../extension";
import { toListingLink } from "../listingLinks";
import { useLoad, useSwipe } from "../hooks";
import { Loader } from "../components/Loader";
import { Photo } from "../components/Photo";

export function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { settings } = useAccount();
  const { data: item, setData, error, reload } = useLoad(() => api<ItemWithListings>(`/api/items/${id}`), [id]);
  useItemChanges((ids) => {
    if (id && ids.includes(id)) void reload();
  });
  const [photo, setPhoto] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [autofill, setAutofill] = useState(false);
  const [viewer, setViewer] = useState(false);
  const extension = useExtension();
  const duplicates = useLoad(
    () => api<{ pairs: DuplicatePair[] }>(`/api/duplicates?itemId=${id}`).then((r) => r.pairs),
    [id],
  );
  const imageCount = item?.images.length ?? 0;
  // Swipe between photos on touch screens, like the arrows.
  const swipe = useSwipe((by) => imageCount > 1 && setPhoto((p) => (p + by + imageCount) % imageCount));

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
  if (!item) return <Loader label="Loading item…" />;

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
      {!!duplicates.data?.length && (
        <p className="notice">
          This looks like{" "}
          {duplicates.data.map((p, i) => {
            const other = p.a.id === item.id ? p.b : p.a;
            return (
              <span key={other.id}>
                {i > 0 && ", "}
                <Link to={`/items/${other.id}`}>{other.title}</Link>
              </span>
            );
          })}
          , already in your inventory. <Link to="/duplicates">Review duplicates</Link>
        </p>
      )}
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
              <div className="main-photo-wrap" {...swipe.handlers}>
                <button
                  className="main-photo-button"
                  onClick={() => {
                    if (!swipe.justSwiped()) setViewer(true);
                  }}
                  aria-label="View photo full screen"
                  title="Click to view full screen"
                >
                  <Photo className="main-photo" k={item.images[Math.min(photo, item.images.length - 1)]!} size="large" />
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
                      <Photo k={k} size="thumb" />
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

          <Pricing item={item} onPriced={setData} />

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
  const { settings } = useAccount();
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
    try {
      // Optional: full links, the apps' short share links (e.g. ebay.io/m/…) or share messages.
      const parsed = url.trim() ? await toListingLink(m, url) : null;
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

  async function relist(m: Marketplace) {
    setBusy(m);
    setError(null);
    try {
      await relistViaExtension(item.id, m);
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

  // Why "List on …" can't be used right now, shown under the button. Without the extension (e.g. on a
  // phone) listing goes through the copy-and-paste hand-off instead, so that isn't a reason.
  const blocked =
    item.status === "sold"
      ? "Item is marked as sold"
      : !item.images.length
        ? "Add a photo first"
        : extension === null
          ? "Checking for the extension…"
          : null;
  const byHand = (m: Marketplace) => `/items/${item.id}/list/${m}`;

  return (
    <section className="card">
      <h2>Marketplaces</h2>
      {extension === false && (
        <p className="notice small">
          “List on …” walks you through copying the details into the Vinted or eBay app. On a computer, the{" "}
          <Link to="/extension">Chrome extension</Link> fills in and ends listings for you.
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
              {l?.status === "listed" && l.listedAt != null && (
                <p className={`small reason ${isStale(item, l, settings) ? "stale-text" : "muted"}`}>
                  Up for {listingAgeDays(l) === 0 ? "less than a day" : `${listingAgeDays(l)} day${listingAgeDays(l) === 1 ? "" : "s"}`}
                  {l.relistedCount > 0 && ` · relisted ${l.relistedCount}×`}
                  {isStale(item, l, settings) && " · relist to bump it back to the top"}
                </p>
              )}
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
                {l?.status === "listed" && item.status === "in_stock" && (
                  <button
                    className={isStale(item, l, settings) ? "primary" : ""}
                    disabled={!!busy || !extension || !l.url || !item.images.length}
                    title={
                      !l.url
                        ? "No listing link saved, so the old listing can't be removed for you"
                        : !item.images.length
                          ? "Add a photo first"
                          : !extension
                            ? "Extension not detected"
                            : `List it again on ${MARKETPLACE_LABELS[m]}, then remove this listing: bumps it to the top`
                    }
                    onClick={() => relist(m)}
                  >
                    {busy === m ? "Opening…" : "↻ Relist"}
                  </button>
                )}
                {l?.status === "listed" && (
                  <>
                    <button
                      disabled={!!busy || !extension || !l.url}
                      title={
                        !l.url
                          ? "No listing link saved: end it on the site, then press “I've ended it”"
                          : !extension
                            ? "Extension not detected"
                            : `Open the listing on ${MARKETPLACE_LABELS[m]} to end it (e.g. it's listed twice)`
                      }
                      onClick={() => delist(m)}
                    >
                      End listing
                    </button>
                    <button title={`You ended it on ${MARKETPLACE_LABELS[m]} yourself: mark it ended here`} onClick={() => markEnded(m)}>
                      I've ended it
                    </button>
                  </>
                )}
                {canList &&
                  (extension === false && !blocked ? (
                    <Link className="button primary" to={byHand(m)} title={`Copy this item's details into ${MARKETPLACE_LABELS[m]}`}>
                      List on {MARKETPLACE_LABELS[m]}
                    </Link>
                  ) : (
                    <button
                      className="primary"
                      disabled={!!busy || !!blocked}
                      title={blocked ?? `Open ${MARKETPLACE_LABELS[m]} and fill in this item`}
                      onClick={() => list(m)}
                    >
                      {busy === m ? "Opening…" : l?.status === "pending" ? "Try again" : `List on ${MARKETPLACE_LABELS[m]}`}
                    </button>
                  ))}
                {canList && extension && !blocked && (
                  <Link className="small hand-link" to={byHand(m)} title="Copy the details and list it yourself, e.g. in the app">
                    List by hand
                  </Link>
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
