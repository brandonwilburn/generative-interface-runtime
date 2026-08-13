import { useEffect, useMemo, useState } from "react";
import type { Chart as ChartNode } from "@/dsl/schema";
import { resolveRowsAsync } from "@/renderer/resolveValue";
import { formatAxisTick, shortDate } from "@/renderer/format";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: ChartNode;
}

const PALETTE: Record<string, string> = {
  "chart.1": "var(--color-chart-1)",
  "chart.2": "var(--color-chart-2)",
  "chart.3": "var(--color-chart-3)",
  "chart.4": "var(--color-chart-4)",
  "chart.5": "var(--color-chart-5)",
  "chart.6": "var(--color-chart-6)",
};

const PADDING = { top: 14, right: 12, bottom: 32, left: 52 };

function color(token: string | undefined, idx: number): string {
  if (token && PALETTE[token]) return PALETTE[token];
  const fallback = [`var(--color-chart-1)`, `var(--color-chart-2)`, `var(--color-chart-3)`, `var(--color-chart-4)`];
  return fallback[idx % fallback.length]!;
}

function buildLinePath(
  points: Array<{ x: number; y: number }>,
): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`))
    .join(" ");
}

function buildAreaPath(
  points: Array<{ x: number; y: number }>,
  baseY: number,
): string {
  if (points.length === 0) return "";
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return [
    `M ${first.x} ${baseY}`,
    ...points.map((p) => `L ${p.x} ${p.y}`),
    `L ${last.x} ${baseY}`,
    "Z",
  ].join(" ");
}

interface PieSlice {
  label: string;
  value: number;
  startAngle: number; // radians, 0 = 12 o'clock, clockwise
  endAngle: number;
  color: string;
}

const PIE_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

function polar(cx: number, cy: number, r: number, angleRad: number): [number, number] {
  return [cx + r * Math.sin(angleRad), cy - r * Math.cos(angleRad)];
}

function arcPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
): string {
  // Donut segment path. If rInner is 0 it's a pie slice.
  const [x1, y1] = polar(cx, cy, rOuter, startAngle);
  const [x2, y2] = polar(cx, cy, rOuter, endAngle);
  const [x3, y3] = polar(cx, cy, rInner, endAngle);
  const [x4, y4] = polar(cx, cy, rInner, startAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  if (rInner <= 0) {
    return `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2} Z`;
  }
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${x4} ${y4}`,
    "Z",
  ].join(" ");
}

export function ChartView({ node }: Props) {
  // Async data load — covers BOTH in-memory CSV/JSON rows and live API
  // responses. The resolver normalizes both into an array of records.
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    resolveRowsAsync(node.data)
      .then((r) => {
        if (!cancelled) setRows(r);
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
  }, [node.data]);

  const isPie = node.kind === "pie";
  const pieValueKey = Array.isArray(node.y) ? node.y[0]! : node.y;
  const allYKeys = Array.isArray(node.y) ? node.y : [node.y];

  // Aggregate by `x` for bar and pie. Line/area pass rows through as-is
  // because each row is meant to be a single observation in time. For a
  // pie with `x: "product"` over 48 rows-per-day, this collapses to
  // one slice per product. For a bar with `x: "date"` over 12 hours/day
  // and 4 products, this sums to one bar per date.
  const aggregatedRows = useMemo(() => {
    if (node.kind !== "bar" && node.kind !== "pie") return rows;
    const order: string[] = [];
    const sums = new Map<string, Record<string, unknown>>();
    for (const r of rows) {
      const key = String(r[node.x] ?? "");
      let bucket = sums.get(key);
      if (!bucket) {
        bucket = { [node.x]: r[node.x] };
        sums.set(key, bucket);
        order.push(key);
      }
      for (const k of allYKeys) {
        const prev = Number(bucket[k] ?? 0);
        bucket[k] = prev + Number(r[k] ?? 0);
      }
    }
    return order.map((k) => sums.get(k)!);
  }, [rows, node.x, node.kind, allYKeys]);

  // Pie slice geometry — uses aggregated rows so duplicate x values
  // collapse to one slice.
  const pieSlices: PieSlice[] = useMemo(() => {
    if (!isPie) return [];
    const source = aggregatedRows;
    const total = source.reduce(
      (acc, r) => acc + Math.max(0, Number(r[pieValueKey] ?? 0)),
      0,
    );
    if (total <= 0) return [];
    let cursor = 0;
    return source.map((r, i) => {
      const v = Math.max(0, Number(r[pieValueKey] ?? 0));
      const sweep = (v / total) * Math.PI * 2;
      const start = cursor;
      cursor += sweep;
      return {
        label: String(r[node.x] ?? ""),
        value: v,
        startAngle: start,
        endAngle: cursor,
        color: PIE_COLORS[i % PIE_COLORS.length]!,
      };
    });
  }, [aggregatedRows, pieValueKey, node.x, isPie]);
  const pieTotal = useMemo(
    () => pieSlices.reduce((acc, s) => acc + s.value, 0),
    [pieSlices],
  );

  // ---------- Pie / donut branch ----------
  if (isPie) {
    const width = 720;
    const height = node.height;
    const cx = width / 2;
    const cy = height / 2;
    const rOuter = Math.min(width, height) / 2 - 16;
    const rInner = rOuter * 0.55; // donut hole — total lives inside
    return (
      <div className={s["gir-chart"]} role="figure" aria-label={node.title}>
        <div className={s["gir-chart__header"]}>
          <div className={s["gir-chart__title"]}>{node.title}</div>
          {node.showLegend && pieSlices.length > 0 && (
            <div className={s["gir-chart__legend"]}>
              {pieSlices.map((sl, i) => (
                <span key={`${i}-${sl.label}`} className={s["gir-chart__legend-item"]}>
                  <span
                    className={s["gir-chart__legend-swatch"]}
                    style={{ background: sl.color }}
                    aria-hidden
                  />
                  {sl.label}
                  <span className={s["gir-chart__legend-meta"]}>
                    {Math.round((sl.value / pieTotal) * 100)}%
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={s["gir-chart__svg-wrap"]}>
          <svg
            className={s["gir-chart__svg"]}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label={`${node.title} pie chart`}
          >
            {pieSlices.length === 0 ? (
              <text
                x={cx}
                y={cy}
                className={s["gir-chart__axis-label"]}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                No data
              </text>
            ) : (
              <>
                {pieSlices.map((sl, i) => (
                  <path
                    // Index-prefixed so two slices with the same label
                    // (which can happen if aggregation is bypassed or
                    // the LLM emits a non-aggregating x) don't trip
                    // React's duplicate-key warning.
                    key={`${i}-${sl.label}`}
                    d={arcPath(cx, cy, rOuter, rInner, sl.startAngle, sl.endAngle)}
                    fill={sl.color}
                    stroke="var(--color-bg-surface)"
                    strokeWidth={1.5}
                  >
                    <title>
                      {sl.label}: {sl.value.toLocaleString()} ({Math.round((sl.value / pieTotal) * 100)}%)
                    </title>
                  </path>
                ))}
                <text
                  x={cx}
                  y={cy - 6}
                  className={s["gir-chart__pie-total-label"]}
                  textAnchor="middle"
                >
                  Total
                </text>
                <text
                  x={cx}
                  y={cy + 14}
                  className={s["gir-chart__pie-total-value"]}
                  textAnchor="middle"
                >
                  {formatAxisTick(pieTotal, node.yFormat)}
                </text>
              </>
            )}
          </svg>
        </div>
        <div className={s["gir-chart__source"]}>
          Source · <code>{node.data.capability}</code>
        </div>
      </div>
    );
  }

  // ---------- Line / bar / area branch ----------
  const seriesKeys = allYKeys;
  const chartRows = aggregatedRows;
  const seriesData = useMemo(
    () =>
      seriesKeys.map((k) => ({
        key: k,
        values: chartRows.map((r) => Number(r[k] ?? 0)),
      })),
    [seriesKeys, chartRows],
  );

  const width = 720;
  const height = node.height;
  const innerW = width - PADDING.left - PADDING.right;
  const innerH = height - PADDING.top - PADDING.bottom;

  const allValues = seriesData.flatMap((s) => s.values);
  const yMax = Math.max(0, ...allValues);
  const yMin = 0;
  const yRange = yMax - yMin || 1;
  const xCount = Math.max(chartRows.length, 1);

  const xAt = (i: number): number =>
    PADDING.left + (innerW * i) / Math.max(xCount - 1, 1);
  // For bar/pie-style slot positioning the first data point sits at the
  // CENTER of the first slot, not at the left edge. Without this the first
  // bar's left edge lands at -innerW/(2*xCount) — outside the inner area —
  // and after SVG stretching it visually collides with the y-axis labels.
  const slotW = innerW / xCount;
  const xAtSlot = (i: number): number => PADDING.left + slotW * (i + 0.5);
  const yAt = (v: number): number =>
    PADDING.top + innerH - ((v - yMin) / yRange) * innerH;

  const ticks = 4;
  const yTicks = Array.from({ length: ticks + 1 }, (_, i) => yMin + (yRange * i) / ticks);

  const xLabelEvery = Math.max(1, Math.ceil(xCount / 6));
  const showXLabel = (i: number): boolean => i % xLabelEvery === 0 || i === xCount - 1;

  const seriesColors = seriesKeys.map((_, i) =>
    color(node.seriesColors?.[i], i),
  );

  return (
    <div className={s["gir-chart"]} role="figure" aria-label={node.title}>
      <div className={s["gir-chart__header"]}>
        <div className={s["gir-chart__title"]}>{node.title}</div>
        {node.showLegend && seriesKeys.length > 0 && (
          <div className={s["gir-chart__legend"]}>
            {seriesKeys.map((k, i) => (
              <span key={k} className={s["gir-chart__legend-item"]}>
                <span
                  className={s["gir-chart__legend-swatch"]}
                  style={{ background: seriesColors[i] }}
                  aria-hidden
                />
                {k}
              </span>
            ))}
          </div>
        )}
      </div>

      {loadError && (
        <div className={s["gir-chart__error"]} role="alert">
          {loadError}
        </div>
      )}

      <div className={s["gir-chart__svg-wrap"]}>
        <svg
          className={s["gir-chart__svg"]}
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`${node.title} chart`}
        >
          {yTicks.map((t, i) => {
            // Skip the "0" baseline tick at the bottom — it would collide
            // with the x-axis labels.
            if (i === 0) return null;
            return (
              <g key={i}>
                <line
                  x1={PADDING.left}
                  x2={width - PADDING.right}
                  y1={yAt(t)}
                  y2={yAt(t)}
                  className={s["gir-chart__grid-line"]}
                />
                <text
                  x={PADDING.left - 8}
                  y={yAt(t)}
                  className={s["gir-chart__axis-label"]}
                  textAnchor="end"
                  dominantBaseline="middle"
                >
                  {formatAxisTick(t, node.yFormat)}
                </text>
              </g>
            );
          })}

          {chartRows.length === 0 && (
            <text
              x={(PADDING.left + width - PADDING.right) / 2}
              y={(PADDING.top + height - PADDING.bottom) / 2}
              className={s["gir-chart__axis-label"]}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              No data
            </text>
          )}

          {chartRows.map((r, i) =>
            showXLabel(i) ? (
              <text
                key={`x-${i}`}
                // For a bar chart the bar center is xAtSlot(i) — the label
                // belongs there. For a line/area chart the data point is
                // at xAt(i) — the label belongs there. Mixing these up is
                // what made the labels look detached from the bars.
                x={node.kind === "bar" ? xAtSlot(i) : xAt(i)}
                y={height - PADDING.bottom + 22}
                className={s["gir-chart__axis-label"]}
                // The first and last labels can collide with the chart
                // border. Left-anchor the first, right-anchor the last so
                // they stay inside the viewBox even on a tight fit.
                textAnchor={
                  i === 0
                    ? "start"
                    : i === chartRows.length - 1
                      ? "end"
                      : "middle"
                }
              >
                {shortDate(String(r[node.x] ?? ""))}
              </text>
            ) : null,
          )}

          {node.kind === "bar" ? (
            seriesData.map((series, si) => {
              // Reserve a 1.2× gap between adjacent bars within a slot so
              // groups of bars don't visually fuse.
              const barW = (slotW * 0.8) / Math.max(seriesKeys.length, 1);
              const seriesOffset =
                (si - (seriesKeys.length - 1) / 2) * barW;
              return series.values.map((v, i) => {
                const centerX = xAtSlot(i) + seriesOffset;
                const x = centerX - barW / 2;
                const y = yAt(v);
                const label = String(chartRows[i]?.[node.x] ?? "");
                return (
                  <g key={`${series.key}-${i}`}>
                    {/* Wide invisible hit area for hover/tooltip + accessibility */}
                    <rect
                      x={x}
                      y={y}
                      width={barW}
                      height={Math.max(0, height - PADDING.bottom - y)}
                      fill={seriesColors[si]}
                      rx={2}
                    >
                      <title>
                        {label}
                        {seriesKeys.length > 1 ? ` · ${series.key}` : ""}: {formatAxisTick(v, node.yFormat)}
                      </title>
                    </rect>
                  </g>
                );
              });
            })
          ) : (
            seriesData.map((series, si) => {
              const points = series.values.map((v, i) => ({ x: xAt(i), y: yAt(v) }));
              return (
                <g key={series.key}>
                  {node.kind === "area" && (
                    <path
                      d={buildAreaPath(points, PADDING.top + innerH)}
                      fill={seriesColors[si]}
                      opacity={0.14}
                    />
                  )}
                  <path
                    d={buildLinePath(points)}
                    stroke={seriesColors[si]}
                    strokeWidth={2}
                    fill="none"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                  />
                  {points.map((p, i) => {
                    const v = series.values[i]!;
                    const label = String(chartRows[i]?.[node.x] ?? "");
                    return (
                      <circle
                        key={i}
                        cx={p.x}
                        cy={p.y}
                        r={2.5}
                        fill="var(--color-bg-surface)"
                        stroke={seriesColors[si]}
                        strokeWidth={1.5}
                      >
                        <title>
                          {label}
                          {seriesKeys.length > 1 ? ` · ${series.key}` : ""}: {formatAxisTick(v, node.yFormat)}
                        </title>
                      </circle>
                    );
                  })}
                </g>
              );
            })
          )}
        </svg>
        {loading && (
          <div className={s["gir-chart__loading"]} aria-live="polite">
            Loading…
          </div>
        )}
      </div>

      <div className={s["gir-chart__source"]}>
        Source · <code>{node.data.capability}</code>
      </div>
    </div>
  );
}
