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
    };

export type ExtensionToWeb =
  | { source: typeof BRIDGE_EXT; type: "PONG"; version: string }
  /** Reply to LIST_ITEM and DELIST_ITEM (one name for both keeps older builds compatible). */
  | { source: typeof BRIDGE_EXT; type: "LIST_RESULT"; requestId: string; ok: boolean; error?: string };
