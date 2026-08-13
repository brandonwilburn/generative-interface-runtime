import type { MetricCard as MetricCardNode } from "@/dsl/schema";
import { resolvePrimitive } from "@/renderer/resolveValue";
import { formatValue } from "@/renderer/format";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: MetricCardNode;
}

const arrow = { up: "↑", down: "↓", flat: "—" } as const;

export function MetricCardView({ node }: Props) {
  const value = resolvePrimitive(node.value, node.valueRef);
  const isPrimary = node.emphasis === "primary";
  const cls = [
    s["gir-card"],
    s["gir-metric"],
    isPrimary ? s["gir-metric--primary"] : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls}>
      <div className={s["gir-metric__label"]}>{node.label}</div>
      <div className={s["gir-metric__value"]}>{formatValue(value, node.format)}</div>
      {node.delta && (
        <span
          className={[
            s["gir-metric__delta"],
            s[`gir-metric__delta--${node.delta.direction}`],
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <span aria-hidden>{arrow[node.delta.direction]}</span>
          {node.delta.value.toFixed(1)}%
          {node.delta.compare && (
            <span className={s["gir-metric__compare"]}>{node.delta.compare}</span>
          )}
        </span>
      )}
      {node.caption && <div className={s["gir-metric__caption"]}>{node.caption}</div>}
    </div>
  );
}
