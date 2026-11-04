import type { AutofillSuggestion, ItemWithListings } from "@jf/shared";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api } from "../api";
import { ItemForm, type AutofillState } from "../components/ItemForm";
import { PhotoWizard } from "../components/PhotoWizard";
import { useLoad } from "../hooks";
import { Loader } from "../components/Loader";

/**
 * Adding an item: photos first (a guided shot list), then the form, filled in from the photos by the AI
 * while the seller watches. Skipping goes straight to an empty form.
 */
export function NewItem() {
  const navigate = useNavigate();
  const [step, setStep] = useState<"photos" | "details">("photos");
  const [images, setImages] = useState<string[]>([]);
  const [ai, setAi] = useState<Omit<AutofillState, "retry"> | null>(null);
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

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Add item</h1>
          <ol className="stepper" aria-label="Steps">
            <li className={step === "photos" ? "on" : "done"}>
              <span>1</span> Photos
            </li>
            <li className={step === "details" ? "on" : ""}>
              <span>2</span> Details{ai ? " (auto-filled)" : ""}
            </li>
            <li>
              <span>3</span> Save
            </li>
          </ol>
        </div>
        {step === "details" && (
          <button
            className="link"
            onClick={() => {
              run.current++;
              setAi(null);
              setStep("photos");
            }}
          >
            ← Back to photos
          </button>
        )}
      </div>
      {step === "photos" ? (
        <PhotoWizard
          images={images}
          onChange={(update) => setImages(update)}
          onAutofill={() => void autofill()}
          onSkip={() => setStep("details")}
        />
      ) : (
        <ItemForm
          initial={{ images }}
          submitLabel="Save item"
          ai={ai ? { ...ai, retry: () => void autofill() } : undefined}
          onSubmit={async (input) => {
            const item = await api<ItemWithListings>("/api/items", { json: input });
            navigate(`/items/${item.id}`);
          }}
        />
      )}
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
