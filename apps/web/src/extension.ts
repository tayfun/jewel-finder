import {
  BRIDGE_EXT,
  BRIDGE_WEB,
  type ExtensionToWeb,
  type Marketplace,
  type WebToExtension,
} from "@jf/shared";
import { useEffect, useRef, useState } from "react";
import { getToken } from "./api";

/** Chrome Web Store listing, once published (VITE_EXTENSION_URL in apps/web/.env). */
export const EXTENSION_STORE_URL = import.meta.env.VITE_EXTENSION_URL || null;
/** The production build, zipped and served next to the app by the deploy script. */
export const EXTENSION_ZIP_URL = "/stock-and-list-extension.zip";

function post(msg: WebToExtension) {
  window.postMessage(msg, window.location.origin);
}

function onMessage(handler: (msg: ExtensionToWeb) => void): () => void {
  const listener = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    if (e.data?.source === BRIDGE_EXT) handler(e.data as ExtensionToWeb);
  };
  window.addEventListener("message", listener);
  return () => window.removeEventListener("message", listener);
}

/**
 * Calls `onChanged` with the ids of items the extension just changed (e.g. a listing it recorded after you
 * published on Vinted). Batched, since an import changes many items in a row: it fires once things go quiet
 * for `waitMs`, or every `maxWaitMs` during a long run.
 */
export function useItemChanges(onChanged: (ids: string[]) => void, waitMs = 500, maxWaitMs = 3000) {
  const latest = useRef(onChanged);
  latest.current = onChanged;
  useEffect(() => {
    let pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let firstAt = 0;
    const flush = () => {
      const ids = [...pending];
      pending = new Set();
      timer = undefined;
      if (ids.length) latest.current(ids);
    };
    const off = onMessage((msg) => {
      if (msg.type !== "ITEMS_CHANGED" || !msg.itemId) return;
      if (!pending.size) firstAt = Date.now();
      pending.add(msg.itemId);
      clearTimeout(timer);
      timer = setTimeout(flush, Math.max(0, Math.min(waitMs, firstAt + maxWaitMs - Date.now())));
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, [waitMs, maxWaitMs]);
}

/** True once the extension has said this page is talking to a replaced copy of it (reload needed). */
export function useExtensionReloaded(): boolean {
  const [reloaded, setReloaded] = useState(false);
  useEffect(() => onMessage((msg) => msg.type === "EXTENSION_RELOADED" && setReloaded(true)), []);
  return reloaded;
}

/** null while checking, then the extension version or false if it isn't installed. */
export function useExtension(): string | false | null {
  const [version, setVersion] = useState<string | false | null>(null);
  useEffect(() => {
    const off = onMessage((msg) => {
      if (msg.type === "PONG") setVersion(msg.version);
    });
    post({ source: BRIDGE_WEB, type: "PING" });
    const timer = setTimeout(() => setVersion((v) => v ?? false), 800);
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);
  return version;
}

/** Asks the extension to open the marketplace's sell page and fill it in. */
export function listViaExtension(itemId: string, marketplace: Marketplace): Promise<void> {
  return request("LIST_ITEM", itemId, marketplace);
}

/** Asks the extension to open a live listing and take it down (the item sold elsewhere). */
export function delistViaExtension(itemId: string, marketplace: Marketplace): Promise<void> {
  return request("DELIST_ITEM", itemId, marketplace);
}

/** Asks the extension to list the item again as a new listing, then remove the old one (bump to the top). */
export function relistViaExtension(itemId: string, marketplace: Marketplace): Promise<void> {
  return request("RELIST_ITEM", itemId, marketplace);
}

/** Asks the extension to open the seller's listings on a marketplace, ready to pick what to import. */
export function importViaExtension(marketplace: Marketplace): Promise<void> {
  return request("IMPORT_LISTINGS", "", marketplace);
}

/**
 * Asks the extension to search eBay and Vinted for comparables and save a price check. Resolves once
 * it's saved, which takes a minute or so: each search opens in a background tab.
 */
export function priceCheckViaExtension(itemId: string): Promise<void> {
  return request("PRICE_CHECK", itemId, "ebay", 5 * 60_000);
}

function request(
  type: "LIST_ITEM" | "DELIST_ITEM" | "RELIST_ITEM" | "IMPORT_LISTINGS" | "PRICE_CHECK",
  itemId: string,
  marketplace: Marketplace,
  timeoutMs = 5000,
): Promise<void> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("The Stock & List extension didn't respond. Is it installed and enabled?"));
    }, timeoutMs);
    const off = onMessage((msg) => {
      if (msg.type !== "LIST_RESULT" || msg.requestId !== requestId) return;
      clearTimeout(timer);
      off();
      if (msg.ok) resolve();
      else reject(new Error(msg.error ?? "The extension couldn't open the marketplace"));
    });
    const token = getToken() ?? "";
    post(
      type === "IMPORT_LISTINGS"
        ? { source: BRIDGE_WEB, type, requestId, marketplace, token }
        : type === "PRICE_CHECK"
          ? { source: BRIDGE_WEB, type, requestId, itemId, token }
          : { source: BRIDGE_WEB, type, requestId, itemId, marketplace, token },
    );
  });
}
