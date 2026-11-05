import {
  MARKETPLACES,
  MARKETPLACE_LABELS,
  formatMoney,
  imageUrl,
  photoUrl,
  isStale,
  listingAgeDays,
  type Account,
  type ItemStatus,
  type ItemWithListings,
  type Marketplace,
  type PriceCheck,
} from "@jf/shared";
import { API_URL } from "../config";
import { send, type TabMessage } from "../messages";

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
/** The item whose prices are being checked: one at a time, since each check opens several tabs. */
let pricing: string | null = null;
/** Price checks run from this panel, by item id. */
const checks = new Map<string, PriceCheck>();
const priceErrors = new Map<string, string>();

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

/**
 * The current tab's id when it's on `marketplace`. Asks the tab's content script rather than reading
 * its URL, which would need the "tabs" permission ("Read your browsing history").
 */
async function tabOn(marketplace: Marketplace): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return undefined;
  try {
    const on = await chrome.tabs.sendMessage(tab.id, { type: "WHICH_MARKETPLACE" } satisfies TabMessage);
    return on === marketplace ? tab.id : undefined;
  } catch {
    return undefined; // not a marketplace page (no content script to answer)
  }
}

/** Import mode in the current tab when it's on that marketplace, otherwise a new tab on your listings. */
async function startImport(marketplace: Marketplace) {
  busy = `import:${marketplace}`;
  error = "";
  render();
  try {
    await send({ type: "START_IMPORT", marketplace, tabId: await tabOn(marketplace) });
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

/** Searches eBay and Vinted for comparables in background tabs, then shows the suggested price here. */
async function checkPrice(item: ItemWithListings) {
  pricing = item.id;
  priceErrors.delete(item.id);
  render();
  try {
    const { check } = await send({ type: "START_PRICE_CHECK", itemId: item.id });
    checks.set(item.id, check);
  } catch (e) {
    priceErrors.set(item.id, (e as Error).message);
  } finally {
    pricing = null;
    render();
  }
}

async function usePrice(item: ItemWithListings, price: number) {
  priceErrors.delete(item.id);
  try {
    const updated = await send({ type: "SET_PRICE", itemId: item.id, price });
    items = items.map((i) => (i.id === updated.id ? updated : i));
  } catch (e) {
    priceErrors.set(item.id, (e as Error).message);
  }
  render();
}

/** The latest check's suggestions, with a button to use each, and a link to the full breakdown. */
function renderPriceCheck(item: ItemWithListings) {
  const error = priceErrors.get(item.id);
  const check = checks.get(item.id);
  if (pricing === item.id) {
    return h("div", { class: "pricecheck muted" }, "Searching eBay and Vinted in background tabs… about a minute.");
  }
  if (!check && !error) return null;
  const money = (v: number | null) => formatMoney(v, account?.settings.currency);
  const s = check?.summary;
  const ai = check?.ai;
  return h(
    "div",
    { class: "pricecheck" },
    error ? h("p", { class: "error" }, error) : null,
    s && s.suggestions.length
      ? h(
          "ul",
          {},
          ...s.suggestions.map((sug) =>
            h(
              "li",
              {},
              h("strong", {}, money(sug.price)),
              h("span", { class: "muted", title: sug.note }, ` ${MARKETPLACE_LABELS[sug.marketplace]} · ${money(sug.low)}–${money(sug.high)} · ${sug.confidence}`),
              h(
                "button",
                { class: item.price === sug.price ? "" : "primary", disabled: item.price === sug.price, onClick: () => usePrice(item, sug.price) },
                item.price === sug.price ? "Current" : "Use",
              ),
            ),
          ),
        )
      : s
        ? h(
            "p",
            { class: "muted" },
            s.ordinaryFloor != null
              ? `No like-for-like comparables. Ordinary copies go for about ${money(s.ordinaryFloor)}; yours is likely worth more.`
              : "No price suggested: not enough like-for-like comparables.",
          )
        : null,
    s?.warnings[0] && s.suggestions.length ? h("p", { class: "muted" }, s.warnings[0]) : null,
    ai?.status === "done" && !check?.aiOutdated && ai.note ? h("p", { class: "ai-note" }, `✨ ${ai.note}`) : null,
    check
      ? h(
          "p",
          { class: "muted" },
          `${check.comps.length} comparable${check.comps.length === 1 ? "" : "s"}`,
          ai?.status === "done" && !check.aiOutdated && s?.aiChanged ? `, ${s.aiChanged} re-judged by AI` : "",
          check.problems.length ? ` · ${check.problems.length} search${check.problems.length === 1 ? "" : "es"} couldn't be read` : "",
          " · ",
          h("a", { href: `${API_URL}/items/${item.id}`, target: "_blank" }, "Details ↗"),
        )
      : null,
  );
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
    h("h1", { class: "brand" }, h("img", { src: "icons/logo.svg", alt: "", width: "32", height: "32" }), "Stock", h("span", { class: "amp" }, "&"), "List"),
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
    cover
      ? h("img", {
          src: photoUrl(API_URL, cover, "thumb"),
          alt: "",
          loading: "lazy",
          // The resized copy failed (e.g. over the transformation quota): show the stored photo.
          onError: (e) => {
            const img = e.currentTarget as HTMLImageElement;
            const original = imageUrl(API_URL, cover);
            if (img.src !== original) img.src = original;
          },
        })
      : h("div", { class: "noimg" }),
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
        item.status === "sold"
          ? null
          : h(
              "button",
              {
                disabled: !!pricing || !item.title,
                title: "Search what similar items sold for on eBay and are listed at on eBay and Vinted",
                onClick: () => checkPrice(item),
              },
              pricing === item.id ? "Checking…" : checks.has(item.id) ? "💷 Again" : "💷 Price",
            ),
      ),
      renderPriceCheck(item),
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
      h("span", { class: "brand" }, h("img", { src: "icons/logo.svg", alt: "", width: "24", height: "24" }), "Stock", h("span", { class: "amp" }, "&"), "List"),
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
