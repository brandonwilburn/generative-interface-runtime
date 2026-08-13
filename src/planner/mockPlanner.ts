/**
 * MockPlanner — deterministic planner for the first vertical slice.
 *
 * Pattern-matches the intent and returns a hand-curated spec backed by
 * the in-memory capability layer. Handles both "create" and "modify" intents.
 *
 * The whole point: prove the runtime end-to-end without an API key.
 */
import type { DashboardSpec, MetricCard, Chart, Table, Insight, Section } from "@/dsl/schema";
import { DATA } from "@/data/mockData";
import type { Planner, PlannerContext, PlannerResult } from "./planner";

const deltaPct = (a: number, b: number): { value: number; direction: "up" | "down" | "flat" } => {
  if (a === 0) return { value: 0, direction: "flat" };
  const v = ((b - a) / a) * 100;
  return {
    value: Math.abs(Number(v.toFixed(1))),
    direction: v > 0.5 ? "up" : v < -0.5 ? "down" : "flat",
  };
};

/* ============================================================
   Typed builders — every defaulted field is set explicitly so the
   literal matches the inferred output type.
   ============================================================ */

function mc(overrides: Partial<MetricCard> & { label: string; value?: number | string }): MetricCard {
  return {
    type: "metricCard",
    format: "number",
    emphasis: "secondary",
    ...overrides,
  };
}

function ch(overrides: Partial<Chart> & { title: string; data: Chart["data"]; x: string; y: Chart["y"] }): Chart {
  return {
    type: "chart",
    kind: "line",
    height: 220,
    yFormat: "number",
    showLegend: true,
    ...overrides,
  };
}

function tb(overrides: Partial<Table> & { data: Table["data"]; columns: Table["columns"] }): Table {
  return {
    type: "table",
    pageSize: 8,
    emptyMessage: "No data to show.",
    ...overrides,
  };
}

function ins(overrides: Partial<Insight> & { content: string; severity: Insight["severity"] }): Insight {
  return { type: "insight", ...overrides };
}

function sec(overrides: Partial<Section> & { children: Section["children"] }): Section {
  return {
    type: "section",
    columns: 1,
    density: "comfortable",
    ...overrides,
  };
}

/* ============================================================
   Spec builders — each returns a valid, renderable spec.
   ============================================================ */

function monthlyPerformance(): DashboardSpec {
  const { aggregates, comparison } = DATA;
  const lastMonthRevenue = comparison.revenue.left.value * 4.3; // synthetic
  const d = deltaPct(lastMonthRevenue, aggregates.revenue30d);

  return {
    type: "dashboard",
    title: "Monthly performance",
    description: "A snapshot of how the business performed over the last 30 days.",
    generatedFor: "Show me how the business performed this month.",
    children: [
      sec({
        title: "Headline",
        columns: 3,
        children: [
          mc({ label: "Revenue (30d)", value: aggregates.revenue30d, format: "currency",
            delta: { ...d, compare: "vs prior 30d" }, emphasis: "primary" }),
          mc({ label: "Orders (30d)", value: aggregates.orders30d, format: "number" }),
          mc({ label: "Average ticket", value: aggregates.averageTicket30d, format: "currency" }),
        ],
      }),
      sec({
        columns: 1,
        children: [
          ch({
            kind: "area",
            title: "Daily revenue",
            data: { capability: "merchant.getRevenueSeries", params: { range: "30d" } },
            x: "date",
            y: "revenue",
            yFormat: "currency",
            height: 240,
            seriesColors: ["chart.1"],
          }),
        ],
      }),
      sec({
        title: "What stood out",
        columns: 2,
        children: [
          tb({
            title: "Top products",
            data: { capability: "merchant.getTopProducts", params: { range: "30d", limit: 6, by: "revenue" } },
            columns: [
              { key: "name", label: "Product", align: "left" },
              { key: "orders", label: "Orders", format: "number", align: "right" },
              { key: "revenue", label: "Revenue", format: "currency", align: "right" },
            ],
            pageSize: 6,
          }),
          ins({
            severity: "positive",
            title: "Strong close",
            content: "The final week beat the prior week by double digits, driven by weekend traffic.",
          }),
        ],
      }),
    ],
  };
}

function revenueDipDiagnostic(): DashboardSpec {
  const low = DATA.lowestDay30d;
  const weekly = DATA.comparison.revenue;
  const d = deltaPct(weekly.left.value, weekly.right.value);

  return {
    type: "dashboard",
    title: "Why revenue dipped last week",
    description: "A diagnostic view of last week's revenue compared to the prior week.",
    generatedFor: "Why was revenue lower last week?",
    children: [
      sec({
        title: "Week-over-week",
        columns: 2,
        children: [
          mc({ label: "This week", value: weekly.right.value, format: "currency",
            delta: { ...d, compare: "vs prior week" }, emphasis: "primary" }),
          mc({ label: "Last week", value: weekly.left.value, format: "currency" }),
        ],
      }),
      sec({
        title: "Daily revenue (last 30 days)",
        columns: 1,
        children: [
          ch({
            kind: "line",
            title: "Daily revenue",
            data: { capability: "merchant.getRevenueSeries", params: { range: "30d" } },
            x: "date",
            y: "revenue",
            yFormat: "currency",
            height: 240,
            seriesColors: ["chart.1"],
          }),
        ],
      }),
      sec({
        title: "What drove it",
        columns: 2,
        children: [
          ins({
            severity: "warning",
            title: `Worst day: ${low.date}`,
            content: `${low.note} Revenue was $${low.revenue.toLocaleString()} across ${low.orders} orders.`,
          }),
          tb({
            title: "Top products (last 30d)",
            data: { capability: "merchant.getTopProducts", params: { range: "30d", limit: 5, by: "orders" } },
            columns: [
              { key: "name", label: "Product", align: "left" },
              { key: "orders", label: "Orders", format: "number", align: "right" },
              { key: "revenue", label: "Revenue", format: "currency", align: "right" },
            ],
            pageSize: 5,
          }),
        ],
      }),
    ],
  };
}

function topProductsView(): DashboardSpec {
  return {
    type: "dashboard",
    title: "Top products",
    description: "Best-selling products over the last 30 days.",
    generatedFor: "Show top products",
    children: [
      sec({
        columns: 1,
        children: [
          tb({
            title: "Top products by revenue",
            data: { capability: "merchant.getTopProducts", params: { range: "30d", limit: 8, by: "revenue" } },
            columns: [
              { key: "name", label: "Product", align: "left" },
              { key: "orders", label: "Orders", format: "number", align: "right" },
              { key: "revenue", label: "Revenue", format: "currency", align: "right" },
            ],
            pageSize: 8,
          }),
        ],
      }),
    ],
  };
}

function hourlyPatternView(): DashboardSpec {
  // Find the peak hour across all days and the peak day.
  const peak = [...DATA.hourlyPattern].sort((a, b) => b.orders - a.orders)[0]!;
  const totalOrders = DATA.hourlyPattern.reduce((acc, c) => acc + c.orders, 0);
  const lunchTotal = DATA.hourlyPattern
    .filter((c) => c.hour >= 11 && c.hour <= 13)
    .reduce((acc, c) => acc + c.orders, 0);
  const dinnerTotal = DATA.hourlyPattern
    .filter((c) => c.hour >= 17 && c.hour <= 20)
    .reduce((acc, c) => acc + c.orders, 0);
  return {
    type: "dashboard",
    title: "When we're busiest",
    description: "Order patterns by day-of-week and hour-of-day, 8-week average.",
    generatedFor: "When are we busiest?",
    children: [
      sec({
        title: "Headline",
        columns: 3,
        children: [
          mc({ label: "Peak slot", value: `${peak.day} ${peak.hour === 12 ? "12pm" : peak.hour > 12 ? `${peak.hour - 12}pm` : `${peak.hour}am`}`, format: "number",
            emphasis: "primary", caption: `${peak.orders} orders on a typical ${peak.day}` }),
          mc({ label: "Lunch share (11–1)", value: lunchTotal / totalOrders, format: "percent" }),
          mc({ label: "Dinner share (5–8)", value: dinnerTotal / totalOrders, format: "percent" }),
        ],
      }),
      sec({
        title: "Hour-by-hour",
        columns: 1,
        children: [
          tb({
            title: "Orders by day × hour (8-week average)",
            data: { capability: "orders.getHourlyPattern", params: { weeks: 8 } },
            columns: [
              { key: "day", label: "Day", align: "left" },
              { key: "hour", label: "Hour", align: "right", format: "number" },
              { key: "orders", label: "Orders", align: "right", format: "bar" },
            ],
            pageSize: 91,
          }),
        ],
      }),
    ],
  };
}

function topCustomersView(): DashboardSpec {
  const vipCount = DATA.topCustomers.filter((c) => c.segment === "vip").length;
  return {
    type: "dashboard",
    title: "Top customers",
    description: "Lifetime spend across our most engaged customers.",
    generatedFor: "Who are our top customers?",
    children: [
      sec({
        title: "Headline",
        columns: 3,
        children: [
          mc({
            label: "Top customer (lifetime)",
            value: DATA.topCustomers[0]!.lifetime,
            format: "currency",
            emphasis: "primary",
            caption: `${DATA.topCustomers[0]!.name} · ${DATA.topCustomers[0]!.orders} orders`,
          }),
          mc({
            label: "VIP customers",
            value: vipCount,
            format: "number",
            caption: "20+ orders in lifetime",
          }),
          mc({
            label: "Avg lifetime (top 10)",
            value: Math.round(
              DATA.topCustomers.reduce((acc, c) => acc + c.lifetime, 0) / DATA.topCustomers.length,
            ),
            format: "currency",
          }),
        ],
      }),
      sec({
        title: "Customer list",
        columns: 1,
        children: [
          tb({
            title: "Top 10 by lifetime spend",
            data: { capability: "customers.getTopCustomers", params: { limit: 10 } },
            columns: [
              { key: "name", label: "Name", align: "left" },
              { key: "segment", label: "Segment", align: "left" },
              { key: "orders", label: "Orders", align: "right", format: "number" },
              { key: "lifetime", label: "Lifetime", align: "right", format: "currency" },
              { key: "lastOrder", label: "Last order", align: "right" },
            ],
            pageSize: 10,
          }),
        ],
      }),
    ],
  };
}

function categoryMixView(): DashboardSpec {
  const total = DATA.categoryMix30d.reduce((acc, r) => acc + r.revenue, 0);
  const mains = DATA.categoryMix30d.find((r) => r.category === "mains")!;
  return {
    type: "dashboard",
    title: "Category mix",
    description: "Where the revenue comes from, by product category.",
    generatedFor: "Show me category mix",
    children: [
      sec({
        title: "Headline",
        columns: 3,
        children: [
          mc({
            label: "Mains share",
            value: mains.share,
            format: "percent",
            emphasis: "primary",
            caption: `${mains.orders.toLocaleString()} orders in the last 30 days`,
          }),
          mc({
            label: "Drinks share",
            value: DATA.categoryMix30d.find((r) => r.category === "drinks")!.share,
            format: "percent",
          }),
          mc({
            label: "Total revenue (30d)",
            value: total,
            format: "currency",
          }),
        ],
      }),
      sec({
        title: "Breakdown",
        columns: 1,
        children: [
          tb({
            title: "Revenue by category (last 30 days)",
            data: { capability: "inventory.getCategoryMix", params: { range: "30d" } },
            columns: [
              { key: "category", label: "Category", align: "left" },
              { key: "orders", label: "Orders", align: "right", format: "number" },
              { key: "revenue", label: "Revenue", align: "right", format: "currency" },
              { key: "share", label: "Share", align: "right", format: "bar" },
            ],
            pageSize: 4,
          }),
        ],
      }),
    ],
  };
}

function thisWeekView(): DashboardSpec {
  const cmp = DATA.comparison;
  const d = deltaPct(cmp.revenue.left.value, cmp.revenue.right.value);
  return {
    type: "dashboard",
    title: "This week",
    description: "Revenue, orders, and average ticket for the last 7 days.",
    generatedFor: "What about this week?",
    children: [
      sec({
        columns: 3,
        children: [
          mc({ label: "Revenue (7d)", value: DATA.aggregates.revenue7d, format: "currency",
            delta: { ...d, compare: "vs prior 7d" }, emphasis: "primary" }),
          mc({ label: "Orders (7d)", value: DATA.aggregates.orders7d, format: "number" }),
          mc({ label: "Avg ticket (7d)", value:
            DATA.aggregates.orders7d > 0
              ? Math.round(DATA.aggregates.revenue7d / DATA.aggregates.orders7d)
              : 0,
            format: "currency" }),
        ],
      }),
      sec({
        columns: 1,
        children: [
          ch({
            kind: "bar",
            title: "Daily revenue (last 7 days)",
            data: { capability: "merchant.getRevenueSeries", params: { range: "7d" } },
            x: "date",
            y: "revenue",
            yFormat: "currency",
            height: 220,
            seriesColors: ["chart.2"],
          }),
        ],
      }),
    ],
  };
}

/* ============================================================
   Modify operations
   ============================================================ */

function addRetentionCohort(spec: DashboardSpec): DashboardSpec {
  const already = spec.children.some((s) =>
    s.children.some((c) => c.type === "table" && c.data.capability === "merchant.getRetentionCohort"),
  );
  if (already) return spec;
  return {
    ...spec,
    children: [
      ...spec.children,
      sec({
        title: "Customer retention",
        columns: 3,
        children: DATA.cohorts.map((c) =>
          mc({
            label: `Retention · ${c.cohort}`,
            value: c.rate,
            format: "percent",
            caption: `${c.retained} of ${c.newCustomers} new customers returned`,
          }),
        ),
      }),
    ],
  };
}

function addHourlyPattern(spec: DashboardSpec): DashboardSpec {
  const already = spec.children.some((s) =>
    s.children.some((c) => c.type === "table" && c.data.capability === "orders.getHourlyPattern"),
  );
  if (already) return spec;
  return {
    ...spec,
    children: [
      ...spec.children,
      sec({
        title: "When we're busiest",
        description: "Order counts by day-of-week × hour-of-day (8-week average).",
        columns: 1,
        children: [
          tb({
            title: "Hourly pattern",
            data: {
              capability: "orders.getHourlyPattern",
              params: { weeks: 8 },
            },
            columns: [
              { key: "day", label: "Day", align: "left" },
              { key: "hour", label: "Hour", align: "right", format: "number" },
              { key: "orders", label: "Orders (8wk avg)", align: "right", format: "bar" },
            ],
            pageSize: 91,
          }),
        ],
      }),
    ],
  };
}

function addTopCustomers(spec: DashboardSpec): DashboardSpec {
  const already = spec.children.some((s) =>
    s.children.some((c) => c.type === "table" && c.data.capability === "customers.getTopCustomers"),
  );
  if (already) return spec;
  return {
    ...spec,
    children: [
      ...spec.children,
      sec({
        title: "Top customers",
        columns: 1,
        children: [
          tb({
            title: "Top customers by lifetime spend",
            data: { capability: "customers.getTopCustomers", params: { limit: 8 } },
            columns: [
              { key: "name", label: "Name", align: "left" },
              { key: "segment", label: "Segment", align: "left" },
              { key: "orders", label: "Orders", align: "right", format: "number" },
              { key: "lifetime", label: "Lifetime", align: "right", format: "currency" },
              { key: "lastOrder", label: "Last order", align: "right" },
            ],
            pageSize: 8,
          }),
        ],
      }),
    ],
  };
}

function addCategoryMix(spec: DashboardSpec): DashboardSpec {
  const already = spec.children.some((s) =>
    s.children.some((c) => c.type === "table" && c.data.capability === "inventory.getCategoryMix"),
  );
  if (already) return spec;
  return {
    ...spec,
    children: [
      ...spec.children,
      sec({
        title: "Category mix",
        columns: 1,
        children: [
          tb({
            title: "Revenue by category (last 30 days)",
            data: { capability: "inventory.getCategoryMix", params: { range: "30d" } },
            columns: [
              { key: "category", label: "Category", align: "left" },
              { key: "orders", label: "Orders", align: "right", format: "number" },
              { key: "revenue", label: "Revenue", align: "right", format: "currency" },
              { key: "share", label: "Share", align: "right", format: "bar" },
            ],
            pageSize: 4,
          }),
        ],
      }),
    ],
  };
}

function simplifyDashboard(spec: DashboardSpec): DashboardSpec {
  return {
    ...spec,
    children: spec.children.slice(0, 2),
  };
}

function prioritizeTop(spec: DashboardSpec): DashboardSpec {
  const reordered = [...spec.children];
  reordered.sort((a, b) => {
    const aPrimary = a.children.some((c) => c.type === "metricCard" && c.emphasis === "primary") ? 1 : 0;
    const bPrimary = b.children.some((c) => c.type === "metricCard" && c.emphasis === "primary") ? 1 : 0;
    return bPrimary - aPrimary;
  });
  return { ...spec, children: reordered };
}

/* ============================================================
   Intent classification
   ============================================================ */

type Intent =
  | { kind: "create"; build: () => DashboardSpec }
  | { kind: "modify"; apply: (spec: DashboardSpec) => DashboardSpec; reason: string };

function classify(intent: string, hasCurrent: boolean): Intent {
  const s = intent.toLowerCase();
  const modify = hasCurrent;

  if (modify && /\b(add|include|show).*(retention|repeat customer)/.test(s)) {
    return { kind: "modify", apply: addRetentionCohort, reason: "Added a customer-retention section with cohort repeat rates." };
  }
  if (modify && /\b(add|include|show).*(hour|busiest|peak|busy|heat|schedule|kitchen)/.test(s)) {
    return { kind: "modify", apply: addHourlyPattern, reason: "Added an hourly-pattern section (day-of-week × hour-of-day)." };
  }
  if (modify && /\b(add|include|show).*(top customer|best customer|vip|loyal|spender)/.test(s)) {
    return { kind: "modify", apply: addTopCustomers, reason: "Added a top-customers table." };
  }
  if (modify && /\b(add|include|show).*(categor|mix|breakdown|menu mix)/.test(s)) {
    return { kind: "modify", apply: addCategoryMix, reason: "Added a category-mix section." };
  }
  if (modify && /\b(simplif|focus|tight|less)/.test(s)) {
    return { kind: "modify", apply: simplifyDashboard, reason: "Trimmed to the headline and the most important chart." };
  }
  if (modify && /\b(priorit|top|important|move up|reorder)/.test(s)) {
    return { kind: "modify", apply: prioritizeTop, reason: "Moved the primary metric to the top." };
  }
  if (modify && /\b(remove|drop|delete).*(table|chart|metric)/.test(s)) {
    return {
      kind: "modify",
      apply: (spec) => ({ ...spec, children: spec.children.slice(0, -1) }),
      reason: "Removed the last section.",
    };
  }

  if (/\bwhy\b.*\b(revenue|sales|low|down|dip|drop)/.test(s) || /\bdiagnos/.test(s)) {
    return { kind: "create", build: revenueDipDiagnostic };
  }
  if (/\bbusiest|peak hour|when.*open|kitchen|hourly|day of week|by hour|by day/.test(s)) {
    return { kind: "create", build: hourlyPatternView };
  }
  if (/\btop customer|best customer|vip|loyal|spender/.test(s)) {
    return { kind: "create", build: topCustomersView };
  }
  if (/\b(categor|mix|breakdown|food vs drink|menu mix|by category)/.test(s)) {
    return { kind: "create", build: categoryMixView };
  }
  if (/\btop product|best\s*seller|menu|items?/.test(s)) {
    return { kind: "create", build: topProductsView };
  }
  if (/\bthis week|last 7|past week|7d/.test(s)) {
    return { kind: "create", build: thisWeekView };
  }
  return { kind: "create", build: monthlyPerformance };
}

/* ============================================================
   MockPlanner
   ============================================================ */

export class MockPlanner implements Planner {
  readonly name = "MockPlanner";

  async plan(intent: string, ctx: PlannerContext): Promise<PlannerResult> {
    const intent_match = classify(intent, !!ctx.currentSpec);
    if (intent_match.kind === "modify" && ctx.currentSpec) {
      const next = intent_match.apply(ctx.currentSpec);
      return { spec: next, reasoning: intent_match.reason };
    }
    return { spec: (intent_match as { build: () => DashboardSpec }).build() };
  }
}
