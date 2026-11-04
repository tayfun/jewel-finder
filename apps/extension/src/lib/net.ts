// Network calls that survive a slow or flaky connection: a dropped connection ("Failed to fetch"), a
// request that hangs, or a server hiccup is retried a few times with a growing pause before giving up.

/** The connection kept failing: shown to the seller as is. */
export class NetworkError extends Error {}

/** A response worth retrying: the server or a proxy said "try again later". */
const RETRY_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

class RetryableStatus extends Error {
  constructor(readonly response: Response) {
    super(`HTTP ${response.status}`);
  }
}

export interface RetryOptions {
  /** Attempts in all (default 4). */
  tries?: number;
  /** Give up on one attempt after this long (default 90s: slow, not stuck). */
  timeoutMs?: number;
  /** What was being fetched, for the error message ("Jewel Finder", "a photo"). */
  what?: string;
  /** Pauses between attempts, in ms (default 1s, 3s, 7s). */
  backoffMs?: number[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isConnectionError = (e: unknown) =>
  e instanceof TypeError || (e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError" || e.name === "NetworkError"));

/**
 * Runs `attempt` until it succeeds, retrying connection errors, time-outs and RetryableStatus. The attempt
 * should do the whole job (request and reading the body), since a slow body can fail halfway too.
 */
export async function withRetry<T>(attempt: (signal: AbortSignal) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { tries = 4, timeoutMs = 90_000, what = "the server", backoffMs = [1000, 3000, 7000] } = opts;
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await attempt(controller.signal);
    } catch (e) {
      last = e;
      if (!isConnectionError(e) && !(e instanceof RetryableStatus)) throw e;
      if (i === tries - 1) break;
      const retryAfter = e instanceof RetryableStatus ? Number(e.response.headers.get("Retry-After")) * 1000 : 0;
      await sleep(Math.min(Math.max(backoffMs[Math.min(i, backoffMs.length - 1)] ?? 1000, retryAfter || 0), 15_000));
    } finally {
      clearTimeout(timer);
    }
  }
  // Out of tries: a server error is the caller's to report with its status; a dead connection is ours.
  if (last instanceof RetryableStatus) return last.response as T;
  throw new NetworkError(
    `Couldn't reach ${what}: the connection failed ${tries} times. Check your internet connection and try again.`,
  );
}

/**
 * fetch() with retries for a slow connection. Resolves with the response (even an error status once the
 * retries are used up), or throws NetworkError when the connection never worked.
 */
export function fetchRetry(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Response> {
  return withRetry(async (signal) => {
    const res = await fetch(url, { ...init, signal });
    if (RETRY_STATUSES.has(res.status)) throw new RetryableStatus(res);
    return res;
  }, opts);
}

/** Downloads a file with retries; the body is part of each attempt. Throws on an error status. */
export function fetchBlob(url: string, init: RequestInit = {}, opts: RetryOptions = {}): Promise<Blob> {
  return withRetry(async (signal) => {
    const res = await fetch(url, { ...init, signal });
    if (RETRY_STATUSES.has(res.status)) throw new RetryableStatus(res);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    return res.blob();
  }, opts).then((r) => {
    if (r instanceof Response) throw new Error(`Download failed (${r.status})`);
    return r;
  });
}

/** Runs `fn` over `items` with at most `limit` at a time, keeping the order of the results. */
export async function mapLimit<A, B>(items: A[], limit: number, fn: (item: A, index: number) => Promise<B>): Promise<B[]> {
  const out: B[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
