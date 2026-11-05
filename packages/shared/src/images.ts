import { imageUrl } from "./marketplaces";

// Photos are made smaller before upload, in the browser (web app) or the extension's service worker:
// R2 keeps one JPEG per photo, small enough to load quickly and accepted by every marketplace we list on.

// Browser-only APIs, declared here (module scope, so they don't clash with the DOM's) because the API Worker
// also compiles this package and has no canvas types. At runtime these are the browser's globals.
interface Bitmap {
  readonly width: number;
  readonly height: number;
  close(): void;
}
interface Canvas2D {
  fillStyle: string;
  imageSmoothingQuality: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  drawImage(image: Bitmap, x: number, y: number, w: number, h: number): void;
}
declare const createImageBitmap: (blob: Blob, options?: { imageOrientation?: "from-image" | "none" }) => Promise<Bitmap>;
declare const OffscreenCanvas: new (
  width: number,
  height: number,
) => { getContext(type: "2d"): Canvas2D | null; convertToBlob(options: { type: string; quality: number }): Promise<Blob> };

/** Longest edge of a stored photo. Plenty for listings (eBay zooms from 1600px) and for the AI. */
export const PHOTO_MAX_EDGE = 1600;
/** JPEG quality: visually the same as the camera's file at a fraction of the size. */
export const PHOTO_QUALITY = 0.85;

/** Size that fits within `max` on its longest edge, keeping the aspect ratio. Never enlarges. */
export function fitWithin(width: number, height: number, max = PHOTO_MAX_EDGE): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Downscales a photo to PHOTO_MAX_EDGE and re-encodes it as JPEG. A re-encoded photo has the camera's EXIF
 * rotation applied and its metadata (including GPS location) dropped. Transparent areas become white.
 *
 * Returns the original when re-encoding doesn't help: a GIF (may be animated), a format this browser
 * can't decode (e.g. HEIC outside Safari), or a file that is already small enough and wouldn't shrink.
 */
export async function optimizePhoto(blob: Blob): Promise<Blob> {
  const type = blob.type.split(";")[0]!.trim();
  if (type === "image/gif") return blob;
  let bitmap: Bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    return blob;
  }
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return blob;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, 0, 0, width, height);
    const out = await canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_QUALITY });
    // Already well compressed at a fine size: keep it rather than store a bigger copy.
    const resized = width !== bitmap.width || height !== bitmap.height;
    if (!resized && out.size >= blob.size && /^image\/(jpeg|png|webp)$/.test(type)) return blob;
    return out;
  } catch {
    return blob;
  } finally {
    bitmap.close();
  }
}

// ------------------------------------------------------------------ serving

/** Display sizes, in CSS pixels × 2 for high-density screens. */
export const PHOTO_WIDTHS = {
  /** Small thumbnails: photo strips, tables, the extension's side panel (40–70px). */
  thumb: 160,
  /** Grid cards and upload tiles (up to ~240px). */
  card: 480,
  /** The main photo on the item page (up to ~560px). */
  large: 1200,
  /** The lightbox: the stored size, just in a lighter format. */
  full: PHOTO_MAX_EDGE,
} as const;
export type PhotoSize = keyof typeof PHOTO_WIDTHS;

/** Hosts with Cloudflare Image Transformations turned on. Elsewhere (local dev, workers.dev) photos are served as stored. */
const RESIZING_HOSTS = new Set(["stockandlist.com"]);

/**
 * URL for showing a photo at a size: resized by Cloudflare and sent as AVIF or WebP to browsers that take
 * them (format=auto), cached at the edge. The stored JPEG is untouched; listing uploads use imageUrl.
 */
export function photoUrl(base: string, key: string, size: PhotoSize): string {
  const origin = base.replace(/\/$/, "");
  if (!RESIZING_HOSTS.has(new URL(origin).hostname)) return imageUrl(origin, key);
  return `${origin}/cdn-cgi/image/width=${PHOTO_WIDTHS[size]},fit=scale-down,format=auto,quality=80/images/${key}`;
}
