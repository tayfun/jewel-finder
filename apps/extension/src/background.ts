import {
  ITEMS_CHANGED_KEY,
  type ItemsChanged,
  COMP_SOURCE_LABELS,
  COMP_SOURCE_MARKETPLACE,
  MARKETPLACE_LABELS,
  assessComp,
  compSearchUrl,
  priceBand,
  priceQueries,
  type Comp,
  type CompSource,
  type PriceCheck,
  type Settings,
  imageUrl,
  myListingsUrl,
  sellUrl,
  type Account,
  type AuthResponse,
  type ImportResult,
  type ItemWithListings,
  type Listing,
} from "@jf/shared";
import { API_URL } from "./config";
import { api, getAuth, setAuth, tokenSubject } from "./lib/api";
import { NetworkError, fetchBlob, mapLimit } from "./lib/net";
import { isDescriptionHost, isPhotoHost, toImportListing } from "./lib/import-item";
import type { ImageFile, ImportJob, Job, Reply, Request, Responses, TabMessage } from "./messages";

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

// ------------------------------------------------------------------- jobs
// A job ties a marketplace tab to the item being listed in it. Session storage
// survives service-worker restarts but not browser restarts, which is what we want.

async function getJobs(): Promise<Record<string, Job>> {
  const { jobs } = await chrome.storage.session.get("jobs");
  return (jobs as Record<string, Job> | undefined) ?? {};
}

async function setJob(tabId: number, job: Job | null) {
  const jobs = await getJobs();
  if (job) jobs[tabId] = job;
  else delete jobs[tabId];
  await chrome.storage.session.set({ jobs });
}

// Import mode is kept per tab apart from listing jobs: it has no item, and it outlives page navigation
// so the seller can page through their listings.
async function getImports(): Promise<Record<string, ImportJob>> {
  const { imports } = await chrome.storage.session.get("imports");
  return (imports as Record<string, ImportJob> | undefined) ?? {};
}

async function setImport(tabId: number, job: ImportJob | null) {
  const imports = await getImports();
  if (job) imports[tabId] = job;
  else delete imports[tabId];
  await chrome.storage.session.set({ imports });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  void setJob(tabId, null).then(() => setImport(tabId, null));
});

function tabOf(sender: chrome.runtime.MessageSender): number {
  const id = sender.tab?.id;
  if (id == null) throw new Error("This message must come from a tab");
  return id;
}

async function jobFor(sender: chrome.runtime.MessageSender): Promise<Job | null> {
  return (await getJobs())[tabOf(sender)] ?? null;
}

/** Tells open Stock & List pages to reload (the bridge content script watches this key). */
async function itemsChanged(itemId: string) {
  await chrome.storage.local.set({ [ITEMS_CHANGED_KEY]: { itemId, at: Date.now() } satisfies ItemsChanged });
}

/** Use the web app's session when launched from it and we're signed out or signed in as someone else. */
async function adoptToken(token: string) {
  const current = await getAuth();
  if (current && tokenSubject(current.token) === tokenSubject(token)) return;
  const account = await api<Account>("/api/me", { token });
  await setAuth({ token, account });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** Downloads a listing photo from the marketplace's CDN and stores it in Stock & List. */
async function copyPhoto(url: string): Promise<string> {
  if (!isPhotoHost(url)) throw new Error(`Not a marketplace photo: ${url}`);
  const blob = await fetchBlob(url, {}, { what: "the marketplace's photo server" });
  // Some CDNs send a generic type; the file extension tells us what it is.
  const ext = new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]?.toLowerCase();
  const fromExt = ext ? `image/${ext === "jpg" ? "jpeg" : ext}` : "";
  const type = PHOTO_TYPES.includes(blob.type.split(";")[0]!.trim()) ? blob.type.split(";")[0]!.trim() : fromExt;
  if (!PHOTO_TYPES.includes(type) || blob.size === 0 || blob.size > MAX_PHOTO_BYTES) throw new Error(`Unsupported photo (${type || "unknown type"})`);
  // Repeating the upload is harmless (at worst an unused copy), so it may retry on a slow connection.
  const { key } = await api<{ key: string }>("/api/images", { body: new Blob([blob], { type }), retry: true });
  return key;
}

// ------------------------------------------------------------ price checks

/** Comps tabs waiting for their results, by tab id. */
const compWaiters = new Map<number, (r: { comps: Comp[]; problem?: string }) => void>();
const COMPS_TIMEOUT_MS = 30_000;
/** Enough usable comps from one source to stop searching it. */
const ENOUGH = 8;

/** Opens one search in a background tab, waits for its content script to read it, closes it. */
async function searchComps(source: CompSource, query: string, settings: Settings, itemId: string, band: ReturnType<typeof priceBand>) {
  // Record the job before the page loads, so its content script finds it.
  const tab = await chrome.tabs.create({ url: "about:blank", active: false });
  const tabId = tab.id;
  if (tabId == null) return { comps: [], problem: "Couldn't open a tab" };
  try {
    const result = new Promise<{ comps: Comp[]; problem?: string }>((resolve) => {
      compWaiters.set(tabId, resolve);
      setTimeout(() => resolve({ comps: [], problem: "The search page didn't load in time." }), COMPS_TIMEOUT_MS);
    });
    await setJob(tabId, { kind: "comps", source, itemId, marketplace: COMP_SOURCE_MARKETPLACE[source], startedAt: Date.now() });
    await chrome.tabs.update(tabId, { url: compSearchUrl(source, query, settings, band) });
    return await result;
  } finally {
    compWaiters.delete(tabId);
    await setJob(tabId, null);
    await chrome.tabs.remove(tabId).catch(() => {});
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------- handlers

type Handler<T extends Request["type"]> = (
  req: Extract<Request, { type: T }>,
  sender: chrome.runtime.MessageSender,
) => Promise<Responses[T]>;

const handlers: { [T in Request["type"]]: Handler<T> } = {
  async AUTH_STATE() {
    const auth = await getAuth();
    if (!auth) return { account: null };
    // Refresh the cached account (settings may have changed in the web app).
    try {
      const account = await api<Account>("/api/me");
      await setAuth({ ...auth, account });
      return { account };
    } catch {
      return { account: (await getAuth())?.account ?? null };
    }
  },

  async AUTH_LOGIN({ email, password }) {
    const res = await api<AuthResponse>("/api/auth/login", { json: { email, password } });
    await setAuth(res);
    return { account: res.account };
  },

  async AUTH_LOGOUT() {
    await setAuth(null);
    return null;
  },

  async LIST_ITEMS({ q, status }) {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    return api(`/api/items?${sp}`);
  },

  async START_LISTING({ itemId, marketplace, token }) {
    if (token) await adoptToken(token);
    const auth = await getAuth();
    if (!auth) throw new Error("Sign in to the Stock & List extension first");
    const item = await api<ItemWithListings>(`/api/items/${itemId}`);
    if (!item.images.length) throw new Error("Add at least one photo before listing");
    const existing = item.listings.find((l) => l.marketplace === marketplace);
    if (existing?.status === "listed") throw new Error(`Already listed on ${marketplace}`);

    await api(`/api/items/${itemId}/listings/${marketplace}`, {
      method: "PUT",
      json: { status: "pending", price: item.price, error: null },
    });
    await itemsChanged(itemId);
    const tab = await chrome.tabs.create({ url: sellUrl(marketplace, auth.account.settings, item.title) });
    if (tab.id == null) throw new Error("Couldn't open a tab");
    await setJob(tab.id, { kind: "list", itemId, marketplace, startedAt: Date.now() });
    return { tabId: tab.id };
  },

  // Cross-delisting: open the live listing so the content script can take it down.
  async START_DELISTING({ itemId, marketplace, token }) {
    if (token) await adoptToken(token);
    if (!(await getAuth())) throw new Error("Sign in to the Stock & List extension first");
    const item = await api<ItemWithListings>(`/api/items/${itemId}`);
    const listing = item.listings.find((l) => l.marketplace === marketplace);
    if (!listing || (listing.status !== "listed" && listing.status !== "ending")) {
      throw new Error(`This item isn't live on ${MARKETPLACE_LABELS[marketplace]}`);
    }
    if (!listing.url) {
      throw new Error(`No ${MARKETPLACE_LABELS[marketplace]} link saved for this listing. End it by hand, then mark it ended.`);
    }
    const tab = await chrome.tabs.create({ url: listing.url });
    if (tab.id == null) throw new Error("Couldn't open a tab");
    await setJob(tab.id, { kind: "delist", itemId, marketplace, startedAt: Date.now() });
    return { tabId: tab.id };
  },

  // Bump: put the item up again as a new listing, then end the old one in the same tab.
  async START_RELISTING({ itemId, marketplace, token }) {
    if (token) await adoptToken(token);
    const auth = await getAuth();
    if (!auth) throw new Error("Sign in to the Stock & List extension first");
    const item = await api<ItemWithListings>(`/api/items/${itemId}`);
    const site = MARKETPLACE_LABELS[marketplace];
    const listing = item.listings.find((l) => l.marketplace === marketplace);
    if (listing?.status !== "listed") throw new Error(`This item isn't live on ${site}, so there's nothing to relist`);
    if (!listing.url) throw new Error(`No ${site} link saved for this listing, so the old one can't be removed. Add the link, or list it again by hand.`);
    if (!item.images.length) throw new Error("Add at least one photo before relisting");
    const tab = await chrome.tabs.create({ url: sellUrl(marketplace, auth.account.settings, item.title) });
    if (tab.id == null) throw new Error("Couldn't open a tab");
    await setJob(tab.id, {
      kind: "relist",
      itemId,
      marketplace,
      startedAt: Date.now(),
      target: { externalId: listing.externalId, url: listing.url },
    });
    return { tabId: tab.id };
  },

  // Comparables for pricing: eBay sold first, then eBay and Vinted listings (PRICING.md §7).
  async START_PRICE_CHECK({ itemId, token }) {
    if (token) await adoptToken(token);
    const auth = await getAuth();
    if (!auth) throw new Error("Sign in to the Stock & List extension first");
    const item = await api<ItemWithListings>(`/api/items/${itemId}`);
    const queries = priceQueries(item);
    if (!queries.length) throw new Error("Give the item a title first");
    const isbn = item.book?.isbn || null;
    // With a price set, search half to ten times it: an empty box shouldn't be priced from boxed items.
    const band = priceBand(item);
    const comps: Comp[] = [];
    const problems: string[] = [];
    const used = new Set<string>();
    let soldUsable = 0;
    for (const source of ["ebay_sold", "ebay_listed", "vinted_listed"] as const) {
      // Plenty of sales: current eBay asking prices add nothing.
      if (source === "ebay_listed" && soldUsable >= ENOUGH) continue;
      let usable = 0;
      for (const query of queries) {
        // An ISBN search on Vinted finds nothing: its sellers rarely type ISBNs.
        if (source === "vinted_listed" && query === isbn) continue;
        used.add(query);
        const result = await searchComps(source, query, auth.account.settings, itemId, band);
        const fresh = result.comps.filter((c) => !comps.some((x) => x.url === c.url)).map((c) => ({ ...c, exact: query === isbn }));
        comps.push(...fresh);
        usable += fresh.filter((c) => assessComp(item, c).verdict !== "dropped").length;
        if (result.problem) {
          problems.push(`${COMP_SOURCE_LABELS[source]}, “${query}”: ${result.problem}`);
          break; // probably a bot check: don't keep knocking
        }
        if (usable >= ENOUGH) break;
        await pause(1200);
      }
      if (source === "ebay_sold") soldUsable = usable;
    }
    const check = await api<PriceCheck>(`/api/items/${itemId}/price-check`, {
      json: { queries: [...used], comps: comps.slice(0, 400), problems },
    });
    return { checkId: check.id, check };
  },

  async SET_PRICE({ itemId, price }) {
    const item = await api<ItemWithListings>(`/api/items/${itemId}`, { method: "PATCH", json: { price } });
    await itemsChanged(itemId);
    return item;
  },

  async COMPS_FOUND({ comps, problem }, sender) {
    compWaiters.get(tabOf(sender))?.({ comps, problem });
    return null;
  },

  async GET_JOB(_req, sender) {
    const job = await jobFor(sender);
    const auth = await getAuth();
    if (!job || !auth) return null;
    const item = await api<ItemWithListings>(`/api/items/${job.itemId}`);
    return { job, item, settings: auth.account.settings };
  },

  // Fetched here rather than in the content script: the page's origin would hit
  // CORS / private-network restrictions when the API is on localhost.
  async GET_IMAGES(_req, sender) {
    const job = await jobFor(sender);
    if (!job) return [];
    const item = await api<ItemWithListings>(`/api/items/${job.itemId}`);
    // A few at a time, each retried on a slow connection; a photo that's gone (404) is skipped.
    const files = await mapLimit(item.images, 3, async (key, i): Promise<ImageFile | null> => {
      let blob: Blob;
      try {
        blob = await fetchBlob(imageUrl(API_URL, key), {}, { what: `Stock & List for photo ${i + 1} of ${item.images.length}` });
      } catch (e) {
        if (e instanceof NetworkError) throw e;
        return null;
      }
      const ext = key.split(".").pop() ?? "jpg";
      return { name: `photo-${i + 1}.${ext}`, type: blob.type, dataUrl: await blobToDataUrl(blob) };
    });
    return files.filter((f): f is ImageFile => f !== null);
  },

  async JOB_PUBLISHED({ url, externalId }, sender) {
    const job = await jobFor(sender);
    if (!job) return { next: null };
    const old = job.kind === "relist" ? job.target : undefined;
    const replacing = Boolean(old?.url && old.externalId !== externalId);
    await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, {
      method: "PUT",
      json: {
        status: "listed",
        url,
        externalId,
        // Cleared once the old one is gone; stays visible if the seller stops halfway.
        error: replacing ? `Previous listing still live: ${old!.url}. Delete it so the item can't sell twice.`.slice(0, 500) : null,
      },
    });
    await itemsChanged(job.itemId);
    if (replacing) {
      await setJob(tabOf(sender), { ...job, kind: "cleanup", startedAt: Date.now() });
      return { next: old!.url };
    }
    await setJob(tabOf(sender), null);
    return { next: null };
  },

  async JOB_DELISTED(_req, sender) {
    const job = await jobFor(sender);
    if (!job) return null;
    if (job.kind === "cleanup") {
      // The old listing of a relist is gone; the new one stays as it is.
      const item = await api<ItemWithListings>(`/api/items/${job.itemId}`);
      const current = item.listings.find((l) => l.marketplace === job.marketplace);
      if (current) {
        await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, { method: "PUT", json: { status: current.status, error: null } });
        await itemsChanged(job.itemId);
      }
      await setJob(tabOf(sender), null);
      return null;
    }
    await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, {
      method: "PUT",
      json: { status: "ended", error: null },
    });
    await itemsChanged(job.itemId);
    await setJob(tabOf(sender), null);
    return null;
  },

  async JOB_CANCEL(_req, sender) {
    const job = await jobFor(sender);
    if (!job) return null;
    await setJob(tabOf(sender), null);
    // Delist: stays flagged for ending. Relist/cleanup: the live listing stays as it is.
    if (job.kind && job.kind !== "list") return null;
    const item = await api<ItemWithListings>(`/api/items/${job.itemId}`);
    if (item.listings.find((l) => l.marketplace === job.marketplace)?.status === "pending") {
      await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, { method: "DELETE" });
      await itemsChanged(job.itemId);
    }
    return null;
  },

  // ---------------------------------------------------------------- imports

  async START_IMPORT({ marketplace, tabId, token }) {
    if (token) await adoptToken(token);
    const auth = await getAuth();
    if (!auth) throw new Error("Sign in to the Stock & List extension first");
    const job: ImportJob = { marketplace, startedAt: Date.now() };
    if (tabId != null) {
      await setImport(tabId, job);
      try {
        await chrome.tabs.sendMessage(tabId, { type: "IMPORT_ACTIVATE" } satisfies TabMessage);
      } catch {
        await chrome.tabs.reload(tabId); // opened before the extension loaded: no content script yet
      }
      return { tabId };
    }
    const tab = await chrome.tabs.create({ url: myListingsUrl(marketplace, auth.account.settings) });
    if (tab.id == null) throw new Error("Couldn't open a tab");
    await setImport(tab.id, job);
    return { tabId: tab.id };
  },

  async GET_IMPORT(_req, sender) {
    const job = (await getImports())[tabOf(sender)];
    const auth = await getAuth();
    return job && auth ? { job, settings: auth.account.settings } : null;
  },

  async IMPORT_STOP(_req, sender) {
    await setImport(tabOf(sender), null);
    return null;
  },

  async IMPORT_KNOWN({ marketplace }) {
    const { listings } = await api<{ listings: Listing[] }>(`/api/listings?marketplace=${marketplace}`);
    return Object.fromEntries(listings.filter((l) => l.externalId).map((l) => [l.externalId!, l.itemId]));
  },

  async IMPORT_LISTING({ marketplace, listing }, sender) {
    if (!(await getImports())[tabOf(sender)]) throw new Error("Import was stopped in this tab");
    const images: string[] = [];
    for (const url of listing.photos.slice(0, 20)) {
      try {
        images.push(await copyPhoto(url));
      } catch (e) {
        console.warn("Stock & List: skipped a photo", url, e);
      }
    }
    // Safe to repeat: the import skips listings it already has.
    const { results, possibleDuplicates } = await api<ImportResult>("/api/items/import", {
      retry: true,
      json: { marketplace, listings: [toImportListing(marketplace, listing, images)] },
    });
    const result = results[0];
    if (!result) throw new Error("Import failed");
    await itemsChanged(result.itemId);
    return {
      itemId: result.itemId,
      created: result.created,
      photos: result.created ? images.length : 0,
      // Older servers don't send it.
      possibleDuplicate: (possibleDuplicates ?? []).includes(result.itemId),
    };
  },

  async FETCH_DESCRIPTION({ url }, sender) {
    tabOf(sender);
    if (!isDescriptionHost(url)) throw new Error("Not an eBay description");
    const blob = await fetchBlob(url, { credentials: "omit" }, { what: "eBay's description server" });
    return (await blob.text()).slice(0, 1_000_000);
  },
};

chrome.runtime.onMessage.addListener((req: Request, sender, sendResponse) => {
  // Only our own pages and content scripts can reach onMessage, but be strict anyway.
  if (sender.id !== chrome.runtime.id) return false;
  const handler = handlers[req.type] as Handler<typeof req.type> | undefined;
  if (!handler) return false;
  handler(req as never, sender).then(
    (data) => sendResponse({ ok: true, data } satisfies Reply<unknown>),
    (err: Error) => sendResponse({ ok: false, error: err.message } satisfies Reply<unknown>),
  );
  return true; // async response
});
