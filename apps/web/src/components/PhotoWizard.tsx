import { useState } from "react";
import { PhotoUploader } from "./PhotoUploader";

// Step 1 of adding an item: photos first, with a shot list, then auto-fill from them.

/** Photos Gemini reads for auto-fill (the API's limit); more can be added for the listing itself. */
const AI_READS = 8;

const SHOTS: { icon: string; title: string; hint: string }[] = [
  { icon: "📸", title: "Front or cover", hint: "The whole item, straight on, in good light. This becomes the main photo." },
  { icon: "🔄", title: "Back", hint: "The back or reverse. For books, the back cover and blurb." },
  { icon: "🏷️", title: "Labels & tags", hint: "Brand, size and care labels. For electronics, the model or serial plate." },
  { icon: "📖", title: "Edition details (books)", hint: "Title page and copyright page: edition, printing number line, publisher, year." },
  { icon: "▥", title: "Barcode or ISBN", hint: "Helps pin down the exact edition or model." },
  { icon: "🔍", title: "Close-ups & flaws", hint: "Wear, marks, chips or missing parts, so the condition is spot on." },
];

function quality(n: number): { level: number; text: string } {
  if (n === 0) return { level: 0, text: "Add your first photo to get started." };
  if (n <= 2) return { level: 1, text: "Good start. Add labels and detail shots for a better match." };
  if (n <= 4) return { level: 2, text: "Nice. The AI has plenty to work with." };
  return { level: 3, text: "Great. Expect detailed, accurate results." };
}

export function PhotoWizard({
  images,
  onChange,
  onAutofill,
  onSkip,
}: {
  images: string[];
  onChange(update: (keys: string[]) => string[]): void;
  onAutofill(): void;
  onSkip(): void;
}) {
  const [uploading, setUploading] = useState(0);
  const q = quality(images.length);
  const ready = images.length > 0 && uploading === 0;
  return (
    <div className="wizard">
      <section className="card wizard-intro">
        <div>
          <h2>Start with photos, we’ll fill in the rest</h2>
          <p className="muted">
            Add photos of the item and the AI drafts the title, description, brand, condition, category and, for books,
            the edition details. <strong>More photos means better auto-filled details:</strong> it reads up to {AI_READS}, and
            you can add up to 20 for your listing.
          </p>
        </div>
        <ul className="shot-list">
          {SHOTS.map((s) => (
            <li key={s.title}>
              <span className="shot-icon" aria-hidden="true">
                {s.icon}
              </span>
              <span>
                <strong>{s.title}</strong>
                <span className="muted small">{s.hint}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="wizard-photos-head">
          <h2>Your photos</h2>
          <span className="muted small">
            {images.length} added{images.length > AI_READS ? ` · the first ${AI_READS} are read by the AI` : ""}
          </span>
        </div>
        <PhotoUploader value={images} onChange={onChange} onBusyChange={setUploading} />
        <div className={`photo-meter level-${q.level}`} aria-live="polite">
          <div className="meter-bars" aria-hidden="true">
            {[1, 2, 3].map((l) => (
              <span key={l} className={q.level >= l ? "on" : ""} />
            ))}
          </div>
          <span>{q.text}</span>
        </div>
      </section>

      <div className="wizard-actions">
        <button className="link" onClick={onSkip}>
          Skip, I’ll fill it in myself
        </button>
        <button className="primary big cta" disabled={!ready} onClick={onAutofill}>
          ✨ {uploading ? "Uploading photos…" : images.length ? `Auto-fill from ${images.length} photo${images.length === 1 ? "" : "s"}` : "Auto-fill from photos"}
        </button>
      </div>
    </div>
  );
}
