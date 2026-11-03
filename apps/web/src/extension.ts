import {
  BRIDGE_EXT,
  BRIDGE_WEB,
  type ExtensionToWeb,
  type Marketplace,
  type WebToExtension,
} from "@jf/shared";
import { useEffect, useState } from "react";
import { getToken } from "./api";

/** Chrome Web Store listing, once published (VITE_EXTENSION_URL in apps/web/.env). */
export const EXTENSION_STORE_URL = import.meta.env.VITE_EXTENSION_URL || null;
/** The production build, zipped and served next to the app by the deploy script. */
export const EXTENSION_ZIP_URL = "/jewel-finder-extension.zip";

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

function request(type: "LIST_ITEM" | "DELIST_ITEM" | "RELIST_ITEM" | "IMPORT_LISTINGS", itemId: string, marketplace: Marketplace): Promise<void> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("The Jewel Finder extension didn't respond. Is it installed and enabled?"));
    }, 5000);
    const off = onMessage((msg) => {
      if (msg.type !== "LIST_RESULT" || msg.requestId !== requestId) return;
      clearTimeout(timer);
      off();
      if (msg.ok) resolve();
      else reject(new Error(msg.error ?? "The extension couldn't open the marketplace"));
    });
    const token = getToken() ?? "";
    post(type === "IMPORT_LISTINGS" ? { source: BRIDGE_WEB, type, requestId, marketplace, token } : { source: BRIDGE_WEB, type, requestId, itemId, marketplace, token });
  });
}
