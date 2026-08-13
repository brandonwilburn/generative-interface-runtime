/**
 * Verifies the where-filter + chart-engine aggregation logic on real data
 * without needing a browser. Pulls the user's registered source from the
 * dev server, applies the same where/aggregate logic the renderer uses,
 * and prints the result.
 */
const BASE = "http://localhost:5173";

const sourcesResp = await fetch(`${BASE}/api/sources`).then((r) => r.json());
const src = sourcesResp.sources.find((s) => s.capability === "user.hourly_product_mix");
if (!src) {
  console.log("user.hourly_product_mix not registered. Upload the sample CSV first.");
  process.exit(1);
}
const data = await fetch(`${BASE}/api/sources/${src.id}/data`).then((r) => r.json());
const rows = data.rows;
console.log(`Loaded ${rows.length} rows for ${src.name}`);

// Replica of resolveRows' where logic
function applyWhere(rows, where) {
  if (!where) return rows;
  return rows.filter((r) =>
    Object.entries(where).every(([k, v]) => r[k] === v),
  );
}

// Replica of chart engine's aggregation
function aggregateByX(rows, xField, yFields) {
  const order = [];
  const sums = new Map();
  for (const r of rows) {
    const key = String(r[xField] ?? "");
    let bucket = sums.get(key);
    if (!bucket) {
      bucket = { [xField]: r[xField] };
      sums.set(key, bucket);
      order.push(key);
    }
    for (const k of yFields) {
      const prev = Number(bucket[k] ?? 0);
      bucket[k] = prev + Number(r[k] ?? 0);
    }
  }
  return order.map((k) => sums.get(k));
}

// Test 1: where=day:Sat, then aggregate by product
const satRows = applyWhere(rows, { day: "Sat" });
const satByProduct = aggregateByX(satRows, "product", ["revenue", "orders"]);
console.log("\n=== Test 1: Saturday, revenue by product ===");
console.log(`Rows after where: ${satRows.length} (expected 48 = 12 hours × 4 products)`);
satByProduct.forEach((r) => console.log(`  ${r.product}: $${r.revenue} (${r.orders} orders)`));

// Test 2: where=day:Sun, then aggregate by product
const sunRows = applyWhere(rows, { day: "Sun" });
const sunByProduct = aggregateByX(sunRows, "product", ["revenue", "orders"]);
console.log("\n=== Test 2: Sunday, revenue by product ===");
console.log(`Rows after where: ${sunRows.length}`);
sunByProduct.forEach((r) => console.log(`  ${r.product}: $${r.revenue} (${r.orders} orders)`));

// Test 3: no where, aggregate by date
const allByDate = aggregateByX(rows, "date", ["revenue"]);
console.log("\n=== Test 3: No filter, revenue by date ===");
console.log(`Bars: ${allByDate.length} (expected 7)`);
allByDate.forEach((r) => console.log(`  ${r.date}: $${r.revenue}`));

// Test 4: no where, aggregate by product (totals)
const allByProduct = aggregateByX(rows, "product", ["revenue", "orders"]);
console.log("\n=== Test 4: No filter, revenue by product (totals) ===");
console.log(`Slices: ${allByProduct.length} (expected 4)`);
allByProduct.forEach((r) => console.log(`  ${r.product}: $${r.revenue} (${r.orders} orders)`));
