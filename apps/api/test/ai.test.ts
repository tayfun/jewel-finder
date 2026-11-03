import type { AuthResponse, AutofillSuggestion, Comp, ItemWithListings, PriceCheck } from "@jf/shared";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { describeGeminiError, normaliseReview, normaliseSuggestion, reviewPrompt } from "../src/ai";

const BASE = "https://jf.test";
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

const modelOutput = {
  title: "Harry Potter and the Philosopher's Stone J.K. Rowling 1st Edition 1997 Hardback",
  description: "First edition hardback.\n\nLight wear to corners.",
  condition: "good",
  category: "Books > Fiction > Fantasy",
  tags: ["Harry Potter", "harry potter", "first edition", ""],
  book: {
    author: "J.K. Rowling",
    isbn: "0-7475-3269-9",
    publisher: "Bloomsbury",
    yearPublished: 1997,
    edition: "First edition",
    printing: "First printing",
    format: "hardback",
    language: "English",
    signed: false,
    dustJacket: null,
    rarity: "very_rare",
    rarityNotes: "Number line 10 9 8 7 6 5 4 3 2 1 visible on the copyright page.",
  },
  packageSize: "small",
  weightGrams: 650,
  confidence: 0.86,
  notes: "",
};

async function call<T>(path: string, init: { token?: string; json?: unknown; body?: BodyInit; type?: string; method?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.type) headers["Content-Type"] = init.type;
  const res = await exports.default.fetch(
    new Request(BASE + path, {
      method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    }),
  );
  return { status: res.status, data: (await res.json()) as T };
}

async function itemWithPhoto(withPhoto = true) {
  const email = `books-${crypto.randomUUID()}@example.com`;
  const { data: auth } = await call<AuthResponse>("/api/auth/register", { json: { email, password: "hunter2hunter2" } });
  const images: string[] = [];
  if (withPhoto) {
    const up = await call<{ key: string }>("/api/images", { token: auth.token, body: PNG, type: "image/png" });
    images.push(up.data.key);
  }
  const { data: item } = await call<ItemWithListings>("/api/items", { token: auth.token, json: { title: "Old book", images } });
  return { token: auth.token, item };
}

afterEach(() => vi.restoreAllMocks());

describe("POST /api/items/:id/autofill", () => {
  it("sends the photos and schema to Gemini and returns a cleaned-up suggestion", async () => {
    const { token, item } = await itemWithPhoto();
    const realFetch = globalThis.fetch;
    let sent: { url: string; body: any; headers: Headers } | null = null;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input, init);
      if (!req.url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      sent = { url: req.url, body: await req.json(), headers: req.headers };
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(modelOutput) }] } }] });
    });

    const res = await call<{ suggestion: AutofillSuggestion }>(`/api/items/${item.id}/autofill`, { token, json: {} });
    expect(res.status).toBe(200);

    expect(sent!.url).toContain("models/gemini-3.8-flash:generateContent");
    expect(sent!.headers.get("x-goog-api-key")).toBe("test-gemini-key");
    const parts = sent!.body.contents[0].parts;
    expect(parts[0].inlineData).toEqual({ mimeType: "image/png", data: btoa(String.fromCharCode(...PNG)) });
    expect(parts.at(-1).text).toContain("Old book");
    expect(sent!.body.generationConfig.responseMimeType).toBe("application/json");
    expect(sent!.body.generationConfig.responseJsonSchema.properties.book.properties.isbn).toBeDefined();

    expect(res.data.suggestion).toMatchObject({
      condition: "good",
      tags: ["harry potter", "first edition"],
      confidence: 0.86,
      packageSize: "small",
      weightGrams: 650,
      book: { author: "J.K. Rowling", isbn: "0747532699", yearPublished: 1997, rarity: "very_rare", format: "hardback" },
    });

    // Nothing is saved until the user applies it.
    const after = await call<ItemWithListings>(`/api/items/${item.id}`, { token });
    expect(after.data.title).toBe("Old book");
    expect(after.data.book).toBeNull();
  });

  it("reports Gemini errors and missing photos", async () => {
    const { token, item } = await itemWithPhoto(false);
    expect((await call(`/api/items/${item.id}/autofill`, { token, json: {} })).status).toBe(400);

    const withPhoto = await itemWithPhoto();
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input, init);
      if (!req.url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      return Response.json({ error: { code: 400, message: "API key not valid", status: "INVALID_ARGUMENT" } }, { status: 400 });
    });
    const res = await call<{ error: string }>(`/api/items/${withPhoto.item.id}/autofill`, { token: withPhoto.token, json: {} });
    expect(res.status).toBe(502);
    expect(res.data.error).toMatch(/Gemini rejected the request \(400\)/);
  });

  it("falls back to the older model when the newest one times out", async () => {
    const { token, item } = await itemWithPhoto();
    const realFetch = globalThis.fetch;
    const calls: { model: string; timeout: string | null }[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input, init);
      if (!req.url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      const model = req.url.match(/models\/([^:]+):/)?.[1] ?? "";
      calls.push({ model, timeout: req.headers.get("x-server-timeout") });
      if (model === "gemini-3.8-flash") {
        return Response.json({ error: { code: 504, message: "Deadline expired", status: "DEADLINE_EXCEEDED" } }, { status: 504 });
      }
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(modelOutput) }] } }] });
    });

    const res = await call<{ suggestion: AutofillSuggestion }>(`/api/items/${item.id}/autofill`, { token, json: {} });
    expect(res.status).toBe(200);
    expect(res.data.suggestion.book.author).toBe("J.K. Rowling");
    // One bounded try on the primary (no retry of a 504), then the fallback.
    expect(calls).toEqual([
      { model: "gemini-3.8-flash", timeout: "30" },
      { model: "gemini-3.5-flash", timeout: "60" },
    ]);
  });

  it("also falls back when the request is aborted by our own timeout", async () => {
    const { token, item } = await itemWithPhoto();
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input, init);
      if (!req.url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      if (req.url.includes("gemini-3.8-flash")) throw new DOMException("The operation was aborted", "AbortError");
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(modelOutput) }] } }] });
    });
    const res = await call<{ suggestion: AutofillSuggestion }>(`/api/items/${item.id}/autofill`, { token, json: {} });
    expect(res.status).toBe(200);
  });
});

describe("describeGeminiError", () => {
  it("explains common failures", () => {
    expect(describeGeminiError(Object.assign(new Error("x"), { status: 503 }))).toMatch(/busy/);
    expect(describeGeminiError(Object.assign(new Error("x"), { status: 429 }))).toMatch(/busy/);
    expect(describeGeminiError(Object.assign(new Error("x"), { status: 504 }))).toMatch(/too long/);
    expect(describeGeminiError(new Error("The operation was aborted"))).toMatch(/too long/);
    expect(describeGeminiError(new Error("network down"))).toBe("The AI request failed: network down");
  });
});

describe("normaliseSuggestion", () => {
  it("drops invalid values instead of failing", () => {
    const s = normaliseSuggestion({
      ...modelOutput,
      title: "x".repeat(120),
      condition: "mint",
      confidence: 3,
      book: { ...modelOutput.book, isbn: "9780747532698", yearPublished: 99999, format: "scroll" },
      packageSize: "crate",
      weightGrams: -5,
    });
    expect(s.title).toHaveLength(80);
    expect(s.condition).toBeNull();
    expect(s.confidence).toBe(1);
    expect(s.book).toMatchObject({ isbn: "", yearPublished: null, format: null, author: "J.K. Rowling" });
    expect(s.packageSize).toBeNull();
    expect(s.weightGrams).toBeNull();
    expect(s.notes).toMatch(/check digit/);
  });

  it("rejects output that isn't a suggestion at all", () => {
    expect(() => normaliseSuggestion({ hello: "world" })).toThrow(/unexpected response/);
  });
});

describe("book details on items", () => {
  it("saves and patches book details", async () => {
    const { token, item } = await itemWithPhoto(false);
    const patched = await call<ItemWithListings>(`/api/items/${item.id}`, {
      token,
      method: "PATCH",
      json: { book: { author: "Tolkien", isbn: "978-0-261-10320-7", yearPublished: 1991 } },
    });
    expect(patched.status).toBe(200);
    expect(patched.data.book).toMatchObject({ author: "Tolkien", isbn: "9780261103207", yearPublished: 1991, signed: false });
    const bad = await call(`/api/items/${item.id}`, { token, method: "PATCH", json: { book: { isbn: "abc" } } });
    expect(bad.status).toBe(400);
  });

  it("saves package size and weight", async () => {
    const { token, item } = await itemWithPhoto(false);
    expect(item).toMatchObject({ packageSize: null, weightGrams: null });
    const patched = await call<ItemWithListings>(`/api/items/${item.id}`, {
      token,
      method: "PATCH",
      json: { packageSize: "small", weightGrams: 650 },
    });
    expect(patched.data).toMatchObject({ packageSize: "small", weightGrams: 650 });
    const bad = await call(`/api/items/${item.id}`, { token, method: "PATCH", json: { packageSize: "crate" } });
    expect(bad.status).toBe(400);
  });
});

describe("AI review of price checks", () => {
  const day = 86_400_000;
  const sold = (title: string, pounds: number, i: number): Comp => ({
    source: "ebay_sold", title, price: pounds * 100, url: `https://www.ebay.co.uk/itm/${200000000 + i}`, soldAt: Date.now() - i * day,
  });
  const comps = [
    ...[90, 100, 110, 120].map((p, i) => sold("The Hobbit Tolkien 1937 first edition hardback", p, i)),
    // The rules can tell this one isn't a first edition.
    sold("Hobbit Tolkien 1937 1st edition facsimile hardback", 6, 5),
    sold("Job lot 20 Tolkien books", 50, 6),
  ];
  const firstEdition = { edition: "First edition", format: "hardback", author: "J.R.R. Tolkien" };

  /** Gemini answers with `review`; records what it was sent. */
  function gemini(review: (body: any) => object | Response) {
    const realFetch = globalThis.fetch;
    const sent: any[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const req = new Request(input, init);
      if (!req.url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      const body = await req.json();
      sent.push(body);
      const out = review(body);
      if (out instanceof Response) return out;
      return Response.json({ candidates: [{ content: { role: "model", parts: [{ text: JSON.stringify(out) }] } }] });
    });
    return sent;
  }

  async function hobbit() {
    const { token, item } = await itemWithPhoto();
    await call(`/api/items/${item.id}`, { token, method: "PATCH", json: { title: "The Hobbit Tolkien 1937 First Edition Hardback", book: firstEdition } });
    return { token, item };
  }

  it("asks Gemini which comps are the same edition and applies its verdicts", async () => {
    const { token, item } = await hobbit();
    const sent = gemini(() => ({
      comps: [
        { n: 1, judgement: "same", reason: "" },
        { n: 2, judgement: "same", reason: "" },
        { n: 3, judgement: "same", reason: "" },
        { n: 4, judgement: "lesser", reason: "Book club edition." },
      ],
      note: "Check the number line on the copyright page.",
    }));
    const res = await call<PriceCheck>(`/api/items/${item.id}/price-check`, { token, json: { queries: ["hobbit"], comps } });
    expect(res.status).toBe(201);

    // The photo, then the item and the comps worth judging: not the lot, which the rules already dropped.
    const parts = sent[0].contents[0].parts;
    expect(parts[0].inlineData.mimeType).toBe("image/png");
    const prompt: string = parts.at(-1).text;
    expect(prompt).toContain("Edition: First edition");
    expect(prompt).toContain("Collectable features: First edition");
    expect(prompt).toMatch(/1\. The Hobbit Tolkien 1937 first edition hardback \[Sold on eBay, £90\.00, \d{4}-\d\d-\d\d\]/);
    expect(prompt).not.toMatch(/Job lot|facsimile/);
    expect(sent[0].generationConfig.responseJsonSchema.properties.comps).toBeDefined();

    expect(res.data.ai).toMatchObject({ status: "done", note: "Check the number line on the copyright page." });
    expect(res.data.aiOutdated).toBe(false);
    expect(res.data.summary.assessments.map((a) => a.verdict)).toEqual(["match", "match", "match", "ordinary", "dropped", "dropped"]);
    expect(res.data.summary.assessments[3]).toMatchObject({ reason: "AI: Book club edition", ai: "lesser" });
    expect(res.data.summary.aiChanged).toBe(1);
    expect(res.data.summary.suggestions[0]!.count).toBe(3);

    // Change what the item is: the review is outdated and no longer applied, until it's run again.
    await call(`/api/items/${item.id}`, { token, method: "PATCH", json: { book: { ...firstEdition, signed: true } } });
    const outdated = await call<PriceCheck>(`/api/items/${item.id}/price-check`, { token });
    expect(outdated.data.aiOutdated).toBe(true);
    expect(outdated.data.summary.aiChanged).toBe(0);

    const again = await call<PriceCheck>(`/api/items/${item.id}/price-check/review`, { token, json: {} });
    expect(again.status).toBe(200);
    expect(again.data.id).toBe(res.data.id);
    expect(again.data.aiOutdated).toBe(false);
    expect(sent).toHaveLength(2);
    expect(sent[1].contents[0].parts.at(-1).text).toContain("Signed: yes");
  });

  it("still saves the check when Gemini fails, and says why", async () => {
    const { token, item } = await hobbit();
    gemini(() => Response.json({ error: { code: 503, message: "Overloaded", status: "UNAVAILABLE" } }, { status: 503 }));
    const res = await call<PriceCheck>(`/api/items/${item.id}/price-check`, { token, json: { queries: ["hobbit"], comps } });
    expect(res.status).toBe(201);
    expect(res.data.ai).toMatchObject({ status: "failed", error: "Gemini is busy right now. Please try again in a minute." });
    expect(res.data.summary.suggestions[0]!.count).toBe(4);

    const retry = await call<{ error: string }>(`/api/items/${item.id}/price-check/review`, { token, json: {} });
    expect(retry.status).toBe(502);
    expect(retry.data.error).toMatch(/busy/);
  }, 20_000);

  it("can't review a check that doesn't exist", async () => {
    const { token, item } = await itemWithPhoto(false);
    expect((await call(`/api/items/${item.id}/price-check/review`, { token, json: {} })).status).toBe(404);
  });
});

describe("normaliseReview", () => {
  const comps: Comp[] = ["a", "b", "c"].map((x) => ({ source: "ebay_listed", title: x, price: 100, url: `https://x.test/${x}` }));

  it("maps judgements to comps by number and skips what doesn't check out", () => {
    const out = normaliseReview(
      {
        comps: [
          { n: 1, judgement: "different", reason: "Different volume." },
          { n: 1, judgement: "same", reason: "duplicate answer" },
          { n: 2, judgement: "maybe", reason: "" },
          { n: 9, judgement: "same", reason: "" },
          "junk",
          { n: 3, judgement: "greater" },
        ],
        note: 5,
      },
      comps,
    );
    expect(out).toEqual({
      judgements: { "https://x.test/a": { judgement: "different", reason: "Different volume" }, "https://x.test/c": { judgement: "greater", reason: "" } },
      note: "",
    });
  });

  it("rejects output that isn't a review", () => {
    expect(() => normaliseReview({ title: "x" }, comps)).toThrow(/unexpected response/);
  });

  it("describes ordinary items without collectable features", () => {
    const prompt = reviewPrompt({ title: "Levi's 501 W32", description: "", tags: [], book: null, condition: "good", brand: "Levi's", size: "W32" }, comps, "EUR");
    expect(prompt).toContain("Collectable features: none");
    expect(prompt).toContain("Size: W32");
    expect(prompt).toMatch(/3\. c \[Listed on eBay, €1\.00\]/);
  });
});
