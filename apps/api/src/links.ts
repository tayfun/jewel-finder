import { isShortListingLink, parseListingUrl, type Marketplace } from "@jf/shared";

const MAX_HOPS = 5;
const MAX_BODY = 300_000;

/** Hosts a short link may pass through on its way to the listing. */
const ALLOWED_HOP = /(^|\.)(ebay\.(com|co\.uk|de|fr|it|es|ie|at|nl|be|ch|pl|com\.au|ca)|ebay\.io|ebay\.us|vinted\.[a-z.]+)$/;

/** The marketplace couldn't be reached to follow the link (as opposed to: the link leads nowhere). */
export class LinkUnreachable extends Error {}

export interface ResolvedListing {
  marketplace: Marketplace;
  externalId: string;
  url: string;
}

function listing(url: string): ResolvedListing | null {
  for (const marketplace of ["ebay", "vinted"] as const) {
    const parsed = parseListingUrl(marketplace, url);
    if (parsed) return { marketplace, ...parsed };
  }
  return null;
}

/**
 * Follows a marketplace app's short share link (e.g. https://ebay.io/m/KSqSFz) to the listing it points at.
 * Only short-link hosts are accepted, and only hops within eBay's and Vinted's own domains are followed, so
 * this can't be used to fetch anything else. `fetcher` is injectable for tests.
 */
export async function resolveListingLink(link: string, fetcher: typeof fetch = fetch): Promise<ResolvedListing | null> {
  const direct = listing(link);
  if (direct) return direct;
  if (!isShortListingLink(link)) return null;

  let current = new URL(link);
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetcher(current.href, { redirect: "manual", headers: { Accept: "text/html" } });
    } catch {
      throw new LinkUnreachable(`Couldn't reach ${current.hostname} to check that link. Try again in a moment.`);
    }
    const location = res.headers.get("Location");
    if (res.status >= 300 && res.status < 400 && location) {
      const next = new URL(location, current);
      const found = listing(next.href);
      if (found) return found;
      if (next.protocol !== "https:" || !ALLOWED_HOP.test(next.hostname)) return null;
      current = next;
      continue;
    }
    if (!res.ok) return null;
    // Some short links answer with a page that points on (canonical link, meta refresh, app link).
    const html = (await res.text()).slice(0, MAX_BODY);
    const itm = html.match(/https:\/\/www\.ebay\.[a-z.]+\/itm\/(?:[^/"'\s<>]+\/)?\d{9,}/i)?.[0];
    return itm ? listing(itm) : null;
  }
  return null;
}
