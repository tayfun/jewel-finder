import { describe, expect, it } from "vitest";
import {
  EBAY_CONDITION_LABELS,
  conditionFromText,
  ebayPackageSize,
  isStale,
  isValidIsbn,
  listingAgeDays,
  myListingsUrl,
  parseListingUrl,
  priceToMinor,
  sellUrl,
  vintedPackageSize,
} from "./marketplaces";
import { formatMoney, parseMoney, toDecimal } from "./money";
import { BookDetails, ItemInput, Settings, type PackageSize } from "./schemas";

const settings = Settings.parse({});

describe("parseListingUrl", () => {
  it("recognises Vinted item pages", () => {
    expect(
      parseListingUrl("vinted", "https://www.vinted.co.uk/items/4821337-levis-501-jeans?referrer=x"),
    ).toEqual({ externalId: "4821337", url: "https://www.vinted.co.uk/items/4821337-levis-501-jeans" });
    expect(parseListingUrl("vinted", "https://www.vinted.co.uk/items/new")).toBeNull();
    expect(parseListingUrl("vinted", "https://www.ebay.co.uk/items/123")).toBeNull();
  });

  it("recognises eBay item pages", () => {
    expect(parseListingUrl("ebay", "https://www.ebay.co.uk/itm/326112233445")).toEqual({
      externalId: "326112233445",
      url: "https://www.ebay.co.uk/itm/326112233445",
    });
    expect(parseListingUrl("ebay", "https://www.ebay.com/itm/some-title/326112233445?x=1")?.externalId).toBe(
      "326112233445",
    );
    expect(parseListingUrl("ebay", "https://www.ebay.co.uk/sl/prelist")).toBeNull();
  });
});

describe("sellUrl", () => {
  it("builds marketplace sell pages", () => {
    expect(sellUrl("vinted", settings)).toBe("https://www.vinted.co.uk/items/new");
    expect(sellUrl("ebay", settings, "Nike Air")).toBe(
      "https://www.ebay.co.uk/sl/prelist/suggest?sr=wnstart&keyword=Nike%20Air",
    );
  });
});

describe("money", () => {
  it("parses and formats", () => {
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("£1,200")).toBe(120000);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("abc")).toBeNaN();
    expect(toDecimal(1250)).toBe("12.50");
    expect(formatMoney(1250)).toBe("£12.50");
  });
});

describe("ItemInput", () => {
  it("applies defaults", () => {
    const item = ItemInput.parse({ title: " Jacket " });
    expect(item).toMatchObject({ title: "Jacket", status: "in_stock", quantity: 1, images: [] });
  });
});

describe("ItemPatch", () => {
  it("does not fill in defaults for missing keys", async () => {
    const { ItemPatch } = await import("./schemas");
    expect(ItemPatch.parse({ price: 500 })).toEqual({ price: 500 });
  });
});

describe("books", () => {
  it("validates ISBN check digits", () => {
    expect(isValidIsbn("9780747532699")).toBe(true);
    expect(isValidIsbn("0747532699")).toBe(true);
    expect(isValidIsbn("080442957X")).toBe(true);
    expect(isValidIsbn("9780747532698")).toBe(false);
    expect(isValidIsbn("12345")).toBe(false);
  });

  it("normalises ISBNs and fills defaults", () => {
    expect(BookDetails.parse({ isbn: "978-0-7475-3269-9" })).toMatchObject({ isbn: "9780747532699", author: "", signed: false });
    expect(BookDetails.safeParse({ isbn: "12-34" }).success).toBe(false);
  });
});

describe("package sizes", () => {
  const item = (packageSize: PackageSize | null, weightGrams: number | null) => ({ packageSize, weightGrams });

  it("maps to eBay, moving up a band when too heavy", () => {
    expect(ebayPackageSize(item(null, 500))).toBeNull();
    expect(ebayPackageSize(item("large_letter", 300))).toBe("large_letter");
    expect(ebayPackageSize(item("large_letter", 1200))).toBe("small");
    expect(ebayPackageSize(item("small", 2600))).toBe("medium");
    expect(ebayPackageSize(item("small", null))).toBe("small");
    expect(ebayPackageSize(item("medium", 25_000))).toBe("large");
  });

  it("maps to Vinted's three sizes", () => {
    expect(vintedPackageSize(item("large_letter", 300))).toBe("small");
    expect(vintedPackageSize(item("small", 2600))).toBe("medium");
    expect(vintedPackageSize(item("medium", 6000))).toBe("large");
    expect(vintedPackageSize(item("large", 1000))).toBe("large");
  });
});

describe("imports", () => {
  it("maps marketplace condition text to ours", () => {
    expect(conditionFromText("New with tags")).toBe("new_with_tags");
    expect(conditionFromText("New without tags")).toBe("new_without_tags");
    expect(conditionFromText("Brand New")).toBe("new_without_tags");
    expect(conditionFromText("https://schema.org/NewCondition")).toBe("new_without_tags");
    expect(conditionFromText("Very good")).toBe("very_good");
    expect(conditionFromText("Pre-owned - Excellent")).toBe("very_good");
    expect(conditionFromText("Pre-owned: Good")).toBe("good");
    expect(conditionFromText("Good")).toBe("good");
    expect(conditionFromText("Satisfactory")).toBe("satisfactory");
    expect(conditionFromText("Pre-owned – Fair")).toBe("satisfactory");
    // Round-trips our own eBay labels.
    for (const [c, label] of Object.entries(EBAY_CONDITION_LABELS)) expect(conditionFromText(label)).toBe(c);
    expect(conditionFromText("Used")).toBeNull();
    expect(conditionFromText("https://schema.org/UsedCondition")).toBeNull();
    expect(conditionFromText("")).toBeNull();
  });

  it("reads prices the way marketplaces write them", () => {
    expect(priceToMinor("£12.50")).toBe(1250);
    expect(priceToMinor("12,50 €")).toBe(1250);
    expect(priceToMinor("1.234,00 €")).toBe(123400);
    expect(priceToMinor("£1,234.5")).toBe(123450);
    expect(priceToMinor("US $1,234")).toBe(123400);
    expect(priceToMinor("15")).toBe(1500);
    expect(priceToMinor(9.99)).toBe(999);
    expect(priceToMinor("free")).toBeNull();
    expect(priceToMinor(null)).toBeNull();
  });

  it("knows where the seller's listings are", () => {
    const settings = Settings.parse({ vintedDomain: "www.vinted.fr", ebayDomain: "www.ebay.de" });
    expect(myListingsUrl("vinted", settings)).toBe("https://www.vinted.fr/");
    expect(myListingsUrl("ebay", settings)).toBe("https://www.ebay.de/sh/lst/active");
  });
});

describe("staleness", () => {
  const DAY = 86_400_000;
  const now = Date.UTC(2026, 10, 3);
  const live = (marketplace: "vinted" | "ebay", days: number) => ({ marketplace, status: "listed" as const, listedAt: now - days * DAY });

  it("counts whole days since a listing went live", () => {
    expect(listingAgeDays({ listedAt: now - 3.9 * DAY }, now)).toBe(3);
    expect(listingAgeDays({ listedAt: null }, now)).toBeNull();
    expect(listingAgeDays({ listedAt: now + DAY }, now)).toBe(0);
  });

  it("uses each marketplace's relist interval", () => {
    expect(settings).toMatchObject({ vintedRelistDays: 21, ebayRelistDays: 60 });
    const inStock = { status: "in_stock" as const };
    expect(isStale(inStock, live("vinted", 21), settings, now)).toBe(true);
    expect(isStale(inStock, live("vinted", 20), settings, now)).toBe(false);
    expect(isStale(inStock, live("ebay", 30), settings, now)).toBe(false);
    expect(isStale(inStock, live("ebay", 30), { ...settings, ebayRelistDays: 30 }, now)).toBe(true);
  });

  it("only flags live listings of items still for sale", () => {
    expect(isStale({ status: "sold" }, live("vinted", 90), settings, now)).toBe(false);
    expect(isStale({ status: "in_stock" }, { ...live("vinted", 90), status: "ending" }, settings, now)).toBe(false);
    expect(isStale({ status: "in_stock" }, { ...live("vinted", 90), listedAt: null }, settings, now)).toBe(false);
  });
});
