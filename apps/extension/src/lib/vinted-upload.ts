// Vinted doesn't leave the upload form for the new item's page after publishing (it goes back to the
// seller's profile, which doesn't show the item until a reload), so the item id has to come from the
// upload request itself. A script in the page's own world watches for it and posts it to the content script.

/** The window message the page script sends; the content script only trusts it from its own window. */
export const UPLOADED_MESSAGE = "jewel-finder:vinted-item-uploaded";

export interface UploadedMessage {
  type: typeof UPLOADED_MESSAGE;
  id: string;
}

// Publishing a new item, or finishing a saved draft. Saving a draft (POST /item_upload/drafts) doesn't count.
const PUBLISH_PATH = /\/api\/v2\/item_upload\/(?:items|drafts\/\d+\/completion)\/?$/;

/** The new item's id if this request published an item on Vinted, else null. */
export function uploadedItemId(method: string, url: string, status: number, body: unknown): string | null {
  if (method.toUpperCase() !== "POST" || status < 200 || status >= 300) return null;
  let path: string;
  try {
    path = new URL(url, "https://www.vinted.co.uk").pathname;
  } catch {
    return null;
  }
  if (!PUBLISH_PATH.test(path) || !body || typeof body !== "object") return null;
  const item = (body as { item?: unknown }).item ?? body;
  if (!item || typeof item !== "object") return null;
  const { id, is_draft } = item as { id?: unknown; is_draft?: unknown };
  if (is_draft === true) return null;
  return typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id)) ? String(id) : null;
}

export function isUploadedMessage(data: unknown): data is UploadedMessage {
  return (
    !!data &&
    typeof data === "object" &&
    (data as UploadedMessage).type === UPLOADED_MESSAGE &&
    typeof (data as UploadedMessage).id === "string" &&
    /^\d+$/.test((data as UploadedMessage).id)
  );
}
