import type { ItemWithListings, Settings } from "@jf/shared";
import { afterEach, describe, expect, it } from "vitest";
import { ebay } from "../src/content/ebay";
import { vinted } from "../src/content/vinted";
import type { JobContext } from "../src/messages";

afterEach(() => {
  document.body.innerHTML = "";
});

const item: ItemWithListings = {
  id: "item-1",
  sku: "JF-0001",
  title: "Levi's 501 straight jeans W32 L30",
  description: "Classic fit.\nWorn twice.",
  brand: "Levi's",
  category: "Men › Jeans",
  size: "W32",
  colour: "Blue",
  condition: "very_good",
  price: 2500,
  cost: 800,
  quantity: 1,
  status: "in_stock",
  images: ["u/x/1.jpg"],
  tags: [],
  notes: "",
  book: null,
  packageSize: "small",
  weightGrams: 2600,
  createdAt: 0,
  updatedAt: 0,
  listings: [],
};
const ctx = (marketplace: "vinted" | "ebay"): JobContext => ({
  job: { itemId: item.id, marketplace, startedAt: 0 },
  item,
  settings: { currency: "GBP", vintedDomain: "www.vinted.co.uk", ebayDomain: "www.ebay.co.uk" } satisfies Settings,
});
const photo = () => new File(["x"], "photo-1.jpg", { type: "image/jpeg" });

describe("vinted adapter", () => {
  it("recognises the sell page and published listings", () => {
    expect(vinted.isSellPage(new URL("https://www.vinted.co.uk/items/new"))).toBe(true);
    expect(vinted.isSellPage(new URL("https://www.vinted.co.uk/items/123-foo"))).toBe(false);
    expect(vinted.detectPublished(new URL("https://www.vinted.co.uk/items/123-foo"), document)?.externalId).toBe("123");
  });

  it("fills the upload form and reports what's left", async () => {
    // Approximation of Vinted's form; dropdowns don't open here, so brand/condition fall back to manual.
    document.body.innerHTML = `
      <div data-testid="photo-uploader"><input type="file" multiple accept="image/*"></div>
      <input id="title" data-testid="title--input">
      <textarea id="description" data-testid="description--input"></textarea>
      <input id="brand" data-testid="brand-select-dropdown-input" readonly>
      <input id="price" data-testid="price-input--input">
    `;
    const report = await vinted.fill(ctx("vinted"), [photo()]);
    expect((document.getElementById("title") as HTMLInputElement).value).toBe(item.title);
    expect((document.getElementById("description") as HTMLTextAreaElement).value).toBe(item.description);
    expect((document.getElementById("price") as HTMLInputElement).value).toBe("25.00");
    expect(document.querySelector<HTMLInputElement>("input[type=file]")!.files?.length).toBe(1);
    expect(report.filled).toEqual(["1 photo", "Title", "Description", "Price"]);
    expect(report.manual.map((m) => m.field)).toEqual(["Category", "Brand", "Size", "Condition", "Colour", "Parcel size"]);
    expect(report.manual.find((m) => m.field === "Condition")?.value).toBe("Very good");
    // 2.6 kg is over Vinted's 2 kg Small limit.
    expect(report.manual.find((m) => m.field === "Parcel size")?.value).toMatch(/^Medium/);

    // Parcel sizes show up once the seller picks a category; the adapter keeps watching for them.
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div class="package">
        <h3>Parcel size</h3>
        ${["Small", "Medium", "Large"]
          .map(
            (size, i) => `<label data-testid="package-size-${i}">
              <span>${size}</span><span>For items that fit in a ${size.toLowerCase()} box</span>
              <input type="radio" name="package" value="${i}">
            </label>`,
          )
          .join("")}
      </div>`,
    );
    await new Promise((r) => setTimeout(r, 1500));
    expect(document.querySelector<HTMLInputElement>('input[name="package"]:checked')?.value).toBe("1");
  }, 15_000);
});

describe("ebay adapter", () => {
  it("recognises pages", () => {
    expect(ebay.isSellPage(new URL("https://www.ebay.co.uk/lstng?draftId=1&mode=AddItem"))).toBe(true);
    expect(ebay.isSellPage(new URL("https://www.ebay.co.uk/sl/prelist/suggest"))).toBe(false);
    expect(ebay.hint?.(new URL("https://www.ebay.co.uk/sl/prelist/suggest"))).toMatch(/category/);
  });

  it("detects the success page", () => {
    document.body.innerHTML = `<h1>Your listing is now live</h1><a href="https://www.ebay.co.uk/itm/326112233445">View listing</a>`;
    expect(ebay.detectPublished(new URL("https://www.ebay.co.uk/sl/success"), document)).toEqual({
      externalId: "326112233445",
      url: "https://www.ebay.co.uk/itm/326112233445",
    });
    document.body.innerHTML = `<a href="https://www.ebay.co.uk/itm/326112233445">Some other item</a>`;
    expect(ebay.detectPublished(new URL("https://www.ebay.co.uk/sl/success"), document)).toBeNull();
  });

  it("fills the listing form", async () => {
    document.body.innerHTML = `
      <input type="file" multiple accept="image/*">
      <input name="title">
      <input name="attributes.Brand">
      <textarea name="description"></textarea>
      <input name="price">
    `;
    const report = await ebay.fill(ctx("ebay"), [photo()]);
    expect(document.querySelector<HTMLInputElement>('[name="title"]')!.value).toBe(item.title);
    expect(document.querySelector<HTMLInputElement>('[name="attributes.Brand"]')!.value).toBe("Levi's");
    expect(document.querySelector<HTMLTextAreaElement>('[name="description"]')!.value).toBe(item.description);
    expect(document.querySelector<HTMLInputElement>('[name="price"]')!.value).toBe("25.00");
    expect(report.filled).toEqual(["1 photo", "Title", "Brand", "Description", "Price"]);
    expect(report.manual.map((m) => m.field)).toEqual(["Size", "Colour", "Condition (check)", "Package size", "Postage"]);
  }, 15_000);

  it("picks the package size, bumped up by weight", async () => {
    // Summary button from eBay's Delivery section; the picker it opens is approximated.
    document.body.innerHTML = `
      <input name="title">
      <div class="se-package-details"><div class="se-package-details-summary">
        <h3>package size</h3>
        <button class="se-shipping-core-ui-field-button" type="form">
          <div class="se-package-details-summary__label">Large letter up to 1 kg</div>
          <div class="se-package-details-summary__description">Up to 35 x 25 x 2.5 cm</div>
        </button>
      </div></div>
      <div role="dialog" hidden></div>
    `;
    const dialog = document.querySelector<HTMLElement>("[role=dialog]")!;
    const label = document.querySelector(".se-package-details-summary__label")!;
    document.querySelector("button")!.addEventListener("click", () => {
      dialog.hidden = false;
      dialog.innerHTML = ["Large letter up to 1 kg", "Small parcel up to 2 kg", "Medium parcel up to 20 kg", "Large parcel up to 30 kg"]
        .map((t) => `<label><input type="radio" name="pkg" value="${t}"><span>${t}</span></label>`)
        .join("") + "<button>Save</button>";
      dialog.querySelector("button")!.addEventListener("click", () => {
        label.textContent = dialog.querySelector<HTMLInputElement>("input:checked")?.value ?? label.textContent;
      });
    });

    const report = await ebay.fill(ctx("ebay"), []);
    expect(label.textContent).toBe("Medium parcel up to 20 kg");
    expect(report.filled).toContain("Package size");
  }, 15_000);

  it("writes the description into the rich-text iframe, not the hidden HTML textarea", async () => {
    // Shape of eBay's form: the visible editor is an iframe; the textarea is only for "Show HTML code".
    document.body.innerHTML = `
      <input name="title">
      <div class="se-rte__button-group-editor">
        <div class="iframe-wrapper"><iframe id="se-rte-frame__summary" title="Description"></iframe></div>
        <textarea class="se-rte__button-group-editor__html hidden" name="description"></textarea>
      </div>
      <input name="price">
    `;
    // happy-dom doesn't load iframe documents, so give the frame one the way eBay's editor sets it up.
    const frameDoc = document.implementation.createHTMLDocument("");
    frameDoc.designMode = "on";
    Object.defineProperty(document.querySelector("iframe")!, "contentDocument", { value: frameDoc });

    const report = await ebay.fill(ctx("ebay"), []);
    expect(frameDoc.body.innerHTML).toBe("<div>Classic fit.</div><div>Worn twice.</div>");
    expect(document.querySelector<HTMLTextAreaElement>('[name="description"]')!.value).toBe(frameDoc.body.innerHTML);
    expect(report.filled).toContain("Description");
  }, 15_000);
});
