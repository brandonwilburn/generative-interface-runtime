/**
 * Number formatters used by the renderer.
 *
 * These are deterministic and locale-stable (en-US) so screenshots and
 * tests are repeatable. The model never sees these — it picks the format
 * token; the renderer applies it.
 */
import type { NumberFormat } from "@/dsl/schema";

const currencyFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyCentsFmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const decimalFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const percentFmt = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});
const compactFmt = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatValue(v: unknown, format: NumberFormat): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v !== "number" || !isFinite(v)) return "—";
  switch (format) {
    case "currency":
      return currencyFmt.format(v);
    case "currency-cents":
      return currencyCentsFmt.format(v);
    case "percent":
      return percentFmt.format(v);
    case "compact":
      return compactFmt.format(v);
    case "number":
      return Number.isInteger(v) ? numberFmt.format(v) : decimalFmt.format(v);
    case "bar":
      return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
  }
}

export function formatAxisTick(v: number, format: NumberFormat): string {
  if (format === "currency") {
    if (Math.abs(v) >= 1000) return `$${compactFmt.format(v / 1000)}k`;
    if (v === 0) return "$0";
    return `$${Math.round(v)}`;
  }
  // Treat "percent" values as already-decimal shares (0..1), matching
  // formatValue("percent") and the percentFmt Intl behavior. So 1 → "100%",
  // 0.87 → "87%". The previous `v.toFixed(0) + "%"` showed "1%" for 1.0
  // which is wrong.
  if (format === "percent") return percentFmt.format(v);
  if (format === "compact") return compactFmt.format(v);
  if (format === "number") return Math.abs(v) >= 1000 ? compactFmt.format(v) : String(Math.round(v));
  return formatValue(v, format);
}

export function shortDate(iso: string): string {
  // YYYY-MM-DD → "Aug 12"
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
