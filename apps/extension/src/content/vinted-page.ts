// Runs in Vinted's own page world (not the extension's isolated one) from document_start, so it can see
// the responses to Vinted's own requests. It only reports a published item's id to the content script.
import { UPLOADED_MESSAGE, uploadedItemId, type UploadedMessage } from "../lib/vinted-upload";

function report(method: string, url: string, status: number, body: unknown) {
  const id = uploadedItemId(method, url, status, body);
  if (id) window.postMessage({ type: UPLOADED_MESSAGE, id } satisfies UploadedMessage, location.origin);
}

const mightPublish = (method: string, url: string) => method.toUpperCase() === "POST" && url.includes("/item_upload/");

const originalFetch = window.fetch;
window.fetch = async function (this: unknown, input: RequestInfo | URL, init?: RequestInit) {
  const res = await originalFetch.call(this, input, init);
  try {
    const url = input instanceof Request ? input.url : String(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    if (mightPublish(method, url)) {
      res
        .clone()
        .json()
        .then((body) => report(method, url, res.status, body))
        .catch(() => {});
    }
  } catch {
    // Never get in the way of Vinted's own request.
  }
  return res;
};

const open = XMLHttpRequest.prototype.open;
const send = XMLHttpRequest.prototype.send;
const requests = new WeakMap<XMLHttpRequest, { method: string; url: string }>();

XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  requests.set(this, { method, url: String(url) });
  return (open as (...args: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const req = requests.get(this);
  if (req && mightPublish(req.method, req.url)) {
    this.addEventListener("load", () => {
      try {
        const data =
          this.responseType === "json" ? this.response : this.responseType === "" || this.responseType === "text" ? JSON.parse(this.responseText) : null;
        report(req.method, this.responseURL || req.url, this.status, data);
      } catch {
        // Not JSON; not a publish.
      }
    });
  }
  return send.call(this, body);
};
