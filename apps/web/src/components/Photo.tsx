import { imageUrl, photoUrl, type PhotoSize } from "@jf/shared";
import { useState, type ImgHTMLAttributes } from "react";

/**
 * A stored photo at a display size (resized, AVIF/WebP, by Cloudflare in production). Falls back to the
 * stored file if the resized copy fails, e.g. over the transformation quota.
 */
export function Photo({ k, size, ...img }: { k: string; size: PhotoSize } & Omit<ImgHTMLAttributes<HTMLImageElement>, "src">) {
  const [failed, setFailed] = useState<string | null>(null);
  const origin = window.location.origin;
  const src = failed === k ? imageUrl(origin, k) : photoUrl(origin, k, size);
  return <img alt="" decoding="async" {...img} src={src} onError={() => failed !== k && setFailed(k)} />;
}
