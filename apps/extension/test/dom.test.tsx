import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { attachFiles, findField, findOption, pickOption, setValue, waitFor } from "../src/lib/dom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

describe("findField", () => {
  it("tries selectors, then labels, then aria-label, then placeholders", () => {
    document.body.innerHTML = `
      <input type="hidden" name="title" value="x">
      <label for="d">Describe your item</label><textarea id="d"></textarea>
      <label>Price <input id="p"></label>
      <input aria-label="Brand" id="b">
      <input placeholder="Search for a size" id="s">
    `;
    expect(findField({ selectors: ['input[name="title"]'] })).toBeNull(); // hidden inputs are skipped
    expect(findField({ labels: [/^describe your item$/] })?.id).toBe("d");
    expect(findField({ labels: [/^price$/] })?.id).toBe("p");
    expect(findField({ labels: [/^brand$/] })?.id).toBe("b");
    expect(findField({ placeholders: [/size/] })?.id).toBe("s");
    expect(findField({ selectors: ["#nope"], labels: [/^nope$/] })).toBeNull();
  });
});

describe("setValue", () => {
  it("updates a React-controlled input", async () => {
    let seen = "";
    function Form() {
      const [title, setTitle] = useState("");
      seen = title;
      return <input id="t" value={title} onChange={(e) => setTitle(e.target.value)} />;
    }
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(<Form />));

    const input = document.getElementById("t") as HTMLInputElement;
    await act(async () => setValue(input, "Levi's 501"));
    expect(seen).toBe("Levi's 501");
    expect(input.value).toBe("Levi's 501");
    await act(async () => root.unmount());
  });

  it("updates textareas and contenteditable", () => {
    document.body.innerHTML = `<textarea id="a"></textarea><div id="b" contenteditable="true"></div>`;
    const inputs: string[] = [];
    document.addEventListener("input", (e) => inputs.push((e.target as HTMLElement).id));
    setValue(document.getElementById("a")!, "hello");
    setValue(document.getElementById("b")!, "world");
    expect((document.getElementById("a") as HTMLTextAreaElement).value).toBe("hello");
    expect(document.getElementById("b")!.textContent).toBe("world");
    expect(inputs).toEqual(["a", "b"]);
  });
});

describe("attachFiles", () => {
  it("puts files on the input and fires change", () => {
    document.body.innerHTML = `<input type="file" multiple id="f">`;
    const input = document.getElementById("f") as HTMLInputElement;
    let changed = 0;
    input.addEventListener("change", () => changed++);
    attachFiles(input, [new File(["a"], "a.jpg", { type: "image/jpeg" }), new File(["b"], "b.jpg", { type: "image/jpeg" })]);
    expect(input.files?.length).toBe(2);
    expect(input.files?.[0]?.name).toBe("a.jpg");
    expect(changed).toBe(1);
  });
});

describe("dropdowns", () => {
  it("finds options by exact text before prefix", () => {
    document.body.innerHTML = `
      <ul><li role="option" id="a">Good condition guide</li><li role="option" id="b">Good</li></ul>`;
    expect(findOption("good")?.id).toBe("b");
    expect(findOption("Good cond")?.id).toBe("a");
  });

  it("finds Vinted's condition cells (role=radio in a menu) by their title", () => {
    const cell = (id: number, title: string, body: string) =>
      `<div role="radio" data-testid="condition-${id}"><div data-testid="condition-${id}--title">${title}</div>` +
      `<div data-testid="condition-${id}--content">${body}</div><label><input type="radio"></label></div>`;
    document.body.innerHTML = `
      <div role="radio" id="elsewhere">Good</div>
      <div role="menu"><div role="group">
        ${cell(6, "New with tags", "A brand-new, unused item with tags attached.")}
        ${cell(2, "Very good", "A lightly used item that may have slight imperfections.")}
        ${cell(3, "Good", "A used item that may show imperfections and signs of wear.")}
      </div></div>`;
    expect(findOption("Good")?.dataset.testid).toBe("condition-3");
    expect(findOption("Very good")?.dataset.testid).toBe("condition-2");
    expect(findOption("New with tags")?.dataset.testid).toBe("condition-6");
  });

  it("opens a dropdown and clicks the matching option", async () => {
    document.body.innerHTML = `<input id="c" readonly><div id="menu"></div>`;
    const trigger = document.getElementById("c") as HTMLInputElement;
    let picked = "";
    trigger.addEventListener("click", () => {
      // Options render asynchronously, like a real dropdown.
      setTimeout(() => {
        document.getElementById("menu")!.innerHTML = ["New with tags", "Very good", "Good"]
          .map((t) => `<div role="option">${t}</div>`)
          .join("");
        for (const o of document.querySelectorAll<HTMLElement>("[role=option]")) {
          o.addEventListener("click", () => (picked = o.textContent ?? ""));
        }
      }, 50);
    });
    expect(await pickOption(trigger, "Very good")).toBe(true);
    expect(picked).toBe("Very good");
    expect(await pickOption(trigger, "Satisfactory", 300)).toBe(false);
  });
});

describe("waitFor", () => {
  it("resolves when the probe succeeds, or null on timeout", async () => {
    setTimeout(() => document.body.append(Object.assign(document.createElement("p"), { id: "late" })), 50);
    expect((await waitFor(() => document.getElementById("late"), 1000, 10))?.id).toBe("late");
    expect(await waitFor(() => document.getElementById("never"), 50, 10)).toBeNull();
  });
});
