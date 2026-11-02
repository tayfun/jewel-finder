import type { BookFormat, Condition, Marketplace, Rarity, Settings } from "./schemas";

export const MARKETPLACE_LABELS: Record<Marketplace, string> = {
  vinted: "Vinted",
  ebay: "eBay",
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
