import type { Settings } from "./schemas";

/** "12.5" → 1250. Returns null for empty input, NaN for garbage. */
export function parseMoney(input: string): number | null {
  const s = input.trim().replace(/[£$€,\s]/g, "");
  if (s === "") return null;
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return Number.NaN;
  return Math.round(Number.parseFloat(s) * 100);
}

/** 1250 → "12.50" (no symbol; for form inputs). */
export function toDecimal(minor: number | null): string {
  return minor == null ? "" : (minor / 100).toFixed(2);
}

export function formatMoney(minor: number | null, currency: Settings["currency"] = "GBP"): string {
  if (minor == null) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 100);
}
