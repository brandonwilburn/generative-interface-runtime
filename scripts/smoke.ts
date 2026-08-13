/**
 * Quick smoke test for the runtime pipeline.
 *
 * Runs: mock planner → Zod parse → deterministic validator
 * against a handful of intents. No browser needed.
 *
 * Run: `npm run smoke`
 */
import { MockPlanner } from "@/planner/mockPlanner";
import { DashboardSpec } from "@/dsl/schema";
import { validateSpec } from "@/registry/validation";
import { CAPABILITY_CATALOG } from "@/registry/capabilities";
import { summarizeForPlanner } from "@/registry/components";
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

// Section with too many children should warn (D-003).
expectViolation(
  "Section with 5 leaves warns (D-003)",
  {
    type: "dashboard",
    title: "Dense",
    children: [
      {
        type: "section",
        columns: 1,
        children: [
          { type: "metricCard", label: "A", value: 1, format: "number" },
          { type: "metricCard", label: "B", value: 2, format: "number" },
          { type: "metricCard", label: "C", value: 3, format: "number" },
          { type: "metricCard", label: "D", value: 4, format: "number" },
          { type: "metricCard", label: "E", value: 5, format: "number" },
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

console.log(`\n${nPass} passed, ${nFail} failed`);
if (nFail > 0) process.exit(1);
