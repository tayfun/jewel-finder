import { MARKETPLACE_LABELS, priceToMinor } from "@jf/shared";
import { API_URL } from "../config";
import { send, type ScrapedListing, type TabMessage } from "../messages";
import { sleep } from "./dom";
import type { Adapter, ImportIO } from "./runner";
import { findListingCards, type ListingCard } from "./scrape";
import { NetworkError, fetchRetry } from "./net";
import { extensionAlive } from "./alive";

// Import mode: a panel on the seller's listings page (Vinted wardrobe, eBay Seller Hub…) to pick
// listings one by one or all at once. Each pick is read from its own listing page and sent to the
// background, which copies the photos and creates the item.

const backgroundIO: ImportIO = {
  fetchText: (url) => send({ type: "FETCH_DESCRIPTION", url }),
};

/** Fetches a listing page with the seller's session and reads it with the adapter. */
export async function readListing(adapter: Adapter, card: ListingCard, io: ImportIO = backgroundIO): Promise<ScrapedListing> {
  let res: Response;
  try {
    res = await fetchRetry(card.url, { credentials: "include" }, { what: "the listing" });
  } catch (e) {
    throw new Error(e instanceof NetworkError ? e.message : "Couldn't open the listing");
  }
  if (res.status === 404 || res.status === 410) throw new Error("This listing no longer exists");
  if (!res.ok) throw new Error(`Couldn't open the listing (${res.status})`);
  const doc = new DOMParser().parseFromString(await res.text(), "text/html");
  const parsed = await adapter.importer.parse(doc, card.url, io);
  return {
    ...parsed,
    externalId: card.externalId,
    url: card.url,
    // The card is a fallback for anything the listing page didn't give us.
    title: parsed.title || card.title,
    price: parsed.price ?? priceToMinor(card.price),
    photos: parsed.photos.length ? parsed.photos : card.thumb ? [card.thumb] : [],
  };
}

let started = false;

/** Shows the import panel in tabs that are in import mode (set by the web app or side panel). */
export async function runImport(adapter: Adapter): Promise<void> {
  chrome.runtime.onMessage.addListener((msg: TabMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    // Lets the side panel tell which marketplace a tab is on without the "tabs" permission.
    if (msg?.type === "WHICH_MARKETPLACE") {
      sendResponse(adapter.marketplace);
      return false;
    }
    if (msg?.type !== "IMPORT_ACTIVATE") return false;
    sendResponse(true);
    start(adapter);
    return false;
  });
  try {
    const ctx = await send({ type: "GET_IMPORT" });
    if (ctx?.job.marketplace === adapter.marketplace) start(adapter);
  } catch {
    // signed out or API unreachable
  }
}

function start(adapter: Adapter) {
  if (started) return;
  started = true;
  void new ImportPanel(adapter, backgroundIO).init();
}

const CSS = `
  :host { all: initial; }
  .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 360px; max-height: 80vh; display: flex; flex-direction: column;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16191d; background: #fff;
    border: 1px solid #e2e5e9; border-radius: 12px; box-shadow: 0 10px 30px rgb(0 0 0 / 18%); }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0f766e; color: #fff;
    border-radius: 12px 12px 0 0; font-weight: 600; }
  header .t { flex: 1; }
  header button { all: unset; cursor: pointer; padding: 0 4px; font-size: 16px; opacity: .85; }
  .min > :not(header) { display: none; }
  .body { padding: 10px 12px 0; }
  p { margin: 0 0 8px; }
  .muted { color: #69707a; }
  .small { font-size: 12px; }
  .warn { color: #b54708; background: #fef0c7; padding: 6px 8px; border-radius: 8px; }
  .error { color: #b42318; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; border-bottom: 1px solid #e2e5e9; }
  .bar label { display: flex; align-items: center; gap: 6px; cursor: pointer; flex: 1; font-weight: 600; }
  ul { list-style: none; margin: 0; padding: 4px 6px; overflow: auto; flex: 1; min-height: 60px; }
  li { display: grid; grid-template-columns: 18px 40px 1fr; gap: 8px; align-items: center; padding: 5px 6px; border-radius: 8px; cursor: pointer; }
  li:hover { background: #f1f3f5; }
  li.known { cursor: default; opacity: .65; }
  li img, li .noimg { width: 40px; height: 50px; object-fit: cover; border-radius: 6px; background: #f1f3f5; }
  li .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  li .meta { color: #69707a; font-size: 12px; }
  li .tick { color: #067647; font-weight: 600; }
  input[type=checkbox] { margin: 0; width: 16px; height: 16px; accent-color: #0f766e; cursor: pointer; }
  .footer { padding: 10px 12px; border-top: 1px solid #e2e5e9; display: flex; flex-direction: column; gap: 6px; }
  .row { display: flex; gap: 8px; align-items: center; }
  button.primary, a.button { all: unset; box-sizing: border-box; cursor: pointer; text-align: center; padding: 7px 12px; border-radius: 8px;
    background: #0f766e; color: #fff; font-weight: 600; }
  button.primary[disabled] { opacity: .45; cursor: not-allowed; }
  button.plain { all: unset; cursor: pointer; color: #69707a; font-size: 12px; }
  button.plain:hover { color: #b42318; }
  .grow { flex: 1; }
  progress { width: 100%; accent-color: #0f766e; }
  a { color: #0f766e; }
  ul.failed { padding: 0; max-height: 120px; }
  ul.failed li { display: block; padding: 2px 0; cursor: default; }
`;

type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, "");
    else if (v !== false) node.setAttribute(k, v);
  }
  node.append(...kids.filter((k): k is Node | string => k !== null && k !== false));
  return node;
}

interface Run {
  total: number;
  done: number;
  current: string;
  created: number;
  skipped: number;
  withoutPhotos: number;
  /** New items that look like ones already in the inventory. */
  duplicates: number;
  failed: { title: string; error: string }[];
  stopping: boolean;
  finished: boolean;
}

export class ImportPanel {
  private host = h("div", { id: "jewel-finder-import" });
  /** Closed to the page's scripts; kept on the instance for tests. */
  readonly root = this.host.attachShadow({ mode: "closed" });
  private cards: ListingCard[] = [];
  private selected = new Set<string>();
  /** External id → item id, for listings already in the inventory. */
  private known: Record<string, string> = {};
  private error = "";
  private run: Run | null = null;
  private minimised = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private scanned = "";
  private highlighted: { el: HTMLElement; outline: string } | null = null;

  constructor(
    private adapter: Adapter,
    private io: ImportIO,
  ) {}

  private get label() {
    return MARKETPLACE_LABELS[this.adapter.marketplace];
  }

  async init() {
    document.documentElement.append(this.host);
    this.scan(true);
    try {
      this.known = await send({ type: "IMPORT_KNOWN", marketplace: this.adapter.marketplace });
    } catch (e) {
      this.error = (e as Error).message;
    }
    this.render();
    // Pages load more listings as you scroll, and marketplaces navigate client-side.
    this.timer = setInterval(() => {
      if (extensionAlive()) this.scan();
      else clearInterval(this.timer); // left over from an old version of the extension
    }, 1500);
  }

  /** Re-reads the listings on the page; re-renders only when they changed. */
  scan(force = false) {
    this.cards = findListingCards(this.adapter.marketplace, document.body ?? document, this.host);
    const key = location.href + "|" + this.cards.map((c) => c.externalId).join(",");
    if (!force && key === this.scanned) return;
    this.scanned = key;
    if (!this.run || this.run.finished) {
      const onPage = new Set(this.cards.map((c) => c.externalId));
      for (const id of this.selected) if (!onPage.has(id)) this.selected.delete(id);
    }
    this.render();
  }

  private selectable() {
    return this.cards.filter((c) => !this.known[c.externalId]);
  }

  private toggle(id: string, on: boolean) {
    if (on) this.selected.add(id);
    else this.selected.delete(id);
    this.render();
  }

  private highlight(card: ListingCard | null) {
    if (this.highlighted) this.highlighted.el.style.outline = this.highlighted.outline;
    this.highlighted = card ? { el: card.element, outline: card.element.style.outline } : null;
    if (card) card.element.style.outline = "3px solid #0f766e";
  }

  close() {
    clearInterval(this.timer);
    this.highlight(null);
    if (this.run && !this.run.finished) this.run.stopping = true;
    this.host.remove();
    started = false;
    void send({ type: "IMPORT_STOP" }).catch(() => {});
  }

  async importSelected() {
    const queue = this.cards.filter((c) => this.selected.has(c.externalId) && !this.known[c.externalId]);
    if (!queue.length) return;
    const run: Run = { total: queue.length, done: 0, current: "", created: 0, skipped: 0, withoutPhotos: 0, duplicates: 0, failed: [], stopping: false, finished: false };
    this.run = run;
    for (const card of queue) {
      if (run.stopping) break;
      run.current = card.title;
      this.render();
      try {
        const listing = await readListing(this.adapter, card, this.io);
        const result = await send({ type: "IMPORT_LISTING", marketplace: this.adapter.marketplace, listing });
        this.known[card.externalId] = result.itemId;
        this.selected.delete(card.externalId);
        if (!result.created) run.skipped++;
        else {
          run.created++;
          if (listing.photos.length && !result.photos) run.withoutPhotos++;
          if (result.possibleDuplicate) run.duplicates++;
        }
      } catch (e) {
        run.failed.push({ title: card.title, error: (e as Error).message });
      }
      run.done++;
      this.render();
      // Go gently on the marketplace: one listing page at a time.
      if (run.done < run.total) await sleep(600);
    }
    run.finished = true;
    run.current = "";
    this.render();
  }

  render() {
    const list = this.root.querySelector("ul.cards");
    const scrollTop = list?.scrollTop ?? 0;

    const header = h(
      "header",
      {},
      h("span", {}, "💎"),
      h("span", { class: "t" }, `Import from ${this.label}`),
      h("button", { title: "Minimise", onClick: () => ((this.minimised = !this.minimised), this.render()) }, "–"),
      h("button", { title: "Close import", onClick: () => this.close() }, "×"),
    );
    const box = h("div", { class: `box${this.minimised ? " min" : ""}` }, header);
    const url = new URL(location.href);
    const running = this.run && !this.run.finished;

    const intro = h("div", { class: "body" });
    if (this.error) intro.append(h("p", { class: "error" }, this.error));
    if (this.cards.length && !this.adapter.importer.isOwnListings(url, document)) {
      intro.append(h("p", { class: "warn small" }, "This doesn't look like your own listings. Only import listings you're selling."));
    }

    if (!this.cards.length) {
      intro.append(h("p", {}, this.adapter.importer.emptyHint));
      const link = this.adapter.importer.listingsLink(url, document);
      if (link) intro.append(h("p", {}, h("a", { class: "button", href: link.href }, link.label)));
      box.append(intro);
      this.root.replaceChildren(h("style", {}, CSS), box);
      return;
    }

    const knownHere = this.cards.filter((c) => this.known[c.externalId]).length;
    intro.append(
      h(
        "p",
        { class: "muted small" },
        `${this.cards.length} listing${this.cards.length === 1 ? "" : "s"} on this page`,
        knownHere ? ` · ${knownHere} already in Jewel Finder` : "",
        ". Scroll or go to the next page for more; import mode stays on in this tab.",
      ),
    );
    box.append(intro);

    const selectable = this.selectable();
    const allOn = selectable.length > 0 && selectable.every((c) => this.selected.has(c.externalId));
    const all = h("input", {
      type: "checkbox",
      disabled: !selectable.length || !!running,
      onChange: (e) => {
        const on = (e.target as HTMLInputElement).checked;
        for (const c of selectable) {
          if (on) this.selected.add(c.externalId);
          else this.selected.delete(c.externalId);
        }
        this.render();
      },
    });
    (all as HTMLInputElement).checked = allOn;
    (all as HTMLInputElement).indeterminate = !allOn && selectable.some((c) => this.selected.has(c.externalId));
    box.append(
      h(
        "div",
        { class: "bar" },
        h("label", {}, all, `Select all on this page (${selectable.length})`),
        h("span", { class: "muted small" }, `${this.selected.size} selected`),
      ),
    );

    const rows = this.cards.map((card) => {
      const itemId = this.known[card.externalId];
      const box = h("input", {
        type: "checkbox",
        disabled: !!itemId || !!running,
        onClick: (e) => e.stopPropagation(),
        onChange: (e) => this.toggle(card.externalId, (e.target as HTMLInputElement).checked),
      }) as HTMLInputElement;
      box.checked = !itemId && this.selected.has(card.externalId);
      return h(
        "li",
        {
          class: itemId ? "known" : "",
          "data-id": card.externalId,
          onClick: () => {
            if (!itemId && !running) this.toggle(card.externalId, !this.selected.has(card.externalId));
          },
          onMouseEnter: () => this.highlight(card),
          onMouseLeave: () => this.highlight(null),
        },
        box,
        card.thumb ? h("img", { src: card.thumb, alt: "", loading: "lazy" }) : h("div", { class: "noimg" }),
        h(
          "div",
          { style: "min-width: 0" },
          h("div", { class: "title", title: card.title }, card.title),
          h(
            "div",
            { class: "meta" },
            itemId
              ? h("a", { class: "tick", href: `${API_URL}/items/${itemId}`, target: "_blank", onClick: (e) => e.stopPropagation() }, "✓ In Jewel Finder")
              : card.price,
          ),
        ),
      );
    });
    const ul = h("ul", { class: "cards" }, ...rows);
    box.append(ul);

    const footer = h("div", { class: "footer" });
    const run = this.run;
    if (run) {
      if (!run.finished) {
        footer.append(
          h("progress", { max: String(run.total), value: String(run.done) }),
          h("div", { class: "row" }, h("span", { class: "grow small" }, `Importing ${Math.min(run.done + 1, run.total)} of ${run.total}: ${run.current}`)),
          h(
            "div",
            { class: "row" },
            h("span", { class: "grow muted small" }, "Keep this tab open until it's done."),
            h("button", { class: "plain", disabled: run.stopping, onClick: () => ((run.stopping = true), this.render()) }, run.stopping ? "Stopping…" : "Stop"),
          ),
        );
      } else {
        const parts = [`Imported ${run.created}`];
        if (run.skipped) parts.push(`${run.skipped} already in Jewel Finder`);
        if (run.failed.length) parts.push(`${run.failed.length} failed`);
        if (run.done < run.total) parts.push(`${run.total - run.done} not started`);
        footer.append(h("p", {}, h("strong", {}, parts.join(" · "))));
        if (run.withoutPhotos) {
          footer.append(h("p", { class: "warn small" }, `${run.withoutPhotos} came in without photos. Add them on the item page.`));
        }
        if (run.duplicates) {
          footer.append(
            h(
              "p",
              { class: "warn small" },
              `${run.duplicates} look${run.duplicates === 1 ? "s" : ""} like ${run.duplicates === 1 ? "an item" : "items"} you already had (maybe from ${this.adapter.marketplace === "vinted" ? "eBay" : "Vinted"}). `,
              h("a", { href: `${API_URL}/duplicates`, target: "_blank" }, "Review duplicates ↗"),
            ),
          );
        }
        if (run.failed.length) {
          footer.append(h("ul", { class: "failed small" }, ...run.failed.map((f) => h("li", { class: "error" }, `${f.title}: ${f.error}`))));
        }
      }
    }
    if (!running) {
      footer.append(
        h(
          "div",
          { class: "row" },
          h(
            "button",
            { class: "primary grow", disabled: !this.selected.size, onClick: () => void this.importSelected() },
            this.selected.size ? `Import ${this.selected.size} listing${this.selected.size === 1 ? "" : "s"}` : "Pick listings to import",
          ),
          run?.created ? h("a", { href: API_URL, target: "_blank" }, "Inventory ↗") : null,
        ),
      );
    }
    box.append(footer);

    this.root.replaceChildren(h("style", {}, CSS), box);
    ul.scrollTop = scrollTop;
  }
}
