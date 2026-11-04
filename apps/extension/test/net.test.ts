import { afterEach, describe, expect, it, vi } from "vitest";
import { NetworkError, fetchBlob, fetchRetry, mapLimit, withRetry } from "../src/lib/net";

const fast = { backoffMs: [1, 1, 1] };

afterEach(() => vi.unstubAllGlobals());

describe("withRetry / fetchRetry", () => {
  it("retries a dropped connection until it works", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    const res = await fetchRetry("https://x.test/a", {}, fast);
    expect(await res.text()).toBe("ok");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("retries server hiccups, then hands back the last response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => new Response("busy", { status: 503 })));
    const res = await fetchRetry("https://x.test/a", {}, fast);
    expect(res.status).toBe(503);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("doesn't retry a real answer like 404, or when told to try once", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no", { status: 404 })));
    expect((await fetchRetry("https://x.test/a", {}, fast)).status).toBe(404);
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(fetchRetry("https://x.test/a", {}, { ...fast, tries: 1, what: "Jewel Finder" })).rejects.toThrow(
      /Couldn't reach Jewel Finder: the connection failed 1 times/,
    );
  });

  it("gives up with a readable NetworkError, and times out a stuck attempt", async () => {
    let calls = 0;
    const err = await withRetry<never>(
      (signal) =>
        new Promise((_, reject) => {
          calls++;
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
      { ...fast, tries: 2, timeoutMs: 20, what: "a photo" },
    ).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.message).toMatch(/^Couldn't reach a photo: the connection failed 2 times/);
    expect(calls).toBe(2);
  });

  it("fetchBlob retries a body that breaks off halfway", async () => {
    let n = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        n++;
        const res = new Response("photo-bytes");
        if (n === 1) vi.spyOn(res, "blob").mockRejectedValue(new TypeError("network error"));
        return res;
      }),
    );
    expect(await (await fetchBlob("https://x.test/p.jpg", {}, fast)).text()).toBe("photo-bytes");
    expect(n).toBe(2);
  });
});

describe("mapLimit", () => {
  it("keeps order and caps how many run at once", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([30, 10, 20, 5, 1], 2, async (ms, i) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, ms));
      running--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4]);
    expect(peak).toBe(2);
  });
});
