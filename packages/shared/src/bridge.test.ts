import { describe, expect, it } from "vitest";
import { mergeChangedItems } from "./bridge";

describe("mergeChangedItems", () => {
  type I = { id: string; status: string; v?: number };
  const list: I[] = [
    { id: "a", status: "in_stock" },
    { id: "b", status: "in_stock" },
    { id: "c", status: "in_stock" },
  ];
  const inStock = (i: I) => i.status === "in_stock";

  it("swaps a changed item in place and leaves the rest alone", () => {
    const out = mergeChangedItems(list, new Map([["b", { id: "b", status: "in_stock", v: 2 }]]), inStock);
    expect(out.map((i) => i.id)).toEqual(["a", "b", "c"]);
    expect(out[1]!.v).toBe(2);
    expect(out[0]).toBe(list[0]);
  });

  it("drops items that are gone or no longer match, and adds new ones on top", () => {
    const changed = new Map<string, I | null>([
      ["a", null],
      ["c", { id: "c", status: "sold" }],
      ["d", { id: "d", status: "in_stock" }],
      ["e", { id: "e", status: "sold" }],
    ]);
    expect(mergeChangedItems(list, changed, inStock).map((i) => i.id)).toEqual(["d", "b"]);
    expect(mergeChangedItems(list, changed, inStock, false).map((i) => i.id)).toEqual(["b"]);
  });
});
