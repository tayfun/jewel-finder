# Jewel Finder

Inventory for eBay / Vinted resellers, with a Chrome extension that fills in the marketplaces'
own listing forms. See [PLAN.md](PLAN.md) for the architecture and roadmap.

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
```

Accounts live on one server, so sign in with the build that matches where you signed up. The side
panel's login screen shows which server it uses. The two builds can be loaded side by side.

Load the folder via **chrome://extensions → Developer mode → Load unpacked**. Click the
toolbar icon to open the side panel. Use `pnpm --filter @jf/extension watch` while developing it
(reload the extension after background changes).

Listing flow: pick an item (side panel, or "List on Vinted/eBay" in the web app) → the extension opens
the marketplace's sell page and fills photos, title, description, price and whatever else it can →
you finish the remaining fields shown in the on-page panel and press the marketplace's own button →
the extension records the listing URL back in your inventory.

Cross-delisting: mark an item sold ("Sold on Vinted/eBay/elsewhere") → its other live listings become
"Needs ending" and the extension opens each one → it gets the delete/end step ready (Vinted: Delete;
eBay: End listing with a reason) and you confirm → once the listing is gone it's marked ended.

The marketplace selectors live in `apps/extension/src/content/{vinted,ebay}.ts`. Marketplaces change
their DOM regularly — that's the first place to look when a field stops filling.

### AI auto-fill

"✨ Auto-fill from photos" on an item page sends the item's photos to Gemini and suggests a title,
description, condition, category, tags and book details (author, ISBN, edition, printing, rarity…).
You review and tick what to apply. Put a key from https://aistudio.google.com/apikey in
`apps/api/.dev.vars` as `GEMINI_API_KEY=...` (the model is `GEMINI_MODEL` in `wrangler.jsonc`; when it is overloaded the Worker falls back to `GEMINI_FALLBACK_MODEL`).
The prompt and response schema live in `apps/api/src/ai.ts`.

### Error monitoring (Sentry)

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
npx wrangler secret put GEMINI_API_KEY  # Google AI Studio key, for "Auto-fill from photos"
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
   `tabs` (opening Vinted/eBay sell pages), host access to the Worker (your inventory) and to Vinted/eBay
   (filling in their listing forms). Declare that it handles authentication info and website content, and
   that nothing is sold or used for anything else.
4. Submit for review (usually a few days). Choose **Unlisted** if only people with the link should find it.
5. Once approved, set `VITE_EXTENSION_URL` in `apps/web/.env` to the listing URL and redeploy: the
   "Install" links then go to the store.

For updates, bump `version` in `apps/extension/package.json`, run `pnpm release:ext` and upload the new zip.
