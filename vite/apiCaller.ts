/**
 * Live API call execution.
 *
 * Given a registered API source + endpoint name + params, this module
 * builds the outbound HTTP request, makes it, and returns the parsed
 * JSON response. The actual call runs server-side (Vite middleware)
 * so:
 *   - CORS never bites
 *   - the auth header is never sent to the browser bundle
 *   - we get to put a sane timeout on it
 *
 * Results are cached in-memory, keyed by (api, endpoint, paramsHash).
 * The cache is process-lifetime — the user can force a refresh by
 * removing+re-registering the API, or by passing `?fresh=1` to the
 * /call endpoint (used by tests).
 */
import { createHash } from "node:crypto";
import type {
  ApiSourceRecord,
  ApiEndpoint,
  ApiParam,
} from "../src/data/sourcesRegistry";

const TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const cache = new Map<string, { data: unknown; at: number }>();

function cacheKey(apiId: string, endpointId: string, params: Record<string, unknown>): string {
  // Stable serialization: sort keys so {a:1,b:2} and {b:2,a:1} hash the same.
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${JSON.stringify(params[k] ?? null)}`)
    .join("&");
  const h = createHash("sha1").update(sorted).digest("hex").slice(0, 16);
  return `${apiId}:${endpointId}:${h}`;
}

export interface CallResult {
  data: unknown;
  cached: boolean;
}

export interface CallOptions {
  fresh?: boolean;
}

export async function callEndpoint(
  src: ApiSourceRecord,
  endpoint: ApiEndpoint,
  params: Record<string, unknown>,
  options: CallOptions & { effectiveAuthHeader?: string | null } = {},
): Promise<CallResult> {
  if (options.fresh) {
    // Skip the cache read but still write through so the next call hits cache.
  } else {
    const key = cacheKey(src.id, endpoint.id, params);
    const hit = cache.get(key);
    if (hit) return { data: hit.data, cached: true };
  }
  // If the caller (middleware) resolved the keyName → value at the
  // call site, prefer that. Otherwise fall back to the source's
  // inline authHeader. The key value never reaches the browser.
  const effective = {
    ...src,
    authHeader: options.effectiveAuthHeader !== undefined
      ? options.effectiveAuthHeader ?? undefined
      : src.authHeader,
  };
  const { url, init } = buildRequest(effective, endpoint, params);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    throw new Error(`API call failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `API call ${endpoint.method} ${endpoint.path} returned HTTP ${res.status}: ${body.slice(0, 200)}`,
    );
  }
  // Read with a size cap so a runaway response doesn't blow up the dev server.
  const reader = res.body?.getReader();
  if (!reader) throw new Error("API response has no body");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error(`API response too large (>${MAX_RESPONSE_BYTES} bytes)`);
    }
    chunks.push(value);
  }
  const text = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      `API response is not valid JSON: ${text.slice(0, 200)}${text.length > 200 ? "..." : ""}`,
    );
  }
  cache.set(cacheKey(src.id, endpoint.id, params), { data, at: Date.now() });
  return { data, cached: false };
}

/** Clears the in-memory cache. Used by tests and by re-registration. */
export function clearApiCache(): void {
  cache.clear();
}

function buildRequest(
  src: ApiSourceRecord,
  endpoint: ApiEndpoint,
  params: Record<string, unknown>,
): { url: string; init: RequestInit } {
  // Substitute {param} placeholders in the path with values from params.
  let path = endpoint.path;
  const pathParams: string[] = [];
  path = path.replace(/\{([^}]+)\}/g, (_m, name) => {
    const v = params[name];
    if (v === undefined || v === null) {
      throw new Error(`Missing required path param "${name}" for ${endpoint.name}`);
    }
    pathParams.push(name);
    return encodeURIComponent(String(v));
  });
  // Collect query/body params.
  const query: [string, string][] = [];
  let body: unknown;
  for (const p of endpoint.params) {
    if (pathParams.includes(p.name)) continue;
    const v = params[p.name];
    if (v === undefined || v === null) {
      if (p.required) {
        throw new Error(`Missing required ${p.in} param "${p.name}" for ${endpoint.name}`);
      }
      continue;
    }
    if (p.in === "query") {
      query.push([p.name, String(v)]);
    } else if (p.in === "header") {
      // Headers are added below; just note that this param is consumed.
    } else if (p.in === "body") {
      // If there's a single body param, treat its value as the body.
      // Multiple body params: wrap in an object.
      body = body ?? {};
      if (body && typeof body === "object") {
        (body as Record<string, unknown>)[p.name] = v;
      }
    }
  }
  let url = joinUrl(src.baseUrl, path);
  if (query.length > 0) {
    const qs = new URLSearchParams(query).toString();
    url += (url.includes("?") ? "&" : "?") + qs;
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "generative-interface-runtime/0.1",
  };
  if (src.authHeader) headers.Authorization = src.authHeader;
  // Header params go in the headers map.
  for (const p of endpoint.params) {
    if (p.in === "header") {
      const v = params[p.name];
      if (v !== undefined && v !== null) {
        headers[p.name] = String(v);
      }
    }
  }
  const init: RequestInit = { method: endpoint.method, headers };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return { url, init };
}

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const b = base.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return b + p;
}

/**
 * Validates a set of params against an endpoint's param list. Returns
 * a list of missing-required or unknown-extra params. The user
 * (planner) can pre-flight before issuing the call to surface a
 * nicer error than a runtime 400 from the upstream.
 */
export function validateParams(
  endpoint: ApiEndpoint,
  params: Record<string, unknown>,
): { missing: ApiParam[]; extra: string[] } {
  const known = new Set(endpoint.params.map((p) => p.name));
  const missing = endpoint.params.filter(
    (p) => p.required && (params[p.name] === undefined || params[p.name] === null),
  );
  const extra = Object.keys(params).filter((k) => !known.has(k));
  return { missing, extra };
}
