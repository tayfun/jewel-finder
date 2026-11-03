import * as Sentry from "@sentry/cloudflare";
import { DurableObject } from "cloudflare:workers";
import { ITEM_STATUSES, MARKETPLACES, type AccountSummary, type AdminOverview, type AdminUser } from "@jf/shared";
import { sentryOptions } from "./sentry";

const DAY = 24 * 60 * 60 * 1000;

/** Each entry runs once, in order. Never edit a shipped migration; append a new one. */
const MIGRATIONS = [
  `CREATE TABLE users (
     id TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     last_seen_at INTEGER NOT NULL,
     is_admin INTEGER NOT NULL DEFAULT 0,
     by_status TEXT NOT NULL,
     listed TEXT NOT NULL
   );`,
];

type Row = Record<string, SqlStorageValue>;

/**
 * The one place that knows about every account: a row per user with their item/listing counts,
 * which each AccountDO reports after changes. Feeds the admin dashboard and holds the admin flag.
 * Single instance, addressed by DIRECTORY.getByName("directory").
 */
class DirectoryDOBase extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec("CREATE TABLE IF NOT EXISTS _migrations (version INTEGER NOT NULL)");
      const done = this.sql.exec<{ v: number | null }>("SELECT MAX(version) AS v FROM _migrations").one().v ?? 0;
      for (let v = done; v < MIGRATIONS.length; v++) {
        ctx.storage.transactionSync(() => {
          this.sql.exec(MIGRATIONS[v]!);
          this.sql.exec("INSERT INTO _migrations (version) VALUES (?)", v + 1);
        });
      }
    });
  }

  /** Records an account's latest counts; `seen` also bumps its last-seen time. */
  async report(summary: AccountSummary, seen = true): Promise<void> {
    const now = Date.now();
    this.sql.exec(
      `INSERT INTO users (id, email, created_at, last_seen_at, by_status, listed) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET email = excluded.email, by_status = excluded.by_status, listed = excluded.listed,
         last_seen_at = CASE WHEN ? THEN excluded.last_seen_at ELSE users.last_seen_at END`,
      summary.id,
      summary.email,
      summary.createdAt,
      // A backfilled account we've never seen: its signup is the best guess at its last activity.
      seen ? now : summary.createdAt,
      JSON.stringify(summary.byStatus),
      JSON.stringify(summary.listed),
      seen ? 1 : 0,
    );
  }

  async isAdmin(id: string): Promise<boolean> {
    return this.sql.exec("SELECT 1 FROM users WHERE id = ? AND is_admin = 1", id).toArray().length > 0;
  }

  /** False when the account isn't in the directory. */
  async setAdmin(id: string, isAdmin: boolean): Promise<boolean> {
    return this.sql.exec("UPDATE users SET is_admin = ? WHERE id = ?", isAdmin ? 1 : 0, id).rowsWritten > 0;
  }

  /** `owners`: emails from ADMIN_EMAILS, which are admins whatever the flag says. */
  async overview(owners: string[]): Promise<AdminOverview> {
    const now = Date.now();
    const users: AdminUser[] = this.sql
      .exec("SELECT * FROM users ORDER BY created_at DESC")
      .toArray()
      .map((r: Row) => ({
        id: r.id as string,
        email: r.email as string,
        createdAt: r.created_at as number,
        lastSeenAt: r.last_seen_at as number,
        isAdmin: r.is_admin === 1,
        isOwner: owners.includes(r.email as string),
        byStatus: JSON.parse(r.by_status as string),
        listed: JSON.parse(r.listed as string),
      }));
    const byStatus = Object.fromEntries(ITEM_STATUSES.map((s) => [s, 0])) as AdminOverview["totals"]["byStatus"];
    const listed = Object.fromEntries(MARKETPLACES.map((m) => [m, 0])) as AdminOverview["totals"]["listed"];
    for (const u of users) {
      for (const s of ITEM_STATUSES) byStatus[s] += u.byStatus[s] ?? 0;
      for (const m of MARKETPLACES) listed[m] += u.listed[m] ?? 0;
    }
    const since = (days: number) => now - days * DAY;
    return {
      totals: {
        users: users.length,
        admins: users.filter((u) => u.isAdmin || u.isOwner).length,
        signups7d: users.filter((u) => u.createdAt >= since(7)).length,
        signups30d: users.filter((u) => u.createdAt >= since(30)).length,
        active7d: users.filter((u) => u.lastSeenAt >= since(7)).length,
        active30d: users.filter((u) => u.lastSeenAt >= since(30)).length,
        items: Object.values(byStatus).reduce((a, b) => a + b, 0),
        byStatus,
        listed,
      },
      users,
    };
  }
}

export const DirectoryDO = Sentry.instrumentDurableObjectWithSentry(sentryOptions, DirectoryDOBase);
export type DirectoryDO = DirectoryDOBase;
