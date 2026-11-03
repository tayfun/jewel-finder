import type { AuthResponse, DuplicatePair, ImportResult, ItemWithListings, Listing, PriceCheck, Stats } from "@jf/shared";
import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

const BASE = "https://jf.test";

async function call<T = unknown>(
  path: string,
  init: { method?: string; token?: string; json?: unknown; body?: BodyInit; type?: string } = {},
): Promise<{ status: number; data: T }> {
  const headers: Record<string, string> = {};
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.type) headers["Content-Type"] = init.type;
  const res = await exports.default.fetch(
    new Request(BASE + path, {
      method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
    }),
  );
  const text = await res.text();
  return { status: res.status, data: (text && res.headers.get("Content-Type")?.includes("json") ? JSON.parse(text) : text) as T };
}

let n = 0;
async function signUp() {
  const email = `seller${++n}-${crypto.randomUUID()}@example.com`;
  const { status, data } = await call<AuthResponse>("/api/auth/register", {
    json: { email, password: "hunter2hunter2" },
  });
  expect(status).toBe(201);
  return { email, token: data.token, account: data.account };
}

describe("auth", () => {
  it("registers, logs in, rejects bad passwords and duplicates", async () => {
    const { email, account } = await signUp();
    expect(account.settings.vintedDomain).toBe("www.vinted.co.uk");

    const dup = await call("/api/auth/register", { json: { email, password: "hunter2hunter2" } });
    expect(dup.status).toBe(409);

    const bad = await call("/api/auth/login", { json: { email, password: "wrong-password" } });
    expect(bad.status).toBe(401);

    const unknown = await call("/api/auth/login", { json: { email: "nobody@example.com", password: "whatever1" } });
    expect(unknown.status).toBe(401);

    const ok = await call<AuthResponse>("/api/auth/login", { json: { email: email.toUpperCase(), password: "hunter2hunter2" } });
    expect(ok.status).toBe(200);
    const me = await call<{ email: string }>("/api/me", { token: ok.data.token });
    expect(me.data.email).toBe(email);
  });

  it("requires a token", async () => {
    expect((await call("/api/items")).status).toBe(401);
    expect((await call("/api/items", { token: "garbage" })).status).toBe(401);
  });

  it("validates input", async () => {
    const res = await call<{ error: string }>("/api/auth/register", { json: { email: "x", password: "short" } });
    expect(res.status).toBe(400);
  });
});

describe("items", () => {
  it("creates, lists, searches, updates and deletes", async () => {
    const { token } = await signUp();
    const created = await call<ItemWithListings>("/api/items", {
      token,
      json: { title: "Levi's 501 jeans", brand: "Levi's", price: 2500, cost: 800, tags: ["denim"] },
    });
    expect(created.status).toBe(201);
    expect(created.data).toMatchObject({ sku: "JF-0001", status: "in_stock", quantity: 1, listings: [] });
    await call("/api/items", { token, json: { title: "Nike Air Max", brand: "Nike", price: 4000 } });

    const all = await call<{ items: ItemWithListings[] }>("/api/items", { token });
    expect(all.data.items).toHaveLength(2);
    const search = await call<{ items: ItemWithListings[] }>("/api/items?q=denim", { token });
    expect(search.data.items.map((i) => i.title)).toEqual(["Levi's 501 jeans"]);

    const id = created.data.id;
    const patched = await call<ItemWithListings>(`/api/items/${id}`, { token, method: "PATCH", json: { price: 2200 } });
    expect(patched.data).toMatchObject({ price: 2200, title: "Levi's 501 jeans", brand: "Levi's" });

    const stats = await call<Stats>("/api/stats", { token });
    expect(stats.data).toMatchObject({ stockValue: 6200, stockCost: 800 });
    expect(stats.data.byStatus.in_stock).toBe(2);

    expect((await call(`/api/items/${id}`, { token, method: "DELETE" })).status).toBe(204);
    expect((await call(`/api/items/${id}`, { token })).status).toBe(404);
  });

  it("isolates users", async () => {
    const a = await signUp();
    const b = await signUp();
    const item = await call<ItemWithListings>("/api/items", { token: a.token, json: { title: "Mine" } });
    expect((await call(`/api/items/${item.data.id}`, { token: b.token })).status).toBe(404);
    expect((await call<{ items: unknown[] }>("/api/items", { token: b.token })).data.items).toHaveLength(0);
  });

  it("tracks listings and marks items sold", async () => {
    const { token } = await signUp();
    const { data: item } = await call<ItemWithListings>("/api/items", { token, json: { title: "Jacket", price: 3000 } });

    const pending = await call(`/api/items/${item.id}/listings/vinted`, { token, method: "PUT", json: { status: "pending" } });
    expect(pending.status).toBe(200);
    await call(`/api/items/${item.id}/listings/vinted`, {
      token,
      method: "PUT",
      json: { status: "listed", externalId: "123", url: "https://www.vinted.co.uk/items/123-jacket" },
    });
    await call(`/api/items/${item.id}/listings/ebay`, { token, method: "PUT", json: { status: "listed" } });

    const stats = await call<Stats>("/api/stats", { token });
    expect(stats.data.listed).toEqual({ vinted: 1, ebay: 1 });

    const sold = await call<ItemWithListings>(`/api/items/${item.id}/sold`, { token, json: { marketplace: "vinted" } });
    expect(sold.data.status).toBe("sold");
    const byMarket = Object.fromEntries(sold.data.listings.map((l) => [l.marketplace, l]));
    expect(byMarket.vinted).toMatchObject({ status: "sold", externalId: "123" });
    // Still live on eBay: flagged for ending rather than silently marked ended.
    expect(byMarket.ebay?.status).toBe("ending");
    expect((await call<Stats>("/api/stats", { token })).data.toEnd).toBe(1);
    const ended = await call(`/api/items/${item.id}/listings/ebay`, { token, method: "PUT", json: { status: "ended" } });
    expect(ended.status).toBe(200);
    expect((await call<Stats>("/api/stats", { token })).data.toEnd).toBe(0);

    const bad = await call(`/api/items/${item.id}/listings/etsy`, { token, method: "PUT", json: { status: "listed" } });
    expect(bad.status).toBe(400);
  });
});

describe("images", () => {
  it("uploads, serves, attaches and cleans up photos", async () => {
    const { token } = await signUp();
    const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
    const up = await call<{ key: string; url: string }>("/api/images", { token, body: png, type: "image/png" });
    expect(up.status).toBe(201);
    expect(up.data.url).toBe(`${BASE}/images/${up.data.key}`);

    const res = await exports.default.fetch(up.data.url);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);

    const rejected = await call("/api/images", { token, body: "hello", type: "text/plain" });
    expect(rejected.status).toBe(415);

    const { data: item } = await call<ItemWithListings>("/api/items", { token, json: { title: "Bag", images: [up.data.key] } });
    const other = await signUp();
    const stolen = await call("/api/items", { token: other.token, json: { title: "Bag", images: [up.data.key] } });
    expect(stolen.status).toBe(400);

    const dup = await call<ItemWithListings>(`/api/items/${item.id}/duplicate`, { token, method: "POST" });
    expect(dup.data.images).toHaveLength(1);
    expect(dup.data.images[0]).not.toBe(up.data.key);
    expect(dup.data.status).toBe("draft");

    await call(`/api/items/${dup.data.id}/sold`, { token, json: {} });
    const restock = await call<ItemWithListings>(`/api/items/${dup.data.id}/duplicate`, { token, method: "POST" });
    expect(restock.data.quantity).toBe(1);

    await call(`/api/items/${item.id}`, { token, method: "PATCH", json: { images: [] } });
    // R2 deletion happens in waitUntil; poll briefly.
    let status = 200;
    for (let i = 0; i < 20 && status === 200; i++) {
      status = (await exports.default.fetch(up.data.url)).status;
      if (status === 200) await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe(404);
    expect((await exports.default.fetch(`${BASE}/images/${dup.data.images[0]}`)).status).toBe(200);
  });
});

describe("imports", () => {
  const png = () => Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

  it("creates items with their listings and skips ones already imported", async () => {
    const { token } = await signUp();
    const up = await call<{ key: string }>("/api/images", { token, body: png(), type: "image/png" });
    const listing = (id: string, extra: Record<string, unknown> = {}) => ({
      externalId: id,
      url: `https://www.vinted.co.uk/items/${id}-thing`,
      item: { title: `Thing ${id}`, price: 1200, ...extra },
    });

    const first = await call<ImportResult>("/api/items/import", {
      token,
      json: {
        marketplace: "vinted",
        listings: [
          listing("111", { images: [up.data.key], brand: "Zara", condition: "good" }),
          { ...listing("222"), state: "sold", item: { title: "Gone", status: "sold", quantity: 0 } },
        ],
      },
    });
    expect(first.status).toBe(200);
    expect(first.data.results.map((r) => [r.externalId, r.created])).toEqual([["111", true], ["222", true]]);

    const item = await call<ItemWithListings>(`/api/items/${first.data.results[0]!.itemId}`, { token });
    expect(item.data).toMatchObject({ title: "Thing 111", brand: "Zara", condition: "good", status: "in_stock", sku: "JF-0001" });
    expect(item.data.images).toEqual([up.data.key]);
    expect(item.data.listings).toEqual([
      expect.objectContaining({ marketplace: "vinted", status: "listed", externalId: "111", url: "https://www.vinted.co.uk/items/111-thing", price: 1200 }),
    ]);
    const sold = await call<ItemWithListings>(`/api/items/${first.data.results[1]!.itemId}`, { token });
    expect(sold.data).toMatchObject({ status: "sold", quantity: 0 });
    expect(sold.data.listings[0]?.status).toBe("sold");

    const known = await call<{ listings: Listing[] }>("/api/listings?marketplace=vinted", { token });
    expect(known.data.listings.map((l) => l.externalId).sort()).toEqual(["111", "222"]);
    expect((await call<{ listings: Listing[] }>("/api/listings?marketplace=ebay", { token })).data.listings).toEqual([]);

    // Re-running adds only what's new; the same id on another marketplace is a different listing.
    const again = await call<ImportResult>("/api/items/import", { token, json: { marketplace: "vinted", listings: [listing("111"), listing("333")] } });
    expect(again.data.results).toEqual([
      { externalId: "111", itemId: first.data.results[0]!.itemId, created: false },
      expect.objectContaining({ externalId: "333", created: true }),
    ]);
    const ebay = await call<ImportResult>("/api/items/import", {
      token,
      json: { marketplace: "ebay", listings: [{ ...listing("111"), url: "https://www.ebay.co.uk/itm/111" }] },
    });
    expect(ebay.data.results[0]?.created).toBe(true);
    expect((await call<{ items: unknown[] }>("/api/items", { token })).data.items).toHaveLength(4);
    expect((await call<Stats>("/api/stats", { token })).data.listed).toEqual({ vinted: 2, ebay: 1 });
  });

  it("validates the batch and rejects other users' photos", async () => {
    const a = await signUp();
    const b = await signUp();
    const up = await call<{ key: string }>("/api/images", { token: a.token, body: png(), type: "image/png" });
    const stolen = await call("/api/items/import", {
      token: b.token,
      json: { marketplace: "vinted", listings: [{ externalId: "1", url: "https://www.vinted.co.uk/items/1", item: { title: "x", images: [up.data.key] } }] },
    });
    expect(stolen.status).toBe(400);
    expect((await call("/api/items/import", { token: b.token, json: { marketplace: "vinted", listings: [] } })).status).toBe(400);
    expect((await call("/api/items/import", { token: b.token, json: { marketplace: "etsy", listings: [] } })).status).toBe(400);
    expect((await call("/api/listings?marketplace=etsy", { token: b.token })).status).toBe(400);
    expect((await call<{ items: unknown[] }>("/api/items", { token: b.token })).data.items).toHaveLength(0);
  });
});

describe("duplicates", () => {
  const png = () => Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="), (c) => c.charCodeAt(0));

  it("flags the same item imported from both marketplaces and merges it", async () => {
    const { token } = await signUp();
    const photo = async () => (await call<{ key: string }>("/api/images", { token, body: png(), type: "image/png" })).data.key;
    const [vPhoto, ePhoto] = [await photo(), await photo()];
    const v = await call<ImportResult>("/api/items/import", {
      token,
      json: {
        marketplace: "vinted",
        listings: [{ externalId: "11", url: "https://www.vinted.co.uk/items/11", item: { title: "Levi's 501 jeans", brand: "Levi's", size: "W32", price: 2500, images: [vPhoto], tags: ["denim"] } }],
      },
    });
    expect(v.data.possibleDuplicates).toEqual([]);
    const e = await call<ImportResult>("/api/items/import", {
      token,
      json: {
        marketplace: "ebay",
        listings: [
          {
            externalId: "326112233445",
            url: "https://www.ebay.co.uk/itm/326112233445",
            item: { title: "Levis 501 Original Straight Jeans Mens W32 L30", brand: "Levi's", size: "W32 L30", price: 2800, description: "From eBay", condition: "good", images: [ePhoto], tags: ["mens"] },
          },
        ],
      },
    });
    const vId = v.data.results[0]!.itemId;
    const eId = e.data.results[0]!.itemId;
    expect(e.data.possibleDuplicates).toEqual([eId]);

    const all = await call<{ pairs: DuplicatePair[] }>("/api/duplicates", { token });
    expect(all.data.pairs).toHaveLength(1);
    expect(all.data.pairs[0]!.reasons).toContain("Listed on Vinted and eBay");
    expect((await call<Stats>("/api/stats", { token })).data.duplicates).toBe(1);
    expect((await call<{ pairs: DuplicatePair[] }>(`/api/duplicates?itemId=${vId}`, { token })).data.pairs).toHaveLength(1);

    // Keep the Vinted item: it gets the eBay listing, the missing description and condition, and both tags.
    const merged = await call<ItemWithListings>(`/api/items/${vId}/merge`, { token, json: { otherId: eId } });
    expect(merged.status).toBe(200);
    expect(merged.data).toMatchObject({ title: "Levi's 501 jeans", price: 2500, description: "From eBay", condition: "good", images: [vPhoto], tags: ["denim", "mens"] });
    expect(merged.data.listings.map((l) => [l.marketplace, l.status, l.externalId])).toEqual([
      ["ebay", "listed", "326112233445"],
      ["vinted", "listed", "11"],
    ]);
    expect((await call(`/api/items/${eId}`, { token })).status).toBe(404);
    expect((await call<{ items: unknown[] }>("/api/items", { token })).data.items).toHaveLength(1);
    expect((await call<Stats>("/api/stats", { token })).data.duplicates).toBe(0);
    // Re-importing the eBay listing now finds it on the merged item.
    const again = await call<ImportResult>("/api/items/import", {
      token,
      json: { marketplace: "ebay", listings: [{ externalId: "326112233445", url: "https://www.ebay.co.uk/itm/326112233445", item: { title: "x" } }] },
    });
    expect(again.data.results[0]).toMatchObject({ itemId: vId, created: false });
    // The dropped item's photo is deleted (in waitUntil).
    let status = 200;
    for (let i = 0; i < 20 && status === 200; i++) {
      status = (await exports.default.fetch(`${BASE}/images/${ePhoto}`)).status;
      if (status === 200) await new Promise((r) => setTimeout(r, 25));
    }
    expect(status).toBe(404);
  });

  it("carries a sale across: the merged item is sold and its other live listing needs ending", async () => {
    const { token } = await signUp();
    const { data: a } = await call<ItemWithListings>("/api/items", { token, json: { title: "Zara linen shirt white", size: "L" } });
    const { data: b } = await call<ItemWithListings>("/api/items", { token, json: { title: "Zara linen shirt white L", size: "L" } });
    await call(`/api/items/${a.id}/listings/ebay`, { token, method: "PUT", json: { status: "listed", externalId: "999999999" } });
    await call(`/api/items/${b.id}/listings/vinted`, { token, method: "PUT", json: { status: "listed", externalId: "5" } });
    await call(`/api/items/${b.id}/sold`, { token, json: { marketplace: "vinted" } });
    const merged = await call<ItemWithListings>(`/api/items/${a.id}/merge`, { token, json: { otherId: b.id } });
    expect(merged.data).toMatchObject({ status: "sold", quantity: 0 });
    expect(Object.fromEntries(merged.data.listings.map((l) => [l.marketplace, l.status]))).toEqual({ ebay: "ending", vinted: "sold" });
  });

  it("refuses to merge two live listings on one site, and remembers 'not duplicates'", async () => {
    const { token } = await signUp();
    const { data: a } = await call<ItemWithListings>("/api/items", { token, json: { title: "Penguin Modern Classics Orwell 1984" } });
    const { data: b } = await call<ItemWithListings>("/api/items", { token, json: { title: "Orwell 1984 Penguin Modern Classics" } });
    expect((await call<{ pairs: DuplicatePair[] }>("/api/duplicates", { token })).data.pairs).toHaveLength(1);

    await call(`/api/items/${a.id}/listings/vinted`, { token, method: "PUT", json: { status: "listed", externalId: "1" } });
    await call(`/api/items/${b.id}/listings/vinted`, { token, method: "PUT", json: { status: "listed", externalId: "2" } });
    const conflict = await call<{ error: string }>(`/api/items/${a.id}/merge`, { token, json: { otherId: b.id } });
    expect(conflict.status).toBe(409);
    expect(conflict.data.error).toMatch(/Both items have a Vinted listing/);
    expect((await call(`/api/items/${a.id}/merge`, { token, json: { otherId: a.id } })).status).toBe(400);
    expect((await call(`/api/items/${a.id}/merge`, { token, json: { otherId: "nope" } })).status).toBe(404);

    await call(`/api/items/${b.id}/listings/vinted`, { token, method: "DELETE" });
    expect((await call<{ pairs: DuplicatePair[] }>("/api/duplicates", { token })).data.pairs).toHaveLength(1);
    expect((await call("/api/duplicates/dismiss", { token, json: { a: b.id, b: a.id } })).status).toBe(204);
    expect((await call<{ pairs: DuplicatePair[] }>("/api/duplicates", { token })).data.pairs).toHaveLength(0);
  });

  it("doesn't flag a deliberate copy made with Duplicate", async () => {
    const { token } = await signUp();
    const { data: a } = await call<ItemWithListings>("/api/items", { token, json: { title: "The Hobbit paperback Tolkien" } });
    await call(`/api/items/${a.id}/duplicate`, { token, method: "POST" });
    expect((await call<{ pairs: DuplicatePair[] }>("/api/duplicates", { token })).data.pairs).toHaveLength(0);
  });
});

describe("relisting", () => {
  it("records when a listing went live and counts relists", async () => {
    const { token } = await signUp();
    const { data: item } = await call<ItemWithListings>("/api/items", { token, json: { title: "Jacket", price: 3000 } });
    const put = (json: unknown) => call<Listing>(`/api/items/${item.id}/listings/vinted`, { token, method: "PUT", json });

    const pending = await put({ status: "pending" });
    expect(pending.data).toMatchObject({ listedAt: null, relistedCount: 0 });
    const live = await put({ status: "listed", externalId: "100", url: "https://www.vinted.co.uk/items/100" });
    expect(live.data.listedAt).toBeGreaterThan(0);
    expect(live.data.relistedCount).toBe(0);

    // Updates that keep the same listing (clearing an error, same id) don't restart the clock.
    await new Promise((r) => setTimeout(r, 5));
    const same = await put({ status: "listed", error: null });
    expect(same.data).toMatchObject({ listedAt: live.data.listedAt, relistedCount: 0, externalId: "100" });

    // A new id while live is a relist: new clock, count goes up, link replaced.
    const relisted = await put({ status: "listed", externalId: "200", url: "https://www.vinted.co.uk/items/200" });
    expect(relisted.data).toMatchObject({ relistedCount: 1, externalId: "200", url: "https://www.vinted.co.uk/items/200" });
    expect(relisted.data.listedAt!).toBeGreaterThan(live.data.listedAt!);

    // Ended, then listed again: a new clock but not a relist of a live listing.
    await put({ status: "ended" });
    const back = await put({ status: "listed", externalId: "300" });
    expect(back.data.relistedCount).toBe(1);
    expect(back.data.listedAt!).toBeGreaterThan(relisted.data.listedAt!);
  });

  it("starts the clock for imported listings and reports stale ones per the settings", async () => {
    const { token } = await signUp();
    const imported = await call<ImportResult>("/api/items/import", {
      token,
      json: { marketplace: "vinted", listings: [{ externalId: "1", url: "https://www.vinted.co.uk/items/1", item: { title: "Old coat" } }] },
    });
    const item = await call<ItemWithListings>(`/api/items/${imported.data.results[0]!.itemId}`, { token });
    expect(item.data.listings[0]!.listedAt).toBeGreaterThan(0);
    expect((await call<Stats>("/api/stats", { token })).data.stale).toBe(0);

    const me = await call<{ settings: Record<string, unknown> }>("/api/me/settings", { token, method: "PATCH", json: { vintedRelistDays: 7, ebayRelistDays: 90 } });
    expect(me.data.settings).toMatchObject({ vintedRelistDays: 7, ebayRelistDays: 90 });
    expect((await call("/api/me/settings", { token, method: "PATCH", json: { vintedRelistDays: 0 } })).status).toBe(400);
  });
});

describe("price checks", () => {
  afterEach(() => vi.restoreAllMocks());

  it("works out a price from the comps, keeps it, and re-assesses when the item changes", async () => {
    // AI is set up in tests but Gemini refuses: the check is still saved, priced by the rules alone.
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (!new Request(input, init).url.includes("generativelanguage.googleapis.com")) return realFetch(input, init);
      return Response.json({ error: { code: 400, message: "API key not valid", status: "INVALID_ARGUMENT" } }, { status: 400 });
    });
    const { token } = await signUp();
    const { data: item } = await call<ItemWithListings>("/api/items", { token, json: { title: "The Hobbit Tolkien 1951 hardback", condition: "good" } });
    expect((await call(`/api/items/${item.id}/price-check`, { token })).status).toBe(404);

    const day = 86_400_000;
    const sold = (title: string, pounds: number, i: number) => ({
      source: "ebay_sold", title, price: pounds * 100, url: `https://www.ebay.co.uk/itm/${100000000 + i}`, soldAt: Date.now() - i * day,
    });
    const comps = [
      ...[80, 85, 90, 95, 100].map((p, i) => sold("The Hobbit Tolkien 1951 hardback Allen Unwin", p, i)),
      ...[9000, 11000, 12000].map((p, i) => sold("The Hobbit Tolkien 1937 first edition hardback", p, 10 + i)),
      sold("Job lot 20 Tolkien books", 50, 20),
    ];
    const saved = await call<PriceCheck>(`/api/items/${item.id}/price-check`, {
      token,
      json: { queries: ["hobbit 1951 tolkien"], comps, problems: ["Listed on Vinted, “hobbit”: Couldn't read the search results"] },
    });
    expect(saved.status).toBe(201);
    expect(saved.data.ai).toMatchObject({ status: "failed", error: expect.stringMatching(/Gemini rejected/) });
    expect(saved.data.summary.aiChanged).toBe(0);
    expect(saved.data.summary.suggestions[0]).toMatchObject({ marketplace: "ebay", basis: "sold", count: 5 });
    expect(saved.data.summary.suggestions[0]!.price).toBe(9000);
    expect(saved.data.summary.assessments.map((a) => a.verdict)).toEqual([
      "match", "match", "match", "match", "match", "dropped", "dropped", "dropped", "dropped",
    ]);

    // The seller finds it's a first edition: same comps, now priced from the first editions only.
    await call(`/api/items/${item.id}`, { token, method: "PATCH", json: { book: { edition: "First edition", format: "hardback" } } });
    const again = await call<PriceCheck>(`/api/items/${item.id}/price-check`, { token });
    expect(again.data.id).toBe(saved.data.id);
    expect(again.data.problems).toHaveLength(1);
    expect(again.data.summary.features.map((f) => f.key)).toEqual(["first_edition", "hardback"]);
    expect(again.data.summary.suggestions[0]!.count).toBe(3);
    expect(again.data.summary.suggestions[0]!.price).toBeGreaterThan(1_000_000);

    const bad = await call(`/api/items/${item.id}/price-check`, { token, json: { queries: [], comps: [{ source: "etsy", title: "x", price: 1, url: "https://x.test" }] } });
    expect(bad.status).toBe(400);
    expect((await call(`/api/items/nope/price-check`, { token, json: { queries: [], comps: [] } })).status).toBe(404);
  });
});
