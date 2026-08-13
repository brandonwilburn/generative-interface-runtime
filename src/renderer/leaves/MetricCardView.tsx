import { useEffect, useState } from "react";
import type { MetricCard as MetricCardNode } from "@/dsl/schema";
import { resolvePrimitiveAsync } from "@/renderer/resolveValue";
import { formatValue } from "@/renderer/format";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: MetricCardNode;
}

const arrow = { up: "↑", down: "↓", flat: "—" } as const;

export function MetricCardView({ node }: Props) {
  // Async so live API calls work. Inline `value` is returned as-is.
  const [value, setValue] = useState<number | string>(node.value ?? 0);
  const [loading, setLoading] = useState(node.valueRef !== undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    if (!node.valueRef) {
      setValue(node.value ?? 0);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    resolvePrimitiveAsync(undefined, node.valueRef)
      .then((v) => {
        if (!cancelled) setValue(v);
      })
      .catch((e) => {
        if (!cancelled) setLoadError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [node.valueRef, node.value]);
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
      <div className={s["gir-metric__value"]}>
        {loadError ? "—" : loading ? "…" : formatValue(value, node.format)}
      </div>
      {loadError && (
        <div className={s["gir-metric__error"]} role="alert">
          {loadError}
        </div>
      )}
      {node.delta && !loadError && (
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
