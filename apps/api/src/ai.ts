import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import * as Sentry from "@sentry/cloudflare";
import {
  BOOK_FORMATS,
  BookDetails,
  COMP_JUDGEMENTS,
  COMP_SOURCE_LABELS,
  CONDITIONS,
  CONDITION_LABELS,
  Condition,
  PACKAGE_SIZES,
  PackageSize,
  RARITIES,
  aiReviewBasis,
  formatMoney,
  isValidIsbn,
  specialFeatures,
  type AiJudgement,
  type AiReview,
  type AutofillSuggestion,
  type Comp,
  type Item,
  type Settings,
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

Estimate postage for UK sellers, for the item once wrapped and packed:
- weightGrams: the packed weight. Judge the item's size and page count from the photos; a typical paperback novel is 200-350 g, a hardback 500-900 g, a large illustrated book 1-2 kg. Add about 50 g for packaging.
- packageSize: "large_letter" only if it packs to at most 35 x 25 x 2.5 cm and 1 kg (thin paperbacks); "small" up to 45 x 35 x 16 cm and 2 kg (most books); "medium" up to 61 x 46 x 46 cm; "large" for anything bigger.

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
    packageSize: nullable({ type: "string", enum: [...PACKAGE_SIZES], description: "Postage size once packed." }),
    weightGrams: nullable({ type: "integer", description: "Estimated packed weight in grams, including packaging." }),
    confidence: { type: "number", minimum: 0, maximum: 1, description: "Confidence in the identification, 0-1." },
    notes: str("What could not be verified from the photos, if anything."),
  },
  required: ["title", "description", "condition", "category", "tags", "book", "packageSize", "weightGrams", "confidence", "notes"],
} as const;

/** Lenient parse of the model's JSON: schema-shaped, but never trust it blindly. */
const ModelOutput = z.object({
  title: z.string(),
  description: z.string(),
  condition: Condition.nullable().catch(null),
  category: z.string().catch(""),
  tags: z.array(z.string()).catch([]),
  book: z.record(z.string(), z.unknown()).catch({}),
  packageSize: PackageSize.nullable().catch(null),
  weightGrams: z.number().int().min(1).max(100_000).nullable().catch(null),
  confidence: z.number().catch(0),
  notes: z.string().catch(""),
});

/** A Gemini request that failed, with a message for the seller. */
export class AiError extends Error {}

type GeminiEnv = Pick<Env, "GEMINI_API_KEY" | "GEMINI_MODEL" | "GEMINI_FALLBACK_MODEL">;
type Part = { inlineData?: { mimeType: string; data: string }; text?: string };

/** HTTP status of a Gemini SDK error; a client-side timeout (aborted fetch, no status) counts as 504. */
function geminiStatus(e: unknown): number | undefined {
  const err = e as { status?: number; name?: string; message?: string };
  if (err.status) return err.status;
  if (err.name === "AbortError" || err.name === "TimeoutError" || /aborted|timed? ?out/i.test(err.message ?? "")) return 504;
  return undefined;
}

/** Turns a Gemini SDK error into something a seller can act on. */
export function describeGeminiError(e: unknown, slow = "Gemini took too long on these photos. Please try again, or remove a few photos."): string {
  const status = geminiStatus(e);
  if (status === 429 || status === 503) return "Gemini is busy right now. Please try again in a minute.";
  if (status === 504) return slow;
  if (status === 400 || status === 403) return `Gemini rejected the request (${status}). Check GEMINI_API_KEY and GEMINI_MODEL.`;
  return `The AI request failed: ${(e as Error).message}`;
}

/** Inline image parts, in order, up to a count and a total size. */
function imageParts(images: ImageInput[], max: number, maxBytes: number): Part[] {
  const parts: Part[] = [];
  let total = 0;
  for (const img of images.slice(0, max)) {
    if (total + img.bytes.byteLength > maxBytes) break;
    total += img.bytes.byteLength;
    parts.push({ inlineData: { mimeType: img.mimeType, data: toBase64(img.bytes) } });
  }
  return parts;
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
  if (!out.success) throw new AiError("The AI returned an unexpected response. Try again.");
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
    packageSize: out.data.packageSize,
    weightGrams: out.data.weightGrams,
    confidence: Math.min(1, Math.max(0, out.data.confidence)),
    notes: notes.filter(Boolean).join(" "),
  };
}

/** Asks Gemini to identify the book in the photos and draft listing data for it. */
export async function suggestListing(
  env: GeminiEnv,
  images: ImageInput[],
  item: Pick<Item, "title" | "description" | "notes">,
): Promise<AutofillSuggestion> {
  if (!env.GEMINI_API_KEY) throw new AiError("AI auto-fill isn't configured (GEMINI_API_KEY is not set).");

  const parts = imageParts(images, MAX_IMAGES, MAX_IMAGE_BYTES_TOTAL);
  if (!parts.length) throw new AiError("Add at least one photo first.");

  const known = [
    item.title && `Seller's current title: ${item.title}`,
    item.description && `Seller's current description: ${item.description}`,
    item.notes && `Seller's private notes: ${item.notes}`,
  ].filter(Boolean);
  parts.push({
    text: `Identify this book and draft its listing.${known.length ? `\n\nWhat the seller already wrote (may be incomplete or wrong; prefer the photos):\n${known.join("\n")}` : ""}`,
  });

  return normaliseSuggestion(
    await generateJson(env, parts, {
      systemInstruction: SYSTEM_INSTRUCTION,
      schema: RESPONSE_SCHEMA,
      empty: "The AI didn't return anything. Try again, or add clearer photos.",
    }),
  );
}

/**
 * One structured-output Gemini request: the JSON it returned, unvalidated. Falls back from the newest
 * model to an older one when the newest is overloaded or too slow.
 */
async function generateJson(
  env: GeminiEnv,
  parts: Part[],
  opts: { systemInstruction: string; schema: object; empty: string; slow?: string },
): Promise<unknown> {
  // Spans with model, latency and token usage; never the photos or prompt text.
  const ai = Sentry.instrumentGoogleGenAIClient(new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }), {
    recordInputs: false,
    recordOutputs: false,
  });
  // The newest model is often swamped: it then queues requests until the deadline (504) or refuses
  // them (503/429). Give it a bounded slot and fall back to an older, less busy model.
  const models = [...new Set([env.GEMINI_MODEL, env.GEMINI_FALLBACK_MODEL].filter(Boolean))];
  let text: string | undefined;
  for (const [i, model] of models.entries()) {
    const last = i === models.length - 1;
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: opts.systemInstruction,
          responseMimeType: "application/json",
          responseJsonSchema: opts.schema,
          temperature: 0.2,
          // Reading a copyright page or a list of titles doesn't need deep reasoning, and default
          // thinking is most of the latency.
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          httpOptions: {
            // The SDK also sends this as X-Server-Timeout, so it is Gemini's own deadline: past it
            // Gemini answers 504 DEADLINE_EXCEEDED.
            timeout: last ? 60_000 : 30_000,
            // Brief overloads often clear within seconds; retry once on the model we end up with.
            // Never 504: a request that ran out of time would just keep the seller waiting again.
            retryOptions: last
              ? { attempts: 2, initialDelay: 1.5, maxDelay: 3, httpStatusCodes: [429, 500, 503] }
              : { attempts: 1 },
          },
        },
      });
      text = res.text;
      break;
    } catch (e) {
      const status = geminiStatus(e);
      // Workers logs keep only the stack of an Error argument, so log the status and body explicitly.
      console.error("Gemini request failed", { model, status, message: (e as Error).message });
      if (last || !(status === 429 || status === 503 || status === 504)) throw new AiError(describeGeminiError(e, opts.slow));
    }
  }
  if (!text) throw new AiError(opts.empty);

  try {
    return JSON.parse(text);
  } catch {
    throw new AiError("The AI returned an unexpected response. Try again.");
  }
}


// ------------------------------------------------------------ comp review

const REVIEW_INSTRUCTION = `You are an expert reseller of books, clothes and collectables on eBay and Vinted, helping a seller price one item.
You are given the seller's item and a numbered list of comparable listings ("comps") found by searching eBay and Vinted: their titles, prices and where they were found.

For each comp, judge whether it is a fair comparison for pricing the seller's item:
- "same": the same item, like for like. For books: the same work in the same format, and the same edition when the seller's copy is a collectable edition. For clothes and other goods: the same brand and model or line.
- "lesser": the same work or product, but missing something that makes the seller's copy worth more. E.g. the seller has a first edition and the comp is a later printing, book club edition, facsimile or reprint; the seller's copy is signed and the comp isn't; the comp has no dust jacket when the seller's has one.
- "greater": the same work or product, with something valuable the seller's copy lacks: signed, a first edition when the seller's isn't, a limited or numbered edition, new with tags when the seller's is worn.
- "different": not the same item: another title or volume, another model, an accessory, an empty box, a lot or bundle, a study guide or adaptation, "inspired by" or replica goods.

Rules:
- Judge only from what is given. When a title doesn't say enough to tell, answer "same": the price rules make their own checks. Use "lesser", "greater" or "different" only when the title, condition or price gives you a reason.
- A price far below what a valuable edition sells for suggests a reprint or facsimile, not the real thing.
- reason: at most 8 words, for the seller, e.g. "Book club edition", "Later printing (1951)", "Different volume", "Signed by the author".
- Answer for every comp, using its number.

note: only when the seller's item has collectable features (listed under "Collectable features"), write 2-4 short sentences for the seller: what makes this edition valuable (points of issue, first-state jacket, price-clipping, number lines), and what to check on their copy before pricing it high. Never state prices or values. When the item has no collectable features, return an empty string.`;

export const REVIEW_SCHEMA = {
  type: "object",
  properties: {
    comps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer", description: "The comp's number." },
          judgement: { type: "string", enum: [...COMP_JUDGEMENTS] },
          reason: str("At most 8 words on why."),
        },
        required: ["n", "judgement", "reason"],
      },
    },
    note: str("For collectable items: what drives the value and what to check. Otherwise empty."),
  },
  required: ["comps", "note"],
} as const;

const ReviewOutput = z.object({
  comps: z.array(z.unknown()).catch([]),
  note: z.string().catch(""),
});
const ReviewEntry = z.object({
  n: z.number().int(),
  judgement: z.enum(COMP_JUDGEMENTS),
  reason: z.string().catch(""),
});

/** Item photos sent with a review: enough to see the edition, small enough to stay quick. */
const REVIEW_IMAGES = 2;
const REVIEW_IMAGE_BYTES = 6 * 1024 * 1024;

type ReviewedItem = Pick<Item, "title" | "description" | "tags" | "book" | "condition" | "brand" | "size">;

/** The item and comps as the model sees them. Comps are numbered from 1, in the order given. */
export function reviewPrompt(item: ReviewedItem, comps: Comp[], currency: Settings["currency"] = "GBP"): string {
  const b = item.book;
  const features = specialFeatures(item);
  const lines = [
    `Title: ${item.title}`,
    item.brand && `Brand: ${item.brand}`,
    item.size && `Size: ${item.size}`,
    item.condition && `Condition: ${CONDITION_LABELS[item.condition]}`,
    b?.author && `Author: ${b.author}`,
    b?.isbn && `ISBN: ${b.isbn}`,
    b?.publisher && `Publisher: ${b.publisher}`,
    b?.yearPublished && `Year: ${b.yearPublished}`,
    b?.edition && `Edition: ${b.edition}`,
    b?.printing && `Printing: ${b.printing}`,
    b?.format && `Format: ${b.format.replace(/_/g, " ")}`,
    b?.signed && "Signed: yes",
    b && b.dustJacket != null && `Dust jacket: ${b.dustJacket ? "yes" : "no"}`,
    b?.rarityNotes && `Edition notes: ${b.rarityNotes.slice(0, 400)}`,
    item.description && `Description: ${item.description.replace(/\s+/g, " ").slice(0, 600)}`,
    `Collectable features: ${features.filter((f) => f.major).map((f) => `${f.label} (${f.evidence})`).join("; ") || "none"}`,
  ].filter(Boolean);
  const list = comps.map((c, i) => {
    const facts = [
      COMP_SOURCE_LABELS[c.source],
      formatMoney(c.price, currency),
      c.soldAt && new Date(c.soldAt).toISOString().slice(0, 10),
      c.condition,
      c.size && `size ${c.size}`,
    ].filter(Boolean);
    return `${i + 1}. ${c.title.replace(/\s+/g, " ")} [${facts.join(", ")}]`;
  });
  return `The seller's item:\n${lines.join("\n")}\n\nComps:\n${list.join("\n")}`;
}

/** Turns raw model JSON into judgements by comp URL, skipping anything that doesn't check out. */
export function normaliseReview(raw: unknown, comps: Comp[]): { judgements: Record<string, AiJudgement>; note: string } {
  const out = ReviewOutput.safeParse(raw);
  if (!out.success || typeof raw !== "object" || raw === null || !("comps" in raw)) {
    throw new AiError("The AI returned an unexpected response. Try again.");
  }
  const judgements: Record<string, AiJudgement> = {};
  for (const entry of out.data.comps) {
    const e = ReviewEntry.safeParse(entry);
    const comp = e.success ? comps[e.data.n - 1] : undefined;
    if (!e.success || !comp || judgements[comp.url]) continue;
    judgements[comp.url] = { judgement: e.data.judgement, reason: e.data.reason.trim().replace(/\.$/, "").slice(0, 80) };
  }
  return { judgements, note: out.data.note.trim().slice(0, 1200) };
}

/**
 * Asks Gemini which comps are really the same item, and for collectables, what to check (PRICING.md §8).
 * It only judges the comps: the price is still worked out by the rules from the comps' own prices.
 */
export async function reviewComps(
  env: GeminiEnv,
  item: ReviewedItem,
  comps: Comp[],
  images: ImageInput[] = [],
  currency: Settings["currency"] = "GBP",
): Promise<AiReview> {
  if (!env.GEMINI_API_KEY) throw new AiError("AI isn't set up on this server (GEMINI_API_KEY is not set).");
  const basis = aiReviewBasis(item);
  const hasCollectable = specialFeatures(item).some((f) => f.major);
  if (!comps.length && !hasCollectable) return { status: "done", at: Date.now(), basis, judgements: {}, note: "" };
  const parts = imageParts(images, REVIEW_IMAGES, REVIEW_IMAGE_BYTES);
  parts.push({ text: reviewPrompt(item, comps, currency) });
  const raw = await generateJson(env, parts, {
    systemInstruction: REVIEW_INSTRUCTION,
    schema: REVIEW_SCHEMA,
    empty: "The AI didn't return a review.",
    slow: "Gemini took too long to review the comparables.",
  });
  return { status: "done", at: Date.now(), basis, ...normaliseReview(raw, comps) };
}
