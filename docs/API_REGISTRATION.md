# Generative API Registration

This document is the design contract for the BYOAPI (Bring Your Own API) feature.
The TL;DR: the user supplies a base URL plus *any* of (docs link, docs file,
sample request/response pairs), the runtime calls an LLM to extract a list
of endpoints, the user reviews, the runtime registers the API, and from then
on the planner can call any of the API's endpoints like any other capability.

---

## Why

Today's BYOD flow (`data/sources.json` + `user.<name>` rows) covers **static
data**. Many real-world products want a live API — a Stripe, a Salesforce
read endpoint, an internal microservice, a public weather lookup. A user
should be able to register an API once and have it act like a first-class
data source, without writing any resolver code.

---

## User-facing flow

1. User clicks **＋ Connect data** → **API** tab.
2. They fill in:
   - **API name** (free text, e.g. `weather`)
   - **Base URL** (e.g. `https://api.weather.com`)
   - **Auth header** (optional, e.g. `Bearer sk-…`) — stored server-side, never
     sent back to the browser bundle.
   - **Docs link** (optional URL)
   - **Docs file** (optional, drag-and-drop `.md` / `.txt` / `.json` / `.yaml`)
   - **Sample request + response** (optional JSON paste — repeatable to add
     multiple examples)
3. They click **Generate capabilities**. Backend:
   - Fetches the docs link (if any) and reads the docs file (if any).
   - Concatenates all sample request/response pairs.
   - Sends the combined text to the LLM with a focused extractor prompt.
   - Returns a list of proposed `ApiEndpoint` objects.
4. UI shows the proposed endpoints (name, method, path, params, returns).
   User can edit the name (must be a valid identifier suffix) and remove
   ones they don't want.
5. User clicks **Save**. The API source is written to `data/sources.json`.
6. The planner now advertises the endpoints as `user.weather.getCurrent` etc.
7. When a dashboard is generated, the resolver actually calls the API.

---

## Data model

`SourceRecord` is a **discriminated union** of three kinds:

```ts
type SourceRecord = CsvSourceRecord | JsonSourceRecord | ApiSourceRecord;

interface CsvSourceRecord {
  kind: "csv";
  id: string;
  name: string;
  registeredAt: string;
  rowCount: number;
  schema: { columns: SourceColumn[] };
  capability: string;          // "user.<sanitized>"
}

interface JsonSourceRecord {
  kind: "json";
  id: string;
  name: string;
  registeredAt: string;
  rowCount: number;
  schema: { columns: SourceColumn[] };
  capability: string;          // "user.<sanitized>"
}

interface ApiSourceRecord {
  kind: "api";
  id: string;
  name: string;
  registeredAt: string;
  capability: string;          // "user.<sanitized>" — base name only
  baseUrl: string;
  authHeader?: string;         // server-side only — NEVER returned to the client
  keyName?: string;            // resolves to actual value at call time, from the API Keys vault
  endpoints: ApiEndpoint[];
  /** Inputs the user supplied, retained for re-generation. */
  docsLink?: string;
  docsFilePath?: string;       // path on disk under data/docs/
  samplePairs?: ApiSamplePair[];
}

interface ApiEndpoint {
  id: string;                  // stable, used as cache key suffix
  name: string;                // "getCurrent" (combined with api capability → "user.weather.getCurrent")
  description: string;
  method: "GET" | "POST";
  path: string;                // "/v1/weather/{city}"
  params: ApiParam[];
  returnsDescription: string;  // human-readable, goes into the system prompt
  returnsSample?: unknown;     // first-level sample response, used for runtime inference
}

interface ApiParam {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description?: string;
  in: "path" | "query" | "body" | "header";
}

interface ApiSamplePair {
  /** Free-form label, e.g. "current weather for London". */
  label: string;
  method: "GET" | "POST";
  path: string;                // exact path the user called, e.g. "/v1/weather/London"
  requestBody?: string;        // JSON text, for POSTs
  responseBody: string;        // JSON text
}
```

### Storage

- **APIs** in `data/sources.json` (existing path, same file as csv/json).
  The `authHeader` field is the only one that stays server-side; the
  GET endpoint strips it before returning to the browser.
- **Docs files** in `data/docs/<apiId>.<ext>` (new path, gitignored).
  Read at registration time, persisted so the user can re-generate.
- **Sample responses** are inlined in the source record (`samplePairs`).

### Sanitization

- `user.<sanitized>` is the base capability name. The same logic as
  csv/json: lowercase, non-alphanumerics → `_`, max 48 chars.
- Each endpoint's full capability is `user.<sanitized>.<endpointName>`.
- Endpoint names must also be sanitized (lowercase, no spaces, snake_case).
  The extractor prompt enforces this.

---

## Execution

When the resolver sees a capability name like `user.weather.getCurrent`:

1. Parse `<base>` and `<endpoint>` from the capability name.
2. Find the `ApiSourceRecord` whose `capability === "user.<base>"`.
3. Find the `ApiEndpoint` whose `name === "<endpoint>"`.
4. Build the URL: `baseUrl + path`, substituting `{param}` placeholders with
   values from `data.params`.
5. Add query string (for GET) or body (for POST) from the remaining params.
6. Add `Authorization` header from `authHeader` if present.
7. Make the request server-side (so CORS never bites).
8. Parse the JSON response.
9. Cache the response in-memory by hash(api, endpoint, params) — process-lifetime.
10. Return the data.

### Where the live call happens

The resolver on the **client** (currently `src/data/capabilityResolver.ts` and
`src/data/resolveValue.ts`) cannot call external APIs directly — browsers
block most cross-origin requests, and we never want the API key in the
bundle. So:

- The client resolver, for an API capability, calls
  `GET /api/sources/<id>/call?endpoint=<name>&p.<key>=<value>…`
- The server middleware (`vite/sourcesApi.ts`) does the actual HTTP call
  with the server-stored `authHeader`.
- Server returns the JSON, client passes it through unchanged.

This keeps the API key server-side and keeps the client resolver a thin
shim over an HTTP boundary — same pattern as the existing `fetchSourceData`
helper.

### Caching

In-memory `Map<string, { data: unknown; at: number }>`, keyed by
`${apiId}:${endpointId}:${hash(params)}`. The cache is per dev-server
process. The user can force a refresh by re-generating the source or by
adding a `?fresh=1` to the call URL (not exposed in the UI yet, but
handy for debugging).

---

## Extractor prompt

The LLM call that converts docs + samples → endpoint list uses a focused,
narrow prompt (not the general planner system prompt). It receives:

- The docs text (concatenated, capped at 8 KB to keep the call small)
- A JSON array of sample pairs (each as `{ label, method, path, request, response }`)
- The base URL
- A short system message

It returns a single object `{ endpoints: ApiEndpoint[] }`. Same
`response_format` fallback as the planner (json_schema → json_object →
none). Same `parseLLMJson` extractor for robustness.

The prompt explicitly says: **return endpoints only, no commentary**. If
the docs are too thin to identify endpoints, return `{ endpoints: [] }`
and the UI tells the user to supply more samples.

---

## API Keys vault

Reusable named credentials for any number of registered APIs.

- Storage: `data/keys.json` (gitignored, like `sources.json`)
- Each key has: `id`, `name` (sanitized, unique), `value`, `createdAt`,
  `lastUsedAt?`, `notes?`
- `GET /api/keys` returns names + metadata + `usedBySources` count, but
  NEVER the value
- `POST /api/keys` creates; duplicate names return 409
- `PATCH /api/keys/:id` updates value / name / notes
- `DELETE /api/keys/:id` removes; any API source still referencing the
  name fails its next call with `API source "<name>" references key
  "<keyName>" but that key no longer exists in the vault.`

**Resolution at call time** — when the middleware executes a call for a
source that has `keyName`, it calls `resolveAuthHeader(src)` which:

1. Looks up the key by name in the vault
2. Records `lastUsedAt`
3. Returns the value

The value never lands on the source record, never in any response to
the browser, and never in any log line.

**Precedence** — if a source has both `keyName` and `authHeader`, the
key wins. Inline `authHeader` is the fallback for sources that were
registered before the keys vault existed, or for one-off cases where
the user doesn't want a reusable key.

---

## System-prompt integration

The planner's system prompt already includes the capability catalog via
`ctx.capabilities`. The catalog is built in `src/app/App.tsx` from
`builtinCapabilities + capabilitiesFromSources(userSources)`.

For an API source, each endpoint becomes its own `CapabilityDescriptor`,
with:
- `name`: `user.weather.getCurrent`
- `domain`: `"system"`
- `description`: the LLM-extracted sentence
- `useWhen`: the LLM-extracted hint, plus a one-liner that says "this
  calls a live API at render time"
- `params`: the endpoint's `params` (translated to the existing
  `CapabilityParam` shape)
- `returns`: the LLM-extracted `returnsDescription`, with a hint that
  if it's an object it will be wrapped in a single-element array so
  the chart engine can use it as a row

---

## Files

| Path | What |
|---|---|
| `src/data/sourcesRegistry.tsx` | Add `ApiSourceRecord`, `ApiEndpoint`, `ApiParam`, `ApiSamplePair` to the union. New `registerApi` action, `callApiEndpoint` helper, and the API Keys CRUD helpers. |
| `src/data/dynamicCapabilities.ts` | `apiSourceToCapabilities(src)` — one `CapabilityDescriptor` per endpoint. `summarizeSource` notes `uses key: <name>` when the source references a vault key. |
| `src/data/capabilityResolver.ts` | When a capability name starts with `user.*.*`, route to the live-call path. |
| `vite/sourcesApi.ts` | New POST `/api/sources` body for `kind: "api"`. New GET `/api/sources/:id/call`. Validates `keyName` and passes through to the live-call middleware. |
| `vite/apiExtractor.ts` (new) | The LLM extractor prompt + response handling. Reuses `parseLLMJson`. |
| `vite/docsFetcher.ts` (new) | URL fetch with timeout, size cap, content-type sniffing. |
| `vite/apiCaller.ts` (new) | Live-call execution with param substitution + in-memory cache. Accepts an `effectiveAuthHeader` so the middleware can pass the resolved value. |
| `vite/keysApi.ts` (new) | API Keys vault: `data/keys.json` storage, GET/POST/PATCH/DELETE `/api/keys`, `findKeyByName`, `recordKeyUsage`, `resolveAuthHeader`. |
| `src/app/DataSourceDialog.tsx` | Three tabs: Upload, API, API keys. The API form has a 3-mode auth selector (no auth / saved key / inline header). The Keys tab is a full CRUD UI. |
| `src/app/TopBar.tsx` | Show API source count. |

---

## Known limitations (v1)

- **No retries on transient errors.** A 503 surfaces to the user as-is.
- **No streaming responses.** A long-running request blocks until done.
- **No pagination params.** The LLM can emit a `page` or `cursor` param
  via the extractor; we just don't do anything special with it.
- **Auth is one header per API.** Multi-header auth (e.g. AWS SigV4) is
  out of scope.
- **No interactive re-auth.** Re-keying means removing and re-registering.
- **Docs-link fetch is text-only.** HTML is rendered as text (no DOM
  walking). PDFs are not supported. Most public API docs work because
  they ship an OpenAPI/Swagger JSON or a plain Markdown.
