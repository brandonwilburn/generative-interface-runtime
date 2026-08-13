/**
 * Vite dev-server middleware — "Bring Your Own Data" source registry.
 *
 * Endpoints (all under /api/sources):
 *   GET    /api/sources              → list all sources (metadata only)
 *   GET    /api/sources/:id          → single source metadata
 *   GET    /api/sources/:id/data     → all rows for a source
 *   POST   /api/sources              → register a new source
 *                                       body: { name, kind: "csv"|"json", content: string }
 *   DELETE /api/sources/:id          → remove a source
 *
 * Storage: a single JSON file at <cwd>/data/sources.json. Cheap and
 * debuggable. Move to a real DB when the demo graduates.
 *
 * The frontend keeps an in-memory copy of the metadata so the planner's
 * system prompt can be regenerated on every change without a refetch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";

interface SourceColumn {
  name: string;
  type: "string" | "number" | "date" | "boolean";
  samples: unknown[];
}

interface SourceRecord {
  id: string;
  name: string;
  kind: "csv" | "json";
  registeredAt: string;
  rowCount: number;
  schema: { columns: SourceColumn[] };
  /** Sanitized capability name: "user.<sanitized>". */
  capability: string;
}

interface SourceStore {
  sources: SourceRecord[];
  /** Rows indexed by source id. Kept inline for v1. */
  rows: Record<string, Array<Record<string, unknown>>>;
}

const STORE_PATH = resolve(process.cwd(), "data", "sources.json");

function readStore(): SourceStore {
  if (!existsSync(STORE_PATH)) return { sources: [], rows: {} };
  try {
    const text = readFileSync(STORE_PATH, "utf8");
    return JSON.parse(text) as SourceStore;
  } catch {
    // Corrupt store — start fresh rather than crash the dev server.
    return { sources: [], rows: {} };
  }
}

function writeStore(store: SourceStore): void {
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function jsonResponse(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(text).toString());
  res.end(text);
}

async function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveP, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolveP(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** "Q3 sales" → "q3_sales" — safe for a JS identifier suffix. */
function sanitizeCapabilityName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "source";
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const BOOL = /^(true|false)$/i;

function inferType(samples: unknown[]): SourceColumn["type"] {
  let allNum = true;
  let allDate = true;
  let allBool = true;
  for (const s of samples) {
    if (s === null || s === undefined || s === "") continue;
    if (typeof s === "number") {
      allDate = false;
      allBool = false;
      continue;
    }
    if (typeof s === "boolean") {
      allNum = false;
      allDate = false;
      continue;
    }
    if (s instanceof Date) {
      allNum = false;
      allBool = false;
      continue;
    }
    const str = String(s);
    if (!NUMERIC.test(str)) allNum = false;
    if (!(ISO_DATE.test(str) || !isNaN(Date.parse(str)) && /\d{4}/.test(str))) {
      // Lenient: accept anything Date.parse handles AND has a 4-digit year.
      allDate = false;
    }
    if (!BOOL.test(str)) allBool = false;
  }
  if (allNum && samples.length > 0) return "number";
  if (allDate && samples.length > 0) return "date";
  if (allBool && samples.length > 0) return "boolean";
  return "string";
}

function inferSchema(
  rows: Array<Record<string, unknown>>,
): SourceColumn[] {
  if (rows.length === 0) return [];
  const columnNames = Object.keys(rows[0]!);
  return columnNames.map((name) => {
    const samples = rows
      .slice(0, 20)
      .map((r) => r[name])
      .filter((v) => v !== undefined && v !== null && v !== "");
    return {
      name,
      type: inferType(samples),
      samples: samples.slice(0, 5),
    };
  });
}

function parseCsv(content: string): Array<Record<string, unknown>> {
  // Minimal RFC-4180-ish CSV parser: handles quoted fields (with "" escapes),
  // trims headers, ignores fully-blank lines. No external dep — papaparse
  // was tripping over `FileReaderSync` when imported in Vite's middleware
  // context, and our data is simple enough to parse by hand.
  const parseLine = (line: string): string[] => {
    const out: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (inQuote) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') inQuote = false;
        else cur += c;
      } else {
        if (c === '"') inQuote = true;
        else if (c === ",") { out.push(cur); cur = ""; }
        else cur += c;
      }
    }
    out.push(cur);
    return out;
  };

  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("CSV is empty");
  const headers = parseLine(lines[0]!).map((h) => h.trim());
  const out: Array<Record<string, unknown>> = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseLine(lines[i]!);
    const row: Record<string, unknown> = {};
    for (let c = 0; c < headers.length; c++) {
      row[headers[c]!] = cells[c] ?? "";
    }
    out.push(row);
  }
  return out;
}

function parseJson(content: string): Array<Record<string, unknown>> {
  const parsed = JSON.parse(content);
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) return [];
    if (typeof parsed[0] !== "object" || parsed[0] === null) {
      throw new Error("JSON must be an array of objects (got array of primitives).");
    }
    return parsed as Array<Record<string, unknown>>;
  }
  // Try to find an array property — common pattern for API responses.
  if (typeof parsed === "object" && parsed !== null) {
    for (const key of Object.keys(parsed)) {
      if (Array.isArray((parsed as Record<string, unknown>)[key])) {
        const arr = (parsed as Record<string, unknown>)[key] as unknown[];
        if (arr.length > 0 && typeof arr[0] === "object" && arr[0] !== null) {
          return arr as Array<Record<string, unknown>>;
        }
      }
    }
  }
  throw new Error(
    "JSON must be an array of objects, or an object containing one.",
  );
}

function coerceRow(
  row: Record<string, unknown>,
  schema: { columns: SourceColumn[] },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of schema.columns) {
    const raw = row[col.name];
    if (raw === undefined || raw === null || raw === "") {
      out[col.name] = raw;
      continue;
    }
    switch (col.type) {
      case "number": {
        const n = typeof raw === "number" ? raw : Number(raw);
        out[col.name] = isFinite(n) ? n : raw;
        break;
      }
      case "boolean": {
        if (typeof raw === "boolean") { out[col.name] = raw; break; }
        const s = String(raw).toLowerCase();
        out[col.name] = s === "true" ? true : s === "false" ? false : raw;
        break;
      }
      case "date": {
        if (raw instanceof Date) { out[col.name] = raw.toISOString(); break; }
        const s = String(raw);
        // Already ISO: keep as string. Otherwise: try to parse, store as ISO.
        if (ISO_DATE.test(s)) { out[col.name] = s; break; }
        const t = Date.parse(s);
        out[col.name] = isNaN(t) ? s : new Date(t).toISOString();
        break;
      }
      default:
        out[col.name] = String(raw);
    }
  }
  return out;
}

function makeMiddleware(): (req: any, res: any, next: any) => Promise<void> {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") {
      return next();
    }
    const url = (req.url ?? "").split("?")[0]!;
    const listMatch = url.match(/^\/api\/sources\/?$/);
    const itemMatch = url.match(/^\/api\/sources\/([A-Za-z0-9_-]+)(?:\/(data))?\/?$/);
    if (!listMatch && !itemMatch) return next();

    try {
      if (req.method === "GET" && listMatch) {
        const store = readStore();
        return jsonResponse(res, 200, { sources: store.sources });
      }

      if (req.method === "GET" && itemMatch && !itemMatch[2]) {
        const store = readStore();
        const src = store.sources.find((s) => s.id === itemMatch[1]);
        if (!src) return jsonResponse(res, 404, { error: "Source not found" });
        return jsonResponse(res, 200, src);
      }

      if (req.method === "GET" && itemMatch && itemMatch[2] === "data") {
        const store = readStore();
        const rows = store.rows[itemMatch[1]!];
        if (!rows) return jsonResponse(res, 404, { error: "Source not found" });
        return jsonResponse(res, 200, { rows });
      }

      if (req.method === "POST" && listMatch) {
        const body = JSON.parse(await readBody(req)) as {
          name?: string;
          kind?: "csv" | "json";
          content?: string;
        };
        if (!body.name || !body.kind || !body.content) {
          return jsonResponse(res, 400, {
            error: "Body must include name, kind, and content.",
          });
        }
        const rows = body.kind === "csv" ? parseCsv(body.content) : parseJson(body.content);
        if (rows.length === 0) {
          return jsonResponse(res, 400, {
            error: "No rows found. Check that the file has a header row and at least one data row.",
          });
        }
        const schema = inferSchema(rows);
        const store = readStore();
        // Ensure unique capability name
        const base = sanitizeCapabilityName(body.name);
        let capability = `user.${base}`;
        let n = 2;
        while (store.sources.some((s) => s.capability === capability)) {
          capability = `user.${base}_${n++}`;
        }
        const record: SourceRecord = {
          id: `src_${randomUUID().slice(0, 8)}`,
          name: body.name,
          kind: body.kind,
          registeredAt: new Date().toISOString(),
          rowCount: rows.length,
          schema: { columns: schema },
          capability,
        };
        store.sources.push(record);
        // Coerce cell values to their inferred types so the planner's
        // resolver returns real numbers/dates, not string-encoded ones.
        store.rows[record.id] = rows.map((r) => coerceRow(r, { columns: schema }));
        writeStore(store);
        // eslint-disable-next-line no-console
        console.log(
          `[sources-api] registered "${record.name}" → ${record.capability} (${rows.length} rows, ${schema.length} cols)`,
        );
        return jsonResponse(res, 201, record);
      }

      if (req.method === "DELETE" && itemMatch) {
        const id = itemMatch[1]!;
        const store = readStore();
        const before = store.sources.length;
        store.sources = store.sources.filter((s) => s.id !== id);
        delete store.rows[id];
        if (store.sources.length === before) {
          return jsonResponse(res, 404, { error: "Source not found" });
        }
        writeStore(store);
        return jsonResponse(res, 200, { ok: true });
      }

      return next();
    } catch (e) {
      return jsonResponse(res, 500, { error: (e as Error).message });
    }
  };
}

export function sourcesApi(): Plugin {
  return {
    name: "gir-sources-api",
    configureServer(server) {
      server.middlewares.use(makeMiddleware());
    },
  };
}
