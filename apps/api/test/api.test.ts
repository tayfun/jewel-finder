import type { AuthResponse, ItemWithListings, Stats } from "@jf/shared";
import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

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
