/**
 * Test the TableView aliasing layer without a browser.
 * Mimics what the planner produces, runs the resolver, and prints the cell values.
 */
import { lookupKey } from "../src/renderer/resolveValue.js";

const productRow = { id: "p_brisket", name: "Brisket plate", category: "mains", orders: 312, revenue: 9360 };
const catRow = { category: "mains", orders: 1209, revenue: 24382, share: 0.875 };
const customerRow = { id: "c_001", name: "Ada Lovelace", segment: "vip", orders: 47, lifetime: 2340 };

const cases = [
  // LLM mistakes (should now resolve via alias):
  { row: productRow, key: "product",     expected: "Brisket plate" },
  { row: productRow, key: "productName", expected: "Brisket plate" },
  { row: catRow,     key: "orderShare",  expected: 0.875 },
  { row: catRow,     key: "sharePct",    expected: 0.875 },
  // Correct keys (should still work):
  { row: productRow, key: "name",        expected: "Brisket plate" },
  { row: productRow, key: "revenue",     expected: 9360 },
  { row: customerRow,key: "customer",    expected: "Ada Lovelace" },
  // Genuinely missing (should return undefined):
  { row: productRow, key: "missing",     expected: undefined },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const got = lookupKey(c.row, c.key);
  const ok = got === c.expected;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗"} lookupKey(${JSON.stringify(c.row).slice(0,40)}..., "${c.key}") = ${JSON.stringify(got)} ${ok ? "" : `(expected ${JSON.stringify(c.expected)})`}`);
}
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
