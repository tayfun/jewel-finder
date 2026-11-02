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
