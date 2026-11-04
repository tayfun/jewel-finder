import { describe, expect, it } from "vitest";
import { duplicateMatch, findDuplicatePairs, pairKey, titleSimilarity, titleTokens } from "./duplicates";
import type { ItemWithListings, Listing, Marketplace } from "./schemas";

let n = 0;
function item(fields: Partial<ItemWithListings> & { live?: Marketplace[] }): ItemWithListings {
  const id = fields.id ?? `i${++n}`;
  const listings: Listing[] = (fields.live ?? []).map((m) => ({
    id: `${id}-${m}`, itemId: id, marketplace: m, status: "listed", externalId: "1", url: null, price: null, error: null, listedAt: 0, relistedCount: 0, createdAt: 0, updatedAt: 0,
  }));
  return {
    id, sku: "", title: "", description: "", brand: "", category: "", size: "", colour: "", condition: null, price: null, cost: null,
    quantity: 1, status: "in_stock", images: [], tags: [], notes: "", book: null, packageSize: null, weightGrams: null, createdAt: 0, updatedAt: 0,
    listings, ...fields,
  };
}

describe("title similarity", () => {
  it("ignores filler and accents, and favours one title containing the other", () => {
    expect([...titleTokens("BNWT Levi's 501 Jeans – W32 L30, FREE POSTAGE!")]).toEqual(["levis", "501", "jeans", "w32", "l30"]);
    expect([...titleTokens("Café crème")]).toEqual(["cafe", "creme"]);
    const short = titleTokens("Levi's 501 jeans");
    const long = titleTokens("Levis 501 Original Straight Leg Jeans Mens Blue Denim W32 L30");
    expect(titleSimilarity(short, long)).toBeGreaterThan(0.75);
    expect(titleSimilarity(titleTokens("Nike hoodie"), titleTokens("Adidas hoodie"))).toBe(0);
    expect(titleSimilarity(titleTokens("Dress"), titleTokens("Dress"))).toBe(1);
  });
});

describe("duplicateMatch", () => {
  it("matches the same item imported from Vinted and eBay", () => {
    const vinted = item({ title: "Levi's 501 jeans", brand: "Levi's", size: "W32", price: 2500, live: ["vinted"] });
    const ebay = item({ title: "Levis 501 Original Straight Leg Jeans Mens Blue W32 L30", brand: "LEVI'S", size: "W32 L30", price: 2800, live: ["ebay"] });
    const m = duplicateMatch(vinted, ebay)!;
    expect(m.score).toBeGreaterThanOrEqual(0.8);
    expect(m.reasons).toEqual(["Similar title", "Same brand", "Same size", "Similar price", "Listed on Vinted and eBay"]);
  });

  it("is ruled out by different sizes, brands, ISBNs or authors", () => {
    const base = { title: "Levi's 501 jeans", brand: "Levi's" };
    expect(duplicateMatch(item({ ...base, size: "W32" }), item({ ...base, size: "W34" }))).toBeNull();
    expect(duplicateMatch(item({ ...base, size: "S" }), item({ ...base, size: "XS" }))).toBeNull();
    expect(duplicateMatch(item({ ...base, size: "32" }), item({ ...base, size: "W32" }))).not.toBeNull();
    expect(duplicateMatch(item({ title: "Air Max 90 trainers", brand: "Nike" }), item({ title: "Air Max 90 trainers", brand: "Puma" }))).toBeNull();
    const book = (isbn: string, author = "Tolkien") => item({ title: "The Hobbit hardback", book: { isbn, author } as never });
    expect(duplicateMatch(book("9780261102217"), book("9780007458424"))).toBeNull();
    expect(duplicateMatch(book("", "J.R.R. Tolkien"), book("", "C.S. Lewis"))).toBeNull();
  });

  it("trusts a shared ISBN even when the titles differ", () => {
    const a = item({ title: "Hobbit 1st ed", book: { isbn: "9780261102217", author: "" } as never });
    const b = item({ title: "JRR Tolkien The Hobbit Hardback Allen & Unwin", book: { isbn: "9780261102217", author: "" } as never });
    expect(duplicateMatch(a, b)).toMatchObject({ reasons: ["Same ISBN"] });
    expect(duplicateMatch(a, b)!.score).toBeGreaterThanOrEqual(0.95);
  });

  it("flags pairs live on one marketplace as listed twice, and rules out both sold or archived", () => {
    const a = item({ title: "Zara linen shirt white", live: ["vinted"] });
    const b = item({ title: "Zara linen shirt white", live: ["vinted", "ebay"] });
    expect(duplicateMatch(a, b)).toMatchObject({ listedTwiceOn: ["vinted"], reasons: ["Listed twice on Vinted", "Same title"] });
    expect(duplicateMatch(item({ title: "Zara linen shirt", live: ["ebay"] }), item({ title: "Zara linen shirt" }))?.listedTwiceOn).toBeUndefined();
    expect(duplicateMatch(item({ title: "Zara linen shirt", status: "sold" }), item({ title: "Zara linen shirt", status: "sold" }))).toBeNull();
    expect(duplicateMatch(item({ title: "Zara linen shirt", status: "archived" }), item({ title: "Zara linen shirt" }))).toBeNull();
    // Pending on a site (listed from the app, never recorded) and live there on the other: one item, imported twice.
    const pending = item({ title: "Zara linen shirt white", live: ["vinted", "ebay"] });
    pending.listings.find((l) => l.marketplace === "ebay")!.status = "pending";
    const imported = item({ title: "Zara linen shirt white", live: ["ebay"] });
    expect(duplicateMatch(pending, imported)).toMatchObject({ reasons: expect.arrayContaining(["Listed on Vinted and eBay"]) });
    // Sold on one site, still live on the other: exactly the case worth catching.
    expect(duplicateMatch(item({ title: "Zara linen shirt", status: "sold" }), item({ title: "Zara linen shirt", live: ["ebay"] }))!.score).toBe(1);
  });
});

describe("findDuplicatePairs: listed twice", () => {
  it("shows a pair live on the same site only on a close match", () => {
    const a = item({ id: "a", title: "Murat Menteş Antika Titanik Paperback Turkish 2018", live: ["ebay", "vinted"] });
    const b = item({ id: "b", title: "Murat Menteş Antika Titanik Paperback Turkish 2018", live: ["ebay"] });
    const c = item({ id: "c", title: "Murat Menteş Dublörün Dilemması Paperback Turkish", live: ["ebay"] });
    const pairs = findDuplicatePairs([a, b, c]);
    expect(pairs.map((p) => [p.a.id, p.b.id, p.listedTwiceOn])).toEqual([["a", "b", ["ebay"]]]);
  });
});

describe("findDuplicatePairs", () => {
  it("returns likely pairs best first, skipping dismissed ones", () => {
    const a = item({ id: "a", title: "Nike Tech Fleece hoodie grey", size: "M" });
    const b = item({ id: "b", title: "Nike Tech Fleece Hoodie Grey Mens M", size: "M" });
    const c = item({ id: "c", title: "Nike Tech Fleece hoodie grey", size: "L" });
    const d = item({ id: "d", title: "Penguin Modern Classics paperback" });
    const e = item({ id: "e", title: "Nike Tech Fleece hoodie grey" });
    const pairs = findDuplicatePairs([a, b, c, d, e]);
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([["a", "b"], ["a", "e"], ["c", "e"], ["b", "e"]]);
    expect(findDuplicatePairs([a, b, c, d, e], new Set([pairKey("b", "a")])).map((p) => p.a.id + p.b.id)).not.toContain("ab");
    expect(findDuplicatePairs([a, b, c, d, e], new Set(), new Set(["c"])).map((p) => p.a.id + p.b.id)).toEqual(["ce"]);
  });

  it("puts the pair with more evidence first when scores tie", () => {
    const weak = [item({ id: "w1", title: "Zara linen shirt white" }), item({ id: "w2", title: "Zara white linen shirt" })];
    const strong = [
      item({ id: "s1", title: "Levi's 501 jeans", brand: "Levi's", size: "W32", live: ["vinted"] }),
      item({ id: "s2", title: "Levi's 501 jeans", brand: "Levi's", size: "W32", live: ["ebay"] }),
    ];
    const pairs = findDuplicatePairs([...weak, ...strong]);
    expect(pairs.map((p) => p.score)).toEqual([1, 1]);
    expect(pairs[0]!.a.id).toBe("s1");
  });

  it("copes with a large inventory", () => {
    const items = Array.from({ length: 1000 }, (_, i) => item({ title: `Book ${i} paperback novel title words ${i % 37}`, price: 500 + i }));
    const t = performance.now();
    findDuplicatePairs(items);
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
