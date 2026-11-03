import { MARKETPLACE_LABELS, imageUrl, sellUrl, type Account, type AuthResponse, type ItemWithListings } from "@jf/shared";
import { API_URL } from "./config";
import { api, getAuth, setAuth, tokenSubject } from "./lib/api";
import type { ImageFile, Job, Reply, Request, Responses } from "./messages";

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

chrome.tabs.onRemoved.addListener((tabId) => void setJob(tabId, null));

function tabOf(sender: chrome.runtime.MessageSender): number {
  const id = sender.tab?.id;
  if (id == null) throw new Error("This message must come from a tab");
  return id;
}

async function jobFor(sender: chrome.runtime.MessageSender): Promise<Job | null> {
  return (await getJobs())[tabOf(sender)] ?? null;
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
    if (!auth) throw new Error("Sign in to the Jewel Finder extension first");
    const item = await api<ItemWithListings>(`/api/items/${itemId}`);
    if (!item.images.length) throw new Error("Add at least one photo before listing");
    const existing = item.listings.find((l) => l.marketplace === marketplace);
    if (existing?.status === "listed") throw new Error(`Already listed on ${marketplace}`);

    await api(`/api/items/${itemId}/listings/${marketplace}`, {
      method: "PUT",
      json: { status: "pending", price: item.price, error: null },
    });
    const tab = await chrome.tabs.create({ url: sellUrl(marketplace, auth.account.settings, item.title) });
    if (tab.id == null) throw new Error("Couldn't open a tab");
    await setJob(tab.id, { kind: "list", itemId, marketplace, startedAt: Date.now() });
    return { tabId: tab.id };
  },

  // Cross-delisting: open the live listing so the content script can take it down.
  async START_DELISTING({ itemId, marketplace, token }) {
    if (token) await adoptToken(token);
    if (!(await getAuth())) throw new Error("Sign in to the Jewel Finder extension first");
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
    const files: ImageFile[] = [];
    for (const [i, key] of item.images.entries()) {
      const res = await fetch(imageUrl(API_URL, key));
      if (!res.ok) continue;
      const blob = await res.blob();
      const ext = key.split(".").pop() ?? "jpg";
      files.push({ name: `photo-${i + 1}.${ext}`, type: blob.type, dataUrl: await blobToDataUrl(blob) });
    }
    return files;
  },

  async JOB_PUBLISHED({ url, externalId }, sender) {
    const job = await jobFor(sender);
    if (!job) return null;
    await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, {
      method: "PUT",
      json: { status: "listed", url, externalId, error: null },
    });
    await setJob(tabOf(sender), null);
    return null;
  },

  async JOB_DELISTED(_req, sender) {
    const job = await jobFor(sender);
    if (!job) return null;
    await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, {
      method: "PUT",
      json: { status: "ended", error: null },
    });
    await setJob(tabOf(sender), null);
    return null;
  },

  async JOB_CANCEL(_req, sender) {
    const job = await jobFor(sender);
    if (!job) return null;
    await setJob(tabOf(sender), null);
    if (job.kind === "delist") return null; // the listing stays flagged for ending
    const item = await api<ItemWithListings>(`/api/items/${job.itemId}`);
    if (item.listings.find((l) => l.marketplace === job.marketplace)?.status === "pending") {
      await api(`/api/items/${job.itemId}/listings/${job.marketplace}`, { method: "DELETE" });
    }
    return null;
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
