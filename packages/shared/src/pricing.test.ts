import { describe, expect, it } from "vitest";
import {
  aiReviewBasis,
  assessComp,
  compFeatures,
  compsForReview,
  currentJudgements,
  nicePrice,
  priceQueries,
  priceSummary,
  quantile,
  specialFeatures,
  withoutOutliers,
  type AiReview,
  type Comp,
} from "./pricing";
import { BookDetails, type Item } from "./schemas";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3);

type Priced = Pick<Item, "title" | "description" | "tags" | "book" | "condition" | "brand" | "size">;
const item = (fields: Partial<Priced>): Priced => ({ title: "", description: "", tags: [], book: null, condition: null, brand: "", size: "", ...fields });
const book = (fields: Partial<BookDetails>) => BookDetails.parse(fields);
const sold = (title: string, pounds: number, daysAgo = 10, extra: Partial<Comp> = {}): Comp => ({
  source: "ebay_sold", title, price: Math.round(pounds * 100), url: `https://www.ebay.co.uk/itm/${Math.random()}`, soldAt: NOW - daysAgo * DAY, ...extra,
});
const listed = (title: string, pounds: number, source: Comp["source"] = "ebay_listed", extra: Partial<Comp> = {}): Comp => ({
  source, title, price: Math.round(pounds * 100), url: "https://example.test", ...extra,
});

const hobbitFirst = item({
  title: "The Hobbit J.R.R. Tolkien 1937 First Edition Hardback",
  book: book({ author: "J.R.R. Tolkien", edition: "First edition", printing: "First impression", format: "hardback", dustJacket: true, rarity: "very_rare", rarityNotes: "First impression, 1937" }),
  condition: "good",
});

describe("special features", () => {
  it("flags collectable books with the evidence", () => {
    const feats = specialFeatures(hobbitFirst);
    expect(feats.map((f) => [f.key, f.major])).toEqual([
      ["first_edition", true],
      ["rare", true],
      ["dust_jacket", true], // major on a first edition
      ["hardback", false],
    ]);
    expect(feats[0]!.evidence).toBe("Edition: First edition");
    expect(feats[1]!.evidence).toMatch(/^Rarity: very rare \(First impression, 1937\)/);
  });

  it("reads titles and descriptions, and isn't fooled by negations or later printings", () => {
    const keys = (fields: Partial<Priced>) => specialFeatures(item(fields)).map((f) => f.key);
    expect(keys({ title: "Signed copy, 1st ed, limited edition no. 12 of 500" })).toEqual(["first_edition", "signed", "limited"]);
    expect(keys({ title: "Novel", description: "Not signed. Book club edition, first edition thus." })).toEqual([]);
    expect(keys({ title: "Uncorrected proof copy paperback" })).toEqual(["proof", "paperback"]);
    expect(keys({ title: "Novel", book: book({ edition: "Second edition", dustJacket: false }) })).toEqual([]);
    expect(keys({ title: "Waterproof jacket", condition: "new_with_tags" })).toEqual(["new_with_tags"]);
    // A jacket only matters a lot on a first edition.
    expect(specialFeatures(item({ title: "Novel", book: book({ dustJacket: true }) })).map((f) => f.major)).toEqual([false]);
  });

  it("reads comp titles the same way", () => {
    expect([...compFeatures("TOLKIEN THE HOBBIT 1ST/1ST HB DJ 1937")]).toEqual(["first_edition", "dust_jacket", "hardback"]);
    expect([...compFeatures("The Hobbit - 2nd impression, no dust jacket")]).toEqual([]);
    expect([...compFeatures("Hobbit book club edition (BCE) first edition")]).toEqual([]);
  });
});

describe("queries", () => {
  it("searches books by ISBN first, then with and without the collectable words", () => {
    const q = priceQueries({ ...hobbitFirst, book: { ...hobbitFirst.book!, isbn: "9780261102217" } });
    expect(q).toEqual(["9780261102217", "hobbit 1937 tolkien first edition", "hobbit 1937 tolkien"]);
  });

  it("searches other items by brand and title words", () => {
    expect(priceQueries(item({ title: "BNWT Levi's 501 Original Straight Leg Jeans W32 L30 Blue", brand: "Levi's" }))).toEqual([
      "levis 501 original straight leg jeans",
      "levis 501 original straight",
    ]);
  });
});

describe("assessing comps", () => {
  const jeans = item({ title: "Levi's 501 jeans W32", brand: "Levi's", size: "W32" });

  it("keeps like for like and says why others are dropped", () => {
    const verdict = (c: Comp) => {
      const a = assessComp(jeans, c);
      return a.verdict === "dropped" ? a.reason : a.verdict;
    };
    expect(verdict(sold("Levis 501 Original Fit Jeans Mens W32 L32", 20))).toBe("match");
    expect(verdict(sold("Job lot 5x Levi's 501 jeans mixed sizes", 40))).toBe("Lot or bundle");
    expect(verdict(sold("Levi's 501 jeans W36", 18, 5, { size: "W36" }))).toBe("Different size (W36)");
    expect(verdict(sold("Nike Air Max 90 trainers", 50))).toBe("Different item");
    expect(verdict(sold("Levi's 501 jeans for parts / spares or repairs", 3))).toBe("For parts / faulty");
    expect(verdict(sold("Levi's 501 jeans", 0))).toBe("No price");
  });

  it("separates ordinary copies from collectable ones", () => {
    const verdicts = [
      sold("The Hobbit Tolkien 1937 1st Edition 1st Impression Allen & Unwin", 12000),
      sold("The Hobbit Tolkien paperback 1995", 6),
      sold("The Hobbit Tolkien hardback 1966 2nd edition 10th impression", 40),
      sold("The Hobbit Tolkien 1937 first edition SIGNED", 60000),
      sold("The Hobbit Tolkien hardback 1951", 90),
    ].map((c) => {
      const a = assessComp(hobbitFirst, c);
      return `${a.verdict}${a.reason ? `: ${a.reason}` : ""}`;
    });
    expect(verdicts).toEqual([
      "match",
      "dropped: Paperback",
      "dropped: Not a first edition",
      "dropped: Signed, yours isn't",
      "ordinary: Not first edition",
    ]);
  });
});

describe("maths", () => {
  it("weighted quantiles, outliers, nice prices", () => {
    expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(quantile([10, 20], 0.5)).toBe(15);
    // Heavier weight pulls the median towards it.
    expect(quantile([10, 20], 0.5, [3, 1])).toBeLessThan(15);
    expect(withoutOutliers([10, 11, 12, 12, 13, 95].map((price) => ({ price }))).map((c) => c.price)).toEqual([10, 11, 12, 12, 13]);
    expect([nicePrice(1234), nicePrice(4567), nicePrice(12_345), nicePrice(10)]).toEqual([1250, 4600, 12_500, 50]);
    expect([nicePrice(212_340), nicePrice(1_212_500)]).toEqual([210_000, 1_210_000]);
  });
});

describe("price summary", () => {
  const jeans = item({ title: "Levi's 501 jeans W32", brand: "Levi's", size: "W32", condition: "good" });
  const soldJeans = [18, 20, 21, 22, 22, 24, 25, 26, 120].map((p, i) => sold(`Levi's 501 Original Jeans W32 #${i}`, p, i * 7));

  it("prices from recent sales, with a range, confidence and a separate Vinted suggestion", () => {
    const vintedJeans = [12, 14, 15, 16, 30].map((p) => listed("Levi's 501 jeans W32", p, "vinted_listed"));
    const s = priceSummary(jeans, [...soldJeans, ...vintedJeans], NOW);
    expect(s.suggestions.map((x) => [x.marketplace, x.basis, x.confidence])).toEqual([
      ["ebay", "sold", "high"],
      ["vinted", "listed", "low"],
    ]);
    const ebay = s.suggestions[0]!;
    expect(ebay.count).toBe(8); // the £120 outlier is out
    expect(ebay.price).toBeGreaterThanOrEqual(2000);
    expect(ebay.price).toBeLessThanOrEqual(2400);
    expect(ebay.low).toBeLessThan(ebay.price);
    expect(ebay.high).toBeGreaterThan(ebay.price);
    expect(ebay.note).toBe("8 sold on eBay, most recent today");
    expect(s.suggestions[1]!.price).toBeLessThan(ebay.price);
    expect(s.warnings).toEqual([]);
  });

  it("puts better condition higher in the range", () => {
    const good = priceSummary(jeans, soldJeans, NOW).suggestions[0]!.price;
    const nwt = priceSummary({ ...jeans, condition: "new_with_tags" }, soldJeans, NOW).suggestions[0]!.price;
    const worn = priceSummary({ ...jeans, condition: "satisfactory" }, soldJeans, NOW).suggestions[0]!.price;
    expect(nwt).toBeGreaterThan(good);
    expect(worn).toBeLessThan(good);
  });

  it("falls back to current listings, aimed low, and says so", () => {
    const s = priceSummary(jeans, [20, 25, 30, 35].map((p) => listed("Levi's 501 jeans W32", p)), NOW);
    expect(s.suggestions[0]).toMatchObject({ marketplace: "ebay", basis: "listed" });
    expect(s.suggestions[0]!.price).toBeLessThanOrEqual(2500);
    expect(s.warnings).toContain("Nothing sold to go on, so this is from current asking prices, aimed at the cheaper end.");
  });

  it("never prices a first edition from reprints", () => {
    const reprints = [70, 85, 90, 95, 110].map((p) => sold("The Hobbit Tolkien hardback 1951", p));
    const s = priceSummary(hobbitFirst, reprints, NOW);
    expect(s.suggestions).toEqual([]);
    expect(s.ordinaryFloor).toBe(9000);
    expect(s.assessments.every((a) => a.verdict === "ordinary")).toBe(true);
    expect(s.warnings[0]).toMatch(/^Not enough comparable first edition, rare, dust jacket copies found\. Ordinary copies go for about 90\.00; yours is likely worth more/);

    const firsts = [9500, 11000, 12000, 15000].map((p) => sold("The Hobbit Tolkien 1937 First Edition 1st Impression hardback", p, 30));
    const priced = priceSummary(hobbitFirst, [...reprints, ...firsts], NOW);
    expect(priced.suggestions[0]).toMatchObject({ basis: "sold", count: 4 });
    expect(priced.suggestions[0]!.price).toBeGreaterThan(900_000);
    expect(priced.warnings).toContain("Rare items sell rarely: with this few sales, the range is a rough guide.");
  });

  it("says when nothing was found", () => {
    expect(priceSummary(jeans, [], NOW)).toMatchObject({ suggestions: [], ordinaryFloor: null, warnings: ["No comparable listings found. Try a shorter title, or check by hand."] });
  });
});

describe("AI review of comps", () => {
  const firstEd = (pounds: number, i: number) => sold("The Hobbit Tolkien 1937 First Edition 1st Impression hardback", pounds, 30, { url: `https://www.ebay.co.uk/itm/f${i}` });

  it("only makes verdicts stricter, so it can't push a collectable's price up", () => {
    const comp = firstEd(12000, 0);
    expect(assessComp(hobbitFirst, comp).verdict).toBe("match");
    // A facsimile titled like a first edition: the AI spots it.
    expect(assessComp(hobbitFirst, comp, undefined, { judgement: "lesser", reason: "1990s facsimile of the first edition" })).toMatchObject({
      verdict: "ordinary",
      reason: "AI: 1990s facsimile of the first edition",
      ai: "lesser",
    });
    expect(assessComp(hobbitFirst, comp, undefined, { judgement: "different", reason: "" })).toMatchObject({ verdict: "dropped", reason: "AI: a different item" });
    // An ordinary copy stays one, whatever the AI says.
    const reprint = sold("The Hobbit Tolkien hardback 1951", 90);
    expect(assessComp(hobbitFirst, reprint, undefined, { judgement: "same", reason: "" })).toMatchObject({ verdict: "ordinary", ai: "same" });
    // Objective drops stand.
    expect(assessComp(hobbitFirst, sold("Job lot 20 Tolkien books Hobbit first edition", 500), undefined, { judgement: "same", reason: "" }).verdict).toBe("dropped");
  });

  it("lets back in a comp whose title only reads differently, still judged on the other rules", () => {
    const jeans = item({ title: "Levi's 501 jeans W32", brand: "Levi's", size: "W32", condition: "good" });
    const comp = listed("LVS Strauss straight leg denim 32W vintage blue", 25, "vinted_listed", { size: "W32" });
    expect(assessComp(jeans, comp)).toMatchObject({ verdict: "dropped", reason: "Different item" });
    expect(assessComp(jeans, comp, undefined, { judgement: "same", reason: "Levi's 501, same fit" })).toMatchObject({ verdict: "match", ai: "same" });
    expect(assessComp(jeans, { ...comp, size: "W36" }, undefined, { judgement: "same", reason: "" }).verdict).toBe("dropped");
  });

  it("prices with the judgements of a review that matches the item, and counts what changed", () => {
    const comps = [10000, 11000, 12000, 13000].map(firstEd);
    const review: AiReview = {
      status: "done",
      at: NOW,
      basis: aiReviewBasis(hobbitFirst),
      judgements: { [comps[3]!.url]: { judgement: "lesser", reason: "Book club edition" } },
      note: "",
    };
    const judgements = currentJudgements(hobbitFirst, review);
    const s = priceSummary(hobbitFirst, comps, NOW, judgements);
    expect(s.assessments.map((a) => a.verdict)).toEqual(["match", "match", "match", "ordinary"]);
    expect(s.aiChanged).toBe(1);
    expect(s.suggestions[0]!.count).toBe(3);

    // The seller corrects the item: the review no longer applies.
    expect(currentJudgements({ ...hobbitFirst, book: { ...hobbitFirst.book!, printing: "Second impression" } }, review)).toBeUndefined();
    expect(currentJudgements(hobbitFirst, { ...review, status: "failed" })).toBeUndefined();
    expect(priceSummary(hobbitFirst, comps, NOW).aiChanged).toBe(0);
  });

  it("shows the AI the comps worth judging, sold and closest first", () => {
    const comps = [
      listed("The Hobbit Tolkien 1937 first edition hardback", 15000, "vinted_listed"),
      firstEd(12000, 1),
      sold("Job lot 20 Tolkien books", 50),
      sold("Lord of the Rings Tolkien first edition", 3000),
      sold("Tolkien Hobbit 1st edn 1937 Allen & Unwin", 9000, 20, { url: "https://www.ebay.co.uk/itm/near" }),
    ];
    const picked = compsForReview(hobbitFirst, comps);
    // Sold before listed; the job lot and the other book aren't worth asking about.
    expect(picked.map((c) => c.title)).toEqual([
      "The Hobbit Tolkien 1937 First Edition 1st Impression hardback",
      "Tolkien Hobbit 1st edn 1937 Allen & Unwin",
      "The Hobbit Tolkien 1937 first edition hardback",
    ]);
    expect(compsForReview(hobbitFirst, comps, 1)).toHaveLength(1);
  });
});
