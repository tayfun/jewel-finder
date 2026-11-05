import { MARKETPLACE_LABELS, formatMoney, parseMoney, toDecimal, type ItemWithListings, type PriceCheck } from "@jf/shared";
import { useEffect, useRef, useState } from "react";
import { HttpError, api } from "../api";
import { useAccount } from "../auth";
import { EXTENSION_STORE_URL, priceCheckViaExtension, useExtension } from "../extension";
import { Loader } from "./Loader";
import { CompList } from "./Pricing";

// Step 3 of adding an item: the item is saved, so the extension can look up comparables for it straight away.
// The best suggestion fills the price; the seller can take it, pick another or type their own.

type Check = { status: "idle" | "running" | "done" | "error"; data?: PriceCheck | null; error?: string };

export function PriceStep({ item, onDone }: { item: ItemWithListings; onDone(item: ItemWithListings): void }) {
  const { settings } = useAccount();
  const extension = useExtension();
  const money = (v: number | null) => formatMoney(v, settings.currency);
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const [price, setPrice] = useState(toDecimal(item.price));
  // Until the seller types a price, a fresh suggestion may fill it in.
  const typed = useRef(item.price != null);
  const [showComps, setShowComps] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function suggest(c: PriceCheck | null) {
    const best = c?.summary.suggestions[0];
    if (best && !typed.current) setPrice(toDecimal(best.price));
  }

  async function run() {
    setCheck({ status: "running" });
    try {
      await priceCheckViaExtension(item.id);
      const data = await api<PriceCheck>(`/api/items/${item.id}/price-check`);
      setCheck({ status: "done", data });
      suggest(data);
    } catch (e) {
      setCheck({ status: "error", error: (e as Error).message });
    }
  }

  // Once we know the extension is there: reuse a check made since the item last changed, else search now.
  const started = useRef(false);
  useEffect(() => {
    if (!extension || started.current) return;
    started.current = true;
    void (async () => {
      const existing = await api<PriceCheck>(`/api/items/${item.id}/price-check`).catch((e) => {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      });
      if (existing && existing.createdAt >= item.updatedAt) {
        setCheck({ status: "done", data: existing });
        suggest(existing);
      } else await run();
    })().catch((e) => setCheck({ status: "error", error: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extension]);

  async function save() {
    const value = parseMoney(price);
    if (Number.isNaN(value)) return setError("Price must be a number, e.g. 12.50");
    setError("");
    setSaving(true);
    try {
      onDone(value === item.price ? item : await api<ItemWithListings>(`/api/items/${item.id}`, { method: "PATCH", json: { price: value } }));
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  }

  const c = check.data;
  const chosen = parseMoney(price);
  return (
    <div className="wizard">
      <section className="card wizard-intro">
        <div>
          <h2>What should it sell for?</h2>
          <p className="muted">
            Your item is saved. We look up what the same thing sold for on eBay and what it's listed at on Vinted, and
            suggest a price from it. Take it, pick another, or type your own.
          </p>
        </div>
      </section>

      <section className="card price-step" aria-live="polite">
        {extension === null && <Loader label="Looking for the Chrome extension…" />}

        {extension === false && (
          <div className="ext-prompt">
            <span className="import-icon" aria-hidden="true">
              💷
            </span>
            <div>
              <h3>Get a price from real sales</h3>
              <p className="muted">
                With the Stock &amp; List Chrome extension, this step searches eBay sold listings and Vinted for you and
                suggests a price automatically. No extension? Set your price below and check comparables later from the
                item page.
              </p>
            </div>
            <a className="button" href={EXTENSION_STORE_URL ?? "/extension"} target="_blank" rel="noreferrer">
              Get the extension
            </a>
          </div>
        )}

        {check.status === "running" && (
          <>
            <Loader label="Searching eBay and Vinted for comparables…" />
            <p className="muted small center">
              About a minute. Each search opens in a background tab and closes again. You can set a price now if you
              already know it.
            </p>
          </>
        )}

        {check.status === "error" && (
          <div className="ai-status error">
            <p className="error">Couldn't check prices: {check.error}</p>
            <div className="actions">
              <button type="button" onClick={() => void run()}>
                Try again
              </button>
              <span className="muted small">or set the price yourself.</span>
            </div>
          </div>
        )}

        {check.status === "done" && c && (
          <>
            {c.summary.suggestions.length > 0 && (
              <p className="muted small">
                We've filled in the recommended price: the typical price of the closest comparables, adjusted for your
                item's condition.
              </p>
            )}
            {c.summary.suggestions.length > 0 ? (
              <ul className="suggestions">
                {c.summary.suggestions.map((s, i) => (
                  <li key={s.marketplace}>
                    <div className="suggestion-head">
                      <strong className="price-sm">{money(s.price)}</strong>
                      <span>
                        on {MARKETPLACE_LABELS[s.marketplace]} · range {money(s.low)}–{money(s.high)}
                      </span>
                      <span className={`badge conf-${s.confidence}`}>{s.confidence} confidence</span>
                      {i === 0 && <span className="ai-badge">Recommended</span>}
                    </div>
                    <div className="muted small">{s.note}</div>
                    {chosen !== s.price && (
                      <button
                        type="button"
                        onClick={() => {
                          typed.current = true;
                          setPrice(toDecimal(s.price));
                        }}
                      >
                        Use {money(s.price)}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Not enough like-for-like comparables to suggest a price. Set your own below.</p>
            )}
            {c.summary.ordinaryFloor != null && c.summary.suggestions.length === 0 && (
              <p className="small">
                Ordinary copies: about <strong>{money(c.summary.ordinaryFloor)}</strong>. A floor, not a price.
              </p>
            )}
            {c.summary.warnings.map((w) => (
              <p key={w} className="notice small">
                {w}
              </p>
            ))}
            {c.ai?.status === "done" && !c.aiOutdated && c.ai.note && (
              <div className="ai-note small">
                <strong>✨ What to check</strong>
                <p>{c.ai.note}</p>
              </div>
            )}
            <p className="muted small">
              {c.comps.length} comparable{c.comps.length === 1 ? "" : "s"} found ·{" "}
              <button type="button" className="link" onClick={() => setShowComps(!showComps)}>
                {showComps ? "Hide" : "Show"} comparables
              </button>{" "}
              ·{" "}
              <button type="button" className="link" onClick={() => void run()}>
                Search again
              </button>
            </p>
            {showComps && <CompList check={c} money={money} />}
          </>
        )}

        <label className="price-input">
          Your price
          <input
            inputMode="decimal"
            placeholder="0.00"
            value={price}
            onChange={(e) => {
              typed.current = true;
              setPrice(e.target.value);
            }}
          />
        </label>
        {error && <p className="error small">{error}</p>}
      </section>

      <div className="wizard-actions">
        <button type="button" className="link" disabled={saving} onClick={() => onDone(item)}>
          Skip, price it later
        </button>
        <button type="button" className="primary big cta" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : chosen && !Number.isNaN(chosen) ? `Save at ${money(chosen)}` : "Save item"}
        </button>
      </div>
    </div>
  );
}
