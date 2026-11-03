import {
  EBAY_CONDITION_LABELS,
  PACKAGE_SIZE_LABELS,
  ebayPackageSize,
  parseListingUrl,
  toDecimal,
  type PackageSize,
} from "@jf/shared";
import type { FillReport, JobContext } from "../messages";
import {
  attachFiles,
  click,
  findButton,
  findChoice,
  findField,
  normalize,
  pickOption,
  setValue,
  sleep,
  waitFor,
  type FieldSpec,
} from "../lib/dom";
import { run, type Adapter } from "../lib/runner";

// eBay's listing form (/lstng?...). The step before it (/sl/prelist) picks the category and condition.
export const FIELDS = {
  photos: { selectors: ['[class*="photo"] input[type=file]', "input[type=file][accept*=image]", "input[type=file]"] },
  title: { selectors: ['input[name="title"]'], labels: [/^title$/, /^item title$/] },
  price: {
    selectors: ['input[name="price"]', 'input[name="binPrice"]', 'input[aria-label*="Buy it now" i]'],
    labels: [/^item price$/, /^buy it now( price)?$/, /^price$/],
  },
  description: { selectors: ['textarea[name="description"]', "textarea#description"], labels: [/^description$/] },
  brand: { selectors: ['input[name="attributes.Brand"]'], labels: [/^brand$/] },
  size: { selectors: ['input[name="attributes.Size"]'], labels: [/^size$/] },
  colour: { selectors: ['input[name="attributes.Colour"]', 'input[name="attributes.Color"]'], labels: [/^colou?r$/] },
} satisfies Record<string, FieldSpec>;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** True unless the element sits inside something eBay hides with its `hidden` class or attribute. */
const shown = (el: Element) => !el.closest(".hidden, [hidden]");

/** The body of the rich-text editor iframe, once eBay has switched it into edit mode. */
function editorBody(): HTMLElement | null {
  const frames = [
    ...document.querySelectorAll<HTMLIFrameElement>('iframe[title*="escription" i], iframe[id^="se-rte-frame"]'),
    ...document.querySelectorAll<HTMLIFrameElement>("iframe"),
  ];
  for (const frame of frames) {
    let doc: Document | null = null;
    try {
      doc = frame.contentDocument;
    } catch {
      continue; // cross-origin
    }
    const body = doc?.body;
    if (doc && body && (doc.designMode === "on" || body.isContentEditable || body.getAttribute("contenteditable") === "true")) return body;
  }
  return null;
}

/**
 * eBay's description is a rich-text editor in a same-origin iframe. Next to it sits a hidden
 * <textarea name="description"> used only in "Show HTML code" mode; writing there alone does nothing.
 */
async function fillDescription(text: string): Promise<boolean> {
  const html = text.split("\n").map((line) => `<div>${escapeHtml(line) || "<br>"}</div>`).join("");
  const textarea = findField(FIELDS.description);
  if (textarea && shown(textarea)) {
    setValue(textarea, text);
    return true;
  }

  const body = textarea || document.querySelector("iframe") ? await waitFor(editorBody, 5000) : null;
  if (body) {
    const doc = body.ownerDocument;
    body.focus();
    doc.getSelection()?.selectAllChildren(body);
    // execCommand goes through the editor's own input handling, so eBay's model sees the change.
    let inserted = false;
    try {
      inserted = doc.execCommand("insertHTML", false, html);
    } catch {
      // not supported here
    }
    // Line breaks become separate <div>s, so compare without whitespace.
    const squash = (s: string | null) => (s ?? "").replace(/\s+/g, "");
    if (!inserted || squash(body.textContent) !== squash(text)) {
      body.innerHTML = html;
      body.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    }
    // Keep the HTML-mode copy in step in case eBay submits that one.
    if (textarea) setValue(textarea, html);
    return true;
  }

  const editable = document.querySelector<HTMLElement>('[contenteditable="true"][aria-label*="escription" i]');
  if (editable) {
    setValue(editable, text);
    return true;
  }
  if (textarea) {
    setValue(textarea, text);
    return true;
  }
  return false;
}

/** How eBay UK names each size in its package picker ("Small parcel up to 2 kg", …). */
const EBAY_PACKAGE_MATCH: Record<PackageSize, RegExp> = {
  large_letter: /^large letter\b/,
  small: /^small (parcel|package)\b/,
  medium: /^medium (parcel|package)\b/,
  large: /^large (parcel|package)\b/,
};

/**
 * Delivery → "package size" is a summary button showing the current size. It opens a picker;
 * choose the matching size there and confirm if the picker asks for it.
 */
async function fillPackageSize(size: PackageSize): Promise<boolean> {
  const want = EBAY_PACKAGE_MATCH[size];
  const summary = document.querySelector<HTMLElement>(".se-package-details-summary");
  const current = () => normalize(document.querySelector(".se-package-details-summary__label")?.textContent);
  const opener = summary?.querySelector<HTMLElement>("button");
  if (!summary || !opener) return false;
  if (want.test(current())) return true;

  click(opener);
  const choice = await waitFor(() => findChoice(want, document, summary), 4000);
  if (!choice) {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  click(choice);
  await sleep(300);
  if (!want.test(current())) {
    const dialog = choice.closest<HTMLElement>('[role=dialog], dialog, [class*="dialog"], [class*="drawer"]') ?? document;
    const confirm = findChoice(/^(save|done|apply|confirm|update|continue)$/, dialog, summary);
    if (confirm) click(confirm);
  }
  return Boolean(await waitFor(() => (want.test(current()) ? true : null), 3000));
}

/** Item specifics are comboboxes: type the value, then take the matching suggestion if one appears. */
async function fillSpecific(spec: FieldSpec, value: string): Promise<boolean> {
  const el = findField(spec);
  if (!el) return false;
  setValue(el, value);
  await pickOption(el, value, 1500);
  return true;
}

const listingOf = (ctx: JobContext) => ctx.item.listings.find((l) => l.marketplace === "ebay");
const ENDED = /(listing|item) (has been|was|is now) ended|you('ve| have) ended|ended successfully|this listing (has|was) ended|seller ended this listing/;

export const ebay: Adapter = {
  marketplace: "ebay",

  isSellPage: (url) => url.pathname.startsWith("/lstng") || url.pathname.startsWith("/sl/list"),

  hint: (url) =>
    url.pathname.startsWith("/sl/prelist")
      ? "Pick the matching product or category and the condition. Jewel Finder fills in the listing form on the next page."
      : null,

  detectPublished(url, doc) {
    const direct = parseListingUrl("ebay", url.href);
    if (direct) return direct;
    // Success page: "Your listing is now live" with a link to /itm/<id>.
    const text = normalize(doc.body?.innerText ?? doc.body?.textContent);
    if (!/listing is (now )?live|congratulations|you('|’)re all set|your item is listed/.test(text)) return null;
    for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="/itm/"]')) {
      const found = parseListingUrl("ebay", a.href);
      if (found) return found;
    }
    return null;
  },

  // Item page → "End listing" → reason page. The seller presses eBay's final "End listing".
  delist: {
    async step(ctx) {
      const id = listingOf(ctx)?.externalId;
      const after = "Jewel Finder marks it ended once it's done.";
      const text = normalize(document.body?.innerText ?? document.body?.textContent);
      const onEndPage =
        /EndingMyAuction|\/end(listing)?\b/i.test(location.href) ||
        (/why are you ending|end your listing/.test(text) && Boolean(document.querySelector("input[type=radio]")));
      if (onEndPage) {
        const reason = findChoice(/no longer available|sold (it )?(elsewhere|outside)/);
        if (reason) click(reason);
        return reason
          ? `Reason set to “no longer available”. Press “End listing” to confirm. ${after}`
          : `Pick a reason and press “End listing”. ${after}`;
      }
      if (parseListingUrl("ebay", location.href)?.externalId === id) {
        const end =
          findButton(/^end (your |this )?listing$/) ??
          document.querySelector<HTMLElement>('a[href*="EndingMyAuction" i], a[href*="endlisting" i]');
        if (end) {
          click(end);
          return "Opening eBay's End listing page…";
        }
      }
      return `In Seller Hub, open Listings → Active, find item ${id ?? ""} and choose Actions → End listing. ${after}`;
    },

    async isDone(ctx, _url, doc) {
      if (ENDED.test(normalize(doc.body?.innerText ?? doc.body?.textContent))) return true;
      const id = listingOf(ctx)?.externalId;
      if (!id) return false;
      // Double-check on the item page itself, which says when the seller ended it.
      try {
        const res = await fetch(`/itm/${id}`, { credentials: "include" });
        const page = new DOMParser().parseFromString(await res.text(), "text/html");
        // Scripts can carry "ended" strings on live listings too; only read what's shown.
        page.querySelectorAll("script, style, template, noscript").forEach((el) => el.remove());
        return ENDED.test(normalize(page.body?.textContent));
      } catch {
        return false;
      }
    },
  },

  async fill({ item }, photos): Promise<FillReport> {
    const report: FillReport = { filled: [], manual: [], warnings: [] };
    const title = await waitFor(() => findField(FIELDS.title), 15_000);
    if (!title) throw new Error("Couldn't find eBay's listing form. Are you signed in to eBay?");

    const fileInput = findField(FIELDS.photos) as HTMLInputElement | null;
    if (fileInput && photos.length) {
      attachFiles(fileInput, photos);
      report.filled.push(`${photos.length} photo${photos.length > 1 ? "s" : ""}`);
      await sleep(500);
    } else if (photos.length) {
      report.warnings.push("Couldn't find the photo uploader — add photos by hand.");
    }

    setValue(title, item.title.slice(0, 80));
    report.filled.push("Title");
    if (item.title.length > 80) report.warnings.push("eBay titles are limited to 80 characters; the title was shortened.");

    for (const [key, label, value] of [
      ["brand", "Brand", item.brand],
      ["size", "Size", item.size],
      ["colour", "Colour", item.colour],
    ] as const) {
      if (!value) continue;
      if (await fillSpecific(FIELDS[key], value)) report.filled.push(label);
      else report.manual.push({ field: label, value });
    }

    if (item.condition) report.manual.push({ field: "Condition (check)", value: EBAY_CONDITION_LABELS[item.condition] });

    if (item.description) {
      if (await fillDescription(item.description)) report.filled.push("Description");
      else report.manual.push({ field: "Description", value: item.description });
    }

    const price = findField(FIELDS.price);
    if (price && item.price != null) {
      setValue(price, toDecimal(item.price));
      report.filled.push("Price");
    } else {
      report.manual.push({ field: "Price", value: toDecimal(item.price) });
    }

    const packageSize = ebayPackageSize(item);
    if (packageSize) {
      if (await fillPackageSize(packageSize)) report.filled.push("Package size");
      else report.manual.push({ field: "Package size", value: PACKAGE_SIZE_LABELS[packageSize] });
    }

    report.manual.push({ field: "Postage", value: "" });
    return report;
  },
};

if (typeof chrome !== "undefined" && chrome.runtime?.id) void run(ebay);
