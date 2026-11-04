import { MARKETPLACES, MARKETPLACE_LABELS, type Marketplace } from "@jf/shared";
import { useState } from "react";
import { Link } from "react-router";
import { useAccount } from "../auth";
import { importViaExtension, useExtension } from "../extension";

const WHERE: Record<Marketplace, string> = {
  vinted: "your Vinted wardrobe",
  ebay: "your active listings in eBay Seller Hub",
};

/** Bring existing Vinted / eBay listings into the inventory, via the extension. */
export function Import() {
  const { settings } = useAccount();
  const extension = useExtension();
  const [busy, setBusy] = useState<Marketplace | null>(null);
  const [opened, setOpened] = useState<Marketplace | null>(null);
  const [error, setError] = useState("");

  async function start(m: Marketplace) {
    setBusy(m);
    setError("");
    try {
      await importViaExtension(m);
      setOpened(m);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <h1>Import listings</h1>
      </div>

      <div className="grid-2">
        <section className="card">
          <h2>Bring in what you already sell</h2>
          <ol className="install-steps">
            <li>Make sure you're signed in to Vinted or eBay in this browser.</li>
            <li>
              Press a button below. The extension opens {WHERE.vinted} or {WHERE.ebay}, with a Stock & List panel on the
              page.
            </li>
            <li>
              Tick the listings you want, or <strong>Select all on this page</strong>, then press <strong>Import</strong>.
              Go to the next page or scroll for more: import mode stays on in that tab.
            </li>
          </ol>
          <p className="muted small">
            Each listing comes in as an item with its photos, title, description, price, brand, size, colour, condition
            and category, already linked to the live listing. Listings you've already imported (or listed from Jewel
            Finder) are marked and skipped, so you can run it again any time to pick up new ones.
          </p>
        </section>

        <section className="card">
          <h2>Start an import</h2>
          {extension === false ? (
            <p className="notice">
              Importing uses the Stock & List Chrome extension. <Link to="/extension">Install it</Link>, then come back here.
            </p>
          ) : (
            <div className="actions">
              {MARKETPLACES.map((m) => (
                <button key={m} className="primary big" disabled={!extension || !!busy} onClick={() => void start(m)}>
                  {busy === m ? "Opening…" : `Import from ${MARKETPLACE_LABELS[m]}`}
                </button>
              ))}
            </div>
          )}
          {extension === null && <p className="muted small">Checking for the extension…</p>}
          {error && <p className="error">{error}</p>}
          {opened && (
            <p className="notice">
              Opened {MARKETPLACE_LABELS[opened]} in a new tab.{" "}
              {opened === "vinted"
                ? "If it shows the home page, press “Open my wardrobe” in the Stock & List panel (or open your profile)."
                : "Pick the listings to import in the Stock & List panel."}{" "}
              Imported items show up in your <Link to="/">inventory</Link>.
            </p>
          )}
          <p className="muted small">
            Uses {settings.vintedDomain} and {settings.ebayDomain}. Change them in <Link to="/settings">Settings</Link>.
          </p>
          <p className="muted small">
            You can also start from the extension's side panel while you're on Vinted or eBay: “Import listings”.
          </p>
        </section>
      </div>
    </>
  );
}
