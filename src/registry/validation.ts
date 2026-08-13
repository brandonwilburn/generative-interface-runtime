/**
 * Deterministic validation.
 *
 * The structural schema (Zod) only checks shape. The rules here check
 * composition, density, semantics. Every rule has an id, a severity,
 * and a message; violations are returned as data so the planner can
 * revise the spec.
 *
 * AI critics may run after this; they never replace it.
 */
import type { AnyNode, DashboardSpec, Leaf, Section } from "@/dsl/schema";

export type Severity = "error" | "warning";

export interface Violation {
  rule: string;
  severity: Severity;
  message: string;
  /** JSON-path-ish pointer to the offending node, for the planner to revise. */
  path?: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
}

const TONE_OK = (s: string) => s === "neutral" || s === "emphasis" || s === "subtle";

/* ============================================================
   Tree walking
   ============================================================ */

function pathJoin(parent: string | undefined, key: string | number): string {
  if (parent === undefined) return String(key);
  return `${parent}.${key}`;
}

/* ============================================================
   Individual rule functions
   ============================================================ */

function checkDashboardChildren(spec: DashboardSpec, out: Violation[]): void {
  if (spec.children.length === 0) {
    out.push({
      rule: "D-001",
      severity: "error",
      message: "Dashboard must contain at least one section.",
      path: "children",
    });
  }
  if (spec.children.length > 8) {
    out.push({
      rule: "D-013",
      severity: "warning",
      message: "Dashboard has more than 8 sections — consider progressive disclosure.",
      path: "children",
    });
  }
  let primaryCount = 0;
  for (const [i, section] of spec.children.entries()) {
    for (const [j, child] of section.children.entries()) {
      if (child.type === "metricCard" && child.emphasis === "primary") {
        primaryCount++;
        if (primaryCount > 1) {
          out.push({
            rule: "D-004",
            severity: "error",
            message: "Only one metricCard may have emphasis: \"primary\" per dashboard.",
            path: `children.${i}.children.${j}`,
          });
        }
      }
    }
  }
}

function checkSection(section: Section, path: string, out: Violation[]): void {
  if (![1, 2, 3, 4].includes(section.columns)) {
    out.push({
      rule: "D-005",
      severity: "error",
      message: `Section columns must be 1–4 (got ${section.columns}).`,
      path,
    });
  }
  if (section.children.length > 4) {
    out.push({
      rule: "D-003",
      severity: "warning",
      message: `Section has ${section.children.length} leaves; max recommended is 4.`,
      path,
    });
  }
  // Duplicate label check
  const seen = new Set<string>();
  for (const [j, child] of section.children.entries()) {
    if (child.type === "metricCard") {
      if (seen.has(child.label)) {
        out.push({
          rule: "D-010",
          severity: "error",
          message: `Duplicate metricCard label "${child.label}" in section.`,
          path: `${path}.children.${j}`,
        });
      }
      seen.add(child.label);
    }
  }
}

function checkLeaf(leaf: Leaf, path: string, out: Violation[]): void {
  switch (leaf.type) {
    case "metricCard": {
      if (!leaf.label || leaf.label.trim().length === 0) {
        out.push({
          rule: "D-007",
          severity: "error",
          message: "metricCard requires a non-empty label.",
          path,
        });
      }
      if (leaf.value === undefined && !leaf.valueRef) {
        out.push({
          rule: "D-007b",
          severity: "error",
          message: "metricCard must have either a value or a valueRef.",
          path,
        });
      }
      break;
    }
    case "chart": {
      if (!leaf.data?.capability) {
        out.push({
          rule: "D-008",
          severity: "error",
          message: "chart must reference a capability.",
          path,
        });
      }
      // A11y: title acts as the accessible name.
      if (!leaf.title) {
        out.push({
          rule: "A-001",
          severity: "warning",
          message: "chart should have a title for screen readers.",
          path,
        });
      }
      break;
    }
    case "table": {
      if (!leaf.data?.capability) {
        out.push({
          rule: "D-008",
          severity: "error",
          message: "table must reference a capability.",
          path,
        });
      }
      if (leaf.columns.length === 0) {
        out.push({
          rule: "D-009",
          severity: "error",
          message: "table must have at least one column.",
          path,
        });
      }
      // Duplicate column keys would silently collide (lookupKey matches the
      // first one) and the second column would render the same data twice.
      const colKeys = new Set<string>();
      for (const [k, col] of leaf.columns.entries()) {
        if (colKeys.has(col.key)) {
          out.push({
            rule: "D-014",
            severity: "error",
            message: `Duplicate table column key "${col.key}".`,
            path: `${path}.columns.${k}`,
          });
        }
        colKeys.add(col.key);
      }
      break;
    }
    case "text": {
      if (!leaf.content || leaf.content.trim().length === 0) {
        out.push({
          rule: "D-007c",
          severity: "error",
          message: "text must have non-empty content.",
          path,
        });
      }
      if (!TONE_OK(leaf.tone)) {
        out.push({
          rule: "A-002",
          severity: "error",
          message: `text.tone must be one of neutral|emphasis|subtle (got ${leaf.tone}).`,
          path,
        });
      }
      break;
    }
    case "insight": {
      if (!leaf.content || leaf.content.trim().length === 0) {
        out.push({
          rule: "D-007d",
          severity: "error",
          message: "insight must have non-empty content.",
          path,
        });
      }
      if (!["info", "warning", "positive", "negative"].includes(leaf.severity)) {
        out.push({
          rule: "D-012",
          severity: "error",
          message: `insight.severity must be info|warning|positive|negative.`,
          path,
        });
      }
      break;
    }
    case "comparison": {
      if (!leaf.left.label || !leaf.right.label) {
        out.push({
          rule: "D-007e",
          severity: "error",
          message: "comparison must have a label for each side.",
          path,
        });
      }
      break;
    }
  }
}

/* ============================================================
   Public entry point
   ============================================================ */

export function validateSpec(spec: unknown): ValidationResult {
  const violations: Violation[] = [];
  // The caller is expected to have parsed with Zod already. We trust the
  // shape but do not re-parse; rules here operate on the typed object.
  const node = spec as AnyNode;
  if (node.type !== "dashboard") {
    violations.push({
      rule: "D-000",
      severity: "error",
      message: "Top-level spec must be a dashboard.",
    });
    return { valid: violations.every((v) => v.severity !== "error"), violations };
  }
  checkDashboardChildren(node, violations);
  for (const [i, section] of node.children.entries()) {
    const sectionPath = pathJoin("children", i);
    checkSection(section, sectionPath, violations);
    for (const [j, leaf] of section.children.entries()) {
      checkLeaf(leaf, pathJoin(sectionPath, `children.${j}`), violations);
    }
  }
  const valid = violations.every((v) => v.severity !== "error");
  return { valid, violations };
}
