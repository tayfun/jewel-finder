import { MARKETPLACE_LABELS, type ImportListing, type Marketplace } from "@jf/shared";
import type { ScrapedListing } from "../messages";

/** Image CDNs the background may download listing photos from (also in the manifest's host permissions). */
export function isPhotoHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (/(^|\.)vinted\.net$/.test(u.hostname) || /(^|\.)ebayimg\.com$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Where eBay serves item descriptions from (an iframe on the item page). */
export function isDescriptionHost(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && /(^|\.)ebaydesc\.com$/.test(u.hostname);
  } catch {
    return false;
  }
}

const MAX_PRICE = 100_000_000;
const cut = (s: string, n: number) => s.trim().slice(0, n).trim();

/** Turns what the page said into an import that passes the API's validation (lengths, ranges). */
export function toImportListing(marketplace: Marketplace, listing: ScrapedListing, images: string[]): ImportListing {
  const price = listing.price != null && listing.price >= 0 && listing.price <= MAX_PRICE ? Math.round(listing.price) : null;
  const sold = listing.state === "sold";
  return {
    externalId: listing.externalId,
    url: listing.url,
    state: listing.state,
    item: {
      title: cut(listing.title, 120) || `${MARKETPLACE_LABELS[marketplace]} listing ${listing.externalId}`,
      description: listing.description.trim().slice(0, 5000),
      brand: cut(listing.brand, 80),
      category: cut(listing.category, 120),
      size: cut(listing.size, 40),
      colour: cut(listing.colour, 40),
      condition: listing.condition,
      price,
      quantity: sold ? 0 : 1,
      status: sold ? "sold" : "in_stock",
      images: images.slice(0, 20),
    },
  };
}
