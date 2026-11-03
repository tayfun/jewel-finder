import {
  COMP_SOURCE_LABELS,
  MARKETPLACE_LABELS,
  formatMoney,
  specialFeatures,
  type CompJudgement,
  type CompVerdict,
  type ItemWithListings,
  type PriceCheck,
} from "@jf/shared";
import { useState } from "react";
import { Link } from "react-router";
import { HttpError, api } from "../api";
import { useAccount } from "../auth";
import { priceCheckViaExtension, useExtension } from "../extension";
import { useLoad } from "../hooks";

const DAY = 86_400_000;
const STALE_DAYS = 30;
const VERDICT_ORDER: Record<CompVerdict, number> = { match: 0, ordinary: 1, dropped: 2 };
const VERDICT_LABELS: Record<CompVerdict, string> = { match: "Used", ordinary: "Ordinary copy", dropped: "Not used" };
const AI_LABELS: Record<CompJudgement, string> = {
  same: "same item",
  lesser: "a lesser copy",
  greater: "a better copy than yours",
  different: "a different item",
};

/** Collectable flags, and prices worked out from comparable sold/listed items (PRICING.md). */
export function Pricing({ item, onPriced }: { item: ItemWithListings; onPriced(item: ItemWithListings): void }) {
  const { settings } = useAccount();
  const extension = useExtension();
  const check = useLoad(
    () =>
      api<PriceCheck>(`/api/items/${item.id}/price-check`).catch((e) => {
        if (e instanceof HttpError && e.status === 404) return null;
        throw e;
      }),
    // Re-read when the item changes: the server re-assesses the comps against it.
    [item.id, item.updatedAt],
  );
  const [running, setRunning] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState("");
  const [showComps, setShowComps] = useState(false);
  const money = (v: number | null) => formatMoney(v, settings.currency);
  const features = check.data?.summary.features ?? specialFeatures(item);
  const major = features.filter((f) => f.major);

  async function run() {
    setRunning(true);
    setError("");
    try {
      await priceCheckViaExtension(item.id);
      await check.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  /** Asks Gemini to judge the latest check's comps again (failed last time, or the item changed). */
  async function review() {
    setReviewing(true);
    setError("");
    try {
      await api<PriceCheck>(`/api/items/${item.id}/price-check/review`, { json: {} });
      await check.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setReviewing(false);
    }
  }

  async function usePrice(price: number) {
    setError("");
    try {
      onPriced(await api<ItemWithListings>(`/api/items/${item.id}`, { method: "PATCH", json: { price } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const c = check.data;
  const ageDays = c ? Math.floor((Date.now() - c.createdAt) / DAY) : 0;
  const comps = c
    ? c.comps
        .map((comp, i) => ({ comp, a: c.summary.assessments[i]! }))
        .sort((x, y) => VERDICT_ORDER[x.a.verdict] - VERDICT_ORDER[y.a.verdict] || y.a.similarity - x.a.similarity)
    : [];

  return (
    <section className="card pricing">
      <h2>Pricing</h2>
      {features.length > 0 && (
        <div className="features">
          {major.length > 0 && <span className="muted small">💎 Collectable:</span>}
          {features.map((f) => (
            <span key={f.key} className={`badge ${f.major ? "feature-major" : ""}`} title={f.evidence}>
              {f.label}
            </span>
          ))}
        </div>
      )}
      {major.length > 0 && !c && (
        <p className="small muted">Collectable copies are priced only against comparables with the same features, never ordinary copies.</p>
      )}

      {c && (
        <>
          {c.summary.suggestions.length > 0 ? (
            <ul className="suggestions">
              {c.summary.suggestions.map((s) => (
                <li key={s.marketplace}>
                  <div className="suggestion-head">
                    <strong className="price-sm">{money(s.price)}</strong>
                    <span>
                      on {MARKETPLACE_LABELS[s.marketplace]} · range {money(s.low)}–{money(s.high)}
                    </span>
                    <span className={`badge conf-${s.confidence}`}>{s.confidence} confidence</span>
                  </div>
                  <div className="muted small">{s.note}</div>
                  <button className={item.price === s.price ? "" : "primary"} disabled={item.price === s.price} onClick={() => void usePrice(s.price)}>
                    {item.price === s.price ? "Current price" : `Use ${money(s.price)}`}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No price suggested: not enough like-for-like comparables.</p>
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
          {c.problems.map((p) => (
            <p key={p} className="error small">
              {p}
            </p>
          ))}
          {c.ai?.status === "done" && !c.aiOutdated && c.ai.note && (
            <div className="ai-note small">
              <strong>✨ What to check</strong>
              <p>{c.ai.note}</p>
            </div>
          )}
          {c.ai && (c.ai.status === "failed" || c.aiOutdated || Object.keys(c.ai.judgements).length > 0) && (
            <p className="muted small">
              {c.ai.status === "failed"
                ? `✨ AI review didn't run: ${c.ai.error ?? "unknown error"} `
                : c.aiOutdated
                  ? "✨ The item changed since the AI reviewed these comparables, so its verdicts aren't applied. "
                  : c.summary.aiChanged
                    ? `✨ AI reviewed the comparables and changed ${c.summary.aiChanged} verdict${c.summary.aiChanged === 1 ? "" : "s"} (see "AI:" reasons). `
                    : "✨ AI reviewed the comparables and agreed with the matches. "}
              {(c.ai.status === "failed" || c.aiOutdated) && (
                <button className="link" disabled={reviewing || running} onClick={() => void review()}>
                  {reviewing ? "Reviewing…" : "Review again"}
                </button>
              )}
            </p>
          )}
          <p className="muted small">
            Checked {ageDays === 0 ? "today" : `${ageDays} day${ageDays === 1 ? "" : "s"} ago`} · {c.comps.length} comparable
            {c.comps.length === 1 ? "" : "s"} found{ageDays >= STALE_DAYS ? " · prices move, check again" : ""} ·{" "}
            <button className="link" onClick={() => setShowComps(!showComps)}>
              {showComps ? "Hide" : "Show"} comparables
            </button>
          </p>
          {showComps && (
            <ul className="comps">
              {comps.map(({ comp, a }) => (
                <li key={comp.url} className={`comp v-${a.verdict}`}>
                  {comp.imageUrl ? <img src={comp.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <div className="noimg" />}
                  <div className="comp-body">
                    <a href={comp.url} target="_blank" rel="noreferrer" title={comp.title}>
                      {comp.title}
                    </a>
                    <div className="muted small">
                      {COMP_SOURCE_LABELS[comp.source]}
                      {comp.soldAt ? ` ${new Date(comp.soldAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                      {comp.condition ? ` · ${comp.condition}` : ""}
                      {comp.size ? ` · ${comp.size}` : ""}
                    </div>
                  </div>
                  <div className="comp-side">
                    <strong>{money(comp.price)}</strong>
                    <span className="small" title={a.reason}>
                      {VERDICT_LABELS[a.verdict]}
                      {a.reason ? `: ${a.reason}` : ""}
                      {a.ai && !a.reason.startsWith("AI:") && (
                        <span className="muted" title={`AI: ${AI_LABELS[a.ai]}`}>
                          {" "}
                          ✨
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {error && <p className="error small">{error}</p>}
      {check.error && <p className="error small">{check.error.message}</p>}
      <div className="actions">
        <button className={c ? "" : "primary"} disabled={running || !extension || !item.title} onClick={() => void run()}>
          {running ? "Searching eBay and Vinted…" : c ? "Check again" : "💷 Check prices"}
        </button>
      </div>
      {running && <p className="muted small">Each search opens in a background tab and closes again. About a minute.</p>}
      {!c && !running && (
        <p className="muted small">
          {extension === false ? (
            <>
              Uses the <Link to="/extension">Chrome extension</Link> to search eBay sold listings, then eBay and Vinted listings.
            </>
          ) : (
            "Searches what similar items sold for on eBay, then what they're listed at on eBay and Vinted."
          )}
        </p>
      )}
    </section>
  );
}
