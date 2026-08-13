/**
 * LLM-driven API endpoint extractor.
 *
 * Given docs text + sample request/response pairs, the extractor calls
 * the LLM with a focused prompt and returns a list of `ApiEndpoint`
 * objects. This is the slow path — only invoked at API registration
 * time. The result is persisted; subsequent dashboard renders use the
 * cached capability descriptors without re-extracting.
 *
 * The extractor uses the same upstream as the planner
 * (`VITE_OPENAI_BASE_URL` + `MINIMAX_API_KEY`) and the same 3-tier
 * response_format fallback (json_schema → json_object → none). Output
 * is parsed with the same `parseLLMJson` walker that lives in
 * `src/planner/openaiPlanner.ts` (we re-implement it here to avoid
 * the TS-to-ESM boundary in the Vite middleware context).
 *
 * The LLM is non-deterministic. If extraction fails or returns
 * nothing useful, the user can re-run it by editing the input. We
 * don't auto-retry with the same prompt.
 */
import type { ApiEndpoint, ApiParam, ApiSamplePair } from "../src/data/sourcesRegistry";

const EXTRACTOR_SYSTEM_PROMPT = `You are an API documentation analyzer. Given documentation text and/or sample request/response pairs, extract a STRUCTURED list of API endpoints.

Each endpoint:
- name: snake_case identifier (e.g. "get_current", "list_invoices"). Lowercase letters, digits, underscores. No dots.
- description: one sentence describing what the endpoint does. Plain English.
- method: "GET" or "POST". Match the docs.
- path: URL path with {param} placeholders for variable segments (e.g. "/v1/weather/{city}"). NO query string.
- params: list of { name, type, required, description, in } where:
  - name: parameter name as the API expects it
  - type: "string" | "number" | "boolean"
  - required: true if the API requires it
  - description: short, plain English
  - in: "path" | "query" | "body" | "header"
- returnsDescription: one sentence about the response shape (e.g. "An object with 'temp' (number, °C) and 'conditions' (string).")
- returnsSample: a short sample response (the smallest useful subset, not a full real response)

RULES:
- Return ONLY a JSON object: { "endpoints": [ ... ] }
- Every endpoint name MUST be unique. Add a suffix like "_v2" if necessary.
- If the docs are too thin to identify any endpoint, return { "endpoints": [] }.
- Do NOT include commentary, greetings, or preambles. The response is parsed by JSON.parse.
- Group multiple operations on the same path as separate endpoints (e.g. GET /users and POST /users are two endpoints).
- Use {param} for path parameters, even if the sample URL has the value inline.
- Infer params from sample URLs: a path like /v1/weather/London has a path param "city" with example value "London".
- For POSTs, the request body is usually a single object; you can describe it as params[0] with in: "body".`;

const MAX_DOCS_CHARS = 24_000;
const MAX_SAMPLE_CHARS = 4_000;

export interface ExtractorInput {
  docsText?: string;
  samplePairs?: ApiSamplePair[];
  baseUrl: string;
}

export interface ExtractorResult {
  endpoints: ApiEndpoint[];
  /** Truncated/capped inputs the LLM actually saw — useful for debugging. */
  inputs: { docsChars: number; sampleChars: number };
}

/**
 * Reads the upstream LLM config from env. Mirrors the planner's
 * `readConfig` so the extractor reuses whatever the dev server is set
 * up to talk to.
 */
function readUpstream(): { baseUrl: string; apiKey: string; model: string } | null {
  const baseUrl = process.env.MINIMAX_BASE_URL || "https://api.minimax.io/v1";
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) return null;
  // The model name is exposed to the browser; the extractor (server-side)
  // can read it via process.env too.
  const model = process.env.VITE_OPENAI_MODEL || process.env.MINIMAX_MODEL || "MiniMax-M3";
  return { baseUrl, apiKey, model };
}

function buildUserPrompt(input: ExtractorInput): string {
  const parts: string[] = [];
  parts.push(`Base URL: ${input.baseUrl}`);
  if (input.docsText) {
    const truncated = input.docsText.length > MAX_DOCS_CHARS;
    const text = truncated
      ? input.docsText.slice(0, MAX_DOCS_CHARS) + "\n\n[... truncated ...]"
      : input.docsText;
    parts.push(`\n## API Documentation\n${text}`);
  }
  if (input.samplePairs && input.samplePairs.length > 0) {
    parts.push(`\n## Sample Request/Response Pairs`);
    for (const sp of input.samplePairs) {
      const body = sp.responseBody.length > MAX_SAMPLE_CHARS
        ? sp.responseBody.slice(0, MAX_SAMPLE_CHARS) + "\n[... truncated ...]"
        : sp.responseBody;
      parts.push(
        `\n### ${sp.label}\n` +
        `${sp.method} ${sp.path}\n` +
        `Response:\n${body}`,
      );
    }
  }
  return parts.join("\n");
}

interface RawEndpoint {
  name?: unknown;
  description?: unknown;
  method?: unknown;
  path?: unknown;
  params?: unknown;
  returnsDescription?: unknown;
  returnsSample?: unknown;
}

function coerceEndpoint(raw: RawEndpoint, idx: number): ApiEndpoint | null {
  if (typeof raw.name !== "string" || raw.name.length === 0) return null;
  const name = sanitizeName(raw.name);
  if (!name) return null;
  if (typeof raw.description !== "string") return null;
  if (raw.method !== "GET" && raw.method !== "POST") return null;
  if (typeof raw.path !== "string" || !raw.path.startsWith("/")) return null;
  if (typeof raw.returnsDescription !== "string") return null;
  const params = Array.isArray(raw.params)
    ? raw.params.map(coerceParam).filter((p): p is ApiParam => p !== null)
    : [];
  const returnsSample =
    raw.returnsSample && typeof raw.returnsSample === "object"
      ? raw.returnsSample
      : undefined;
  return {
    id: `ep_${idx}_${Math.random().toString(36).slice(2, 8)}`,
    name,
    description: raw.description.trim(),
    method: raw.method,
    path: raw.path,
    params,
    returnsDescription: raw.returnsDescription.trim(),
    ...(returnsSample !== undefined ? { returnsSample } : {}),
  };
}

function sanitizeName(s: string): string {
  const cleaned = s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return cleaned || "";
}

function coerceParam(raw: unknown): ApiParam | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== "string" || r.name.length === 0) return null;
  if (r.type !== "string" && r.type !== "number" && r.type !== "boolean") return null;
  if (r.in !== "path" && r.in !== "query" && r.in !== "body" && r.in !== "header") return null;
  return {
    name: r.name,
    type: r.type,
    required: r.required === true,
    description: typeof r.description === "string" ? r.description : undefined,
    in: r.in,
  };
}

/**
 * Local extractor. Used when no LLM is configured — picks endpoints
 * from either an OpenAPI-style docs blob, sample request/response
 * pairs, or both. Crude but serviceable for the "no API key in
 * this environment" fallback.
 *
 * Strategy:
 *   1. If docsText parses as JSON and looks like an OpenAPI/Swagger
 *      spec (has `paths` keyed by URL path), walk `paths.<path>.<method>`
 *      and synthesize an endpoint per (path, method).
 *   2. If samplePairs are supplied, derive one endpoint per pair
 *      from its path.
 *   3. Both can be combined.
 */
function localExtract(input: ExtractorInput): ExtractorResult {
  const endpoints: ApiEndpoint[] = [];
  // OpenAPI-style walk.
  if (input.docsText) {
    try {
      const doc = JSON.parse(input.docsText);
      if (doc && typeof doc === "object" && doc.paths && typeof doc.paths === "object") {
        let idx = 0;
        for (const [rawPath, rawOps] of Object.entries(doc.paths as Record<string, unknown>)) {
          if (!rawOps || typeof rawOps !== "object") continue;
          for (const [rawMethod, rawOp] of Object.entries(rawOps as Record<string, unknown>)) {
            const method = rawMethod.toUpperCase();
            if (method !== "GET" && method !== "POST") continue;
            const op = (rawOp ?? {}) as {
              summary?: string;
              description?: string;
              parameters?: Array<{
                name?: string;
                in?: string;
                required?: boolean;
                schema?: { type?: string };
                description?: string;
              }>;
              responses?: Record<string, unknown>;
            };
            const name = pathToName(rawPath, idx);
            if (!name) continue;
            const params: ApiParam[] = [];
            const pathParams: string[] = [];
            for (const p of op.parameters ?? []) {
              if (!p.name) continue;
              const pIn = p.in;
              if (pIn !== "path" && pIn !== "query" && pIn !== "body" && pIn !== "header") continue;
              if (pIn === "path") pathParams.push(p.name);
              params.push({
                name: p.name,
                type:
                  p.schema?.type === "integer" || p.schema?.type === "number"
                    ? "number"
                    : p.schema?.type === "boolean"
                      ? "boolean"
                      : "string",
                required: p.required === true,
                description: p.description,
                in: pIn,
              });
            }
            const returnsDescription =
              typeof op.summary === "string"
                ? op.summary
                : typeof op.description === "string"
                  ? op.description.slice(0, 200)
                  : `A JSON response for ${method} ${rawPath}.`;
            endpoints.push({
              id: `ep_${idx++}_local`,
              name,
              description: returnsDescription,
              method,
              path: rawPath,
              params,
              returnsDescription,
            });
            // Each (path, method) is a separate endpoint; don't dedupe
            // because the same path with GET vs POST is a real pair.
          }
        }
      }
    } catch {
      // Not JSON, or not OpenAPI-shaped — fall through to sample pairs.
    }
  }
  // Sample-pair walk.
  if (input.samplePairs) {
    for (let i = 0; i < input.samplePairs.length; i++) {
      const sp = input.samplePairs[i]!;
      // Skip if the sample path is already covered by an OpenAPI walk.
      if (endpoints.some((e) => e.method === sp.method && e.path === sp.path)) continue;
      const name = pathToName(sp.path, i);
      if (!name) continue;
      let returnsDescription = "A JSON response.";
      try {
        const parsed = JSON.parse(sp.responseBody);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const keys = Object.keys(parsed).slice(0, 6);
          if (keys.length > 0) {
            returnsDescription = `Object with fields: ${keys.join(", ")}.`;
          }
        } else if (Array.isArray(parsed)) {
          returnsDescription = "An array of records.";
        }
      } catch {
        // ignore
      }
      const params: ApiParam[] = pathParamsFromUrl(sp.path).map((p) => ({
        name: p,
        type: "string",
        required: true,
        in: "path",
      }));
      let returnsSample: unknown;
      try {
        returnsSample = JSON.parse(sp.responseBody);
      } catch {
        // ignore
      }
      endpoints.push({
        id: `ep_${i}_local_sample`,
        name,
        description: `${sp.method} ${sp.path}`,
        method: sp.method,
        path: sp.path,
        params,
        returnsDescription,
        ...(returnsSample !== undefined ? { returnsSample } : {}),
      });
    }
  }
  return {
    endpoints,
    inputs: {
      docsChars: input.docsText?.length ?? 0,
      sampleChars: JSON.stringify(input.samplePairs ?? []).length,
    },
  };
}

function pathToName(path: string, idx: number): string {
  // Convert "/v1/orders/recent" → "orders_recent" (snake_case).
  // Drop the version segment if it's at the start. Drop path params
  // (anything in {curly}) and any non-identifier chars. Then join
  // remaining segments with underscores.
  const segments = path
    .split("/")
    .filter((s) => s.length > 0)
    .map((s) => s.replace(/[{}]/g, "")) // strip braces from path params
    .filter((s) => s.length > 0);
  if (segments.length === 0) return `endpoint_${idx + 1}`;
  if (/^v\d+$/i.test(segments[0]!)) segments.shift();
  // Snake-case join. /v1/orders/recent → "orders_recent".
  const joined = segments
    .map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, ""))
    .filter((s) => s.length > 0)
    .join("_");
  if (!joined) return `endpoint_${idx + 1}`;
  return joined.slice(0, 48);
}

function pathParamsFromUrl(path: string): string[] {
  const out: string[] = [];
  for (const seg of path.split("/")) {
    const m = seg.match(/^{(.+)}$/);
    if (m) out.push(m[1]!);
  }
  return out;
}

export async function extractEndpoints(
  input: ExtractorInput,
): Promise<ExtractorResult> {
  const upstream = readUpstream();
  if (!upstream) {
    return localExtract(input);
  }
  const userPrompt = buildUserPrompt(input);
  const body = {
    model: upstream.model,
    messages: [
      { role: "system", content: EXTRACTOR_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    response_format: { type: "json_object" as const },
    temperature: 0,
  };
  let res: Response;
  try {
    res = await fetch(`${upstream.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${upstream.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Extractor fetch failed: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Extractor upstream ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Extractor upstream returned no content");
  }
  const parsed = parseLoose(content);
  const rawEndpoints = Array.isArray((parsed as { endpoints?: unknown }).endpoints)
    ? ((parsed as { endpoints: RawEndpoint[] }).endpoints)
    : [];
  const endpoints = rawEndpoints
    .map((r, i) => coerceEndpoint(r, i))
    .filter((e): e is ApiEndpoint => e !== null);
  return {
    endpoints,
    inputs: {
      docsChars: input.docsText?.length ?? 0,
      sampleChars: JSON.stringify(input.samplePairs ?? []).length,
    },
  };
}

/**
 * Local version of the LLM JSON extractor. Mirrors the walker logic
 * from src/planner/openaiPlanner.ts so the extractor can stand alone
 * in the Vite middleware (where importing from src/ would pull the
 * whole renderer graph).
 */
function parseLoose(text: string): unknown {
  // Strip <think>...</think>.
  let t = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  // Strip ```json ... ``` fences if present.
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1]!.trim();
  // Try direct parse.
  try {
    return JSON.parse(t);
  } catch {
    // Try to find a balanced object.
    const start = t.indexOf("{");
    if (start >= 0) {
      const sub = walkBalanced(t, start);
      try {
        return JSON.parse(sub);
      } catch {
        // last resort: greedy regex
        const m = t.match(/\{[\s\S]*\}/);
        if (m) {
          try {
            return JSON.parse(m[0]);
          } catch {
            // fall through
          }
        }
      }
    }
    throw new Error("Extractor could not parse LLM response as JSON");
  }
}

function walkBalanced(text: string, start: number): string {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (escape) { escape = false; continue; }
    if (inString) {
      if (c === "\\") { escape = true; continue; }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}
