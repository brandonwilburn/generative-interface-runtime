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
  if (section.columns < 1 || section.columns > 12) {
    out.push({
      rule: "D-005",
      severity: "error",
      message: `Section columns must be 1–12 (got ${section.columns}).`,
      path,
    });
  }
  let rowWidth = 0;
  let tilesInRow = 0;
  let maxTilesInRow = 0;
  for (const child of section.children) {
    const span = Math.min(child.layout?.columnSpan ?? 1, section.columns);
    const start = child.layout?.columnStart;
    if (start && (start - 1 < rowWidth || start - 1 + span > section.columns)) {
      rowWidth = 0;
      tilesInRow = 0;
    }
    if (start) rowWidth = start - 1;
    if (rowWidth + span > section.columns) {
      rowWidth = 0;
      tilesInRow = 0;
    }
    rowWidth += span;
    tilesInRow++;
    maxTilesInRow = Math.max(maxTilesInRow, tilesInRow);
    if (rowWidth >= section.columns) {
      rowWidth = 0;
      tilesInRow = 0;
    }
  }
  if (maxTilesInRow > 4) {
    out.push({
      rule: "D-003",
      severity: "warning",
      message: `Section places ${maxTilesInRow} tiles in one row; max recommended is 4.`,
      path,
    });
  }
  // Duplicate label check
  const seen = new Set<string>();
  for (const [j, child] of section.children.entries()) {
    if (child.layout?.columnSpan && child.layout.columnSpan > section.columns) {
      out.push({
        rule: "D-015",
        severity: "error",
        message: `Tile columnSpan ${child.layout.columnSpan} exceeds its section's ${section.columns} columns.`,
        path: `${path}.children.${j}.layout.columnSpan`,
      });
    }
    if (
      child.layout?.columnStart &&
      child.layout.columnStart + (child.layout.columnSpan ?? 1) - 1 > section.columns
    ) {
      out.push({
        rule: "D-022",
        severity: "error",
        message: `Tile starting at column ${child.layout.columnStart} with span ${child.layout.columnSpan ?? 1} exceeds the section grid.`,
        path: `${path}.children.${j}.layout`,
      });
    }
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
      if (!Array.isArray(leaf.data) && !("capability" in leaf.data) && !("dataset" in leaf.data)) {
        out.push({
          rule: "D-008",
          severity: "error",
          message: "chart must provide inline data, a named dataset, or a capability.",
          path,
        });
      }
      if (!leaf.xAxis && !leaf.x) {
        out.push({
          rule: "D-016",
          severity: "error",
          message: "chart must define xAxis.key (or legacy x).",
          path,
        });
      }
      if (!leaf.series && !leaf.y) {
        out.push({
          rule: "D-017",
          severity: "error",
          message: "chart must define at least one series (or legacy y).",
          path,
        });
      }
      const axisIds = new Set((leaf.yAxes ?? [{ id: "primary" }]).map((axis) => axis.id));
      const seriesKeys = new Set<string>();
      for (const [index, series] of (leaf.series ?? []).entries()) {
        if (seriesKeys.has(series.key)) {
          out.push({
            rule: "D-018",
            severity: "error",
            message: `Duplicate chart series key "${series.key}".`,
            path: `${path}.series.${index}`,
          });
        }
        seriesKeys.add(series.key);
        if (series.yAxisId && !axisIds.has(series.yAxisId)) {
          out.push({
            rule: "D-019",
            severity: "error",
            message: `Series "${series.key}" references unknown yAxisId "${series.yAxisId}".`,
            path: `${path}.series.${index}.yAxisId`,
          });
        }
        if (leaf.kind === "composed" && series.type && !["line", "area", "bar"].includes(series.type)) {
          out.push({
            rule: "D-020",
            severity: "error",
            message: `Composed charts only support line, area, and bar series (got "${series.type}").`,
            path: `${path}.series.${index}.type`,
          });
        }
      }
      if (["pie", "donut", "radialBar", "funnel", "treemap"].includes(leaf.kind) && (leaf.series?.length ?? 1) > 1) {
        out.push({
          rule: "D-021",
          severity: "error",
          message: `${leaf.kind} charts accept exactly one series.`,
          path: `${path}.series`,
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
      if (!Array.isArray(leaf.data) && !("capability" in leaf.data) && !("dataset" in leaf.data)) {
        out.push({
          rule: "D-008",
          severity: "error",
          message: "table must provide inline data, a named dataset, or a capability.",
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
    case "codeBlock": {
      if (!leaf.code || leaf.code.trim().length === 0) {
        out.push({
          rule: "D-007f",
          severity: "error",
          message: "codeBlock must have non-empty code.",
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

function checkDatasets(spec: DashboardSpec, out: Violation[]): void {
  const datasets = spec.datasets ?? {};
  for (const [name, definition] of Object.entries(datasets)) {
    const transform = definition.transform;
    if (transform.metrics.length > 0 && transform.select.length > 0) {
      out.push({
        rule: "Q-001",
        severity: "error",
        message: `Dataset "${name}" cannot combine aggregate metrics with plain select fields.`,
        path: `datasets.${name}.transform`,
      });
    }
    const outputs = new Set<string>();
    for (const [index, outputName] of [
      ...transform.select.map((field) => field.as ?? field.field),
      ...transform.dimensions.map((field) => field.as ?? field.field),
      ...transform.metrics.map((metric) => metric.as),
    ].entries()) {
      if (outputs.has(outputName)) {
        out.push({
          rule: "Q-002",
          severity: "error",
          message: `Dataset "${name}" has duplicate output field "${outputName}".`,
          path: `datasets.${name}.transform.outputs.${index}`,
        });
      }
      outputs.add(outputName);
    }
    for (const [index, metric] of transform.metrics.entries()) {
      if (metric.operation !== "count" && !metric.field) {
        out.push({
          rule: "Q-003",
          severity: "error",
          message: `Dataset "${name}" metric "${metric.as}" requires a field.`,
          path: `datasets.${name}.transform.metrics.${index}`,
        });
      }
    }
    for (const [index, filter] of transform.filters.entries()) {
      const noValue = filter.operator === "isNull" || filter.operator === "isNotNull";
      const setOperator = filter.operator === "in" || filter.operator === "notIn";
      if (!noValue && filter.value === undefined) {
        out.push({
          rule: "Q-004",
          severity: "error",
          message: `Dataset "${name}" filter ${filter.operator} requires a value.`,
          path: `datasets.${name}.transform.filters.${index}`,
        });
      } else if (setOperator && !Array.isArray(filter.value)) {
        out.push({
          rule: "Q-005",
          severity: "error",
          message: `Dataset "${name}" filter ${filter.operator} requires an array value.`,
          path: `datasets.${name}.transform.filters.${index}.value`,
        });
      }
    }
    if (outputs.size > 0) {
      for (const [index, sort] of transform.sort.entries()) {
        if (!outputs.has(sort.field)) {
          out.push({
            rule: "Q-006",
            severity: "error",
            message: `Dataset "${name}" sorts by non-output field "${sort.field}".`,
            path: `datasets.${name}.transform.sort.${index}.field`,
          });
        }
      }
    }
  }

  for (const [sectionIndex, section] of spec.children.entries()) {
    for (const [leafIndex, leaf] of section.children.entries()) {
      if ((leaf.type === "chart" || leaf.type === "table") && !Array.isArray(leaf.data) && "dataset" in leaf.data) {
        if (!datasets[leaf.data.dataset]) {
          out.push({
            rule: "Q-007",
            severity: "error",
            message: `${leaf.type} references unknown dataset "${leaf.data.dataset}".`,
            path: `children.${sectionIndex}.children.${leafIndex}.data.dataset`,
          });
        }
      }
      if (leaf.type === "metricCard" && leaf.valueRef && "dataset" in leaf.valueRef && !datasets[leaf.valueRef.dataset]) {
        out.push({
          rule: "Q-007",
          severity: "error",
          message: `metricCard references unknown dataset "${leaf.valueRef.dataset}".`,
          path: `children.${sectionIndex}.children.${leafIndex}.valueRef.dataset`,
        });
      }
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
  checkDatasets(node, violations);
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
