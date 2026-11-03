import type { BookFormat, Condition, ListingStatus, Marketplace, PackageSize, Rarity, Settings } from "./schemas";

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
