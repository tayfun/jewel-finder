import type { AuthResponse, AutofillSuggestion, ItemWithListings } from "@jf/shared";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normaliseSuggestion } from "../src/ai";

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
    expect(res.data.error).toMatch(/AI request failed/);
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
    });
    expect(s.title).toHaveLength(80);
    expect(s.condition).toBeNull();
    expect(s.confidence).toBe(1);
    expect(s.book).toMatchObject({ isbn: "", yearPublished: null, format: null, author: "J.K. Rowling" });
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
});
