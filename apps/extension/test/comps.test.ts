// @vitest-environment-options {"url": "https://www.ebay.co.uk/sch/i.html?_nkw=hobbit"}
import { describe, expect, it } from "vitest";
import { parseEbayResults, parseVintedResults, soldDate } from "../src/lib/comps";

// Approximations of the results pages (both eBay layouts), not captures; see PRICING.md §10.
const parse = (html: string, url: string) => {
  const doc = new DOMParser().parseFromString(`<base href="${url}">${html}`, "text/html");
  return doc;
};

describe("sold dates", () => {
  it("reads eBay's sold captions", () => {
    expect(soldDate("Sold  12 Oct 2026")).toBe(Date.UTC(2026, 9, 12));
    expect(soldDate("Sold 3 Sept 2026 · Pre-owned")).toBe(Date.UTC(2026, 8, 3));
    expect(soldDate("Ended 3 Oct 2026")).toBeNull();
    expect(soldDate("The Hobbit 1937Sold  28 Oct 2026")).toBe(Date.UTC(2026, 9, 28));
    expect(soldDate("Unsold 3 Oct 2026")).toBeNull();
  });
});

describe("eBay results", () => {
  const sItem = (id: string, title: string, price: string, extra = "") => `
    <li class="s-item">
      <div class="s-item__image"><a href="https://www.ebay.co.uk/itm/${id}"><img src="https://i.ebayimg.com/images/g/${id}/s-l225.jpg"></a></div>
      <div class="s-item__info">
        <div class="s-item__caption--signal"><span>Sold  12 Oct 2026</span></div>
        <a class="s-item__link" href="https://www.ebay.co.uk/itm/${id}?hash=x"><div class="s-item__title"><span>${title}</span></div></a>
        <div class="s-item__subtitle"><span class="SECONDARY_INFO">Pre-owned</span></div>
        <span class="s-item__price">${price}</span>
        <span class="s-item__shipping">+£3.20 postage</span>
        ${extra}
      </div>
    </li>`;

  it("reads sold results, skipping placeholders, best offers, ranges and the 'fewer words' section", () => {
    const doc = parse(
      `<ul class="srp-results">
        ${sItem("100000001", "Shop on eBay", "£20.00")}
        ${sItem("100000002", "<span>New listing</span>The Hobbit Tolkien 1937 First Edition", "£9,500.00")}
        ${sItem("100000003", "The Hobbit hardback 1951", '<span class="STRIKETHROUGH">£120.00</span>')}
        ${sItem("100000004", "The Hobbit (choose your edition)", "£5.00 to £9.00")}
        ${sItem("100000005", "The Hobbit Tolkien 1966 hardback", "£45.50")}
        <li class="s-item"><a href="https://www.ebay.co.uk/itm/100000007"><div class="s-item__title"><span>The Hobbit 1937</span></div></a><span>Sold  28 Oct 2026</span><span class="s-item__price">£9,800.00</span></li>
        <li class="srp-river-answer srp-river-answer--REWRITE_START">Results matching fewer words</li>
        ${sItem("100000006", "Lord of the Rings box set", "£30.00")}
      </ul>
      <div class="carousel"><a href="https://www.ebay.co.uk/itm/100000009">Sponsored thing £1.00</a></div>`,
      "https://www.ebay.co.uk/sch/i.html?_nkw=hobbit",
    );
    const comps = parseEbayResults(doc, "ebay_sold");
    expect(comps.map((c) => [c.title, c.price, c.url])).toEqual([
      ["The Hobbit Tolkien 1937 First Edition", 950_000, "https://www.ebay.co.uk/itm/100000002"],
      ["The Hobbit Tolkien 1966 hardback", 4550, "https://www.ebay.co.uk/itm/100000005"],
      ["The Hobbit 1937", 980_000, "https://www.ebay.co.uk/itm/100000007"],
    ]);
    // Tightly packed markup (no whitespace between title and caption) still gives the date.
    expect(comps[2]!.soldAt).toBe(Date.UTC(2026, 9, 28));
    expect(comps[0]).toMatchObject({ source: "ebay_sold", soldAt: Date.UTC(2026, 9, 12), condition: "Pre-owned" });
    expect(comps[0]!.imageUrl).toContain("i.ebayimg.com");
    // Listed searches don't carry sold dates.
    expect(parseEbayResults(doc, "ebay_listed")[0]!.soldAt).toBeNull();
  });

  it("reads the newer s-card layout", () => {
    const doc = parse(
      `<ul class="srp-results">
        <li class="s-card"><a class="su-link" href="https://www.ebay.co.uk/itm/200000001">
          <div class="s-card__title"><span>Levi's 501 Jeans W32 L30</span><span>Opens in a new window or tab</span></div></a>
          <div class="s-card__subtitle">Pre-owned · Levi's</div>
          <span class="s-card__caption">Sold 1 Nov 2026</span>
          <span class="s-card__price">£22.00</span></li>
      </ul>`,
      "https://www.ebay.co.uk/sch/i.html?_nkw=levis",
    );
    expect(parseEbayResults(doc, "ebay_sold")).toEqual([
      expect.objectContaining({ title: "Levi's 501 Jeans W32 L30", price: 2200, soldAt: Date.UTC(2026, 10, 1), condition: "Pre-owned · Levi's" }),
    ]);
  });
});

describe("Vinted results", () => {
  it("reads brand, size, condition and the item price (not the buyer protection total)", () => {
    const card = (id: number, alt: string) => `
      <div class="feed-grid__item"><div data-testid="product-item-id-${id}">
        <img src="https://images1.vinted.net/t/p${id}/310x430/1.jpeg" alt="${alt}">
        <a href="https://www.vinted.co.uk/items/${id}-thing" title="${alt}"></a>
        <p>${alt.match(/£[\d.]+/)?.[0]}</p></div></div>`;
    const doc = parse(
      `<div class="feed-grid">
        ${card(1, "501 jeans, brand: Levi's, condition: Very good, size: W32, £18.00, £19.60 includes Buyer Protection")}
        ${card(2, "Levi's 501 W34, brand: Levi's, condition: Good, size: W34, £15.00, £16.45 includes Buyer Protection")}
      </div>`,
      "https://www.vinted.co.uk/catalog?search_text=levis+501",
    );
    expect(parseVintedResults(doc)).toEqual([
      expect.objectContaining({ source: "vinted_listed", title: "Levi's 501 jeans", price: 1800, size: "W32", condition: "Very good", url: "https://www.vinted.co.uk/items/1-thing" }),
      expect.objectContaining({ title: "Levi's 501 W34", price: 1500, size: "W34", condition: "Good" }),
    ]);
  });
});
