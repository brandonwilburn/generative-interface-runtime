const SOURCE_NAME = "Northstar commerce analytics";
const API_BASE = process.env.GIR_DEV_URL ?? "http://127.0.0.1:5173";

interface Product {
  product: string;
  category: string;
  price: number;
  popularity: number;
}

const products: Product[] = [
  { product: "Orbit Pro", category: "Hardware", price: 249, popularity: 1.2 },
  { product: "Canvas Mini", category: "Hardware", price: 149, popularity: 1.05 },
  { product: "Signal Hub", category: "Hardware", price: 329, popularity: 0.78 },
  { product: "Northstar Plus", category: "Subscriptions", price: 39, popularity: 1.45 },
  { product: "Northstar Teams", category: "Subscriptions", price: 89, popularity: 0.92 },
  { product: "Insight Pack", category: "Add-ons", price: 59, popularity: 0.82 },
  { product: "Automation Pack", category: "Add-ons", price: 79, popularity: 0.74 },
  { product: "Priority Care", category: "Services", price: 119, popularity: 0.56 },
];

const channels = [
  { name: "Organic Search", demand: 1.3, conversion: 0.048, spend: 0.04 },
  { name: "Paid Search", demand: 1.18, conversion: 0.042, spend: 0.34 },
  { name: "Direct", demand: 0.94, conversion: 0.061, spend: 0.01 },
  { name: "Social", demand: 0.82, conversion: 0.031, spend: 0.28 },
  { name: "Email", demand: 0.7, conversion: 0.073, spend: 0.05 },
];

const regions = [
  { name: "North America", demand: 1.25 },
  { name: "Europe", demand: 1.02 },
  { name: "Asia Pacific", demand: 0.9 },
  { name: "Latin America", demand: 0.68 },
];

let randomState = 0x5eed1234;
function random(): number {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 0x100000000;
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const headers = [
  "date", "weekday", "weekday_index", "channel", "region", "product", "category", "customer_segment",
  "sessions", "product_views", "add_to_carts", "checkouts", "orders", "units",
  "revenue", "target_revenue", "cost", "profit", "ad_spend", "refunds", "conversion_rate",
];
const lines = [headers.join(",")];
const start = new Date("2025-01-01T00:00:00Z");

for (let dayIndex = 0; dayIndex < 365; dayIndex++) {
  const date = new Date(start.getTime() + dayIndex * 86_400_000);
  const dateString = date.toISOString().slice(0, 10);
  const weekday = date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6 ? 1.18 : 1;
  const annualTrend = 0.86 + dayIndex / 365 * 0.34;
  const seasonal = 1 + 0.13 * Math.sin((dayIndex - 40) / 365 * Math.PI * 2);

  for (const channel of channels) {
    for (const region of regions) {
      for (const item of products) {
        const demand = channel.demand * region.demand * item.popularity * weekend * annualTrend * seasonal;
        const sessions = Math.max(8, Math.round((27 + random() * 20) * demand));
        const conversionRate = Math.max(0.012, channel.conversion * (0.9 + random() * 0.22));
        const orders = Math.max(0, Math.round(sessions * conversionRate + random() * 1.4));
        const units = Math.max(orders, Math.round(orders * (1.04 + random() * 0.25)));
        const revenue = Number((units * item.price * (0.92 + random() * 0.16)).toFixed(2));
        const targetRevenue = Number((units * item.price * (0.98 + dayIndex / 365 * 0.05)).toFixed(2));
        const cost = Number((revenue * (0.42 + random() * 0.11)).toFixed(2));
        const adSpend = Number((sessions * channel.spend * (0.85 + random() * 0.3)).toFixed(2));
        const refunds = Number((revenue * (0.012 + random() * 0.018)).toFixed(2));
        const profit = Number((revenue - cost - adSpend - refunds).toFixed(2));
        const productViews = Math.round(sessions * (0.7 + random() * 0.16));
        const carts = Math.max(orders, Math.round(productViews * (0.12 + random() * 0.05)));
        const checkouts = Math.max(orders, Math.round(carts * (0.66 + random() * 0.13)));
        const segmentRoll = random();
        const segment = segmentRoll > 0.78 ? "Enterprise" : segmentRoll > 0.42 ? "Growth" : "Starter";
        const row = [
          dateString, weekday, (date.getUTCDay() + 6) % 7, channel.name, region.name, item.product, item.category, segment,
          sessions, productViews, carts, checkouts, orders, units, revenue, targetRevenue,
          cost, profit, adSpend, refunds, Number((orders / sessions).toFixed(4)),
        ];
        lines.push(row.map(csvCell).join(","));
      }
    }
  }
}

const existingResponse = await fetch(`${API_BASE}/api/sources`);
if (!existingResponse.ok) throw new Error(`Dev server is not reachable at ${API_BASE}. Run npm run dev first.`);
const existing = await existingResponse.json() as { sources: Array<{ id: string; name: string }> };
for (const source of existing.sources.filter((candidate) => candidate.name === SOURCE_NAME)) {
  const response = await fetch(`${API_BASE}/api/sources/${source.id}`, { method: "DELETE" });
  if (!response.ok) throw new Error(`Could not replace existing showcase source ${source.id}.`);
}

const upload = await fetch(`${API_BASE}/api/sources`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ name: SOURCE_NAME, kind: "csv", content: lines.join("\n") }),
});
const result = await upload.json() as {
  error?: string;
  capability?: string;
  rowCount?: number;
  schema?: { columns: unknown[] };
};
if (!upload.ok) throw new Error(result.error ?? `Upload failed with status ${upload.status}.`);
if (result.capability !== "user.northstar_commerce_analytics") {
  throw new Error(`Expected user.northstar_commerce_analytics, received ${result.capability}.`);
}

console.log(
  `✓ Seeded ${result.rowCount?.toLocaleString()} rows and ${result.schema?.columns.length} columns as ${result.capability}`,
);
