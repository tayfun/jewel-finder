# Pricing — plan

Goal: give each item a price the seller can defend, from evidence: what the **same or similar items
actually sold for**, or failing that, what they're **listed at now**. Items with qualities that change
the value (first edition, signed, rare…) are flagged and priced against comparables that share those
qualities, never against ordinary copies.

The seller always decides. We show a suggested range, the comparables it came from (with links), and
why; one click applies it.

## 1. Principles

1. **Evidence over guesses.** A price comes from comparable listings ("comps"). Every suggestion lists
   its comps, so the seller can check them. No comps, no number — just the search links.
2. **Sold beats listed.** Sold prices are what buyers paid. Asking prices only bound the market from
   above (unsold listings are often overpriced), so listed-only suggestions are discounted and labelled.
3. **Like for like.** A first edition is not priced from reprints; a signed copy not from unsigned ones;
   a hardback not from paperbacks; "W32" jeans not from "W36". Comps that differ on a feature that
   matters are dropped, or shown separately as a floor.
4. **Robust maths.** Medians and quartiles, outliers trimmed, recent sales weighted up. Lots/bundles,
   "for parts", reproductions and wanted ads excluded.
5. **Flag, don't inflate.** When an item is collectable and there aren't enough matching comps, we say so
   plainly ("only reprints found: the first edition is likely worth more") and point to where to check,
   rather than multiplying a reprint price by a made-up factor.
6. **No marketplace APIs, no server-side scraping.** As with listing and importing, the extension reads
   public search pages in the seller's own browser. Nothing is fetched by our servers.

## 2. Where comparables come from

| Source | What it gives | How |
|---|---|---|
| **eBay sold** (`/sch/i.html?_nkw=…&LH_Sold=1&LH_Complete=1`) | Sold prices + dates, ~last 90 days. The best signal. | Extension opens the search in a background tab; the eBay content script reads the results |
| **eBay listed** (same search without the sold filters) | Current asking prices | Same |
| **Vinted listed** (`/catalog?search_text=…`) | Current asking prices on Vinted (Vinted doesn't show sold items) | Vinted content script reads the catalog grid (cards' link titles carry brand, size, condition, price) |
| Seller's own sales | What *this seller* sold similar items for | Already in the inventory (sold items + listing prices) |
| Later: specialist book sites (AbeBooks, Biblio) | Asking prices for collectable books | Links first; reading them later if worth it |

Background tabs (`active: false`) are used rather than fetches because Vinted renders results in the
browser, and both sites expect a normal page visit. Searches run one after another, a second or two
apart; results are cached per item (see §6) so we don't hammer anyone.

## 3. Searching

`priceQueries(item)` builds the search text, most specific first, and the research falls back to the
next query when one returns too few comps:

- **Books:** `ISBN` (exact edition, when known) → `title + author + key features` ("first edition",
  "signed") → `title + author`.
- **Everything else:** `brand + model words from the title + size` → `brand + title words`.
- Title words are the meaningful ones (`titleTokens` from duplicate detection: no filler like "BNWT",
  "free postage"). Queries stay short: marketplace search ANDs every word.

## 4. Special features ("collectable flags")

`specialFeatures(item)` reads the item (book details + title/description/tags) and returns flags with
how much they usually matter:

| Feature | Detected from | Weight |
|---|---|---|
| First edition / first printing | `book.edition`, `book.printing`, "1st ed", "first edition", number line ending in 1 | major |
| Signed / inscribed | `book.signed`, "signed", "inscribed" | major |
| Limited / numbered edition | "limited edition", "numbered", "x/500" | major |
| Rare (AI or seller) | `book.rarity` scarce / rare / very rare | major |
| Proof / ARC | "proof", "advance reading copy", "uncorrected" | major |
| Dust jacket present (hardback) | `book.dustJacket` | minor (major for first editions) |
| Format | `book.format`, "hardback"/"paperback" | must match |
| New with tags | `condition` | minor |
| Vintage / era | "vintage", "Y2K", "90s", year | minor |

The same detector runs on each **comp's title**, so a comp can be compared feature by feature. Rules:

- A comp that is *missing* a major feature the item has → not like for like. Kept apart as the
  "ordinary copy" floor, never used for the main price.
- A comp that *has* a major feature the item lacks (e.g. it's signed, ours isn't) → dropped.
- Format and size must match when both are known.

The item page shows the flags ("💎 First edition · Signed") whether or not a price check has run, with
the evidence ("Edition: First edition; printing line ends in 1").

## 5. From comps to a price

`priceSummary(item, comps, now)` (pure, shared, unit-tested):

1. **Relevance:** title similarity to the item (`titleSimilarity`), plus feature agreement (§4). Keep
   comps scoring ≥ 0.5; drop lots ("job lot", "bundle", "x10"), "for parts/spares", "reprint/facsimile"
   when ours isn't, and prices that are clearly placeholders.
2. **Pools:** `sold` (eBay sold) and `listed` (eBay + Vinted listed), each split into *matching* and
   *ordinary* (missing a major feature).
3. **Outliers:** within each pool, drop prices outside 1.5 × IQR (only with ≥ 5 comps).
4. **Statistics:** recency-weighted quartiles for sold (weight halves every 45 days); plain quartiles for
   listed.
5. **Suggestion:**
   - ≥ 3 matching sold → **range** = 25th–75th percentile, **suggested** = median. Confidence from
     count and spread.
   - else ≥ 3 matching listed → suggested = listed 25th percentile (asking prices run high), labelled
     "based on current listings".
   - else → no number. If ordinary comps exist, show them as "ordinary copies sell for £X — yours is
     likely worth more" with the flags that make the difference.
   - Condition nudges the point within the range: new/very good → upper half, satisfactory → lower.
6. **Per marketplace:** Vinted asking prices tend to be lower than eBay's; when Vinted comps exist, show a
   Vinted suggestion next to the eBay one rather than one blended number.
7. **Output:** suggested price, range, confidence (low/medium/high), basis ("12 sold on eBay in the last
   90 days"), warnings (collectable without matching comps, wide spread, few comps), and the comps
   themselves with their verdicts (used / ordinary copy / dropped and why).

Prices are item prices without postage: Vinted buyers pay postage separately, and eBay sold prices are
read without their shipping line.

## 6. Data and API

- `price_checks` table in `AccountDO`: `id, item_id, created_at, queries (json), comps (json),
  summary (json)`. Latest one per item is shown; older ones kept (a price history to come back to).
- `POST /api/items/:id/price-check {queries, comps}` → stores comps, computes `priceSummary` on the
  server (one source of truth), returns the check. `GET /api/items/:id/price-check` → latest.
- Applying a price is the existing `PATCH /api/items/:id {price}`.

## 7. Flow

1. Item page → **"💷 Price check"** (also in the side panel). Bridge `PRICE_CHECK {itemId}`.
2. Background builds queries, opens each search in an inactive tab with a `comps` job, the content
   script parses the results page and sends them back, the tab closes. eBay sold first; stop early once
   there are enough matching sold comps.
3. Background posts the comps to the API, which returns the summary. The web app shows it: suggested
   price and range, confidence, flags, warnings, the comps (thumbnail, title, price, sold date, link,
   verdict), and **Use this price**.
4. A check older than 30 days is marked stale; "Check again" reruns it.

## 8. AI, where it helps (phase 2)

Deterministic rules decide the number; Gemini helps with judgement where text matching is weak:

- **Relevance:** give it the item (and photos it already saw) plus comp titles; it marks each comp
  same item / same edition / different. Applied only to the comps' verdicts, never inventing prices.
- **Explaining collectables:** for flagged items with few comps, a short note on what drives value
  (points of issue, first-state jackets) and what to check before pricing high.
- Auto-fill already estimates rarity from photos; its flags feed §4.

## 9. Build order

1. **Shared core** — `specialFeatures`, comp feature extraction, relevance, `priceQueries`,
   `priceSummary` with unit tests. *(done: `packages/shared/src/pricing.ts`)*
2. **Extension** — `comps` job, eBay search-results and Vinted catalog parsers (fixtures), background
   orchestration, `PRICE_CHECK` bridge message. *(done: `apps/extension/src/lib/comps.ts`, `START_PRICE_CHECK`)*
3. **API** — `price_checks` table, endpoints, tests. *(done: migration v7; the latest check is re-assessed
   against the item as it is now, so correcting the edition re-prices without searching again; last 5 kept)*
4. **Web** — feature flags on the item page, price-check panel, apply price. *(done: `components/Pricing.tsx`;
   still to do: side panel button)*
5. **AI relevance + collectable notes** (§8).
6. Later: bulk "price check everything without a price", repricing suggestions for stale listings
   (ties into relist), learning from the seller's own sales, specialist book sources.

## 10. Notes from building it

- eBay results pack title and "Sold 12 Oct 2026" into adjacent elements, so their text runs together
  ("…1937Sold 12 Oct 2026"); dates are read from the caption elements, with a spaced-text fallback.
- Struck-through sold prices (best offer accepted for an unseen amount) and price ranges (variations)
  are skipped rather than guessed. Results below eBay's "matching fewer words" divider are ignored.
- Searches per check: up to 2 per source (stops early at 8 usable comps; eBay listed is skipped when sold
  already has 8). A check took ~8 s against local fixtures; live pages will be slower.
- Verified end to end in Chromium with the built extension against fixtures served on the real
  hostnames (not live eBay/Vinted yet).

## 11. Risks

- **Marketplace markup changes** break the results parsers: several selectors per field, fixtures, and
  "couldn't read results" surfaced instead of silent zeros.
- **eBay bot checks** on rapid searches: few searches per check, spaced out, results cached.
- **Bad matches** skew prices: comps are always shown with verdicts; the seller can see what was used.
- **Collectables** are where money is lost by underpricing: flags and "likely worth more" warnings
  are deliberately conservative, and no price is suggested from ordinary copies.
