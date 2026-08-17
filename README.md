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
npm run test:data   # isolated SQLite compiler and security checks
npm run seed:showcase  # import the 58,400-row Northstar demo (dev server required)
```

To see the full SQLite-backed showcase, run the dev server, seed the data in a
second terminal, then open the generated dashboard:

```bash
npm run dev
npm run seed:showcase
open 'http://localhost:5173/#intent=Build%20the%20Northstar%20annual%20performance%20dashboard'
```

Hash-driven demos and automation: append `#intent=...` to auto-submit on load.
Chain `&modify=...` for a two-step create+modify. Add `&spec=open` to show the
spec JSON.

```
http://localhost:5173/#intent=Show%20me%20how%20the%20business%20performed%20this%20month
http://localhost:5173/#intent=Show%20me%20the%20business%20performed%20this%20month&modify=Add%20customer%20retention&spec=open
```

## What you get

- **A constrained UI DSL** with 10 node types (dashboard, section, metricCard,
  chart, table, text, codeBlock, separator, insight, comparison). The LLM picks
  structure and data references; the runtime owns tokens, accessibility,
  layout, and the component contract.
- **A Recharts-backed JSON chart compiler** with line, area, bar, composed,
  scatter, pie, donut, radar, radialBar, funnel, and treemap charts. Agents can
  choose axes, multiple series, stacking, tile dimensions, and chart options
  without emitting React or executable code.
- **Two planner implementations**: `MockPlanner` (deterministic, offline) and
  `OpenAIPlanner` (OpenAI-compatible transport, model-agnostic).
- **Deterministic validation pipeline** (Zod schema + semantic rules).
  Anything the LLM emits is checked before it renders.
- **Bring Your Own Data (BYOD)** — drop a CSV or JSON file in the dialog and it
  is imported into an immutable table in `data/runtime.sqlite` (gitignored).
- **JSON-to-SQL data compiler** — agents define named datasets with safe filters,
  date buckets, grouping, aggregation, renaming, sorting, and limits. The local
  runtime compiles those definitions into parameterized SQLite queries.
- **Where-filter + direct chart field binding** so agents can scope capability
  rows and assign exact fields to axes and series without round-trips.
- **Hash-driven demos and CI** — submit an intent and optional modification from
  the URL without manual interaction.

## File layout

```
src/
├── dsl/
│   └── schema.ts             # Zod schemas — the only place types are defined
├── registry/
│   ├── components.ts         # Component registry — what the planner may emit
│   ├── capabilities.ts       # Capability catalog — built-in mock data refs
│   └── validation.ts         # Deterministic D-*, Q-*, and A-* rules
├── design/
│   ├── tokens.css            # Design tokens (semantic, never raw values)
│   └── global.css            # Reset + base styles
├── data/
│   ├── mockData.ts           # In-memory dataset (merchant, customers, etc.)
│   ├── capabilityResolver.ts # capability name → data
│   ├── sourcesRegistry.tsx   # React store for BYOD sources
│   ├── dynamicCapabilities.ts # Profiled SQLite source → planner descriptor
│   ├── querySchema.ts         # Agent-friendly transformation DSL
│   └── DatasetContext.tsx     # Async named-dataset resolution
├── planner/
│   ├── planner.ts            # Planner interface + 3-tier LLM transport
│   ├── mockPlanner.ts        # MockPlanner (first-slice default)
│   ├── showcaseDashboard.ts  # SQLite-backed Northstar example spec
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
├── sourceParsing.ts           # CSV/JSON parsing, inference, coercion
├── sqliteStore.ts             # SQLite import + safe query compiler
└── sourcesApi.ts              # /api/sources CRUD + /api/query
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
│   - resolves capabilities/named datasets   │
│   - sends dataset transforms to SQL compiler│
│   - applies design tokens, never raw values │
│   - compiles chart JSON into Recharts        │
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
| `chart`      | Recharts-backed visualization from declarative JSON         |
| `table`      | Tabular data                                     |
| `text`       | Body copy                                        |
| `codeBlock`  | Safe, display-only code or configuration         |
| `separator`  | Horizontal divider between content groups        |
| `insight`    | Highlighted callout                              |
| `comparison` | Side-by-side comparison                          |

Structure is fixed: **dashboard → section → leaf**. Nesting beyond that is
structurally impossible. The validator enforces semantic rules (max primary
metric, density caps, no duplicate labels, capability existence).

`dashboard.hero` is an optional cover configuration, not another node type. It
controls the dashboard title presentation, supporting copy, height, alignment,
and a bounded background treatment. Without it, the dashboard renders a compact
title header.

**The DSL is token-naming only.** The model picks `chart.1`, never `#3978D4`.
It picks `accent.fg`, never a raw color. The renderer reads the token, the
design system owns the value.

**Data can be referenced, queried, or inline.** For built-in application data, the model emits
`{ capability: "merchant.getRevenueSeries", params: { range: "30d" } }` and the
resolver returns rows. Uploaded sources are queried through a named top-level
dataset and leaves use `{ dataset: "monthlyTraffic" }`. A chart may also contain
an inline JSON array when the dashboard is intentionally self-contained. None
of these paths permits executable code.

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
          "xAxis": { "key": "product", "type": "category" },
          "yAxes": [
            { "id": "primary", "format": "currency", "side": "left" }
          ],
          "series": [
            {
              "key": "revenue",
              "label": "Revenue",
              "color": "chart.1",
              "yAxisId": "primary"
            }
          ],
          "options": {
            "showLegend": true,
            "showTooltip": true
          },
          "height": 280,
          "layout": { "columnSpan": 6, "rowSpan": 1 }
        }
      ]
    }
  ]
}
```

## Bring Your Own Data (BYOD)

Upload a CSV or JSON file via the **＋ Connect data** button (top right). The
backend imports it into an immutable SQLite table in `data/runtime.sqlite` and
assigns a stable logical source name such as `user.website_traffic`. Dashboard
JSON never contains the physical database path or internal table name.

**Schema inference and profiling**: classifies columns as `string`, `number`,
`date`, or `boolean`, then records null counts, distinct counts, ranges, and
small samples for the planner. The complete upload is never sent to the model.

**Type coercion**: cells are converted to their inferred types (e.g. `"9360"`
→ `9360`) before saving so the resolver returns real numbers, not string-encoded.

**Endpoints** (Vite middleware in `vite/sourcesApi.ts`):

| Method | Path                          | Body                            | Returns                |
|--------|-------------------------------|---------------------------------|------------------------|
| GET    | `/api/sources`                | —                               | `{ sources: [...] }`   |
| GET    | `/api/sources/:id`            | —                               | source metadata        |
| GET    | `/api/sources/:id/data?limit` | —                               | bounded preview rows   |
| POST   | `/api/sources`                | `{ name, kind, content }`       | created source         |
| DELETE | `/api/sources/:id`            | —                               | `{ ok: true }`         |
| POST   | `/api/query`                   | dataset definition              | chart-ready rows       |

Test data lives at `samples/hourly_product_mix.csv` (336 rows × 7 days × 4 products).

### Dataset transformation contract

Named datasets live at `dashboard.datasets`. The runtime validates them and
compiles them into parameterized, read-only SQLite `SELECT` statements:

```json
{
  "datasets": {
    "monthlyTraffic": {
      "source": "user.website_traffic",
      "transform": {
        "filters": [
          { "field": "status_code", "operator": "lessThan", "value": 400 }
        ],
        "dimensions": [
          { "field": "timestamp", "as": "month", "timeBucket": "month" }
        ],
        "metrics": [
          { "operation": "count", "as": "pageViews" },
          { "field": "visitor_id", "operation": "countDistinct", "as": "visitors" }
        ],
        "sort": [{ "field": "month", "direction": "asc" }],
        "limit": 24
      }
    }
  }
}
```

Supported transformations:

- `select`: project and rename raw fields for non-aggregated results.
- `filters`: `equals`, `notEquals`, comparisons, `contains`, `in`, `notIn`,
  `isNull`, and `isNotNull`; filters are combined with `AND`.
- `dimensions`: grouped fields, with optional `hour`, `day`, `week`, `month`,
  `quarter`, or `year` date bucketing.
- `metrics`: `count`, `countDistinct`, `sum`, `average`, `min`, and `max`.
- `sort`: order by output fields or aliases.
- `limit`: hard-capped at 5,000 result rows.

Raw source tables are never modified. Transformation definitions remain in the
portable dashboard JSON; only their bounded results are sent to Recharts or tables.

### Chart JSON contract

The JSON is the public, agent-friendly API. Recharts is an implementation
detail behind the renderer. The agent never needs to know JSX component trees,
callbacks, or Recharts internals.

| Field | Purpose |
|---|---|
| `title`, `description`, `caption` | Heading, context above the chart, and an explanatory note underneath it |
| `kind` | `line`, `area`, `bar`, `composed`, `scatter`, `pie`, `donut`, `radar`, `radialBar`, `funnel`, or `treemap` |
| `data` | Named dataset reference, built-in capability, or inline row array |
| `xAxis` | Category or numeric field, date/number formatting, label, and visibility |
| `yAxes` | Up to two named axes, including side, format, domain, and visibility |
| `series` | One entry per measure: data key, label, type, color token, axis, stack, curve, dots, labels, and formatting |
| `options` | Grid, legend, tooltip, and legend-position switches |
| `height` | Rendered chart height in pixels within the schema's safe range |
| `layout` | Shared tile placement and treatment: `columnSpan`, `columnStart`, `rowSpan`, `surface`, `padding`, and `verticalAlign` |

Every leaf is placed in the same tile envelope. Array order in `section.children`
is the semantic reading order. `layout.columnSpan` controls width,
`layout.columnStart` optionally chooses a bounded starting track, and `rowSpan`
controls vertical span. Narrative tiles may choose a `card`, `subtle`, or `accent`
surface, bounded padding, and vertical alignment. The same contract applies to
charts, metrics, text, code, insights, and tables. Validation recommends no more
than four visible tiles in a row but does not limit the dashboard to four tiles total.

A composed chart can mix series types and axes:

```json
{
  "type": "chart",
  "kind": "composed",
  "title": "Revenue and conversion",
  "data": [
    { "month": "Jan", "revenue": 42000, "conversion": 3.1 },
    { "month": "Feb", "revenue": 51000, "conversion": 3.8 }
  ],
  "xAxis": { "key": "month", "type": "category" },
  "yAxes": [
    { "id": "money", "side": "left", "format": "currency" },
    { "id": "rate", "side": "right", "format": "percent" }
  ],
  "series": [
    { "key": "revenue", "label": "Revenue", "type": "bar", "color": "chart.1", "yAxisId": "money" },
    { "key": "conversion", "label": "Conversion", "type": "line", "color": "chart.2", "yAxisId": "rate", "curve": "monotone", "showDots": true }
  ],
  "options": { "showGrid": true, "showLegend": true, "showTooltip": true },
  "height": 320,
  "layout": { "columnSpan": 8, "rowSpan": 1 }
}
```

Legacy chart specs that use `x`, `y`, `yFormat`, `seriesColors`, and
`showLegend` can be migrated mechanically: `x` becomes `xAxis.key`; each `y`
becomes a `series` entry; `yFormat` moves to the relevant y-axis or series;
colors move to `series[].color`; and display switches move under `options`.

### Chart data behavior

- **Named dataset** — `data: { dataset: "monthlyTraffic" }` executes the
  corresponding top-level query definition and binds to its output aliases.

- **Where filter** — `data.where: { day: "Sat" }` filters rows client-side after
  the resolver runs. Each entry is strict equality. Use to scope a single chart
  to a subset of rows.
- **Field binding** — `xAxis.key` and `series[].key` bind directly to row fields.
  Prepare or select rows at the granularity the chart should display.
- **Multiple series** — add entries to `series`; use `stackId` for compatible
  stacks and `yAxisId` to bind a series to one of several y-axes.

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

- 15 intents across create + modify modes
- Zod parse + deterministic rules for each output
- Schema validation for every component-registry example
- Asserts each output is structurally valid

For the user-data path, `npm run test:data` verifies SQLite import, profiling,
safe query compilation, aggregation, projection, and hostile-field rejection.
Run `npx tsx scripts/test-table-alias.mjs` to verify field aliases without a
server. `scripts/test-where-aggregate.mjs` verifies the legacy filtering and
aggregation path against a dev server at `http://localhost:5173` with a
registered `user.hourly_product_mix` source.

## See also

- [`docs/DESIGN_CONSTITUTION.md`](./docs/DESIGN_CONSTITUTION.md) — design principles
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — deeper architecture notes
- [`docs/AGENTS.md`](./docs/AGENTS.md) — structured project map for AI agents
- [`PLAN.md`](./PLAN.md) — the implementation plan this MVP was built from

## License

MIT
