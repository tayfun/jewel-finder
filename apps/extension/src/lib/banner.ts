import type { FillReport } from "../messages";
import { logoMark } from "./logo";

export type BannerState =
  | { kind: "working"; title: string; message: string }
  | { kind: "hint"; title: string; message: string }
  | { kind: "filled"; title: string; report: FillReport }
  | { kind: "done"; title: string; message: string }
  | { kind: "error"; title: string; message: string };

const CSS = `
  :host { all: initial; }
  .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 380px; max-width: calc(100vw - 32px); max-height: 75vh; overflow: auto;
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #14181a; background: #fff;
    border: 1px solid #e0e4df; border-radius: 14px; box-shadow: 0 4px 10px rgb(20 30 28 / 8%), 0 18px 44px rgb(20 30 28 / 18%);
    -webkit-font-smoothing: antialiased; }
  header { position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: 8px; padding: 11px 14px;
    background: linear-gradient(135deg, #0b7a6c, #08574d); color: #fff;
    border-radius: 14px 14px 0 0; font-weight: 650; font-size: 14.5px; cursor: move; user-select: none; touch-action: none; }
  .dragging { opacity: .94; box-shadow: 0 20px 50px rgb(0 0 0 / 30%); }
  header .logo { flex: none; display: grid; filter: drop-shadow(0 1px 2px rgb(0 0 0 / 25%)); }
  header .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header button { all: unset; cursor: pointer; display: grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; font-size: 17px; opacity: .85; }
  header button:hover { opacity: 1; background: rgb(255 255 255 / 16%); }
  .body { padding: 12px 14px 14px; }
  .msg { margin: 0 0 4px; color: #2d3533; }
  h4 { margin: 14px 0 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: #4f5a58; }
  ul { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 2px; }
  li { padding: 4px 0; display: flex; gap: 8px; align-items: baseline; line-height: 1.4; }
  li > span { min-width: 0; overflow-wrap: anywhere; }
  .ok::before { content: "✓"; flex: none; color: #0b7a6c; font-weight: 800; }
  .todo::before { content: "•"; flex: none; color: #b54708; font-weight: 800; }
  .warn { color: #b42318; }
  /* Guesses and defaults: red, in their own tinted block, so they get checked. */
  h4.guess-h { color: #b42318; }
  h4.guess-h + ul { padding: 6px 10px; background: #fdecea; border: 1px solid #f6c7c0; border-radius: 10px; }
  .guess { color: #b42318; }
  .guess::before { content: "⚠"; flex: none; font-weight: 700; }
  .guess b { font-weight: 700; }
  .guess .why { color: #b42318; opacity: .85; font-size: 12.5px; }
  .val { color: #4f5a58; }
  .copy { all: unset; flex: none; cursor: pointer; margin-left: auto; padding: 1px 9px; border-radius: 99px; font-size: 12px; font-weight: 600;
    color: #0b7a6c; background: #dcf5ef; }
  .copy:hover { background: #c6eee4; }
  .footer { display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; border-top: 1px solid #e0e4df; background: #f7f8f6;
    border-radius: 0 0 14px 14px; }
  .footer .brand { font-weight: 800; letter-spacing: -0.02em; color: #2d3533; }
  .footer .brand .amp { display: inline-block; margin: 0 5px 0 2px; color: #e4523c; text-shadow: 0.08em 0 0 #ffc53d, 0.16em 0 0 #b9a2ff; }
  .footer button { all: unset; cursor: pointer; color: #4f5a58; font-size: 12.5px; font-weight: 500; }
  .footer button:hover { color: #b42318; }
  .error header { background: linear-gradient(135deg, #c0331f, #92210f); }
  .done header { background: linear-gradient(135deg, #067647, #05573a); }
  .min .body, .min .footer { display: none; }
  .min header { border-radius: 14px; }
`;

let host: HTMLElement | null = null;
let root: ShadowRoot;
let onCancel: () => void = () => {};
let cancelLabel = "Cancel this listing";

// ------------------------------------------------------------- dragging
// The panel can be dragged by its header so it doesn't cover the page. The spot is remembered (in
// the extension's storage, not the site's) for the next page; double-click the header to put it back.

type Pos = { left: number; top: number };
const POS_KEY = "bannerPos";
/** Null: the default bottom-right corner. */
let pos: Pos | null = null;
let posLoaded = false;
let box: HTMLElement | null = null;

const storage = () => (typeof chrome !== "undefined" ? chrome.storage?.local : undefined);

function loadPos() {
  if (posLoaded) return;
  posLoaded = true;
  storage()
    ?.get(POS_KEY)
    .then((r) => {
      const saved = r[POS_KEY] as Pos | undefined;
      // Don't undo a drag that happened while this was loading.
      if (saved && pos === null && typeof saved.left === "number" && typeof saved.top === "number") {
        pos = saved;
        applyPos();
      }
    })
    .catch(() => {});
}

function savePos() {
  void storage()?.set({ [POS_KEY]: pos }).catch(() => {});
}

/** Keeps at least the header on screen, whatever the window size. */
function clamp(p: Pos, width: number): Pos {
  return {
    left: Math.min(Math.max(0, p.left), Math.max(0, window.innerWidth - width)),
    top: Math.min(Math.max(0, p.top), Math.max(0, window.innerHeight - 44)),
  };
}

function applyPos() {
  if (!box) return;
  if (!pos) {
    box.style.left = box.style.top = box.style.right = box.style.bottom = "";
    return;
  }
  const p = clamp(pos, box.offsetWidth || 340);
  box.style.left = `${p.left}px`;
  box.style.top = `${p.top}px`;
  box.style.right = box.style.bottom = "auto";
}

function makeDraggable(header: HTMLElement, target: HTMLElement) {
  header.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as Element).closest("button")) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    header.setPointerCapture?.(e.pointerId);
    target.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      pos = clamp({ left: ev.clientX - dx, top: ev.clientY - dy }, rect.width);
      applyPos();
    };
    const up = () => {
      header.removeEventListener("pointermove", move);
      header.removeEventListener("pointerup", up);
      header.removeEventListener("pointercancel", up);
      target.classList.remove("dragging");
      savePos();
    };
    header.addEventListener("pointermove", move);
    header.addEventListener("pointerup", up);
    header.addEventListener("pointercancel", up);
  });
  header.addEventListener("dblclick", (e) => {
    if ((e.target as Element).closest("button")) return;
    pos = null;
    applyPos();
    savePos();
  });
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

/** What the footer's cancel button does, and what it says. */
export function setCancelHandler(fn: () => void, label = "Cancel this listing") {
  onCancel = fn;
  cancelLabel = label;
}

export function showBanner(state: BannerState) {
  if (!host) {
    host = el("div", { id: "stock-and-list-banner" });
    root = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
    loadPos();
  }
  const panel = el("div", { class: `box ${state.kind}` });
  box = panel;
  const min = el("button", { title: "Minimise" }, "–");
  min.onclick = () => {
    panel.classList.toggle("min");
    applyPos();
  };
  const close = el("button", { title: "Hide" }, "×");
  close.onclick = () => hideBanner();
  const header = el("header", { title: "Drag to move · double-click to put back" }, logoMark(), el("span", { class: "t" }, state.title), min, close);
  makeDraggable(header, panel);
  panel.append(header);

  const body = el("div", { class: "body" });
  if (state.kind === "filled") {
    const { filled, manual, warnings, guessed = [] } = state.report;
    body.append(
      el("p", { class: "msg" }, "Check everything, finish the fields below, then press the site's own upload/list button."),
    );
    if (guessed.length) {
      body.append(
        el("h4", { class: "guess-h" }, "Guessed: please check"),
        el(
          "ul",
          {},
          ...guessed.map(({ field, value, why }) =>
            el("li", { class: "guess" }, el("span", {}, `${field}: `, el("b", {}, value), " ", el("span", { class: "why" }, `(${why})`))),
          ),
        ),
      );
    }
    if (filled.length) body.append(el("h4", {}, "Filled in"), el("ul", {}, ...filled.map((f) => el("li", { class: "ok" }, f))));
    if (manual.length) {
      body.append(
        el("h4", {}, "Please set"),
        el(
          "ul",
          {},
          ...manual.map(({ field, value, guess }) => {
            const copy = el("button", { class: "copy" }, "copy");
            copy.onclick = () => void navigator.clipboard.writeText(value).then(() => (copy.textContent = "copied"));
            const text = el("span", {}, `${field}: `, el("span", { class: guess ? "" : "val" }, value || "—"));
            if (guess) text.append(" ", el("span", { class: "why" }, `(guess: ${guess})`));
            return el("li", { class: guess ? "guess" : "todo" }, text, ...(value ? [copy] : []));
          }),
        ),
      );
    }
    if (warnings.length) body.append(el("h4", {}, "Heads up"), el("ul", {}, ...warnings.map((w) => el("li", { class: "warn" }, w))));
  } else {
    body.append(el("p", { class: "msg" }, state.message));
  }
  panel.append(body);

  if (state.kind !== "done") {
    const cancel = el("button", {}, cancelLabel);
    cancel.onclick = () => {
      onCancel();
      hideBanner();
    };
    panel.append(el("div", { class: "footer" }, el("span", { class: "brand" }, "Stock", el("span", { class: "amp" }, "&"), "List"), cancel));
  }

  root.replaceChildren(el("style", {}, CSS), panel);
  applyPos();
}

window.addEventListener("resize", applyPos);

export function hideBanner() {
  host?.remove();
  host = null;
  box = null;
}
