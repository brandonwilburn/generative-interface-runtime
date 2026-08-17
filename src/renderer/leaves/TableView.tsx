import { useMemo } from "react";
import type { Table as TableNode } from "@/dsl/schema";
import { lookupKey } from "@/renderer/resolveValue";
import { useResolvedRows } from "@/data/DatasetContext";
import { formatValue } from "@/renderer/format";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: TableNode;
}

function numeric(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  return null;
}

export function TableView({ node }: Props) {
  const resolved = useResolvedRows(node.data);
  const allRows = resolved.rows;
  const rows = useMemo(() => allRows.slice(0, node.pageSize), [allRows, node.pageSize]);

  // Pre-compute max for any "bar" column so each cell scales to the same baseline.
  const barMaxByCol = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of node.columns) {
      if (c.format !== "bar") continue;
      let m = 0;
      for (const r of rows) {
        const v = numeric(lookupKey(r, c.key));
        if (v !== null && Math.abs(v) > Math.abs(m)) m = v;
      }
      out[c.key] = m || 1;
    }
    return out;
  }, [node.columns, rows]);

  return (
    <div className={s["gir-table"]}>
      {node.title && <div className={s["gir-table__title"]}>{node.title}</div>}
      <div className={s["gir-table__scroll"]}>
        <table className={s["gir-table__table"]} aria-label={node.title ?? "Data table"}>
          {node.title && <caption className={s["gir-table__sr-caption"]}>{node.title}</caption>}
          <thead>
            <tr>
              {node.columns.map((c) => (
                <th
                  key={c.key}
                  className={[
                    s["gir-table__th"],
                    c.align === "right" ? s["gir-table__th--right"] : "",
                    c.align === "center" ? s["gir-table__th--center"] : "",
                    c.format === "bar" ? s["gir-table__th--bar"] : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resolved.loading || resolved.error || rows.length === 0 ? (
              <tr>
                <td className={s["gir-table__empty"]} colSpan={node.columns.length}>
                  {resolved.loading ? "Running dataset query…" : resolved.error ?? node.emptyMessage}
                </td>
              </tr>
            ) : (
              rows.map((r, ri) => (
                <tr key={ri} className={s["gir-table__tr"]}>
                  {node.columns.map((c, ci) => {
                    const isBar = c.format === "bar";
                    const cellCls = [
                      s["gir-table__td"],
                      c.align === "right" ? s["gir-table__td--right"] : "",
                      c.align === "center" ? s["gir-table__td--center"] : "",
                      ci === 0 ? s["gir-table__primary"] : "",
                      isBar ? s["gir-table__td--bar"] : "",
                    ]
                      .filter(Boolean)
                      .join(" ");
                    if (isBar) {
                      const v = numeric(lookupKey(r, c.key)) ?? 0;
                      const max = barMaxByCol[c.key] ?? 1;
                      const pct = max > 0 ? Math.max(0, Math.min(100, (v / max) * 100)) : 0;
                      // Display the value in a way that matches the data. If the
                      // value is a fraction (0..1 with abs < 2), show as a
                      // percent — that's how shares/rates are usually read.
                      const isFraction = Math.abs(v) < 2 && v !== 0 && max <= 1;
                      const valueText = isFraction
                        ? `${(v * 100).toFixed(0)}%`
                        : Number.isInteger(v)
                          ? v.toLocaleString()
                          : v.toFixed(1);
                      return (
                        <td key={c.key} className={cellCls}>
                          <span className={s["gir-table__bar"]} aria-hidden>
                            <span
                              className={s["gir-table__bar-fill"]}
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                          <span className={s["gir-table__bar-value"]}>{valueText}</span>
                        </td>
                      );
                    }
                    return (
                      <td key={c.key} className={cellCls}>
                        {c.format && c.format !== "bar"
                          ? formatValue(lookupKey(r, c.key), c.format)
                          : String(lookupKey(r, c.key) ?? "—")}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
