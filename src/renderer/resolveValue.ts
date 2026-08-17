/**
 * Resolve an inline value OR a capability ref to a primitive value or array.
 *
 * Used by MetricCard, Comparison, Chart, and Table to fetch data lazily.
 */
import { resolveCapability } from "@/data/capabilityResolver";
import type { CapabilityRef, ChartData } from "@/dsl/schema";

export function resolvePrimitive(
  inline: unknown,
  ref: CapabilityRef | undefined,
  /** Path inside the resolved object to pick (e.g. "total", "average"). */
  pick?: string,
): number | string {
  if (inline !== undefined) {
    if (typeof inline === "number" || typeof inline === "string") return inline;
  }
  if (ref) {
    const data = resolveCapability(ref) as Record<string, unknown>;
    if (pick) {
      const v = data[pick];
      if (typeof v === "number" || typeof v === "string") return v;
    }
    // Default: first numeric field
    for (const k of Object.keys(data)) {
      const v = data[k];
      if (typeof v === "number") return v;
    }
  }
  return 0;
}

export function resolveRows(ref: CapabilityRef): Array<Record<string, unknown>>;
export function resolveRows(ref: ChartData): Array<Record<string, unknown>>;
export function resolveRows(ref: ChartData): Array<Record<string, unknown>> {
  if (Array.isArray(ref)) return ref;
  if ("dataset" in ref) return [];
  const data = resolveCapability(ref);
  if (!Array.isArray(data)) return [];
  const rows = data as Array<Record<string, unknown>>;
  // Apply the planner's optional `where` filter. Each entry is a strict
  // equality match — the planner scopes a chart/table to a subset of
  // rows without needing server-side query support.
  if (ref.where) {
    return rows.filter((row) =>
      Object.entries(ref.where!).every(
        ([field, want]) => row[field] === want,
      ),
    );
  }
  return rows;
}

/**
 * Resolve a key in a row, with light aliasing for the common cases where the
 * planner invents field names that don't match the actual data shape.
 *
 * - If the row has the exact key, return it.
 * - Otherwise, try a small list of common aliases for that key.
 *   The aliases are picked from the row's actual shape (so we only fall back
 *   to a key the row really has), which keeps the table honest.
 * - Otherwise, return undefined and let the caller render "—".
 *
 * Examples:
 *   lookupKey({name:"Brisket plate",...}, "product")     -> "Brisket plate"  (alias: name)
 *   lookupKey({category,orders,revenue,share}, "orderShare") -> 0.85       (alias: share)
 *   lookupKey({name:"Ada"}, "name")                       -> "Ada"          (exact)
 *   lookupKey({name:"Ada"}, "missing")                    -> undefined
 */
const KEY_ALIASES: Record<string, string[]> = {
  // People / products
  product: ["name", "productName", "label", "title"],
  productName: ["name", "product", "label", "title"],
  customer: ["name", "customerName", "label", "title"],
  customerName: ["name", "customer", "label", "title"],
  // Fractions / shares
  orderShare: ["share", "sharePct", "fraction", "pct"],
  sharePct: ["share", "orderShare", "fraction", "pct"],
  share: ["orderShare", "sharePct", "fraction", "pct"],
  // Singulars that the planner often invents
  revenue: ["total", "amount", "value", "sum"],
  orders: ["count", "total", "n", "numOrders"],
  date: ["day", "bucket", "label", "ts", "timestamp"],
  hour: ["hourOfDay", "h", "time"],
  // Display fields
  category: ["cat", "type", "group"],
  segment: ["tier", "tier", "group"],
};

export function lookupKey(
  row: Record<string, unknown>,
  key: string,
): unknown {
  if (key in row) return row[key];
  const aliases = KEY_ALIASES[key];
  if (!aliases) return undefined;
  for (const a of aliases) {
    if (a in row) return row[a];
  }
  return undefined;
}
