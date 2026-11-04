import { BRIDGE_EXT, BRIDGE_WEB } from "@jf/shared";
import { describe, expect, it } from "vitest";

// A stand-in for chrome.*: `runtime.id` disappears when the extension is reloaded under the page.
const runtime: { id?: string; getManifest(): { version: string }; sendMessage(): Promise<unknown> } = {
  id: "ext",
  getManifest() {
    if (!this.id) throw new Error("Extension context invalidated.");
    return { version: "9.9.9" };
  },
  sendMessage: async () => ({ ok: true, data: null }),
};
(globalThis as { chrome?: unknown }).chrome = { runtime, storage: { onChanged: { addListener() {} } } };

const replies: unknown[] = [];
window.addEventListener("message", (e) => {
  if ((e.data as { source?: string })?.source === BRIDGE_EXT) replies.push(e.data);
});
// jsdom's postMessage leaves event.source unset, so dispatch what the browser would.
const fromPage = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: location.origin }));
const settle = () => new Promise((r) => setTimeout(r, 10));

describe("bridge", () => {
  it("answers PING, and once the extension is reloaded asks the page to reload instead of throwing", async () => {
    await import("../src/content/bridge");
    await settle();
    replies.length = 0;

    fromPage({ source: BRIDGE_WEB, type: "PING" });
    await settle();
    expect(replies).toEqual([{ source: BRIDGE_EXT, type: "PONG", version: "9.9.9" }]);

    replies.length = 0;
    delete runtime.id; // the extension was reloaded: this copy of the script is cut off
    expect(() => fromPage({ source: BRIDGE_WEB, type: "PING" })).not.toThrow();
    await settle();
    expect(replies).toEqual([{ source: BRIDGE_EXT, type: "EXTENSION_RELOADED" }]);

    // It stepped aside: later messages get no answer at all.
    replies.length = 0;
    fromPage({ source: BRIDGE_WEB, type: "PING" });
    await settle();
    expect(replies).toEqual([]);
  });
});
