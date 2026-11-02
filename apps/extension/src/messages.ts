import type { Account, ItemStatus, ItemWithListings, Marketplace, Settings } from "@jf/shared";

export interface Job {
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

/** Messages handled by the background service worker. */
export type Request =
  | { type: "AUTH_STATE" }
  | { type: "AUTH_LOGIN"; email: string; password: string }
  | { type: "AUTH_LOGOUT" }
  | { type: "LIST_ITEMS"; q?: string; status?: ItemStatus }
  | { type: "START_LISTING"; itemId: string; marketplace: Marketplace; token?: string }
  | { type: "GET_JOB" }
  | { type: "GET_IMAGES" }
  | { type: "JOB_PUBLISHED"; url: string; externalId: string }
  | { type: "JOB_CANCEL" };

export interface Responses {
  AUTH_STATE: { account: Account | null };
  AUTH_LOGIN: { account: Account };
  AUTH_LOGOUT: null;
  LIST_ITEMS: { items: ItemWithListings[] };
  START_LISTING: { tabId: number };
  GET_JOB: JobContext | null;
  GET_IMAGES: ImageFile[];
  JOB_PUBLISHED: null;
  JOB_CANCEL: null;
}

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

/** Typed wrapper over chrome.runtime.sendMessage; rejects with the background's error. */
export async function send<R extends Request>(req: R): Promise<Responses[R["type"]]> {
  const reply = (await chrome.runtime.sendMessage(req)) as Reply<Responses[R["type"]]> | undefined;
  if (!reply) throw new Error("No response from the extension background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
