import { describe, expect, it } from "vitest";
import { LinkUnreachable, resolveListingLink } from "../src/links";

// A stand-in for eBay: maps URLs to responses, and records what was fetched.
function fakeFetch(routes: Record<string, () => Response>) {
  const seen: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    const route = routes[url];
    return route ? route() : new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, seen };
}
const redirect = (to: string, status = 301) => () => new Response(null, { status, headers: { Location: to } });

describe("resolving share links", () => {
  it("follows an eBay app short link to the listing, dropping tracking parameters", async () => {
    // As captured from https://ebay.io/m/KSqSFz.
    const { fetcher } = fakeFetch({
      "https://ebay.io/m/KSqSFz": redirect(
        "https://www.ebay.co.uk/itm/820325294563?var=&mkevt=1&mkcid=16&mkrid=711-127632-2357-0&sssrc=4429486&ssuid=A5JxIiDvTse&ssspo=A5JxIiDvTse&stype=1&widget_ver=artemis&media=COPY",
      ),
    });
    expect(await resolveListingLink("https://ebay.io/m/KSqSFz", fetcher)).toEqual({
      marketplace: "ebay",
      externalId: "820325294563",
      url: "https://www.ebay.co.uk/itm/820325294563",
    });
  });

  it("follows several hops, and reads a page that points on", async () => {
    const { fetcher } = fakeFetch({
      "https://ebay.us/abc": redirect("https://www.ebay.co.uk/rover/1/x", 302),
      "https://www.ebay.co.uk/rover/1/x": () =>
        new Response(`<html><head><link rel="canonical" href="https://www.ebay.co.uk/itm/Levis-501/326112233445"></head></html>`),
    });
    expect(await resolveListingLink("https://ebay.us/abc", fetcher)).toMatchObject({ externalId: "326112233445" });
  });

  it("takes full listing links as they are, without fetching", async () => {
    const { fetcher, seen } = fakeFetch({});
    expect(await resolveListingLink("https://www.vinted.co.uk/items/4821337-levis?referrer=share", fetcher)).toEqual({
      marketplace: "vinted",
      externalId: "4821337",
      url: "https://www.vinted.co.uk/items/4821337-levis",
    });
    expect(seen).toEqual([]);
  });

  it("won't fetch other sites or follow redirects off eBay and Vinted", async () => {
    const { fetcher, seen } = fakeFetch({ "https://ebay.io/m/evil": redirect("https://internal.example/admin") });
    expect(await resolveListingLink("https://example.com/m/x", fetcher)).toBeNull();
    expect(await resolveListingLink("http://ebay.io/m/x", fetcher)).toBeNull();
    expect(await resolveListingLink("https://ebay.io/m/evil", fetcher)).toBeNull();
    expect(seen).toEqual(["https://ebay.io/m/evil"]);
  });

  it("says when eBay can't be reached, rather than that the link is wrong", async () => {
    const offline = (async () => {
      throw new TypeError("network down");
    }) as typeof fetch;
    await expect(resolveListingLink("https://ebay.io/m/KSqSFz", offline)).rejects.toThrow(LinkUnreachable);
    await expect(resolveListingLink("https://ebay.io/m/KSqSFz", offline)).rejects.toThrow("Couldn't reach ebay.io to check that link");
  });

  it("gives up on dead links and redirect loops", async () => {
    const { fetcher } = fakeFetch({
      "https://ebay.io/m/loop": redirect("https://ebay.io/m/loop"),
    });
    expect(await resolveListingLink("https://ebay.io/m/gone", fetcher)).toBeNull();
    expect(await resolveListingLink("https://ebay.io/m/loop", fetcher)).toBeNull();
  });
});
