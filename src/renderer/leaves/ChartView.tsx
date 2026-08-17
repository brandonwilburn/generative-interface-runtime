import { useMemo } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import type {
  Chart as ChartNode,
  ChartSeries,
  NumberFormat,
} from "@/dsl/schema";
import { useResolvedRows } from "@/data/DatasetContext";
import { formatAxisTick, formatValue, shortDate } from "@/renderer/format";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: ChartNode;
}

const PALETTE = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-6)",
];

const TOKEN_COLORS: Record<string, string> = {
  "chart.1": PALETTE[0]!,
  "chart.2": PALETTE[1]!,
  "chart.3": PALETTE[2]!,
  "chart.4": PALETTE[3]!,
  "chart.5": PALETTE[4]!,
  "chart.6": PALETTE[5]!,
};

function seriesColor(series: ChartSeries, index: number): string {
  return (series.color && TOKEN_COLORS[series.color]) ?? PALETTE[index % PALETTE.length]!;
}

function normalizedSeries(node: ChartNode): ChartSeries[] {
  if (node.series) return node.series;
  const keys = node.y ? (Array.isArray(node.y) ? node.y : [node.y]) : [];
  return keys.map((key, index) => ({
    key,
    label: key,
    color: node.seriesColors?.[index],
    yAxisId: "primary",
  }));
}

function normalizedRows(node: ChartNode, rows: Array<Record<string, unknown>>) {
  // Preserve the prototype's implicit sum-by-category behavior for legacy
  // bar/pie specs. The expressive `series` contract receives rows verbatim.
  if (node.series || !["bar", "pie", "donut"].includes(node.kind)) return rows;
  const xKey = node.xAxis?.key ?? node.x ?? "name";
  const keys = normalizedSeries(node).map((series) => series.key);
  const order: string[] = [];
  const groups = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const groupKey = String(row[xKey] ?? "");
    let group = groups.get(groupKey);
    if (!group) {
      group = { [xKey]: row[xKey] };
      groups.set(groupKey, group);
      order.push(groupKey);
    }
    for (const key of keys) {
      group[key] = Number(group[key] ?? 0) + Number(row[key] ?? 0);
    }
  }
  return order.map((key) => groups.get(key)!);
}

function tickFormatter(format: string | undefined) {
  if (format === "date" || format === "shortDate") {
    return (value: unknown) => shortDate(String(value));
  }
  if (format) return (value: unknown) => formatAxisTick(Number(value), format as NumberFormat);
  return (value: unknown) => String(value);
}

function legendProps(position: "top" | "right" | "bottom" | "left") {
  if (position === "left" || position === "right") {
    return { align: position, verticalAlign: "middle" as const, layout: "vertical" as const };
  }
  return { align: "center" as const, verticalAlign: position, layout: "horizontal" as const };
}

function usesExternalSeriesLegend(node: ChartNode): boolean {
  const position = node.options?.legendPosition ?? "bottom";
  return (
    (position === "top" || position === "bottom") &&
    ["line", "area", "bar", "composed", "scatter", "radar"].includes(node.kind)
  );
}

function SeriesLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className={s["gir-chart__legend"]} role="list" aria-label="Chart legend">
      {series.map((item, index) => (
        <div className={s["gir-chart__legend-item"]} role="listitem" key={item.key}>
          <span className={s["gir-chart__legend-swatch"]} style={{ background: seriesColor(item, index) }} />
          <span>{item.label ?? item.key}</span>
        </div>
      ))}
    </div>
  );
}

function ChartExtras({ node, series }: { node: ChartNode; series: ChartSeries[] }) {
  const showTooltip = node.options?.showTooltip ?? true;
  const showLegend = node.options?.showLegend ?? node.showLegend;
  const position = node.options?.legendPosition ?? "bottom";
  return (
    <>
      {showTooltip && (
        <Tooltip
          contentStyle={{
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-border-subtle)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-2)",
            color: "var(--color-fg-primary)",
            fontSize: "var(--text-xs)",
          }}
          formatter={(value, name, payload) => {
            const payloadKey = typeof payload.dataKey === "string" ? payload.dataKey : undefined;
            const config = series.find((item) => item.key === payloadKey)
              ?? series.find((item) => item.label === String(name));
            const axisFormat = node.yAxes?.find((axis) => axis.id === config?.yAxisId)?.format;
            const scalar = Array.isArray(value) ? value[0] : value;
            return [
              formatValue(scalar, config?.format ?? axisFormat ?? node.yFormat),
              config?.label ?? String(name),
            ];
          }}
          labelFormatter={(label) => tickFormatter(node.xAxis?.format)(label)}
        />
      )}
      {showLegend && !usesExternalSeriesLegend(node) && <Legend {...legendProps(position)} />}
    </>
  );
}

function CartesianView({ node, rows, series }: ChartBodyProps) {
  const xAxis = node.xAxis ?? { key: node.x ?? "name", type: "category" as const, hide: false };
  const yAxes = node.yAxes ?? [{ id: "primary", side: "left" as const, format: node.yFormat, hide: false }];
  const common = {
    data: rows,
    margin: { top: 12, right: 18, bottom: xAxis.label ? 34 : 4, left: 6 },
    accessibilityLayer: true,
  };
  const axes = (
    <>
      {(node.options?.showGrid ?? true) && <CartesianGrid stroke="var(--color-border-subtle)" strokeDasharray="3 3" vertical={false} />}
      <XAxis
        dataKey={xAxis.key}
        type={xAxis.type}
        hide={xAxis.hide}
        tickFormatter={tickFormatter(xAxis.format)}
        tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
        axisLine={{ stroke: "var(--color-border-default)" }}
        tickLine={false}
        label={xAxis.label ? { value: xAxis.label, position: "insideBottom", offset: -12 } : undefined}
      />
      {yAxes.map((axis) => (
        <YAxis
          key={axis.id}
          yAxisId={axis.id}
          orientation={axis.side}
          hide={axis.hide}
          domain={axis.domain}
          tickFormatter={tickFormatter(axis.format)}
          tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={56}
          label={axis.label ? { value: axis.label, angle: -90, position: axis.side === "right" ? "insideRight" : "insideLeft" } : undefined}
        />
      ))}
    </>
  );

  const marks = series.map((item, index) => {
    const type = node.kind === "composed" ? (item.type ?? "line") : node.kind;
    const color = seriesColor(item, index);
    const shared = {
      dataKey: item.key,
      name: item.label ?? item.key,
      yAxisId: item.yAxisId ?? yAxes[0]?.id ?? "primary",
    };
    if (type === "bar") {
      return <Bar key={`${type}-${item.key}`} {...shared} fill={color} stackId={item.stackId} radius={[3, 3, 0, 0]}>{item.showLabels && <LabelList dataKey={item.key} position="top" />}</Bar>;
    }
    if (type === "area") {
      return <Area key={`${type}-${item.key}`} {...shared} type={item.curve ?? "monotone"} stroke={color} fill={color} fillOpacity={item.fillOpacity ?? 0.18} stackId={item.stackId} dot={item.showDots} />;
    }
    return <Line key={`${type}-${item.key}`} {...shared} type={item.curve ?? "monotone"} stroke={color} strokeWidth={2} dot={item.showDots ?? false}>{item.showLabels && <LabelList dataKey={item.key} position="top" />}</Line>;
  });

  const extras = <ChartExtras node={node} series={series} />;
  if (node.kind === "bar") return <BarChart {...common}>{axes}{marks}{extras}</BarChart>;
  if (node.kind === "area") return <AreaChart {...common}>{axes}{marks}{extras}</AreaChart>;
  if (node.kind === "composed") return <ComposedChart {...common}>{axes}{marks}{extras}</ComposedChart>;
  return <LineChart {...common}>{axes}{marks}{extras}</LineChart>;
}

interface ChartBodyProps {
  node: ChartNode;
  rows: Array<Record<string, unknown>>;
  series: ChartSeries[];
}

function ScatterView({ node, rows, series }: ChartBodyProps) {
  const xKey = node.xAxis?.key ?? node.x ?? "x";
  const yAxes = node.yAxes ?? [{ id: "primary", side: "left" as const, format: node.yFormat, hide: false }];
  return (
    <ScatterChart margin={{ top: 12, right: 18, bottom: node.xAxis?.label ? 28 : 12, left: 18 }} accessibilityLayer>
      {(node.options?.showGrid ?? true) && <CartesianGrid stroke="var(--color-border-subtle)" />}
      <XAxis
        type="number"
        dataKey="x"
        name={node.xAxis?.label ?? xKey}
        tickFormatter={tickFormatter(node.xAxis?.format)}
        label={node.xAxis?.label ? { value: node.xAxis.label, position: "insideBottom", offset: -18 } : undefined}
      />
      {yAxes.map((axis) => <YAxis key={axis.id} yAxisId={axis.id} type="number" dataKey="y" name={axis.label ?? axis.id} orientation={axis.side} domain={axis.domain} tickFormatter={tickFormatter(axis.format)} label={axis.label ? { value: axis.label, angle: -90, position: axis.side === "right" ? "insideRight" : "insideLeft" } : undefined} />)}
      {series.map((item, index) => (
        <Scatter
          key={item.key}
          name={item.label ?? item.key}
          yAxisId={item.yAxisId ?? yAxes[0]?.id ?? "primary"}
          fill={seriesColor(item, index)}
          data={rows.map((row) => ({ x: Number(row[xKey]), y: Number(row[item.key]) }))}
        />
      ))}
      <ChartExtras node={node} series={series} />
    </ScatterChart>
  );
}

function PieView({ node, rows, series }: ChartBodyProps) {
  const item = series[0];
  const nameKey = node.xAxis?.key ?? node.x ?? "name";
  if (!item) return null;
  return (
    <PieChart accessibilityLayer>
      <Pie
        data={rows}
        dataKey={item.key}
        nameKey={nameKey}
        name={item.label ?? item.key}
        innerRadius={node.kind === "donut" ? "52%" : 0}
        outerRadius="78%"
        paddingAngle={1}
      >
        {rows.map((_, index) => <Cell key={index} fill={PALETTE[index % PALETTE.length]} />)}
        {item.showLabels && <LabelList dataKey={nameKey} position="outside" />}
      </Pie>
      <ChartExtras node={node} series={series} />
    </PieChart>
  );
}

function RadarView({ node, rows, series }: ChartBodyProps) {
  const xKey = node.xAxis?.key ?? node.x ?? "name";
  return (
    <RadarChart data={rows} outerRadius="70%" accessibilityLayer>
      <PolarGrid stroke="var(--color-border-subtle)" />
      <PolarAngleAxis dataKey={xKey} tick={{ fill: "var(--color-fg-muted)", fontSize: 11 }} />
      <PolarRadiusAxis tick={{ fill: "var(--color-fg-muted)", fontSize: 10 }} />
      {series.map((item, index) => <Radar key={item.key} dataKey={item.key} name={item.label ?? item.key} stroke={seriesColor(item, index)} fill={seriesColor(item, index)} fillOpacity={item.fillOpacity ?? 0.18} />)}
      <ChartExtras node={node} series={series} />
    </RadarChart>
  );
}

function RadialBarView({ node, rows, series }: ChartBodyProps) {
  const item = series[0];
  const nameKey = node.xAxis?.key ?? node.x ?? "name";
  if (!item) return null;
  const radialRows = rows.map((row, index) => ({
    ...row,
    name: String(row[nameKey] ?? ""),
    fill: PALETTE[index % PALETTE.length],
  }));
  return (
    <RadialBarChart data={radialRows} innerRadius="18%" outerRadius="82%" startAngle={90} endAngle={-270} accessibilityLayer>
      <RadialBar dataKey={item.key} name={item.label ?? item.key} background={{ fill: "var(--color-bg-subtle)" }} cornerRadius={6} fill={seriesColor(item, 0)}>{item.showLabels && <LabelList dataKey={item.key} position="insideStart" />}</RadialBar>
      <ChartExtras node={node} series={series} />
    </RadialBarChart>
  );
}

function FunnelView({ node, rows, series }: ChartBodyProps) {
  const item = series[0];
  const nameKey = node.xAxis?.key ?? node.x ?? "name";
  if (!item) return null;
  return (
    <FunnelChart accessibilityLayer>
      <Funnel data={rows} dataKey={item.key} nameKey={nameKey} name={item.label ?? item.key} isAnimationActive={false}>
        {rows.map((_, index) => <Cell key={index} fill={PALETTE[index % PALETTE.length]} />)}
        <LabelList position="right" fill="var(--color-fg-secondary)" dataKey={nameKey} />
      </Funnel>
      <ChartExtras node={node} series={series} />
    </FunnelChart>
  );
}

function ChartBody(props: ChartBodyProps) {
  const { node, rows, series } = props;
  if (node.kind === "pie" || node.kind === "donut") return <PieView {...props} />;
  if (node.kind === "radar") return <RadarView {...props} />;
  if (node.kind === "radialBar") return <RadialBarView {...props} />;
  if (node.kind === "funnel") return <FunnelView {...props} />;
  if (node.kind === "treemap") {
    const item = series[0];
    return item ? <Treemap data={rows} dataKey={item.key} nameKey={node.xAxis?.key ?? node.x ?? "name"} fill={seriesColor(item, 0)} stroke="var(--color-bg-surface)" aspectRatio={4 / 3}><ChartExtras node={node} series={series} /></Treemap> : null;
  }
  if (node.kind === "scatter") return <ScatterView {...props} />;
  return <CartesianView {...props} />;
}

export function ChartView({ node }: Props) {
  const resolvedState = useResolvedRows(node.data);
  const resolved = resolvedState.rows;
  const series = useMemo(() => normalizedSeries(node), [node]);
  const rows = useMemo(() => normalizedRows(node, resolved), [node, resolved]);
  const source = Array.isArray(node.data)
    ? `Inline JSON · ${rows.length} rows`
    : "dataset" in node.data
      ? `Dataset · ${node.data.dataset}`
      : `Source · ${node.data.capability}`;
  const showLegend = node.options?.showLegend ?? node.showLegend;
  const legendPosition = node.options?.legendPosition ?? "bottom";
  const externalLegend = showLegend && usesExternalSeriesLegend(node);

  return (
    <div className={s["gir-chart"]} role="figure" aria-label={node.title}>
      <div className={s["gir-chart__header"]}>
        <div>
          <div className={s["gir-chart__title"]}>{node.title}</div>
          {node.description && <div className={s["gir-chart__description"]}>{node.description}</div>}
        </div>
      </div>
      {externalLegend && legendPosition === "top" && <SeriesLegend series={series} />}
      <div className={s["gir-chart__canvas"]} style={{ height: node.height }}>
        {resolvedState.loading ? (
          <div className={s["gir-chart__empty"]}>Running dataset query…</div>
        ) : resolvedState.error ? (
          <div className={s["gir-chart__empty"]}>{resolvedState.error}</div>
        ) : rows.length === 0 || series.length === 0 ? (
          <div className={s["gir-chart__empty"]}>No data</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <ChartBody node={node} rows={rows} series={series} />
          </ResponsiveContainer>
        )}
      </div>
      {externalLegend && legendPosition === "bottom" && <SeriesLegend series={series} />}
      <div className={s["gir-chart__source"]}>{source}</div>
      {node.caption && <div className={s["gir-chart__caption"]}>{node.caption}</div>}
    </div>
  );
}
