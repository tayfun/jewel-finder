# Jewel Finder

Inventory for eBay / Vinted resellers, with a Chrome extension that fills in the marketplaces'
own listing forms, ends listings elsewhere when something sells, relists stale listings to bump them
back to the top, imports the listings you already have, and prices items from comparable sales. See [PLAN.md](PLAN.md) for the architecture, API and roadmap.

```
apps/api        Cloudflare Worker (Hono) + AccountDO Durable Object (SQLite) + R2 photos; also serves the web app
apps/web        React SPA (Vite)
apps/extension  Chrome MV3 extension: side panel, background worker, Vinted/eBay content scripts
packages/shared zod schemas, types, money + marketplace helpers shared by all three
```

## Develop

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars
pnpm dev          # API on http://localhost:8787, web app on http://localhost:5173
pnpm test         # API tests run inside workerd; extension tests use happy-dom
pnpm typecheck
```

### Extension

```bash
pnpm build:ext       # → apps/extension/dist       "Jewel Finder (dev)", talks to http://localhost:8787
pnpm build:ext:prod  # → apps/extension/dist-prod  "Jewel Finder", talks to the deployed Worker
pnpm release:ext     # → apps/extension/release/jewel-finder-<version>.zip (for the Chrome Web Store)
```

Accounts live on one server, so sign in with the build that matches where you signed up. The side
panel's login screen shows which server it uses. The two builds can be loaded side by side.

Load the folder via **chrome://extensions → Developer mode → Load unpacked**. Click the
toolbar icon to open the side panel. Use `pnpm --filter @jf/extension watch` while developing it
(reload the extension after background changes).

## Features

### Listing

Pick an item (side panel, or "List on Vinted/eBay" in the web app) → the extension opens the
marketplace's sell page and fills photos, title, description, price and whatever else it can → you
finish the remaining fields shown in the on-page panel and press the marketplace's own button → the
extension records the listing URL back in your inventory.

On Vinted:
- **Category:** picked for books, comics and magazines, from the item's category plus title and tags
  (`vintedCategory` in `packages/shared`). Words like "novel" or "guide" decide Fiction or Non-fiction;
  a book that says neither goes under Fiction, flagged as a guess in the on-page panel.
- **ISBN and Language:** the ISBN box gets the saved ISBN, or `0000000000000` (valid, matches no book) so
  that Vinted shows its Language field. Language is the saved one, else named in the title or tags, else
  Turkish for Turkish letters in the title, else English (`bookLanguage`).
- **Parcel size:** Small unless the item's own package size or weight says bigger.
- **Guesses stand out:** anything filled from a guess or a default rather than the item's own data
  (category from a title word or the Fiction default, the zeros ISBN, a language not saved on the item,
  Small with no package size saved) is listed under "Guessed: please check" in red in the on-page panel,
  with the reason.
- **Recording the listing:** Vinted stays on your profile after Upload instead of opening the new item, so
  the extension reads the new item's id from the upload request (`content/vinted-page.ts`, in the page's
  own world).

Open Jewel Finder pages (Inventory, the item, Relist) update by themselves: whenever the extension changes
an item it writes that item's id to `itemsChanged` in `chrome.storage.local`, and the bridge content script
passes it on to the page as `ITEMS_CHANGED`. Pages refetch only the changed items (batched, for imports) and
swap them into the list in place (`mergeChangedItems`); Inventory also refreshes its counts.

### Cross-delisting

Mark an item sold ("Sold on Vinted/eBay/elsewhere") → its other live listings become "Needs ending" and
the extension opens each one → it gets the delete/end step ready (Vinted: Delete; eBay: End listing with
a reason) and you confirm → once the listing is gone it's marked ended.

### Pricing from comparables

The **Pricing** card on each item page shows its collectable features (first edition, signed, limited,
rare, proof, dust jacket, format) with the evidence on hover, and **💷 Check prices** works out a price
from comparable items. The side panel has the same check (**💷 Price** on each item), with the
suggestions and a **Use** button right there. Full design: [PRICING.md](PRICING.md).

- **Searching:** the extension opens eBay *sold* searches first, then eBay Buy It Now and Vinted listings,
  each in a background tab that closes again (about 8 s locally; longer on the real sites). Queries go
  from most specific (ISBN, then title + author + "first edition"/"signed") to broader.
- **Like for like:** lots, parts/faulty, wrong size or format, and comps with a major feature yours lacks
  (signed, limited…) are dropped. Comps lacking one of yours ("not first edition") count as *ordinary
  copies*: shown as a floor, never used for the price.
- **The price:** per marketplace, from recency-weighted quartiles of sold prices with outliers trimmed,
  nudged by condition and rounded; from current asking prices (aimed low, and labelled) only when nothing
  sold. A collectable item without matching comps gets no number, just "ordinary copies go for about £X;
  yours is likely worth more". **Use £X** sets the price.
- **AI review** (when `GEMINI_API_KEY` is set): Gemini gets the item (details and up to 2 photos) and
  the comps the rules kept or nearly kept, and judges each one *same item*, *lesser copy* (later
  printing, book club, unsigned…), *better copy* or *different item*. It can only make a verdict
  stricter (so it can't push a collectable's price up), except that it can let back in a comp the rules
  dropped only because its title was worded differently. Lots, parts, sizes and formats stay dropped.
  For collectables it also writes a short "what to check" note. The price is still worked out by the
  rules from the comps' own prices. A failed review never fails the check; the card says why and offers
  "Review again", as it does when you edit the item after a review (an outdated review isn't applied).
- **Show comparables** lists every comp with its verdict and reason, linked to the listing. The latest
  check is re-assessed when you edit the item, so fixing the edition re-prices it without searching again.

Code: `packages/shared/src/pricing.ts` (features, queries, verdicts, maths), `apps/extension/src/lib/comps.ts`
(results parsers), `apps/api/src/ai.ts` (`reviewComps`), `apps/web/src/components/Pricing.tsx`. The parsers are tested against approximations
of the results pages, not live ones yet.

### Relist & bump

Listings sink in search as they age. Relisting puts the item up again as a brand-new listing and then
removes the old one, so it shows up as new. A live listing counts as stale after **21 days on Vinted**
or **60 on eBay** (Settings → Relisting).

- **Where:** stale listings get an age badge ("Vinted · 30d") on the Inventory page and in the side
  panel, an Inventory notice links to `/relist` (also in the top nav), and each item page shows how long
  a listing has been up and how often it was relisted.
- **Relist one:** "↻ Relist" on the item page, a `/relist` row, or the side panel.
- **Relist several:** tick rows on `/relist` (or Select all) → **Relist selected**. Each opens its own
  tab, at most 10 per click, since each needs you to check the form and publish.

What happens, in one tab: the extension opens the sell page and fills it from your inventory, as when
listing → you publish → it records the new listing (new link, relist count + 1, clock restarted) and
moves the tab to the **old** listing → it gets Delete / End listing ready and you confirm → once the old
one is gone, done. The new listing goes up first, so stopping halfway never loses the listing; until the
old one is gone, the item shows "Previous listing still live: <link>". A listing needs its link saved
to be relisted, since that's how the old one is found.

Vinted and eBay use the same flow (on eBay you still pick the category on the first page). The clock for
an imported listing starts at import, because the marketplaces' listing dates aren't read yet.

### Importing existing listings

Brings the listings you already have on Vinted and eBay into your inventory, picked one by one or a
whole page at a time. Sign in to the marketplace in the same browser first.

1. **Start:** "Import listings" in the web app (`/import`, also on the Inventory page), or
   "Import listings: ⬇ Vinted / ⬇ eBay" in the side panel. The side panel uses the current tab if it's
   already on that marketplace; otherwise a new tab opens on your listings: eBay Seller Hub → Active,
   or Vinted's home page, where the panel offers "Open my wardrobe" (Vinted's wardrobe URL needs your
   member id).
2. **Pick:** a Jewel Finder panel on the page lists every listing found there, with a checkbox each and
   **Select all on this page**. Hovering a row outlines that listing on the page. Listings already in your
   inventory (imported before, or listed from Jewel Finder) show "✓ In Jewel Finder" and can't be picked.
   Import mode stays on in that tab while you scroll or page through. The panel warns when the page
   doesn't look like your own listings (eBay: only Seller Hub / My eBay count).
3. **Import:** listings are read one at a time, 600 ms apart. Keep the tab open until it finishes;
   "Stop" ends it after the current one. The summary lists what failed and why, which items came in
   without photos, and which look like items you already have (see Duplicates).

Each import becomes an item with title, description, price, brand, size, colour, condition, category
and up to 20 photos, plus a listing linked to the marketplace URL. Live listings come in as in-stock
items with a `listed` listing; sold ones as sold items; ended eBay listings as in-stock items with an
ended listing. Photos that can't be downloaded are skipped and the item is still created.

How it works: the content script fetches each listing page with your marketplace session and reads it
with `DOMParser` (JSON-LD and meta tags first, then the page's markup). eBay descriptions live on
`*.ebaydesc.com`, so the background fetches those. The background downloads photos from the CDNs
(`*.vinted.net`, `i.ebayimg.com`), uploads them to R2, and calls `POST /api/items/import`, which skips
any listing whose marketplace id is already in the inventory. Those three hosts are extra host
permissions, so Chrome asks existing users to approve them when the extension updates.

Readers: `vintedImporter` / `ebayImporter` in `apps/extension/src/content/{vinted,ebay}.ts`, shared
helpers in `src/lib/scrape.ts`, the panel in `src/lib/importer.ts`. They're tested against
approximations of the marketplaces' pages, not saved real pages yet (PLAN.md, "Next up").

### Duplicates

Flags items that look like the same thing entered twice, typically one imported from Vinted and one
from eBay. They're counted on the Inventory page, noted on each item's page and in the import panel's
summary, and reviewed side by side at `/duplicates`.

- **Merge into this one** merges the pair into the item you pick. The kept item keeps its own details and photos (it takes the
  other's photos only if it has none), fills its blank fields from the other, combines tags and takes
  over the other's listings; the other item is deleted. If either had sold, the merged item is sold and
  its other live listings become "Needs ending". A merge is refused when both items have a live listing
  on the same marketplace.
- **Not duplicates** is remembered, so the pair isn't suggested again. It can be undone straight away,
  or later from "Marked as not duplicates" at the bottom of the page, which brings the pair back so it
  can be merged. Copies made with "Duplicate" (restocking) are never flagged.

Scoring is in `packages/shared/src/duplicates.ts`. Title similarity is the base: mostly how many of the
shorter title's words the longer one contains, since eBay titles add keywords. A shared ISBN counts as a
strong match. Matching brand, size, author and price add to the score, as does being live on different
marketplaces. A different ISBN, author, brand or size rules a pair out ("S" ≠ "XS", but "W32" matches
"W32 L30"); so do both being live on the same marketplace (a "pending" listing doesn't count as live: pending
on one and live on the other is the usual unrecorded-listing-then-imported duplicate), both being sold, or
either being archived.
Pairs scoring at least `DUPLICATE_THRESHOLD` (0.8) are shown. Photos aren't compared, because each
marketplace re-compresses them.

### Where to look when a marketplace changes

The listing-form selectors and the import readers live in `apps/extension/src/content/{vinted,ebay}.ts`.
Marketplaces change their DOM regularly, so that's the first place to look when a field stops filling or
an import comes in thin.

### AI auto-fill

"✨ Auto-fill from photos" on an item page sends the item's photos to Gemini and suggests a title,
description, condition, category, tags and book details (author, ISBN, edition, printing, language,
rarity…). You review and tick what to apply. When listing, the extension puts a book's language into
eBay's "Language" item specific, and into Vinted's Language field if the book category shows one
(otherwise it's under "Please set" in the on-page panel). Put a key from https://aistudio.google.com/apikey in
`apps/api/.dev.vars` as `GEMINI_API_KEY=...` (the model is `GEMINI_MODEL` in `wrangler.jsonc`; when it is overloaded the Worker falls back to `GEMINI_FALLBACK_MODEL`).
The prompt and response schema live in `apps/api/src/ai.ts`.

## Admin dashboard

`/admin` in the web app shows how many users and items there are (with sign-ups, activity, items by
status and live listings), plus a table of every user with a **Make admin** button. It appears in
the nav for admins only.

- **Who's an admin:** the emails in the `ADMIN_EMAILS` secret (comma-separated:
  `pnpm --filter @jf/api exec wrangler secret put ADMIN_EMAILS`) always are, shown as *Owner*. They
  can make anyone else an admin from the dashboard. Nobody can remove their own admin access.
- **Where the numbers come from:** each account lives in its own Durable Object, so the Cloudflare
  dashboard can't count across them. A single `DirectoryDO` keeps a row per user, and each account
  reports its counts there after any change and whenever the app or side panel opens.
- **Accounts from before the directory** join it the next time they sign in or open the app. To add
  them all at once, run `node scripts/backfill-directory.mjs` (see the top of the file for the env
  vars it needs).

## Error monitoring (Sentry)

The API (Worker + Durable Object) and the web app report errors and performance traces to Sentry.
Both are off until a DSN is set, so local dev sends nothing by default.

- **API:** `SENTRY_DSN` in `apps/api/.dev.vars` locally; `npx wrangler secret put SENTRY_DSN` for production.
  `SENTRY_ENVIRONMENT` is `production` in `wrangler.jsonc` and `development` in `.dev.vars`.
- **Web app:** `VITE_SENTRY_DSN` (and optionally `VITE_SENTRY_ENVIRONMENT`) in the build environment,
  e.g. `apps/web/.env.local`. Browser traces continue into the API, so a slow page shows its Worker spans.
- **Readable stack traces:** `pnpm run deploy` uploads source maps for both projects when
  `SENTRY_AUTH_TOKEN` is set (copy `.env.sentry.example` to `.env.sentry`). Bundles and maps are
  matched by debug IDs, so no release bookkeeping is needed; web maps are deleted from `dist/`
  after upload so they're never served. API events are tagged with the deployed Worker version.

Events carry only the account id (no email). Request bodies, cookies, SQL values and Gemini prompts
and photos are not sent. 4xx responses and the 503 "not configured" response aren't reported.

## Deploy

```bash
cd apps/api
npx wrangler r2 bucket create jewel-finder-images
npx wrangler secret put JWT_SECRET      # a long random string
npx wrangler secret put GEMINI_API_KEY  # Google AI Studio key, for "Auto-fill from photos" and price-check reviews
npx wrangler secret put SENTRY_DSN      # Sentry project DSN for the API (optional)
cd ../..
cp .env.sentry.example .env.sentry      # optional: Sentry auth token + web DSN
pnpm run deploy -- --dry-run            # check: builds everything, uploads/deploys nothing
pnpm run deploy                         # web build → Worker bundle → source maps → wrangler deploy
pnpm build:ext:prod  # or API_URL=https://… pnpm build:ext for another deployment
```

## Publishing the extension

`pnpm run deploy` also builds `apps/extension/release/jewel-finder-<version>.zip` (or run `pnpm release:ext`
on its own) and serves it at `/jewel-finder-extension.zip`. Until the extension is in the Chrome Web Store,
the web app's `/extension` page offers that zip with "Load unpacked" steps.

To publish it:

1. Register at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   (one-off US$5 fee) and verify a contact email.
2. **New item** → upload the zip. Fill in the listing: description, category (Productivity), a 128×128 icon
   (`apps/extension/icons/128.png`), at least one 1280×800 screenshot, and a privacy policy URL.
3. On the **Privacy** tab, explain each permission: `storage` (sign-in token), `sidePanel` (the UI),
   host access to the Worker (your inventory), to Vinted/eBay
   (filling in their listing forms, reading the seller's listings to import), and to `*.vinted.net`,
   `i.ebayimg.com` and `*.ebaydesc.com` (downloading the photos and eBay descriptions of listings the
   seller imports). Declare that it handles authentication info and website content, and
   that nothing is sold or used for anything else.
4. Submit for review (usually a few days). Choose **Unlisted** if only people with the link should find it.
5. Once approved, set `VITE_EXTENSION_URL` in `apps/web/.env` to the listing URL and redeploy: the
   "Install" links then go to the store.

For updates, bump `version` in `apps/extension/package.json` (every extension change gets a bump, see AGENTS.md), run `pnpm release:ext` and upload the new zip.
