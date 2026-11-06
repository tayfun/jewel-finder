import { describe, expect, it } from "vitest";
import {
  EBAY_CONDITION_LABELS,
  bookLanguage,
  vintedCategory,
  conditionFromText,
  ebayPackageSize,
  handListingFields,
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

describe("vintedCategory", () => {
  const books = "Media › Books, Comics & Magazines › Books";
  const vc = (title: string, category = books, extra: { tags?: string[]; book?: boolean } = {}) =>
    vintedCategory({ title, category, tags: extra.tags ?? [], book: extra.book ? ({} as never) : null });
  const cat = (...args: Parameters<typeof vc>) => vc(...args)?.name ?? null;

  it("files books by what the title and tags say, as a guess naming the word", () => {
    expect(vc("Connell Guides The Connell Guide to King Lear PB 2018")).toEqual({
      name: "Non-fiction",
      parent: "Books & Media > Books",
      guess: '"guides" in the title',
    });
    expect(cat("Oxford University Press Thought: VSI Tim Bayne PB 2013")).toBe("Non-fiction");
    expect(cat("Oxford Student Texts W. B. Yeats Selected Poems OUP 2011")).toBe("Fiction");
    expect(vc("Margaret Atwood The Handmaid's Tale", books, { tags: ["novel", "dystopia"] })?.guess).toBe('"novel" in the title');
    expect(cat("Isaac Asimov Foundation science fiction PB")).toBe("Fiction");
  });

  it("files a book it can't place under Fiction, as a guess", () => {
    expect(vc("Erkekler Ve Kadınlar - Giroud & Lévy")).toEqual({
      name: "Fiction",
      parent: "Books & Media > Books",
      guess: "nothing in the title says fiction or non-fiction",
    });
    expect(vc("A novel guide")?.guess).toMatch(/^nothing/);
  });

  it("goes by the item's category for comics, magazines, textbooks and children's books, not as a guess", () => {
    expect(vc("Asterix", "Media › Books, Comics & Magazines › Comic Books & Memorabilia › Comics")).toEqual({
      name: "Comics, manga & graphic novels",
      parent: "Books & Media > Books",
    });
    expect(vc("Wired", "Media › Books, Comics & Magazines › Magazines")).toEqual({ name: "Magazines", parent: "Books & Media" });
    expect(cat("GCSE Maths", "Media › Books, Comics & Magazines › Textbooks, Education & Reference › School Textbooks & Study Guides")).toBe(
      "Textbooks & study materials",
    );
    expect(cat("The Gruffalo", "Books › Children's Books")).toBe("Kids");
  });

  it("ignores items that aren't books", () => {
    expect(cat("Levi's 501", "Men › Jeans")).toBeNull();
    expect(cat("Mystery novel", "", { book: true })).toBe("Fiction");
  });
});

describe("bookLanguage", () => {
  const lang = (title: string, language = "", tags: string[] = []) =>
    bookLanguage({ title, tags, book: language ? ({ language } as never) : null });
  it("uses the saved language, else guesses from the title or Turkish letters, else English", () => {
    expect(lang("Anything", "French")).toEqual({ language: "French" });
    expect(lang("Elif Şafak Baba ve Piç Doğan Kitap Paperback 82. Baskı 2010 Turkish")).toEqual({
      language: "Turkish",
      guess: '"Turkish" in the title',
    });
    expect(lang("William Shakespeare Fırtına Can Yücel Çeviri PB İş Bankası")).toEqual({
      language: "Turkish",
      guess: "Turkish letters in the title",
    });
    expect(lang("Margaret Atwood The Handmaid's Tale PB Vintage 1996 English Dystopia").language).toBe("English");
    expect(lang("Le Petit Prince", "", ["french"]).language).toBe("French");
    expect(lang("Roald Dahl The Witches PB Puffin")).toEqual({ language: "English", guess: "none saved, so the default" });
  });
});

describe("hand listing fields", () => {
  const base = {
    title: "Levi's 501 straight jeans W32 L30",
    description: "Classic fit.\nWorn twice.",
    price: 2500,
    brand: "Levi's",
    category: "Men › Jeans",
    size: "W32",
    colour: "",
    condition: "very_good" as const,
    book: null,
    packageSize: "small" as const,
    weightGrams: 2600,
  };
  const pairs = (fields: ReturnType<typeof handListingFields>) => fields.map((f) => [f.label, f.value]);

  it("words each marketplace's form its own way and leaves out empty values", () => {
    expect(pairs(handListingFields(base, "vinted"))).toEqual([
      ["Title", base.title],
      ["Description", base.description],
      ["Price", "25.00"],
      ["Category", "Men › Jeans"],
      ["Brand", "Levi's"],
      ["Size", "W32"],
      ["Condition", "Very good"],
      // 2.6 kg is over Vinted's 2 kg Small.
      ["Parcel size", "Medium"],
    ]);
    const ebay = handListingFields(base, "ebay");
    expect(ebay.find((f) => f.label === "Condition")?.value).toBe("Pre-owned - Excellent");
    // eBay's Small parcel goes up to 2 kg too, so it's bumped to Medium parcel.
    expect(ebay.find((f) => f.label === "Package size")).toMatchObject({ value: "Medium parcel", note: "Packed weight 2600 g." });
  });

  it("shortens eBay titles and adds book details", () => {
    const long = { ...base, title: "x".repeat(90), book: BookDetails.parse({ author: "Tolkien", isbn: "9780261102217", edition: "First edition", printing: "First impression", format: "hardback" }) };
    const ebay = handListingFields(long, "ebay");
    expect(ebay[0]).toMatchObject({ value: "x".repeat(80), note: "Shortened to eBay's 80 characters." });
    expect(handListingFields(long, "vinted")[0]!.value).toHaveLength(90);
    expect(pairs(ebay).slice(-4)).toEqual([["Author", "Tolkien"], ["ISBN", "9780261102217"], ["Format", "Hardback"], ["Edition", "First edition, First impression"]]);
  });
});
