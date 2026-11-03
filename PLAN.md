# Jewel Finder — Plan

Inventory management for people who resell on eBay and Vinted. Users keep their stock in one
place and push items to marketplaces through a Chrome extension that fills in the marketplace's
own "sell an item" form (no marketplace APIs — Vinted has none, and we don't want eBay's).

## 1. Architecture

```
┌──────────────────────┐        ┌──────────────────────────────────────────────┐
│  Web app (React SPA) │──/api──▶  Cloudflare Worker  (apps/api, Hono)          │
│  apps/web            │        │   ├─ /api/auth/*     register / login (JWT)   │
└─────────▲────────────┘        │   ├─ /api/items/*    inventory CRUD           │
          │ window.postMessage  │   ├─ /api/listings/* marketplace listing state│
┌─────────┴────────────┐        │   ├─ /api/images     upload → R2              │
│  Chrome extension    │──/api──▶   └─ /images/*       public image delivery    │
│  apps/extension      │        │                                              │
│   ├─ side panel UI   │        │  AccountDO (Durable Object, SQLite storage)  │
│   ├─ background SW   │        │   one instance per user: account, items,     │
│   └─ content scripts │        │   listings                                   │
│      (vinted, ebay,  │        │  R2 bucket: item photos                      │
│       web bridge)    │        │  Static assets: the built web app            │
└──────────────────────┘        └──────────────────────────────────────────────┘
```

**Decisions**

| Topic | Decision | Why |
|---|---|---|
| Repo | pnpm workspace monorepo: `apps/api`, `apps/web`, `apps/extension`, `packages/shared` | One set of types/validation shared by all three parts |
| Backend | One Cloudflare Worker using Hono for routing, zod for validation | Small, fast, idiomatic on Workers |
| Storage | One **Durable Object per user** (`AccountDO`) with the SQLite storage backend; called via Workers RPC | Per-user data is naturally isolated, strongly consistent, no D1 schema/tenancy filtering needed. Scales horizontally by user |
| User lookup | DO is addressed by `idFromName(normalisedEmail)`; the JWT `sub` is the DO id | No global users table needed. (Changing email later would need an email→id index — out of scope for v1) |
| Auth | Email + password, PBKDF2-SHA256 (WebCrypto), HS256 JWT bearer tokens (30 days) | Works identically for the web app and the extension; no cookies across origins |
| Images | R2, key `u/<userId>/<uuid>`. Served publicly from `/images/<key>` (unguessable key, CORS `*`) | `<img>` tags and the extension's content scripts can load them without auth headers |
| Frontend hosting | Built SPA is served by the **same Worker** via Workers Static Assets | Same origin → no CORS for the web app, one deploy |
| Extension build | esbuild script (no framework), Manifest V3, side panel UI | Content scripts must be classic scripts; esbuild keeps it predictable |
| Posting | Extension opens the marketplace's sell page in a tab and **fills** it; the user reviews and presses the marketplace's own submit button | No API, respects the user's control, far less brittle than full automation |
| AI listing data | Gemini (`@google/genai`, model in `GEMINI_MODEL`, default `gemini-3.8-flash`, falling back to `GEMINI_FALLBACK_MODEL` (`gemini-3.5-flash`) on 429/503/504) called from the Worker with the item's photos and a `responseJsonSchema`; the result is validated (zod + ISBN check digit) and shown for review before anything is saved | Key stays server-side; structured output; the seller stays in control of what gets written |
| Monitoring | Sentry: `@sentry/cloudflare` (`withSentry`, Hono middleware, Durable Object wrapper, Gemini spans) and `@sentry/react` (router tracing, error boundary, route errors); traces propagate browser → Worker | Errors and slow requests visible end to end; DSN-less environments send nothing; only the account id is attached. `scripts/deploy.mjs` uploads source maps (debug IDs) for both, and deploys the exact Worker bundle it uploaded maps for |
| Web → extension | A bridge content script on the web app origin relays `window.postMessage` requests to the background worker | No need to hard-code the extension id in the web app |
| Extension builds | `dist/` ("Jewel Finder (dev)", localhost) and `dist-prod/` (deployed Worker) match different hosts, so both can be loaded side by side; `pnpm release:ext` zips `dist-prod/` | Accounts live on one server; the side panel shows which one it signs in to |
| Extension distribution | Chrome Web Store once approved (`VITE_EXTENSION_URL` → "Add to Chrome"); until then `/extension` offers the zip, which the deploy serves at `/jewel-finder-extension.zip` | Every "not detected" message has somewhere to send the seller |
| Privacy | Public `/privacy` page covering the web app and extension (Web Store requirement); contact address from `VITE_CONTACT_EMAIL` | Required for the store listing; describes only what the code actually does |

## 2. Data model (per-user SQLite inside `AccountDO`)

- **account**: `id, email, password_hash, settings (json), created_at`
  - settings: `currency` (GBP default), `vintedDomain` (www.vinted.co.uk), `ebayDomain` (www.ebay.co.uk)
- **items**: `id, sku, title, description, brand, category, size, colour, condition, price, cost,
  quantity, status, images (json array of R2 keys), tags (json), notes, created_at, updated_at`
  - money stored as integer minor units (pence)
  - `condition`: `new_with_tags | new_without_tags | very_good | good | satisfactory`
    (Vinted's scale; mapped to eBay's at fill time)
  - `status`: `draft | in_stock | sold | archived`
  - `book` (json, nullable, migration v2): `author, isbn, publisher, yearPublished, edition, printing,
    format, language, signed, dustJacket, rarity (common…very_rare), rarityNotes`
  - `package_size` (`large_letter | small | medium | large`) and `weight_grams` (packed), migration v3.
    Each marketplace's own size is derived at fill time, bumped up a band when the weight is over its
    limit (eBay UK: large letter 1 kg, small 2 kg, medium 20 kg; Vinted: small 2 kg, medium 5 kg)
- **not_duplicates** (migration v5): `a, b, created_at`, a < b — pairs the seller said are different
  items. "Duplicate" (restock) records one for the source and its copy.
- **listings**: `id, item_id, marketplace (vinted|ebay), status (pending|listed|sold|ended|failed),
  external_id, url, price, error, created_at, updated_at` — unique on `(item_id, marketplace)`
  - `listed_at`, `relisted_count` (migration v6): when it last went live (published, imported, or put
    up again under a new id) and how often a live listing was replaced by a new id. Set by the listing
    upsert, so manual "Mark as listed" with a new link counts too. Backfilled from `updated_at`.
- **settings** also hold `vintedRelistDays` (21) and `ebayRelistDays` (60): live listings of in-stock
  items older than that are stale (`isStale` in shared).

## 3. API surface

```
POST   /api/auth/register      {email,password}            → {token, account}
POST   /api/auth/login         {email,password}            → {token, account}
GET    /api/me                                             → account
PATCH  /api/me/settings        partial settings            → account
GET    /api/items?q=&status=                               → {items}
POST   /api/items              ItemInput                   → item
GET    /api/items/:id                                      → item (+ listings)
PATCH  /api/items/:id          partial ItemInput           → item
DELETE /api/items/:id                                      → 204
POST   /api/items/:id/duplicate                            → item   (photos copied, quantity ≥ 1)
POST   /api/items/:id/sold     {marketplace?}              → item   (marks other listings ended)
POST   /api/items/:id/autofill                          → {suggestion} (Gemini, not saved)
POST   /api/items/import       {marketplace, listings[≤50]} → {results: [{externalId, itemId, created}]}
GET    /api/listings?marketplace=                          → {listings}  (what's already imported)
POST   /api/items/:id/merge    {otherId}                   → item   (409: both live on one marketplace)
GET    /api/duplicates?itemId=                             → {pairs: [{a, b, score, reasons}]}
POST   /api/items/:id/price-check {queries, comps, problems} → check (summary worked out here)
GET    /api/items/:id/price-check                          → latest check, re-assessed against the item
POST   /api/duplicates/dismiss {a, b}                      → 204    ("not duplicates", remembered)
PUT    /api/items/:id/listings/:marketplace  ListingInput  → listing (upsert)
DELETE /api/items/:id/listings/:marketplace                → 204
GET    /api/stats                                          → counts + stock value
POST   /api/images             raw image body              → {key, url}
GET    /images/:key                                        → image bytes (public)
```

## 4. Chrome extension flow

1. User signs in inside the side panel (same `/api/auth/login`); token kept in `chrome.storage.local`.
2. Side panel lists inventory (search + status filter) with "Vinted" / "eBay" buttons per item.
   The same action can be started from the web app (via the bridge content script).
3. Background worker: fetches the item, upserts a `pending` listing, opens the marketplace sell
   page (`https://<vintedDomain>/items/new`, `https://<ebayDomain>/sl/prelist/suggest`), and stores a
   job `{tabId → itemId, marketplace}` in `chrome.storage.session`.
4. Marketplace content script asks the background for its job, then fills what it can:
   photos (via `DataTransfer` on the file input), title, description, price, package size, and
   best-effort brand/size/condition. React-controlled inputs are set with the native value setter +
   `input` events; eBay's description goes into its rich-text iframe via `execCommand` (the textarea
   beside it is only for "Show HTML code"). eBay's package size is chosen in the Delivery picker;
   Vinted's parcel size appears only after a category is picked, so the script waits for it.
   The side panel lists what was filled and what still needs doing by hand, with values to copy.
5. When the page navigates to a published listing URL, the content script reports
   `{url, externalId}` → background → `PUT /api/items/:id/listings/:marketplace {status: listed}`.
6. **Cross-delisting.** Marking an item sold turns its other live listings into `ending` ("Needs
   ending"). The web app then asks the extension (bridge `DELIST_ITEM`) to open each one in a `delist`
   job. Vinted: the content script clicks "Delete" and the seller confirms. eBay: it follows "End
   listing" and picks "no longer available", or points to Seller Hub, and the seller confirms. Once the
   tab moves on, it checks the listing is really gone (Vinted: the item page 404s; eBay: the page or the
   item page says it ended) and sets the listing to `ended`. "I've ended it" in the web app does the
   same by hand. The inventory page warns while any listing still needs ending.

7. **Imports.** The web app (bridge `IMPORT_LISTINGS`) or the side panel puts a tab into import mode
   (`imports` in `chrome.storage.session`, per tab, kept across navigation) and opens the seller's
   listings: eBay Seller Hub → Active, or Vinted's home page, from which the panel links to the member's
   own wardrobe (`/member/<id>`; Vinted's URL needs the id). The content script shows a picker panel:
   every distinct listing link on the page becomes a row (thumbnail, title, price) with a checkbox,
   "Select all on this page", and listings already in the inventory (`GET /api/listings`) marked and
   locked. It warns when the page doesn't look like the seller's own (eBay: only `/sh/`, `/mye/`
   count; Vinted: the header's profile link must match the wardrobe). Importing goes one listing at a
   time, 600 ms apart: the content script fetches the listing page with the seller's cookies and parses
   it (`DOMParser`, no scripts) — JSON-LD Product/BreadcrumbList, then meta tags, then test ids and
   label/value pairs; eBay's description is fetched by the background from `*.ebaydesc.com`. The
   background downloads photos from the CDNs (host permissions `*.vinted.net`, `i.ebayimg.com`),
   uploads them, and calls `POST /api/items/import`, which creates item + listing in one transaction,
   skipping (and deleting the photos of) any `(marketplace, external_id)` already there. Sold listings
   come in as sold items; ended eBay listings as in-stock items with an ended listing.

8. **Duplicate detection.** `findDuplicatePairs` (shared) compares items that share a title word or
   ISBN. Title similarity (0.7 × containment + 0.3 × Jaccard of meaningful words; eBay titles add
   keywords to Vinted's) is the base; a shared ISBN scores ≥ 0.95; brand, size, author, price, colour and
   being live on *different* marketplaces add or subtract. Ruled out: different ISBN, author, brand or
   size ("S" ≠ "XS", "W32" ~ "W32 L30"), both live on the same marketplace (an item holds one listing per
   site), both sold, or either archived. Pairs ≥ 0.8 show up: a count on the inventory page (`Stats`), a
   note on the item page, the import panel's summary, and `/duplicates` to review. Merging keeps the chosen
   item's details and photos, fills its blanks, unions tags, moves listings (refusing two live ones on one
   site) and, if either had sold, marks it sold and flags the rest for ending.
9. **Relist & bump.** `relist` job (bridge `RELIST_ITEM`, side panel, `/relist`): the background
   checks the listing is live with a saved link, opens the sell page and stores the job with
   `target: {externalId, url}` of the old listing. The content script fills the form as for a new
   listing. On publish, `JOB_PUBLISHED` saves the new id/link (the upsert bumps `relisted_count` and
   restarts `listed_at`), sets the listing's `error` to "Previous listing still live: …", turns the job into
   `cleanup` and returns the old URL; the tab goes there and runs the delist step against `job.target`
   instead of the item's listing. When `isDone`, `JOB_DELISTED` clears the error and leaves the listing
   live. New first, then delete: a half-finished relist leaves two live listings (flagged), never zero.
   Stale count is in `Stats.stale`; the web app works out staleness itself from `listedAt` + settings.

Selectors live in one adapter file per marketplace with multiple fallback strategies
(test ids → names → label text → placeholders) because marketplace DOMs change without notice.

## 5. Implementation steps

Status (2026-11-03): steps 1–5 are implemented and deployed, along with AI auto-fill, Sentry, package
sizes, the extension install page and the privacy policy. Cross-delisting, imports, duplicate detection and relisting are built but not deployed. Tests: shared 37, API 25 (in workerd), extension 38
(happy-dom, incl. a real React-controlled form). The web app was exercised end to end in a browser.
Live marketplace checks so far: one eBay listing was tried with the production extension; the
description fix was built from the real eBay form. Still unverified live: eBay's package size picker (only its summary button was
seen), and the whole Vinted flow (see section 9).

1. **Scaffold** — pnpm workspace, root tsconfig, `packages/shared` (zod schemas, types, money
   helpers, marketplace constants & URL builders).
2. **Backend** — Worker + Hono routes, `AccountDO` with SQLite migrations and RPC methods, JWT +
   PBKDF2 auth, R2 image upload/serve, CORS for the extension, static-asset fallback to the SPA.
   Tests with `@cloudflare/vitest-plugin` (in workerd).
3. **Web app** — Vite + React + React Router: landing page, separate sign-in and sign-up pages, inventory grid with search/filter,
   dashboard stats, item create/edit with photo upload, item page with per-marketplace listing
   status and actions (list via extension, mark listed manually, mark sold, archive, delete,
   duplicate), settings page. Detects whether the extension is installed.
4. **Chrome extension** — MV3 manifest, background service worker (API client, job orchestration),
   side panel (login, inventory, list buttons), content scripts for Vinted and eBay, web bridge.
   Unit tests for the form-filling helpers (happy-dom).
5. **Verify** — typecheck everything, run tests, run `wrangler dev` + Vite, exercise the web app
   end to end in a browser, build the extension.

## 6. Running locally

```bash
pnpm install
pnpm dev            # wrangler dev (API on :8787) + vite (web on :5173, proxies /api)
pnpm build:ext      # → apps/extension/dist, load unpacked in chrome://extensions
pnpm test
```

Deploy: `pnpm run deploy` builds the web app, zips the production extension into its assets, bundles
the Worker, uploads source maps to Sentry (when configured) and runs `wrangler deploy`. Secrets first:
`JWT_SECRET`, `GEMINI_API_KEY`, `SENTRY_DSN` (see README). Build the extension against production with
`pnpm build:ext:prod` (→ `dist-prod/`), or `pnpm release:ext` for the Web Store zip.

## 7. Product roadmap (promised on the landing page, not built yet)

(Imports and relist & bump are built: see section 4, steps 7 and 9.)

**Pricing from comparables** (steps 1–4 of PRICING.md built: shared core, extension, API, web). Suggest a price from what the same or similar items sold for (eBay sold
searches), or failing that are listed at (eBay, Vinted), with collectable features (first edition,
signed, rare…) flagged and matched like for like. Full plan: [PRICING.md](PRICING.md).

**Find the treasure.** Help users spot underpriced items to buy and resell.
- Saved searches on Vinted/eBay run by the extension in the user's browser, flagging listings below
  a price threshold or below the user's own sold prices for similar items.
- "Save to inventory" from a marketplace item page (prefilled draft with cost = purchase price).

## 8. Later / out of scope for v1

- Bulk actions, CSV import/export, multi-quantity stock with per-sale tracking, profit reports.
- Email verification, password reset, email change (needs an email→account index).
- Image editing (crop/rotate/background removal), signed/private image URLs.
- Category/size mapping tables per marketplace for fuller auto-fill.
- Self-serve account deletion and data export in Settings (the privacy policy currently says "email us").
- Sentry in the extension (errors from content scripts on live marketplace pages).

## 9. Next up

1. **Publish the extension**: set `VITE_CONTACT_EMAIL`; check the Gemini API tier matches the privacy
   policy (on the free tier Google may use inputs to improve its products); name the legal entity on
   `/privacy`; take 1280×800 screenshots; submit to the Chrome Web Store (listing text drafted), then set
   `VITE_EXTENSION_URL` and redeploy.
2. **Live marketplace checks**: list a real item on Vinted and eBay. Capture eBay's package size picker
   and Vinted's form (category, brand, condition, parcel size) and turn them into test fixtures; adjust
   `apps/extension/src/content/{vinted,ebay}.ts` where selectors miss. Include cross-delisting: Vinted's
   Delete button and dialog, and whether eBay's item page has "End listing" for the seller.
3. Rate-limit `/api/auth/*` (Workers Rate Limiting binding).
4. Self-serve account deletion (section 8).
5. **Imports, live check**: import a few real listings from a Vinted wardrobe and from Seller Hub. Save
   a real item page from each as a fixture (`apps/extension/test/import.test.ts` uses approximations)
   and check what JSON-LD actually carries (Vinted: all photos? condition?), whether Vinted's CDN serves
   photos to the extension, and that Seller Hub's rows are picked up. Then: matching an eBay import to
   an item already imported from Vinted (today it becomes a second item).
6. **Relist, live check**: relist one Vinted and one eBay listing for real. Does Vinted accept the same
   photos again straight away, or flag a duplicate? Does eBay's "Sell similar" (opened from the old item)
   beat our fill, which still needs the category picked? Read each listing's real upload date on import
   so the clock doesn't start at import time.
