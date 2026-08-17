/**
 * Component registry.
 *
 * Every component the planner may emit MUST be registered here so its purpose
 * and usage guidance can be included in planner context.
 *
 * Adding a component also requires a schema, renderer branch, validation, and
 * tests. See README.md for the complete checklist.
 */

export type ComponentCategory = "metric" | "viz" | "data" | "narrative" | "composite";

export interface ComponentDescriptor {
  /** Type name used in the DSL. Must match a Zod schema in `src/dsl/schema.ts`. */
  type: string;
  category: ComponentCategory;
  /** One-line purpose statement. Goes to the planner. */
  purpose: string;
  /** When the planner should reach for this component. */
  useWhen: string[];
  /** When the planner should NOT use this component. */
  avoidWhen: string[];
  /** Allowed parents (by component type or "root"). */
  allowedParents: string[];
  /** Whether this component can be a top-level (dashboard) child. */
  canBeDashboardChild: boolean;
  /** Whether this component is a leaf (no children). */
  isLeaf: boolean;
  /** Whether this component is interactive (focus order, aria-label required). */
  interactive: boolean;
  /** A minimal example emitted by the planner. */
  example: Record<string, unknown>;
}

export const COMPONENT_REGISTRY: ComponentDescriptor[] = [
  {
    type: "dashboard",
    category: "composite",
    purpose: "Root container. Holds optional hero presentation, named datasets, and body sections.",
    useWhen: ["Always — the planner always emits a dashboard as the top-level spec."],
    avoidWhen: ["Never at non-root positions."],
    allowedParents: ["root"],
    canBeDashboardChild: false,
    isLeaf: false,
    interactive: false,
    example: {
      type: "dashboard",
      title: "Monthly performance",
      hero: {
        eyebrow: "Monthly review",
        variant: "banner",
        background: { type: "tone", tone: "neutral" },
      },
      children: [
        {
          type: "section",
          columns: 1,
          children: [
            {
              type: "metricCard",
              label: "Revenue",
              value: 48210,
              format: "currency",
            },
          ],
        },
      ],
    },
  },
  {
    type: "section",
    category: "composite",
    purpose: "A horizontal band of related content with a shared column grid.",
    useWhen: [
      "Grouping 2–4 related items (e.g. hero metrics, charts, a table + insight).",
      "Establishing visual rhythm between dashboard regions.",
      "Composing full-width, asymmetric, and chart-plus-narrative tile arrangements.",
    ],
    avoidWhen: [
      "Adding a title-only wrapper around one item; use a minimal one-column section instead.",
      "Using extra sections where one coherent grid would communicate the grouping.",
    ],
    allowedParents: ["dashboard"],
    canBeDashboardChild: true,
    isLeaf: false,
    interactive: false,
    example: {
      type: "section",
      columns: 3,
      title: "Headline metrics",
      children: [
        {
          type: "metricCard",
          label: "Revenue",
          value: 48210,
          format: "currency",
          emphasis: "primary",
        },
      ],
    },
  },
  {
    type: "metricCard",
    category: "metric",
    purpose: "A single labeled number, optionally with a delta vs. another period.",
    useWhen: [
      "Communicating one number clearly.",
      "Establishing a headline metric for the dashboard body.",
    ],
    avoidWhen: [
      "Showing many numbers at once (use a table).",
      "Showing only a label and no number (use text).",
    ],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "metricCard",
      label: "Revenue",
      value: 48210,
      format: "currency",
      delta: { value: 12.4, direction: "up", compare: "vs last month" },
      emphasis: "primary",
    },
  },
  {
    type: "chart",
    category: "viz",
    purpose: "A Recharts-backed visualization configured entirely through JSON.",
    useWhen: [
      "Showing trends (line, area), comparisons (bar, composed), or relationships (scatter).",
      "Showing part-to-whole or hierarchical data (pie, donut, funnel, treemap).",
      "Showing multivariate or radial data (radar, radialBar).",
      "Combining multiple series, stacks, or y-axes in one chart.",
      "Visualizing a named dataset produced by the SQLite query compiler.",
    ],
    avoidWhen: [
      "Showing fewer than 3 data points (use a metricCard or comparison).",
      "Showing tabular data (use table).",
      "Pie with more than 6 slices — use a bar chart instead, slices become unreadable.",
    ],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "chart",
      kind: "line",
      title: "Daily revenue",
      description: "Actual revenue over the selected period.",
      caption: "Use the trend to identify acceleration or unusual daily movement.",
      data: { capability: "merchant.getRevenueSeries", params: { range: "30d" } },
      xAxis: { key: "date", type: "category" },
      yAxes: [{ id: "primary", format: "currency", side: "left" }],
      series: [
        {
          key: "revenue",
          label: "Revenue",
          type: "line",
          color: "chart.1",
          yAxisId: "primary",
        },
      ],
      options: { showGrid: true, showLegend: true, showTooltip: true },
      height: 280,
      layout: { columnSpan: 8, rowSpan: 1 },
    },
  },
  {
    type: "table",
    category: "data",
    purpose: "A compact tabular view of multi-row structured data.",
    useWhen: [
      "Listing items with several attributes (top products, recent orders).",
      "Showing row-level or aggregated results from a named dataset.",
    ],
    avoidWhen: ["Fewer than 3 rows (use text or insight instead)."],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "table",
      title: "Top products",
      data: { capability: "merchant.getTopProducts", params: { range: "30d", limit: 5 } },
      columns: [
        { key: "name", label: "Product" },
        { key: "orders", label: "Orders", format: "number", align: "right" },
        { key: "revenue", label: "Revenue", format: "currency", align: "right" },
      ],
    },
  },
  {
    type: "text",
    category: "narrative",
    purpose: "A short paragraph or heading. Explanatory copy.",
    useWhen: [
      "Setting context, summarizing a finding, or labeling a section.",
      "Placing interpretation beside or underneath a chart by assigning a tile span.",
    ],
    avoidWhen: ["Long-form content (keep under ~3 sentences)."],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "text",
      title: "What changed",
      content: "Revenue dipped mid-month due to a weather event and recovered by week 4.",
      tone: "neutral",
      layout: { columnSpan: 4, padding: "comfortable", verticalAlign: "center" },
    },
  },
  {
    type: "codeBlock",
    category: "narrative",
    purpose: "A safe, non-executable code or configuration example with an optional title and caption.",
    useWhen: [
      "Showing JSON, SQL examples, formulas, commands, or implementation details inside a dashboard.",
      "Giving the reader a reproducible snippet alongside analysis.",
    ],
    avoidWhen: [
      "Showing ordinary prose (use text).",
      "Attempting to execute code — codeBlock is display-only.",
    ],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "codeBlock",
      title: "Dataset definition",
      language: "json",
      code: "{\n  \"source\": \"user.website_traffic\",\n  \"transform\": { \"limit\": 100 }\n}",
      caption: "This configuration is validated before it is compiled into SQL.",
    },
  },
  {
    type: "separator",
    category: "narrative",
    purpose: "A horizontal divider between distinct rows or ideas inside a section.",
    useWhen: [
      "Separating chart rows, narrative groups, or a summary from supporting detail.",
      "Creating visual rhythm without adding another card or background.",
    ],
    avoidWhen: [
      "Between every tile; use it only where the content meaningfully changes.",
      "As a substitute for a section title.",
    ],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "separator",
      spacing: "comfortable",
      layout: { columnSpan: 12 },
    },
  },
  {
    type: "insight",
    category: "narrative",
    purpose: "A short highlighted callout — finding, warning, or opportunity.",
    useWhen: [
      "Surfacing a single important takeaway the user should not miss.",
    ],
    avoidWhen: ["Multi-sentence explanations (use text)."],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "insight",
      severity: "positive",
      title: "Strong week 4",
      content: "Revenue exceeded forecast by 18% on Friday and Saturday.",
    },
  },
  {
    type: "comparison",
    category: "composite",
    purpose: "Side-by-side comparison of two values of the same metric.",
    useWhen: [
      "Comparing the same metric across two periods or segments (this week vs last week).",
    ],
    avoidWhen: [
      "Different metrics on each side (use a section with two metricCards instead).",
    ],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "comparison",
      title: "Revenue this week vs last",
      metric: "Revenue",
      left: { label: "Last week", value: 9210 },
      right: { label: "This week", value: 11480 },
      format: "currency",
    },
  },
];

/** Build a planner-facing summary — small, structured, cheap to send. */
export interface ComponentSummary {
  type: string;
  category: ComponentCategory;
  purpose: string;
  useWhen: string[];
  example: Record<string, unknown>;
}

export function summarizeForPlanner(): ComponentSummary[] {
  return COMPONENT_REGISTRY.map(({ type, category, purpose, useWhen, example }) => ({
    type,
    category,
    purpose,
    useWhen,
    example,
  }));
}

export function getDescriptor(type: string): ComponentDescriptor | undefined {
  return COMPONENT_REGISTRY.find((c) => c.type === type);
}
