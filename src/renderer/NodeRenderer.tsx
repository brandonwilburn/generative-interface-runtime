import type { AnyNode } from "@/dsl/schema";
import { getDescriptor } from "@/registry/components";
import { MetricCardView } from "./leaves/MetricCardView";
import { ChartView } from "./leaves/ChartView";
import { TableView } from "./leaves/TableView";
import { TextView } from "./leaves/TextView";
import { InsightView } from "./leaves/InsightView";
import { ComparisonView } from "./leaves/ComparisonView";
import { SectionView } from "./SectionView";
import { DashboardView } from "./DashboardView";

interface Props {
  node: AnyNode;
}

/**
 * The dispatcher. Looks up the registered component for a node's `type`
 * and renders it. If a type is unknown the renderer reports it rather
 * than silently dropping it.
 */
export function NodeRenderer({ node }: Props) {
  switch (node.type) {
    case "dashboard":
      return <DashboardView node={node} />;
    case "section":
      return <SectionView node={node} />;
    case "metricCard":
      return <MetricCardView node={node} />;
    case "chart":
      return <ChartView node={node} />;
    case "table":
      return <TableView node={node} />;
    case "text":
      return <TextView node={node} />;
    case "insight":
      return <InsightView node={node} />;
    case "comparison":
      return <ComparisonView node={node} />;
    default: {
      // Exhaustive check.
      const _exhaustive: never = node;
      const desc = getDescriptor((_exhaustive as { type: string }).type);
      return (
        <div
          style={{
            padding: 16,
            border: "1px dashed var(--color-border-strong)",
            borderRadius: 8,
            color: "var(--color-fg-muted)",
            fontSize: 13,
          }}
        >
          Unknown component: <code>{desc?.type ?? "?"}</code>
        </div>
      );
    }
  }
}
