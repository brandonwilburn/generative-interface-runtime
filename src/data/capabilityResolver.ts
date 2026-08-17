import type { CapabilityRef } from "@/dsl/schema";
import { DATA } from "./mockData";

type Params = NonNullable<CapabilityRef["params"]>;
type Resolver = (params: Params) => unknown;

let dynamicResolvers: Record<string, () => unknown> = {};

export function setDynamicResolvers(resolvers: Record<string, () => unknown>): void {
  dynamicResolvers = resolvers;
}

function rangeDays(value: unknown): number {
  if (value === "7d") return 7;
  return 30;
}

function revenueRows(params: Params) {
  return DATA.revenueSeries30d.slice(-rangeDays(params.range));
}

const builtInResolvers: Record<string, Resolver> = {
  "merchant.getRevenue": (params) => ({
    total: revenueRows(params).reduce((total, row) => total + row.revenue, 0),
  }),
  "merchant.getOrders": (params) => ({
    total: revenueRows(params).reduce((total, row) => total + row.orders, 0),
  }),
  "merchant.getAverageTicket": (params) => {
    const rows = revenueRows(params);
    const revenue = rows.reduce((total, row) => total + row.revenue, 0);
    const orders = rows.reduce((total, row) => total + row.orders, 0);
    return { average: orders === 0 ? 0 : revenue / orders };
  },
  "merchant.getRevenueSeries": revenueRows,
  "merchant.getTopProducts": (params) => {
    const by = params.by === "orders" ? "orders" : "revenue";
    const requestedLimit = typeof params.limit === "number" ? params.limit : 5;
    return [...DATA.topProducts]
      .sort((a, b) => b[by] - a[by])
      .slice(0, Math.max(0, requestedLimit));
  },
  "merchant.getRetentionCohort": (params) =>
    DATA.cohorts.find((row) => row.cohort === params.cohort) ?? DATA.cohorts[0],
  "merchant.getComparison": (params) => {
    const metric = params.metric;
    if (metric === "orders" || metric === "averageTicket") {
      return DATA.comparison[metric];
    }
    return DATA.comparison.revenue;
  },
  "merchant.getLowestDay": () => DATA.lowestDay30d,
  "orders.getHourlyPattern": () => DATA.hourlyPattern,
  "customers.getTopCustomers": (params) => {
    const requestedLimit = typeof params.limit === "number" ? params.limit : 10;
    return DATA.topCustomers.slice(0, Math.max(0, requestedLimit));
  },
  "inventory.getCategoryMix": () => DATA.categoryMix30d,
};

export function resolveCapability(ref: CapabilityRef): unknown {
  const dynamic = dynamicResolvers[ref.capability];
  if (dynamic) return dynamic();

  const resolver = builtInResolvers[ref.capability];
  return resolver ? resolver(ref.params ?? {}) : {};
}
