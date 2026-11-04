import type { ItemWithListings, Settings } from "@jf/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  settings: { currency: "GBP", vintedDomain: "www.vinted.co.uk", ebayDomain: "www.ebay.co.uk", vintedRelistDays: 21, ebayRelistDays: 60 } satisfies Settings,
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

describe("vinted adapter: books", () => {
  // Vinted's parcel cells as of Nov 2026, trimmed. Medium comes pre-selected as "Recommended".
  const parcels = `<div id="package_size">${["Small", "Medium", "Large"]
    .map(
      (size, i) => `<div data-testid="${i + 1}-package-size--cell">
        <div data-testid="${i + 1}-package-size--cell--title">${i === 1 ? '<div><div>Recommended</div></div>' : ""}<span>${size}</span></div>
        <div data-testid="${i + 1}-package-size--cell--content">For items that'd fit in a box.</div>
        <div data-testid="${i + 1}-package-size--cell--suffix"><label for="p${i + 1}"><input id="p${i + 1}" type="radio" name="package_type_selector_${i + 1}" ${i === 1 ? "checked" : ""}></label></div>
      </div>`,
    )
    .join("")}</div>`;

  it("picks the book category, then fills ISBN and defaults the parcel to Small", async () => {
    document.body.innerHTML = `
      <input id="title" data-testid="title--input">
      <textarea id="description" data-testid="description--input"></textarea>
      <button type="button" data-testid="catalog-select-dropdown-input"><span>Select a category</span></button>
      <input id="price" data-testid="price-input--input">`;
    const trigger = document.querySelector<HTMLElement>('[data-testid="catalog-select-dropdown-input"]')!;
    // Opening the picker shows a search box; searching lists matching leaves with their parent path.
    trigger.addEventListener("click", () => {
      trigger.insertAdjacentHTML(
        "afterend",
        `<div data-testid="catalog-select-dropdown-content"><input id="catalog-search-input"><ul></ul></div>`,
      );
      const search = document.getElementById("catalog-search-input") as HTMLInputElement;
      search.addEventListener("input", () => {
        const rows = [
          ["Fiction", "Books & Media > Books"],
          ["Non-fiction", "Books & Media > Books"],
          ["Science fiction films", "Books & Media > Video"],
        ].filter(([name]) => name!.toLowerCase().includes(search.value.toLowerCase()));
        document.querySelector('[data-testid="catalog-select-dropdown-content"] ul')!.innerHTML = rows
          .map(([name, parent]) => `<li><div role="radio" data-name="${name}"><div>${name}</div><div>${parent}</div></div></li>`)
          .join("");
      });
    });
    document.addEventListener("click", (e) => {
      const row = (e.target as Element).closest<HTMLElement>("[role=radio][data-name]");
      if (!row) return;
      trigger.querySelector("span")!.textContent = row.dataset.name!;
      document.querySelector('[data-testid="catalog-select-dropdown-content"]')!.remove();
      // Choosing a book category brings up ISBN and the parcel sizes.
      trigger.insertAdjacentHTML("afterend", `<input data-testid="isbn--input">${parcels}`);
    });
    // Each radio has its own name, so Vinted's code (not the browser) unchecks the others.
    document.addEventListener("change", (e) => {
      const picked = e.target as HTMLInputElement;
      if (!picked.name?.startsWith("package_type_selector_")) return;
      for (const r of document.querySelectorAll<HTMLInputElement>('input[name^="package_type_selector_"]')) r.checked = r === picked;
    });

    const book = {
      ...item,
      title: "Margaret Atwood The Handmaid's Tale PB Vintage 1996",
      category: "Media › Books, Comics & Magazines › Books",
      tags: ["novel"],
      brand: "",
      size: "",
      colour: "",
      packageSize: null,
      weightGrams: null,
      book: { isbn: "9780099740919" } as ItemWithListings["book"],
    };
    const report = await vinted.fill({ ...ctx("vinted"), item: book }, []);
    expect(trigger.textContent).toBe("Fiction");
    expect(report.filled).toContain("Category (Fiction)");
    expect(document.querySelector<HTMLInputElement>('[data-testid="isbn--input"]')!.value).toBe("9780099740919");
    expect(report.filled).toContain("Parcel size (Small)");
    expect([1, 2, 3].map((i) => (document.getElementById(`p${i}`) as HTMLInputElement).checked)).toEqual([true, false, false]);
  }, 15_000);
});

describe("vinted adapter: after publishing", () => {
  it("closes the 'Item listed · List another' promo with Later", async () => {
    let closed = "";
    setTimeout(() => {
      document.body.innerHTML = `
        <div class="ReactModal__Overlay"><div role="dialog" aria-modal="true">
          <h1>Item listed</h1><span>The more listings you have, the easier it is for buyers to find you.</span>
          <button type="button" data-testid="list-promotion-submit-cta"><span>List another</span></button>
          <button type="button" data-testid="list-promotion-cancel-cta"><span>Later</span></button>
        </div></div>`;
      for (const b of document.querySelectorAll("button")) b.addEventListener("click", () => (closed = b.textContent ?? ""));
    }, 300);
    await vinted.afterPublished!();
    expect(closed).toBe("Later");
  });
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

describe("book language", () => {
  const book = { author: "J.R.R. Tolkien", isbn: "", publisher: "", yearPublished: null, edition: "", printing: "", format: null, language: "English", signed: false, dustJacket: null, rarity: null, rarityNotes: "" };
  const bookCtx = (marketplace: "vinted" | "ebay"): JobContext => ({ ...ctx(marketplace), item: { ...item, book } });

  it("ebay: fills the Language item specific", async () => {
    document.body.innerHTML = `<input name="title"><input name="attributes.Language"><input name="price">`;
    const report = await ebay.fill(bookCtx("ebay"), []);
    expect(document.querySelector<HTMLInputElement>('[name="attributes.Language"]')!.value).toBe("English");
    expect(report.filled).toContain("Language");
  }, 15_000);

  it("ebay: asks for it when the form has no Language field", async () => {
    document.body.innerHTML = `<input name="title"><input name="price">`;
    const report = await ebay.fill(bookCtx("ebay"), []);
    expect(report.manual).toContainEqual({ field: "Language", value: "English" });
  }, 15_000);

  it("vinted: asks for it until a book category shows the Language field", async () => {
    document.body.innerHTML = `<input id="title"><textarea id="description"></textarea><input id="price">`;
    const report = await vinted.fill(bookCtx("vinted"), []);
    expect(report.manual).toContainEqual({ field: "Language", value: "English" });
  }, 15_000);

  it("leaves it out for items that aren't books", async () => {
    document.body.innerHTML = `<input name="title"><input name="attributes.Language"><input name="price">`;
    const report = await ebay.fill(ctx("ebay"), []);
    expect(document.querySelector<HTMLInputElement>('[name="attributes.Language"]')!.value).toBe("");
    expect([...report.filled, ...report.manual.map((m) => m.field)]).not.toContain("Language");
  }, 15_000);
});

describe("cross-delisting", () => {
  const setUrl = (url: string) => (window as unknown as { happyDOM: { setURL(u: string): void } }).happyDOM.setURL(url);
  const listed = (marketplace: "vinted" | "ebay", externalId: string, url: string): JobContext => {
    const c = ctx(marketplace);
    const listing = { ...c.item.listings[0], marketplace, status: "ending", externalId, url } as ItemWithListings["listings"][number];
    return { ...c, job: { ...c.job, kind: "delist" }, item: { ...c.item, listings: [listing] } };
  };
  afterEach(() => {
    vi.restoreAllMocks();
    setUrl("http://localhost:3000/");
  });

  it("vinted: opens the delete dialog and checks the item is gone", async () => {
    const job = listed("vinted", "123", "https://www.vinted.co.uk/items/123-levis");
    setUrl("https://www.vinted.co.uk/items/123-levis");
    document.body.innerHTML = `<button>Edit listing</button><button data-testid="item-delete-button">Delete</button>`;
    document.querySelector('[data-testid="item-delete-button"]')!.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `<div role="dialog"><button>Cancel</button><button>Confirm and delete</button></div>`);
    });
    expect(await vinted.delist.step(job)).toMatch(/Press “Confirm and delete”/);

    // Still on the item page: not done. Elsewhere and the item 404s: done.
    expect(await vinted.delist.isDone(job, new URL("https://www.vinted.co.uk/items/123-levis"), document)).toBe(false);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    expect(await vinted.delist.isDone(job, new URL("https://www.vinted.co.uk/member/42"), document)).toBe(true);
    expect(String(fetch.mock.calls[0]![0])).toBe("/items/123-levis");
  });

  it("vinted: not done if the item page still loads", async () => {
    const job = listed("vinted", "123", "https://www.vinted.co.uk/items/123-levis");
    const res = new Response("<html></html>", { status: 200 });
    Object.defineProperty(res, "url", { value: "https://www.vinted.co.uk/items/123-levis" });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
    expect(await vinted.delist.isDone(job, new URL("https://www.vinted.co.uk/member/42"), document)).toBe(false);
  });

  it("ebay: follows End listing, picks a reason, and spots the ended page", async () => {
    const job = listed("ebay", "326112233445", "https://www.ebay.co.uk/itm/326112233445");
    setUrl("https://www.ebay.co.uk/itm/326112233445");
    let opened = false;
    document.body.innerHTML = `<a href="#end">End listing</a>`;
    document.querySelector("a")!.addEventListener("click", (e) => {
      e.preventDefault();
      opened = true;
    });
    expect(await ebay.delist.step(job)).toMatch(/Opening/);
    expect(opened).toBe(true);

    document.body.innerHTML = `<h1>End your listing</h1><p>Why are you ending this listing?</p>
      <label><input type="radio" name="reason" value="lost">The item was lost or broken</label>
      <label><input type="radio" name="reason" value="na">The item is no longer available for sale</label>
      <button>End listing</button>`;
    expect(await ebay.delist.step(job)).toMatch(/Press “End listing”/);
    expect(document.querySelector<HTMLInputElement>("input:checked")?.value).toBe("na");

    document.body.innerHTML = `<h1>Your listing has been ended</h1>`;
    expect(await ebay.delist.isDone(job, new URL("https://www.ebay.co.uk/sh/lst/ended"), document)).toBe(true);
  });

  // Relist cleanup: the item's listing already points at the new one; the old one is the target.
  const cleanup = (marketplace: "vinted" | "ebay", oldId: string, oldUrl: string, newId: string, newUrl: string): JobContext => {
    const c = listed(marketplace, newId, newUrl);
    c.item.listings[0]!.status = "listed";
    return { ...c, job: { ...c.job, kind: "cleanup", target: { externalId: oldId, url: oldUrl } } };
  };

  it("vinted relist: deletes the old listing, not the new one", async () => {
    const job = cleanup("vinted", "123", "https://www.vinted.co.uk/items/123-levis", "456", "https://www.vinted.co.uk/items/456-levis");
    setUrl("https://www.vinted.co.uk/items/456-levis");
    document.body.innerHTML = `<button>Delete</button>`;
    expect(await vinted.delist.step(job)).toMatch(/^Open the listing \(https:\/\/www\.vinted\.co\.uk\/items\/123-levis\)/);

    setUrl("https://www.vinted.co.uk/items/123-levis");
    document.body.innerHTML = `<button>Delete</button>`;
    document.querySelector("button")!.addEventListener("click", () => {
      document.body.insertAdjacentHTML("beforeend", `<div role="dialog"><button>Confirm and delete</button></div>`);
    });
    expect(await vinted.delist.step(job)).toMatch(/Press “Confirm and delete”/);
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 404 }));
    expect(await vinted.delist.isDone(job, new URL("https://www.vinted.co.uk/member/42"), document)).toBe(true);
    expect(String(fetch.mock.calls[0]![0])).toBe("/items/123-levis");
  });

  it("ebay relist: ends the old item number", async () => {
    const job = cleanup("ebay", "111111111111", "https://www.ebay.co.uk/itm/111111111111", "222222222222", "https://www.ebay.co.uk/itm/222222222222");
    document.body.innerHTML = `<h1>Seller Hub</h1>`;
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(`<html><body><p>This listing was ended by the seller.</p></body></html>`));
    expect(await ebay.delist.isDone(job, new URL("https://www.ebay.co.uk/sh/lst/active"), document)).toBe(true);
    expect(String(fetch.mock.calls[0]![0])).toBe("/itm/111111111111");
  });

  it("ebay: ignores 'ended' text that only appears in scripts", async () => {
    const job = listed("ebay", "326112233445", "https://www.ebay.co.uk/itm/326112233445");
    document.body.innerHTML = `<h1>Seller Hub</h1>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(`<html><body><h1>Levi's 501</h1><script>var t = "This listing has ended";</script></body></html>`),
    );
    expect(await ebay.delist.isDone(job, new URL("https://www.ebay.co.uk/sh/lst/active"), document)).toBe(false);
  });
});
