import type { Condition, Marketplace, Settings } from "./schemas";

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
