# AGENTS.md — Project Map for AI Agents

This file is the high-density navigation map for an LLM (or other automated
agent) trying to do work in this repo. Human-friendly docs live in
`README.md` and `docs/ARCHITECTURE.md`. This file is structured for fast
lookup by a model.

---

## What this is (one paragraph)

A React + Vite + Zod app where an LLM produces a JSON **UI specification**
(constrained by a Zod schema) and a deterministic React renderer turns that
spec into a real dashboard. The model picks **what to show and which data to
reference**; the runtime owns design tokens, accessibility, layout, the
component contract, and validation. Bring Your Own Data: CSV/JSON uploads
become runtime capabilities named `user.<name>`, referenced by the planner
just like the built-ins.

## Repo facts

- **Stack**: TypeScript, React 18, Vite 5, Zod 3, CSS Modules
- **Node**: 18+
- **Test runner**: `tsx scripts/smoke.ts` (no Jest/Vitest)
- **Package manager**: npm
- **No `gh` needed for dev**; `gh` is needed only to push to GitHub
- **One persistent file** (gitignored): `data/sources.json` (BYOD storage)

## Where things live (file → purpose)

| Path | What it is | Touch when… |
|---|---|---|
| `src/dsl/schema.ts` | Zod schemas. The only place types are defined. | Adding a component, capability param, validation rule |
| `src/registry/components.ts` | Component descriptors the planner may emit | Adding/changing a component |
| `src/registry/capabilities.ts` | Built-in capability catalog | Adding a mock data source |
| `src/registry/validation.ts` | Deterministic D-*/A-* rules | Adding a structural check |
| `src/data/capabilityResolver.ts` | `name → data` for built-in caps + async API resolvers | Adding a resolver |
| `src/data/sourcesRegistry.tsx` | React store for BYOD + BYOAPI sources | Adding source state logic |
| `src/data/dynamicCapabilities.ts` | `SourceRecord → CapabilityDescriptor[]` (one per endpoint for APIs) | Changing how sources appear to planner |
| `src/data/resolveValue.ts` | Renderer-side data resolution (with `where` filter) | Changing how `data.where` works |
| `src/planner/openaiPlanner.ts` | The LLM integration. **System prompt lives here.** | Changing the LLM, prompt, retry strategy |
| `src/planner/mockPlanner.ts` | Deterministic offline planner | Changing fallback behavior |
| `src/planner/planner.ts` | `Planner` interface + `fetchOpenAICompletion` | Adding a new planner type |
| `src/renderer/NodeRenderer.tsx` | Type → component dispatch | Adding a component case |
| `src/renderer/leaves/*.tsx` | One file per leaf component (all async-aware) | Changing how a component renders |
| `src/renderer/format.ts` | Number formatters (currency, percent, axis ticks) | Adding a new number format |
| `src/design/tokens.css` | The full design-token vocabulary | Adding a token |
| `src/design/global.css` | Reset + base styles | Global style changes |
| `src/app/App.tsx` | Top-level component, planner context, BYOD + BYOAPI merge | Changing app shell or planner wiring |
| `src/app/DataSourceDialog.tsx` | BYOD + BYOAPI UI (drag/drop, preview, API form) | Changing source UI |
| `vite/apiProxy.ts` | `/api/chat` → upstream LLM (server-side auth) | Changing LLM proxy |
| `vite/sourcesApi.ts` | `/api/sources` CRUD + schema inference + live API call endpoint | Changing source API |
| `vite/apiExtractor.ts` | LLM-driven API endpoint extraction (focused system prompt) | Changing how endpoints are derived |
| `vite/docsFetcher.ts` | URL fetch with timeout, size cap, HTML strip | Changing docs link handling |
| `vite/apiCaller.ts` | Live API call execution + in-memory cache + param substitution | Changing live-call behavior |
| `vite.config.ts` | Vite config, plugin order, dev server port | Changing dev setup |
| `scripts/smoke.ts` | E2E pipeline test (MockPlanner) | Adding a smoke case |
| `scripts/test-table-alias.mjs` | Verifies `lookupKey` aliasing | When aliasing changes |
| `scripts/test-where-aggregate.mjs` | Verifies `where` + chart aggregation | When filtering/aggregation changes |
| `scripts/test-json-parse.mjs` | Verifies the LLM JSON extractor (fences, think blocks, trailing prose, array wrappers) | When the LLM output parser changes |
| `scripts/test-api-registration.mjs` | End-to-end test: register API → call endpoint → cache hit → fresh bypass | When the BYOAPI flow changes |
| `samples/hourly_product_mix.csv` | 336-row test fixture | Re-generate via `node scripts/gen-hourly-mix.mjs` |
| `docs/API_REGISTRATION.md` | Design doc for the BYOAPI flow | When the API registration design changes |

## Three mental models

### 1. The DSL is a contract, not a doc

The LLM emits a `DashboardSpec` (see `src/dsl/schema.ts`). Every node has a
discriminated `type` literal: `dashboard | section | metricCard | chart |
table | text | insight | comparison`. Nesting is fixed: `dashboard → section
→ leaf`. Anything else is rejected by Zod or by `validateSpec` (the D-*/A-*
rules). Field names are token references (e.g. `chart.1`) — never raw hex.

The model's `data` is **always** a `CapabilityRef`:
```ts
{ capability: "merchant.getRevenueSeries", params: { range: "30d" }, where?: { day: "Sat" } }
```
The resolver turns it into real data. The model never invents numbers.

### 2. The planner is a constrained generator

`OpenAIPlanner` calls the LLM with a 3-tier response_format fallback
(`json_schema` → `json_object` → no `response_format`), system prompt is
~10KB with worked examples and "HARD RULES". A `try` block walks
`stripCodeFence` → `extractFirstJson` → `JSON.parse` → `DashboardSpec.safeParse`
→ Zod. On failure, one retry with the Zod error appended to the user prompt.
On second failure, throws — the App catches and surfaces in the validation
panel.

### 3. The renderer is a deterministic interpreter

`NodeRenderer` is a switch on `node.type` → registered component. The
chart engine aggregates bar/pie data by `x` (sum y for duplicate x values).
Line/area pass through as-is. `where` filter is applied by `resolveValue`
*after* the resolver returns, so it's purely client-side.

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
  `data/mockData.ts`. Real data lives in `data/sources.json` (BYOD).
- **No multi-user** — single browser, no auth.
- **No dark mode** — tokens are dark-ready; the theme is light-only.
- **No AI UX critic** — only deterministic rules.
- **No code execution by the model** — JSON spec only.
- **No persistence beyond `data/sources.json`** — sources are local to the
  dev server's working directory.

## Extension points (next obvious moves)

- **API mode** in DataSourceDialog (placeholder tab). User pastes curl +
  sample response; LLM extracts `{ name, description, returns, usageHint }`;
  save alongside the sample. The "first call slow, future calls fast" pattern
  the user described fits here.
- **Range/filter params** for user capabilities (server-side filtering with
  a small query DSL).
- **Hover tooltips** on bar/line points (currently relies on browser
  `<title>` for accessibility).
- **Chart engine: min/max y-axis control** so the LLM can pin a baseline.
- **Persisted dashboard history** — the `result.spec` lives in memory; a
  small backend could store named dashboards.

## Quick commands (copy-paste)

```bash
# Run the dev server
npm run dev

# Run smoke tests
npm run smoke

# Run the BYOD end-to-end test (dev server must be up)
node scripts/test-where-aggregate.mjs

# Run the LLM JSON extractor tests (no dev server needed)
node scripts/test-json-parse.mjs

# Run the table field-name alias tests (uses tsx for path-alias resolution)
npx tsx scripts/test-table-alias.mjs

# Run the BYOAPI end-to-end test (dev server must be up)
node scripts/test-api-registration.mjs

# Regenerate the sample CSV
node scripts/gen-hourly-mix.mjs

# Typecheck without emitting
npm run typecheck
```

## AI-agent-specific guidance

- **The planner is the only place to teach the LLM.** Add a rule there
  with explicit examples; the rest of the pipeline enforces it.
- **The renderer's behavior is the spec.** When a feature seems missing,
  check whether it can be added in `ChartView`/`TableView` rather than
  asking the LLM to "be careful."
- **Validation is the source of truth for what's allowed.** If the LLM is
  emitting something weird, run the same spec through `validateSpec` to
  see which rule fired.
- **The LLM is non-deterministic.** If a test fails, run it 2-3 times
  before assuming the code is wrong.
- **Hard reload (`Cmd+Shift+R`) clears stale HMR state.** When in doubt,
  reload.
