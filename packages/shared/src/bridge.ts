import type { Marketplace } from "./schemas";

/**
 * window.postMessage protocol between the web app and the extension's bridge
 * content script (which runs on the web app's origin only).
 */
export const BRIDGE_WEB = "jf-web";
export const BRIDGE_EXT = "jf-ext";

export type WebToExtension =
  | { source: typeof BRIDGE_WEB; type: "PING" }
  | {
      source: typeof BRIDGE_WEB;
      type: "LIST_ITEM";
      requestId: string;
      itemId: string;
      marketplace: Marketplace;
      /** Lets a signed-out extension adopt the web app's session. */
      token: string;
    }
  | {
      source: typeof BRIDGE_WEB;
      /** End a live listing (the item sold elsewhere). Answered with LIST_RESULT. */
      type: "DELIST_ITEM";
      requestId: string;
      itemId: string;
      marketplace: Marketplace;
      token: string;
    }
  | {
      source: typeof BRIDGE_WEB;
      /** Search for comparables and save a price check. Answered with LIST_RESULT once it's saved. */
      type: "PRICE_CHECK";
      requestId: string;
      itemId: string;
      token: string;
    }
  | {
      source: typeof BRIDGE_WEB;
      /** Re-create a live listing from the inventory, then end the old one (bump). Answered with LIST_RESULT. */
      type: "RELIST_ITEM";
      requestId: string;
      itemId: string;
      marketplace: Marketplace;
      token: string;
    }
  | {
      source: typeof BRIDGE_WEB;
      /** Open the seller's own listings on a marketplace, ready to pick what to import. Answered with LIST_RESULT. */
      type: "IMPORT_LISTINGS";
      requestId: string;
      marketplace: Marketplace;
      token: string;
    };

export type ExtensionToWeb =
  | { source: typeof BRIDGE_EXT; type: "PONG"; version: string }
  /** Reply to LIST_ITEM, DELIST_ITEM, RELIST_ITEM and IMPORT_LISTINGS (one name for all keeps older builds compatible). */
  | { source: typeof BRIDGE_EXT; type: "LIST_RESULT"; requestId: string; ok: boolean; error?: string }
  /** The extension changed this item (a listing recorded, ended or cancelled, a price set, an import): open pages refetch it. */
  | { source: typeof BRIDGE_EXT; type: "ITEMS_CHANGED"; itemId: string }
  /**
   * This page's copy of the extension was replaced (reloaded or updated): the page has to be reloaded to
   * talk to the new one, since Chrome doesn't add the new content script to tabs that are already open.
   */
  | { source: typeof BRIDGE_EXT; type: "EXTENSION_RELOADED" };

/** chrome.storage.local key the extension's background bumps when it changes items; the bridge relays it. */
export const ITEMS_CHANGED_KEY = "itemsChanged";
export interface ItemsChanged {
  itemId: string;
  at: number;
}

/**
 * Puts refetched items into a list in place, without reloading the list. `changed` maps an id to the item,
 * or to null when it's gone. Items no longer `belongs` to the list drop out; ones new to it go on top when
 * `addNew` (pass false when the list is a search the client can't re-run).
 */
export function mergeChangedItems<T extends { id: string }>(
  list: T[],
  changed: Map<string, T | null>,
  belongs: (item: T) => boolean,
  addNew = true,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of list) {
    if (!changed.has(item.id)) {
      out.push(item);
      continue;
    }
    seen.add(item.id);
    const next = changed.get(item.id);
    if (next && belongs(next)) out.push(next);
  }
  if (addNew) {
    const added = [...changed.values()].filter((i): i is T => !!i && !seen.has(i.id) && belongs(i));
    out.unshift(...added);
  }
  return out;
}
