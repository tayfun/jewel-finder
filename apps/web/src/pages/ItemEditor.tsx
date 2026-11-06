import type { AutofillSuggestion, ItemInput, ItemWithListings } from "@jf/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { ItemForm, type AutofillState } from "../components/ItemForm";
import { PhotoWizard } from "../components/PhotoWizard";
import { PriceStep } from "../components/PriceStep";
import { useLoad } from "../hooks";
import { Loader } from "../components/Loader";

const STEPS = [
  { key: "photos", label: "Photos", hint: "Add a few photos; the AI reads them." },
  { key: "details", label: "Details", hint: "Check what the AI filled in." },
  { key: "price", label: "Price", hint: "We check what it sells for and suggest a price." },
] as const;
type Step = (typeof STEPS)[number]["key"];

/**
 * Adding an item, in three quick steps: photos (a guided shot list), details (filled in from the photos by
 * the AI while the seller watches), then price. Leaving details saves the item, so the extension can look up
 * comparables for it straight away and suggest a price. Skipping photos goes straight to an empty form.
 */
export function NewItem() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("photos");
  const [images, setImages] = useState<string[]>([]);
  const [ai, setAi] = useState<Omit<AutofillState, "retry"> | null>(null);
  // Saved when leaving details; going back edits it rather than adding another.
  const [item, setItem] = useState<ItemWithListings | null>(null);
  const saved = useRef("");
  // Bumped per auto-fill run, so a slow earlier run can't overwrite a newer one.
  const run = useRef(0);

  async function autofill(keys = images) {
    const mine = ++run.current;
    setStep("details");
    setAi({ status: "loading" });
    try {
      const { suggestion } = await api<{ suggestion: AutofillSuggestion }>("/api/autofill", { json: { images: keys } });
      if (mine === run.current) setAi({ status: "done", suggestion });
    } catch (e) {
      if (mine === run.current) setAi({ status: "error", error: (e as Error).message });
    }
  }

  async function saveDetails(input: ItemInput) {
    if (!item) {
      const created = await api<ItemWithListings>("/api/items", { json: input });
      setItem(created);
      // As the form will show it next time: the server fills in an empty SKU.
      saved.current = JSON.stringify({ ...input, sku: created.sku });
    } else if (JSON.stringify(input) !== saved.current) {
      // Only when changed: an untouched item keeps its updatedAt, so the price step reuses its comparables.
      setItem(await api<ItemWithListings>(`/api/items/${item.id}`, { method: "PATCH", json: input }));
      saved.current = JSON.stringify(input);
    }
    run.current++;
    setStep("price");
  }

  // Each step starts at its top, not wherever the last one was scrolled to.
  // (Braces matter: newer browsers' scrollTo returns a Promise, which React would take for a clean-up function.)
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);

  const at = STEPS.findIndex((s) => s.key === step);
  // Once saved, the photos live on the item (edit them in details), so details has no way back.
  const back = at > 0 && !(step === "details" && item) ? STEPS[at - 1]! : null;
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add item</h1>
          <p className="muted small step-count">
            Step {at + 1} of {STEPS.length} · {STEPS[at]!.hint}
          </p>
          <ol className="stepper" aria-label="Steps">
            {STEPS.map((s, i) => (
              <li key={s.key} className={i === at ? "on" : i < at ? "done" : ""} aria-current={i === at ? "step" : undefined}>
                <span>{i < at ? "✓" : i + 1}</span> {s.label}
                {s.key === "details" && ai ? " (auto-filled)" : ""}
              </li>
            ))}
          </ol>
        </div>
        {back && (
          <button
            className="link"
            onClick={() => {
              if (back.key === "photos") {
                run.current++;
                setAi(null);
              }
              setStep(back.key);
            }}
          >
            ← Back to {back.label.toLowerCase()}
          </button>
        )}
      </div>
      {step === "photos" && (
        <PhotoWizard
          images={images}
          onChange={(update) => setImages(update)}
          onAutofill={() => void autofill()}
          onSkip={() => setStep("details")}
        />
      )}
      {step === "details" && (
        <ItemForm
          key={item?.id ?? "new"}
          initial={item ?? { images }}
          submitLabel="Next: price →"
          hidePrice
          compactPhotos
          // Once saved, the form starts from the item: don't fill it in again.
          ai={ai && !item ? { ...ai, retry: () => void autofill() } : undefined}
          onSubmit={saveDetails}
        />
      )}
      {step === "price" && item && <PriceStep item={item} onDone={(done) => navigate(`/items/${done.id}`)} />}
    </>
  );
}

export function EditItem() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: item, error } = useLoad(() => api<ItemWithListings>(`/api/items/${id}`), [id]);
  if (error) return <p className="error">{error.message}</p>;
  if (!item) return <Loader label="Loading item…" />;
  return (
    <>
      <div className="page-head">
        <h1>Edit item</h1>
        <Link to={`/items/${id}`}>Cancel</Link>
      </div>
      <ItemForm
        initial={item}
        submitLabel="Save changes"
        onSubmit={async (input) => {
          await api(`/api/items/${id}`, { method: "PATCH", json: input });
          navigate(`/items/${id}`);
        }}
      />
    </>
  );
}
