/**
 * Quick smoke test for the runtime pipeline.
 *
 * Runs: mock planner → Zod parse → deterministic validator
 * against a handful of intents. No browser needed.
 *
 * Run: `npm run smoke`
 */
import { MockPlanner } from "@/planner/mockPlanner";
import { AnyNodeSchema, DashboardSpec } from "@/dsl/schema";
import { validateSpec } from "@/registry/validation";
import { CAPABILITY_CATALOG } from "@/registry/capabilities";
import { COMPONENT_REGISTRY, summarizeForPlanner } from "@/registry/components";
import { DESIGN_CONSTITUTION_SHORT } from "@/planner/planner";

const planner = new MockPlanner();
const ctxBase = {
  capabilities: CAPABILITY_CATALOG,
  components: summarizeForPlanner(),
  constitution: DESIGN_CONSTITUTION_SHORT,
};

const baseSpec = await planner.plan("Show me how the business performed this month", ctxBase);

const cases: string[] = [
  "Show me how the business performed this month",
  "Why was revenue lower last week?",
  "What about this week?",
  "Show top products",
  "When are we busiest?",
  "Who are our top customers?",
  "Show me category mix",
  "Show all chart types",
  "Build the Northstar annual performance dashboard",
  "Add customer retention",
  "Add hourly patterns",
  "Add top customers",
  "Add category mix",
  "Simplify and prioritize the top",
  "junk intent that should still render something reasonable",
];

let pass = 0;
let fail = 0;

const MODIFY_INTENTS = new Set([
  "Add customer retention",
  "Add hourly patterns",
  "Add top customers",
  "Add category mix",
  "Simplify and prioritize the top",
]);

const GALLERY_KINDS = [
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
] as const;

for (const intent of cases) {
  const isModify = MODIFY_INTENTS.has(intent);
  const ctx = isModify ? { ...ctxBase, currentSpec: baseSpec.spec } : ctxBase;
  const out = await planner.plan(intent, ctx);
  const parsed = DashboardSpec.safeParse(out.spec);
  if (!parsed.success) {
    fail++;
    console.log(`✗ ${intent}: schema invalid: ${parsed.error.message}`);
    continue;
  }
  const v = validateSpec(parsed.data);
  if (!v.valid) {
    fail++;
    console.log(`✗ ${intent}: ${v.violations.length} violation(s)`);
    for (const violation of v.violations) {
      console.log(`    [${violation.rule}] ${violation.message} @ ${violation.path ?? ""}`);
    }
    continue;
  }
  if (intent === "Show all chart types") {
    const charts = parsed.data.children.flatMap((section) =>
      section.children.filter((child) => child.type === "chart"),
    );
    const kinds = new Set(charts.map((chart) => chart.kind));
    const missingKinds = GALLERY_KINDS.filter((kind) => !kinds.has(kind));
    if (missingKinds.length > 0) {
      fail++;
      console.log(`✗ ${intent}: gallery is missing ${missingKinds.join(", ")}`);
      continue;
    }
    if (!charts.every((chart) => Array.isArray(chart.data))) {
      fail++;
      console.log(`✗ ${intent}: every gallery chart must demonstrate inline JSON data`);
      continue;
    }
    if (!charts.every((chart) => chart.xAxis?.key && chart.series && chart.series.length > 0)) {
      fail++;
      console.log(`✗ ${intent}: every gallery chart must declare xAxis and series`);
      continue;
    }
    if (!charts.every((chart) => chart.layout?.columnSpan && chart.layout.rowSpan)) {
      fail++;
      console.log(`✗ ${intent}: every gallery chart must demonstrate width and height placement controls`);
      continue;
    }
    const line = charts.find((chart) => chart.kind === "line");
    const composed = charts.find((chart) => chart.kind === "composed");
    if (!line?.series || line.series.length < 2 || !composed?.series || composed.series.length < 3) {
      fail++;
      console.log(`✗ ${intent}: gallery must demonstrate multi-series line and composed charts`);
      continue;
    }
  }
  if (intent === "Build the Northstar annual performance dashboard") {
    const datasets = parsed.data.datasets ?? {};
    const datasetLeaves = parsed.data.children.flatMap((section) => section.children).filter(
      (child) => (child.type === "chart" || child.type === "table") && !Array.isArray(child.data) && "dataset" in child.data,
    );
    const showcaseLeaves = parsed.data.children.flatMap((section) => section.children);
    const hasCodeBlock = showcaseLeaves.some((child) => child.type === "codeBlock");
    const hasSeparator = showcaseLeaves.some((child) => child.type === "separator");
    const hasChartCaption = showcaseLeaves.some((child) => child.type === "chart" && Boolean(child.caption));
    const hasHero = parsed.data.hero?.background.type === "image";
    if (Object.keys(datasets).length !== 7 || datasetLeaves.length < 7 || !hasCodeBlock || !hasSeparator || !hasChartCaption || !hasHero) {
      fail++;
      console.log(`✗ ${intent}: expected hero, compiled datasets, narrative tools, and an under-chart caption`);
      continue;
    }
  }
  pass++;
  const sectionCount = parsed.data.children.length;
  const componentCount = parsed.data.children.reduce(
    (acc, s) => acc + s.children.length,
    0,
  );
  console.log(
    `✓ ${intent.padEnd(50)}  ${sectionCount} section(s), ${componentCount} component(s)${out.reasoning ? `  · ${out.reasoning}` : ""}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);

console.log("\n--- Registry examples ---\n");
let exampleFailures = 0;
for (const descriptor of COMPONENT_REGISTRY) {
  const parsed = AnyNodeSchema.safeParse(descriptor.example);
  if (parsed.success) {
    console.log(`✓ ${descriptor.type}`);
  } else {
    exampleFailures++;
    console.log(`✗ ${descriptor.type}: ${parsed.error.message}`);
  }
}
if (exampleFailures > 0) process.exit(1);

/* ============================================================
   Negative tests — confirm the validator catches violations.
   ============================================================ */

console.log("\n--- Negative tests ---\n");

let nPass = 0;
let nFail = 0;

function expectViolation(label: string, spec: unknown, expectedRule: string) {
  const v = validateSpec(spec);
  const has = v.violations.some((x) => x.rule === expectedRule);
  if (has) {
    nPass++;
    console.log(`✓ ${label}`);
  } else {
    nFail++;
    console.log(`✗ ${label}: expected rule ${expectedRule}, got ${JSON.stringify(v.violations.map((x) => x.rule))}`);
  }
}

function expectValid(label: string, spec: unknown) {
  const v = validateSpec(spec);
  if (v.valid) {
    nPass++;
    console.log(`✓ ${label}`);
  } else {
    nFail++;
    console.log(`✗ ${label}: should be valid, got ${v.violations.map((x) => x.rule).join(", ")}`);
  }
}

// Empty dashboard should be invalid (D-001).
expectViolation(
  "Empty dashboard is invalid",
  {
    type: "dashboard",
    title: "Empty",
    children: [],
  },
  "D-001",
);

// Two primary metrics should violate D-004.
expectViolation(
  "Two primary metrics violates D-004",
  {
    type: "dashboard",
    title: "Two primary",
    children: [
      {
        type: "section",
        columns: 2,
        children: [
          {
            type: "metricCard",
            label: "A",
            value: 100,
            format: "number",
            emphasis: "primary",
          },
          {
            type: "metricCard",
            label: "B",
            value: 200,
            format: "number",
            emphasis: "primary",
          },
        ],
      },
    ],
  },
  "D-004",
);

// Duplicate metric label should violate D-010.
expectViolation(
  "Duplicate metric label violates D-010",
  {
    type: "dashboard",
    title: "Duplicate",
    children: [
      {
        type: "section",
        columns: 2,
        children: [
          { type: "metricCard", label: "Revenue", value: 100, format: "number" },
          { type: "metricCard", label: "Revenue", value: 200, format: "number" },
        ],
      },
    ],
  },
  "D-010",
);

// More than four visible tiles in one row should warn (D-003).
expectViolation(
  "Five tiles in one row warns (D-003)",
  {
    type: "dashboard",
    title: "Dense",
    children: [
      {
        type: "section",
        columns: 10,
        children: [
          { type: "metricCard", label: "A", value: 1, format: "number", layout: { columnSpan: 2 } },
          { type: "metricCard", label: "B", value: 2, format: "number", layout: { columnSpan: 2 } },
          { type: "metricCard", label: "C", value: 3, format: "number", layout: { columnSpan: 2 } },
          { type: "metricCard", label: "D", value: 4, format: "number", layout: { columnSpan: 2 } },
          { type: "metricCard", label: "E", value: 5, format: "number", layout: { columnSpan: 2 } },
        ],
      },
    ],
  },
  "D-003",
);

// Valid spec with one primary should be fine.
expectValid("One primary metric is valid", {
  type: "dashboard",
  title: "OK",
  children: [
    {
      type: "section",
      columns: 2,
      children: [
        { type: "metricCard", label: "A", value: 100, format: "number", emphasis: "primary" },
        { type: "metricCard", label: "B", value: 200, format: "number" },
      ],
    },
  ],
});

expectValid("Named dataset transformation is valid", DashboardSpec.parse({
  type: "dashboard",
  title: "Traffic",
  datasets: {
    monthlyTraffic: {
      source: "user.website_traffic",
      transform: {
        filters: [{ field: "status_code", operator: "lessThan", value: 400 }],
        dimensions: [{ field: "timestamp", as: "month", timeBucket: "month" }],
        metrics: [
          { operation: "count", as: "pageViews" },
          { field: "visitor_id", operation: "countDistinct", as: "visitors" },
        ],
        sort: [{ field: "month", direction: "asc" }],
        limit: 24,
      },
    },
  },
  children: [{
    type: "section",
    children: [{
      type: "chart",
      kind: "line",
      title: "Monthly traffic",
      data: { dataset: "monthlyTraffic" },
      xAxis: { key: "month" },
      series: [{ key: "pageViews" }, { key: "visitors" }],
    }],
  }],
}));

expectViolation(
  "Unknown named dataset violates Q-007",
  DashboardSpec.parse({
    type: "dashboard",
    title: "Broken dataset",
    children: [{
      type: "section",
      children: [{
        type: "chart",
        title: "Missing",
        data: { dataset: "missing" },
        xAxis: { key: "month" },
        series: [{ key: "views" }],
      }],
    }],
  }),
  "Q-007",
);

console.log(`\n${nPass} passed, ${nFail} failed`);
if (nFail > 0) process.exit(1);
