/**
 * Quick smoke test for the runtime pipeline.
 *
 * Runs: mock planner → Zod parse → deterministic validator
 * against a handful of intents. No browser needed.
 *
 * Run: `npm run smoke`
 */
import { MockPlanner } from "../src/planner/mockPlanner.ts";
import { DashboardSpec } from "../src/dsl/schema.ts";
import { validateSpec } from "../src/registry/validation.ts";
import { CAPABILITY_CATALOG } from "../src/registry/capabilities.ts";
import { summarizeForPlanner } from "../src/registry/components.ts";
import { DESIGN_CONSTITUTION_SHORT } from "../src/planner/planner.ts";

const planner = new MockPlanner();
const ctxBase = {
  capabilities: CAPABILITY_CATALOG,
  components: summarizeForPlanner(),
  constitution: DESIGN_CONSTITUTION_SHORT,
};

const cases = [
  "Show me how the business performed this month",
  "Why was revenue lower last week?",
  "What about this week?",
  "Show top products",
  "Add customer retention",
  "Simplify and prioritize the top",
  "junk intent that should still render something reasonable",
];

let pass = 0;
let fail = 0;

for (const intent of cases) {
  const isModify = ["Add customer retention", "Simplify and prioritize the top"].includes(intent);
  const ctx = isModify && cases[0] ? { ...ctxBase, currentSpec: (await planner.plan(cases[0], ctxBase)).spec } : ctxBase;
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
