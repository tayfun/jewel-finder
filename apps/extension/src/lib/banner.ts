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
    border-radius: 12px 12px 0 0; font-weight: 600; }
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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...kids);
  return node;
}

export function setCancelHandler(fn: () => void) {
  onCancel = fn;
}

export function showBanner(state: BannerState) {
  if (!host) {
    host = el("div", { id: "jewel-finder-banner" });
    root = host.attachShadow({ mode: "closed" });
    document.documentElement.append(host);
  }
  const box = el("div", { class: `box ${state.kind}` });
  const min = el("button", { title: "Minimise" }, "–");
  min.onclick = () => box.classList.toggle("min");
  const close = el("button", { title: "Hide" }, "×");
  close.onclick = () => hideBanner();
  box.append(el("header", {}, el("span", {}, "💎"), el("span", { class: "t" }, state.title), min, close));

  const body = el("div", { class: "body" });
  if (state.kind === "filled") {
    const { filled, manual, warnings } = state.report;
    body.append(
      el("p", { class: "msg" }, "Check everything, finish the fields below, then press the site's own upload/list button."),
    );
    if (filled.length) body.append(el("h4", {}, "Filled in"), el("ul", {}, ...filled.map((f) => el("li", { class: "ok" }, f))));
    if (manual.length) {
      body.append(
        el("h4", {}, "Please set"),
        el(
          "ul",
          {},
          ...manual.map(({ field, value }) => {
            const copy = el("button", { class: "copy" }, "copy");
            copy.onclick = () => void navigator.clipboard.writeText(value).then(() => (copy.textContent = "copied"));
            return el("li", { class: "todo" }, el("span", {}, `${field}: `, el("span", { class: "val" }, value || "—")), ...(value ? [copy] : []));
          }),
        ),
      );
    }
    if (warnings.length) body.append(el("h4", {}, "Heads up"), el("ul", {}, ...warnings.map((w) => el("li", { class: "warn" }, w))));
  } else {
    body.append(el("p", { class: "msg" }, state.message));
  }
  box.append(body);

  if (state.kind !== "done") {
    const cancel = el("button", {}, "Cancel this listing");
    cancel.onclick = () => {
      onCancel();
      hideBanner();
    };
    box.append(el("div", { class: "footer" }, el("span", { class: "val" }, "Jewel Finder"), cancel));
  }

  root.replaceChildren(el("style", {}, CSS), box);
}

export function hideBanner() {
  host?.remove();
  host = null;
}
