import {
  CONDITION_LABELS,
  type AutofillSuggestion,
  type BookDetails,
  type ItemWithListings,
} from "@jf/shared";
import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { BOOK_FIELDS, EMPTY_BOOK, bookOrNull } from "../book";

type ItemKey = "title" | "description" | "condition" | "category" | "tags";

interface Row {
  id: string;
  label: string;
  current: string;
  suggested: string;
  /** Writes the suggested value into the patch being built. */
  apply(patch: { item: Partial<ItemWithListings>; book: BookDetails }): void;
}

function buildRows(item: ItemWithListings, s: AutofillSuggestion): Row[] {
  const mergedTags = [...new Set([...item.tags, ...s.tags])];
  const top: { key: ItemKey; label: string; current: string; suggested: string; value: unknown }[] = [
    { key: "title", label: "Title", current: item.title, suggested: s.title, value: s.title },
    { key: "description", label: "Description", current: item.description, suggested: s.description, value: s.description },
    {
      key: "condition",
      label: "Condition",
      current: item.condition ? CONDITION_LABELS[item.condition] : "",
      suggested: s.condition ? CONDITION_LABELS[s.condition] : "",
      value: s.condition,
    },
    { key: "category", label: "Category", current: item.category, suggested: s.category, value: s.category },
    { key: "tags", label: "Tags", current: item.tags.join(", "), suggested: mergedTags.join(", "), value: mergedTags },
  ];
  const current = item.book ?? EMPTY_BOOK;
  return [
    ...top.map((t) => ({
      id: t.key,
      label: t.label,
      current: t.current,
      suggested: t.suggested,
      apply: (p: { item: Partial<ItemWithListings> }) => Object.assign(p.item, { [t.key]: t.value }),
    })),
    ...BOOK_FIELDS.map((f) => ({
      id: `book.${f.key}`,
      label: f.label,
      current: f.show(current),
      suggested: f.show(s.book),
      apply: (p: { book: BookDetails }) => Object.assign(p.book, { [f.key]: s.book[f.key] }),
    })),
  ].filter((r) => r.suggested && r.suggested !== r.current);
}

/** "Auto-fill from photos": asks the API for an AI suggestion and lets the user pick what to apply. */
export function Autofill({
  item,
  onApplied,
  onClose,
}: {
  item: ItemWithListings;
  onApplied(item: ItemWithListings): void;
  onClose(): void;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "loading" }
    | { kind: "review"; suggestion: AutofillSuggestion; rows: Row[]; selected: Set<string> }
    | { kind: "error"; message: string }
  >({ kind: "idle" });
  const [saving, setSaving] = useState(false);

  async function run() {
    setState({ kind: "loading" });
    try {
      const { suggestion } = await api<{ suggestion: AutofillSuggestion }>(`/api/items/${item.id}/autofill`, { json: {} });
      const rows = buildRows(item, suggestion);
      setState({ kind: "review", suggestion, rows, selected: new Set(rows.map((r) => r.id)) });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }

  async function apply() {
    if (state.kind !== "review") return;
    const patch = { item: {} as Partial<ItemWithListings>, book: { ...(item.book ?? EMPTY_BOOK) } };
    for (const row of state.rows) if (state.selected.has(row.id)) row.apply(patch);
    setSaving(true);
    try {
      const updated = await api<ItemWithListings>(`/api/items/${item.id}`, {
        method: "PATCH",
        json: { ...patch.item, book: bookOrNull(patch.book) },
      });
      onApplied(updated);
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  // Start straight away; the panel is only mounted when the user asked for it.
  // The ref stops StrictMode's double effect run from paying for two AI calls.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  });

  return (
    <section className="card autofill">
      <div className="autofill-head">
        <h2>✨ Auto-fill from photos</h2>
        <button className="link" onClick={onClose}>
          Close
        </button>
      </div>

      {(state.kind === "idle" || state.kind === "loading") && (
        <p className="muted">
          <span className="spinner" /> Reading your photos and identifying the book… this usually takes 5–20 seconds.
        </p>
      )}

      {state.kind === "error" && (
        <>
          <p className="error">{state.message}</p>
          <button onClick={run}>Try again</button>
        </>
      )}

      {state.kind === "review" && (
        <>
          <div className="confidence">
            <span>Confidence</span>
            <meter min={0} max={1} low={0.5} high={0.8} optimum={1} value={state.suggestion.confidence} />
            <strong>{Math.round(state.suggestion.confidence * 100)}%</strong>
          </div>
          {state.suggestion.notes && <p className="notice small">{state.suggestion.notes}</p>}

          {state.rows.length === 0 ? (
            <p className="muted">Nothing new to add — the item already matches what the AI found.</p>
          ) : (
            <>
              <p className="muted small">Check each suggestion before applying. Untick anything that looks wrong.</p>
              <table className="autofill-table">
                <thead>
                  <tr>
                    <th />
                    <th>Field</th>
                    <th>Now</th>
                    <th>Suggested</th>
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((row) => (
                    <tr key={row.id} className={state.selected.has(row.id) ? "" : "off"}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Use suggested ${row.label}`}
                          checked={state.selected.has(row.id)}
                          onChange={(e) => {
                            const selected = new Set(state.selected);
                            if (e.target.checked) selected.add(row.id);
                            else selected.delete(row.id);
                            setState({ ...state, selected });
                          }}
                        />
                      </td>
                      <th scope="row">{row.label}</th>
                      <td className="muted prewrap">{row.current || "—"}</td>
                      <td className="prewrap">{row.suggested}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="form-actions">
            <button onClick={onClose}>Discard</button>
            {state.rows.length > 0 && (
              <button className="primary" disabled={saving || state.selected.size === 0} onClick={apply}>
                {saving ? "Saving…" : `Apply ${state.selected.size} change${state.selected.size === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}
