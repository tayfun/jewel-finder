import { afterEach, describe, expect, it, vi } from "vitest";
import { PHOTO_MAX_EDGE, PHOTO_QUALITY, fitWithin, optimizePhoto } from "./images";

describe("fitWithin", () => {
  it("scales the longest edge down to the limit, keeping the aspect ratio", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: PHOTO_MAX_EDGE, height: 1200 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1200, height: PHOTO_MAX_EDGE });
  });
  it("never enlarges", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

/** Fakes the browser's decoder and canvas: a `w`×`h` image that encodes to `outBytes` bytes. */
function fakeCanvas(w: number, h: number, outBytes: number) {
  const drawn: { width: number; height: number; quality?: number }[] = [];
  vi.stubGlobal("createImageBitmap", async () => ({ width: w, height: h, close() {} }));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        public width: number,
        public height: number,
      ) {}
      getContext() {
        return { fillRect() {}, drawImage() {}, fillStyle: "", imageSmoothingQuality: "" };
      }
      async convertToBlob(o: { type: string; quality: number }) {
        drawn.push({ width: this.width, height: this.height, quality: o.quality });
        return new Blob([new Uint8Array(outBytes)], { type: o.type });
      }
    },
  );
  return drawn;
}

const file = (bytes: number, type: string) => new Blob([new Uint8Array(bytes)], { type });

describe("optimizePhoto", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("downscales a big camera photo to a JPEG", async () => {
    const drawn = fakeCanvas(4032, 3024, 400_000);
    const out = await optimizePhoto(file(3_000_000, "image/jpeg"));
    expect(out.type).toBe("image/jpeg");
    expect(out.size).toBe(400_000);
    expect(drawn).toEqual([{ width: 1600, height: 1200, quality: PHOTO_QUALITY }]);
  });

  it("turns a PNG or WebP into a JPEG when that's smaller", async () => {
    fakeCanvas(1000, 1000, 120_000);
    expect((await optimizePhoto(file(900_000, "image/png"))).type).toBe("image/jpeg");
  });

  it("keeps a small file that re-encoding wouldn't shrink", async () => {
    fakeCanvas(800, 800, 90_000);
    const original = file(60_000, "image/webp");
    expect(await optimizePhoto(original)).toBe(original);
  });

  it("leaves GIFs and formats it can't decode alone", async () => {
    const gif = file(500_000, "image/gif");
    expect(await optimizePhoto(gif)).toBe(gif);
    vi.stubGlobal("createImageBitmap", async () => {
      throw new Error("unsupported");
    });
    const heic = file(2_000_000, "image/heic");
    expect(await optimizePhoto(heic)).toBe(heic);
  });
});
