// Spotting the same physical item entered twice, e.g. imported from both Vinted and eBay.
// Pure functions so the Worker, the tests and anything else agree on what counts as a duplicate.
import { MARKETPLACES } from "./constants";
import { MARKETPLACE_LABELS } from "./marketplaces";
import type { ItemWithListings } from "./schemas";

/** Pairs scoring at least this are shown as possible duplicates. */
export const DUPLICATE_THRESHOLD = 0.8;

export interface DuplicateMatch {
  /** 0–1. */
  score: number;
  /** Why they look alike, for the seller ("Same brand", "Listed on Vinted and eBay"…). */
  reasons: string[];
}

export interface DuplicatePair extends DuplicateMatch {
  a: ItemWithListings;
  b: ItemWithListings;
}

// Words that say nothing about which item it is: grammar, and marketplace title filler.
const STOP = new Set(
  (
    "a an and or the of for with in on to by from at as is it this that " +
    "new used brand bnwt bnwot nwt nwot tags tag vgc gc excellent good condition great vintage rare " +
    "free postage post p&p fast dispatch uk size sz copy"
  ).split(" "),
);

const fold = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "");

/** Meaningful words of a title, lowercased, accents and punctuation dropped. */
export function titleTokens(title: string): Set<string> {
  return new Set(
    fold(title)
      .split(/[^a-z0-9]+/)
      .filter((t) => t && !STOP.has(t)),
  );
}

/** How alike two titles are, 0–1. Containment matters most: eBay titles add keywords to the same words. */
export function titleSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const small = Math.min(a.size, b.size);
  // One-word titles only match exactly; otherwise at least two words must be shared.
  if (small === 1 ? shared < 1 || a.size !== b.size : shared < 2) return 0;
  const containment = shared / small;
  const jaccard = shared / (a.size + b.size - shared);
  return 0.7 * containment + 0.3 * jaccard;
}

const sameText = (a: string, b: string) => fold(a).replace(/[^a-z0-9]/g, "") === fold(b).replace(/[^a-z0-9]/g, "");

/** Sizes agree when they share a token or a number: "W32" ~ "W32 L30" ~ "32", but "S" ≁ "XS". */
export function sizesAgree(a: string, b: string): boolean {
  const parts = (s: string) => {
    const tokens = fold(s).split(/[^a-z0-9]+/).filter(Boolean);
    return new Set([...tokens, ...tokens.flatMap((t) => t.match(/\d+/g) ?? [])]);
  };
  const pa = parts(a);
  for (const t of parts(b)) if (pa.has(t)) return true;
  return false;
}

const LIVE = new Set(["listed", "ending", "pending"]);
const liveOn = (item: ItemWithListings) => new Set(item.listings.filter((l) => LIVE.has(l.status)).map((l) => l.marketplace));

/**
 * How likely two items are the same physical item, or null when something rules it out
 * (different ISBN, author, brand or size, or both live on the same marketplace). Cheap enough to run on every pair of a 1000-item inventory.
 */
export function duplicateMatch(
  a: ItemWithListings,
  b: ItemWithListings,
  tokens: { a?: Set<string>; b?: Set<string> } = {},
): DuplicateMatch | null {
  if (a.status === "archived" || b.status === "archived") return null;
  // Two sold items with one title are usually two copies, and nothing is left to fix.
  if (a.status === "sold" && b.status === "sold") return null;
  // Both live on the same site: two copies (or one listed twice), and an item holds one listing per site.
  for (const m of liveOn(a)) if (liveOn(b).has(m)) return null;

  const reasons: string[] = [];
  const isbnA = a.book?.isbn ?? "";
  const isbnB = b.book?.isbn ?? "";
  if (isbnA && isbnB && isbnA !== isbnB) return null;
  const authorA = a.book?.author ?? "";
  const authorB = b.book?.author ?? "";
  if (authorA && authorB && !sameText(authorA, authorB)) return null;
  if (a.brand && b.brand && !sameText(a.brand, b.brand)) return null;
  if (a.size && b.size && !sizesAgree(a.size, b.size)) return null;

  const title = titleSimilarity(tokens.a ?? titleTokens(a.title), tokens.b ?? titleTokens(b.title));
  let score = title;
  if (sameText(a.title, b.title)) reasons.push("Same title");
  else if (title >= 0.6) reasons.push("Similar title");

  if (isbnA && isbnA === isbnB) {
    score = Math.max(score, 0.95);
    reasons.unshift("Same ISBN");
  }
  if (title === 0 && !reasons.length) return null;

  if (authorA && authorB) {
    score += 0.1;
    reasons.push("Same author");
  }
  if (a.brand && b.brand) {
    score += 0.1;
    reasons.push("Same brand");
  }
  if (a.size && b.size) {
    score += 0.1;
    reasons.push("Same size");
  }
  if (a.colour && b.colour) score += sameText(a.colour, b.colour) ? 0.05 : -0.15;
  if (a.price != null && b.price != null && a.price > 0 && b.price > 0) {
    const ratio = Math.max(a.price, b.price) / Math.min(a.price, b.price);
    if (ratio <= 1.25) {
      score += 0.05;
      reasons.push("Similar price");
    } else if (ratio > 2) score -= 0.1;
  }

  // One live on Vinted, the other on eBay: the classic double import.
  const liveA = liveOn(a);
  const liveB = liveOn(b);
  if (liveA.size && liveB.size) {
    score += 0.1;
    const names = MARKETPLACES.filter((m) => liveA.has(m) || liveB.has(m)).map((m) => MARKETPLACE_LABELS[m]);
    reasons.push(`Listed on ${names.join(" and ")}`);
  }

  score = Math.max(0, Math.min(1, score));
  return { score: Math.round(score * 100) / 100, reasons };
}

/** Key for a pair regardless of order, used to remember "not duplicates". */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Likely duplicate pairs, best first. `dismissed` holds pairKeys the seller said aren't duplicates;
 * with `onlyIds`, only pairs involving one of those items are returned.
 */
export function findDuplicatePairs(
  items: ItemWithListings[],
  dismissed: Set<string> = new Set(),
  onlyIds?: Set<string>,
): DuplicatePair[] {
  const tokens = items.map((i) => titleTokens(i.title));
  // Only compare items sharing a title word (or an ISBN), not every pair.
  const byKey = new Map<string, number[]>();
  items.forEach((item, i) => {
    const keys = [...tokens[i]!];
    if (item.book?.isbn) keys.push(`isbn:${item.book.isbn}`);
    for (const k of keys) byKey.set(k, [...(byKey.get(k) ?? []), i]);
  });
  const seen = new Set<string>();
  const pairs: DuplicatePair[] = [];
  for (const group of byKey.values()) {
    if (group.length > 200) continue; // a word on every other item tells us nothing
    for (let x = 0; x < group.length; x++) {
      for (let y = x + 1; y < group.length; y++) {
        const i = group[x]!;
        const j = group[y]!;
        const a = items[i]!;
        const b = items[j]!;
        if (onlyIds && !onlyIds.has(a.id) && !onlyIds.has(b.id)) continue;
        const key = pairKey(a.id, b.id);
        if (seen.has(key)) continue;
        seen.add(key);
        if (dismissed.has(key)) continue;
        const match = duplicateMatch(a, b, { a: tokens[i], b: tokens[j] });
        if (match && match.score >= DUPLICATE_THRESHOLD) pairs.push({ a, b, ...match });
      }
    }
  }
  // Scores cap at 1, so more independent evidence breaks ties.
  return pairs.sort((p, q) => q.score - p.score || q.reasons.length - p.reasons.length);
}
