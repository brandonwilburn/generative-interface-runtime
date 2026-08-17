/** Deterministic demo data used by the offline planner and capability layer. */

const dailyRevenue = [
  2480, 2710, 2635, 2890, 3420, 3910, 3650,
  2540, 2785, 2690, 3015, 3510, 4080, 3825,
  2610, 2820, 2745, 3090, 3625, 4210, 3970,
  2680, 2910, 2815, 3180, 3740, 4360, 4120,
  2775, 2995,
];

export const revenueSeries30d = dailyRevenue.map((revenue, index) => {
  const date = new Date(Date.UTC(2026, 6, 1 + index)).toISOString().slice(0, 10);
  return { date, revenue, orders: Math.round(revenue / 29) };
});

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const revenue30d = sum(revenueSeries30d.map((row) => row.revenue));
const orders30d = sum(revenueSeries30d.map((row) => row.orders));
const last7 = revenueSeries30d.slice(-7);
const prior7 = revenueSeries30d.slice(-14, -7);

export const topProducts = [
  { id: "p_brisket", name: "Brisket plate", orders: 712, revenue: 21360 },
  { id: "p_ribs", name: "Smoked ribs", orders: 604, revenue: 19328 },
  { id: "p_pork", name: "Pulled pork sandwich", orders: 681, revenue: 12258 },
  { id: "p_sausage", name: "Jalapeño sausage", orders: 493, revenue: 7888 },
  { id: "p_mac", name: "Mac and cheese", orders: 817, revenue: 5719 },
  { id: "p_beans", name: "Pit beans", orders: 642, revenue: 3852 },
  { id: "p_tea", name: "Sweet tea", orders: 901, revenue: 3154 },
  { id: "p_cobbler", name: "Peach cobbler", orders: 286, revenue: 2574 },
];

export const topCustomers = [
  { id: "c_001", name: "Ada Lovelace", segment: "vip", orders: 47, lifetime: 2340, firstOrder: "2024-02-14", lastOrder: "2026-07-29" },
  { id: "c_002", name: "Grace Hopper", segment: "vip", orders: 41, lifetime: 2185, firstOrder: "2024-05-03", lastOrder: "2026-07-30" },
  { id: "c_003", name: "Katherine Johnson", segment: "vip", orders: 38, lifetime: 1994, firstOrder: "2024-08-19", lastOrder: "2026-07-25" },
  { id: "c_004", name: "Alan Turing", segment: "vip", orders: 31, lifetime: 1768, firstOrder: "2025-01-11", lastOrder: "2026-07-28" },
  { id: "c_005", name: "Margaret Hamilton", segment: "vip", orders: 27, lifetime: 1542, firstOrder: "2025-03-22", lastOrder: "2026-07-21" },
  { id: "c_006", name: "Edsger Dijkstra", segment: "regular", orders: 18, lifetime: 1089, firstOrder: "2025-06-17", lastOrder: "2026-07-19" },
  { id: "c_007", name: "Barbara Liskov", segment: "regular", orders: 16, lifetime: 956, firstOrder: "2025-09-08", lastOrder: "2026-07-27" },
  { id: "c_008", name: "Donald Knuth", segment: "regular", orders: 14, lifetime: 844, firstOrder: "2025-11-12", lastOrder: "2026-07-18" },
  { id: "c_009", name: "Frances Allen", segment: "regular", orders: 11, lifetime: 692, firstOrder: "2026-01-30", lastOrder: "2026-07-23" },
  { id: "c_010", name: "John McCarthy", segment: "new", orders: 4, lifetime: 238, firstOrder: "2026-07-04", lastOrder: "2026-07-26" },
] as const;

export const categoryMix30d = [
  { category: "mains", orders: 2419, revenue: 60980, share: 0.68 },
  { category: "sides", orders: 1459, revenue: 12560, share: 0.14 },
  { category: "drinks", orders: 1832, revenue: 8960, share: 0.10 },
  { category: "dessert", orders: 618, revenue: 7175, share: 0.08 },
] as const;

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const dayFactors = [0.82, 0.86, 0.9, 0.98, 1.18, 1.35, 1.12];
const hourPattern = [4, 6, 10, 20, 29, 24, 13, 9, 12, 24, 35, 39, 27];

export const hourlyPattern = days.flatMap((day, dayIndex) =>
  hourPattern.map((base, hourIndex) => ({
    day,
    hour: hourIndex + 8,
    orders: Math.round(base * dayFactors[dayIndex]!),
  })),
);

export const cohorts = [
  { cohort: "2026-05", newCustomers: 184, retained: 78, rate: 78 / 184 },
  { cohort: "2026-06", newCustomers: 207, retained: 81, rate: 81 / 207 },
  { cohort: "2026-07", newCustomers: 226, retained: 73, rate: 73 / 226 },
];

const priorRevenue = sum(prior7.map((row) => row.revenue));
const currentRevenue = sum(last7.map((row) => row.revenue));
const priorOrders = sum(prior7.map((row) => row.orders));
const currentOrders = sum(last7.map((row) => row.orders));
const lowestDay30d = revenueSeries30d.reduce((lowest, row) =>
  row.revenue < lowest.revenue ? row : lowest,
);

export const DATA = {
  revenueSeries30d,
  topProducts,
  topCustomers,
  categoryMix30d,
  hourlyPattern,
  cohorts,
  aggregates: {
    revenue30d,
    orders30d,
    averageTicket30d: Math.round(revenue30d / orders30d),
    revenue7d: currentRevenue,
    orders7d: currentOrders,
  },
  comparison: {
    revenue: {
      left: { label: "Prior 7 days", value: priorRevenue },
      right: { label: "Last 7 days", value: currentRevenue },
      delta: ((currentRevenue - priorRevenue) / priorRevenue) * 100,
    },
    orders: {
      left: { label: "Prior 7 days", value: priorOrders },
      right: { label: "Last 7 days", value: currentOrders },
      delta: ((currentOrders - priorOrders) / priorOrders) * 100,
    },
    averageTicket: {
      left: { label: "Prior 7 days", value: priorRevenue / priorOrders },
      right: { label: "Last 7 days", value: currentRevenue / currentOrders },
      delta: ((currentRevenue / currentOrders) / (priorRevenue / priorOrders) - 1) * 100,
    },
  },
  lowestDay30d: {
    ...lowestDay30d,
    note: "Lower weekday traffic and fewer large orders drove the dip.",
  },
};
