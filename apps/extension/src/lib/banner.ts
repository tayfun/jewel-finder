import type { FillReport } from "../messages";

export type BannerState =
  | { kind: "working"; title: string; message: string }
  | { kind: "hint"; title: string; message: string }
  | { kind: "filled"; title: string; report: FillReport }
  | { kind: "done"; title: string; message: string }
  | { kind: "error"; title: string; message: string };

const CSS = `
  :host { all: initial; }
  .box { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; width: 340px; max-height: 70vh; overflow: auto;
    font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #16191d; background: #fff;
    border: 1px solid #e2e5e9; border-radius: 12px; box-shadow: 0 10px 30px rgb(0 0 0 / 18%); }
  header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; background: #0f766e; color: #fff;
    border-radius: 12px 12px 0 0; font-weight: 600; cursor: move; user-select: none; touch-action: none; }
  .dragging { opacity: .92; box-shadow: 0 16px 40px rgb(0 0 0 / 28%); }
  header .t { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  header button { all: unset; cursor: pointer; padding: 0 4px; font-size: 16px; opacity: .85; }
  .body { padding: 10px 12px; }
  .msg { margin: 0 0 6px; }
  h4 { margin: 10px 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #69707a; }
  ul { margin: 0; padding: 0; list-style: none; }
  li { padding: 2px 0; display: flex; gap: 6px; }
  .ok::before { content: "✓"; color: #0f766e; font-weight: 700; }
  .todo::before { content: "•"; color: #b54708; font-weight: 700; }
  .warn { color: #b42318; }
  .guess { color: #b42318; }
  .guess::before { content: "⚠"; font-weight: 700; }
  .guess .why { color: #b42318; opacity: .8; font-size: 12px; }
  h4.guess-h { color: #b42318; }
  .val { color: #69707a; }
  .copy { all: unset; cursor: pointer; color: #0f766e; margin-left: auto; font-size: 12px; }
  .footer { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid #e2e5e9; }
  .footer button { all: unset; cursor: pointer; color: #69707a; font-size: 12px; }
  .footer button:hover { color: #b42318; }
  .error header { background: #b42318; }
  .done header { background: #067647; }
  .min .body, .min .footer { display: none; }
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
    host = el("div", { id: "jewel-finder-banner" });
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
  const header = el("header", { title: "Drag to move · double-click to put back" }, el("span", {}, "💎"), el("span", { class: "t" }, state.title), min, close);
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
    panel.append(el("div", { class: "footer" }, el("span", { class: "val" }, "Jewel Finder"), cancel));
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
