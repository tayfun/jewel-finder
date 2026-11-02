import { describe, expect, it } from "vitest";
import { isValidIsbn, parseListingUrl, sellUrl } from "./marketplaces";
import { formatMoney, parseMoney, toDecimal } from "./money";
import { BookDetails, ItemInput, Settings } from "./schemas";

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
