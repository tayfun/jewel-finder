import { BRIDGE_EXT, BRIDGE_WEB, type ExtensionToWeb, type WebToExtension } from "@jf/shared";
import { send } from "../messages";

// Runs on the Jewel Finder web app only. Relays window.postMessage requests to the background.

function reply(msg: ExtensionToWeb) {
  window.postMessage(msg, window.location.origin);
}

window.addEventListener("message", (e: MessageEvent<WebToExtension>) => {
  if (e.source !== window || e.origin !== window.location.origin || e.data?.source !== BRIDGE_WEB) return;
  const msg = e.data;
  if (msg.type === "PING") {
    reply({ source: BRIDGE_EXT, type: "PONG", version: chrome.runtime.getManifest().version });
  } else if (msg.type === "LIST_ITEM") {
    send({ type: "START_LISTING", itemId: msg.itemId, marketplace: msg.marketplace, token: msg.token || undefined }).then(
      () => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: true }),
      (err: Error) => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: false, error: err.message }),
    );
  } else if (msg.type === "PRICE_CHECK") {
    send({ type: "START_PRICE_CHECK", itemId: msg.itemId, token: msg.token || undefined }).then(
      () => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: true }),
      (err: Error) => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: false, error: err.message }),
    );
  } else if (msg.type === "RELIST_ITEM") {
    send({ type: "START_RELISTING", itemId: msg.itemId, marketplace: msg.marketplace, token: msg.token || undefined }).then(
      () => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: true }),
      (err: Error) => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: false, error: err.message }),
    );
  } else if (msg.type === "IMPORT_LISTINGS") {
    send({ type: "START_IMPORT", marketplace: msg.marketplace, token: msg.token || undefined }).then(
      () => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: true }),
      (err: Error) => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: false, error: err.message }),
    );
  } else if (msg.type === "DELIST_ITEM") {
    send({ type: "START_DELISTING", itemId: msg.itemId, marketplace: msg.marketplace, token: msg.token || undefined }).then(
      () => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: true }),
      (err: Error) => reply({ source: BRIDGE_EXT, type: "LIST_RESULT", requestId: msg.requestId, ok: false, error: err.message }),
    );
  }
});

// Announce ourselves in case the page asked before we loaded.
reply({ source: BRIDGE_EXT, type: "PONG", version: chrome.runtime.getManifest().version });
