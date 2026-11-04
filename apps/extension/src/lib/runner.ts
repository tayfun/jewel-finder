import { MARKETPLACE_LABELS, type Marketplace } from "@jf/shared";
import { send, type FillReport, type JobContext, type ScrapedListing } from "../messages";
import { setCancelHandler, showBanner } from "./banner";
import { runComps } from "./comps";
import { dataUrlToFile } from "./dom";
import { extensionAlive } from "./alive";

export interface Published {
  url: string;
  externalId: string;
}

/** Marketplace-specific knowledge. Everything DOM-related lives in the adapter. */
export interface Adapter {
  marketplace: Marketplace;
  /** The page with the listing form we should fill. */
  isSellPage(url: URL): boolean;
  /** Steps before the form (e.g. eBay's category picker): a hint for the user, or null. */
  hint?(url: URL): string | null;
  fill(ctx: JobContext, photos: File[]): Promise<FillReport>;
  /** Spot a published listing on the current page. Only consulted after we've filled a form in this tab. */
  detectPublished(url: URL, doc: Document): Published | null;
  /**
   * For marketplaces that don't show the new listing after publishing (Vinted): calls back with it when
   * the page publishes one. Only acted on after we've filled a form in this tab.
   */
  watchPublished?(onPublished: (published: Published) => void): void;
  /**
   * Tidies up after publishing, e.g. closes Vinted's "Item listed · List another" promo. Resolves true once
   * done. Also runs on the next page the tab loads, since the marketplace may navigate after publishing.
   */
  afterPublished?(): Promise<boolean>;
  /** Ending a live listing (cross-delisting). */
  delist: Delister;
  /** Bringing the seller's existing listings into the inventory. */
  importer: Importer;
}

export interface ImportIO {
  /** Fetches a URL the page itself can't read (another origin), via the background. */
  fetchText(url: string): Promise<string>;
}

/** Reads the seller's existing listings. The listing cards themselves are found by their links. */
export interface Importer {
  /** A button to the seller's own listings when this page isn't one. */
  listingsLink(url: URL, doc: Document): { href: string; label: string } | null;
  /** Shown when the page has no listings on it. */
  emptyHint: string;
  /** False shows a warning: imports are meant for the seller's own listings. */
  isOwnListings(url: URL, doc: Document): boolean;
  /** Reads one listing page, fetched from the marketplace and parsed (its scripts don't run). */
  parse(doc: Document, url: string, io: ImportIO): Promise<Omit<ScrapedListing, "externalId" | "url">>;
}

/**
 * Takes a listing down as far as it safely can; the seller presses the marketplace's final confirm.
 * `step` runs once per page the tab shows and returns what the seller should do next. `isDone` is
 * only asked after a step has run, and should check the listing is really gone.
 */
export interface Delister {
  step(ctx: JobContext): Promise<string>;
  isDone(ctx: JobContext, url: URL, doc: Document): Promise<boolean>;
}

// sessionStorage is per tab and survives the full-page navigations marketplaces do after submit.
const filledKey = (ctx: JobContext) => `jewel-finder.filled.${ctx.job.itemId}.${ctx.job.marketplace}`;
// A listing reported by watchPublished, kept in case the page navigates away before we've saved it.
const publishedKey = (ctx: JobContext) => `jewel-finder.published.${ctx.job.itemId}.${ctx.job.marketplace}`;

function storedPublished(ctx: JobContext): Published | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(publishedKey(ctx)) ?? "null") as Published | null;
    return p?.url && p.externalId ? p : null;
  } catch {
    return null;
  }
}

// Set when we publish; the tidy-up keeps going on the next page load (the job itself is done by then).
const AFTER_PUBLISHED_KEY = "jewel-finder.after-published";
const AFTER_PUBLISHED_FOR_MS = 60_000;

function afterPublished(adapter: Adapter) {
  if (!adapter.afterPublished) return;
  const since = Number(sessionStorage.getItem(AFTER_PUBLISHED_KEY));
  if (!since || Date.now() - since > AFTER_PUBLISHED_FOR_MS) return;
  void adapter
    .afterPublished()
    .then((done) => {
      if (done || Date.now() - since > AFTER_PUBLISHED_FOR_MS) sessionStorage.removeItem(AFTER_PUBLISHED_KEY);
    })
    .catch(() => {});
}

export async function run(adapter: Adapter): Promise<void> {
  afterPublished(adapter);
  let ctx: JobContext | null;
  try {
    ctx = await send({ type: "GET_JOB" });
  } catch {
    return; // signed out or API unreachable; nothing to do on this page
  }
  if (!ctx || ctx.job.marketplace !== adapter.marketplace) return;
  if (ctx.job.kind === "comps") return ctx.job.source ? runComps(ctx.job.source) : undefined;
  if (ctx.job.kind === "delist" || ctx.job.kind === "cleanup") return runDelist(adapter, ctx);
  const job = ctx;
  const relist = ctx.job.kind === "relist";
  const title = `${relist ? "Relist on " : ""}${MARKETPLACE_LABELS[adapter.marketplace]}: ${job.item.title}`;
  let finished = false;
  let handledHref = "";

  setCancelHandler(
    () => {
      finished = true;
      void send({ type: "JOB_CANCEL" });
    },
    relist ? "Cancel relisting (keeps the old listing)" : "Cancel this listing",
  );

  async function publish(published: Published) {
    if (finished) return;
    finished = true;
    sessionStorage.setItem(AFTER_PUBLISHED_KEY, String(Date.now()));
    afterPublished(adapter);
    try {
      const { next } = await send({ type: "JOB_PUBLISHED", ...published });
      sessionStorage.removeItem(filledKey(job));
      sessionStorage.removeItem(publishedKey(job));
      if (next) {
        showBanner({ kind: "working", title, message: "Relisted! Now opening the old listing to remove it…" });
        setTimeout(() => location.assign(next), 1500);
      } else {
        showBanner({ kind: "done", title, message: "Listed! Saved to your Jewel Finder inventory." });
      }
    } catch (e) {
      showBanner({ kind: "error", title, message: `Listed, but couldn't update Jewel Finder: ${(e as Error).message}` });
    }
  }

  adapter.watchPublished?.((published) => {
    if (!sessionStorage.getItem(filledKey(job))) return;
    sessionStorage.setItem(publishedKey(job), JSON.stringify(published));
    void publish(published);
  });

  async function handle() {
    if (finished || location.href === handledHref) return;
    handledHref = location.href;
    const url = new URL(location.href);

    if (sessionStorage.getItem(filledKey(job))) {
      const published = storedPublished(job) ?? adapter.detectPublished(url, document);
      if (published) return publish(published);
    }

    if (adapter.isSellPage(url)) {
      showBanner({ kind: "working", title, message: "Filling in the listing form…" });
      try {
        const photos = (await send({ type: "GET_IMAGES" })).map(dataUrlToFile);
        const report = await adapter.fill(job, photos);
        sessionStorage.setItem(filledKey(job), "1");
        showBanner({ kind: "filled", title, report });
      } catch (e) {
        showBanner({ kind: "error", title, message: (e as Error).message });
      }
      return;
    }

    const hint = adapter.hint?.(url);
    if (hint) showBanner({ kind: "hint", title, message: hint });
  }

  void handle();
  // Marketplaces are SPAs: watch for client-side navigation as well as full loads.
  const timer = setInterval(() => {
    if (finished || !extensionAlive()) clearInterval(timer); // done, or left over from an old version
    else void handle();
  }, 700);
}

const delistKey = (ctx: JobContext) => `jewel-finder.delist.${ctx.job.itemId}.${ctx.job.marketplace}`;

/** Cross-delisting: walk the seller through ending the listing, then mark it ended in Jewel Finder. */
async function runDelist(adapter: Adapter, ctx: JobContext): Promise<void> {
  const cleanup = ctx.job.kind === "cleanup";
  const site = MARKETPLACE_LABELS[adapter.marketplace];
  const title = cleanup ? `Remove old ${site} listing: ${ctx.item.title}` : `End on ${site}: ${ctx.item.title}`;
  let finished = false;
  let busy = false;
  let handledHref = "";

  setCancelHandler(
    () => {
      finished = true;
      sessionStorage.removeItem(delistKey(ctx));
      void send({ type: "JOB_CANCEL" });
    },
    cleanup ? "Leave the old listing up" : "Don't end it now",
  );

  async function handle() {
    if (finished || busy || location.href === handledHref) return;
    handledHref = location.href;
    busy = true;
    try {
      if (sessionStorage.getItem(delistKey(ctx)) && (await adapter.delist.isDone(ctx, new URL(location.href), document))) {
        finished = true;
        sessionStorage.removeItem(delistKey(ctx));
        try {
          await send({ type: "JOB_DELISTED" });
          showBanner({
            kind: "done",
            title,
            message: cleanup
              ? "Relisted: the old listing is gone, and Jewel Finder has the new one."
              : "Listing ended and marked as ended in Jewel Finder.",
          });
        } catch (e) {
          showBanner({ kind: "error", title, message: `Ended, but couldn't update Jewel Finder: ${(e as Error).message}` });
        }
        return;
      }
      showBanner({ kind: "working", title, message: "Getting the listing ready to end…" });
      const next = await adapter.delist.step(ctx);
      sessionStorage.setItem(delistKey(ctx), "1");
      showBanner({ kind: "hint", title, message: next });
    } catch (e) {
      showBanner({ kind: "error", title, message: (e as Error).message });
    } finally {
      busy = false;
    }
  }

  void handle();
  const timer = setInterval(() => {
    if (finished || !extensionAlive()) clearInterval(timer); // done, or left over from an old version
    else void handle();
  }, 700);
}
