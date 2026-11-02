import {
  BOOK_FORMATS,
  BOOK_FORMAT_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  ITEM_STATUSES,
  RARITIES,
  RARITY_LABELS,
  type BookFormat,
  type Rarity,
  parseMoney,
  toDecimal,
  type Condition,
  type Item,
  type ItemInput,
  type ItemStatus,
} from "@jf/shared";
import { useState, type FormEvent } from "react";
import { EMPTY_BOOK, bookOrNull } from "../book";
import { STATUS_LABELS } from "./Badges";
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
  };
}

export function ItemForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Item;
  submitLabel: string;
  onSubmit(input: ItemInput): Promise<void>;
}) {
  const [form, setForm] = useState(() => toForm(initial));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const field = <K extends keyof FormState>(key: K) => ({
    value: form[key] as string,
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value })),
  });
  const bookField = <K extends keyof BookForm>(key: K) => ({
    value: form.book[key] as string,
    onChange: (e: { target: { value: string } }) => setForm((f) => ({ ...f, book: { ...f.book, [key]: e.target.value } })),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const input = fromForm(form);
    if (typeof input === "string") return setError(input);
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

      <section className="card">
        <h2>Details</h2>
        <label>
          Title
          <input required maxLength={120} placeholder="e.g. Levi's 501 straight jeans W32 L30" {...field("title")} />
        </label>
        <label>
          Description
          <textarea rows={6} maxLength={5000} {...field("description")} />
        </label>
        <div className="grid-3">
          <label>
            Brand
            <input maxLength={80} {...field("brand")} />
          </label>
          <label>
            Category
            <input maxLength={120} placeholder="e.g. Men › Jeans" {...field("category")} />
          </label>
          <label>
            Size
            <input maxLength={40} {...field("size")} />
          </label>
          <label>
            Colour
            <input maxLength={40} {...field("colour")} />
          </label>
          <label>
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
          <label>
            Tags
            <input placeholder="comma, separated" {...field("tags")} />
          </label>
        </div>
      </section>

      <section className="card">
        <h2>Book details</h2>
        <p className="muted small form-hint">For books. Leave empty for anything else.</p>
        <div className="grid-3">
          <label>
            Author
            <input maxLength={200} {...bookField("author")} />
          </label>
          <label>
            ISBN
            <input maxLength={20} inputMode="numeric" placeholder="10 or 13 digits" {...bookField("isbn")} />
          </label>
          <label>
            Publisher
            <input maxLength={120} {...bookField("publisher")} />
          </label>
          <label>
            Year published
            <input inputMode="numeric" maxLength={4} {...bookField("yearPublished")} />
          </label>
          <label>
            Edition
            <input maxLength={120} placeholder="e.g. First edition" {...bookField("edition")} />
          </label>
          <label>
            Printing
            <input maxLength={120} placeholder="e.g. First printing" {...bookField("printing")} />
          </label>
          <label>
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
          <label>
            Language
            <input maxLength={40} {...bookField("language")} />
          </label>
          <label>
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
          <label>
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
        <label>
          Rarity notes
          <textarea rows={2} maxLength={1000} placeholder="Points of issue, number line, provenance…" {...bookField("rarityNotes")} />
        </label>
      </section>

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
