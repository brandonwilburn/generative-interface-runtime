/**
 * Planner factory.
 *
 * Picks the right planner based on env. Defaults to MockPlanner so the
 * app is always demoable offline.
 */
import { MockPlanner } from "./mockPlanner";
import { OpenAIPlanner } from "./openaiPlanner";
import type { Planner } from "./planner";

export function createPlanner(): Planner {
  const oa = new OpenAIPlanner();
  if (oa.isConfigured()) {
    return oa;
  }
  return new MockPlanner();
}

export type { Planner, PlannerContext, PlannerResult } from "./planner";
export { DESIGN_CONSTITUTION_SHORT } from "./planner";
