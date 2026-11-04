import { describe, expect, it } from "vitest";
import { vinted } from "../src/content/vinted";
import { UPLOADED_MESSAGE, isUploadedMessage, uploadedItemId } from "../src/lib/vinted-upload";

describe("uploadedItemId", () => {
  const item = { item: { id: 10661343458, title: "King Lear", is_draft: false }, parcel: null, code: 0 };

  it("reads the new item's id from a publish response", () => {
    expect(uploadedItemId("POST", "/api/v2/item_upload/items", 200, item)).toBe("10661343458");
    expect(uploadedItemId("post", "https://www.vinted.co.uk/api/v2/item_upload/drafts/77/completion", 201, item)).toBe("10661343458");
  });

  it("ignores drafts, failures, other requests and odd bodies", () => {
    expect(uploadedItemId("POST", "/api/v2/item_upload/drafts", 200, item)).toBeNull();
    expect(uploadedItemId("POST", "/api/v2/item_upload/items", 200, { item: { id: 5, is_draft: true } })).toBeNull();
    expect(uploadedItemId("POST", "/api/v2/item_upload/items", 422, item)).toBeNull();
    expect(uploadedItemId("GET", "/api/v2/item_upload/items/10661343458", 200, item)).toBeNull();
    expect(uploadedItemId("POST", "/api/v2/item_upload/items", 200, { errors: [] })).toBeNull();
    expect(uploadedItemId("POST", "/api/v2/item_upload/items", 200, null)).toBeNull();
  });
});

describe("vinted.watchPublished", () => {
  it("reports the item the page script saw, and ignores other messages", async () => {
    const seen: unknown[] = [];
    vinted.watchPublished!((p) => seen.push(p));
    // jsdom's postMessage leaves event.source unset, so dispatch the event the browser would.
    const post = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: window, origin: location.origin }));
    post({ type: "something-else", id: "1" });
    post({ type: UPLOADED_MESSAGE, id: "not-a-number" });
    post({ type: UPLOADED_MESSAGE, id: "10661343458" });
    expect(seen).toEqual([{ externalId: "10661343458", url: `${location.origin}/items/10661343458` }]);
    expect(isUploadedMessage({ type: UPLOADED_MESSAGE, id: "1" })).toBe(true);
  });
});
