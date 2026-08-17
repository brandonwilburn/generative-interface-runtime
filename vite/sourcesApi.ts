/**
 * Local data API for the open-source runtime.
 *
 * Uploaded CSV/JSON rows are imported into immutable SQLite tables. Dashboard
 * dataset definitions are compiled into bounded, parameterized SELECT queries
 * through POST /api/query.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { parseCsv, parseJson } from "./sourceParsing";
import {
  executeDatasetQuery,
  getSource,
  getSourceRows,
  listSources,
  registerSource,
  removeSource,
} from "./sqliteStore";

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_QUERY_BYTES = 256 * 1024;

function jsonResponse(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(text).toString());
  res.end(text);
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let settled = false;
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > maxBytes) {
        settled = true;
        reject(new Error(`Request body exceeds ${(maxBytes / 1024 / 1024).toFixed(0)} MB limit.`));
        return;
      }
      body += chunk;
    });
    req.on("end", () => {
      if (!settled) resolve(body);
    });
    req.on("error", (error) => {
      if (!settled) reject(error);
    });
  });
}

function makeMiddleware(): (req: IncomingMessage, res: ServerResponse, next: () => void) => Promise<void> {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "DELETE") return next();

    const url = new URL(req.url ?? "/", "http://localhost");
    const listMatch = url.pathname.match(/^\/api\/sources\/?$/);
    const itemMatch = url.pathname.match(/^\/api\/sources\/([A-Za-z0-9_-]+)(?:\/(data))?\/?$/);
    const queryMatch = url.pathname.match(/^\/api\/query\/?$/);
    if (!listMatch && !itemMatch && !queryMatch) return next();

    try {
      if (req.method === "POST" && queryMatch) {
        const definition: unknown = JSON.parse(await readBody(req, MAX_QUERY_BYTES));
        const result = executeDatasetQuery(definition);
        return jsonResponse(res, 200, {
          rows: result.rows,
          source: result.source.capability,
          rowCount: result.rows.length,
        });
      }

      if (req.method === "GET" && listMatch) {
        return jsonResponse(res, 200, { sources: listSources() });
      }

      if (req.method === "GET" && itemMatch && !itemMatch[2]) {
        const source = getSource(itemMatch[1]!);
        return source
          ? jsonResponse(res, 200, source)
          : jsonResponse(res, 404, { error: "Source not found" });
      }

      if (req.method === "GET" && itemMatch?.[2] === "data") {
        const requestedLimit = Number(url.searchParams.get("limit") ?? 100);
        const rows = getSourceRows(itemMatch[1]!, requestedLimit);
        return rows
          ? jsonResponse(res, 200, { rows })
          : jsonResponse(res, 404, { error: "Source not found" });
      }

      if (req.method === "POST" && listMatch) {
        const body = JSON.parse(await readBody(req, MAX_UPLOAD_BYTES)) as {
          name?: string;
          kind?: "csv" | "json";
          content?: string;
        };
        if (!body.name || !body.kind || !body.content) {
          return jsonResponse(res, 400, { error: "Body must include name, kind, and content." });
        }
        const rows = body.kind === "csv" ? parseCsv(body.content) : parseJson(body.content);
        if (rows.length === 0) {
          return jsonResponse(res, 400, {
            error: "No rows found. The source needs at least one data row.",
          });
        }
        const source = registerSource(body.name, body.kind, rows);
        console.log(
          `[sources-api] imported "${source.name}" → ${source.capability} (${source.rowCount} rows, ${source.schema.columns.length} columns)`,
        );
        return jsonResponse(res, 201, source);
      }

      if (req.method === "DELETE" && itemMatch) {
        return removeSource(itemMatch[1]!)
          ? jsonResponse(res, 200, { ok: true })
          : jsonResponse(res, 404, { error: "Source not found" });
      }

      return next();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = /Unknown source|Unknown field|requires|cannot|Duplicate|exceeds|must/.test(message) ? 400 : 500;
      return jsonResponse(res, status, { error: message });
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
