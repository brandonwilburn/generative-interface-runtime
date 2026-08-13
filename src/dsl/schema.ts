/**
 * UI DSL — the structured representation the planner emits.
 *
 * The model is NEVER allowed to write raw values for:
 *   - colors      (must be a `ColorToken`)
 *   - spacing     (must be a `SpacingToken`)
 *   - typography  (must be a `TypeToken` / `EmphasisToken`)
 *   - data        (must be a `CapabilityRef`, resolved at render time)
 *
 * Naming convention:
 *   `XxxSchema`   — the Zod schema (the source of truth)
 *   `Xxx`         — the inferred TypeScript type
 *   `XxxSpec`     — a top-level shape (e.g. `DashboardSpec`)
 */
import { z } from "zod";

/* ============================================================
   Tokens
   ============================================================ */

export const ColorToken = z.enum([
  "fg.primary",
  "fg.secondary",
  "fg.muted",
  "fg.disabled",
  "fg.inverse",
  "accent.fg",
  "accent.bg",
  "status.positive",
  "status.warning",
  "status.negative",
  "status.info",
  "chart.1",
  "chart.2",
  "chart.3",
  "chart.4",
  "chart.5",
  "chart.6",
]);
export type ColorToken = z.infer<typeof ColorToken>;

export const EmphasisToken = z.enum(["primary", "secondary", "subtle"]);
export type EmphasisToken = z.infer<typeof EmphasisToken>;

/* ============================================================
   Capability reference — data the planner can request
   ============================================================ */

export const CapabilityRefSchema = z.object({
  capability: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  /**
   * Client-side filter applied to the resolver's result. Each entry is
   * `field → value`; rows match when every field equals the given value.
   * Lets the planner scope a chart/table to e.g. a single day or
   * category without changing the underlying capability.
   */
  where: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});
export type CapabilityRef = z.infer<typeof CapabilityRefSchema>;

/* ============================================================
   Formatters
   ============================================================ */

export const NumberFormat = z.enum([
  "currency",
  "currency-cents",
  "percent",
  "number",
  "compact",
  "bar",
]);
export type NumberFormat = z.infer<typeof NumberFormat>;

/* ============================================================
   Shared fields
   ============================================================ */

const idField = z.string().min(1).optional();
const toneField = z.enum(["neutral", "emphasis", "subtle"]).default("neutral");

/* ============================================================
   Leaf nodes
   ============================================================ */

export const MetricCardSchema = z.object({
  type: z.literal("metricCard"),
  id: idField,
  label: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  valueRef: CapabilityRefSchema.optional(),
  format: NumberFormat.default("number"),
  delta: z
    .object({
      value: z.number(),
      direction: z.enum(["up", "down", "flat"]),
      compare: z.string().optional(),
    })
    .optional(),
  emphasis: EmphasisToken.default("secondary"),
  caption: z.string().optional(),
});
export type MetricCard = z.infer<typeof MetricCardSchema>;

export const ChartSchema = z.object({
  type: z.literal("chart"),
  id: idField,
  kind: z.enum(["line", "bar", "area", "pie"]).default("line"),
  title: z.string().min(1),
  data: CapabilityRefSchema,
  x: z.string(),
  y: z.union([z.string(), z.array(z.string())]),
  seriesColors: z.array(ColorToken).optional(),
  height: z.number().int().min(120).max(480).default(220),
  yFormat: NumberFormat.default("number"),
  showLegend: z.boolean().default(true),
});
export type Chart = z.infer<typeof ChartSchema>;

export const TableSchema = z.object({
  type: z.literal("table"),
  id: idField,
  title: z.string().min(1).optional(),
  data: CapabilityRefSchema,
  columns: z
    .array(
      z.object({
        key: z.string().min(1),
        label: z.string().min(1),
        format: NumberFormat.optional(),
        align: z.enum(["left", "right", "center"]).default("left"),
      }),
    )
    .min(1),
  pageSize: z.number().int().min(1).max(100).default(8),
  emptyMessage: z.string().default("No data to show."),
});
export type Table = z.infer<typeof TableSchema>;

export const TextSchema = z.object({
  type: z.literal("text"),
  id: idField,
  content: z.string().min(1),
  tone: toneField,
  as: z.enum(["p", "h1", "h2", "h3", "h4", "blockquote"]).default("p"),
});
export type Text = z.infer<typeof TextSchema>;

export const InsightSchema = z.object({
  type: z.literal("insight"),
  id: idField,
  content: z.string().min(1),
  severity: z.enum(["info", "warning", "positive", "negative"]).default("info"),
  title: z.string().optional(),
});
export type Insight = z.infer<typeof InsightSchema>;

export const ComparisonSchema = z.object({
  type: z.literal("comparison"),
  id: idField,
  title: z.string().min(1),
  metric: z.string(),
  left: z.object({ label: z.string(), value: z.union([z.number(), z.string()]) }),
  right: z.object({ label: z.string(), value: z.union([z.number(), z.string()]) }),
  format: NumberFormat.default("number"),
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const LeafSchema = z.discriminatedUnion("type", [
  MetricCardSchema,
  ChartSchema,
  TableSchema,
  TextSchema,
  InsightSchema,
  ComparisonSchema,
]);
export type Leaf = z.infer<typeof LeafSchema>;

/* ============================================================
   Composite nodes
   ============================================================ */

export const SectionSchema = z.object({
  type: z.literal("section"),
  id: idField,
  title: z.string().optional(),
  description: z.string().optional(),
  columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  children: z.array(LeafSchema).min(1),
});
export type Section = z.infer<typeof SectionSchema>;

export const DashboardSchema = z.object({
  type: z.literal("dashboard"),
  id: idField,
  title: z.string().min(1),
  description: z.string().optional(),
  generatedFor: z.string().optional(),
  children: z.array(SectionSchema).min(1),
});
export type Dashboard = z.infer<typeof DashboardSchema>;

export const AnyNodeSchema = z.discriminatedUnion("type", [
  DashboardSchema,
  SectionSchema,
  MetricCardSchema,
  ChartSchema,
  TableSchema,
  TextSchema,
  InsightSchema,
  ComparisonSchema,
]);
export type AnyNode = z.infer<typeof AnyNodeSchema>;

/** The top-level shape a planner emits. */
export const DashboardSpec = DashboardSchema;
export type DashboardSpec = z.infer<typeof DashboardSchema>;
