// After `vite build`: social preview images, per-page HTML with SEO tags and crawlable text, and the
// robots.txt / sitemap.xml / llms.txt files.
//
// The Worker's asset layer answers every page with dist/index.html (single-page app), and it serves
// dist/about.html for /about on its own. So each public page gets its own HTML file here, with its own
// title, description, canonical URL, Open Graph / Twitter tags, structured data, and a plain-HTML version
// of its content inside #root. React replaces that content when it starts; crawlers and LLMs that don't
// run JavaScript read it as it is.
//
// Images are drawn with satori (layout + text as shapes, using Inter) and resvg (to PNG), so they look
// the same whichever machine builds them.
//
//   SITE_URL=https://staging.example pnpm --filter @jf/web build   # for a deployment elsewhere
import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import satori from "satori";

const SITE = (process.env.SITE_URL || "https://stockandlist.com").replace(/\/$/, "");
const web = resolve(import.meta.dirname, "..");
const dist = resolve(web, "dist");
const require = createRequire(import.meta.url);
const fontDir = resolve(dirname(require.resolve("@fontsource/inter/package.json")), "files");
const font = (weight) => readFileSync(resolve(fontDir, `inter-latin-${weight}-normal.woff`));
const FONTS = [500, 700, 800].map((weight) => ({ name: "Inter", data: font(weight), weight, style: "normal" }));
const LOGO = `data:image/svg+xml;base64,${readFileSync(resolve(web, "public/favicon.svg")).toString("base64")}`;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// --------------------------------------------------------------------------------------------- pages

const PAGES = [
  {
    path: "/",
    file: "index.html",
    slug: "home",
    title: "Stock & List: list on eBay and Vinted in two clicks, relist in one",
    description:
      "Inventory app and Chrome extension for eBay and Vinted resellers. Keep your stock in one place, list it on both sites in a couple of clicks, and bump stale listings back to the top without re-uploading by hand.",
    og: { headline: "Spend your time finding stock, not relisting it.", sub: "Inventory and cross-listing for eBay & Vinted resellers" },
    body: `
<header><a href="/">Stock &amp; List</a> · <a href="/about">About</a> · <a href="/#features">Features</a> · <a href="/#how">How it works</a> · <a href="/login">Sign in</a> · <a href="/signup">Get started</a></header>
<main>
<h1>Spend your time finding stock, not relisting it.</h1>
<p>Stock &amp; List keeps your inventory in one place and lists it on eBay and Vinted in a couple of clicks. It relists and bumps items back to the top too, so you can stop deleting and re-uploading by hand.</p>
<p>Built for eBay &amp; Vinted resellers. Zero manual re-uploads.</p>
<h2>Features</h2>
<ul>
<li><strong>Your stock, in one place:</strong> add an item once with its photos, measurements, SKU and price, or import the listings you already have on eBay and Vinted.</li>
<li><strong>Two clicks to list on eBay and Vinted:</strong> the Chrome extension fills in eBay's and Vinted's own listing forms with the title, photos, category, condition and price. You check it and press publish.</li>
<li><strong>Relist and bump to the top:</strong> stale listings get flagged; one click relists them and removes the old listing, so they're fresh again at the top of the feeds.</li>
<li><strong>Cross-delisting:</strong> when something sells, its other listings are flagged so you can end them before it sells twice.</li>
<li><strong>Price checks:</strong> compare an item against similar sold and live listings on eBay and Vinted.</li>
</ul>
<h2>How it works</h2>
<ol>
<li>Add or import your items into your Stock &amp; List inventory.</li>
<li>Press "List on Vinted" or "List on eBay": the extension opens the site's sell page and fills in the form, and you publish.</li>
<li>When a listing goes stale and sinks down the feed, relist it in one click to bring it back to the top.</li>
</ol>
<p><a href="/signup">Get started with your email</a>. Sign-up takes seconds; no business details needed.</p>
</main>`,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Stock & List",
        url: `${SITE}/`,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, Google Chrome",
        description:
          "Inventory app and Chrome extension for second-hand resellers: list items on eBay and Vinted in a couple of clicks, relist stale listings back to the top, import existing listings and check prices.",
        image: `${SITE}/og/home.png`,
        creator: { "@type": "Person", name: "Tayfun" },
      },
      { "@context": "https://schema.org", "@type": "WebSite", name: "Stock & List", url: `${SITE}/` },
    ],
  },
  {
    path: "/about",
    file: "about.html",
    slug: "about",
    title: "About Stock & List: Tayfun's story",
    description:
      "Why Stock & List exists: too much stuff, and selling it on eBay and Vinted turning into a second job. Doing everything twice, listings sinking, deleting and re-uploading by hand. So Tayfun built the tool to do the boring part.",
    og: { headline: "Hi, I'm Tayfun. I had way too much stuff.", sub: "Why Stock & List exists" },
    body: `
<header><a href="/">Stock &amp; List</a> · <a href="/#features">Features</a> · <a href="/#how">How it works</a> · <a href="/signup">Get started</a></header>
<main>
<h1>Hi, I'm Tayfun.</h1>
<h2>I had way too much "stuff" and zero clue how to start getting rid of it.</h2>
<p>A few months ago, I looked around my room and had the realisation Paul Graham wrote about in his essay <a href="https://paulgraham.com/stuff.html">"Stuff"</a>: my closet was packed with jackets I never wore, retro gadgets and spare sneakers. So I decided to sell them online, and it turned into a second, unpaid job:</p>
<ul>
<li><strong>The duplicate work trap:</strong> uploading the same 8 photos, title, measurements and price on eBay, then all over again on Vinted.</li>
<li><strong>The page-12 graveyard:</strong> if an item doesn't sell in 48 hours, it sinks to the bottom of the feed where nobody scrolls.</li>
<li><strong>The delete &amp; re-upload hamster wheel:</strong> the only way to get eyes back on an item was deleting the listing and re-uploading everything by hand.</li>
</ul>
<p>So I built Stock &amp; List to do the boring part: it keeps your inventory in one place, lists it on eBay and Vinted in two clicks, and bumps stale items back to the top.</p>
<p>Stock &amp; List isn't affiliated with or endorsed by eBay or Vinted. It works in your own browser with the accounts you're already signed in to. Your data is used only to run Stock &amp; List: see the <a href="/privacy">privacy policy</a>.</p>
</main>`,
  },
  {
    path: "/signup",
    file: "signup.html",
    slug: "signup",
    title: "Create your Stock & List account",
    description: "Up and running in seconds: all Stock & List needs is your email. List on Vinted and eBay from one place, relist without the busywork, and import the listings you already have.",
    og: { headline: "Up and running in seconds.", sub: "All we need is your email." },
    body: `<main><h1>Create your Stock &amp; List account</h1><p>All we need is your email. No business details, no shop names.</p><ul><li>List on Vinted and eBay from one place</li><li>Relist and bump to the top without the busywork</li><li>Import the listings you already have</li></ul><p><a href="/login">Already have an account? Sign in</a></p></main>`,
  },
  {
    path: "/login",
    file: "login.html",
    slug: "login",
    title: "Sign in to Stock & List",
    description: "Sign in to your Stock & List inventory.",
    og: { headline: "Welcome back.", sub: "Sign in to your inventory." },
    noindex: true,
    body: `<main><h1>Sign in to Stock &amp; List</h1><p>New here? <a href="/signup">Create an account</a>.</p></main>`,
  },
  {
    path: "/privacy",
    file: "privacy.html",
    slug: "privacy",
    title: "Privacy policy: Stock & List",
    description:
      "What Stock & List collects, why, and who else handles it: your account and inventory, what the Chrome extension reads on Vinted and eBay, and when item details go to Google's Gemini API. No ads, no selling your data.",
    og: { headline: "Privacy policy", sub: "What we collect, why, and who else handles it." },
    body: `
<main>
<h1>Privacy policy</h1>
<p>Stock &amp; List helps resellers keep their inventory in one place and list it on Vinted and eBay. We don't sell your data, show ads, or track you across other websites.</p>
<ul>
<li>We store your email address, a salted hash of your password, and the inventory you add or import (items, photos, settings and the listings you link to them).</li>
<li>The Chrome extension only runs on Vinted, eBay and the Stock &amp; List site. It fills in listing forms, reads the address of listings you publish, reads comparable listings for price checks, and copies listings you choose to import.</li>
<li>When you ask for an AI suggestion or a price check, item details and up to two photos are sent to Google's Gemini API.</li>
</ul>
<p>The full policy loads on this page.</p>
</main>`,
  },
];

// --------------------------------------------------------------------------------------------- images

const h = (type, style, ...children) => ({ type, props: { style, children: children.length === 1 ? children[0] : children } });

function ogTree({ headline, sub }) {
  const card = (bg, rotate, label, front) =>
    h(
      "div",
      {
        position: "absolute", left: -10, top: 40, width: 210, height: 290, display: "flex", flexDirection: "column", gap: 14,
        padding: 18, borderRadius: 24, background: bg, transform: `rotate(${rotate}deg)`, transformOrigin: "50% 100%",
        boxShadow: "0 24px 48px rgba(0,0,0,0.35)",
      },
      h("div", { height: 118, borderRadius: 14, background: "rgba(255,255,255,0.92)", display: "flex" }),
      h("div", { height: 16, borderRadius: 8, background: "rgba(255,255,255,0.85)", display: "flex" }),
      h("div", { height: 16, width: "62%", borderRadius: 8, background: "rgba(255,255,255,0.7)", display: "flex" }),
      // The back cards only show their right-hand side, so their labels sit at the top right.
      h(
        "div",
        front
          ? { marginTop: "auto", alignSelf: "flex-start", padding: "4px 14px", borderRadius: 99, background: "rgba(255,255,255,0.92)", color: "#14181a", fontSize: 20, fontWeight: 800 }
          : { position: "absolute", top: 14, right: 14, padding: "4px 14px", borderRadius: 99, background: "#14181a", color: "#fff", fontSize: 20, fontWeight: 800 },
        label,
      ),
    );
  return h(
    "div",
    {
      width: 1200, height: 630, display: "flex", padding: "60px 64px", fontFamily: "Inter", color: "#effdf9",
      backgroundColor: "#08332f",
      backgroundImage:
        "radial-gradient(circle at 12% 10%, rgba(52,211,184,0.55), transparent 45%), radial-gradient(circle at 95% 15%, rgba(255,107,87,0.40), transparent 40%), radial-gradient(circle at 90% 100%, rgba(255,197,61,0.30), transparent 45%), linear-gradient(150deg, #0b6a5e, #08332f)",
    },
    h(
      "div",
      { display: "flex", flexDirection: "column", justifyContent: "space-between", width: 650, height: 510 },
      h(
        "div",
        { display: "flex", alignItems: "center", gap: 18 },
        { type: "img", props: { src: LOGO, width: 76, height: 76, style: { borderRadius: 20 } } },
        h(
          "div",
          { display: "flex", fontSize: 44, fontWeight: 800, letterSpacing: -1.5 },
          "Stock",
          h("span", { color: "#ff8a78", margin: "0 10px" }, "&"),
          "List",
        ),
      ),
      h(
        "div",
        { display: "flex", flexDirection: "column", gap: 20 },
        h("div", { display: "flex", fontSize: headline.length > 34 ? 58 : 70, fontWeight: 800, lineHeight: 1.06, letterSpacing: -2.2 }, headline),
        h("div", { display: "flex", fontSize: 28, fontWeight: 500, lineHeight: 1.3, color: "rgba(239,253,249,0.85)" }, sub),
      ),
      h(
        "div",
        { display: "flex", alignItems: "center", gap: 12, fontSize: 24, fontWeight: 700, color: "rgba(239,253,249,0.75)" },
        h("div", { width: 12, height: 12, borderRadius: 6, background: "#34d3b8", display: "flex" }),
        "stockandlist.com",
      ),
    ),
    h(
      "div",
      { display: "flex", position: "relative", width: 422, flexShrink: 0, alignItems: "center", paddingLeft: 40 },
      h(
        "div",
        { display: "flex", position: "relative", width: 360, height: 400, marginTop: -40 },
        card("#b9a2ff", 40, "eBay", false),
        card("#ffc53d", 20, "Vinted", false),
        card("#ff6b57", 0, "Your stock", true),
      ),
    ),
  );
}

async function ogImage(page) {
  const svg = await satori(ogTree(page.og), { width: 1200, height: 630, fonts: FONTS });
  return new Resvg(svg, { fitTo: { mode: "width", value: 1200 } }).render().asPng();
}

// --------------------------------------------------------------------------------------------- html

function headTags(page) {
  const url = `${SITE}${page.path}`;
  const image = `${SITE}/og/${page.slug}.png`;
  const tags = [
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    page.noindex ? `<meta name="robots" content="noindex" />` : "",
    `<meta name="theme-color" content="#0b7a6c" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="Stock &amp; List" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${image}" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${esc(`${page.og.headline} ${page.og.sub}`)}" />`,
    `<meta property="og:locale" content="en_GB" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(page.title)}" />`,
    `<meta name="twitter:description" content="${esc(page.description)}" />`,
    `<meta name="twitter:image" content="${image}" />`,
    `<link rel="alternate" type="text/plain" title="llms.txt" href="/llms.txt" />`,
    ...(page.jsonLd ?? []).map((d) => `<script type="application/ld+json">${JSON.stringify(d)}</script>`),
  ];
  return tags.filter(Boolean).map((t) => `    ${t}`).join("\n");
}

function pageHtml(template, page) {
  let html = template.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(page.title)}</title>`);
  html = html.replace("</head>", `${headTags(page)}\n  </head>`);
  // Readable without JavaScript; React swaps it for the app on start.
  html = html.replace('<div id="root"></div>', `<div id="root">${page.body.trim()}\n</div>`);
  return html;
}

// --------------------------------------------------------------------------------------------- text files

const robots = `# Stock & List
User-agent: *
Allow: /
Disallow: /api/
Disallow: /images/
Disallow: /items/
Disallow: /settings
Disallow: /import
Disallow: /duplicates
Disallow: /relist
Disallow: /admin
Disallow: /extension

Sitemap: ${SITE}/sitemap.xml
`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PAGES.filter((p) => !p.noindex)
  .map((p) => `  <url><loc>${SITE}${p.path}</loc></url>`)
  .join("\n")}
</urlset>
`;

// https://llmstxt.org: a plain-markdown summary for LLMs.
const llms = `# Stock & List

> Stock & List is an inventory web app with a Chrome extension for people who resell second-hand items on eBay and Vinted (books, clothes, records, gadgets and the like). Sellers keep their stock in one place; the extension fills in eBay's and Vinted's own listing forms so an item is listed on both in a couple of clicks, relists stale listings back to the top of the feeds without re-uploading by hand, and flags an item's other listings when it sells.

Key facts:

- Who it's for: individual and small-scale resellers selling on eBay and Vinted.
- How listing works: the seller presses "List on eBay" or "List on Vinted"; the extension opens that site's sell page in the seller's own browser and fills in the title, description, photos, price, category, condition and parcel size. The seller checks it and presses publish; Stock & List then records the new listing's link.
- Relisting ("bumping"): listings that have gone stale (by default 21 days on Vinted, 60 on eBay) are flagged. One click opens a fresh, filled-in listing to publish and then the old listing to delete, so the item is back at the top of the feed.
- Cross-delisting: marking an item sold flags its live listings on the other site so they can be ended before it sells twice.
- Importing: existing Vinted and eBay listings can be imported into the inventory, photos included.
- Price checks: the extension reads comparable sold and live listings on eBay and Vinted; Google's Gemini API helps judge which are really the same item.
- It works with the seller's existing marketplace accounts and never asks for marketplace passwords. Stock & List isn't affiliated with or endorsed by eBay or Vinted.
- Sign-up needs only an email address.
- Made by Tayfun, who built it after trying to sell his own clutter on eBay and Vinted (inspired by Paul Graham's essay "Stuff").

## Pages

- [Home](${SITE}/): what Stock & List does, its features, and an animated demo of how it works
- [About](${SITE}/about): why Stock & List exists, in Tayfun's words
- [Privacy policy](${SITE}/privacy): what's collected, what the Chrome extension reads, and when data goes to Google's Gemini API
- [Create an account](${SITE}/signup): sign up with an email address

## Optional

- [Paul Graham, "Stuff"](https://paulgraham.com/stuff.html): the essay behind the project
`;

// --------------------------------------------------------------------------------------------- write

const template = readFileSync(resolve(dist, "index.html"), "utf8");
mkdirSync(resolve(dist, "og"), { recursive: true });
for (const page of PAGES) {
  writeFileSync(resolve(dist, "og", `${page.slug}.png`), await ogImage(page));
  writeFileSync(resolve(dist, page.file), pageHtml(template, page));
}
writeFileSync(resolve(dist, "robots.txt"), robots);
writeFileSync(resolve(dist, "sitemap.xml"), sitemap);
writeFileSync(resolve(dist, "llms.txt"), llms);
console.log(`SEO: ${PAGES.length} pages, preview images, robots.txt, sitemap.xml and llms.txt for ${SITE}`);
