import { Link } from "react-router";
import { EXTENSION_STORE_URL, EXTENSION_ZIP_URL, useExtension } from "../extension";

/** How to get the Chrome extension: the Web Store once published, the zipped build until then. */
export function Extension() {
  const extension = useExtension();

  return (
    <>
      <div className="page-head">
        <h1>Chrome extension</h1>
      </div>
      <div className="grid-2">
        <section className="card">
          <h2>What it does</h2>
          <p>
            The extension opens Vinted or eBay's listing page and fills it in from your inventory: photos, title,
            description, price, condition and package size. You check it and press publish, and the listing link is saved
            back to the item. It can also <Link to="/import">import the listings you already have</Link> on Vinted and eBay.
          </p>
          <p className="muted small">Works in Chrome, Edge, Brave and other Chromium browsers on a computer.</p>
          <p className="muted small">
            It only runs on Vinted, eBay and Stock & List. See the <Link to="/privacy">privacy policy</Link>.
          </p>
        </section>

        <section className="card">
          <h2>Install</h2>
          {extension ? (
            <p>
              ✅ Installed <span className="muted">(v{extension})</span>. Go to any item and use “List on Vinted” or “List on
              eBay”, or open the extension's side panel from the toolbar.
            </p>
          ) : EXTENSION_STORE_URL ? (
            <>
              <p>Add it from the Chrome Web Store, then sign in from its side panel with your Stock & List account.</p>
              <a className="button primary big" href={EXTENSION_STORE_URL} target="_blank" rel="noreferrer">
                Add to Chrome
              </a>
            </>
          ) : (
            <>
              <p>The extension isn't in the Chrome Web Store yet. You can install it by hand in about a minute:</p>
              <ol className="install-steps">
                <li>
                  <a className="button primary" href={EXTENSION_ZIP_URL} download>
                    Download the extension (.zip)
                  </a>{" "}
                  and unzip it.
                </li>
                <li>
                  Open <code>chrome://extensions</code> and turn on <strong>Developer mode</strong> (top right).
                </li>
                <li>
                  Click <strong>Load unpacked</strong> and pick the unzipped folder.
                </li>
                <li>Click the Stock & List icon in the toolbar and sign in.</li>
              </ol>
            </>
          )}
          {extension === false && (
            <p className="muted small">
              Already installed? Reload this page. If it still isn't found, check it's enabled in{" "}
              <code>chrome://extensions</code>.
            </p>
          )}
          <p className="small">
            <Link to="/">← Back to inventory</Link>
          </p>
        </section>
      </div>
    </>
  );
}
