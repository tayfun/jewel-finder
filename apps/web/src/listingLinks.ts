import { MARKETPLACE_LABELS, extractUrl, isShortListingLink, parseListingUrl, type Marketplace } from "@jf/shared";
import { api } from "./api";

const EXAMPLE: Record<Marketplace, string> = { vinted: "vinted.co.uk/items/123…", ebay: "ebay.co.uk/itm/123…" };
/** "a Vinted", "an eBay". */
const withArticle = (m: Marketplace) => `${m === "ebay" ? "an" : "a"} ${MARKETPLACE_LABELS[m]}`;

/**
 * The listing a pasted link points at: a full listing address, an app's short share link (followed by the
 * API, e.g. https://ebay.io/m/…), or share text with a link in it. Throws a message for the seller.
 */
export async function toListingLink(marketplace: Marketplace, pasted: string): Promise<{ externalId: string; url: string }> {
  const site = MARKETPLACE_LABELS[marketplace];
  const url = extractUrl(pasted) ?? pasted.trim();
  const direct = parseListingUrl(marketplace, url);
  if (direct) return direct;
  if (isShortListingLink(url)) {
    const found = await api<{ marketplace: Marketplace; externalId: string; url: string }>("/api/resolve-link", { json: { url } });
    if (found.marketplace !== marketplace) throw new Error(`That link is for ${withArticle(found.marketplace)} listing, not ${site}.`);
    return found;
  }
  throw new Error(`That doesn't look like ${withArticle(marketplace)} listing link. It should look like ${EXAMPLE[marketplace]}`);
}
