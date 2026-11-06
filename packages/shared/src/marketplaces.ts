import type { BookFormat, Condition, Item, Listing, ListingStatus, Marketplace, PackageSize, Rarity, Settings } from "./schemas";

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  vinted: "Vinted",
  ebay: "eBay",
};

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  pending: "Pending",
  listed: "Listed",
  ending: "Needs ending",
  sold: "Sold",
  ended: "Ended",
  failed: "Failed",
};

export const CONDITION_LABELS: Record<Condition, string> = {
  new_with_tags: "New with tags",
  new_without_tags: "New without tags",
  very_good: "Very good",
  good: "Good",
  satisfactory: "Satisfactory",
};

export const BOOK_FORMAT_LABELS: Record<BookFormat, string> = {
  hardback: "Hardback",
  paperback: "Paperback",
  mass_market_paperback: "Mass-market paperback",
  leather: "Leather bound",
  spiral: "Spiral bound",
  other: "Other",
};

export const RARITY_LABELS: Record<Rarity, string> = {
  common: "Common",
  uncommon: "Uncommon",
  scarce: "Scarce",
  rare: "Rare",
  very_rare: "Very rare",
};

export const PACKAGE_SIZE_LABELS: Record<PackageSize, string> = {
  large_letter: "Large letter",
  small: "Small parcel",
  medium: "Medium parcel",
  large: "Large parcel",
};

export const PACKAGE_SIZE_HINTS: Record<PackageSize, string> = {
  large_letter: "Up to 35 × 25 × 2.5 cm, 1 kg",
  small: "Up to 45 × 35 × 16 cm, 2 kg",
  medium: "Up to 61 × 46 × 46 cm",
  large: "Anything bigger",
};

const ORDER: PackageSize[] = ["large_letter", "small", "medium", "large"];

/** Moves up a band while the weight is over its limit. */
function bump<T extends PackageSize>(size: T, weightGrams: number | null, maxGrams: Partial<Record<T, number>>, order: T[]): T {
  let i = order.indexOf(size);
  while (i < order.length - 1 && weightGrams != null && weightGrams > (maxGrams[order[i]!] ?? Infinity)) i++;
  return order[i]!;
}

/** eBay UK's package size for an item: same bands as ours, bumped by weight. */
export function ebayPackageSize(item: { packageSize: PackageSize | null; weightGrams: number | null }): PackageSize | null {
  if (!item.packageSize) return null;
  return bump(item.packageSize, item.weightGrams, { large_letter: 1000, small: 2000, medium: 20_000 }, ORDER);
}

export type VintedPackageSize = "small" | "medium" | "large";
export const VINTED_PACKAGE_LABELS: Record<VintedPackageSize, string> = { small: "Small", medium: "Medium", large: "Large" };

/** Vinted's parcel size: Small (≤2 kg), Medium (≤5 kg), Large (≤10 kg). Large letters go as Small. */
export function vintedPackageSize(item: { packageSize: PackageSize | null; weightGrams: number | null }): VintedPackageSize | null {
  if (!item.packageSize) return null;
  const size = item.packageSize === "large_letter" ? "small" : item.packageSize;
  return bump<VintedPackageSize>(size, item.weightGrams, { small: 2000, medium: 5000 }, ["small", "medium", "large"]);
}

/** A leaf in Vinted's category tree, as its search shows it: "Fiction" under "Books & Media > Books". */
export interface VintedCategory {
  name: string;
  parent: string;
  /** Set when it's a guess rather than from the item's own category: why, for the seller to check. */
  guess?: string;
}

const BOOKS = "Books & Media > Books";

/**
 * Where an item goes on Vinted, from our category (usually an eBay path like "Media › Books, Comics &
 * Magazines › Books") and the title/tags. Only books, comics and magazines for now. Going by a word in the
 * title, or Fiction for a book that says nothing either way (most of those we sell are novels), is a guess.
 */
export function vintedCategory(item: Pick<Item, "category" | "title" | "tags" | "book">): VintedCategory | null {
  const path = item.category.toLowerCase();
  // eBay's umbrella "Books, Comics & Magazines" says nothing about which of the three it is.
  const category = path.replace(/books,? comics,? (&|and) magazines/g, "");
  const words = [item.title, ...item.tags].join(" ").toLowerCase();
  if (!item.book && !has(/\b(books?|magazines?|comics?|manga|graphic novels?)\b/, path)) return null;

  // From our category, or else a guess from the title naming the word that decided it.
  const match = (re: RegExp, name: string, parent = BOOKS, useWords = true): VintedCategory | null => {
    if (re.test(category)) return { name, parent };
    const word = useWords ? words.match(re)?.[0] : undefined;
    return word ? { name, parent, guess: `"${word}" in the title` } : null;
  };
  return (
    match(/\bmagazines?\b/, "Magazines", "Books & Media", false) ??
    match(/\b(comics?|manga|graphic novels?)\b/, "Comics, manga & graphic novels") ??
    match(/\b(text ?books?|study guides?|revision)\b/, "Textbooks & study materials") ??
    match(/\b(colou?ring|puzzle|activity) books?\b/, "Colouring, puzzle & activity books") ??
    match(/\b(young adults?|ya|teen)\b/, "Young adults", `${BOOKS} > Kids & young adults`, false) ??
    match(/\b(children'?s|kids)\b/, "Kids", `${BOOKS} > Kids & young adults`, false) ??
    match(/\bnon-?fiction\b/, "Non-fiction") ??
    match(/\b(science )?fiction\b/, "Fiction") ??
    fictionFromWords(words) ?? { name: "Fiction", parent: BOOKS, guess: "nothing in the title says fiction or non-fiction" }
  );
}

function fictionFromWords(words: string): VintedCategory | null {
  const fiction = words.match(/\b(novels?|poems|poetry|plays|short stories|thriller|crime|mystery|fantasy|sci-?fi|romance)\b/)?.[0];
  const nonFiction = words.match(
    /\b(guides?|history|biography|memoir|cook ?book|recipes?|dictionary|handbook|introduction|vsi|essays|science|philosophy|travel|atlas)\b/,
  )?.[0];
  if (!fiction === !nonFiction) return null; // neither, or both
  return { name: fiction ? "Fiction" : "Non-fiction", parent: BOOKS, guess: `"${fiction ?? nonFiction}" in the title` };
}

const has = (re: RegExp, ...texts: string[]) => texts.some((t) => re.test(t));

const LANGUAGES = ["English", "Turkish", "French", "German", "Spanish", "Italian", "Portuguese", "Dutch", "Russian", "Greek", "Polish", "Arabic", "Japanese", "Chinese"];

/**
 * A book's language: the one saved with it, else a guess: a language named in the title or tags ("… Turkish"),
 * else Turkish when the title uses Turkish letters, else English. `guess` says why when it's a guess.
 */
export function bookLanguage(item: Pick<Item, "title" | "tags" | "book">): { language: string; guess?: string } {
  if (item.book?.language) return { language: item.book.language };
  const words = [item.title, ...item.tags].join(" ");
  const named = LANGUAGES.find((l) => new RegExp(`\\b${l}\\b`, "i").test(words));
  if (named) return { language: named, guess: `"${named}" in the title` };
  if (/[şŞğĞıİ]/.test(item.title)) return { language: "Turkish", guess: "Turkish letters in the title" };
  return { language: "English", guess: "none saved, so the default" };
}

/** What to put in Vinted's ISBN box when we don't have one: accepted as valid, matches no book. */
export const VINTED_NO_ISBN = "0000000000000";

/** Checks an ISBN-10/13 check digit (input already stripped of spaces and hyphens). */
export function isValidIsbn(isbn: string): boolean {
  if (/^\d{9}[\dX]$/.test(isbn)) {
    const sum = [...isbn].reduce((acc, c, i) => acc + (c === "X" ? 10 : Number(c)) * (10 - i), 0);
    return sum % 11 === 0;
  }
  if (/^\d{13}$/.test(isbn)) {
    const sum = [...isbn].reduce((acc, c, i) => acc + Number(c) * (i % 2 ? 3 : 1), 0);
    return sum % 10 === 0;
  }
  return false;
}

/** Closest eBay condition names (clothing/general categories). */
export const EBAY_CONDITION_LABELS: Record<Condition, string> = {
  new_with_tags: "New with tags",
  new_without_tags: "New without tags",
  very_good: "Pre-owned - Excellent",
  good: "Pre-owned - Good",
  satisfactory: "Pre-owned - Fair",
};

/** Page the extension opens to start a new listing. */
export function sellUrl(marketplace: Marketplace, settings: Settings, title = ""): string {
  if (marketplace === "vinted") return `https://${settings.vintedDomain}/items/new`;
  const q = title ? `?sr=wnstart&keyword=${encodeURIComponent(title)}` : "";
  return `https://${settings.ebayDomain}/sl/prelist/suggest${q}`;
}

/** Recognise a published listing URL and pull its id out of it. */
export function parseListingUrl(
  marketplace: Marketplace,
  url: string,
): { externalId: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (marketplace === "vinted") {
    if (!/(^|\.)vinted\./.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/items\/(\d+)(?:-[^/]*)?\/?$/);
    return m?.[1] ? { externalId: m[1], url: `${u.origin}${u.pathname}` } : null;
  }
  if (!/(^|\.)ebay\./.test(u.hostname)) return null;
  const m = u.pathname.match(/^\/itm\/(?:[^/]+\/)?(\d{9,})\/?$/);
  return m?.[1] ? { externalId: m[1], url: `${u.origin}/itm/${m[1]}` } : null;
}

/** Public URL for an image key, given the API origin. */
export function imageUrl(apiBase: string, key: string): string {
  return `${apiBase.replace(/\/$/, "")}/images/${key}`;
}

/**
 * Where the seller's own listings are, for importing. Vinted's wardrobe URL needs the member id,
 * so we open the home page and the extension follows the profile link from there.
 */
export function myListingsUrl(marketplace: Marketplace, settings: Settings): string {
  if (marketplace === "vinted") return `https://${settings.vintedDomain}/`;
  return `https://${settings.ebayDomain}/sh/lst/active`;
}

/**
 * Our condition for a marketplace's condition text (Vinted's scale, eBay's names, or a schema.org
 * itemCondition URL). Null when it can't tell, e.g. a bare "Used".
 */
export function conditionFromText(text: string | null | undefined): Condition | null {
  const s = (text ?? "").toLowerCase().replace(/^https?:\/\/schema\.org\//, "").replace(/[\s_-]+/g, " ").trim();
  if (!s) return null;
  if (/new with (tags|box)|brand new with/.test(s)) return "new_with_tags";
  if (/new without (tags|box)|new with defects|new other|^(brand )?new( condition)?$|^newcondition$/.test(s)) return "new_without_tags";
  if (/excellent|very good|like new|as new|refurbished/.test(s)) return "very_good";
  if (/satisfactory|fair|acceptable|for parts/.test(s)) return "satisfactory";
  if (/good/.test(s)) return "good";
  return null;
}

/** A price as a marketplace writes it ("£12.50", "12,50 €", "1.234,00", 12.5) → minor units. */
export function priceToMinor(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) && input >= 0 ? Math.round(input * 100) : null;
  const m = input.replace(/\s/g, "").match(/\d[\d.,]*/);
  if (!m) return null;
  let s = m[0].replace(/[.,]$/, "");
  // The last separator followed by 1–2 digits is the decimal point; the rest group thousands.
  const dec = s.match(/[.,](\d{1,2})$/);
  const whole = (dec ? s.slice(0, -dec[0].length) : s).replace(/[.,]/g, "");
  s = dec ? `${whole}.${dec[1]}` : whole;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

const DAY = 86_400_000;

/** Days after which a live listing on this marketplace counts as stale (from settings). */
export function relistAfterDays(marketplace: Marketplace, settings: Settings): number {
  return marketplace === "vinted" ? settings.vintedRelistDays : settings.ebayRelistDays;
}

/** Whole days since the listing went live, or null if we don't know. */
export function listingAgeDays(listing: Pick<Listing, "listedAt">, now = Date.now()): number | null {
  return listing.listedAt == null ? null : Math.max(0, Math.floor((now - listing.listedAt) / DAY));
}

/** A live listing of an in-stock item that's been up longer than the relist interval. */
export function isStale(
  item: Pick<Item, "status">,
  listing: Pick<Listing, "status" | "listedAt" | "marketplace">,
  settings: Settings,
  now = Date.now(),
): boolean {
  if (item.status !== "in_stock" || listing.status !== "listed") return false;
  const age = listingAgeDays(listing, now);
  return age != null && age >= relistAfterDays(listing.marketplace, settings);
}

/** One value to copy into a marketplace's sell form by hand (phone hand-off, no extension). */
export interface HandField {
  label: string;
  value: string;
  /** Long text, shown as a block. */
  long?: boolean;
  /** A caution about this value, e.g. it was shortened. */
  note?: string;
}

/**
 * What to copy into Vinted's or eBay's own sell form, worded the way that marketplace's form does
 * (its condition names, its parcel sizes). Empty values are left out.
 */
export function handListingFields(
  item: Pick<Item, "title" | "description" | "price" | "brand" | "category" | "size" | "colour" | "condition" | "book" | "packageSize" | "weightGrams">,
  marketplace: Marketplace,
): HandField[] {
  const ebay = marketplace === "ebay";
  const title = ebay ? item.title.slice(0, 80) : item.title;
  const parcel = ebay ? ebayPackageSize(item) : vintedPackageSize(item);
  const book = item.book;
  const fields: HandField[] = [
    { label: "Title", value: title, note: ebay && item.title.length > 80 ? "Shortened to eBay's 80 characters." : undefined },
    { label: "Description", value: item.description, long: true },
    { label: "Price", value: item.price == null ? "" : (item.price / 100).toFixed(2) },
    { label: "Category", value: item.category },
    { label: "Brand", value: item.brand },
    { label: "Size", value: item.size },
    { label: "Condition", value: item.condition ? (ebay ? EBAY_CONDITION_LABELS : CONDITION_LABELS)[item.condition] : "" },
    { label: "Colour", value: item.colour },
    {
      label: ebay ? "Package size" : "Parcel size",
      value: parcel ? (ebay ? PACKAGE_SIZE_LABELS[parcel as PackageSize] : VINTED_PACKAGE_LABELS[parcel as VintedPackageSize]) : "",
      note: parcel && item.weightGrams ? `Packed weight ${item.weightGrams} g.` : undefined,
    },
    { label: "Author", value: book?.author ?? "" },
    { label: "ISBN", value: book?.isbn ?? "" },
    { label: "Publisher", value: book?.publisher ?? "" },
    { label: "Year", value: book?.yearPublished ? String(book.yearPublished) : "" },
    { label: "Format", value: book?.format ? BOOK_FORMAT_LABELS[book.format] : "" },
    { label: "Edition", value: [book?.edition, book?.printing].filter(Boolean).join(", ") },
  ];
  return fields.filter((f) => f.value.trim());
}

/** Short links marketplace apps' Share buttons hand out; they redirect to the listing (resolved by the API). */
export const SHORT_LINK_HOSTS = ["ebay.io", "ebay.us"] as const;

export function isShortListingLink(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (SHORT_LINK_HOSTS as readonly string[]).includes(u.hostname.replace(/^www\./, ""));
  } catch {
    return false;
  }
}

/** The first web address in pasted text: apps' Share often gives "Check out this item on eBay! https://…". */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  return m ? m[0].replace(/[).,!?;:'"]+$/, "") : null;
}
