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
    };

export type ExtensionToWeb =
  | { source: typeof BRIDGE_EXT; type: "PONG"; version: string }
  | { source: typeof BRIDGE_EXT; type: "LIST_RESULT"; requestId: string; ok: boolean; error?: string };
