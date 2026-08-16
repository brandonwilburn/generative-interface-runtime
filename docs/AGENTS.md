# AGENTS.md — Project Map for AI Agents

This file is the high-density navigation map for an LLM (or other automated
agent) trying to do work in this repo. Human-friendly docs live in
`README.md` and `docs/ARCHITECTURE.md`. This file is structured for fast
lookup by a model.

---

## What this is (one paragraph)

A React + Vite + Zod app where an LLM produces a JSON **UI specification**
(constrained by a Zod schema) and a deterministic React renderer turns that
spec into a real dashboard. Charts are compiled from an agent-friendly JSON
contract into Recharts. The model controls chart kind, axes, series, options,
height, and tile spans without emitting JSX or executable callbacks. Uploaded
data is stored in SQLite; named JSON dataset transforms compile to safe SQL.

## Repo facts

- **Stack**: TypeScript, React 18, Vite 6, Zod 3, Recharts 3, SQLite, CSS Modules
- **Node**: 20+
- **Test runner**: `tsx scripts/smoke.ts` (no Jest/Vitest)
- **Package manager**: npm
- **GitHub CLI is optional**; it is useful for opening a PR from the terminal
- **One persistent file** (gitignored): `data/runtime.sqlite` (BYOD storage)

## Where things live (file → purpose)

| Path | What it is | Touch when… |
|---|---|---|
| `src/dsl/schema.ts` | Zod schemas. The only place types are defined. | Adding a component, capability param, validation rule |
| `src/registry/components.ts` | Component descriptors the planner may emit | Adding/changing a component |
| `src/registry/capabilities.ts` | Built-in capability catalog | Adding a mock data source |
| `src/registry/validation.ts` | Deterministic D-*/A-* rules | Adding a structural check |
| `src/data/capabilityResolver.ts` | `name → data` for built-in caps | Adding a resolver |
| `src/data/sourcesRegistry.tsx` | React store for BYOD sources | Adding BYOD state logic |
| `src/data/dynamicCapabilities.ts` | `SourceRecord → CapabilityDescriptor` | Changing how sources appear to planner |
| `src/data/querySchema.ts` | Named-dataset transformation DSL | Adding a safe query operation |
| `src/data/DatasetContext.tsx` | Resolve named datasets through `/api/query` | Changing client query/cache behavior |
| `src/planner/openaiPlanner.ts` | The LLM integration. **System prompt lives here.** | Changing the LLM, prompt, retry strategy |
| `src/planner/mockPlanner.ts` | Deterministic offline planner | Changing fallback behavior |
| `src/planner/planner.ts` | `Planner` interface + `fetchOpenAICompletion` | Adding a new planner type |
| `src/renderer/NodeRenderer.tsx` | Type → component dispatch | Adding a component case |
| `src/renderer/leaves/*.tsx` | One file per leaf component | Changing how a component renders |
| `src/renderer/resolveValue.ts` | Renderer-side data resolution (with `where` filter) | Changing how `data.where` works |
| `src/renderer/format.ts` | Number formatters (currency, percent, axis ticks) | Adding a new number format |
| `src/design/tokens.css` | The full design-token vocabulary | Adding a token |
| `src/design/global.css` | Reset + base styles | Global style changes |
| `src/app/App.tsx` | Top-level component, planner context, BYOD merge | Changing app shell or planner wiring |
| `src/app/DataSourceDialog.tsx` | BYOD upload UI (drag/drop, preview) | Changing BYOD UI |
| `vite/apiProxy.ts` | `/api/chat` → upstream LLM (server-side auth) | Changing LLM proxy |
| `vite/sourceParsing.ts` | CSV/JSON parsing, type inference, coercion | Changing import behavior |
| `vite/sqliteStore.ts` | SQLite import, profiling, JSON-to-SQL compiler | Changing storage/query execution |
| `vite/sourcesApi.ts` | `/api/sources` CRUD + `/api/query` | Changing BYOD API |
| `vite.config.ts` | Vite config, plugin order, dev server port | Changing dev setup |
| `scripts/smoke.ts` | E2E pipeline test (MockPlanner) | Adding a smoke case |
| `scripts/test-data-compiler.ts` | SQLite/compiler test | Changing query DSL or storage |
| `scripts/test-table-alias.mjs` | Verifies `lookupKey` aliasing | When aliasing changes |
| `scripts/test-where-aggregate.mjs` | Verifies `where` + chart aggregation | When filtering/aggregation changes |
| `scripts/test-json-parse.mjs` | Verifies the LLM JSON extractor (fences, think blocks, trailing prose, array wrappers) | When the LLM output parser changes |
| `samples/hourly_product_mix.csv` | 336-row test fixture | Re-generate via `node scripts/gen-hourly-mix.mjs` |

## Three mental models

### 1. The DSL is a contract, not a doc

The LLM emits a `DashboardSpec` (see `src/dsl/schema.ts`). Every node has a
discriminated `type` literal: `dashboard | section | metricCard | chart |
table | text | codeBlock | separator | insight | comparison`. Nesting is fixed: `dashboard → section
→ leaf`. Anything else is rejected by Zod or by `validateSpec` (the D-*/A-*
rules). Field names are token references (e.g. `chart.1`) — never raw hex.

`dashboard.hero` is an optional cover presentation for the dashboard title and
description. It supports bounded variants, height/alignment, supporting copy, and
none/tone/gradient/image backgrounds. It is distinct from body tiles; metrics and
visualizations remain section leaves. When hero is absent the renderer uses a compact
title header. `generatedFor` is planner metadata and is not rendered as dashboard content.

Every leaf uses the shared `layout` tile envelope. A section is a bounded grid
(normally 12 tracks); `columnSpan` and optional `columnStart` size/place tiles,
while `surface`, `padding`, and `verticalAlign` let narrative content sit beside
charts without arbitrary CSS. Array order must remain the semantic reading order,
and validation warns when more than four tiles land in one row.

For built-in live data, the model's `data` may be a `CapabilityRef`:
```ts
{ capability: "merchant.getRevenueSeries", params: { range: "30d" }, where?: { day: "Sat" } }
```
Uploaded `user.*` sources should be addressed through top-level named datasets:
```ts
datasets: {
  monthlyTraffic: {
    source: "user.website_traffic",
    transform: {
      dimensions: [{ field: "timestamp", as: "month", timeBucket: "month" }],
      metrics: [{ operation: "count", as: "pageViews" }],
      sort: [{ field: "month", direction: "asc" }],
      limit: 24
    }
  }
}
```
Leaves bind with `data: { dataset: "monthlyTraffic" }`. The server validates
known source fields and compiles the definition into a parameterized SQLite
`SELECT`; raw source tables remain immutable. Charts may instead contain inline JSON row
objects when the user supplied the values or the artifact is intentionally
self-contained. Inline data is still declarative and cannot execute code.

The preferred chart contract is:

```ts
{
  type: "chart",
  kind: "line" | "area" | "bar" | "composed" | "scatter" | "pie" |
        "donut" | "radar" | "radialBar" | "funnel" | "treemap",
  title: string,
  description?: string,
  data: { dataset: string } | CapabilityRef | Record<string, string | number | boolean | null>[],
  xAxis: { key: string, label?: string, type?: "category" | "number", format?: NumberFormat | "date" | "shortDate", hide?: boolean },
  yAxes?: Array<{ id?: string, label?: string, side?: "left" | "right", format?: NumberFormat, domain?: [number | "auto" | "dataMin", number | "auto" | "dataMax"], hide?: boolean }>, // 1–2 axes
  series: [{ key: string, label?: string, type?: "line" | "area" | "bar" | "scatter" | "radar" | "radialBar" | "funnel" | "treemap", color?: ColorToken, yAxisId?: string, stackId?: string, curve?: string, fillOpacity?: number, showDots?: boolean, showLabels?: boolean, format?: NumberFormat }],
  options?: { showGrid?: boolean, showLegend?: boolean, showTooltip?: boolean, legendPosition?: "top" | "right" | "bottom" | "left" },
  height?: number,
  layout?: {
    columnSpan?: number,
    columnStart?: number,
    rowSpan?: number,
    surface?: "none" | "card" | "subtle" | "accent",
    padding?: "none" | "compact" | "comfortable",
    verticalAlign?: "start" | "center" | "end" | "stretch"
  }
}
```

Legacy `x`/`y` chart specs map mechanically to `xAxis.key` and `series[].key`.
Prefer the expressive contract for new specs.

### 2. The planner is a constrained generator

`OpenAIPlanner` calls the LLM with a 3-tier response_format fallback
(`json_schema` → `json_object` → no `response_format`) and a system prompt with
worked examples and hard rules. A `try` block walks
`stripCodeFence` → `extractFirstJson` → `JSON.parse` → `DashboardSpec.safeParse`
→ Zod. On failure, one retry with the Zod error appended to the user prompt.
On second failure, throws — the App catches and surfaces in the validation
panel.

### 3. The renderer is a deterministic interpreter

`NodeRenderer` is a switch on `node.type` → renderer component. `ChartView`
interprets the JSON chart contract and creates the corresponding Recharts tree.
`xAxis.key` and `series[].key` bind directly to query-output fields. Named
datasets resolve asynchronously through `DatasetContext`. A legacy `where` filter is
applied by `resolveValue` *after* a capability resolver returns, so it is purely
client-side. Section child-array order is visual order; shared
`layout.columnSpan`/`rowSpan` control each leaf's grid footprint.

## Common tasks

### "Add a new component"
1. Schema in `src/dsl/schema.ts` (add to `LeafSchema` union)
2. Descriptor in `src/registry/components.ts`
3. Renderer in `src/renderer/leaves/MyView.tsx` (tokens only)
4. Case in `src/renderer/NodeRenderer.tsx`
5. Quick-ref line in `src/planner/openaiPlanner.ts:buildSystemPrompt`
6. Test in `scripts/smoke.ts`

### "Add a new built-in capability"
1. `CapabilityDescriptor` in `src/registry/capabilities.ts` (incl. `returns` shape)
2. Resolver in `src/data/capabilityResolver.ts` that returns the shape you described
3. Add to `smoke.ts`

### "Add a BYOD field name alias"
The aliasing layer is in `src/renderer/resolveValue.ts:KEY_ALIASES`. Add an
entry like `{ orderShare: ["share"] }` — `lookupKey` will fall back to the
alias only if the row actually has that field. Add a test to
`scripts/test-table-alias.mjs`.

### "Change the LLM system prompt"
Edit `src/planner/openaiPlanner.ts:buildSystemPrompt`. The prompt has
sections marked `MOST IMPORTANT RULE`, `SECOND MOST IMPORTANT RULE`, `THIRD
MOST IMPORTANT RULE` — keep the priority order. Hard rules are at the end.
After editing, the user must reload the page (planner is memoized).

### "Add a validation rule"
Append a function in `src/registry/validation.ts` and call it from
`checkLeaf` / `checkSection` / `checkDashboardChildren`. Use the existing
`Violation` shape with a stable rule id (e.g. `D-014`).

## Known limitations (intentional for v1)

- **Mock data is anchor-only** — the merchant capabilities return slices of
  `data/mockData.ts`. Uploaded data lives in `data/runtime.sqlite` (BYOD).
- **No multi-user** — single browser, no auth.
- **No dark mode** — tokens are dark-ready; the theme is light-only.
- **No AI UX critic** — only deterministic rules.
- **No code execution by the model** — JSON spec only.
- **No joins, arbitrary SQL, calculated expressions, or materialized cache** —
  the current query DSL intentionally covers safe single-source transformations.

## Potential extension points

- **API mode** in DataSourceDialog (placeholder tab). User pastes curl +
  sample response; LLM extracts `{ name, description, returns, usageHint }`;
  save alongside the sample. The "first call slow, future calls fast" pattern
  the user described fits here.
- **Joins, calculated expressions, pivots, and optional materialized caches**
  after the single-source query contract is stable.
- **Chart interaction policies** beyond the currently declarative tooltip and
  legend switches (zooming, brushing, cross-filtering).
- **Persisted dashboard history** — the `result.spec` lives in memory; a
  small backend could store named dashboards.

## Quick commands (copy-paste)

```bash
# Run the dev server
npm run dev

# Run smoke tests
npm run smoke

# Run SQLite import/query compiler tests
npm run test:data

# Run the BYOD end-to-end test (dev server must be up)
node scripts/test-where-aggregate.mjs

# Run the LLM JSON extractor tests (no dev server needed)
node scripts/test-json-parse.mjs

# Run the table field-name alias tests (no dev server needed)
npx tsx scripts/test-table-alias.mjs

# Regenerate the sample CSV
node scripts/gen-hourly-mix.mjs

# Typecheck without emitting
npm run typecheck
```

## AI-agent-specific guidance

- **The planner is the only place to teach the LLM.** Add a rule there
  with explicit examples; the rest of the pipeline enforces it.
- **The schema and renderer behavior define the contract.** When a feature seems missing,
  check whether it can be added in `ChartView`/`TableView` rather than
  asking the LLM to "be careful."
- **Schema plus deterministic validation define what's allowed.** If the LLM is
  emitting something invalid, run the payload through `DashboardSpec.safeParse`
  and then `validateSpec`.
- **Do not treat a successful rerun as a fix for live-planner failures.** Capture
  the rejected payload and reproduce the behavior with a deterministic test.
- **Hard reload (`Cmd+Shift+R`) once after schema changes** if Vite HMR retained
  stale client state.
