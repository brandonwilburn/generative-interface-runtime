import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCsv } from "../vite/sourceParsing";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "gir-data-compiler-"));
process.env.GIR_DATABASE_PATH = join(temporaryDirectory, "test.sqlite");

const store = await import("../vite/sqliteStore");

try {
  assert.deepEqual(
    parseCsv('\uFEFFregion,notes,value\r\n"North, region","line one\nline two",42\r\nSouth,"said ""go""",17'),
    [
      { region: "North, region", notes: "line one\nline two", value: "42" },
      { region: "South", notes: 'said "go"', value: "17" },
    ],
  );
  assert.throws(() => parseCsv("a,b\n1,2,3"), /3 columns; expected 2/);
  assert.throws(() => parseCsv('a,b\n1,"unfinished'), /unterminated quoted field/);

  const source = store.registerSource("Website traffic", "json", [
    { timestamp: "2026-01-02T10:00:00Z", visitor_id: "a", country: "US", status_code: 200, duration: 12 },
    { timestamp: "2026-01-15T12:00:00Z", visitor_id: "b", country: "US", status_code: 200, duration: 18 },
    { timestamp: "2026-01-20T12:00:00Z", visitor_id: "a", country: "CA", status_code: 200, duration: 9 },
    { timestamp: "2026-02-03T08:00:00Z", visitor_id: "c", country: "US", status_code: 200, duration: 25 },
    { timestamp: "2026-02-10T08:00:00Z", visitor_id: "d", country: "US", status_code: 500, duration: 2 },
    { timestamp: "2026-02-18T09:00:00Z", visitor_id: "c", country: "US", status_code: 200, duration: 15 },
  ]);

  assert.equal(source.capability, "user.website_traffic");
  assert.equal(source.rowCount, 6);
  assert.equal(source.schema.columns.find((column) => column.name === "visitor_id")?.distinctCount, 4);

  const result = store.executeDatasetQuery({
    source: source.capability,
    transform: {
      filters: [
        { field: "country", operator: "equals", value: "US" },
        { field: "status_code", operator: "lessThan", value: 400 },
      ],
      dimensions: [
        { field: "timestamp", as: "month", timeBucket: "month" },
      ],
      metrics: [
        { operation: "count", as: "pageViews" },
        { field: "visitor_id", operation: "countDistinct", as: "visitors" },
        { field: "duration", operation: "average", as: "averageDuration" },
      ],
      sort: [{ field: "month", direction: "asc" }],
      limit: 12,
    },
  });

  assert.deepEqual(result.rows, [
    { month: "2026-01", pageViews: 2, visitors: 2, averageDuration: 15 },
    { month: "2026-02", pageViews: 2, visitors: 1, averageDuration: 20 },
  ]);

  const projection = store.executeDatasetQuery({
    source: source.capability,
    transform: {
      select: [{ field: "visitor_id", as: "visitor" }, { field: "country" }],
      filters: [{ field: "visitor_id", operator: "in", value: ["a", "c"] }],
      sort: [{ field: "visitor", direction: "asc" }],
      limit: 10,
    },
  });
  assert.equal(projection.rows.length, 4);
  assert.deepEqual(Object.keys(projection.rows[0]!), ["visitor", "country"]);

  assert.throws(
    () => store.compileDatasetQuery({
      source: source.capability,
      transform: { select: [{ field: "missing; DROP TABLE sources" }] },
    }),
    /Unknown field/,
  );
  assert.throws(
    () => store.compileDatasetQuery({
      source: source.capability,
      transform: { metrics: [{ field: "country", operation: "sum", as: "bad" }] },
    }),
    /numeric field/,
  );

  console.log("✓ CSV parsing, SQLite import, profiling, safe query compilation, and execution");
} finally {
  store.closeDatabase();
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
