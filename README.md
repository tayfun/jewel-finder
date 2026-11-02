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
pnpm build:ext    # → apps/extension/dist (talks to http://localhost:8787 by default)
```

Load `apps/extension/dist` via **chrome://extensions → Developer mode → Load unpacked**. Click the
toolbar icon to open the side panel. Use `pnpm --filter @jf/extension watch` while developing it
(reload the extension after background changes).

Listing flow: pick an item (side panel, or "List on Vinted/eBay" in the web app) → the extension opens
the marketplace's sell page and fills photos, title, description, price and whatever else it can →
you finish the remaining fields shown in the on-page panel and press the marketplace's own button →
the extension records the listing URL back in your inventory.

The marketplace selectors live in `apps/extension/src/content/{vinted,ebay}.ts`. Marketplaces change
their DOM regularly — that's the first place to look when a field stops filling.

### AI auto-fill

"✨ Auto-fill from photos" on an item page sends the item's photos to Gemini and suggests a title,
description, condition, category, tags and book details (author, ISBN, edition, printing, rarity…).
You review and tick what to apply. Put a key from https://aistudio.google.com/apikey in
`apps/api/.dev.vars` as `GEMINI_API_KEY=...` (the model is `GEMINI_MODEL` in `wrangler.jsonc`).
The prompt and response schema live in `apps/api/src/ai.ts`.

### Error monitoring (Sentry)

The API (Worker + Durable Object) and the web app report errors and performance traces to Sentry.
Both are off until a DSN is set, so local dev sends nothing by default.

- **API:** `SENTRY_DSN` in `apps/api/.dev.vars` locally; `npx wrangler secret put SENTRY_DSN` for production.
  `SENTRY_ENVIRONMENT` is `production` in `wrangler.jsonc` and `development` in `.dev.vars`.
- **Web app:** `VITE_SENTRY_DSN` (and optionally `VITE_SENTRY_ENVIRONMENT`) in the build environment,
  e.g. `apps/web/.env.local`. Browser traces continue into the API, so a slow page shows its Worker spans.
- **Readable stack traces:** set `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` when running
  the web build; source maps are uploaded and then deleted from `dist/`.

Events carry only the account id (no email). Request bodies, cookies, SQL values and Gemini prompts
and photos are not sent. 4xx responses and the 503 "not configured" response aren't reported.

## Deploy

```bash
cd apps/api
npx wrangler r2 bucket create jewel-finder-images
npx wrangler secret put JWT_SECRET      # a long random string
npx wrangler secret put GEMINI_API_KEY  # Google AI Studio key, for "Auto-fill from photos"
npx wrangler secret put SENTRY_DSN      # Sentry project DSN for the API (optional)
cd ../.. && VITE_SENTRY_DSN=... pnpm run deploy   # builds the web app, deploys Worker + assets
API_URL=https://jewel-finder.<you>.workers.dev pnpm build:ext
```
