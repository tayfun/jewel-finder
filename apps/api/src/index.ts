import {
  Credentials,
  DismissDuplicateRequest,
  ImportRequest,
  ItemInput,
  ItemPatch,
  ItemStatus,
  ListingInput,
  Marketplace,
  MergeRequest,
  PriceCheckInput,
  SetAdminRequest,
  SettingsPatch,
  imageUrl,
  type Account,
  type AdminOverview,
  type ApiError,
  type AuthResponse,
  type AutofillSuggestion,
  compsForReview,
  type AiReview,
  type Comp,
  type DismissedPair,
  type DuplicatePair,
  type ImportResult,
  type ItemWithListings,
} from "@jf/shared";
import * as Sentry from "@sentry/cloudflare";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { AiError, reviewComps, suggestListing, type ImageInput } from "./ai";
import { hashPassword, issueToken, readToken, verifyPassword } from "./auth";
import { sentryOptions } from "./sentry";

export { AccountDO } from "./account-do";
export { DirectoryDO } from "./directory-do";

type AccountStub = DurableObjectStub<import("./account-do").AccountDO>;
type AppEnv = { Bindings: Env; Variables: { userId: string; email: string; account: AccountStub } };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/gif": "gif",
};

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const body: ApiError = {
    error: result.error.issues[0]?.message ?? "Invalid request",
    issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  };
  throw new HTTPException(400, { res: Response.json(body, { status: 400 }) });
}

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HTTPException(400, { message: "Body must be JSON" });
  }
}

function notFound(what = "Item"): never {
  throw new HTTPException(404, { message: `${what} not found` });
}

/** Image keys are namespaced per user; never let one user attach another's. */
function assertOwnImages(userId: string, keys: string[] | undefined) {
  if (keys?.some((k) => !k.startsWith(`u/${userId}/`))) {
    throw new HTTPException(400, { message: "Unknown image" });
  }
}

// ------------------------------------------------------- user directory

const directory = (env: Env) => env.DIRECTORY.getByName("directory");

/** Emails in the ADMIN_EMAILS secret: always admins. */
function ownerEmails(env: Env): string[] {
  return (env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

async function isAdmin(env: Env, userId: string, email: string): Promise<boolean> {
  return ownerEmails(env).includes(email) || (await directory(env).isAdmin(userId));
}

/**
 * Copies the account's counts to the directory. Runs after the response (waitUntil) and never
 * fails the request: a missed report only makes the admin dashboard slightly behind.
 */
async function reportToDirectory(env: Env, account: AccountStub): Promise<void> {
  try {
    const summary = await account.summary();
    if (summary) await directory(env).report(summary);
  } catch (e) {
    Sentry.captureException(e);
  }
}

const app = new Hono<AppEnv>();

// Request spans + capture of 5xx errors, including ones onError turns into responses.
// 503 is "feature not configured", which isn't worth an alert.
app.use(
  Sentry.honoMiddleware(app, {
    shouldHandleError: (err) => {
      const status = err instanceof HTTPException ? err.status : 500;
      return status >= 500 && status !== 503;
    },
  }),
);

app.use(
  "/api/*",
  cors({
    // The web app is same-origin; the extension calls from chrome-extension://.
    origin: (origin) => (origin.startsWith("chrome-extension://") ? origin : null),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    maxAge: 86400,
  }),
);

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.res ?? c.json<ApiError>({ error: err.message }, err.status);
  }
  console.error(err);
  return c.json<ApiError>({ error: "Internal error" }, 500);
});

// ------------------------------------------------------------------- auth

app.post("/api/auth/register", async (c) => {
  const { email, password } = parse(Credentials, await body(c));
  const stub = c.env.ACCOUNT.getByName(email);
  const result = await stub.register(email, await hashPassword(password));
  if (!result.ok) throw new HTTPException(409, { message: "An account with that email already exists" });
  const token = await issueToken({ sub: result.account.id, email }, c.env.JWT_SECRET);
  c.executionCtx.waitUntil(reportToDirectory(c.env, stub));
  const admin = await isAdmin(c.env, result.account.id, email);
  return c.json<AuthResponse>({ token, account: { ...result.account, isAdmin: admin } }, 201);
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = parse(Credentials, await body(c));
  const stub = c.env.ACCOUNT.getByName(email);
  const creds = await stub.getCredentials();
  if (!creds || !(await verifyPassword(password, creds.passwordHash))) {
    throw new HTTPException(401, { message: "Wrong email or password" });
  }
  c.executionCtx.waitUntil(reportToDirectory(c.env, stub));
  const token = await issueToken({ sub: creds.account.id, email }, c.env.JWT_SECRET);
  const admin = await isAdmin(c.env, creds.account.id, email);
  return c.json<AuthResponse>({ token, account: { ...creds.account, isAdmin: admin } });
});

// Everything below needs a bearer token.
app.use("/api/*", async (c, next) => {
  const header = c.req.header("Authorization") ?? "";
  const claims = header.startsWith("Bearer ") ? await readToken(header.slice(7), c.env.JWT_SECRET) : null;
  if (!claims) throw new HTTPException(401, { message: "Not signed in" });
  let id: DurableObjectId;
  try {
    id = c.env.ACCOUNT.idFromString(claims.sub);
  } catch {
    throw new HTTPException(401, { message: "Not signed in" });
  }
  c.set("userId", claims.sub);
  c.set("email", claims.email);
  Sentry.setUser({ id: claims.sub });
  c.set("account", c.env.ACCOUNT.get(id));
  await next();
  // Keep the admin dashboard's counts current: after any change, and on /api/me (each app or
  // side panel load) so it knows who's active and picks up accounts from before the directory.
  if (c.res.status < 400 && (c.req.method !== "GET" || c.req.path === "/api/me")) {
    c.executionCtx.waitUntil(reportToDirectory(c.env, c.var.account));
  }
});

app.get("/api/me", async (c) => {
  const [account, admin] = await Promise.all([c.var.account.getAccount(), isAdmin(c.env, c.var.userId, c.var.email)]);
  if (!account) throw new HTTPException(401, { message: "Account no longer exists" });
  return c.json<Account>({ ...account, isAdmin: admin });
});

app.patch("/api/me/settings", async (c) => {
  const patch = parse(SettingsPatch, await body(c));
  const account = (await c.var.account.updateSettings(patch)) ?? notFound("Account");
  return c.json<Account>({ ...account, isAdmin: await isAdmin(c.env, c.var.userId, c.var.email) });
});

app.get("/api/stats", async (c) => c.json(await c.var.account.stats()));

// ------------------------------------------------------------------ admin

app.use("/api/admin/*", async (c, next) => {
  if (!(await isAdmin(c.env, c.var.userId, c.var.email))) throw new HTTPException(403, { message: "Admins only" });
  await next();
});

app.get("/api/admin/overview", async (c) => c.json<AdminOverview>(await directory(c.env).overview(ownerEmails(c.env))));

app.put("/api/admin/users/:id/admin", async (c) => {
  const { isAdmin: makeAdmin } = parse(SetAdminRequest, await body(c));
  const id = c.req.param("id");
  if (id === c.var.userId && !makeAdmin) {
    throw new HTTPException(400, { message: "You can't remove your own admin access; ask another admin" });
  }
  if (!(await directory(c.env).setAdmin(id, makeAdmin))) notFound("User");
  return c.body(null, 204);
});

// Adds accounts to the directory by Durable Object id (scripts/backfill-directory.mjs lists them from
// the Cloudflare API). For accounts from before the directory existed that haven't signed in since.
app.post("/api/admin/sync", async (c) => {
  const { ids } = parse(z.object({ ids: z.array(z.string().max(100)).max(100) }), await body(c));
  let synced = 0;
  const missing: string[] = [];
  for (const raw of ids) {
    let summary = null;
    try {
      summary = await c.env.ACCOUNT.get(c.env.ACCOUNT.idFromString(raw)).summary();
    } catch {
      // Not a valid id for this namespace.
    }
    if (!summary) {
      missing.push(raw);
      continue;
    }
    await directory(c.env).report(summary, false);
    synced++;
  }
  return c.json({ synced, missing });
});

// ------------------------------------------------------------------ items

app.get("/api/items", async (c) => {
  const q = c.req.query("q")?.trim() || undefined;
  const status = c.req.query("status") ? parse(ItemStatus, c.req.query("status")) : undefined;
  return c.json({ items: await c.var.account.listItems({ q, status }) });
});

app.post("/api/items", async (c) => {
  const input = parse(ItemInput, await body(c));
  assertOwnImages(c.var.userId, input.images);
  return c.json(await c.var.account.createItem(input), 201);
});

// Existing marketplace listings brought in by the extension. Photos are uploaded first via /api/images.
app.post("/api/items/import", async (c) => {
  const { marketplace, listings } = parse(ImportRequest, await body(c));
  assertOwnImages(c.var.userId, listings.flatMap((l) => l.item.images));
  const { results, possibleDuplicates, skippedImages } = await c.var.account.importListings(marketplace, listings);
  // Already imported: the photos just uploaded for it aren't needed.
  if (skippedImages.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(skippedImages));
  return c.json<ImportResult>({ results, possibleDuplicates });
});

app.get("/api/items/:id", async (c) => {
  return c.json((await c.var.account.getItem(c.req.param("id"))) ?? notFound());
});

app.patch("/api/items/:id", async (c) => {
  const patch = parse(ItemPatch, await body(c));
  assertOwnImages(c.var.userId, patch.images);
  const result = (await c.var.account.updateItem(c.req.param("id"), patch)) ?? notFound();
  if (result.removedImages.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(result.removedImages));
  return c.json(result.item);
});

app.delete("/api/items/:id", async (c) => {
  const images = (await c.var.account.deleteItem(c.req.param("id"))) ?? notFound();
  if (images.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(images));
  return c.body(null, 204);
});

app.post("/api/items/:id/duplicate", async (c) => {
  const source = (await c.var.account.getItem(c.req.param("id"))) ?? notFound();
  // Copy photos so deleting one item never breaks the other.
  const images: string[] = [];
  for (const key of source.images) {
    const obj = await c.env.IMAGES.get(key);
    if (!obj) continue;
    const copy = `u/${c.var.userId}/${crypto.randomUUID()}.${key.split(".").pop()}`;
    await c.env.IMAGES.put(copy, obj.body, { httpMetadata: obj.httpMetadata });
    images.push(copy);
  }
  const { id: _id, listings: _l, createdAt: _c, updatedAt: _u, ...fields } = source;
  const input = ItemInput.parse({
    ...fields,
    sku: "",
    title: `${source.title} (copy)`.slice(0, 120),
    images,
    // Duplicating a sold item (quantity 0) is how you restock it.
    quantity: Math.max(1, source.quantity),
  });
  const copy = await c.var.account.createItem({ ...input, status: "draft" });
  // A copy is a deliberate second one (restocking), not a duplicate to flag.
  await c.var.account.dismissDuplicate(source.id, copy.id);
  return c.json(copy, 201);
});

// Folds another item (photos only if this one has none, missing details, tags, listings) into this one.
app.post("/api/items/:id/merge", async (c) => {
  const { otherId } = parse(MergeRequest, await body(c));
  const result = await c.var.account.mergeItems(c.req.param("id"), otherId);
  if (!result.ok) throw new HTTPException(result.status, { message: result.error });
  if (result.removedImages.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(result.removedImages));
  return c.json(result.item);
});

// ----------------------------------------------------------- price checks

/** The item's photos from R2, in order, at most `max` of them. */
async function itemImages(env: Env, keys: string[], max = keys.length): Promise<ImageInput[]> {
  const images: ImageInput[] = [];
  for (const key of keys.slice(0, max)) {
    const obj = await env.IMAGES.get(key);
    if (!obj) continue;
    images.push({ mimeType: obj.httpMetadata?.contentType ?? "image/jpeg", bytes: new Uint8Array(await obj.arrayBuffer()) });
  }
  return images;
}

/** Gemini's review of the comps. Never fails the price check: a failed review is recorded as such. */
async function reviewSafely(c: Context<AppEnv>, item: ItemWithListings, comps: Comp[]): Promise<AiReview> {
  try {
    const [images, account] = await Promise.all([itemImages(c.env, item.images, 2), c.var.account.getAccount()]);
    return await reviewComps(c.env, item, compsForReview(item, comps), images, account?.settings.currency);
  } catch (e) {
    if (!(e instanceof AiError)) Sentry.captureException(e);
    const error = e instanceof AiError ? e.message : "The AI review failed.";
    return { status: "failed", at: Date.now(), basis: "", judgements: {}, note: "", error };
  }
}

// Comparables the extension found for the item; the server works out the suggested price, with
// Gemini's view of which comps are really the same item when AI is set up (PRICING.md §8).
app.post("/api/items/:id/price-check", async (c) => {
  const input = parse(PriceCheckInput, await body(c));
  const item = (await c.var.account.getItem(c.req.param("id"))) ?? notFound();
  const ai = c.env.GEMINI_API_KEY ? await reviewSafely(c, item, input.comps) : null;
  return c.json((await c.var.account.savePriceCheck(item.id, input, ai)) ?? notFound(), 201);
});

// Reviews the latest check's comps again, e.g. after the item changed or the last review failed.
app.post("/api/items/:id/price-check/review", async (c) => {
  if (!c.env.GEMINI_API_KEY) throw new HTTPException(503, { message: "AI isn't set up on this server yet" });
  const item = (await c.var.account.getItem(c.req.param("id"))) ?? notFound();
  const check = (await c.var.account.latestPriceCheck(item.id)) ?? notFound("Price check");
  const ai = await reviewSafely(c, item, check.comps);
  if (ai.status === "failed") throw new HTTPException(502, { message: ai.error ?? "The AI review failed." });
  return c.json((await c.var.account.setPriceCheckReview(item.id, check.id, ai)) ?? notFound());
});

app.get("/api/items/:id/price-check", async (c) => {
  const check = await c.var.account.latestPriceCheck(c.req.param("id"));
  return check ? c.json(check) : c.json({ error: "No price check yet" }, 404);
});

// ------------------------------------------------------------- duplicates

app.get("/api/duplicates", async (c) => {
  const itemId = c.req.query("itemId") || undefined;
  return c.json<{ pairs: DuplicatePair[] }>({ pairs: await c.var.account.findDuplicates(itemId) });
});

app.post("/api/duplicates/dismiss", async (c) => {
  const { a, b } = parse(DismissDuplicateRequest, await body(c));
  await c.var.account.dismissDuplicate(a, b);
  return c.body(null, 204);
});

app.get("/api/duplicates/dismissed", async (c) => {
  return c.json<{ pairs: DismissedPair[] }>({ pairs: await c.var.account.dismissedDuplicates() });
});

app.post("/api/duplicates/undismiss", async (c) => {
  const { a, b } = parse(DismissDuplicateRequest, await body(c));
  await c.var.account.undismissDuplicate(a, b);
  return c.body(null, 204);
});

app.post("/api/items/:id/sold", async (c) => {
  const { marketplace } = parse(z.object({ marketplace: Marketplace.optional() }), await body(c));
  return c.json((await c.var.account.markSold(c.req.param("id"), marketplace)) ?? notFound());
});

// Drafts listing data from the item's photos with Gemini. Returns a suggestion; nothing is saved.
app.post("/api/items/:id/autofill", async (c) => {
  if (!c.env.GEMINI_API_KEY) throw new HTTPException(503, { message: "AI auto-fill isn't set up on this server yet" });
  const item = (await c.var.account.getItem(c.req.param("id"))) ?? notFound();
  if (!item.images.length) throw new HTTPException(400, { message: "Add at least one photo first" });
  const images = await itemImages(c.env, item.images);
  try {
    return c.json<{ suggestion: AutofillSuggestion }>({ suggestion: await suggestListing(c.env, images, item) });
  } catch (e) {
    if (e instanceof AiError) throw new HTTPException(502, { message: e.message });
    throw e;
  }
});

app.get("/api/listings", async (c) => {
  const marketplace = parse(Marketplace, c.req.query("marketplace"));
  return c.json({ listings: await c.var.account.listListings(marketplace) });
});

app.put("/api/items/:id/listings/:marketplace", async (c) => {
  const marketplace = parse(Marketplace, c.req.param("marketplace"));
  const input = parse(ListingInput, await body(c));
  return c.json((await c.var.account.upsertListing(c.req.param("id"), marketplace, input)) ?? notFound());
});

app.delete("/api/items/:id/listings/:marketplace", async (c) => {
  const marketplace = parse(Marketplace, c.req.param("marketplace"));
  if (!(await c.var.account.deleteListing(c.req.param("id"), marketplace))) notFound("Listing");
  return c.body(null, 204);
});

// ----------------------------------------------------------------- images

app.post("/api/images", async (c) => {
  const type = (c.req.header("Content-Type") ?? "").split(";")[0]!.trim();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new HTTPException(415, { message: "Upload a JPEG, PNG, WebP, HEIC or GIF image" });
  const length = Number(c.req.header("Content-Length") ?? 0);
  if (length > MAX_IMAGE_BYTES) throw new HTTPException(413, { message: "Images must be under 10 MB" });
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) throw new HTTPException(400, { message: "Empty upload" });
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new HTTPException(413, { message: "Images must be under 10 MB" });
  const key = `u/${c.var.userId}/${crypto.randomUUID()}.${ext}`;
  await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: type } });
  return c.json({ key, url: imageUrl(new URL(c.req.url).origin, key) }, 201);
});

// Public: keys are unguessable. CORS * so marketplace content scripts can fetch them.
app.get("/images/*", async (c) => {
  const key = c.req.path.slice("/images/".length);
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.text("Not found", 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("ETag", obj.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(obj.body, { headers });
});

app.all("/api/*", (c) => c.json<ApiError>({ error: "Not found" }, 404));

// Anything else is the web app (normally handled by the assets layer before we run).
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default Sentry.withSentry(sentryOptions, { fetch: app.fetch } satisfies ExportedHandler<Env>);
