/**
 * Component registry.
 *
 * Every component the planner may emit MUST be registered here. This is
 * the source of truth that:
 *   - the renderer uses to map type → React component
 *   - the planner receives as context (via `summarizeForPlanner`)
 *   - the validator references when enforcing composition rules
 *
 * Adding a new component = add an entry here + add a renderer branch.
 * The validator and planner learn about it automatically.
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
    purpose: "Root container. Holds the entire generated interface.",
    useWhen: ["Always — the planner always emits a dashboard as the top-level spec."],
    avoidWhen: ["Never at non-root positions."],
    allowedParents: ["root"],
    canBeDashboardChild: false,
    isLeaf: false,
    interactive: false,
    example: {
      type: "dashboard",
      title: "Monthly performance",
      children: [{ type: "section", columns: 1, children: [] }],
    },
  },
  {
    type: "section",
    category: "composite",
    purpose: "A horizontal band of related content with a shared column grid.",
    useWhen: [
      "Grouping 2–4 related items (e.g. hero metrics, charts, a table + insight).",
      "Establishing visual rhythm between dashboard regions.",
    ],
    avoidWhen: [
      "A single item (just place it directly in a section with columns=1).",
      "Wrapping a single metricCard by itself at the dashboard level.",
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
      "Establishing a hero metric for the dashboard.",
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
    purpose: "A time-series or category chart (line / bar / area / pie).",
    useWhen: [
      "Showing a trend over time (line, area).",
      "Comparing categories (bar, pie).",
      "Showing part-to-whole proportions across a small number of categories (pie, ≤6 slices).",
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
      data: { capability: "merchant.getRevenueSeries", params: { range: "30d" } },
      x: "date",
      y: "revenue",
      yFormat: "currency",
    },
  },
  {
    type: "table",
    category: "data",
    purpose: "A compact tabular view of multi-row structured data.",
    useWhen: [
      "Listing items with several attributes (top products, recent orders).",
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
    ],
    avoidWhen: ["Long-form content (keep under ~3 sentences)."],
    allowedParents: ["section"],
    canBeDashboardChild: false,
    isLeaf: true,
    interactive: false,
    example: {
      type: "text",
      content: "Revenue dipped mid-month due to a weather event and recovered by week 4.",
      tone: "neutral",
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
