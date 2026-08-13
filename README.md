# Generative Interface Runtime

> A constrained runtime in which an LLM dynamically constructs high-quality
> user interfaces from APIs and data, while software — not the model — enforces
> the design system, accessibility, and component contract.

The runtime is a proof of a different way to build applications: **APIs and data
become the underlying application layer, while AI dynamically constructs the user
interface needed to interact with those capabilities.** A merchant can say
*"Show me how the business performed this month"* and get back a polished
dashboard. A follow-up — *"Why was revenue lower last week? Add customer retention."* —
adapts the same dashboard, preserves its structure, and adds what was asked for.

**The model decides *what*. The application decides *how* and *whether*.**

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure (optional — falls back to MockPlanner if you skip this)
cp .env.example .env.local
# edit .env.local and add your API key

# 3. Run
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build       # tsc -b + vite build
npm run preview     # serve dist/
npm run typecheck   # strict tsc, no emit
npm run smoke       # MockPlanner end-to-end pipeline check (no browser, no API)
```

URL hash trick for screenshots and sharing — append `#intent=...` to auto-submit
on load. Chain `&modify=...` for a two-step create+modify. Add `&spec=open` to show
the spec JSON.

```
http://localhost:5173/#intent=Show%20me%20how%20the%20business%20performed%20this%20month
http://localhost:5173/#intent=Show%20me%20the%20business%20performed%20this%20month&modify=Add%20customer%20retention&spec=open
```

## What you get

- **A constrained UI DSL** with 8 component types (dashboard, section, metricCard,
  chart, table, text, insight, comparison). The LLM picks structure and data
  references; the runtime owns tokens, accessibility, layout, and component
  contract.
- **Two planner implementations**: `MockPlanner` (deterministic, offline) and
  `OpenAIPlanner` (OpenAI-compatible transport, model-agnostic).
- **Deterministic validation pipeline** (Zod schema + 13+ semantic rules).
  Anything the LLM emits is checked before it renders.
- **Bring Your Own Data (BYOD)** — drop a CSV or JSON file in the dialog and it
  becomes a runtime capability the planner can reference. Backend persists to
  `data/sources.json` (gitignored).
- **Bring Your Own API (BYOAPI)** — register any JSON-based API by name, base
  URL, and (optionally) docs link / docs file / sample request-response
  pairs. The runtime calls an LLM to extract the endpoint list, then exposes
  each endpoint as its own `user.<api>.<endpoint>` capability. Calls run
  live, server-side, with the auth header stored server-side only.
- **API Keys vault** — add named keys once, reference them from any number
  of registered APIs. Keys live in `data/keys.json` (gitignored); the value
  never reaches the browser. Usage count and last-used timestamp show in the
  UI.
- **Where-filter + chart aggregation** so per-day, per-product breakdowns work
  on hourly data without round-trips.
- **Hash trick for headless / CI** — drive the LLM via the URL hash and capture
  a screenshot without opening the browser.

## File layout

```
src/
├── dsl/
│   └── schema.ts             # Zod schemas — the only place types are defined
├── registry/
│   ├── components.ts         # Component registry — what the planner may emit
│   ├── capabilities.ts       # Capability catalog — built-in mock data refs
│   └── validation.ts         # Deterministic rules (D-001..D-013, A-001..A-002)
├── design/
│   ├── tokens.css            # Design tokens (semantic, never raw values)
│   └── global.css            # Reset + base styles
├── data/
│   ├── mockData.ts           # In-memory dataset (merchant, customers, etc.)
│   ├── capabilityResolver.ts # capability name → data
│   ├── sourcesRegistry.tsx   # React store for BYOD sources
│   ├── dynamicCapabilities.ts # SourceRecord → CapabilityDescriptor
│   └── resolveValue.ts       # value OR valueRef → value, with where filter
├── planner/
│   ├── planner.ts            # Planner interface + 3-tier LLM transport
│   ├── mockPlanner.ts        # MockPlanner (first-slice default)
│   ├── openaiPlanner.ts      # OpenAIPlanner (env-flagged)
│   └── index.ts              # createPlanner() factory
├── renderer/
│   ├── renderer.module.css   # All component styles
│   ├── DashboardView.tsx
│   ├── SectionView.tsx
│   ├── NodeRenderer.tsx
│   ├── leaves/               # One file per leaf component
│   ├── format.ts             # Number formatters
│   └── resolveValue.ts       # Inline value OR capability ref → value
├── app/                      # App shell (App, TopBar, IntentPanel, DataSourceDialog, ...)
└── main.tsx
docs/
├── DESIGN_CONSTITUTION.md    # Principles the AI must follow
├── ARCHITECTURE.md           # Deeper notes
└── AGENTS.md                 # Structured project map for AI agents
vite/
├── apiProxy.ts               # /api/chat → upstream LLM (server-side auth)
└── sourcesApi.ts             # /api/sources CRUD + schema inference (BYOD)
samples/
└── hourly_product_mix.csv    # 336 rows of hourly product mix (test data)
scripts/
└── gen-hourly-mix.mjs        # Regenerate the sample CSV
```

## Architecture

```
User intent  (natural language)
     │
     ▼
┌─────────────────────────────────────────────┐
│  Planner  (model-agnostic)                  │
│   - MockPlanner (deterministic, offline)    │
│   - OpenAIPlanner (OpenAI-compatible API)   │
└────────────────┬────────────────────────────┘
                 │   UISpecification  (Zod-validated)
                 ▼
┌─────────────────────────────────────────────┐
│  Validation                                 │
│   1. Zod schema  (structural)               │
│   2. Deterministic rules (D-*, A-*)         │
│   3. (optional) AI UX critic                │
└────────────────┬────────────────────────────┘
                 │   valid UISpecification
                 ▼
┌─────────────────────────────────────────────┐
│  Renderer  (React)                          │
│   - maps DSL nodes → registered components  │
│   - resolves capability refs → data        │
│   - applies design tokens, never raw values │
│   - aggregates bar/pie data by x (sum y)    │
│   - applies where filter (client-side)      │
└────────────────┬────────────────────────────┘
                 │
                 ▼
            Rendered UI
```

## The UI DSL

The model is only allowed to emit these component types:

| Type         | Purpose                                          |
|--------------|--------------------------------------------------|
| `dashboard`  | Root container                                   |
| `section`    | Grouping band with column grid                   |
| `metricCard` | Single big number + label + delta                |
| `chart`      | `line` / `bar` / `area` / `pie` visualization   |
| `table`      | Tabular data                                     |
| `text`       | Body copy                                        |
| `insight`    | Highlighted callout                              |
| `comparison` | Side-by-side comparison                          |

Structure is fixed: **dashboard → section → leaf**. Nesting beyond that is
structurally impossible. The validator enforces semantic rules (max primary
metric, density caps, no duplicate labels, capability existence).

**The DSL is token-naming only.** The model picks `chart.1`, never `#3978D4`.
It picks `accent.fg`, never a raw color. The renderer reads the token, the
design system owns the value.

**Data is capability-referencing only.** The model emits
`{ capability: "merchant.getRevenueSeries", params: { range: "30d" } }`, the
resolver returns real data. The model never invents numbers.

### Example spec

```json
{
  "type": "dashboard",
  "title": "Saturday product mix",
  "children": [
    {
      "type": "section",
      "title": "Saturday",
      "children": [
        {
          "type": "chart",
          "kind": "pie",
          "title": "Saturday product mix",
          "data": {
            "capability": "user.hourly_product_mix",
            "params": {},
            "where": { "day": "Sat" }
          },
          "x": "product",
          "y": "revenue",
          "yFormat": "currency"
        }
      ]
    }
  ]
}
```

## Bring Your Own Data (BYOD)

Upload a CSV or JSON file via the **＋ Connect data** button (top right). The
backend infers types per column, stores rows in `data/sources.json`, and the
source becomes a `user.<sanitized-name>` capability the planner can reference.

**Schema inference**: walks the first 20 rows, classifies each column as
`string` / `number` / `date` / `boolean` based on regex and Date.parse checks.

**Type coercion**: cells are converted to their inferred types (e.g. `"9360"`
→ `9360`) before saving so the resolver returns real numbers, not string-encoded.

**Endpoints** (Vite middleware in `vite/sourcesApi.ts`):

| Method | Path                          | Body                            | Returns                |
|--------|-------------------------------|---------------------------------|------------------------|
| GET    | `/api/sources`                | —                               | `{ sources: [...] }`   |
| GET    | `/api/sources/:id`            | —                               | source metadata        |
| GET    | `/api/sources/:id/data`       | —                               | `{ rows: [...] }`      |
| POST   | `/api/sources`                | `{ name, kind, content }`       | created source         |
| DELETE | `/api/sources/:id`            | —                               | `{ ok: true }`         |

Test data lives at `samples/hourly_product_mix.csv` (336 rows × 7 days × 4 products).

### Chart engine behaviors for user data

- **Where filter** — `data.where: { day: "Sat" }` filters rows client-side after
  the resolver runs. Each entry is strict equality. Use to scope a single chart
  to a subset of rows.
- **Aggregation** — bar and pie charts auto-aggregate by `x` (sum y for
  duplicate x values). A bar with `x: "product"` over hourly rows gives one
  bar per product. Line/area pass through as-is (one row = one observation).

## Bring Your Own API (BYOAPI)

Click **＋ Connect data** → **API**. Fill in:

- **API name** — appears as the capability prefix (`user.<name>.<endpoint>`)
- **Base URL** — prepended to every path
- **Authentication** (optional) — pick one of:
  - **Use a saved key** — pick from the API Keys vault (recommended; the
    value stays server-side)
  - **Inline header** — paste a header value (e.g. `Bearer sk-…`); stored
    on the source record, stripped from GET responses
  - **No auth** — for open endpoints
- **Documentation** (any combination, all optional):
  - **Docs link** — URL to docs (HTML is stripped to text, JSON / OpenAPI is
    passed through). 8s timeout, 1 MB cap.
  - **Docs file** — drag-and-drop `.md` / `.txt` / `.json` / `.yaml`
  - **Sample request/response pairs** — paste a response you got from the API
    and the path you called; the LLM extracts the method, path, params, and
    response shape

Hit **Register API** and wait. The LLM extractor returns a list of
`{ method, path, params, returnsDescription }` per endpoint. The full
source is persisted to `data/sources.json`; auth header is stripped from
the public view.

Once registered, the planner advertises each endpoint as its own
capability. The first call per `(api, endpoint, params)` is slow (real
HTTP request); subsequent calls hit an in-memory cache. Force a refresh
by removing and re-registering the source.

**Live execution** — when a dashboard renders, calling
`user.<api>.<endpoint>` runs the request server-side (the
`vite/sourcesApi.ts` middleware), with the auth header attached. The
response is normalized: an array passes through, a single object is
wrapped in a one-element array so the chart engine can use it as a row,
anything else is treated as an empty array.

**Security model:**
- The auth header never leaves the dev server. The `GET /api/sources`
  response strips it before sending to the browser.
- Outbound API calls run with a 15s timeout and 4 MB response cap.
- Docs-link fetches run with 8s timeout and 1 MB cap, text/JSON/XML/YAML
  only.

### API Keys vault

Click **＋ Connect data** → **API keys**. Add named keys (e.g.
`stripe-prod`, `openweather`) once and reference them by name from any
number of registered APIs.

- Storage: `data/keys.json` (gitignored, like `sources.json`)
- The key value is sent verbatim as the `Authorization` header on every
  call to APIs that reference it
- The GET endpoints return name + created/last-used timestamps + usage
  count, but NEVER the value
- If you delete a key while APIs still reference it, those APIs fail
  their next call with a clear "key not found" error pointing at the
  missing key name

For the full design rationale see
[`docs/API_REGISTRATION.md`](./docs/API_REGISTRATION.md).

## Configuration

Copy `.env.example` to `.env.local` and fill in the values:

```bash
MINIMAX_BASE_URL=https://api.minimax.io/v1   # or any OpenAI-compatible base
MINIMAX_API_KEY=sk-cp-...                    # server-side only — never VITE_*
MINIMAX_DEBUG=1                              # 1 to log every proxied request
VITE_OPENAI_MODEL=MiniMax-M3                 # exposed to the browser bundle
# VITE_OPENAI_BASE_URL=/api                   # frontend target (default: same-origin /api)
```

The browser never holds the API key. The Vite dev-server middleware
(`vite/apiProxy.ts`) forwards `POST /api/chat/completions` to the upstream and
adds the `Authorization` header. In production, deploy any backend that
implements the same `/api/chat` contract and set `VITE_OPENAI_BASE_URL` to
its origin.

If env vars are missing the app falls back to `MockPlanner` and stays fully
demoable offline.

## Design system

The full token vocabulary lives in `src/design/tokens.css`. Highlights:

- **Color**: semantic surface / foreground / border / status / chart palette
- **Spacing**: 4pt scale (`--space-1` … `--space-12`)
- **Radius**: gentle scale (`--radius-xs` … `--radius-2xl`)
- **Type**: Inter, 11–60px, weights 400/500/600/700
- **Elevation**: layered shadows + focus ring
- **Motion**: 120/200/320/480ms, standard ease

Aesthetic: restrained, precise, generous whitespace, one accent color. No
glassmorphism, no gratuitous gradients. See
[`docs/DESIGN_CONSTITUTION.md`](./docs/DESIGN_CONSTITUTION.md) for the full
principle set the AI must follow.

## Development

### Adding a new component type

1. Add a Zod schema in `src/dsl/schema.ts` and add it to `LeafSchema`.
2. Register the component in `src/registry/components.ts` with `type`,
   `category`, `purpose`, `useWhen`, `avoidWhen`, `example`.
3. Add a renderer at `src/renderer/leaves/MyNewView.tsx` using design tokens
   only. Use `var(--color-...)` not hex values.
4. Add a case in `src/renderer/NodeRenderer.tsx`.
5. Add it to the system-prompt quick reference in
   `src/planner/openaiPlanner.ts:buildSystemPrompt`.
6. Add a test in `scripts/smoke.ts` exercising the new node type.

### Adding a new built-in capability

1. Add a `CapabilityDescriptor` to `src/registry/capabilities.ts`.
2. Add a resolver to `src/data/capabilityResolver.ts` that returns the data
   shape you described in the descriptor.
3. Add a test case to `scripts/smoke.ts` that plans with the new capability.

### Adding a new planner

1. Implement the `Planner` interface (`src/planner/planner.ts`).
2. Wire it into `createPlanner()` in `src/planner/index.ts`.
3. The transport helper `fetchOpenAICompletion` is reusable for any
   OpenAI-compatible endpoint — override the `response_format` strategy
   per provider.

### Testing

`npm run smoke` exercises the full pipeline against `MockPlanner`:

- 13 intents across create + modify modes
- Zod parse + deterministic rules for each output
- Asserts each output is structurally valid

For the user-data path, `scripts/test-table-alias.mjs` and
`scripts/test-where-aggregate.mjs` verify the resolver and chart aggregation
against the running dev server. Both assume a dev server at
`http://localhost:5173` and a registered `user.hourly_product_mix` source.

## See also

- [`docs/DESIGN_CONSTITUTION.md`](./docs/DESIGN_CONSTITUTION.md) — design principles
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — deeper architecture notes
- [`docs/AGENTS.md`](./docs/AGENTS.md) — structured project map for AI agents
- [`PLAN.md`](./PLAN.md) — the implementation plan this MVP was built from

## License

MIT
