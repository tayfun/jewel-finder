import {
  CONDITION_LABELS,
  VINTED_PACKAGE_LABELS,
  conditionFromText,
  parseListingUrl,
  priceToMinor,
  toDecimal,
  vintedCategory,
  vintedPackageSize,
  type VintedCategory,
  type VintedPackageSize,
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
  spacedText,
  sleep,
  waitFor,
  type FieldSpec,
} from "../lib/dom";
import { runImport } from "../lib/importer";
import { run, type Adapter, type Importer } from "../lib/runner";
import { isUploadedMessage } from "../lib/vinted-upload";
import { breadcrumbs, first, imgUrl, labelledValue, ldImages, ldOfType, ldText, meta, text, textOf, uniquePhotos } from "../lib/scrape";

// Vinted's upload form (/items/new). Several strategies per field because the DOM changes without notice.
export const FIELDS = {
  photos: { selectors: ['[data-testid*="photo"] input[type=file]', "input[type=file][accept*=image]", "input[type=file]"] },
  title: { selectors: ["#title", 'input[name="title"]', '[data-testid="title--input"]'], labels: [/^title$/] },
  description: {
    selectors: ["#description", 'textarea[name="description"]', '[data-testid="description--input"]'],
    labels: [/^describe your item$/, /^description$/],
  },
  price: { selectors: ["#price", 'input[name="price"]', '[data-testid="price-input--input"]'], labels: [/^price$/] },
  brand: {
    selectors: ['[data-testid="brand-select-dropdown-input"]', "#brand", 'input[name="brand"]'],
    labels: [/^brand$/],
  },
  // A searchable picker: the trigger opens a panel with its own search box.
  category: {
    selectors: ['[data-testid="catalog-select-dropdown-input"]', "#catalog_id", 'input[name="catalog"]'],
    labels: [/^category$/],
  },
  // Book categories only.
  isbn: { selectors: ['[data-testid="isbn--input"]', "#isbn", 'input[name="isbn"]'], labels: [/^isbn$/] },
  condition: {
    selectors: ['[data-testid="category-condition-single-list-input"]', '[data-testid="condition-select-dropdown-input"]', "#condition", 'input[name="condition"]'],
    labels: [/^condition$/],
  },
  // Books only, and only once a book category is picked.
  language: {
    selectors: ['[data-testid="language-select-dropdown-input"]', "#language", 'input[name="language"]'],
    labels: [/^language$/],
  },
} satisfies Record<string, FieldSpec>;

const RADIOS = 'input[type=radio], [role=radio]';

/** Nearest ancestor of `el` (up to a few levels) that holds at least two size choices. */
function choiceBox(el: HTMLElement): HTMLElement | null {
  let box: HTMLElement | null = el.parentElement;
  for (let i = 0; box && i < 6; i++, box = box.parentElement) {
    if (box.querySelectorAll(RADIOS).length >= 2) return box;
  }
  return null;
}

/** The "Parcel size" section, found by test id or by its heading. */
function packageSection(): HTMLElement | null {
  const byTestId = document.querySelector<HTMLElement>('[data-testid*="package-size"], [data-testid*="parcel-size"]');
  if (byTestId) return choiceBox(byTestId);
  for (const el of document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, legend, label, span, div")) {
    if (el.children.length > 2 || !/^(parcel|package) size$/.test(normalize(el.textContent))) continue;
    const box = choiceBox(el);
    if (box) return box;
  }
  return null;
}

/** Vinted's parcel cells: data-testid="1-package-size--cell" with the size in its title, a radio in its suffix. */
function packageRadio(size: VintedPackageSize): HTMLElement | null {
  for (const cell of document.querySelectorAll<HTMLElement>('[data-testid$="-package-size--cell"]')) {
    const title = normalize(cell.querySelector('[data-testid$="--cell--title"]')?.textContent);
    // The title also holds badges like "Recommended", so match the size as a word.
    if (new RegExp(`\\b${size}$`).test(title)) return cell.querySelector<HTMLElement>("input[type=radio]") ?? cell;
  }
  return null;
}

function selectPackageSize(size: VintedPackageSize): boolean {
  const radio = packageRadio(size);
  if (radio) {
    if (!(radio instanceof HTMLInputElement && radio.checked)) click(radio);
    return true;
  }
  const section = packageSection();
  const choice = section && findChoice(new RegExp(`^${size}\\b`), section);
  if (!choice) return false;
  click(choice);
  return true;
}

/**
 * Picks a category through the picker's search box ("Fiction" also matches "Science fiction", so the
 * result has to be the one under the right parent). Returns false if it didn't show up.
 */
async function pickCategory(category: VintedCategory): Promise<boolean> {
  const trigger = findField(FIELDS.category);
  if (!trigger) return false;
  click(trigger);
  const search = await waitFor(
    () => document.querySelector<HTMLInputElement>('#catalog-search-input, [data-testid="catalog-select-dropdown-content"] input'),
    3000,
  );
  if (!search) return false;
  setValue(search, category.name);
  const want = new RegExp(`^${escapeRegExp(normalize(category.name))} ${escapeRegExp(normalize(category.parent))}$`);
  const result = await waitFor(() => {
    const panel = document.querySelector('[data-testid="catalog-select-dropdown-content"]') ?? search.closest('[role=dialog], [data-testid*="dropdown"]');
    // Each result is a role=radio row reading "<name> <parent path>"; click the row itself, not its <li>.
    for (const row of panel?.querySelectorAll<HTMLElement>("[role=radio], [role=option]") ?? []) {
      if (want.test(spacedText(row))) return row;
    }
    return null;
  }, 5000);
  if (!result) {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  click(result);
  // The book fields (ISBN, condition, parcel size) render once a category is in.
  await sleep(800);
  return true;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** True while one of Vinted's select buttons still shows its placeholder ("Select condition"). */
function isUnset(trigger: HTMLElement): boolean {
  const value = normalize(trigger.querySelector('[data-testid$="--value"]')?.textContent ?? trigger.textContent);
  return !value || /^select\b/.test(value);
}

/** Re-picks `value` in a select whenever it's empty, for a few minutes after filling. Never overrides a choice. */
function keepSelected(spec: FieldSpec, value: string, forMs = 3 * 60_000) {
  const until = Date.now() + forMs;
  let busy = false;
  let failures = 0;
  const timer = setInterval(() => {
    if (Date.now() > until || failures >= 3) return clearInterval(timer);
    if (busy || document.querySelector(DIALOG + ', [role=menu]')) return; // don't fight an open menu or dialog
    const trigger = findField(spec);
    if (!trigger || !(trigger instanceof HTMLButtonElement) || !isUnset(trigger)) return;
    busy = true;
    void pickOption(trigger, value)
      .then(async (ok) => {
        if (!ok) failures++;
        await sleep(300);
        // Close the menu if it stayed open after the pick.
        if (ok) document.querySelector("[role=menu]")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      })
      .finally(() => (busy = false));
  }, 1500);
}

/** The listing to end: a relist's old one, otherwise the item's listing here. */
const targetOf = (ctx: JobContext): { externalId: string | null; url: string | null } | undefined =>
  ctx.job.target ?? ctx.item.listings.find((l) => l.marketplace === "vinted");

/** The signed-in member's own profile link in Vinted's header, e.g. /member/123-name. */
function ownProfileLink(doc: Document): HTMLAnchorElement | null {
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('header a[href*="/member/"], [data-testid*="header"] a[href*="/member/"], nav a[href*="/member/"]')) {
    if (/^\/member\/\d+/.test(new URL(a.href, doc.baseURI).pathname)) return a;
  }
  return null;
}

const memberId = (path: string) => path.match(/^\/member\/(\d+)/)?.[1] ?? null;

/** Vinted's details table: data-testid="item-attributes-<name>" rows, or a label next to its value. */
function attribute(doc: Document, testId: string, label: RegExp): string {
  const row = doc.querySelector(`[data-testid="item-attributes-${testId}"]`);
  if (row) {
    const value =
      textOf(row, '[itemprop]', '[data-testid$="-value"]', ".details-list__item-value", '[class*="value"]') ||
      text(row.lastElementChild);
    if (value) return value;
  }
  return labelledValue(doc, label);
}

/** Vinted photo URLs look like https://images1.vinted.net/t/<photo>/<size>/<file>?s=…; one photo, many sizes. */
const photoKey = (url: string) => url.match(/\/t\/([^/]+)\//)?.[1] ?? url.split("?")[0]!;

export const vintedImporter: Importer = {
  emptyHint: "Open your Vinted profile to see your listings here, then tick the ones to import.",

  listingsLink(url, doc) {
    const own = ownProfileLink(doc);
    if (!own || memberId(url.pathname) === memberId(new URL(own.href, doc.baseURI).pathname)) return null;
    return { href: own.href, label: "Open my wardrobe" };
  },

  isOwnListings(url, doc) {
    const id = memberId(url.pathname);
    if (!id) return false;
    const own = ownProfileLink(doc);
    if (own) return memberId(new URL(own.href, doc.baseURI).pathname) === id;
    // Your own profile has an "Edit profile" link to settings.
    return Boolean(doc.querySelector('a[href*="/settings/profile"]'));
  },

  async parse(doc, url) {
    const ld = ldOfType(doc, "Product");
    const offer = first(ld?.offers) as Record<string, unknown> | undefined;
    const title =
      ldText(ld?.name) || textOf(doc, '[data-testid="item-page-summary-plugin"] h1', '[itemprop="name"]', "h1") || meta(doc, "og:title").replace(/\s*[|-]\s*Vinted.*$/i, "");
    const conditionText = attribute(doc, "status", /^(condition|état|zustand|estado|stato|stan)$/);
    const availability = String(offer?.availability ?? "");
    const statusText = textOf(doc, '[data-testid*="item-status"]', '[data-testid*="sold"]');
    const photos = [
      ...ldImages(ld?.image),
      ...[...doc.querySelectorAll<HTMLImageElement>('[data-testid^="item-photo"] img, .item-photos img, .item-thumbnail img')]
        .map((img) => imgUrl(img, url))
        .filter((u): u is string => Boolean(u)),
      meta(doc, "og:image"),
    ].filter(Boolean);
    return {
      state: /soldout|outofstock/i.test(availability) || /^sold$/i.test(statusText) ? "sold" : "listed",
      title,
      description:
        ldText(ld?.description) ||
        textOf(doc, '[itemprop="description"]', '[data-testid="item-description"]', '[data-testid*="description"]') ||
        meta(doc, "og:description", "description"),
      price: priceToMinor(ldText(offer?.price) || meta(doc, "product:price:amount", "og:price:amount") || textOf(doc, '[data-testid*="item-price"]', '[itemprop="price"]')),
      brand: ldText(ld?.brand) || attribute(doc, "brand", /^(brand|marque|marke|marca)$/),
      size: attribute(doc, "size", /^(size|taille|größe|talla|taglia|rozmiar)$/),
      colour: attribute(doc, "color", /^(colou?r|couleur|farbe)$/),
      condition: conditionFromText(conditionText) ?? conditionFromText(ldText(offer?.itemCondition ?? ld?.itemCondition)),
      category: breadcrumbs(doc, title, ['[data-testid*="breadcrumb"] a', 'nav[aria-label*="readcrumb" i] a', ".breadcrumbs a"]),
      photos: uniquePhotos(photos, photoKey),
    };
  },
};
const DIALOG = '[role=dialog], dialog[open], [data-testid*="modal"]';

export const vinted: Adapter = {
  marketplace: "vinted",

  importer: vintedImporter,

  isSellPage: (url) => /^\/items\/new\/?$/.test(url.pathname),

  detectPublished: (url) => parseListingUrl("vinted", url.href),

  // "Item listed" promo with "List another" / "Later": it covers the page and adds nothing for us.
  async afterPublished() {
    const later = await waitFor(
      () =>
        document.querySelector<HTMLElement>('[data-testid="list-promotion-cancel-cta"]') ??
        [...document.querySelectorAll(DIALOG)]
          .filter((d) => /item listed/.test(normalize(d.textContent)))
          .map((d) => findButton(/^(later|not now|close)$/, d))
          .find(Boolean) ??
        null,
      20_000,
    );
    if (later) click(later);
    return !!later;
  },

  // Vinted goes back to the seller's profile after publishing, so the id comes from the upload request
  // (seen by vinted-page.ts in the page's world).
  watchPublished(onPublished) {
    window.addEventListener("message", (e) => {
      if (e.source !== window || e.origin !== location.origin || !isUploadedMessage(e.data)) return;
      onPublished({ externalId: e.data.id, url: `${location.origin}/items/${e.data.id}` });
    });
  },

  // Own item page → "Delete" → confirmation dialog. The seller presses the final confirm.
  delist: {
    async step(ctx) {
      const listing = targetOf(ctx);
      const after = "Jewel Finder updates your inventory once it's gone.";
      if (parseListingUrl("vinted", location.href)?.externalId !== listing?.externalId) {
        return `Open the listing (${listing?.url ?? "on Vinted"}) and delete it. ${after}`;
      }
      const remove = await waitFor(
        () => findButton(/^delete( item| listing)?$/) ?? document.querySelector<HTMLElement>('[data-testid*="delete" i]'),
        10_000,
      );
      if (!remove) return `Click “Delete” on this listing and confirm. ${after}`;
      click(remove);
      const confirm = await waitFor(() => {
        const dialog = document.querySelector(DIALOG);
        return dialog ? findButton(/delete|confirm/, dialog) : null;
      }, 4000);
      const label = confirm?.textContent?.trim();
      return label ? `Press “${label}” to delete it from Vinted. ${after}` : `Confirm the deletion on Vinted. ${after}`;
    },

    async isDone(ctx, url) {
      const listing = targetOf(ctx);
      if (!listing?.url || !listing.externalId) return false;
      if (parseListingUrl("vinted", url.href)?.externalId === listing.externalId) return false;
      // Vinted leaves the item page after deleting; make sure the item really is gone.
      try {
        const res = await fetch(new URL(listing.url).pathname, { credentials: "include" });
        if (res.status === 404 || res.status === 410) return true;
        return !res.url.includes(`/items/${listing.externalId}`);
      } catch {
        return false;
      }
    },
  },

  async fill({ item }, photos): Promise<FillReport> {
    const report: FillReport = { filled: [], manual: [], warnings: [] };
    const title = await waitFor(() => findField(FIELDS.title), 15_000);
    if (!title) throw new Error("Couldn't find Vinted's upload form. Are you signed in to Vinted?");

    const fileInput = findField(FIELDS.photos) as HTMLInputElement | null;
    if (fileInput && photos.length) {
      attachFiles(fileInput, photos);
      report.filled.push(`${photos.length} photo${photos.length > 1 ? "s" : ""}`);
      await sleep(500);
    } else if (photos.length) {
      report.warnings.push("Couldn't find the photo uploader — add photos by hand.");
    }

    setValue(title, item.title);
    report.filled.push("Title");

    const description = findField(FIELDS.description);
    if (description && item.description) {
      setValue(description, item.description);
      report.filled.push("Description");
    } else if (item.description) {
      report.manual.push({ field: "Description", value: item.description });
    }

    // Category comes before brand/size/condition on Vinted and unlocks them.
    const category = vintedCategory(item);
    if (category && (await pickCategory(category))) report.filled.push(`Category (${category.name})`);
    else report.manual.push({ field: "Category", value: category ? `${category.parent} > ${category.name}` : item.category });

    const isbnValue = item.book?.isbn ?? "";
    const isbn = isbnValue ? findField(FIELDS.isbn) : null;
    if (isbn) {
      setValue(isbn, isbnValue);
      report.filled.push("ISBN");
    }

    const brand = item.brand ? findField(FIELDS.brand) : null;
    if (brand && (await pickOption(brand, item.brand))) report.filled.push("Brand");
    else if (item.brand) report.manual.push({ field: "Brand", value: item.brand });

    if (item.size) report.manual.push({ field: "Size", value: item.size });

    const conditionLabel = item.condition ? CONDITION_LABELS[item.condition] : "";
    const condition = conditionLabel ? findField(FIELDS.condition) : null;
    if (condition && (await pickOption(condition, conditionLabel))) report.filled.push("Condition");
    else report.manual.push({ field: "Condition", value: conditionLabel });
    // Vinted re-renders the form once the photos are processed (and when the category changes), which can
    // clear Condition again, or bring it up only later: put it back whenever it's empty for a while.
    if (conditionLabel) keepSelected(FIELDS.condition, conditionLabel);

    if (item.colour) report.manual.push({ field: "Colour", value: item.colour });

    const languageValue = item.book?.language ?? "";
    const language = languageValue ? findField(FIELDS.language) : null;
    if (language && (await pickOption(language, languageValue))) report.filled.push("Language");
    else if (languageValue) report.manual.push({ field: "Language", value: languageValue });

    const price = findField(FIELDS.price);
    if (price && item.price != null) {
      setValue(price, toDecimal(item.price));
      report.filled.push("Price");
    } else {
      report.manual.push({ field: "Price", value: toDecimal(item.price) });
    }

    // Most of what we sell is books, which fit Small; Vinted's own "Recommended" is often Medium.
    const packageSize = vintedPackageSize(item) ?? "small";
    if (await waitFor(() => (selectPackageSize(packageSize) ? true : null), 1500)) {
      report.filled.push(`Parcel size (${VINTED_PACKAGE_LABELS[packageSize]})`);
    } else {
      // The sizes only appear once a category is picked; if the seller does that by hand, keep watching.
      void waitFor(() => (selectPackageSize(packageSize) ? true : null), 10 * 60_000, 1000);
      report.manual.push({ field: "Parcel size", value: `${VINTED_PACKAGE_LABELS[packageSize]} (picked for you once the sizes appear)` });
    }
    return report;
  },
};

if (typeof chrome !== "undefined" && chrome.runtime?.id) {
  void run(vinted);
  void runImport(vinted);
}
