// Reading comparable listings ("comps") off marketplace search pages, for price checks (PRICING.md §2).
import { priceToMinor, type Comp, type CompSource } from "@jf/shared";
import { send } from "../messages";
import { waitFor } from "./dom";
import { findListingCards, imgUrl, priceIn, text, textOf, withoutDetails } from "./scrape";

/** All of an element's text with its text nodes separated, so neighbours don't run together. */
function spaced(el: Element): string {
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? "");
  return parts.join(" ").replace(/\s+/g, " ");
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "Sold 12 Oct 2026" / "Sold  3 Nov 2026" → timestamp (UTC midnight), or null. */
export function soldDate(s: string): number | null {
  // No word boundary before "Sold": adjacent elements' text runs together ("…1937Sold 12 Oct 2026").
  const m = s.match(/(?:^|[^a-z])sold\s+(\d{1,2})\s+([a-z]{3})[a-z]*\.?\s+(\d{4})\b/i);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  return month < 0 ? null : Date.UTC(Number(m[3]), month, Number(m[1]));
}

/** eBay search results (sold or listed). Works on both the s-item and the newer s-card markup. */
export function parseEbayResults(doc: Document, source: CompSource): Comp[] {
  // Only the main results: not carousels, and not "results matching fewer words" below the divider.
  const river = doc.querySelector(".srp-results, #srp-river-results, ul.srp-list") ?? doc.body;
  if (!river) return [];
  const divider = river.querySelector(".srp-river-answer--REWRITE_START, li.srp-river-answer");
  const comps: Comp[] = [];
  for (const card of findListingCards("ebay", river)) {
    if (divider && divider.compareDocumentPosition(card.element) & Node.DOCUMENT_POSITION_FOLLOWING) continue;
    const el = card.element;
    const title = (textOf(el, ".s-item__title", ".s-card__title", '[role="heading"]') || card.title)
      .replace(/^(new listing|sponsored)\s*/i, "")
      .replace(/\s*opens in a new window or tab$/i, "")
      .trim();
    if (!title || /^shop on ebay$/i.test(title)) continue;
    const priceEl = el.querySelector(".s-item__price, .s-card__price");
    // Struck-through: a best offer was accepted for less than shown, and we can't see how much.
    if (priceEl?.querySelector(".STRIKETHROUGH, s, del") || priceEl?.matches(".STRIKETHROUGH")) continue;
    const priceText = priceEl ? text(priceEl) : card.price;
    if (/\bto\b/i.test(priceText)) continue; // a range: listing with variations
    const price = priceToMinor(priceIn(priceText) || priceText);
    if (!price) continue;
    const img = el.querySelector<HTMLImageElement>("img");
    comps.push({
      source,
      title: title.slice(0, 300),
      price,
      url: card.url,
      soldAt: source === "ebay_sold" ? soldDate(textOf(el, ".s-item__caption--signal", ".s-card__caption", ".s-item__title--tag") || spaced(el)) : null,
      condition: textOf(el, ".SECONDARY_INFO", ".s-card__subtitle") || undefined,
      imageUrl: img ? imgUrl(img, doc.baseURI) : null,
    });
  }
  return comps;
}

/** Vinted catalog: card link titles read "Hoodie, brand: Nike, condition: Good, size: M, £12.00, …". */
export function parseVintedResults(doc: Document): Comp[] {
  const comps: Comp[] = [];
  for (const card of findListingCards("vinted", doc.body ?? doc)) {
    const described =
      [...card.element.querySelectorAll<HTMLAnchorElement>("a[title]")].map((a) => a.title).find((t) => /,\s*(brand|condition|size)\b/i.test(t)) ??
      card.element.querySelector("img")?.getAttribute("alt") ??
      "";
    const field = (name: string) => described.match(new RegExp(`\\b${name}:\\s*([^,]+)`, "i"))?.[1]?.trim();
    const brand = field("brand");
    const name = withoutDetails(described) || card.title;
    const title = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? `${brand} ${name}` : name;
    // The first price is the item's; the second includes Vinted's buyer protection fee.
    const price = priceToMinor(priceIn(described) || card.price);
    if (!title || !price) continue;
    comps.push({
      source: "vinted_listed",
      title: title.slice(0, 300),
      price,
      url: card.url,
      condition: field("condition"),
      size: field("size"),
      imageUrl: card.thumb,
    });
  }
  return comps;
}

/** In a comps tab: wait for the results to render, read them and hand them to the background. */
export async function runComps(source: CompSource): Promise<void> {
  const parse = () => (source === "vinted_listed" ? parseVintedResults(document) : parseEbayResults(document, source));
  const empty = () => /no (exact )?matches found|no results|0 results|we couldn't find/i.test(document.body?.innerText ?? "");
  const found = await waitFor(() => (parse().length ? true : empty() ? true : null), 15_000, 500);
  const comps = found ? parse() : [];
  const problem = found ? undefined : "Couldn't read the search results (the page may have asked to confirm you're human).";
  await send({ type: "COMPS_FOUND", comps, problem }).catch(() => {});
}
