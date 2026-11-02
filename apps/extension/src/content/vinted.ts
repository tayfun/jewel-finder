import {
  CONDITION_LABELS,
  VINTED_PACKAGE_LABELS,
  parseListingUrl,
  toDecimal,
  vintedPackageSize,
  type VintedPackageSize,
} from "@jf/shared";
import type { FillReport } from "../messages";
import { attachFiles, click, findChoice, findField, normalize, pickOption, setValue, sleep, waitFor, type FieldSpec } from "../lib/dom";
import { run, type Adapter } from "../lib/runner";

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
  condition: {
    selectors: ['[data-testid="condition-select-dropdown-input"]', "#condition", 'input[name="condition"]'],
    labels: [/^condition$/],
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

function selectPackageSize(size: VintedPackageSize): boolean {
  const section = packageSection();
  const choice = section && findChoice(new RegExp(`^${size}\\b`), section);
  if (!choice) return false;
  click(choice);
  return true;
}

export const vinted: Adapter = {
  marketplace: "vinted",

  isSellPage: (url) => /^\/items\/new\/?$/.test(url.pathname),

  detectPublished: (url) => parseListingUrl("vinted", url.href),

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
    report.manual.push({ field: "Category", value: item.category });

    const brand = item.brand ? findField(FIELDS.brand) : null;
    if (brand && (await pickOption(brand, item.brand))) report.filled.push("Brand");
    else if (item.brand) report.manual.push({ field: "Brand", value: item.brand });

    if (item.size) report.manual.push({ field: "Size", value: item.size });

    const conditionLabel = item.condition ? CONDITION_LABELS[item.condition] : "";
    const condition = conditionLabel ? findField(FIELDS.condition) : null;
    if (condition && (await pickOption(condition, conditionLabel))) report.filled.push("Condition");
    else report.manual.push({ field: "Condition", value: conditionLabel });

    if (item.colour) report.manual.push({ field: "Colour", value: item.colour });

    const price = findField(FIELDS.price);
    if (price && item.price != null) {
      setValue(price, toDecimal(item.price));
      report.filled.push("Price");
    } else {
      report.manual.push({ field: "Price", value: toDecimal(item.price) });
    }

    const packageSize = vintedPackageSize(item);
    if (packageSize && (await waitFor(() => (selectPackageSize(packageSize) ? true : null), 1500))) {
      report.filled.push("Parcel size");
    } else if (packageSize) {
      // The sizes only appear once a category is picked, which the seller does by hand: keep watching.
      void waitFor(() => (selectPackageSize(packageSize) ? true : null), 10 * 60_000, 1000);
      report.manual.push({ field: "Parcel size", value: `${VINTED_PACKAGE_LABELS[packageSize]} (picked for you once the sizes appear)` });
    } else {
      report.manual.push({ field: "Parcel size", value: "" });
    }
    return report;
  },
};

if (typeof chrome !== "undefined" && chrome.runtime?.id) void run(vinted);
