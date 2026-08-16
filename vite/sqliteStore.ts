import Database from "better-sqlite3";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  DatasetDefinitionSchema,
  type DatasetDefinition,
  type QueryScalar,
} from "../src/data/querySchema";
import { coerceRow, inferSchema, type SourceColumn } from "./sourceParsing";

export interface SourceRecord {
  id: string;
  name: string;
  kind: "csv" | "json";
  registeredAt: string;
  rowCount: number;
  schema: { columns: SourceColumn[] };
  capability: string;
}

interface StoredSourceRow {
  id: string;
  name: string;
  kind: "csv" | "json";
  registered_at: string;
  row_count: number;
  schema_json: string;
  capability: string;
  table_name: string;
}

interface RegisterOptions {
  id?: string;
  capability?: string;
  registeredAt?: string;
}

const DATA_DIRECTORY = resolve(process.cwd(), "data");
export const DATABASE_PATH = process.env.GIR_DATABASE_PATH
  ? resolve(process.env.GIR_DATABASE_PATH)
  : resolve(DATA_DIRECTORY, "runtime.sqlite");
const LEGACY_STORE_PATH = resolve(DATA_DIRECTORY, "sources.json");

mkdirSync(DATA_DIRECTORY, { recursive: true });

const database = new Database(DATABASE_PATH, {
  timeout: 5_000,
  fileMustExist: false,
});
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("trusted_schema = OFF");
database.exec(`
  CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('csv', 'json')),
    registered_at TEXT NOT NULL,
    row_count INTEGER NOT NULL,
    schema_json TEXT NOT NULL,
    capability TEXT NOT NULL UNIQUE,
    table_name TEXT NOT NULL UNIQUE
  ) STRICT;
`);

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function physicalTableName(id: string): string {
  return `raw_${id.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function sanitizeCapabilityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "source";
}

function sourceFromRow(row: StoredSourceRow): SourceRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    registeredAt: row.registered_at,
    rowCount: row.row_count,
    schema: JSON.parse(row.schema_json) as SourceRecord["schema"],
    capability: row.capability,
  };
}

function storedSourceById(id: string): StoredSourceRow | undefined {
  return database.prepare("SELECT * FROM sources WHERE id = ?").get(id) as StoredSourceRow | undefined;
}

function storedSourceByCapability(capability: string): StoredSourceRow | undefined {
  return database.prepare("SELECT * FROM sources WHERE capability = ?").get(capability) as StoredSourceRow | undefined;
}

export function listSources(): SourceRecord[] {
  const rows = database.prepare("SELECT * FROM sources ORDER BY registered_at").all() as StoredSourceRow[];
  return rows.map(sourceFromRow);
}

export function getSource(id: string): SourceRecord | undefined {
  const row = storedSourceById(id);
  return row ? sourceFromRow(row) : undefined;
}

function uniqueCapability(name: string): string {
  const base = sanitizeCapabilityName(name);
  let capability = `user.${base}`;
  let suffix = 2;
  const exists = database.prepare("SELECT 1 FROM sources WHERE capability = ?");
  while (exists.get(capability)) capability = `user.${base}_${suffix++}`;
  return capability;
}

function sqliteType(column: SourceColumn): "TEXT" | "REAL" | "INTEGER" {
  if (column.type === "number") return "REAL";
  if (column.type === "boolean") return "INTEGER";
  return "TEXT";
}

export function registerSource(
  name: string,
  kind: "csv" | "json",
  rows: Array<Record<string, unknown>>,
  options: RegisterOptions = {},
): SourceRecord {
  if (rows.length === 0) throw new Error("No rows found in source.");
  const columns = inferSchema(rows);
  if (columns.length === 0) throw new Error("Source must contain at least one column.");

  const id = options.id ?? `src_${randomUUID().slice(0, 8)}`;
  const capability = options.capability && !storedSourceByCapability(options.capability)
    ? options.capability
    : uniqueCapability(name);
  const registeredAt = options.registeredAt ?? new Date().toISOString();
  const tableName = physicalTableName(id);
  const record: SourceRecord = {
    id,
    name,
    kind,
    registeredAt,
    rowCount: rows.length,
    schema: { columns },
    capability,
  };

  const transaction = database.transaction(() => {
    const columnSql = columns
      .map((column) => `${quoteIdentifier(column.name)} ${sqliteType(column)}`)
      .join(", ");
    database.exec(`CREATE TABLE ${quoteIdentifier(tableName)} (${columnSql}) STRICT`);

    const names = columns.map((column) => quoteIdentifier(column.name)).join(", ");
    const placeholders = columns.map(() => "?").join(", ");
    const insert = database.prepare(
      `INSERT INTO ${quoteIdentifier(tableName)} (${names}) VALUES (${placeholders})`,
    );
    for (const rawRow of rows) {
      const row = coerceRow(rawRow, columns);
      insert.run(...columns.map((column) => row[column.name] ?? null));
    }

    record.schema = {
      columns: columns.map((column) => {
        const field = quoteIdentifier(column.name);
        const profile = database.prepare(`
          SELECT
            COUNT(*) - COUNT(${field}) AS null_count,
            COUNT(DISTINCT ${field}) AS distinct_count,
            MIN(${field}) AS min_value,
            MAX(${field}) AS max_value
          FROM ${quoteIdentifier(tableName)}
        `).get() as {
          null_count: number;
          distinct_count: number;
          min_value: string | number | null;
          max_value: string | number | null;
        };
        return {
          ...column,
          nullCount: profile.null_count,
          distinctCount: profile.distinct_count,
          ...((column.type === "number" || column.type === "date") && profile.min_value !== null
            ? { min: profile.min_value, max: profile.max_value ?? profile.min_value }
            : {}),
        };
      }),
    };

    database.prepare(`
      INSERT INTO sources (id, name, kind, registered_at, row_count, schema_json, capability, table_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      name,
      kind,
      registeredAt,
      rows.length,
      JSON.stringify(record.schema),
      capability,
      tableName,
    );
  });
  transaction();
  return record;
}

export function removeSource(id: string): boolean {
  const stored = storedSourceById(id);
  if (!stored) return false;
  const transaction = database.transaction(() => {
    database.exec(`DROP TABLE ${quoteIdentifier(stored.table_name)}`);
    database.prepare("DELETE FROM sources WHERE id = ?").run(id);
  });
  transaction();
  return true;
}

export function getSourceRows(id: string, limit = 100): Array<Record<string, unknown>> | undefined {
  const stored = storedSourceById(id);
  if (!stored) return undefined;
  const safeLimit = Math.max(1, Math.min(Math.trunc(limit), 1000));
  return database.prepare(
    `SELECT * FROM ${quoteIdentifier(stored.table_name)} LIMIT ${safeLimit}`,
  ).all() as Array<Record<string, unknown>>;
}

function assertField(field: string, columns: Map<string, SourceColumn>): SourceColumn {
  const column = columns.get(field);
  if (!column) throw new Error(`Unknown field "${field}".`);
  return column;
}

function timeBucketExpression(fieldSql: string, bucket: string): string {
  switch (bucket) {
    case "hour": return `strftime('%Y-%m-%dT%H:00:00Z', ${fieldSql})`;
    case "day": return `strftime('%Y-%m-%d', ${fieldSql})`;
    case "week": return `strftime('%Y-W%W', ${fieldSql})`;
    case "month": return `strftime('%Y-%m', ${fieldSql})`;
    case "quarter": return `(strftime('%Y', ${fieldSql}) || '-Q' || CAST(((CAST(strftime('%m', ${fieldSql}) AS INTEGER) - 1) / 3) + 1 AS INTEGER))`;
    case "year": return `strftime('%Y', ${fieldSql})`;
    default: throw new Error(`Unsupported time bucket "${bucket}".`);
  }
}

function boundValue(value: QueryScalar): string | number | null {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

export interface CompiledQuery {
  sql: string;
  params: Array<string | number | null>;
  source: SourceRecord;
  booleanOutputs: Set<string>;
}

export function compileDatasetQuery(input: unknown): CompiledQuery {
  const definition = DatasetDefinitionSchema.parse(input);
  const stored = storedSourceByCapability(definition.source);
  if (!stored) throw new Error(`Unknown source "${definition.source}".`);
  const source = sourceFromRow(stored);
  const columns = new Map(source.schema.columns.map((column) => [column.name, column]));
  const transform = definition.transform;
  const selections: string[] = [];
  const groupExpressions: string[] = [];
  const outputFields = new Set<string>();
  const booleanOutputs = new Set<string>();

  const addOutput = (name: string) => {
    if (outputFields.has(name)) throw new Error(`Duplicate output field "${name}".`);
    outputFields.add(name);
  };

  if (transform.metrics.length > 0 && transform.select.length > 0) {
    throw new Error("Aggregated datasets cannot use select; use dimensions for grouped fields.");
  }

  for (const selected of transform.select) {
    const column = assertField(selected.field, columns);
    const alias = selected.as ?? selected.field;
    addOutput(alias);
    selections.push(`${quoteIdentifier(selected.field)} AS ${quoteIdentifier(alias)}`);
    if (column.type === "boolean") booleanOutputs.add(alias);
  }

  for (const dimension of transform.dimensions) {
    const column = assertField(dimension.field, columns);
    if (dimension.timeBucket && column.type !== "date") {
      throw new Error(`timeBucket requires a date field; "${dimension.field}" is ${column.type}.`);
    }
    const alias = dimension.as ?? dimension.field;
    addOutput(alias);
    const fieldSql = quoteIdentifier(dimension.field);
    const expression = dimension.timeBucket
      ? timeBucketExpression(fieldSql, dimension.timeBucket)
      : fieldSql;
    selections.push(`${expression} AS ${quoteIdentifier(alias)}`);
    if (transform.metrics.length > 0) groupExpressions.push(expression);
    if (!dimension.timeBucket && column.type === "boolean") booleanOutputs.add(alias);
  }

  for (const metric of transform.metrics) {
    addOutput(metric.as);
    const column = metric.field ? assertField(metric.field, columns) : undefined;
    if (metric.operation !== "count" && !column) {
      throw new Error(`${metric.operation} requires a field.`);
    }
    if (["sum", "average"].includes(metric.operation) && column?.type !== "number") {
      throw new Error(`${metric.operation} requires a numeric field.`);
    }
    const fieldSql = column ? quoteIdentifier(column.name) : "*";
    const expression = (() => {
      switch (metric.operation) {
        case "count": return `COUNT(${fieldSql})`;
        case "countDistinct": return `COUNT(DISTINCT ${fieldSql})`;
        case "sum": return `SUM(${fieldSql})`;
        case "average": return `AVG(${fieldSql})`;
        case "min": return `MIN(${fieldSql})`;
        case "max": return `MAX(${fieldSql})`;
      }
    })();
    selections.push(`${expression} AS ${quoteIdentifier(metric.as)}`);
  }

  if (selections.length === 0) {
    for (const column of source.schema.columns) {
      selections.push(quoteIdentifier(column.name));
      outputFields.add(column.name);
      if (column.type === "boolean") booleanOutputs.add(column.name);
    }
  }

  const params: Array<string | number | null> = [];
  const predicates = transform.filters.map((filter) => {
    const column = assertField(filter.field, columns);
    const fieldSql = quoteIdentifier(column.name);
    if (filter.operator === "isNull") return `${fieldSql} IS NULL`;
    if (filter.operator === "isNotNull") return `${fieldSql} IS NOT NULL`;
    if (filter.value === undefined) throw new Error(`${filter.operator} requires a value.`);

    if (filter.operator === "in" || filter.operator === "notIn") {
      if (!Array.isArray(filter.value)) throw new Error(`${filter.operator} requires an array value.`);
      params.push(...filter.value.map(boundValue));
      const placeholders = filter.value.map(() => "?").join(", ");
      return `${fieldSql} ${filter.operator === "in" ? "IN" : "NOT IN"} (${placeholders})`;
    }
    if (Array.isArray(filter.value)) throw new Error(`${filter.operator} requires a scalar value.`);
    if (filter.value === null) {
      if (filter.operator === "equals") return `${fieldSql} IS NULL`;
      if (filter.operator === "notEquals") return `${fieldSql} IS NOT NULL`;
      throw new Error(`${filter.operator} cannot compare against null.`);
    }
    if (filter.operator === "contains") {
      params.push(`%${String(filter.value).replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
      return `${fieldSql} LIKE ? ESCAPE '\\'`;
    }
    const operators = {
      equals: "=",
      notEquals: "!=",
      greaterThan: ">",
      greaterThanOrEqual: ">=",
      lessThan: "<",
      lessThanOrEqual: "<=",
    } as const;
    const sqlOperator = operators[filter.operator];
    params.push(boundValue(filter.value));
    return `${fieldSql} ${sqlOperator} ?`;
  });

  const order = transform.sort.map((sort) => {
    if (!outputFields.has(sort.field)) throw new Error(`Sort field "${sort.field}" is not in the query output.`);
    return `${quoteIdentifier(sort.field)} ${sort.direction.toUpperCase()}`;
  });

  const sql = [
    `SELECT ${selections.join(", ")}`,
    `FROM ${quoteIdentifier(stored.table_name)}`,
    predicates.length ? `WHERE ${predicates.join(" AND ")}` : "",
    groupExpressions.length ? `GROUP BY ${groupExpressions.join(", ")}` : "",
    order.length ? `ORDER BY ${order.join(", ")}` : "",
    `LIMIT ${transform.limit}`,
  ].filter(Boolean).join("\n");

  return { sql, params, source, booleanOutputs };
}

export function executeDatasetQuery(input: unknown): {
  rows: Array<Record<string, unknown>>;
  source: SourceRecord;
} {
  const compiled = compileDatasetQuery(input);
  const rawRows = database.prepare(compiled.sql).all(...compiled.params) as Array<Record<string, unknown>>;
  const rows = rawRows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, compiled.booleanOutputs.has(key) && value !== null ? value === 1 : value]),
  ));
  return { rows, source: compiled.source };
}

interface LegacyStore {
  sources?: SourceRecord[];
  rows?: Record<string, Array<Record<string, unknown>>>;
}

function migrateLegacyJsonStore(): void {
  if (process.env.GIR_DATABASE_PATH) return;
  const count = database.prepare("SELECT COUNT(*) AS count FROM sources").get() as { count: number };
  if (count.count > 0 || !existsSync(LEGACY_STORE_PATH)) return;
  try {
    const legacy = JSON.parse(readFileSync(LEGACY_STORE_PATH, "utf8")) as LegacyStore;
    for (const source of legacy.sources ?? []) {
      const rows = legacy.rows?.[source.id];
      if (!rows?.length) continue;
      registerSource(source.name, source.kind, rows, {
        id: source.id,
        capability: source.capability,
        registeredAt: source.registeredAt,
      });
    }
    if ((legacy.sources?.length ?? 0) > 0) {
      console.log(`[sources-api] migrated legacy sources.json into ${DATABASE_PATH}`);
    }
  } catch (error) {
    console.warn(`[sources-api] could not migrate legacy sources.json: ${(error as Error).message}`);
  }
}

migrateLegacyJsonStore();

export function closeDatabase(): void {
  database.close();
}

export type { DatasetDefinition };
