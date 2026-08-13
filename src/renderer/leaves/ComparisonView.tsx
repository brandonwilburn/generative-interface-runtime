import type { Comparison as ComparisonNode } from "@/dsl/schema";
import { formatValue } from "@/renderer/format";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: ComparisonNode;
}

export function ComparisonView({ node }: Props) {
  const leftN = Number(node.left.value);
  const rightN = Number(node.right.value);
  const comparable =
    Number.isFinite(leftN) && Number.isFinite(rightN) && leftN !== 0;
  const deltaPct = comparable
    ? ((rightN - leftN) / Math.abs(leftN)) * 100
    : null;
  const direction: "up" | "down" | "flat" | null =
    deltaPct === null
      ? null
      : Math.abs(deltaPct) < 0.05
        ? "flat"
        : deltaPct > 0
          ? "up"
          : "down";
  return (
    <div className={[s["gir-card"], s["gir-comparison"]].join(" ")}>
      <div className={s["gir-comparison__title"]}>
        {node.title} · {node.metric}
      </div>
      <div className={s["gir-comparison__row"]}>
        <div className={s["gir-comparison__side"]}>
          <div className={s["gir-comparison__side-label"]}>{node.left.label}</div>
          <div className={s["gir-comparison__side-value"]}>
            {formatValue(node.left.value, node.format)}
          </div>
        </div>
        <div className={s["gir-comparison__arrow"]} aria-hidden>→</div>
        <div className={[s["gir-comparison__side"], s["gir-comparison__side--right"]].join(" ")}>
          <div className={s["gir-comparison__side-label"]}>{node.right.label}</div>
          <div className={s["gir-comparison__side-value"]}>
            {formatValue(node.right.value, node.format)}
          </div>
        </div>
      </div>
      {direction && (
        <div
          className={[
            s["gir-comparison__delta"],
            s[`gir-comparison__delta--${direction}`],
          ].join(" ")}
          aria-label={`${direction === "up" ? "Increased" : direction === "down" ? "Decreased" : "Unchanged"} by ${Math.abs(deltaPct!).toFixed(1)} percent`}
        >
          <span aria-hidden>
            {direction === "up" ? "↑" : direction === "down" ? "↓" : "—"}
          </span>
          {direction === "flat" ? "No change" : `${Math.abs(deltaPct!).toFixed(1)}%`}
        </div>
      )}
    </div>
  );
}
