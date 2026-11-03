import {
  Credentials,
  ImportRequest,
  ItemInput,
  ItemPatch,
  ItemStatus,
  ListingInput,
  Marketplace,
  SettingsPatch,
  imageUrl,
  type ApiError,
  type AuthResponse,
  type AutofillSuggestion,
  type ImportResult,
} from "@jf/shared";
import * as Sentry from "@sentry/cloudflare";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { AutofillError, suggestListing } from "./ai";
import { hashPassword, issueToken, readToken, verifyPassword } from "./auth";
import { sentryOptions } from "./sentry";

export { AccountDO } from "./account-do";

type AppEnv = { Bindings: Env; Variables: { userId: string; account: DurableObjectStub<import("./account-do").AccountDO> } };

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
  return c.json<AuthResponse>({ token, account: result.account }, 201);
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = parse(Credentials, await body(c));
  const creds = await c.env.ACCOUNT.getByName(email).getCredentials();
  if (!creds || !(await verifyPassword(password, creds.passwordHash))) {
    throw new HTTPException(401, { message: "Wrong email or password" });
  }
  const token = await issueToken({ sub: creds.account.id, email }, c.env.JWT_SECRET);
  return c.json<AuthResponse>({ token, account: creds.account });
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
  Sentry.setUser({ id: claims.sub });
  c.set("account", c.env.ACCOUNT.get(id));
  await next();
});

app.get("/api/me", async (c) => {
  const account = await c.var.account.getAccount();
  if (!account) throw new HTTPException(401, { message: "Account no longer exists" });
  return c.json(account);
});

app.patch("/api/me/settings", async (c) => {
  const patch = parse(SettingsPatch, await body(c));
  return c.json((await c.var.account.updateSettings(patch)) ?? notFound("Account"));
});

app.get("/api/stats", async (c) => c.json(await c.var.account.stats()));

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
  const { results, skippedImages } = await c.var.account.importListings(marketplace, listings);
  // Already imported: the photos just uploaded for it aren't needed.
  if (skippedImages.length) c.executionCtx.waitUntil(c.env.IMAGES.delete(skippedImages));
  return c.json<ImportResult>({ results });
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
  return c.json(await c.var.account.createItem({ ...input, status: "draft" }), 201);
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
  const images = [];
  for (const key of item.images) {
    const obj = await c.env.IMAGES.get(key);
    if (!obj) continue;
    images.push({
      mimeType: obj.httpMetadata?.contentType ?? "image/jpeg",
      bytes: new Uint8Array(await obj.arrayBuffer()),
    });
  }
  try {
    return c.json<{ suggestion: AutofillSuggestion }>({ suggestion: await suggestListing(c.env, images, item) });
  } catch (e) {
    if (e instanceof AutofillError) throw new HTTPException(502, { message: e.message });
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
