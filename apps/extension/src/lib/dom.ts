import type { ImageFile } from "../messages";

/** Ways to locate a form control. Strategies are tried in order; first match wins. */
export interface FieldSpec {
  selectors?: string[];
  /** Matched against <label> text and aria-label. */
  labels?: RegExp[];
  placeholders?: RegExp[];
}

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export const normalize = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

function isUsable(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  return !el.hasAttribute("disabled");
}

function controlFor(label: HTMLLabelElement): HTMLElement | null {
  if (label.htmlFor) return label.ownerDocument.getElementById(label.htmlFor);
  return label.querySelector("input, textarea, select, [role=combobox], [contenteditable=true]");
}

export function findField(spec: FieldSpec, root: ParentNode = document): HTMLElement | null {
  for (const sel of spec.selectors ?? []) {
    for (const el of root.querySelectorAll(sel)) if (isUsable(el)) return el;
  }
  if (spec.labels?.length) {
    for (const label of root.querySelectorAll("label")) {
      const text = normalize(label.textContent);
      if (spec.labels.some((re) => re.test(text))) {
        const el = controlFor(label);
        if (isUsable(el)) return el;
      }
    }
    for (const el of root.querySelectorAll("[aria-label]")) {
      if (spec.labels.some((re) => re.test(normalize(el.getAttribute("aria-label")))) && isUsable(el)) return el;
    }
  }
  for (const re of spec.placeholders ?? []) {
    for (const el of root.querySelectorAll("[placeholder]")) {
      if (re.test(normalize(el.getAttribute("placeholder"))) && isUsable(el)) return el;
    }
  }
  return null;
}

/**
 * Sets a value so React/Vue-controlled inputs notice: React tracks the value via
 * the prototype setter, so assigning `el.value` directly is swallowed.
 */
export function setValue(el: HTMLElement, value: string): void {
  if (el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    return;
  }
  const control = el as Control;
  const proto = Object.getPrototypeOf(control) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  control.focus();
  if (setter) setter.call(control, value);
  else control.value = value;
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
  control.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
  control.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
}

export function dataUrlToFile(img: ImageFile): File {
  const [, b64 = ""] = img.dataUrl.split(",");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], img.name, { type: img.type });
}

/** Puts files into an <input type=file> as if the user had picked them. */
export function attachFiles(input: HTMLInputElement, files: File[]): void {
  const dt = new DataTransfer();
  for (const f of input.multiple ? files : files.slice(0, 1)) dt.items.add(f);
  input.files = dt.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export function waitFor<T>(probe: () => T | null | undefined, timeoutMs = 10_000, everyMs = 200): Promise<T | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      let found: T | null | undefined = null;
      try {
        found = probe();
      } catch {
        // keep polling
      }
      if (found) return resolve(found);
      if (Date.now() - started >= timeoutMs) return resolve(null);
      setTimeout(tick, everyMs);
    };
    tick();
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const OPTION_SELECTORS = [
  "[role=option]",
  "[role=menuitem]",
  "[role=menuitemradio]",
  "[data-testid*=dropdown-row]",
  "[data-testid*=option]",
  "li",
];

/** Finds a visible dropdown option whose text matches `text` (exact first, then prefix). */
export function findOption(text: string, root: ParentNode = document): HTMLElement | null {
  const want = normalize(text);
  const candidates: HTMLElement[] = [];
  for (const sel of OPTION_SELECTORS) {
    for (const el of root.querySelectorAll<HTMLElement>(sel)) candidates.push(el);
  }
  const textOf = (el: HTMLElement) => normalize(el.innerText ?? el.textContent);
  return (
    candidates.find((el) => textOf(el) === want) ??
    candidates.find((el) => textOf(el).split(/\n| {2,}/)[0] === want) ??
    candidates.find((el) => textOf(el).startsWith(want)) ??
    null
  );
}

export function click(el: HTMLElement) {
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  }
  el.click();
}

/**
 * Opens a custom dropdown, types into it if it's searchable, and clicks the
 * option matching `text`. Returns false if no matching option showed up.
 */
export async function pickOption(trigger: HTMLElement, text: string, timeoutMs = 4000): Promise<boolean> {
  click(trigger);
  if (trigger instanceof HTMLInputElement && !trigger.readOnly) {
    await sleep(100);
    setValue(trigger, text);
  }
  const option = await waitFor(() => findOption(text), timeoutMs);
  if (!option) {
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    return false;
  }
  click(option);
  await sleep(150);
  return true;
}

const CHOICE_SELECTORS = "input[type=radio], [role=radio], [role=option], label, button, li, [data-testid]";

/** Text of all text nodes joined with spaces, so "<b>Small</b><span>Up to 2 kg</span>" reads "small up to 2 kg". */
function spacedText(el: Element): string {
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) parts.push(n.nodeValue ?? "");
  return normalize(parts.join(" "));
}

/** What a choice says; radio inputs are read from their label. */
function choiceText(el: HTMLElement): string {
  if (el instanceof HTMLInputElement) {
    const label = el.labels?.[0] ?? el.closest("label");
    return label ? spacedText(label) : normalize(el.getAttribute("aria-label") ?? el.value);
  }
  return spacedText(el);
}

/**
 * The most specific choice (radio, tile, option, button) under `root` whose text matches `match`,
 * skipping anything inside `exclude`. Shortest text wins, so a tile beats the list around it.
 */
export function findChoice(match: RegExp, root: ParentNode = document, exclude?: Element | null): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLength = Infinity;
  for (const el of root.querySelectorAll<HTMLElement>(CHOICE_SELECTORS)) {
    if (exclude?.contains(el)) continue;
    const text = choiceText(el);
    if (match.test(text) && text.length < bestLength) {
      best = el;
      bestLength = text.length;
    }
  }
  // Click the radio itself rather than its label: controlled forms listen on the input.
  if (best instanceof HTMLLabelElement && best.control) return best.control as HTMLElement;
  return best;
}
