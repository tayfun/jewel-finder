import type { Account, ApiError } from "@jf/shared";
import { API_URL } from "../config";

const KEY = "auth";

export interface StoredAuth {
  token: string;
  account: Account;
}

export async function getAuth(): Promise<StoredAuth | null> {
  const { [KEY]: auth } = await chrome.storage.local.get(KEY);
  return (auth as StoredAuth | undefined) ?? null;
}

export async function setAuth(auth: StoredAuth | null): Promise<void> {
  if (auth) await chrome.storage.local.set({ [KEY]: auth });
  else await chrome.storage.local.remove(KEY);
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the Jewel Finder API with the stored token (or an explicit one). */
export async function api<T>(
  path: string,
  init: { method?: string; json?: unknown; token?: string } = {},
): Promise<T> {
  const token = init.token ?? (await getAuth())?.token;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.json !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(API_URL + path, {
      method: init.method ?? (init.json !== undefined ? "POST" : "GET"),
      headers,
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
    });
  } catch {
    throw new HttpError(0, `Can't reach Jewel Finder at ${API_URL}`);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({ error: `Request failed (${res.status})` }));
  if (!res.ok) {
    // Only drop the stored session if it was the stored token that got rejected.
    if (res.status === 401 && !init.token && token) await setAuth(null);
    throw new HttpError(res.status, (data as ApiError).error);
  }
  return data as T;
}

/** Reads the `sub` claim without verifying (the server verifies). */
export function tokenSubject(token: string): string | null {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
