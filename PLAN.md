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
- **listings**: `id, item_id, marketplace (vinted|ebay), status (pending|listed|sold|ended|failed),
  external_id, url, price, error, created_at, updated_at` — unique on `(item_id, marketplace)`

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

Selectors live in one adapter file per marketplace with multiple fallback strategies
(test ids → names → label text → placeholders) because marketplace DOMs change without notice.

## 5. Implementation steps

Status (2026-11-03): steps 1–5 are implemented and deployed, along with AI auto-fill, Sentry, package
sizes, the extension install page and the privacy policy. Tests: shared 10, API 16 (in workerd), extension 14
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

**Import from platforms.** Bring a seller's existing Vinted and eBay listings into their inventory.
- The extension reads the seller's own "my items" pages (Vinted member wardrobe, eBay Seller Hub
  active listings) while they're signed in, opening each listing to collect title, description,
  price, brand/size/condition and photo URLs.
- Background worker downloads the photos, uploads them to R2 via `/api/images`, and creates items
  through a new `POST /api/items/import` (batch). Each imported item gets a `listed` listing row
  with its marketplace URL/id, so nothing is listed twice.
- De-duplicate on `(marketplace, external_id)`; re-running an import only adds new listings.
- Web app: "Import" button that hands off to the extension (same bridge as listing), with progress.

**Relist & bump to the top.** Refresh stale listings without manual delete + recreate.
- Vinted: "bump" is either Vinted's paid push or delete-and-relist; ours is the latter, automated:
  the extension re-creates the listing from inventory data (photos, fields) and then deletes the old one.
- eBay: use the native "Sell similar" / relist flow for ended items, and end-and-relist for stale active ones.
- Track `listed_at` / `relisted_count` per listing; show "stale for N days" and a "Relist" action,
  plus a bulk "relist everything older than N days".

**Find the treasure.** Help users spot underpriced items to buy and resell.
- Saved searches on Vinted/eBay run by the extension in the user's browser, flagging listings below
  a price threshold or below the user's own sold prices for similar items.
- "Save to inventory" from a marketplace item page (prefilled draft with cost = purchase price).

## 8. Later / out of scope for v1

- Cross-delisting: when an item sells on one marketplace, open the others and end the listing.
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
   `apps/extension/src/content/{vinted,ebay}.ts` where selectors miss.
3. Rate-limit `/api/auth/*` (Workers Rate Limiting binding).
4. Self-serve account deletion (section 8).
5. Cross-delisting when an item sells (section 8).
6. Imports, then relist/bump (section 7).
