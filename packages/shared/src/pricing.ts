// Pricing from comparables ("comps"): what the same or similar items sold for, or are listed at.
// Pure functions shared by the extension (queries), the Worker (summaries) and the web app (flags).
// See PRICING.md for the reasoning.
import { sizesAgree, titleSimilarity, titleTokens } from "./duplicates";
import type { Item, Marketplace } from "./schemas";

// ------------------------------------------------------------------ types

export type CompSource = "ebay_sold" | "ebay_listed" | "vinted_listed";

export const COMP_SOURCE_LABELS: Record<CompSource, string> = {
  ebay_sold: "Sold on eBay",
  ebay_listed: "Listed on eBay",
  vinted_listed: "Listed on Vinted",
};

/** One comparable listing read from a marketplace search. */
export interface Comp {
  source: CompSource;
  title: string;
  /** Item price in minor units, without postage. */
  price: number;
  url: string;
  /** When it sold (sold comps only). */
  soldAt?: number | null;
  /** Condition text as the marketplace shows it. */
  condition?: string;
  size?: string;
  imageUrl?: string | null;
  /** Found by an exact-edition search (ISBN), so the title needn't match closely. */
  exact?: boolean;
}

export type FeatureKey =
  | "first_edition"
  | "signed"
  | "limited"
  | "rare"
  | "proof"
  | "dust_jacket"
  | "hardback"
  | "paperback"
  | "new_with_tags";

export interface Feature {
  key: FeatureKey;
  label: string;
  /** Major features change the value a lot: comps without them aren't like for like. */
  major: boolean;
  /** What it was detected from, for the seller. */
  evidence: string;
}

export type CompVerdict = "match" | "ordinary" | "dropped";

export interface CompAssessment {
  verdict: CompVerdict;
  /** Why it was dropped, or which features it lacks ("ordinary"). */
  reason: string;
  /** 0–1 title similarity to the item. */
  similarity: number;
}

export type Confidence = "low" | "medium" | "high";

export interface PriceSuggestion {
  marketplace: Marketplace;
  /** sold: from sold prices; listed: from current asking prices only (less reliable). */
  basis: "sold" | "listed";
  price: number;
  low: number;
  high: number;
  /** Comps it was worked out from (after outliers were dropped). */
  count: number;
  confidence: Confidence;
  /** e.g. "12 sold on eBay, most recent 3 days ago". */
  note: string;
}

export interface PriceSummary {
  /** At most one per marketplace, best basis first. */
  suggestions: PriceSuggestion[];
  /** The item's special features (also shown without a price check). */
  features: Feature[];
  /** Median price of ordinary copies (lacking a major feature the item has): a floor, not a price. */
  ordinaryFloor: number | null;
  warnings: string[];
  /** One per comp, in the same order. */
  assessments: CompAssessment[];
}

// --------------------------------------------------------------- features

const FEATURE_LABELS: Record<FeatureKey, string> = {
  first_edition: "First edition",
  signed: "Signed",
  limited: "Limited edition",
  rare: "Rare",
  proof: "Proof copy",
  dust_jacket: "Dust jacket",
  hardback: "Hardback",
  paperback: "Paperback",
  new_with_tags: "New with tags",
};

const RX = {
  first_edition: /\b(1st|first)\s*(ed(ition)?|edn|printing|print|impression|issue|state)\b|\b1st\/1st\b|\bfirst (uk|us|american|british) edition\b/,
  /** Says outright it isn't the first edition. */
  not_first: /\b(book club|bce|reprint(ed)?|facsimile|later (printing|impression|edition)|first edition thus|\d+(nd|rd|th) (printing|impression|edition))\b/,
  signed: /\b(signed|inscribed|autograph(ed)?)\b/,
  not_signed: /\b(not|un)\s*signed\b|\bno signature\b|\bfacsimile signature\b/,
  limited: /\blimited (edition|run|printing)\b|\bnumbered (copy|edition)\b|\bno\.?\s*\d+\s*(of|\/)\s*\d+\b|\b\d+\s+of\s+\d{2,4} copies\b/,
  proof: /\b(uncorrected )?(proof|bound proof)\b|\badvance (reading|review) copy\b|\barc\b/,
  dust_jacket: /\bdust ?jacket\b|\bdust ?wrapper\b|\bd\/?j\b|\bwith (the )?jacket\b/,
  no_dust_jacket: /\b(no|without|missing|lacks?|lacking) (the )?(dust ?jacket|dust ?wrapper|d\/?j|jacket)\b/,
  hardback: /\b(hardback|hardcover|hard cover|hb|hc)\b/,
  paperback: /\b(paperback|softcover|soft cover|softback|pb)\b/,
  new_with_tags: /\b(bnwt|nwt|new with tags)\b/,
};

const norm = (s: string) => s.toLowerCase().replace(/[–—]/g, "-");

/** Features a comp's title claims (no item details to go on). */
export function compFeatures(title: string): Set<FeatureKey> {
  const t = norm(title);
  const out = new Set<FeatureKey>();
  if (RX.first_edition.test(t) && !RX.not_first.test(t)) out.add("first_edition");
  if (RX.signed.test(t) && !RX.not_signed.test(t)) out.add("signed");
  if (RX.limited.test(t)) out.add("limited");
  if (RX.proof.test(t)) out.add("proof");
  if (RX.dust_jacket.test(t) && !RX.no_dust_jacket.test(t)) out.add("dust_jacket");
  if (RX.hardback.test(t)) out.add("hardback");
  else if (RX.paperback.test(t)) out.add("paperback");
  if (RX.new_with_tags.test(t)) out.add("new_with_tags");
  return out;
}

type PricedItem = Pick<Item, "title" | "description" | "tags" | "book" | "condition" | "brand" | "size">;

/** The item's special features, with the evidence for each. */
export function specialFeatures(item: PricedItem): Feature[] {
  const book = item.book;
  const text = norm([item.title, item.description, item.tags.join(" ")].join("\n"));
  const found = new Map<FeatureKey, string>();
  const add = (key: FeatureKey, evidence: string) => {
    if (!found.has(key)) found.set(key, evidence);
  };

  if (book?.edition && /^(1st|first)\b/i.test(book.edition.trim()) && !RX.not_first.test(norm(book.edition))) {
    add("first_edition", `Edition: ${book.edition}`);
  }
  if (book?.printing && /^(1st|first)\b/i.test(book.printing.trim())) add("first_edition", `Printing: ${book.printing}`);
  if (RX.first_edition.test(text) && !RX.not_first.test(text)) add("first_edition", "Says first edition");

  if (book?.signed) add("signed", "Marked as signed");
  else if (RX.signed.test(text) && !RX.not_signed.test(text)) add("signed", "Says signed");

  if (RX.limited.test(text)) add("limited", "Says limited / numbered");
  if (book?.rarity && ["scarce", "rare", "very_rare"].includes(book.rarity)) {
    add("rare", `Rarity: ${book.rarity.replace("_", " ")}${book.rarityNotes ? ` (${book.rarityNotes.slice(0, 120)})` : ""}`);
  }
  if (RX.proof.test(text)) add("proof", "Says proof / advance copy");

  if (book?.dustJacket === true) add("dust_jacket", "Has its dust jacket");
  else if (book?.dustJacket == null && RX.dust_jacket.test(text) && !RX.no_dust_jacket.test(text)) add("dust_jacket", "Mentions dust jacket");

  if (book?.format === "hardback" || book?.format === "leather") add("hardback", "Format: hardback");
  else if (book?.format === "paperback" || book?.format === "mass_market_paperback") add("paperback", "Format: paperback");
  else if (RX.hardback.test(text)) add("hardback", "Says hardback");
  else if (RX.paperback.test(text)) add("paperback", "Says paperback");

  if (item.condition === "new_with_tags") add("new_with_tags", "Condition: new with tags");

  const firstEd = found.has("first_edition");
  return [...found].map(([key, evidence]) => ({
    key,
    label: FEATURE_LABELS[key],
    // A jacket makes or breaks a first edition hardback's value; otherwise it's a detail.
    major: ["first_edition", "signed", "limited", "rare", "proof"].includes(key) || (key === "dust_jacket" && firstEd),
    evidence,
  }));
}

// ----------------------------------------------------------------- words

/** Edition, format and condition vocabulary: features (compared separately), not what the item is. */
const FEATURE_WORDS = new Set(
  ("1st first 2nd second 3rd third edition editions ed edn impression printing print issue state signed inscribed " +
    "autographed limited numbered proof uncorrected advance copy hardback hardcover hb hc paperback softcover pb " +
    "dj dust jacket wrapper book books novel").split(" "),
);

/** The words that say which item it is: title words without single letters or feature vocabulary. */
export function identityTokens(text: string): Set<string> {
  return new Set([...titleTokens(text)].filter((w) => w.length > 1 && !FEATURE_WORDS.has(w)));
}

// ---------------------------------------------------------------- queries

/** Search text for comps, most specific first. Marketplace search ANDs every word, so keep them short. */
export function priceQueries(item: PricedItem): string[] {
  const words = [...identityTokens(item.title)];
  const feats = new Set(specialFeatures(item).map((f) => f.key));
  const queries: string[] = [];
  const isbn = item.book?.isbn;
  if (isbn) queries.push(isbn);

  if (item.book && (item.book.author || isbn)) {
    const surname = (item.book.author.split(/[\s,]+/).filter((w) => w.length > 1).at(-1) ?? "").toLowerCase();
    const titleWords = words.filter((w) => w !== surname).slice(0, 5);
    const base = [...titleWords, surname].filter(Boolean);
    const extra = [feats.has("first_edition") && "first edition", feats.has("signed") && "signed"].filter(Boolean) as string[];
    if (extra.length) queries.push([...base, ...extra].join(" "));
    queries.push(base.join(" "));
  } else {
    const brand = [...identityTokens(item.brand)];
    const rest = words.filter((w) => !brand.includes(w));
    queries.push([...brand, ...rest].slice(0, 6).join(" "));
    if (rest.length > 3) queries.push([...brand, ...rest.slice(0, 3)].join(" "));
  }
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))];
}

// ---------------------------------------------------------------- verdicts

const LOT = /\b(job ?lot|bundle|joblot|collection of|set of \d+|x\s?\d{1,3}\b|\d+\s?x\b|lot of \d+|\d+ books)\b/;
const PARTS = /\b(for parts|spares( or| and)? repairs?|not working|faulty|broken)\b/;
const NOT_THE_THING = /\b(wanted|empty box|box only|dust jacket only|jacket only|case only)\b/;

const MAJOR: FeatureKey[] = ["first_edition", "signed", "limited", "proof"];

/** Is this comp the same kind of thing as the item, and like for like on what matters? */
export function assessComp(item: PricedItem, comp: Comp, itemFeatures = specialFeatures(item)): CompAssessment {
  const title = norm(comp.title);
  const itemTitle = norm(item.title);
  const tokens = identityTokens([item.title, item.book?.author ?? ""].join(" "));
  const similarity = Math.round(titleSimilarity(tokens, identityTokens(comp.title)) * 100) / 100;
  const drop = (reason: string): CompAssessment => ({ verdict: "dropped", reason, similarity });

  if (!(comp.price > 0)) return drop("No price");
  if (!comp.exact && similarity < 0.5) return drop("Different item");
  if (LOT.test(title) && !LOT.test(itemTitle)) return drop("Lot or bundle");
  if (PARTS.test(title) && !PARTS.test(itemTitle)) return drop("For parts / faulty");
  if (NOT_THE_THING.test(title)) return drop("Not the item itself");
  if (item.size && comp.size && !sizesAgree(item.size, comp.size)) return drop(`Different size (${comp.size})`);

  const mine = new Set(itemFeatures.map((f) => f.key));
  const theirs = compFeatures(comp.title);
  if (mine.has("hardback") && theirs.has("paperback")) return drop("Paperback");
  if (mine.has("paperback") && theirs.has("hardback")) return drop("Hardback");
  if (mine.has("first_edition") && RX.not_first.test(title)) return drop("Not a first edition");
  // Signed or limited comps of an ordinary copy would push its price up.
  for (const key of MAJOR) {
    if (theirs.has(key) && !mine.has(key)) return drop(`${FEATURE_LABELS[key]}, yours isn't`);
  }

  // Sellers always say "first edition" or "signed" when it's true; a jacket often goes unmentioned, so
  // only a comp that says it has none counts as lacking one. Rarity can't be read from a title.
  const missing = itemFeatures
    .filter((f) => f.major && f.key !== "rare" && f.key !== "dust_jacket" && !theirs.has(f.key))
    .map((f) => `not ${f.label.toLowerCase()}`);
  if (mine.has("dust_jacket") && itemFeatures.some((f) => f.key === "dust_jacket" && f.major) && RX.no_dust_jacket.test(title)) {
    missing.push("no dust jacket");
  }
  if (missing.length) return { verdict: "ordinary", reason: missing.join(", ").replace(/^n/, "N"), similarity };
  return { verdict: "match", reason: "", similarity };
}

// ------------------------------------------------------------------ maths

const DAY = 86_400_000;
/** Sold prices lose half their weight every 45 days. */
const HALF_LIFE_DAYS = 45;

/** Weighted quantile (q in 0–1) of values; weights default to 1. */
export function quantile(values: number[], q: number, weights?: number[]): number {
  const pts = values.map((v, i) => ({ v, w: weights?.[i] ?? 1 })).sort((a, b) => a.v - b.v);
  const total = pts.reduce((s, p) => s + p.w, 0);
  if (!pts.length || total <= 0) return Number.NaN;
  // Midpoint rule: each point's cumulative weight is taken at its centre.
  let acc = 0;
  const xs = pts.map((p) => {
    const at = (acc + p.w / 2) / total;
    acc += p.w;
    return at;
  });
  const target = q;
  if (target <= xs[0]!) return pts[0]!.v;
  if (target >= xs.at(-1)!) return pts.at(-1)!.v;
  for (let i = 1; i < pts.length; i++) {
    if (target <= xs[i]!) {
      const f = (target - xs[i - 1]!) / (xs[i]! - xs[i - 1]!);
      return pts[i - 1]!.v + f * (pts[i]!.v - pts[i - 1]!.v);
    }
  }
  return pts.at(-1)!.v;
}

/** Drops prices outside 1.5 × IQR, when there are enough to tell. */
export function withoutOutliers<T extends { price: number }>(comps: T[]): T[] {
  if (comps.length < 5) return comps;
  const prices = comps.map((c) => c.price);
  const q1 = quantile(prices, 0.25);
  const q3 = quantile(prices, 0.75);
  const fence = 1.5 * (q3 - q1);
  return comps.filter((c) => c.price >= q1 - fence && c.price <= q3 + fence);
}

/** Rounds to a price people expect: 50p steps under £20, £1 under £100, £5 above. */
export function nicePrice(minor: number): number {
  const step = minor < 2000 ? 50 : minor < 10_000 ? 100 : 500;
  return Math.max(step, Math.round(minor / step) * step);
}

/** Where in the range the item's condition puts it: 0 = low end, 0.5 = median, 1 = high end. */
const CONDITION_POSITION: Record<string, number> = {
  new_with_tags: 0.8,
  new_without_tags: 0.7,
  very_good: 0.6,
  good: 0.5,
  satisfactory: 0.3,
};

const ago = (ms: number, now: number) => {
  const d = Math.max(0, Math.round((now - ms) / DAY));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
};

function suggest(
  marketplace: Marketplace,
  basis: "sold" | "listed",
  pool: Comp[],
  condition: Item["condition"],
  now: number,
): PriceSuggestion | null {
  const comps = withoutOutliers(pool);
  if (comps.length < 3) return null;
  const prices = comps.map((c) => c.price);
  const weights = basis === "sold" ? comps.map((c) => (c.soldAt ? 0.5 ** (Math.max(0, now - c.soldAt) / DAY / HALF_LIFE_DAYS) : 0.5)) : undefined;
  let low = quantile(prices, 0.25, weights);
  let median = quantile(prices, 0.5, weights);
  let high = quantile(prices, 0.75, weights);
  if (basis === "listed") {
    // Asking prices run high and unsold ones linger: aim at the cheaper end.
    high = median;
    median = low;
    low = low * 0.9;
  }
  const pos = CONDITION_POSITION[condition ?? "good"] ?? 0.5;
  const price = pos >= 0.5 ? median + (pos - 0.5) * 2 * (high - median) : median - (0.5 - pos) * 2 * (median - low);
  const spread = median > 0 ? (high - low) / median : Infinity;
  const confidence: Confidence =
    basis === "sold" && comps.length >= 8 && spread <= 0.6 ? "high" : (basis === "sold" && comps.length >= 3) || comps.length >= 6 ? "medium" : "low";
  const site = marketplace === "ebay" ? "eBay" : "Vinted";
  const latest = Math.max(...comps.map((c) => c.soldAt ?? 0));
  const note =
    basis === "sold"
      ? `${comps.length} sold on ${site}${latest ? `, most recent ${ago(latest, now)}` : ""}`
      : `${comps.length} listed on ${site} now (asking prices, nothing sold to go on)`;
  return { marketplace, basis, price: nicePrice(price), low: nicePrice(low), high: nicePrice(Math.max(high, low)), count: comps.length, confidence, note };
}

/** Works out a suggested price per marketplace from comps, with verdicts and warnings. */
export function priceSummary(item: PricedItem, comps: Comp[], now = Date.now()): PriceSummary {
  const features = specialFeatures(item);
  const assessments = comps.map((c) => assessComp(item, c, features));
  const pick = (verdict: CompVerdict, sources: CompSource[]) => comps.filter((c, i) => assessments[i]!.verdict === verdict && sources.includes(c.source));

  const suggestions: PriceSuggestion[] = [];
  const ebay = suggest("ebay", "sold", pick("match", ["ebay_sold"]), item.condition, now) ?? suggest("ebay", "listed", pick("match", ["ebay_listed"]), item.condition, now);
  if (ebay) suggestions.push(ebay);
  const vinted = suggest("vinted", "listed", pick("match", ["vinted_listed"]), item.condition, now);
  if (vinted) suggestions.push(vinted);

  const ordinary = withoutOutliers([...pick("ordinary", ["ebay_sold"])]);
  const ordinaryPool = ordinary.length ? ordinary : withoutOutliers(pick("ordinary", ["ebay_listed", "vinted_listed"]));
  const ordinaryFloor = ordinaryPool.length ? nicePrice(quantile(ordinaryPool.map((c) => c.price), 0.5)) : null;

  const warnings: string[] = [];
  const major = features.filter((f) => f.major);
  if (major.length && !suggestions.length) {
    const what = major.map((f) => f.label.toLowerCase()).join(", ");
    warnings.push(
      ordinaryFloor != null
        ? `Not enough comparable ${what} copies found. Ordinary copies go for about ${(ordinaryFloor / 100).toFixed(2)}; yours is likely worth more. Check specialist sellers (e.g. AbeBooks) before pricing.`
        : `This looks collectable (${what}) and nothing comparable turned up. Check specialist sellers (e.g. AbeBooks) before pricing.`,
    );
  } else if (major.some((f) => f.key === "rare") && suggestions.some((s) => s.basis === "sold" && s.count < 5)) {
    warnings.push("Rare items sell rarely: with this few sales, the range is a rough guide.");
  }
  const best = suggestions[0];
  if (best && best.low > 0 && (best.high - best.low) / best.price > 0.8) warnings.push("Prices vary a lot: check the comparables before settling on one.");
  if (best?.basis === "listed") warnings.push("Nothing sold to go on, so this is from current asking prices, aimed at the cheaper end.");
  if (!comps.length) warnings.push("No comparable listings found. Try a shorter title, or check by hand.");
  return { suggestions, features, ordinaryFloor, warnings, assessments };
}
