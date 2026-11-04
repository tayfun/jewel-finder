import {
  BOOK_FORMATS,
  BOOK_FORMAT_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  ITEM_STATUSES,
  ITEM_TYPE_LABELS,
  PACKAGE_SIZES,
  PACKAGE_SIZE_HINTS,
  PACKAGE_SIZE_LABELS,
  RARITIES,
  RARITY_LABELS,
  type BookFormat,
  type PackageSize,
  type Rarity,
  parseMoney,
  toDecimal,
  type AutofillSuggestion,
  type Condition,
  type Item,
  type ItemInput,
  type ItemStatus,
} from "@jf/shared";
import { useEffect, useState, type FormEvent } from "react";
import { EMPTY_BOOK, bookOrNull } from "../book";
import { STATUS_LABELS } from "./Badges";
import { Loader } from "./Loader";
import { PhotoUploader } from "./PhotoUploader";

interface FormState {
  title: string;
  description: string;
  brand: string;
  category: string;
  size: string;
  colour: string;
  condition: Condition | "";
  price: string;
  cost: string;
  quantity: string;
  sku: string;
  status: ItemStatus;
  tags: string;
  notes: string;
  images: string[];
  book: BookForm;
  packageSize: PackageSize | "";
  weightGrams: string;
}

/** Book details as form strings. */
interface BookForm {
  author: string;
  isbn: string;
  publisher: string;
  yearPublished: string;
  edition: string;
  printing: string;
  format: BookFormat | "";
  language: string;
  signed: boolean;
  dustJacket: "" | "yes" | "no";
  rarity: Rarity | "";
  rarityNotes: string;
}

function toForm(item?: Partial<Item>): FormState {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    brand: item?.brand ?? "",
    category: item?.category ?? "",
    size: item?.size ?? "",
    colour: item?.colour ?? "",
    condition: item?.condition ?? "",
    price: toDecimal(item?.price ?? null),
    cost: toDecimal(item?.cost ?? null),
    quantity: String(item?.quantity ?? 1),
    sku: item?.sku ?? "",
    status: item?.status ?? "in_stock",
    tags: (item?.tags ?? []).join(", "),
    notes: item?.notes ?? "",
    images: item?.images ?? [],
    book: toBookForm(item?.book ?? EMPTY_BOOK),
    packageSize: item?.packageSize ?? "",
    weightGrams: item?.weightGrams ? String(item.weightGrams) : "",
  };
}

function toBookForm(b: NonNullable<Item["book"]>): BookForm {
  return {
    ...b,
    yearPublished: b.yearPublished ? String(b.yearPublished) : "",
    format: b.format ?? "",
    dustJacket: b.dustJacket == null ? "" : b.dustJacket ? "yes" : "no",
    rarity: b.rarity ?? "",
  };
}

function fromForm(f: FormState): ItemInput | string {
  const price = parseMoney(f.price);
  const cost = parseMoney(f.cost);
  if (Number.isNaN(price)) return "Price must be a number, e.g. 12.50";
  if (Number.isNaN(cost)) return "Cost must be a number, e.g. 4.00";
  const quantity = Number.parseInt(f.quantity, 10);
  if (!Number.isInteger(quantity) || quantity < 0) return "Quantity must be a whole number";
  const year = f.book.yearPublished.trim() ? Number(f.book.yearPublished) : null;
  if (year != null && !(Number.isInteger(year) && year >= 1400 && year <= 2100)) return "Year published must be a year, e.g. 1997";
  const weight = f.weightGrams.trim() ? Number(f.weightGrams) : null;
  if (weight != null && !(Number.isInteger(weight) && weight >= 1 && weight <= 100_000)) return "Weight must be in whole grams, e.g. 450";
  const isbn = f.book.isbn.replace(/[\s-]/g, "").toUpperCase();
  if (isbn && !/^(\d{9}[\dX]|\d{13})$/.test(isbn)) return "ISBN must be 10 or 13 digits";
  return {
    title: f.title,
    description: f.description,
    brand: f.brand,
    category: f.category,
    size: f.size,
    colour: f.colour,
    condition: f.condition || null,
    price,
    cost,
    quantity,
    sku: f.sku,
    status: f.status,
    tags: f.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    notes: f.notes,
    images: f.images,
    book: bookOrNull({
      ...f.book,
      isbn,
      yearPublished: year,
      format: f.book.format || null,
      dustJacket: f.book.dustJacket === "" ? null : f.book.dustJacket === "yes",
      rarity: f.book.rarity || null,
    }),
    packageSize: f.packageSize || null,
    weightGrams: weight,
  };
}

/** Auto-fill from photos, run by the page: still reading, done, or failed. */
export interface AutofillState {
  status: "loading" | "done" | "error";
  suggestion?: AutofillSuggestion;
  error?: string;
  retry(): void;
}

/** Writes an AI suggestion into the empty fields of the form; returns the form and the fields it filled. */
function applySuggestion(f: FormState, s: AutofillSuggestion): [FormState, Set<string>] {
  const filled = new Set<string>();
  const next: FormState = { ...f, book: { ...f.book } };
  const put = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    if (value && !f[key]) {
      next[key] = value;
      filled.add(key);
    }
  };
  put("title", s.title);
  put("description", s.description);
  put("brand", s.brand);
  put("size", s.size);
  put("colour", s.colour);
  put("category", s.category);
  put("condition", s.condition ?? "");
  put("packageSize", s.packageSize ?? "");
  put("weightGrams", s.weightGrams ? String(s.weightGrams) : "");
  put("tags", s.tags.join(", "));
  if (s.itemType === "book") {
    const book = toBookForm(s.book);
    for (const key of Object.keys(book) as (keyof BookForm)[]) {
      const value = book[key];
      if (value && !f.book[key]) {
        (next.book as unknown as Record<string, unknown>)[key] = value;
        filled.add(`book.${key}`);
      }
    }
  }
  return [next, filled];
}

export function ItemForm({
  initial,
  submitLabel,
  onSubmit,
  ai,
}: {
  initial?: Partial<Item>;
  submitLabel: string;
  onSubmit(input: ItemInput): Promise<void>;
  /** Auto-fill from photos for a new item: the form fills in once the suggestion arrives. */
  ai?: AutofillState;
}) {
  const [form, setForm] = useState(() => toForm(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Fields the AI filled, marked until the seller edits them.
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  // Book fields show for books: saved book details, or the AI saying it's a book. Shown by default otherwise.
  const [showBook, setShowBook] = useState(() => (initial?.id ? Boolean(initial.book) : true));

  const suggestion = ai?.suggestion;
  useEffect(() => {
    if (!suggestion) return;
    setForm((f) => {
      const [next, filled] = applySuggestion(f, suggestion);
      setAiFilled(filled);
      return next;
    });
    setShowBook(suggestion.itemType === "book");
  }, [suggestion]);

  const edited = (key: string) =>
    setAiFilled((s) => {
      if (!s.has(key)) return s;
      const next = new Set(s);
      next.delete(key);
      return next;
    });
  /** Label class: marks a field the AI filled in. */
  const mark = (key: string) => (aiFilled.has(key) ? "ai-filled" : undefined);
  const loadingAi = ai?.status === "loading";

  const field = <K extends keyof FormState>(key: K) => ({
    value: form[key] as string,
    onChange: (e: { target: { value: string } }) => {
      edited(key);
      setForm((f) => ({ ...f, [key]: e.target.value }));
    },
  });
  const bookField = <K extends keyof BookForm>(key: K) => ({
    value: form.book[key] as string,
    onChange: (e: { target: { value: string } }) => {
      edited(`book.${key}`);
      setForm((f) => ({ ...f, book: { ...f.book, [key]: e.target.value } }));
    },
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = fromForm(form);
    if (typeof parsed === "string") return setError(parsed);
    // Hidden book fields don't count: it isn't a book.
    const input = showBook ? parsed : { ...parsed, book: null };
    setError(null);
    setSaving(true);
    try {
      await onSubmit(input);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="item-form" onSubmit={submit}>
      <section className="card">
        <h2>Photos</h2>
        <PhotoUploader value={form.images} onChange={(u) => setForm((f) => ({ ...f, images: u(f.images) }))} />
      </section>

      {ai?.status === "loading" && (
        <section className="card ai-status loading" aria-live="polite">
          <Loader label="Reading your photos and filling in the details…" />
          <p className="muted small center">Usually 5–20 seconds. You can start typing in the meantime; the AI only fills empty fields.</p>
        </section>
      )}
      {ai?.status === "error" && (
        <section className="card ai-status error" aria-live="polite">
          <p className="error">Auto-fill didn't work: {ai.error}</p>
          <div className="actions">
            <button type="button" onClick={ai.retry}>
              Try again
            </button>
            <span className="muted small">or fill in the details yourself.</span>
          </div>
        </section>
      )}
      {ai?.status === "done" && suggestion && (
        <section className="card ai-status done" aria-live="polite">
          <div className="ai-summary">
            <span className="ai-badge">✨ Filled in from your photos</span>
            <span className="badge">{ITEM_TYPE_LABELS[suggestion.itemType]}</span>
            <span className="confidence">
              <span>Confidence</span>
              <meter min={0} max={1} low={0.5} high={0.8} optimum={1} value={suggestion.confidence} />
              <strong>{Math.round(suggestion.confidence * 100)}%</strong>
            </span>
          </div>
          <p className="muted small">Fields marked ✨ came from the AI. Check them before saving.</p>
          {suggestion.notes && <p className="notice small">{suggestion.notes}</p>}
        </section>
      )}

      <section className={`card ${loadingAi ? "ai-waiting" : ""}`}>
        <h2>Details</h2>
        <label className={mark("title")}>
          Title
          <input required maxLength={120} placeholder="e.g. Levi's 501 straight jeans W32 L30" {...field("title")} />
        </label>
        <label className={mark("description")}>
          Description
          <textarea rows={6} maxLength={5000} {...field("description")} />
        </label>
        <div className="grid-3">
          <label className={mark("brand")}>
            Brand
            <input maxLength={80} {...field("brand")} />
          </label>
          <label className={mark("category")}>
            Category
            <input maxLength={120} placeholder="e.g. Men › Jeans" {...field("category")} />
          </label>
          <label className={mark("size")}>
            Size
            <input maxLength={40} {...field("size")} />
          </label>
          <label className={mark("colour")}>
            Colour
            <input maxLength={40} {...field("colour")} />
          </label>
          <label className={mark("condition")}>
            Condition
            <select {...field("condition")}>
              <option value="">—</option>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {CONDITION_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className={mark("packageSize")}>
            Package size
            <select {...field("packageSize")}>
              <option value="">—</option>
              {PACKAGE_SIZES.map((p) => (
                <option key={p} value={p}>
                  {PACKAGE_SIZE_LABELS[p]} · {PACKAGE_SIZE_HINTS[p]}
                </option>
              ))}
            </select>
          </label>
          <label className={mark("weightGrams")}>
            Packed weight (g)
            <input inputMode="numeric" maxLength={6} placeholder="e.g. 450" {...field("weightGrams")} />
          </label>
          <label className={mark("tags")}>
            Tags
            <input placeholder="comma, separated" {...field("tags")} />
          </label>
        </div>
      </section>

      {!showBook && (
        <p className="book-toggle muted small">
          Not a book, so the book fields are hidden.{" "}
          <button type="button" className="link" onClick={() => setShowBook(true)}>
            It's a book
          </button>
        </p>
      )}
      {showBook && (
      <section className={`card ${loadingAi ? "ai-waiting" : ""}`}>
        <div className="section-title-row">
          <h2>Book details</h2>
          <button type="button" className="link small" onClick={() => setShowBook(false)}>
            Not a book? Hide these
          </button>
        </div>
        <div className="grid-3">
          <label className={mark("book.author")}>
            Author
            <input maxLength={200} {...bookField("author")} />
          </label>
          <label className={mark("book.isbn")}>
            ISBN
            <input maxLength={20} inputMode="numeric" placeholder="10 or 13 digits" {...bookField("isbn")} />
          </label>
          <label className={mark("book.publisher")}>
            Publisher
            <input maxLength={120} {...bookField("publisher")} />
          </label>
          <label className={mark("book.yearPublished")}>
            Year published
            <input inputMode="numeric" maxLength={4} {...bookField("yearPublished")} />
          </label>
          <label className={mark("book.edition")}>
            Edition
            <input maxLength={120} placeholder="e.g. First edition" {...bookField("edition")} />
          </label>
          <label className={mark("book.printing")}>
            Printing
            <input maxLength={120} placeholder="e.g. First printing" {...bookField("printing")} />
          </label>
          <label className={mark("book.format")}>
            Format
            <select {...bookField("format")}>
              <option value="">—</option>
              {BOOK_FORMATS.map((b) => (
                <option key={b} value={b}>
                  {BOOK_FORMAT_LABELS[b]}
                </option>
              ))}
            </select>
          </label>
          <label className={mark("book.language")}>
            Language
            <input maxLength={40} {...bookField("language")} />
          </label>
          <label className={mark("book.rarity")}>
            Rarity
            <select {...bookField("rarity")}>
              <option value="">—</option>
              {RARITIES.map((r) => (
                <option key={r} value={r}>
                  {RARITY_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <label className={mark("book.dustJacket")}>
            Dust jacket
            <select {...bookField("dustJacket")}>
              <option value="">—</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={form.book.signed}
              onChange={(e) => setForm((f) => ({ ...f, book: { ...f.book, signed: e.target.checked } }))}
            />
            Signed copy
          </label>
        </div>
        <label className={mark("book.rarityNotes")}>
          Rarity notes
          <textarea rows={2} maxLength={1000} placeholder="Points of issue, number line, provenance…" {...bookField("rarityNotes")} />
        </label>
      </section>
      )}

      <section className="card">
        <h2>Stock &amp; pricing</h2>
        <div className="grid-3">
          <label>
            Price
            <input inputMode="decimal" placeholder="0.00" {...field("price")} />
          </label>
          <label>
            Cost (what you paid)
            <input inputMode="decimal" placeholder="0.00" {...field("cost")} />
          </label>
          <label>
            Quantity
            <input type="number" min={0} {...field("quantity")} />
          </label>
          <label>
            SKU
            <input maxLength={64} placeholder="Auto-generated if empty" {...field("sku")} />
          </label>
          <label>
            Status
            <select {...field("status")}>
              {ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Private notes
          <textarea rows={3} maxLength={2000} placeholder="Where it's stored, flaws, sourcing…" {...field("notes")} />
        </label>
      </section>

      {error && <p className="error">{error}</p>}
      <div className="form-actions">
        <button className="primary" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </button>
      </div>
    </form>
  );
}
