/**
 * Vite dev-server middleware — "API Keys" vault.
 *
 * Lets the user add named API keys (e.g. "stripe-prod", "openweather")
 * once and reference them from any number of registered APIs. The key
 * values are stored in `data/keys.json` and NEVER returned to the
 * browser — the GET endpoints return metadata only.
 *
 * Endpoints (all under /api/keys):
 *   GET    /api/keys                → list all keys (metadata + usage count, NO values)
 *   GET    /api/keys/:id            → single key (metadata only)
 *   POST   /api/keys                → create
 *                                      body: { name, value, notes? }
 *   PATCH  /api/keys/:id            → update value, name, or notes
 *                                      body: { value?, name?, notes? }
 *   DELETE /api/keys/:id            → remove
 *
 * Security:
 *   - Key values are written to disk but never serialized in any
 *     response. The frontend only ever sees the key name + metadata.
 *   - When an API source uses `keyName`, the actual header value is
 *     looked up server-side at call time and applied to the outbound
 *     request. The browser never sees the resolved value.
 *   - If a key is deleted while an API source still references it,
 *     the source's calls fail with a clear error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SourceStore } from "./sourcesApi";

const KEYS_PATH = resolve(process.cwd(), "data", "keys.json");

export interface ApiKey {
  id: string;
  name: string;
  value: string;
  createdAt: string;
  lastUsedAt?: string;
  notes?: string;
}

export interface ApiKeyPublic {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
  notes?: string;
  usedBySources: number;
}

interface KeysFile {
  keys: ApiKey[];
}

export function readKeys(): ApiKey[] {
  if (!existsSync(KEYS_PATH)) return [];
  try {
    const text = readFileSync(KEYS_PATH, "utf8");
    const parsed = JSON.parse(text) as KeysFile;
    return Array.isArray(parsed.keys) ? parsed.keys : [];
  } catch {
    // Corrupt — start fresh.
    return [];
  }
}

export function writeKeys(keys: ApiKey[]): void {
  mkdirSync(resolve(process.cwd(), "data"), { recursive: true });
  writeFileSync(KEYS_PATH, JSON.stringify({ keys }, null, 2), "utf8");
}

export function findKeyByName(name: string): ApiKey | null {
  return readKeys().find((k) => k.name === name) ?? null;
}

export function findKeyById(id: string): ApiKey | null {
  return readKeys().find((k) => k.id === id) ?? null;
}

/**
 * Records that a key was used. Updates `lastUsedAt`. Called from the
 * call middleware so the user can see in the UI when each key was
 * last used.
 */
export function recordKeyUsage(name: string): void {
  const keys = readKeys();
  const k = keys.find((x) => x.name === name);
  if (!k) return;
  k.lastUsedAt = new Date().toISOString();
  writeKeys(keys);
}

/**
 * Resolves the effective auth header for an API source. If the
 * source has a `keyName`, the value comes from the vault. Otherwise
 * the source's inline `authHeader` is used. Returns `null` if neither
 * is set.
 *
 * Side effect: updates `lastUsedAt` on the resolved key (so the UI
 * can show "last used" timestamps). Pass `recordUsage: false` from
 * paths that don't actually make the call (e.g. a dry-run test).
 */
export function resolveAuthHeader(
  src: { authHeader?: string; keyName?: string },
  options: { recordUsage?: boolean } = { recordUsage: true },
): string | null {
  if (src.keyName) {
    const k = findKeyByName(src.keyName);
    if (!k) return null;
    if (options.recordUsage !== false) recordKeyUsage(k.name);
    return k.value;
  }
  return src.authHeader ?? null;
}

export function publicView(key: ApiKey, sources: SourceStore["sources"]): ApiKeyPublic {
  const usedBySources = sources.filter(
    (s) => s.kind === "api" && (s as { keyName?: string }).keyName === key.name,
  ).length;
  return {
    id: key.id,
    name: key.name,
    createdAt: key.createdAt,
    ...(key.lastUsedAt ? { lastUsedAt: key.lastUsedAt } : {}),
    ...(key.notes ? { notes: key.notes } : {}),
    usedBySources,
  };
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

function sanitizeKeyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

interface CreateKeyBody {
  name?: string;
  value?: string;
  notes?: string;
}
interface UpdateKeyBody {
  name?: string;
  value?: string;
  notes?: string;
}

function makeMiddleware(
  getSources: () => SourceStore["sources"],
): (req: any, res: any, next: any) => Promise<void> {
  return async (req, res, next) => {
    if (req.method !== "GET" && req.method !== "POST" && req.method !== "PATCH" && req.method !== "DELETE") {
      return next();
    }
    const url = (req.url ?? "").split("?")[0]!;
    const listMatch = url.match(/^\/api\/keys\/?$/);
    const itemMatch = url.match(/^\/api\/keys\/([A-Za-z0-9_-]+)\/?$/);
    if (!listMatch && !itemMatch) return next();

    try {
      if (req.method === "GET" && listMatch) {
        const keys = readKeys();
        const sources = getSources();
        return jsonResponse(res, 200, {
          keys: keys.map((k) => publicView(k, sources)),
        });
      }

      if (req.method === "GET" && itemMatch) {
        const keys = readKeys();
        const k = keys.find((x) => x.id === itemMatch[1]);
        if (!k) return jsonResponse(res, 404, { error: "Key not found" });
        return jsonResponse(res, 200, publicView(k, getSources()));
      }

      if (req.method === "POST" && listMatch) {
        const body = JSON.parse(await readBody(req)) as CreateKeyBody;
        if (!body.name || !body.value) {
          return jsonResponse(res, 400, {
            error: "Body must include name and value.",
          });
        }
        const name = sanitizeKeyName(body.name);
        if (!name) {
          return jsonResponse(res, 400, {
            error: "Key name is empty after sanitization. Use letters, digits, '-', '_'.",
          });
        }
        const keys = readKeys();
        if (keys.some((k) => k.name === name)) {
          return jsonResponse(res, 409, {
            error: `A key named "${name}" already exists.`,
          });
        }
        const record: ApiKey = {
          id: `key_${randomUUID().slice(0, 8)}`,
          name,
          value: body.value,
          createdAt: new Date().toISOString(),
          ...(body.notes ? { notes: body.notes } : {}),
        };
        keys.push(record);
        writeKeys(keys);
        return jsonResponse(res, 201, publicView(record, getSources()));
      }

      if (req.method === "PATCH" && itemMatch) {
        const id = itemMatch[1]!;
        const body = JSON.parse(await readBody(req)) as UpdateKeyBody;
        const keys = readKeys();
        const k = keys.find((x) => x.id === id);
        if (!k) return jsonResponse(res, 404, { error: "Key not found" });
        if (body.name !== undefined) {
          const newName = sanitizeKeyName(body.name);
          if (!newName) {
            return jsonResponse(res, 400, { error: "Key name is empty after sanitization." });
          }
          if (newName !== k.name && keys.some((x) => x.name === newName)) {
            return jsonResponse(res, 409, {
              error: `A key named "${newName}" already exists.`,
            });
          }
          k.name = newName;
        }
        if (body.value !== undefined) k.value = body.value;
        if (body.notes !== undefined) k.notes = body.notes || undefined;
        writeKeys(keys);
        return jsonResponse(res, 200, publicView(k, getSources()));
      }

      if (req.method === "DELETE" && itemMatch) {
        const id = itemMatch[1]!;
        const keys = readKeys();
        const before = keys.length;
        const remaining = keys.filter((k) => k.id !== id);
        if (remaining.length === before) {
          return jsonResponse(res, 404, { error: "Key not found" });
        }
        writeKeys(remaining);
        return jsonResponse(res, 200, { ok: true });
      }

      return next();
    } catch (e) {
      return jsonResponse(res, 500, { error: (e as Error).message });
    }
  };
}

export function keysApi(getSources: () => SourceStore["sources"]): Plugin {
  return {
    name: "gir-keys-api",
    configureServer(server) {
      server.middlewares.use(makeMiddleware(getSources));
    },
  };
}
