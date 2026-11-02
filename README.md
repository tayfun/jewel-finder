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

## Deploy

```bash
cd apps/api
npx wrangler r2 bucket create jewel-finder-images
npx wrangler secret put JWT_SECRET      # a long random string
npx wrangler secret put GEMINI_API_KEY  # Google AI Studio key, for "Auto-fill from photos"
cd ../.. && pnpm deploy                 # builds the web app, deploys Worker + assets
API_URL=https://jewel-finder.<you>.workers.dev pnpm build:ext
```
