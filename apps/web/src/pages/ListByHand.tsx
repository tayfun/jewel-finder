import {
  MARKETPLACES,
  MARKETPLACE_LABELS,
  handListingFields,
  imageUrl,
  sellUrl,
  type ItemWithListings,
  type Marketplace,
} from "@jf/shared";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api } from "../api";
import { useAccount } from "../auth";
import { Loader } from "../components/Loader";
import { Photo } from "../components/Photo";
import { useLoad } from "../hooks";
import { toListingLink } from "../listingLinks";

/** Copies text, falling back to a hidden textarea where the Clipboard API isn't available. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // fall through
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.append(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

/**
 * Listing by hand on a phone, where the extension can't run: save the photos, copy each detail, open
 * the marketplace's app or site, and paste the new listing's link back so Stock & List keeps track.
 */
export function ListByHand() {
  const { id, marketplace } = useParams();
  const m = MARKETPLACES.find((x) => x === marketplace) as Marketplace | undefined;
  const { settings } = useAccount();
  const { data: item, setData, error } = useLoad(() => api<ItemWithListings>(`/api/items/${id}`), [id]);
  // The photos as files (for the share sheet) with object URLs (for the download fallback).
  const [photos, setPhotos] = useState<{ file: File; href: string }[] | null>(null);
  const [copied, setCopied] = useState("");
  const [saveNote, setSaveNote] = useState("");
  const [url, setUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [linked, setLinked] = useState(false);
  const [linking, setLinking] = useState(false);

  // Fetch the photos up front: phones only open the share sheet straight after a tap, with no waiting.
  useEffect(() => {
    if (!item?.images.length) {
      setPhotos(item ? [] : null);
      return;
    }
    let cancelled = false;
    let hrefs: string[] = [];
    void Promise.all(
      item.images.map(async (key, i) => {
        const res = await fetch(imageUrl(window.location.origin, key));
        const blob = await res.blob();
        const ext = (blob.type.split("/")[1] ?? "jpg").replace("jpeg", "jpg");
        return new File([blob], `${item.sku || "photo"}-${i + 1}.${ext}`, { type: blob.type || "image/jpeg" });
      }),
    )
      .then((f) => {
        if (cancelled) return;
        hrefs = f.map((file) => URL.createObjectURL(file));
        setPhotos(f.map((file, i) => ({ file, href: hrefs[i]! })));
      })
      .catch(() => !cancelled && setPhotos([]));
    return () => {
      cancelled = true;
      hrefs.forEach((h) => URL.revokeObjectURL(h));
    };
    // Only when the photos change, not on every reload of the item (e.g. after linking the listing).
  }, [item?.images.join(",")]);

  if (!m) return <p className="error">Unknown marketplace.</p>;
  if (error) return <p className="error">{error.message}</p>;
  if (!item) return <Loader label="Loading item…" />;

  const site = MARKETPLACE_LABELS[m];
  const fields = handListingFields(item, m);
  const files = photos?.map((p) => p.file) ?? null;
  const canShareFiles = Boolean(files?.length && navigator.canShare?.({ files }));
  const listing = item.listings.find((l) => l.marketplace === m);

  async function copy(label: string, value: string) {
    await copyText(value);
    setCopied(label);
    setTimeout(() => setCopied((c) => (c === label ? "" : c)), 1800);
  }

  async function savePhotos() {
    setSaveNote("");
    try {
      await navigator.share({ files: files! });
      setSaveNote("Done. If you chose “Save images”, they're the newest photos in your gallery.");
    } catch (e) {
      if ((e as Error).name !== "AbortError") setSaveNote("Couldn't open the share menu. Save them one by one below.");
    }
  }

  async function pasteLink() {
    try {
      setUrl((await navigator.clipboard.readText()).trim());
    } catch {
      setLinkError("Your browser didn't allow pasting. Press and hold the box to paste instead.");
    }
  }

  async function saveLink() {
    setLinkError("");
    setLinking(true);
    try {
      // Takes full links, the apps' short share links (e.g. ebay.io/m/…) and whole share messages.
      const parsed = await toListingLink(m!, url);
      await api(`/api/items/${item!.id}/listings/${m}`, { method: "PUT", json: { status: "listed", url: parsed.url, externalId: parsed.externalId, error: null } });
      setData(await api<ItemWithListings>(`/api/items/${item!.id}`));
      setLinked(true);
    } catch (e) {
      setLinkError((e as Error).message);
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="hand-list">
      <div className="page-head">
        <div>
          <Link to={`/items/${item.id}`} className="muted small">
            ← {item.title}
          </Link>
          <h1>List on {site}</h1>
          <p className="muted small">Copy the details into the {site} app, then link the new listing back here.</p>
        </div>
      </div>

      {listing?.status === "listed" && !linked && (
        <p className="notice small">
          This item is already listed on {site}
          {listing.url ? (
            <>
              {" "}
              (<a href={listing.url}>view it</a>)
            </>
          ) : null}
          . Listing it again makes a second listing.
        </p>
      )}

      <section className="card hand-step">
        <h2>
          <span className="step-no">1</span> Save the photos
        </h2>
        {item.images.length === 0 ? (
          <p className="muted">
            No photos yet. <Link to={`/items/${item.id}/edit`}>Add some</Link> first: {site} needs at least one.
          </p>
        ) : (
          <>
            <div className="hand-photos">
              {item.images.map((k) => (
                <Photo key={k} k={k} size="thumb" alt="" />
              ))}
            </div>
            {photos === null ? (
              <p className="muted small">Getting the photos ready…</p>
            ) : canShareFiles ? (
              <button className="primary big" onClick={() => void savePhotos()}>
                Save {item.images.length} photo{item.images.length === 1 ? "" : "s"} to your phone
              </button>
            ) : (
              <div className="hand-downloads">
                {photos.map(({ file, href }, i) => (
                  <a key={file.name} className="button" href={href} download={file.name}>
                    Save photo {i + 1}
                  </a>
                ))}
                <p className="muted small">On an iPhone you can also press and hold a photo and choose “Save to Photos”.</p>
              </div>
            )}
            {saveNote && <p className="muted small">{saveNote}</p>}
          </>
        )}
      </section>

      <section className="card hand-step">
        <h2>
          <span className="step-no">2</span> Copy the details
        </h2>
        <p className="muted small">Tap Copy, then paste into the matching box on {site}.</p>
        <ul className="hand-fields">
          {fields.map((f) => (
            <li key={f.label} className={f.long ? "long" : ""}>
              <div className="hand-field-text">
                <span className="muted small">{f.label}</span>
                <span className={f.long ? "prewrap hand-long" : "hand-value"}>{f.value}</span>
                {f.note && <span className="muted small">{f.note}</span>}
              </div>
              <button className={copied === f.label ? "copied" : ""} onClick={() => void copy(f.label, f.value)}>
                {copied === f.label ? "Copied ✓" : "Copy"}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card hand-step">
        <h2>
          <span className="step-no">3</span> Create the listing on {site}
        </h2>
        <p className="muted small">Opens the {site} app if you have it, otherwise the website. Add the saved photos and paste in the details.</p>
        <a className="button primary big" href={sellUrl(m, settings, item.title)} target="_blank" rel="noreferrer">
          Open {site}
        </a>
      </section>

      <section className="card hand-step">
        <h2>
          <span className="step-no">4</span> Link the new listing
        </h2>
        {linked ? (
          <>
            <p>✅ Saved as listed on {site}. Stock & List can now flag it for ending if the item sells elsewhere.</p>
            <Link to={`/items/${item.id}`} className="button primary">
              Back to the item
            </Link>
          </>
        ) : (
          <>
            <p className="muted small">
              Once it's published, use {site}'s Share button on your listing, choose Copy link, and paste it here.
            </p>
            <div className="inline-form">
              <input
                inputMode="url"
                placeholder={m === "vinted" ? "https://www.vinted.co.uk/items/…" : "https://ebay.io/m/… or https://www.ebay.co.uk/itm/…"}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              {"clipboard" in navigator && "readText" in navigator.clipboard && (
                <button type="button" onClick={() => void pasteLink()}>
                  Paste
                </button>
              )}
            </div>
            {linkError && <p className="error small">{linkError}</p>}
            <div className="actions">
              <button className="primary" disabled={!url.trim() || linking} onClick={() => void saveLink()}>
                {linking ? "Checking the link…" : "Mark as listed"}
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
