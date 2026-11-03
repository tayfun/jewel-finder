// Reading listing data out of marketplace pages, for imports. Pages are fetched and parsed with
// DOMParser (no scripts run), so prefer what servers render for search engines: JSON-LD and meta
// tags first, then visible markup.
import { parseListingUrl, type Marketplace } from "@jf/shared";
import { normalize } from "./dom";

type Json = Record<string, unknown>;

/** Every JSON-LD object on the page, with arrays and @graph flattened. */
export function jsonLd(doc: Document): Json[] {
  const out: Json[] = [];
  const add = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(add);
    else if (v && typeof v === "object") {
      out.push(v as Json);
      if ("@graph" in v) add((v as Json)["@graph"]);
    }
  };
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      add(JSON.parse(s.textContent ?? ""));
    } catch {
      // malformed block; ignore
    }
  }
  return out;
}

const isType = (o: Json, type: string) => {
  const t = o["@type"];
  return t === type || (Array.isArray(t) && t.includes(type));
};

export function ldOfType(doc: Document, type: string): Json | null {
  return jsonLd(doc).find((o) => isType(o, type)) ?? null;
}

/** First value of a list-or-single JSON-LD field. */
export function first(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

/** A JSON-LD value as text: strings, numbers, or objects with a name. */
export function ldText(v: unknown): string {
  v = first(v);
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v && typeof v === "object" && typeof (v as Json).name === "string") return ((v as Json).name as string).trim();
  return "";
}

/** <meta property=… / name=…> content. */
export function meta(doc: Document, ...names: string[]): string {
  for (const n of names) {
    const el = doc.querySelector<HTMLMetaElement>(`meta[property="${n}"], meta[name="${n}"], meta[itemprop="${n}"]`);
    const v = el?.content?.trim();
    if (v) return v;
  }
  return "";
}

export function text(el: Element | null | undefined): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function textOf(root: ParentNode, ...selectors: string[]): string {
  for (const sel of selectors) {
    for (const el of root.querySelectorAll(sel)) {
      const t = text(el);
      if (t) return t;
    }
  }
  return "";
}

/**
 * The value shown next to a label ("Brand" → "Zara") in a details table. Looks for an element whose
 * own text is the label, then takes the next sibling of it or of one of its close ancestors.
 */
export function labelledValue(root: ParentNode, label: RegExp): string {
  for (const el of root.querySelectorAll<HTMLElement>("dt, th, td, span, div, p, label, h3, h4, li")) {
    if (el.children.length > 3) continue;
    const own = normalize(el.textContent).replace(/[:：]\s*$/, "");
    if (!own || own.length > 40 || !label.test(own)) continue;
    let node: Element | null = el;
    for (let i = 0; node && i < 3; i++, node = node.parentElement) {
      const value = text(node.nextElementSibling);
      if (value) return value;
    }
  }
  return "";
}

/** Converts description HTML to plain text, keeping paragraphs and line breaks. */
export function htmlToText(root: Element): string {
  const BLOCK = /^(P|DIV|LI|H[1-6]|TR|SECTION|ARTICLE|UL|OL|TABLE|BLOCKQUOTE|PRE|HR)$/;
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out += (node.nodeValue ?? "").replace(/\s+/g, " ");
      return;
    }
    if (!(node instanceof Element) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(node.tagName)) return;
    if (node.tagName === "BR") {
      out += "\n";
      return;
    }
    const block = BLOCK.test(node.tagName);
    if (block) out += "\n";
    if (node.tagName === "LI") out += "• ";
    node.childNodes.forEach(walk);
    if (block) out += "\n";
  };
  walk(root);
  return out
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Category path from BreadcrumbList JSON-LD or breadcrumb markup, without "Home" and the item itself. */
export function breadcrumbs(doc: Document, title: string, selectors: string[]): string {
  let names: string[] = [];
  const list = ldOfType(doc, "BreadcrumbList");
  if (Array.isArray(list?.itemListElement)) {
    names = (list.itemListElement as Json[])
      .slice()
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((e) => ldText(e.name) || ldText(e.item));
  }
  if (!names.length) {
    for (const sel of selectors) {
      names = [...doc.querySelectorAll(sel)].map(text);
      if (names.length) break;
    }
  }
  const skip = /^(home|ebay|vinted|back to.*|accueil|startseite)$/i;
  names = names.filter((n) => n && !skip.test(n));
  if (names.length && normalize(names.at(-1)) === normalize(title)) names.pop();
  return names.join(" › ");
}

/** The best URL an <img> offers: zoom/full-size attributes, then the largest srcset entry, then src. */
export function imgUrl(img: HTMLImageElement, base: string): string | null {
  const candidates = [img.getAttribute("data-zoom-src"), img.getAttribute("data-full-src")];
  const srcset = img.getAttribute("srcset") ?? img.getAttribute("data-srcset");
  if (srcset) {
    const best = srcset
      .split(",")
      .map((part) => part.trim().split(/\s+/))
      .map(([url, size]) => ({ url, n: Number.parseFloat(size ?? "0") || 0 }))
      .sort((a, b) => b.n - a.n)[0];
    candidates.push(best?.url ?? null);
  }
  candidates.push(img.getAttribute("data-src"), img.getAttribute("src"));
  for (const c of candidates) {
    if (!c || c.startsWith("data:")) continue;
    try {
      return new URL(c, base).href;
    } catch {
      // not a URL
    }
  }
  return null;
}

/** JSON-LD `image` → URLs (strings, ImageObjects, or lists of either). */
export function ldImages(v: unknown): string[] {
  const list = Array.isArray(v) ? v : v ? [v] : [];
  return list
    .map((i) => (typeof i === "string" ? i : i && typeof i === "object" ? ((i as Json).contentUrl ?? (i as Json).url) : null))
    .filter((u): u is string => typeof u === "string" && /^https?:/.test(u));
}

/** Dedupes photo URLs on a key that ignores the size variant (`key` maps a URL to its photo). */
export function uniquePhotos(urls: string[], key: (url: string) => string, max = 20): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const k = key(url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** One of the seller's listings as it appears on a listings page (wardrobe, Seller Hub, shop…). */
export interface ListingCard {
  externalId: string;
  url: string;
  title: string;
  /** As shown on the page, e.g. "£12.00". */
  price: string;
  thumb: string | null;
  element: HTMLElement;
}

/** Vinted's card titles and alt texts read "Hoodie, brand: Nike, condition: Good, size: M, £12.00…". */
export const withoutDetails = (s: string | null | undefined) =>
  (s ?? "").split(/,\s*(?:brand|condition|size|marque|état|taille|marke|zustand|größe|marca|stato|taglia)\b/i)[0]!.trim();

// Symbol-first prices ("£12.00", "EUR 12,00") are tried before symbol-after ones ("12,00 €"),
// so a nearby number such as an item id isn't mistaken for the amount.
const PRICE_BEFORE = /(?:[£$€]|\b(?:EUR|GBP|USD|CHF|PLN)\s?)\s?\d[\d.,]*/;
const PRICE_AFTER = /\d[\d.,]*\s?(?:€|zł|kr|Kč|Ft|lei|CHF)/;
export const priceIn = (s: string) => (s.match(PRICE_BEFORE) ?? s.match(PRICE_AFTER))?.[0] ?? "";

/**
 * Finds listings on any page by their links: each distinct listing id becomes one card, whose
 * element is the largest ancestor of its link that holds no other listing.
 */
export function findListingCards(marketplace: Marketplace, root: ParentNode, ignore?: Element | null): ListingCard[] {
  const links = new Map<string, { url: string; anchors: HTMLAnchorElement[] }>();
  for (const a of root.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (ignore?.contains(a)) continue;
    const parsed = parseListingUrl(marketplace, a.href);
    if (!parsed) continue;
    const entry = links.get(parsed.externalId) ?? { url: parsed.url, anchors: [] };
    entry.anchors.push(a);
    links.set(parsed.externalId, entry);
  }
  const idsIn = (el: Element) => {
    const ids = new Set<string>();
    for (const a of el.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      const id = parseListingUrl(marketplace, a.href)?.externalId;
      if (id) ids.add(id);
      if (ids.size > 1) break;
    }
    return ids;
  };

  const cards: ListingCard[] = [];
  for (const [externalId, { url, anchors }] of links) {
    let card: HTMLElement = anchors[0]!;
    for (let i = 0; i < 6; i++) {
      const parent: HTMLElement | null = card.parentElement;
      if (!parent || parent === root || parent.tagName === "BODY" || idsIn(parent).size > 1) break;
      card = parent;
    }
    const img = card.querySelector<HTMLImageElement>("img");
    const title =
      withoutDetails(anchors.map((a) => a.getAttribute("title")).find((t) => t?.trim())) ||
      textOf(card, '[data-testid$="title"]', "h2", "h3", "h4") ||
      withoutDetails(img?.getAttribute("alt")) ||
      anchors.map((a) => text(a)).sort((a, b) => b.length - a.length)[0] ||
      `Listing ${externalId}`;
    cards.push({
      externalId,
      url,
      title: title.slice(0, 200),
      price: priceIn(text(card)),
      thumb: img ? imgUrl(img, card.ownerDocument.baseURI) : null,
      element: card,
    });
  }
  return cards;
}
