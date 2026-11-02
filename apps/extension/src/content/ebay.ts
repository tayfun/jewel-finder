import { EBAY_CONDITION_LABELS, parseListingUrl, toDecimal } from "@jf/shared";
import type { FillReport } from "../messages";
import { attachFiles, findField, normalize, pickOption, setValue, sleep, waitFor, type FieldSpec } from "../lib/dom";
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

/** eBay's description is usually a rich-text editor in a same-origin iframe. */
function fillDescription(text: string): boolean {
  const textarea = findField(FIELDS.description);
  if (textarea) {
    setValue(textarea, text);
    return true;
  }
  for (const frame of document.querySelectorAll("iframe")) {
    let body: HTMLElement | null = null;
    try {
      body = frame.contentDocument?.body ?? null;
    } catch {
      continue; // cross-origin
    }
    if (!body?.isContentEditable && body?.getAttribute("contenteditable") !== "true") continue;
    body.innerHTML = text.split("\n").map((line) => escapeHtml(line) || "<br>").map((l) => `<div>${l}</div>`).join("");
    body.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return true;
  }
  const editable = document.querySelector<HTMLElement>('[contenteditable="true"][aria-label*="escription" i]');
  if (editable) {
    setValue(editable, text);
    return true;
  }
  return false;
}

/** Item specifics are comboboxes: type the value, then take the matching suggestion if one appears. */
async function fillSpecific(spec: FieldSpec, value: string): Promise<boolean> {
  const el = findField(spec);
  if (!el) return false;
  setValue(el, value);
  await pickOption(el, value, 1500);
  return true;
}

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
      if (fillDescription(item.description)) report.filled.push("Description");
      else report.manual.push({ field: "Description", value: item.description });
    }

    const price = findField(FIELDS.price);
    if (price && item.price != null) {
      setValue(price, toDecimal(item.price));
      report.filled.push("Price");
    } else {
      report.manual.push({ field: "Price", value: toDecimal(item.price) });
    }

    report.manual.push({ field: "Postage", value: "" });
    return report;
  },
};

if (typeof chrome !== "undefined" && chrome.runtime?.id) void run(ebay);
