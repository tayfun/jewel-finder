// @vitest-environment-options {"url": "https://www.vinted.co.uk/member/42-me"}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ebay, ebayImporter } from "../src/content/ebay";
import { vinted, vintedImporter } from "../src/content/vinted";
import { ImportPanel } from "../src/lib/importer";
import { isDescriptionHost, isPhotoHost, toImportListing } from "../src/lib/import-item";
import type { ImportIO } from "../src/lib/runner";
import { findListingCards, htmlToText } from "../src/lib/scrape";
import type { Request, ScrapedListing } from "../src/messages";

// Approximations of the marketplaces' pages, not captures: the readers try several strategies
// (JSON-LD, meta tags, test ids, label/value pairs), and these exercise each of them.

const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
const noIO: ImportIO = { fetchText: () => Promise.reject(new Error("no network")) };

afterEach(() => {
  document.body.innerHTML = "";
  document.getElementById("jewel-finder-import")?.remove();
  vi.unstubAllGlobals();
});

const wardrobe = (ids: number[]) => `
  <header><a href="/member/42-me"><img alt="me"></a></header>
  <h1>me</h1>
  <div class="feed-grid">
    ${ids
      .map(
        (id) => `
      <div class="feed-grid__item">
        <div class="new-item-box__container" data-testid="product-item-id-${id}">
          <div class="new-item-box__image-container">
            <img src="https://images1.vinted.net/t/ph${id}/310x430/1.webp?s=x" alt="Hoodie ${id}, brand: Nike, condition: Good, size: M, £1${id}.00">
            <a class="new-item-box__overlay" href="/items/${id}-hoodie-${id}?referrer=wardrobe" title="Hoodie ${id}, brand: Nike, condition: Good, size: M, £1${id}.00"></a>
          </div>
          <p data-testid="product-item-id-${id}--price-text">£1${id}.00</p>
        </div>
      </div>`,
      )
      .join("")}
  </div>
  <a href="/items/new">Sell now</a>`;

describe("finding listings on a page", () => {
  it("turns each listing on a Vinted wardrobe into one card", () => {
    const doc = parse(wardrobe([1, 2, 3]));
    const cards = findListingCards("vinted", doc.body);
    expect(cards.map((c) => [c.externalId, c.title, c.price])).toEqual([
      ["1", "Hoodie 1", "£11.00"],
      ["2", "Hoodie 2", "£12.00"],
      ["3", "Hoodie 3", "£13.00"],
    ]);
    expect(cards[0]!.url).toBe("https://www.vinted.co.uk/items/1-hoodie-1");
    expect(cards[0]!.thumb).toContain("/t/ph1/");
    expect(cards[0]!.element.classList.contains("feed-grid__item")).toBe(true);
  });

  it("reads Seller Hub's table rows", () => {
    const doc = parse(`
      <table><tbody>
        <tr><td><img src="https://i.ebayimg.com/images/g/AAA/s-l140.jpg"></td>
            <td><a href="https://www.ebay.co.uk/itm/326112233445">Levi's 501 jeans W32</a><div>Item number 326112233445</div></td>
            <td>£25.00</td><td><a href="https://www.ebay.co.uk/lstng?itemId=326112233445&mode=ReviseItem">Edit</a></td></tr>
        <tr><td><img src="https://i.ebayimg.com/images/g/BBB/s-l140.jpg"></td>
            <td><a href="https://www.ebay.co.uk/itm/326112233446?hash=x">Penguin first edition</a></td><td>£80.00</td></tr>
      </tbody></table>`);
    const cards = findListingCards("ebay", doc.body);
    expect(cards.map((c) => [c.externalId, c.title, c.price, c.element.tagName])).toEqual([
      ["326112233445", "Levi's 501 jeans W32", "£25.00", "TR"],
      ["326112233446", "Penguin first edition", "£80.00", "TR"],
    ]);
  });
});

describe("vinted import", () => {
  it("knows the seller's own wardrobe", () => {
    const doc = parse(wardrobe([1]));
    expect(vintedImporter.isOwnListings(new URL("https://www.vinted.co.uk/member/42-me"), doc)).toBe(true);
    expect(vintedImporter.isOwnListings(new URL("https://www.vinted.co.uk/member/7-someone"), doc)).toBe(false);
    expect(vintedImporter.listingsLink(new URL("https://www.vinted.co.uk/"), doc)?.href).toMatch(/\/member\/42-me$/);
    expect(vintedImporter.listingsLink(new URL("https://www.vinted.co.uk/member/42-me"), doc)).toBeNull();
  });

  it("reads a listing page from JSON-LD and the details table", async () => {
    const doc = parse(`
      <script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: "Nike hoodie",
        description: "Warm.\nWorn twice.",
        brand: { "@type": "Brand", name: "Nike" },
        image: ["https://images1.vinted.net/t/ph1/f800/1.jpeg?s=a", "https://images1.vinted.net/t/ph2/f800/2.jpeg?s=b"],
        offers: { "@type": "Offer", price: "12.50", priceCurrency: "GBP", availability: "https://schema.org/InStock" },
      })}</script>
      <script type="application/ld+json">${JSON.stringify({
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home" },
          { "@type": "ListItem", position: 2, name: "Men" },
          { "@type": "ListItem", position: 3, name: "Hoodies & sweatshirts" },
          { "@type": "ListItem", position: 4, name: "Nike hoodie" },
        ],
      })}</script>
      <div data-testid="item-photo-1"><img src="https://images1.vinted.net/t/ph1/310x430/1.jpeg?s=c"></div>
      <div data-testid="item-photo-3"><img src="https://images1.vinted.net/t/ph3/310x430/3.jpeg?s=d"></div>
      <div class="details-list">
        <div data-testid="item-attributes-size"><div>Size</div><div><span itemprop="size">M</span></div></div>
        <div data-testid="item-attributes-status"><div>Condition</div><div><span itemprop="status">Very good</span></div></div>
        <div class="details-list__item"><div class="details-list__item-title">Colour</div><div class="details-list__item-value">Grey</div></div>
      </div>`);
    const listing = await vintedImporter.parse(doc, "https://www.vinted.co.uk/items/1-nike-hoodie", noIO);
    expect(listing).toEqual({
      state: "listed",
      title: "Nike hoodie",
      description: "Warm.\nWorn twice.",
      price: 1250,
      brand: "Nike",
      size: "M",
      colour: "Grey",
      condition: "very_good",
      category: "Men › Hoodies & sweatshirts",
      photos: [
        "https://images1.vinted.net/t/ph1/f800/1.jpeg?s=a",
        "https://images1.vinted.net/t/ph2/f800/2.jpeg?s=b",
        "https://images1.vinted.net/t/ph3/310x430/3.jpeg?s=d",
      ],
    });
  });

  it("falls back to meta tags and marks sold items", async () => {
    const doc = parse(`
      <head>
        <meta property="og:title" content="Zara dress | Vinted">
        <meta property="og:description" content="Summer dress">
        <meta property="og:image" content="https://images1.vinted.net/t/ph9/f800/9.jpeg?s=z">
        <meta property="product:price:amount" content="8.00">
      </head>
      <body><div data-testid="item-status--sold">Sold</div><dl><dt>Brand</dt><dd>Zara</dd><dt>Condition</dt><dd>New with tags</dd></dl></body>`);
    const listing = await vintedImporter.parse(doc, "https://www.vinted.co.uk/items/9-zara-dress", noIO);
    expect(listing).toMatchObject({
      state: "sold",
      title: "Zara dress",
      description: "Summer dress",
      price: 800,
      brand: "Zara",
      condition: "new_with_tags",
      photos: ["https://images1.vinted.net/t/ph9/f800/9.jpeg?s=z"],
    });
  });
});

describe("ebay import", () => {
  it("only trusts Seller Hub and My eBay as your own listings", () => {
    expect(ebayImporter.isOwnListings(new URL("https://www.ebay.co.uk/sh/lst/active"), document)).toBe(true);
    expect(ebayImporter.isOwnListings(new URL("https://www.ebay.co.uk/str/someshop"), document)).toBe(false);
    expect(ebayImporter.listingsLink(new URL("https://www.ebay.co.uk/"), document)?.href).toBe("/sh/lst/active");
  });

  it("reads an item page, with the description from its iframe", async () => {
    const doc = parse(`
      <script type="application/ld+json">${JSON.stringify({
        "@type": "Product",
        name: "Levi's 501 W32 L30",
        image: ["https://i.ebayimg.com/images/g/AAA/s-l500.jpg", "https://i.ebayimg.com/images/g/BBB/s-l500.jpg"],
        offers: { "@type": "Offer", price: "25.0", priceCurrency: "GBP", itemCondition: "https://schema.org/UsedCondition" },
      })}</script>
      <nav class="breadcrumbs"><a>eBay</a><a>Clothes, Shoes &amp; Accessories</a><a>Men's Jeans</a></nav>
      <h1 class="x-item-title__mainTitle"><span class="ux-textspans">Levi's 501 straight jeans W32 L30</span></h1>
      <div class="x-item-condition-text"><span class="ux-textspans">Pre-owned - Excellent</span><span class="ux-textspans">“Barely worn, very good”</span></div>
      <div class="ux-image-carousel-item"><img data-zoom-src="https://i.ebayimg.com/images/g/AAA/s-l1600.jpg" src="https://i.ebayimg.com/images/g/AAA/s-l140.jpg"></div>
      <div class="ux-image-carousel-item"><img src="https://i.ebayimg.com/images/g/CCC/s-l140.webp"></div>
      <div class="ux-layout-section-evo">
        <div class="ux-labels-values"><div class="ux-labels-values__labels">Brand</div><div class="ux-labels-values__values">Levi's</div></div>
        <div class="ux-labels-values"><div class="ux-labels-values__labels">Size (Men's)</div><div class="ux-labels-values__values">W32</div></div>
        <div class="ux-labels-values"><div class="ux-labels-values__labels">Colour</div><div class="ux-labels-values__values">Blue</div></div>
      </div>
      <iframe id="desc_ifr" src="https://itm.ebaydesc.com/itmdesc/326112233445?t=1"></iframe>`);
    const fetchText = vi.fn(async () => `<html><body><div id="ds_div"><p>Classic fit.</p><p>Worn twice.<br>Smoke-free home.</p><script>x()</script></div></body></html>`);
    const listing = await ebayImporter.parse(doc, "https://www.ebay.co.uk/itm/326112233445", { fetchText });
    expect(fetchText).toHaveBeenCalledWith("https://itm.ebaydesc.com/itmdesc/326112233445?t=1");
    expect(listing).toEqual({
      state: "listed",
      title: "Levi's 501 straight jeans W32 L30",
      description: "Classic fit.\n\nWorn twice.\nSmoke-free home.",
      price: 2500,
      brand: "Levi's",
      size: "W32",
      colour: "Blue",
      condition: "very_good",
      category: "Clothes, Shoes & Accessories › Men's Jeans",
      photos: [
        "https://i.ebayimg.com/images/g/AAA/s-l1600.jpg",
        "https://i.ebayimg.com/images/g/BBB/s-l1600.jpg",
        "https://i.ebayimg.com/images/g/CCC/s-l1600.webp",
      ],
    });
  });

  it("notices ended and sold listings, and survives a missing description", async () => {
    const ended = parse(`<h1>Old lamp</h1><div class="d-statusmessage">This listing was ended by the seller because the item is no longer available.</div>`);
    expect((await ebayImporter.parse(ended, "https://www.ebay.co.uk/itm/111111111", noIO)).state).toBe("ended");
    const sold = parse(`<h1>Old lamp</h1><div class="d-statusmessage">This listing sold on Tue, 12 Mar at 9:00.</div>`);
    const listing = await ebayImporter.parse(sold, "https://www.ebay.co.uk/itm/111111111", noIO);
    expect(listing).toMatchObject({ state: "sold", title: "Old lamp", description: "" });
  });
});

describe("turning a scraped listing into an import", () => {
  const scraped: ScrapedListing = {
    externalId: "1",
    url: "https://www.vinted.co.uk/items/1",
    state: "listed",
    title: "  " + "x".repeat(200),
    description: "d",
    price: 1250,
    brand: "b".repeat(100),
    size: "M",
    colour: "",
    condition: null,
    category: "",
    photos: [],
  };

  it("fits the API's limits and sets stock from the listing's state", () => {
    const listing = toImportListing("vinted", scraped, ["u/me/1.jpg"]);
    expect(listing.item.title).toHaveLength(120);
    expect(listing.item.brand).toHaveLength(80);
    expect(listing.item).toMatchObject({ status: "in_stock", quantity: 1, price: 1250, images: ["u/me/1.jpg"] });
    expect(toImportListing("ebay", { ...scraped, title: "", state: "sold", price: -5 }, []).item).toMatchObject({
      title: "eBay listing 1",
      status: "sold",
      quantity: 0,
      price: null,
    });
  });

  it("only downloads from the marketplaces' own CDNs", () => {
    expect(isPhotoHost("https://images1.vinted.net/t/x/f800/1.jpeg")).toBe(true);
    expect(isPhotoHost("https://i.ebayimg.com/images/g/x/s-l1600.jpg")).toBe(true);
    expect(isPhotoHost("http://i.ebayimg.com/x.jpg")).toBe(false);
    expect(isPhotoHost("https://evil.example/vinted.net/x.jpg")).toBe(false);
    expect(isPhotoHost("https://vinted.net.evil.example/x.jpg")).toBe(false);
    expect(isDescriptionHost("https://vi.vipr.ebaydesc.com/ws/eBayISAPI.dll?ViewItemDescV4&item=1")).toBe(true);
    expect(isDescriptionHost("https://example.com/ebaydesc.com")).toBe(false);
  });

  it("converts description HTML to text", () => {
    const doc = parse(`<div><h2>Details</h2><ul><li>One</li><li>Two</li></ul><p>Bye &amp; thanks</p></div>`);
    expect(htmlToText(doc.body)).toBe("Details\n\n• One\n\n• Two\n\nBye & thanks");
  });
});

describe("import panel", () => {
  let sent: Request[];
  let known: Record<string, string>;

  beforeEach(() => {
    sent = [];
    known = { "2": "item-2" };
    vi.stubGlobal("chrome", {
      runtime: {
        id: "test",
        sendMessage: vi.fn(async (req: Request) => {
          sent.push(req);
          if (req.type === "IMPORT_KNOWN") return { ok: true, data: known };
          if (req.type === "IMPORT_LISTING") return { ok: true, data: { itemId: `item-${req.listing.externalId}`, created: true, photos: req.listing.photos.length } };
          return { ok: true, data: null };
        }),
      },
    });
    // Listing pages: item 3 is gone.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/items/3")
          ? new Response("gone", { status: 404 })
          : new Response(`<script type="application/ld+json">{"@type":"Product","name":"Full title","offers":{"price":"20"},"image":"https://images1.vinted.net/t/big/f800/1.jpeg"}</script>`),
      ),
    );
  });

  const rows = (panel: ImportPanel) => [...panel.root.querySelectorAll<HTMLLIElement>("ul.cards li")];
  const button = (panel: ImportPanel, text: RegExp) =>
    [...panel.root.querySelectorAll<HTMLButtonElement>("button")].find((b) => text.test(b.textContent ?? ""))!;
  const selectAll = (panel: ImportPanel) => panel.root.querySelector<HTMLInputElement>(".bar input[type=checkbox]")!;

  it("picks listings one by one or all on the page, and imports them", async () => {
    document.body.innerHTML = wardrobe([1, 2, 3, 4]);
    const panel = new ImportPanel(vinted, noIO);
    await panel.init();

    expect(rows(panel).map((r) => r.dataset.id)).toEqual(["1", "2", "3", "4"]);
    // Already in the inventory: marked, can't be picked.
    const already = rows(panel)[1]!;
    expect(already.textContent).toContain("In Jewel Finder");
    expect(already.querySelector("input")!.disabled).toBe(true);
    expect(button(panel, /pick listings/i).disabled).toBe(true);

    // One by one: clicking a row toggles it.
    rows(panel)[0]!.click();
    expect(button(panel, /^import/i).textContent).toBe("Import 1 listing");
    expect(selectAll(panel).indeterminate).toBe(true);

    // All on the page (the 3 that aren't imported yet), then untick one.
    selectAll(panel).click();
    expect(button(panel, /^import/i).textContent).toBe("Import 3 listings");
    expect(selectAll(panel).checked).toBe(true);
    rows(panel)[3]!.querySelector("input")!.click();
    expect(button(panel, /^import/i).textContent).toBe("Import 2 listings");

    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const done = panel.importSelected();
    await vi.runAllTimersAsync();
    await done;
    vi.useRealTimers();

    const imports = sent.filter((r) => r.type === "IMPORT_LISTING");
    expect(imports).toHaveLength(1);
    expect(imports[0]).toMatchObject({
      marketplace: "vinted",
      listing: { externalId: "1", title: "Full title", price: 2000, photos: ["https://images1.vinted.net/t/big/f800/1.jpeg"] },
    });
    const summary = panel.root.querySelector(".footer")!.textContent!;
    expect(summary).toContain("Imported 1 · 1 failed");
    expect(summary).toContain("Hoodie 3: This listing no longer exists");
    expect(rows(panel)[0]!.textContent).toContain("In Jewel Finder");
    panel.close();
  });

  it("points to the seller's listings when the page has none", async () => {
    history.replaceState(null, "", "/");
    document.body.innerHTML = `<header><a href="/member/42-me">me</a></header><p>Home page</p>`;
    const panel = new ImportPanel(vinted, noIO);
    await panel.init();
    expect(panel.root.textContent).toContain("Open your Vinted profile");
    expect(panel.root.querySelector<HTMLAnchorElement>("a.button")?.textContent).toBe("Open my wardrobe");
    panel.close();
    history.replaceState(null, "", "/member/42-me");
    expect(sent.at(-1)?.type).toBe("IMPORT_STOP");
  });

  it("works on eBay too", async () => {
    document.body.innerHTML = `<table><tr><td><a href="https://www.ebay.co.uk/itm/326112233445">Jeans</a></td><td>£25.00</td></tr></table>`;
    const panel = new ImportPanel(ebay, noIO);
    await panel.init();
    expect(rows(panel).map((r) => r.textContent)).toEqual(["Jeans£25.00"]);
    panel.close();
  });
});
