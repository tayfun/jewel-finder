import type { Account, Comp, CompSource, Condition, ImportState, ItemStatus, ItemWithListings, Marketplace, PriceCheck, Settings } from "@jf/shared";

export interface Job {
  /**
   * "list" fills in a new listing; "delist" ends a live one. "relist" fills in a new listing to replace
   * a live one (a bump), then becomes "cleanup", which ends the old one. Missing (older builds) = "list".
   */
  kind?: "list" | "delist" | "relist" | "cleanup" | "comps";
  /** comps: which search this background tab shows. */
  source?: CompSource;
  /** relist / cleanup: the listing being replaced. */
  target?: { externalId: string | null; url: string | null };
  itemId: string;
  marketplace: Marketplace;
  startedAt: number;
}

export interface JobContext {
  job: Job;
  item: ItemWithListings;
  settings: Settings;
}

export interface ImageFile {
  name: string;
  type: string;
  dataUrl: string;
}

/** What a content script managed to fill in, shown in the on-page banner. */
export interface FillReport {
  filled: string[];
  /** Fields the user still needs to set by hand, with the value to use. */
  manual: { field: string; value: string }[];
  warnings: string[];
}

/** Import mode in one marketplace tab: the page shows a picker for the seller's listings. */
export interface ImportJob {
  marketplace: Marketplace;
  startedAt: number;
}

/** What a content script read from one of the seller's listing pages. */
export interface ScrapedListing {
  externalId: string;
  url: string;
  state: ImportState;
  title: string;
  description: string;
  /** Minor units. */
  price: number | null;
  brand: string;
  size: string;
  colour: string;
  condition: Condition | null;
  category: string;
  /** Photo URLs on the marketplace's image CDN, largest available size. */
  photos: string[];
}

/** Sent by the background to a tab's content script (chrome.tabs.sendMessage). */
export type TabMessage =
  | { type: "IMPORT_ACTIVATE" }
  /** Which marketplace this tab's content script is for (answers with a Marketplace). */
  | { type: "WHICH_MARKETPLACE" };

/** Messages handled by the background service worker. */
export type Request =
  | { type: "AUTH_STATE" }
  | { type: "AUTH_LOGIN"; email: string; password: string }
  | { type: "AUTH_LOGOUT" }
  | { type: "LIST_ITEMS"; q?: string; status?: ItemStatus }
  | { type: "START_LISTING"; itemId: string; marketplace: Marketplace; token?: string }
  | { type: "START_DELISTING"; itemId: string; marketplace: Marketplace; token?: string }
  | { type: "START_RELISTING"; itemId: string; marketplace: Marketplace; token?: string }
  | { type: "GET_JOB" }
  | { type: "GET_IMAGES" }
  | { type: "JOB_PUBLISHED"; url: string; externalId: string }
  | { type: "JOB_DELISTED" }
  | { type: "JOB_CANCEL" }
  /** Open the seller's listings in import mode (new tab), or switch `tabId` into import mode. */
  | { type: "START_IMPORT"; marketplace: Marketplace; tabId?: number; token?: string }
  | { type: "GET_IMPORT" }
  | { type: "IMPORT_STOP" }
  /** External ids on this marketplace that are already in the inventory → their item ids. */
  | { type: "IMPORT_KNOWN"; marketplace: Marketplace }
  /** Download the photos, upload them and create the item. */
  | { type: "IMPORT_LISTING"; marketplace: Marketplace; listing: ScrapedListing }
  /** Search for comparables and save a price check for the item. */
  | { type: "START_PRICE_CHECK"; itemId: string; token?: string }
  /** Set the item's price (minor units), e.g. to a price check's suggestion. */
  | { type: "SET_PRICE"; itemId: string; price: number }
  /** From a comps tab: what its search results page showed. */
  | { type: "COMPS_FOUND"; comps: Comp[]; problem?: string }
  /** eBay serves descriptions from another origin, which the page itself can't read. */
  | { type: "FETCH_DESCRIPTION"; url: string };

export interface Responses {
  AUTH_STATE: { account: Account | null };
  AUTH_LOGIN: { account: Account };
  AUTH_LOGOUT: null;
  LIST_ITEMS: { items: ItemWithListings[] };
  START_LISTING: { tabId: number };
  START_DELISTING: { tabId: number };
  START_RELISTING: { tabId: number };
  GET_JOB: JobContext | null;
  GET_IMAGES: ImageFile[];
  /** next: a relist's old listing, which the tab opens next to end it. */
  JOB_PUBLISHED: { next: string | null };
  JOB_DELISTED: null;
  JOB_CANCEL: null;
  START_IMPORT: { tabId: number };
  GET_IMPORT: { job: ImportJob; settings: Settings } | null;
  IMPORT_STOP: null;
  IMPORT_KNOWN: Record<string, string>;
  /** possibleDuplicate: the new item looks like one already in the inventory. */
  IMPORT_LISTING: { itemId: string; created: boolean; photos: number; possibleDuplicate: boolean };
  FETCH_DESCRIPTION: string;
  START_PRICE_CHECK: { checkId: string; check: PriceCheck };
  SET_PRICE: ItemWithListings;
  COMPS_FOUND: null;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Typed wrapper over chrome.runtime.sendMessage; rejects with the background's error. */
export async function send<R extends Request>(req: R): Promise<Responses[R["type"]]> {
  const reply = (await chrome.runtime.sendMessage(req)) as Reply<Responses[R["type"]]> | undefined;
  if (!reply) throw new Error("No response from the extension background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
