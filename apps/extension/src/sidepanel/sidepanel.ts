import {
  MARKETPLACES,
  MARKETPLACE_LABELS,
  formatMoney,
  imageUrl,
  isStale,
  listingAgeDays,
  type Account,
  type ItemStatus,
  type ItemWithListings,
  type Marketplace,
} from "@jf/shared";
import { API_URL } from "../config";
import { send } from "../messages";

const app = document.getElementById("app")!;

type Attrs = Record<string, string | boolean | ((e: Event) => void)>;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...kids: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) el.setAttribute(k, "");
    else if (v !== false) el.setAttribute(k, v);
  }
  el.append(...kids.filter((k): k is Node | string => k !== null && k !== false));
  return el;
}

let account: Account | null = null;
let items: ItemWithListings[] = [];
let query = "";
let status: ItemStatus | "" = "in_stock";
let error = "";
let loading = false;
let busy = "";

async function init() {
  try {
    account = (await send({ type: "AUTH_STATE" })).account;
  } catch (e) {
    error = (e as Error).message;
  }
  render();
  if (account) await load();
}

async function load() {
  loading = true;
  render();
  try {
    items = (await send({ type: "LIST_ITEMS", q: query || undefined, status: status || undefined })).items;
    error = "";
  } catch (e) {
    error = (e as Error).message;
    if (/not signed in/i.test(error)) account = null;
  } finally {
    loading = false;
    render();
  }
}

/** Import mode in the current tab when it's on that marketplace, otherwise a new tab on your listings. */
async function startImport(marketplace: Marketplace) {
  busy = `import:${marketplace}`;
  error = "";
  render();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const host = tab?.url ? new URL(tab.url).hostname : "";
    const here = marketplace === "vinted" ? /(^|\.)vinted\./.test(host) : /(^|\.)ebay\./.test(host);
    await send({ type: "START_IMPORT", marketplace, tabId: here ? tab?.id : undefined });
  } catch (e) {
    error = (e as Error).message;
  } finally {
    busy = "";
    render();
  }
}

/** Bump a stale listing: list it again from the inventory, then remove the old one. */
async function relist(item: ItemWithListings, marketplace: Marketplace) {
  busy = `${item.id}:${marketplace}`;
  error = "";
  render();
  try {
    await send({ type: "START_RELISTING", itemId: item.id, marketplace });
  } catch (e) {
    error = (e as Error).message;
  } finally {
    busy = "";
    render();
  }
}

async function list(item: ItemWithListings, marketplace: Marketplace) {
  busy = `${item.id}:${marketplace}`;
  error = "";
  render();
  try {
    await send({ type: "START_LISTING", itemId: item.id, marketplace });
    await load();
  } catch (e) {
    error = (e as Error).message;
  } finally {
    busy = "";
    render();
  }
}

function renderLogin() {
  const email = h("input", { type: "email", required: true, autocomplete: "email" });
  const password = h("input", { type: "password", required: true, autocomplete: "current-password" });
  const submit = h("button", { class: "primary" }, "Sign in");
  const form = h(
    "form",
    {
      class: "login",
      onSubmit: async (e) => {
        e.preventDefault();
        submit.setAttribute("disabled", "");
        try {
          account = (await send({ type: "AUTH_LOGIN", email: email.value, password: password.value })).account;
          error = "";
          await load();
        } catch (err) {
          error = (err as Error).message;
          render();
        }
      },
    },
    h("h1", {}, "💎 Jewel Finder"),
    h("p", {}, "Sign in to list your inventory on Vinted and eBay."),
    h("label", {}, "Email", email),
    h("label", {}, "Password", password),
    error ? h("p", { class: "error" }, error) : null,
    submit,
    h("p", { class: "muted" }, "No account? ", h("a", { href: `${API_URL}/signup`, target: "_blank" }, "Create one")),
    // Accounts live on one server; make it obvious which one this build signs in to.
    h("p", { class: "muted small" }, `Signing in to ${new URL(API_URL).host} · `, h("a", { href: `${API_URL}/privacy`, target: "_blank" }, "Privacy")),
  );
  app.replaceChildren(form);
  email.focus();
}

function renderItem(item: ItemWithListings) {
  const byMarket = new Map(item.listings.map((l) => [l.marketplace, l]));
  const cover = item.images[0];
  return h(
    "li",
    { class: "item" },
    cover ? h("img", { src: imageUrl(API_URL, cover), alt: "", loading: "lazy" }) : h("div", { class: "noimg" }),
    h(
      "div",
      {},
      h("div", { class: "title", title: item.title }, item.title),
      h(
        "div",
        { class: "meta" },
        [formatMoney(item.price, account?.settings.currency), item.brand, item.size].filter(Boolean).join(" · "),
      ),
      h(
        "div",
        { class: "row" },
        ...MARKETPLACES.map((m) => {
          const l = byMarket.get(m);
          if (l?.status === "listed" || l?.status === "sold") {
            const stale = account ? isStale(item, l, account.settings) : false;
            const label = `${MARKETPLACE_LABELS[m]}${l.status === "sold" ? " · sold" : stale ? ` · ${listingAgeDays(l)}d` : ""}`;
            const badge = h("span", { class: `badge ${m}${stale ? " stale" : ""}`, title: stale ? "Up for a while: relist to bump it" : "" }, label);
            const link = l.url ? h("a", { href: l.url, target: "_blank" }, badge) : badge;
            if (!stale || !l.url) return link;
            return h(
              "span",
              { class: "row" },
              link,
              h(
                "button",
                {
                  disabled: !!busy || !item.images.length,
                  title: `List it again on ${MARKETPLACE_LABELS[m]} and remove the old listing, to bump it to the top`,
                  onClick: () => relist(item, m),
                },
                busy === `${item.id}:${m}` ? "Opening…" : "↻ Relist",
              ),
            );
          }
          const key = `${item.id}:${m}`;
          return h(
            "button",
            {
              disabled: !!busy || item.status === "sold" || !item.images.length,
              title: item.images.length ? `Open ${MARKETPLACE_LABELS[m]} and fill in this item` : "Add a photo first",
              onClick: () => list(item, m),
            },
            busy === key ? "Opening…" : `${l?.status === "pending" ? "↻ " : "+ "}${MARKETPLACE_LABELS[m]}`,
          );
        }),
      ),
    ),
  );
}

function renderInventory() {
  const search = h("input", {
    type: "search",
    placeholder: "Search inventory…",
    value: query,
    onInput: debounce((e: Event) => {
      query = (e.target as HTMLInputElement).value;
      void load();
    }),
  });
  const filter = h(
    "select",
    {
      onChange: (e) => {
        status = (e.target as HTMLSelectElement).value as ItemStatus | "";
        void load();
      },
    },
    ...[
      ["in_stock", "In stock"],
      ["draft", "Drafts"],
      ["", "All"],
      ["sold", "Sold"],
    ].map(([v, label]) => h("option", { value: v!, selected: v === status }, label!)),
  );

  const children: (Node | null)[] = [
    h(
      "header",
      {},
      h("span", { class: "brand" }, "💎 Jewel Finder"),
      h("a", { href: API_URL, target: "_blank", title: "Open the web app" }, "Open app ↗"),
      h(
        "button",
        {
          class: "link",
          title: account?.email ?? "",
          onClick: async () => {
            await send({ type: "AUTH_LOGOUT" });
            account = null;
            items = [];
            render();
          },
        },
        "Sign out",
      ),
    ),
    h("div", { class: "toolbar" }, search, filter),
    error ? h("p", { class: "error" }, error) : null,
    h("p", { class: "notice" }, "Make sure you're signed in to Vinted / eBay in this browser before listing."),
    h(
      "div",
      { class: "import" },
      h("span", { class: "muted" }, "Import listings:"),
      ...MARKETPLACES.map((m) =>
        h(
          "button",
          {
            disabled: !!busy,
            title: `Pick ${MARKETPLACE_LABELS[m]} listings to add to your inventory (uses this tab if it's on ${MARKETPLACE_LABELS[m]})`,
            onClick: () => startImport(m),
          },
          busy === `import:${m}` ? "Opening…" : `⬇ ${MARKETPLACE_LABELS[m]}`,
        ),
      ),
    ),
    items.length
      ? h("ul", { class: "items" }, ...items.map(renderItem))
      : h("div", { class: "empty" }, loading ? "Loading…" : "No items here."),
  ];
  app.replaceChildren(...children.filter((c): c is Node => c !== null));
}

function render() {
  const active = document.activeElement as HTMLInputElement | null;
  const hadSearchFocus = active?.type === "search";
  if (account) renderInventory();
  else renderLogin();
  if (hadSearchFocus) {
    const s = app.querySelector<HTMLInputElement>("input[type=search]");
    s?.focus();
    s?.setSelectionRange(s.value.length, s.value.length);
  }
}

function debounce<A extends unknown[]>(fn: (...args: A) => void, ms = 250) {
  let t: ReturnType<typeof setTimeout>;
  return (...args: A) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Reflect sign-in from the web app and listing updates from other tabs.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && "auth" in changes) void init();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && account) void load();
});

void init();
