/**
 * UI DSL — the structured representation the planner emits.
 *
 * The model is NEVER allowed to write raw values for:
 *   - colors      (must be a `ColorToken`)
 *   - spacing     (must be a `SpacingToken`)
 *   - typography  (must be a `TypeToken` / `EmphasisToken`)
 *   - executable data logic (data is inline JSON or a declarative reference)
 *
 * Naming convention:
 *   `XxxSchema`   — the Zod schema (the source of truth)
 *   `Xxx`         — the inferred TypeScript type
 *   `XxxSpec`     — a top-level shape (e.g. `DashboardSpec`)
 */
import { z } from "zod";
import {
  DatasetDefinitionSchema,
  DatasetRefSchema,
} from "@/data/querySchema";

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

export const LayoutSchema = z.object({
  /** Number of section columns occupied by this tile. */
  columnSpan: z.number().int().min(1).max(12).optional(),
  /** Optional explicit 1-based starting column; array order remains reading order. */
  columnStart: z.number().int().min(1).max(12).optional(),
  /** Number of implicit grid rows occupied by this tile. */
  rowSpan: z.number().int().min(1).max(6).optional(),
  /** Shared tile treatment. Use a surface for narrative content, not around an existing card. */
  surface: z.enum(["none", "card", "subtle", "accent"]).optional(),
  padding: z.enum(["none", "compact", "comfortable"]).optional(),
  verticalAlign: z.enum(["start", "center", "end", "stretch"]).optional(),
});
export type Layout = z.infer<typeof LayoutSchema>;

const layoutField = LayoutSchema.optional();

/* ============================================================
   Leaf nodes
   ============================================================ */

export const MetricCardSchema = z.object({
  type: z.literal("metricCard"),
  id: idField,
  label: z.string().min(1),
  value: z.union([z.number(), z.string()]).optional(),
  valueRef: z.union([
    CapabilityRefSchema,
    DatasetRefSchema.extend({ pick: z.string().min(1) }),
  ]).optional(),
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
  layout: layoutField,
});
export type MetricCard = z.infer<typeof MetricCardSchema>;

export const InlineChartDataSchema = z.array(
  z.record(
    z.string(),
    z.union([z.string(), z.number(), z.boolean(), z.null()]),
  ),
);
export type InlineChartData = z.infer<typeof InlineChartDataSchema>;

export const ChartDataSchema = z.union([
  CapabilityRefSchema,
  DatasetRefSchema,
  InlineChartDataSchema,
]);
export type ChartData = z.infer<typeof ChartDataSchema>;

export const ChartKindSchema = z.enum([
  "line",
  "area",
  "bar",
  "composed",
  "scatter",
  "pie",
  "donut",
  "radar",
  "radialBar",
  "funnel",
  "treemap",
]);

const AxisFormatSchema = z.union([
  NumberFormat,
  z.enum(["date", "shortDate"]),
]);

export const ChartSeriesSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  type: z
    .enum(["line", "area", "bar", "scatter", "radar", "radialBar", "funnel", "treemap"])
    .optional(),
  color: ColorToken.optional(),
  yAxisId: z.string().min(1).optional(),
  stackId: z.string().min(1).optional(),
  curve: z.enum(["linear", "monotone", "step", "stepBefore", "stepAfter"]).optional(),
  fillOpacity: z.number().min(0).max(1).optional(),
  showDots: z.boolean().optional(),
  showLabels: z.boolean().optional(),
  format: NumberFormat.optional(),
});
export type ChartSeries = z.infer<typeof ChartSeriesSchema>;

export const ChartXAxisSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1).optional(),
  type: z.enum(["category", "number"]).default("category"),
  format: AxisFormatSchema.optional(),
  hide: z.boolean().default(false),
});

export const ChartYAxisSchema = z.object({
  id: z.string().min(1).default("primary"),
  label: z.string().min(1).optional(),
  side: z.enum(["left", "right"]).default("left"),
  format: NumberFormat.default("number"),
  domain: z
    .tuple([
      z.union([z.number(), z.literal("auto"), z.literal("dataMin")]),
      z.union([z.number(), z.literal("auto"), z.literal("dataMax")]),
    ])
    .optional(),
  hide: z.boolean().default(false),
});

export const ChartSchema = z.object({
  type: z.literal("chart"),
  id: idField,
  kind: ChartKindSchema.default("line"),
  title: z.string().min(1),
  /** Context shown above the visualization, directly under its title. */
  description: z.string().optional(),
  /** Explanatory or source note shown underneath the visualization. */
  caption: z.string().min(1).optional(),
  data: ChartDataSchema,
  /** Legacy shorthand. Prefer xAxis + series for new specs. */
  x: z.string().optional(),
  /** Legacy shorthand. Prefer series for new specs. */
  y: z.union([z.string(), z.array(z.string()).min(1)]).optional(),
  xAxis: ChartXAxisSchema.optional(),
  yAxes: z.array(ChartYAxisSchema).min(1).max(2).optional(),
  series: z.array(ChartSeriesSchema).min(1).optional(),
  seriesColors: z.array(ColorToken).optional(),
  height: z.number().int().min(160).max(720).default(280),
  yFormat: NumberFormat.default("number"),
  showLegend: z.boolean().default(true),
  options: z
    .object({
      showGrid: z.boolean().default(true),
      showLegend: z.boolean().optional(),
      showTooltip: z.boolean().default(true),
      legendPosition: z.enum(["top", "right", "bottom", "left"]).default("bottom"),
    })
    .optional(),
  layout: layoutField,
});
export type Chart = z.infer<typeof ChartSchema>;

export const TableSchema = z.object({
  type: z.literal("table"),
  id: idField,
  title: z.string().min(1).optional(),
  data: ChartDataSchema,
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
  layout: layoutField,
});
export type Table = z.infer<typeof TableSchema>;

export const TextSchema = z.object({
  type: z.literal("text"),
  id: idField,
  title: z.string().min(1).optional(),
  content: z.string().min(1),
  tone: toneField,
  as: z.enum(["p", "h1", "h2", "h3", "h4", "blockquote"]).default("p"),
  layout: layoutField,
});
export type Text = z.infer<typeof TextSchema>;

export const CodeBlockSchema = z.object({
  type: z.literal("codeBlock"),
  id: idField,
  title: z.string().min(1).optional(),
  code: z.string().min(1).max(20_000),
  language: z.string().min(1).max(40).optional(),
  caption: z.string().min(1).optional(),
  layout: layoutField,
});
export type CodeBlock = z.infer<typeof CodeBlockSchema>;

export const SeparatorSchema = z.object({
  type: z.literal("separator"),
  id: idField,
  label: z.string().min(1).optional(),
  spacing: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  layout: layoutField,
});
export type Separator = z.infer<typeof SeparatorSchema>;

export const InsightSchema = z.object({
  type: z.literal("insight"),
  id: idField,
  content: z.string().min(1),
  severity: z.enum(["info", "warning", "positive", "negative"]).default("info"),
  title: z.string().optional(),
  layout: layoutField,
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
  layout: layoutField,
});
export type Comparison = z.infer<typeof ComparisonSchema>;

export const LeafSchema = z.discriminatedUnion("type", [
  MetricCardSchema,
  ChartSchema,
  TableSchema,
  TextSchema,
  CodeBlockSchema,
  SeparatorSchema,
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
  columns: z.number().int().min(1).max(12).default(1),
  density: z.enum(["compact", "comfortable", "spacious"]).default("comfortable"),
  children: z.array(LeafSchema).min(1),
});
export type Section = z.infer<typeof SectionSchema>;

const HeroBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("none") }),
  z.object({
    type: z.literal("tone"),
    tone: z.enum(["neutral", "accent", "dark"]).default("neutral"),
  }),
  z.object({
    type: z.literal("gradient"),
    tone: z.enum(["cool", "warm", "forest"]).default("cool"),
  }),
  z.object({
    type: z.literal("image"),
    src: z.string().min(1).refine(
      (value) => value.startsWith("/") || value.startsWith("https://"),
      "Hero image src must be a root-relative path or HTTPS URL.",
    ),
    position: z.enum(["center", "top", "bottom", "left", "right"]).default("center"),
    overlay: z.enum(["none", "light", "dark"]).default("dark"),
  }),
]);

export const HeroSchema = z.object({
  eyebrow: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  variant: z.enum(["minimal", "banner", "cover"]).default("banner"),
  height: z.enum(["compact", "standard", "large"]).default("standard"),
  alignment: z.enum(["left", "center"]).default("left"),
  foreground: z.enum(["auto", "light", "dark"]).default("auto"),
  background: HeroBackgroundSchema.default({ type: "none" }),
});
export type Hero = z.infer<typeof HeroSchema>;

export const DashboardSchema = z.object({
  type: z.literal("dashboard"),
  id: idField,
  title: z.string().min(1),
  description: z.string().optional(),
  generatedFor: z.string().optional(),
  /** Optional presentation layer for the dashboard title and introduction. */
  hero: HeroSchema.optional(),
  /** Named, reusable queries over registered logical sources. */
  datasets: z.record(z.string(), DatasetDefinitionSchema).optional(),
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
  CodeBlockSchema,
  SeparatorSchema,
  InsightSchema,
  ComparisonSchema,
]);
export type AnyNode = z.infer<typeof AnyNodeSchema>;

/** The top-level shape a planner emits. */
export const DashboardSpec = DashboardSchema;
export type DashboardSpec = z.infer<typeof DashboardSchema>;
