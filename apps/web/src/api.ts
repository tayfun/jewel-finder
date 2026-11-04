import type { ApiError, ItemWithListings } from "@jf/shared";

const TOKEN_KEY = "jf.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.error);
  }
}

/** Called on any 401 so the app can drop back to the login screen. */
let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; body?: BodyInit; contentType?: string } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  if (init.contentType) headers["Content-Type"] = init.contentType;

  const res = await fetch(path, {
    method: init.method ?? (init.json !== undefined || init.body ? "POST" : "GET"),
    headers,
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    throw new HttpError(res.status, data as ApiError);
  }
  return data as T;
}

/** Fetches these items one by one: id → item, or null if it's gone. Items that fail otherwise are left out. */
export async function fetchItems(ids: string[]): Promise<Map<string, ItemWithListings | null>> {
  const out = new Map<string, ItemWithListings | null>();
  await Promise.all(
    ids.map(async (id) => {
      try {
        out.set(id, await api<ItemWithListings>(`/api/items/${id}`));
      } catch (e) {
        if (e instanceof HttpError && e.status === 404) out.set(id, null);
      }
    }),
  );
  return out;
}
