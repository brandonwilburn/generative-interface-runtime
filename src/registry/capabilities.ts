/**
 * Capability catalog.
 *
 * A capability is a named unit of work the runtime can do for the model.
 * The planner never invents data — it requests a `CapabilityRef` and the
 * runtime resolves it. This is the same shape a real tool-calling layer
 * would take: the model proposes, the application executes.
 *
 * Adding a real capability = add a resolver in `src/data/capabilityResolver.ts`
 * and an entry here.
 */

export interface CapabilityParam {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  required: boolean;
  /** For string enums, list valid values. */
  enum?: string[];
  default?: string | number | boolean;
}

export interface CapabilityDescriptor {
  name: string;
  domain: "merchant" | "orders" | "products" | "customers" | "system";
  description: string;
  /** A free-form sentence about when to use it. */
  useWhen: string;
  params: CapabilityParam[];
  /** Return shape, described so the planner knows what fields to reference. */
  returns: string;
}

export const CAPABILITY_CATALOG: CapabilityDescriptor[] = [
  {
    name: "merchant.getRevenue",
    domain: "merchant",
    description: "Total revenue for a time range.",
    useWhen: "User asks for total revenue over a period.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "90d", "mtd", "qtd", "ytd"],
        default: "30d",
      },
    ],
    returns: "{ total: number }",
  },
  {
    name: "merchant.getOrders",
    domain: "orders",
    description: "Total order count for a time range.",
    useWhen: "User asks for order count / volume.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "90d", "mtd"],
        default: "30d",
      },
    ],
    returns: "{ total: number }",
  },
  {
    name: "merchant.getAverageTicket",
    domain: "merchant",
    description: "Average order value (revenue / orders) for a range.",
    useWhen: "User asks for average ticket size or AOV.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "mtd"],
        default: "30d",
      },
    ],
    returns: "{ average: number }",
  },
  {
    name: "merchant.getRevenueSeries",
    domain: "merchant",
    description: "Revenue bucketed by day for a time range.",
    useWhen: "Drawing a time-series chart of revenue.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "90d"],
        default: "30d",
      },
      {
        name: "granularity",
        type: "string",
        description: "Bucket size",
        required: false,
        enum: ["day", "week"],
        default: "day",
      },
    ],
    returns: "Array<{ date: string, revenue: number, orders: number }>",
  },
  {
    name: "merchant.getTopProducts",
    domain: "products",
    description: "Top-selling products for a range.",
    useWhen: "Listing top items by orders or revenue.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "90d"],
        default: "30d",
      },
      {
        name: "limit",
        type: "number",
        description: "Max rows",
        required: false,
        default: 5,
      },
      {
        name: "by",
        type: "string",
        description: "Sort metric",
        required: false,
        enum: ["revenue", "orders"],
        default: "revenue",
      },
    ],
    returns: "Array<{ id, name, orders: number, revenue: number }>",
  },
  {
    name: "merchant.getRetentionCohort",
    domain: "customers",
    description: "Repeat-order rate within a window of new customers.",
    useWhen: "User asks about retention, repeat customers, cohort behavior.",
    params: [
      {
        name: "cohort",
        type: "string",
        description: "Cohort key (e.g. '2026-07')",
        required: true,
      },
      {
        name: "window",
        type: "string",
        description: "Window after acquisition",
        required: false,
        enum: ["14d", "30d", "60d"],
        default: "30d",
      },
    ],
    returns:
      "{ cohort: string, newCustomers: number, retained: number, rate: number }",
  },
  {
    name: "merchant.getComparison",
    domain: "merchant",
    description: "Compare a metric across two ranges.",
    useWhen: "User wants to see a metric for two periods side by side.",
    params: [
      {
        name: "metric",
        type: "string",
        description: "Metric to compare",
        required: true,
        enum: ["revenue", "orders", "averageTicket"],
      },
      {
        name: "left",
        type: "string",
        description: "Left range",
        required: true,
        enum: ["7d", "30d", "mtd", "prev-month"],
      },
      {
        name: "right",
        type: "string",
        description: "Right range",
        required: true,
        enum: ["7d", "30d", "mtd", "prev-month"],
      },
    ],
    returns: "{ left: { label, value }, right: { label, value }, delta: number }",
  },
  {
    name: "merchant.getLowestDay",
    domain: "merchant",
    description: "Returns the day with the lowest revenue in a range, for diagnostics.",
    useWhen: "User asks why revenue was low or what the worst day was.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "90d"],
        default: "30d",
      },
    ],
    returns: "{ date: string, revenue: number, orders: number, note: string }",
  },
  {
    name: "orders.getHourlyPattern",
    domain: "orders",
    description:
      "Order counts bucketed by day-of-week × hour-of-day across the last 8 weeks.",
    useWhen:
      "User asks when the business is busiest, when the kitchen is slammed, peak hours, slow hours.",
    params: [
      {
        name: "weeks",
        type: "number",
        description: "Weeks of history to aggregate",
        required: false,
        default: 8,
      },
    ],
    returns: "Array<{ day: 'Mon'|'Tue'|...|'Sun', hour: number, orders: number }>",
  },
  {
    name: "customers.getTopCustomers",
    domain: "customers",
    description:
      "Top customers by lifetime spend. Includes name, segment, orders, lifetime revenue, and last-order date.",
    useWhen:
      "User asks who the best customers are, VIPs, most loyal, top spenders.",
    params: [
      {
        name: "limit",
        type: "number",
        description: "Max rows",
        required: false,
        default: 10,
      },
      {
        name: "range",
        type: "string",
        description: "Time range key (lifetime if omitted)",
        required: false,
        enum: ["lifetime", "90d", "30d"],
        default: "lifetime",
      },
    ],
    returns:
      "Array<{ id, name, segment: 'vip'|'regular'|'new', orders, lifetime, firstOrder, lastOrder }>",
  },
  {
    name: "inventory.getCategoryMix",
    domain: "products",
    description:
      "Revenue and order share by product category (mains, sides, drinks, dessert) for a time range.",
    useWhen:
      "User asks about category mix, what sells best, food vs drinks, share of revenue.",
    params: [
      {
        name: "range",
        type: "string",
        description: "Time range key",
        required: true,
        enum: ["7d", "30d", "90d"],
        default: "30d",
      },
    ],
    returns:
      "Array<{ category: 'mains'|'sides'|'drinks'|'dessert', orders, revenue, share }>",
  },
];

export function findCapability(name: string): CapabilityDescriptor | undefined {
  return CAPABILITY_CATALOG.find((c) => c.name === name);
}

export function summarizeCapabilitiesForPlanner(): string {
  return CAPABILITY_CATALOG.map((c) => {
    const params = c.params
      .map((p) => `${p.name}${p.required ? "" : "?"}: ${p.enum ? p.enum.join("|") : p.type}${p.default !== undefined ? `=${p.default}` : ""}`)
      .join(", ");
    return `- ${c.name}(${params})  // ${c.description}\n    returns: ${c.returns}\n    use when: ${c.useWhen}`;
  }).join("\n\n");
}
