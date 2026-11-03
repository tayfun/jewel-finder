import { MARKETPLACE_LABELS, type Marketplace } from "@jf/shared";
import { send, type FillReport, type JobContext } from "../messages";
import { setCancelHandler, showBanner } from "./banner";
import { dataUrlToFile } from "./dom";

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
  /** Ending a live listing (cross-delisting). */
  delist: Delister;
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

export async function run(adapter: Adapter): Promise<void> {
  let ctx: JobContext | null;
  try {
    ctx = await send({ type: "GET_JOB" });
  } catch {
    return; // signed out or API unreachable; nothing to do on this page
  }
  if (!ctx || ctx.job.marketplace !== adapter.marketplace) return;
  if (ctx.job.kind === "delist") return runDelist(adapter, ctx);
  const job = ctx;
  const title = `${MARKETPLACE_LABELS[adapter.marketplace]}: ${job.item.title}`;
  let finished = false;
  let handledHref = "";

  setCancelHandler(() => {
    finished = true;
    void send({ type: "JOB_CANCEL" });
  });

  async function handle() {
    if (finished || location.href === handledHref) return;
    handledHref = location.href;
    const url = new URL(location.href);

    if (sessionStorage.getItem(filledKey(job))) {
      const published = adapter.detectPublished(url, document);
      if (published) {
        finished = true;
        try {
          await send({ type: "JOB_PUBLISHED", ...published });
          sessionStorage.removeItem(filledKey(job));
          showBanner({ kind: "done", title, message: "Listed! Saved to your Jewel Finder inventory." });
        } catch (e) {
          showBanner({ kind: "error", title, message: `Listed, but couldn't update Jewel Finder: ${(e as Error).message}` });
        }
        return;
      }
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
    if (finished) clearInterval(timer);
    else void handle();
  }, 700);
}

const delistKey = (ctx: JobContext) => `jewel-finder.delist.${ctx.job.itemId}.${ctx.job.marketplace}`;

/** Cross-delisting: walk the seller through ending the listing, then mark it ended in Jewel Finder. */
async function runDelist(adapter: Adapter, ctx: JobContext): Promise<void> {
  const title = `End on ${MARKETPLACE_LABELS[adapter.marketplace]}: ${ctx.item.title}`;
  let finished = false;
  let busy = false;
  let handledHref = "";

  setCancelHandler(() => {
    finished = true;
    sessionStorage.removeItem(delistKey(ctx));
    void send({ type: "JOB_CANCEL" });
  });

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
          showBanner({ kind: "done", title, message: "Listing ended and marked as ended in Jewel Finder." });
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
    if (finished) clearInterval(timer);
    else void handle();
  }, 700);
}
