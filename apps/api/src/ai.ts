import { GoogleGenAI } from "@google/genai";
import * as Sentry from "@sentry/cloudflare";
import {
  BOOK_FORMATS,
  BookDetails,
  CONDITIONS,
  Condition,
  RARITIES,
  isValidIsbn,
  type AutofillSuggestion,
  type Item,
} from "@jf/shared";
import { z } from "zod";

/** Gemini accepts ~20 MB of inline data per request; stay well under it. */
const MAX_IMAGE_BYTES_TOTAL = 15 * 1024 * 1024;
const MAX_IMAGES = 8;

export interface ImageInput {
  mimeType: string;
  bytes: Uint8Array;
}

const SYSTEM_INSTRUCTION = `You are an expert antiquarian and second-hand bookseller who writes listings for eBay and Vinted.
You are given photos of one book (typically cover, spine, title page, copyright page, and any flaws).

Identify the book and edition as precisely as the photos allow:
- Read the copyright page: edition statements, printing/number lines ("10 9 8 7 6 5 4 3 2 1"), impression notes, publisher, year.
- Only give an ISBN that is printed and legible in a photo, or that you are certain belongs to this exact edition. Otherwise return an empty string. Never invent one.
- Only state "First edition" / "First printing" when the photos show evidence for it; explain the evidence in rarityNotes.
- Rarity is about how hard this specific edition and copy is to find (first editions, signed copies, limited runs, early printings of famous titles are scarcer).
- Grade condition from what you can see: dust jacket, spine, corners, foxing, tears, writing, stickers.

Write the listing:
- title: at most 80 characters, keyword-rich for marketplace search, e.g. "Harry Potter and the Philosopher's Stone J.K. Rowling 1st Edition 1997 Hardback".
- description: honest, plain text, a few short paragraphs: what it is, edition/printing details, condition and any flaws seen. No emojis, no made-up claims.
- Use empty strings, null or false when something is unknown. Say what you couldn't verify in notes.`;

const str = (description: string) => ({ type: "string", description });
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

/** JSON Schema sent to Gemini as responseJsonSchema. Mirrors AutofillSuggestion. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    title: str("Marketplace listing title, at most 80 characters."),
    description: str("Listing description in plain text."),
    condition: nullable({ type: "string", enum: [...CONDITIONS], description: "Overall condition grade." }),
    category: str('Marketplace category path, e.g. "Books > Fiction > Fantasy".'),
    tags: { type: "array", items: { type: "string" }, maxItems: 10, description: "Search keywords." },
    book: {
      type: "object",
      properties: {
        author: str("Author(s), as printed."),
        isbn: str("ISBN-10 or ISBN-13 digits only, or empty if not visible/certain."),
        publisher: str("Publisher name."),
        yearPublished: nullable({ type: "integer", description: "Year this edition/printing was published." }),
        edition: str('Edition statement, e.g. "First edition", "Second edition", "Book club edition".'),
        printing: str('Printing/impression, e.g. "First printing", "12th impression".'),
        format: nullable({ type: "string", enum: [...BOOK_FORMATS] }),
        language: str("Language of the text."),
        signed: { type: "boolean", description: "True only if a signature is visible." },
        dustJacket: nullable({ type: "boolean", description: "Whether a dust jacket is present (hardbacks)." }),
        rarity: nullable({ type: "string", enum: [...RARITIES] }),
        rarityNotes: str("Evidence for edition/printing and why it is or isn't collectable."),
      },
      required: [
        "author",
        "isbn",
        "publisher",
        "yearPublished",
        "edition",
        "printing",
        "format",
        "language",
        "signed",
        "dustJacket",
        "rarity",
        "rarityNotes",
      ],
    },
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence in the identification, 0-1." },
    notes: str("What could not be verified from the photos, if anything."),
  },
  required: ["title", "description", "condition", "category", "tags", "book", "confidence", "notes"],
} as const;

/** Lenient parse of the model's JSON: schema-shaped, but never trust it blindly. */
const ModelOutput = z.object({
  title: z.string(),
  description: z.string(),
  condition: Condition.nullable().catch(null),
  category: z.string().catch(""),
  tags: z.array(z.string()).catch([]),
  book: z.record(z.string(), z.unknown()).catch({}),
  confidence: z.number().catch(0),
  notes: z.string().catch(""),
});

export class AutofillError extends Error {}

/** Turns a Gemini SDK error into something a seller can act on. */
export function describeGeminiError(e: unknown): string {
  const status = (e as { status?: number }).status;
  if (status === 429 || status === 503) return "Gemini is busy right now. Please try again in a minute.";
  if (status === 400 || status === 403) return `Gemini rejected the request (${status}). Check GEMINI_API_KEY and GEMINI_MODEL.`;
  return `The AI request failed: ${(e as Error).message}`;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Turns raw model JSON into a validated suggestion, dropping anything that doesn't check out. */
export function normaliseSuggestion(raw: unknown): AutofillSuggestion {
  const out = ModelOutput.safeParse(raw);
  if (!out.success) throw new AutofillError("The AI returned an unexpected response. Try again.");
  const notes = [out.data.notes.trim()];

  const rawBook = out.data.book;
  // Validate field by field so one bad value doesn't throw away the rest.
  const book = BookDetails.parse({});
  for (const key of Object.keys(book) as (keyof BookDetails)[]) {
    const field = BookDetails.shape[key].safeParse(rawBook[key]);
    if (field.success) (book as Record<string, unknown>)[key] = field.data;
  }
  if (book.isbn && !isValidIsbn(book.isbn)) {
    notes.push(`Discarded ISBN ${book.isbn}: its check digit is invalid.`);
    book.isbn = "";
  }

  return {
    title: out.data.title.trim().slice(0, 80),
    description: out.data.description.trim().slice(0, 5000),
    condition: out.data.condition,
    category: out.data.category.trim().slice(0, 120),
    tags: [...new Set(out.data.tags.map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 40)),
    book,
    confidence: Math.min(1, Math.max(0, out.data.confidence)),
    notes: notes.filter(Boolean).join(" "),
  };
}

/** Asks Gemini to identify the book in the photos and draft listing data for it. */
export async function suggestListing(
  env: Pick<Env, "GEMINI_API_KEY" | "GEMINI_MODEL">,
  images: ImageInput[],
  item: Pick<Item, "title" | "description" | "notes">,
): Promise<AutofillSuggestion> {
  if (!env.GEMINI_API_KEY) throw new AutofillError("AI auto-fill isn't configured (GEMINI_API_KEY is not set).");

  const parts: { inlineData?: { mimeType: string; data: string }; text?: string }[] = [];
  let total = 0;
  for (const img of images.slice(0, MAX_IMAGES)) {
    if (total + img.bytes.byteLength > MAX_IMAGE_BYTES_TOTAL) break;
    total += img.bytes.byteLength;
    parts.push({ inlineData: { mimeType: img.mimeType, data: toBase64(img.bytes) } });
  }
  if (!parts.length) throw new AutofillError("Add at least one photo first.");

  const known = [
    item.title && `Seller's current title: ${item.title}`,
    item.description && `Seller's current description: ${item.description}`,
    item.notes && `Seller's private notes: ${item.notes}`,
  ].filter(Boolean);
  parts.push({
    text: `Identify this book and draft its listing.${known.length ? `\n\nWhat the seller already wrote (may be incomplete or wrong; prefer the photos):\n${known.join("\n")}` : ""}`,
  });

  // Spans with model, latency and token usage; never the photos or prompt text.
  const client = new GoogleGenAI({
    apiKey: env.GEMINI_API_KEY,
    httpOptions: {
      timeout: 45_000,
      // Overload (503) and rate limits (429) are often brief: retry once after ~1.5s. More than that
      // keeps the seller waiting over a minute when Gemini is genuinely overloaded.
      retryOptions: { attempts: 2, initialDelay: 1.5, maxDelay: 3, httpStatusCodes: [429, 500, 503, 504] },
    },
  });
  const ai = Sentry.instrumentGoogleGenAIClient(client, {
    recordInputs: false,
    recordOutputs: false,
  });
  let text: string | undefined;
  try {
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [{ role: "user", parts }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseJsonSchema: RESPONSE_SCHEMA,
        temperature: 0.2,
      },
    });
    text = res.text;
  } catch (e) {
    console.error("Gemini request failed", e);
    throw new AutofillError(describeGeminiError(e));
  }
  if (!text) throw new AutofillError("The AI didn't return anything. Try again, or add clearer photos.");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AutofillError("The AI returned an unexpected response. Try again.");
  }
  return normaliseSuggestion(raw);
}
