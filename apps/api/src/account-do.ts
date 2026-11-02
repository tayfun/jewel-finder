import * as Sentry from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";
import {
  ITEM_STATUSES,
  MARKETPLACES,
  Settings,
  type Account,
  type Item,
  type ItemData,
  type ItemPatch,
  type ItemStatus,
  type ItemWithListings,
  type Listing,
  type ListingInput,
  type Marketplace,
  type Stats,
} from "@jf/shared";
import { sentryOptions } from "./sentry";

/** Each entry runs once, in order. Never edit a shipped migration; append a new one. */
const MIGRATIONS = [
  `CREATE TABLE account (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     settings TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE TABLE items (
     id TEXT PRIMARY KEY,
     sku TEXT NOT NULL,
     title TEXT NOT NULL,
     description TEXT NOT NULL,
     brand TEXT NOT NULL,
     category TEXT NOT NULL,
     size TEXT NOT NULL,
     colour TEXT NOT NULL,
     condition TEXT,
     price INTEGER,
     cost INTEGER,
     quantity INTEGER NOT NULL,
     status TEXT NOT NULL,
     images TEXT NOT NULL,
     tags TEXT NOT NULL,
     notes TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE INDEX items_updated ON items(updated_at DESC);
   CREATE TABLE listings (
     id TEXT PRIMARY KEY,
     item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
     marketplace TEXT NOT NULL,
     status TEXT NOT NULL,
     external_id TEXT,
     url TEXT,
     price INTEGER,
     error TEXT,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE (item_id, marketplace)
   );
   CREATE TABLE counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);`,
  // v2: bibliographic details (JSON BookDetails) for book items.
  `ALTER TABLE items ADD COLUMN book TEXT;`,
  // v3: postage size and packed weight.
  `ALTER TABLE items ADD COLUMN package_size TEXT;
   ALTER TABLE items ADD COLUMN weight_grams INTEGER;`,
];

type Row = Record<string, SqlStorageValue>;

function toItem(r: Row): Item {
  return {
    id: r.id as string,
    sku: r.sku as string,
    title: r.title as string,
    description: r.description as string,
    brand: r.brand as string,
    category: r.category as string,
    size: r.size as string,
    colour: r.colour as string,
    condition: (r.condition as Item["condition"]) ?? null,
    price: (r.price as number | null) ?? null,
    cost: (r.cost as number | null) ?? null,
    quantity: r.quantity as number,
    status: r.status as ItemStatus,
    images: JSON.parse(r.images as string),
    tags: JSON.parse(r.tags as string),
    notes: r.notes as string,
    book: r.book ? JSON.parse(r.book as string) : null,
    packageSize: (r.package_size as Item["packageSize"]) ?? null,
    weightGrams: (r.weight_grams as number | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

function toListing(r: Row): Listing {
  return {
    id: r.id as string,
    itemId: r.item_id as string,
    marketplace: r.marketplace as Marketplace,
    status: r.status as Listing["status"],
    externalId: (r.external_id as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    price: (r.price as number | null) ?? null,
    error: (r.error as string | null) ?? null,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  };
}

export type RegisterResult = { ok: true; account: Account } | { ok: false; error: "exists" };

/**
 * One instance per user, addressed by idFromName(email). Holds the account,
 * the inventory and marketplace listing state in SQLite.
 */
class AccountDOBase extends DurableObject<Env> {
  private sql: SqlStorage;
  private migrated = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
  }

  /**
   * Schema is created lazily so that login attempts for unknown emails
   * don't leave empty databases behind.
   */
  private db(): SqlStorage {
    if (this.migrated) return this.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER NOT NULL)");
    const done = this.sql.exec<{ v: number | null }>("SELECT MAX(version) AS v FROM _migrations").one().v ?? 0;
    for (let v = done; v < MIGRATIONS.length; v++) {
      this.ctx.storage.transactionSync(() => {
        this.sql.exec(MIGRATIONS[v]!);
        this.sql.exec("INSERT INTO _migrations (version) VALUES (?)", v + 1);
      });
    }
    this.migrated = true;
    return this.sql;
  }

  private hasSchema(): boolean {
    return (
      this.migrated ||
      this.sql.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'account'").toArray().length > 0
    );
  }

  // ---------------------------------------------------------------- account

  async register(email: string, passwordHash: string): Promise<RegisterResult> {
    const db = this.db();
    if (db.exec("SELECT 1 FROM account").toArray().length) return { ok: false, error: "exists" };
    const settings = Settings.parse({});
    db.exec(
      "INSERT INTO account (id, email, password_hash, settings, created_at) VALUES (?, ?, ?, ?, ?)",
      this.ctx.id.toString(),
      email,
      passwordHash,
      JSON.stringify(settings),
      Date.now(),
    );
    return { ok: true, account: this.getAccount()! };
  }

  async getCredentials(): Promise<{ account: Account; passwordHash: string } | null> {
    if (!this.hasSchema()) return null;
    const row = this.db().exec("SELECT password_hash FROM account").toArray()[0];
    const account = this.getAccount();
    return row && account ? { account, passwordHash: row.password_hash as string } : null;
  }

  getAccount(): Account | null {
    if (!this.hasSchema()) return null;
    const r = this.db().exec("SELECT * FROM account").toArray()[0];
    if (!r) return null;
    return {
      id: r.id as string,
      email: r.email as string,
      settings: Settings.parse(JSON.parse(r.settings as string)),
      createdAt: r.created_at as number,
    };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Account | null> {
    const account = this.getAccount();
    if (!account) return null;
    const settings = Settings.parse({ ...account.settings, ...patch });
    this.db().exec("UPDATE account SET settings = ?", JSON.stringify(settings));
    return this.getAccount();
  }

  // ------------------------------------------------------------------ items

  async listItems(filter: { q?: string; status?: ItemStatus } = {}): Promise<ItemWithListings[]> {
    const where: string[] = [];
    const args: SqlStorageValue[] = [];
    if (filter.status) {
      where.push("status = ?");
      args.push(filter.status);
    }
    if (filter.q) {
      const like = `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      const cols = ["title", "brand", "sku", "tags", "description"];
      where.push(`(${cols.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(" OR ")})`);
      args.push(...cols.map(() => like));
    }
    const sql = `SELECT * FROM items ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY updated_at DESC LIMIT 1000`;
    const items = this.db().exec(sql, ...args).toArray().map(toItem);
    const byItem = new Map<string, Listing[]>();
    for (const l of this.db().exec("SELECT * FROM listings").toArray().map(toListing)) {
      byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
    }
    return items.map((i) => ({ ...i, listings: byItem.get(i.id) ?? [] }));
  }

  async getItem(id: string): Promise<ItemWithListings | null> {
    const r = this.db().exec("SELECT * FROM items WHERE id = ?", id).toArray()[0];
    if (!r) return null;
    const listings = this.db().exec("SELECT * FROM listings WHERE item_id = ? ORDER BY marketplace", id).toArray();
    return { ...toItem(r), listings: listings.map(toListing) };
  }

  private nextSku(): string {
    const db = this.db();
    db.exec(
      "INSERT INTO counters (name, value) VALUES ('sku', 1) ON CONFLICT(name) DO UPDATE SET value = value + 1",
    );
    const n = db.exec<{ value: number }>("SELECT value FROM counters WHERE name = 'sku'").one().value;
    return `JF-${String(n).padStart(4, "0")}`;
  }

  async createItem(input: ItemData): Promise<ItemWithListings> {
    const id = crypto.randomUUID();
    const now = Date.now();
    this.db().exec(
      `INSERT INTO items (id, sku, title, description, brand, category, size, colour, condition, price, cost,
         quantity, status, images, tags, notes, book, package_size, weight_grams, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.sku || this.nextSku(),
      input.title,
      input.description,
      input.brand,
      input.category,
      input.size,
      input.colour,
      input.condition,
      input.price,
      input.cost,
      input.quantity,
      input.status,
      JSON.stringify(input.images),
      JSON.stringify(input.tags),
      input.notes,
      input.book ? JSON.stringify(input.book) : null,
      input.packageSize,
      input.weightGrams,
      now,
      now,
    );
    return (await this.getItem(id))!;
  }

  /** Returns the updated item plus image keys that are no longer referenced. */
  async updateItem(
    id: string,
    patch: ItemPatch,
  ): Promise<{ item: ItemWithListings; removedImages: string[] } | null> {
    const current = await this.getItem(id);
    if (!current) return null;
    const next = { ...current, ...patch };
    this.db().exec(
      `UPDATE items SET sku = ?, title = ?, description = ?, brand = ?, category = ?, size = ?, colour = ?,
         condition = ?, price = ?, cost = ?, quantity = ?, status = ?, images = ?, tags = ?, notes = ?,
         book = ?, package_size = ?, weight_grams = ?, updated_at = ?
       WHERE id = ?`,
      next.sku || current.sku,
      next.title,
      next.description,
      next.brand,
      next.category,
      next.size,
      next.colour,
      next.condition,
      next.price,
      next.cost,
      next.quantity,
      next.status,
      JSON.stringify(next.images),
      JSON.stringify(next.tags),
      next.notes,
      next.book ? JSON.stringify(next.book) : null,
      next.packageSize,
      next.weightGrams,
      Date.now(),
      id,
    );
    const removedImages = current.images.filter((k) => !next.images.includes(k));
    return { item: (await this.getItem(id))!, removedImages };
  }

  /** Returns the deleted item's image keys, or null if it didn't exist. */
  async deleteItem(id: string): Promise<string[] | null> {
    const item = await this.getItem(id);
    if (!item) return null;
    this.ctx.storage.transactionSync(() => {
      this.db().exec("DELETE FROM listings WHERE item_id = ?", id);
      this.db().exec("DELETE FROM items WHERE id = ?", id);
    });
    return item.images;
  }

  /** Marks the item sold; the listing it sold through becomes `sold`, other live ones `ended`. */
  async markSold(id: string, marketplace?: Marketplace): Promise<ItemWithListings | null> {
    const item = await this.getItem(id);
    if (!item) return null;
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      const db = this.db();
      db.exec("UPDATE items SET status = 'sold', quantity = 0, updated_at = ? WHERE id = ?", now, id);
      db.exec(
        "UPDATE listings SET status = 'ended', updated_at = ? WHERE item_id = ? AND status IN ('pending', 'listed')",
        now,
        id,
      );
      if (marketplace) {
        db.exec(
          "UPDATE listings SET status = 'sold', updated_at = ? WHERE item_id = ? AND marketplace = ?",
          now,
          id,
          marketplace,
        );
      }
    });
    return this.getItem(id);
  }

  // --------------------------------------------------------------- listings

  async upsertListing(itemId: string, marketplace: Marketplace, input: ListingInput): Promise<Listing | null> {
    if (!(await this.getItem(itemId))) return null;
    const now = Date.now();
    const db = this.db();
    db.exec(
      `INSERT INTO listings (id, item_id, marketplace, status, external_id, url, price, error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (item_id, marketplace) DO UPDATE SET
         status = excluded.status,
         external_id = COALESCE(excluded.external_id, listings.external_id),
         url = COALESCE(excluded.url, listings.url),
         price = COALESCE(excluded.price, listings.price),
         error = excluded.error,
         updated_at = excluded.updated_at`,
      crypto.randomUUID(),
      itemId,
      marketplace,
      input.status,
      input.externalId ?? null,
      input.url ?? null,
      input.price ?? null,
      input.error ?? null,
      now,
      now,
    );
    db.exec("UPDATE items SET updated_at = ? WHERE id = ?", now, itemId);
    const row = db
      .exec("SELECT * FROM listings WHERE item_id = ? AND marketplace = ?", itemId, marketplace)
      .one();
    return toListing(row);
  }

  async deleteListing(itemId: string, marketplace: Marketplace): Promise<boolean> {
    const cursor = this.db().exec(
      "DELETE FROM listings WHERE item_id = ? AND marketplace = ?",
      itemId,
      marketplace,
    );
    return cursor.rowsWritten > 0;
  }

  async stats(): Promise<Stats> {
    const db = this.db();
    const byStatus = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as Stats["byStatus"];
    for (const r of db.exec<{ status: ItemStatus; n: number }>(
      "SELECT status, COUNT(*) AS n FROM items GROUP BY status",
    )) {
      byStatus[r.status] = r.n;
    }
    const listed = Object.fromEntries(MARKETPLACES.map((m) => [m, 0])) as Stats["listed"];
    for (const r of db.exec<{ marketplace: Marketplace; n: number }>(
      "SELECT marketplace, COUNT(*) AS n FROM listings WHERE status = 'listed' GROUP BY marketplace",
    )) {
      listed[r.marketplace] = r.n;
    }
    const value = db
      .exec<{ v: number | null; c: number | null }>(
        "SELECT SUM(COALESCE(price, 0) * quantity) AS v, SUM(COALESCE(cost, 0) * quantity) AS c FROM items WHERE status = 'in_stock'",
      )
      .one();
    return { byStatus, listed, stockValue: value.v ?? 0, stockCost: value.c ?? 0 };
  }
}

/** Errors and RPC spans from the Durable Object go to Sentry too. */
export const AccountDO = Sentry.instrumentDurableObjectWithSentry(sentryOptions, AccountDOBase);
export type AccountDO = AccountDOBase;
