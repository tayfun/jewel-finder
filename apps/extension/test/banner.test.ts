import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The banner uses a closed shadow root; open it so the test can reach inside.
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit) {
  return attach.call(this, { ...init, mode: "open" });
};

const store: Record<string, unknown> = {};
(globalThis as { chrome?: unknown }).chrome = {
  storage: {
    local: {
      get: async (key: string) => ({ [key]: store[key] }),
      set: async (items: Record<string, unknown>) => void Object.assign(store, items),
    },
  },
};

let banner: typeof import("../src/lib/banner");
beforeAll(async () => {
  banner = await import("../src/lib/banner");
});
beforeEach(() => banner.hideBanner());

const panel = () => document.getElementById("jewel-finder-banner")!.shadowRoot!.querySelector<HTMLElement>(".box")!;
const header = () => panel().querySelector("header")!;
const pointer = (type: string, x: number, y: number) =>
  header().dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));

describe("banner", () => {
  it("drags by its header, keeps the spot across updates and pages, and resets on double-click", async () => {
    banner.showBanner({ kind: "hint", title: "Listing", message: "Hello" });
    expect(panel().style.left).toBe(""); // default bottom-right corner, from CSS

    pointer("pointerdown", 10, 10);
    pointer("pointermove", 110, 60);
    pointer("pointerup", 110, 60);
    expect(panel().style.left).toBe("100px");
    expect(panel().style.top).toBe("50px");
    expect(panel().style.right).toBe("auto");
    await vi.waitFor(() => expect(store.bannerPos).toEqual({ left: 100, top: 50 }));

    // A new state re-renders the panel in the same place.
    banner.showBanner({ kind: "done", title: "Listed", message: "Done" });
    expect(panel().style.left).toBe("100px");

    // Can't be dragged off screen.
    pointer("pointerdown", 0, 0);
    pointer("pointermove", -500, 99999);
    pointer("pointerup", -500, 99999);
    expect(panel().style.left).toBe("0px");
    expect(Number.parseFloat(panel().style.top)).toBe(window.innerHeight - 44);

    // Buttons in the header don't start a drag.
    const before = panel().style.left;
    panel().querySelector("header button")!.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, button: 0, bubbles: true }));
    pointer("pointermove", 300, 300);
    expect(panel().style.left).toBe(before);

    // Double-click puts it back in the corner.
    header().dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(panel().style.left).toBe("");
    await vi.waitFor(() => expect(store.bannerPos).toBeNull());
  });

  it("shows guesses and defaults in their own red section, and guessed to-dos in red", () => {
    banner.showBanner({
      kind: "filled",
      title: "Vinted: a book",
      report: {
        filled: ["Title"],
        guessed: [{ field: "ISBN", value: "0000000000000", why: "none saved" }],
        manual: [
          { field: "Language", value: "Turkish", guess: "Turkish letters in the title" },
          { field: "Colour", value: "Blue" },
        ],
        warnings: [],
      },
    });
    const box = panel();
    const heading = [...box.querySelectorAll("h4")].map((h) => h.textContent);
    expect(heading[0]).toBe("Guessed: please check");
    const guesses = [...box.querySelectorAll("li.guess")].map((li) => li.textContent);
    expect(guesses[0]).toContain("ISBN: 0000000000000 (none saved)");
    expect(guesses[1]).toContain("Language: Turkish (guess: Turkish letters in the title)");
    expect(box.querySelectorAll("li.todo")).toHaveLength(1); // Colour, from the item's own data
  });
});
