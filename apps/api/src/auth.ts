import { sign, verify } from "hono/jwt";

// Workers caps PBKDF2 at 100k iterations.
const ITERATIONS = 100_000;
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const expected = unb64(hash);
  const actual = await derive(password, unb64(salt), Number(iter));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i]! ^ expected[i]!;
  return diff === 0;
}

export interface TokenClaims {
  /** AccountDO id (hex). */
  sub: string;
  email: string;
}

export function issueToken(claims: TokenClaims, secret: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return sign({ ...claims, iat: now, exp: now + TOKEN_TTL_SECONDS }, secret, "HS256");
}

export async function readToken(token: string, secret: string): Promise<TokenClaims | null> {
  try {
    const payload = await verify(token, secret, "HS256");
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
