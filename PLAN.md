# Generative Interface Runtime — Implementation Plan

> **One-line thesis:** A constrained runtime in which an LLM dynamically constructs
> high-quality user interfaces from APIs and data, while software — not the model —
> enforces the design system, accessibility, and component contract.

---

## 1. Current state

- New project. No prior code at `C:\Users\brand\work\generative-interface-runtime`.
- Workspace (`C:\Users\brand\work`) is otherwise the merchant-sites / food-truck
  universe. The wiki tracks that work. This is a separate, portfolio-style
  architectural exploration.
- Tooling available: Node 24.15, npm 11.12. PowerShell on Windows. pnpm absent —
  npm is fine for this scope.

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  USER INTENT  (natural language)                                    │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  PLANNER  (model-agnostic; OpenAI-compatible or MockPlanner)         │
│    • receives: intent, capability catalog, component registry,       │
│      current spec (for modify), design constitution summary          │
│    • emits:   UI Specification (the DSL)                             │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  UISpecification  (Zod-validated)
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  VALIDATION PIPELINE                                                 │
│    1. Zod schema parse  → structural validity                       │
│    2. Deterministic rules  → token / nesting / density / a11y        │
│    3. (later) AI UX critic  → judgment-based feedback                │
│    On violation: return to planner with structured violation list.   │
└──────────────────────────────┬───────────────────────────────────────┘
                               │  valid UISpecification
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  RENDERER  (React)                                                  │
│    • maps DSL node → registered React component                     │
│    • only components in the registry are addressable                 │
│    • tokens come from the design system, not from the DSL            │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
                               ▼
┌──────────────────────────────────────────────────────────────────────┐
│  RENDERED UI  (real, polished, accessible)                           │
└──────────────────────────────────────────────────────────────────────┘
```

The model decides **what**. The application decides **how** and **whether**.

## 3. Tech stack

| Concern              | Choice                                  | Why |
|----------------------|-----------------------------------------|-----|
| Build / dev server   | **Vite**                                | Fast HMR, native ESM, TS-first |
| UI framework         | **React 18 + TypeScript (strict)**       | Mainstream; LLM is familiar with it |
| Schema / validation  | **Zod**                                 | Strongly typed, inference into TS, good for LLM structured output |
| Styling              | **CSS modules + design tokens (CSS vars)** | Tokens-first; the DSL references token *names*, never raw values |
| Charts               | Lightweight in-house (SVG)              | No extra dep; matches the restrained aesthetic |
| LLM transport        | `fetch` against OpenAI-compatible API   | Model-agnostic; env-configurable base URL |
| State                | React state + small context             | No Redux needed at this size |

## 4. UI DSL — initial surface

The model is **only** allowed to emit these component types:

| Type            | Purpose                                  | Allowed children        | Notable props |
|-----------------|------------------------------------------|-------------------------|---------------|
| `dashboard`     | Root container                           | `section[]`             | `title`, `description` |
| `section`       | Grouping band with optional header       | any leaf*               | `title`, `columns` (1–4) |
| `metricCard`    | Single big number + label + delta        | —                       | `label`, `value`, `format` (currency/percent/number), `delta`, `emphasis` |
| `chart`         | Time series / category visualization     | —                       | `kind` (line/bar), `data` (capability ref), `x`, `y` |
| `table`         | Tabular data                             | —                       | `data` (capability ref), `columns[]` |
| `text`          | Body copy / explanatory paragraph        | —                       | `content`, `tone` (neutral/emphasis) |
| `insight`       | Highlighted callout                      | —                       | `content`, `severity` (info/warning/positive) |
| `comparison`    | Side-by-side metric comparison           | —                       | `left`, `right`, `metric` |

\* leaves = the things above, minus `dashboard`/`section`. Nesting is enforced by the validator.

The DSL is **token-naming only**. Example:

```ts
{
  type: "dashboard",
  title: "Monthly performance",
  children: [
    { type: "section", columns: 3, children: [
      { type: "metricCard", label: "Revenue", value: 48210, format: "currency",
        delta: { value: 12.4, direction: "up" }, emphasis: "primary" },
      ...
    ]}
  ]
}
```

No hex codes. No px. No arbitrary class names. Just semantic identifiers.

## 5. Design system

Tokens (initial set, in `src/design/tokens.css`):

- **Color**: `bg.canvas`, `bg.surface`, `bg.elevated`, `bg.subtle`,
  `fg.primary`, `fg.secondary`, `fg.muted`, `border.subtle`, `border.strong`,
  `accent.fg`, `accent.bg`, `status.positive`, `status.warning`, `status.negative`,
  `chart.1` … `chart.6`.
- **Spacing**: 4pt scale: `--space-1` (4) … `--space-8` (64).
- **Radius**: `--radius-sm` (4), `--radius-md` (8), `--radius-lg` (12), `--radius-xl` (20).
- **Type**: Inter (with system fallbacks). Scale: 12, 13, 14, 16, 18, 20, 24, 30, 36, 48.
- **Weight**: 400, 500, 600, 700.
- **Elevation**: `--shadow-1` (subtle), `--shadow-2`, `--shadow-3`.
- **Motion**: `--ease-standard`, `--dur-fast` (120ms), `--dur-med` (200ms), `--dur-slow` (320ms).

Aesthetic direction: **restrained, precise, generous whitespace, one accent color,
no glassmorphism, no gratuitous gradients**. Think Linear / Stripe / Vercel docs
— not "AI dashboard starter."

## 6. Validation

Deterministic rules (v1):

| ID     | Rule                                                                 |
|--------|----------------------------------------------------------------------|
| D-001  | `dashboard.children` must contain ≥ 1 `section`.                     |
| D-002  | `dashboard` may not contain `metricCard` directly — wrap in section. |
| D-003  | No more than 4 `metricCard` children per section.                    |
| D-004  | At most 1 `metricCard` with `emphasis: "primary"` per dashboard.     |
| D-005  | `section.columns` must be in {1, 2, 3, 4}.                           |
| D-006  | Nesting depth must be ≤ 3 (`dashboard > section > leaf`).            |
| D-007  | `metricCard.label` is required and non-empty.                        |
| D-008  | `chart.data` must reference an existing capability.                  |
| D-009  | `table.columns[].key` must exist in the bound data.                 |
| D-010  | No duplicate `metricCard.label` within a section.                   |
| D-011  | Every chart must have at least 2 data points.                        |
| D-012  | `insight.severity` ∈ {info, warning, positive}.                      |
| A-001  | Every interactive leaf must declare a label or aria-label.           |
| A-002  | Color tokens are referenced by name — no raw color strings allowed.  |

Violations are returned as a structured list; the planner revises the spec.

## 7. AI architecture

```ts
interface Planner {
  plan(input: PlannerInput): Promise<PlannerResult>;
}
```

`PlannerInput`:
- `intent: string`
- `currentSpec?: UISpecification`  (for modify)
- `capabilities: CapabilityDescriptor[]`  (filtered to the requested domain)
- `componentSummary: ComponentSummary[]`   (one-line per component)
- `designConstitution: string`  (truncated to relevant rules)

`PlannerResult`:
- `spec: UISpecification`  (Zod-parseable)
- `reasoning?: string`     (optional short note for the UI)

Implementations:
- `MockPlanner` — for the first slice. Returns hand-curated specs keyed by intent
  keyword, with realistic merchant data. Deterministic, testable, demos the full
  pipeline with no API key.
- `OpenAIPlanner` — calls an OpenAI-compatible chat-completions endpoint with
  `response_format: { type: "json_schema", ... }` for guaranteed parseable output.
  Configured via `VITE_OPENAI_BASE_URL`, `VITE_OPENAI_API_KEY`, `VITE_OPENAI_MODEL`.

The system is **model-agnostic** — swap the planner, keep the pipeline.

## 8. First vertical slice — the demo

The vertical slice must prove the full path end-to-end with a small set of
components. The demo flow:

1. User lands on the app. Empty state with example prompts.
2. User types: *"Show me how the business performed this month."*
3. Planner emits a spec with: 3 hero metricCards, 1 revenue chart, 1 top-products table,
   1 insight callout, 1 section of comparisons.
4. Validator runs. Renderer paints a polished dashboard.
5. User clicks "Modify" and types: *"Why was revenue lower last week? Add customer retention."*
6. Planner receives the current spec + delta, emits a revised spec.
7. Renderer re-renders smoothly. Validator re-runs.

Capability catalog (v1, mock data):
- `merchant.getRevenue({ range })`
- `merchant.getOrders({ range })`
- `merchant.getAverageTicket({ range })`
- `merchant.getTopProducts({ range, limit })`
- `merchant.getRevenueSeries({ range, granularity })`
- `merchant.getRetentionCohort({ cohort })`
- `merchant.getComparison({ left, right, metric })`

All resolve against a deterministic in-memory dataset that resembles a
small merchant's monthly activity. Numbers are stable so the UI is repeatable
and screenshots are consistent.

## 9. Milestones

| M | Name                               | What "done" means                                                |
|---|------------------------------------|------------------------------------------------------------------|
| 1 | Scaffold                           | `npm run dev` boots a styled empty app shell                     |
| 2 | Design system                      | Tokens, type, primitives render, light/dark switch works         |
| 3 | DSL + registry + validator         | Unit-tested; sample specs validate cleanly, invalid ones don't  |
| 4 | Renderer                           | Hand-authored spec renders a polished dashboard                  |
| 5 | Mock planner + capability layer    | `MockPlanner` returns spec; mock data resolves all capabilities  |
| 6 | App shell + intent input + iteration | User can submit intent, see spec, see violations, iterate       |
| 7 | OpenAI planner                     | Optional path; env-flagged; structured output enforced           |
| 8 | Visual polish + responsive         | Mobile/tablet look intentional; motion is restrained             |
| 9 | README + design constitution       | Someone else can clone, `npm i`, `npm run dev`, understand it    |

## 10. Major risks

- **LLM output is messy.** Mitigated by Zod (parse → on failure, retry with the
  error appended to the prompt). Mock planner is the fallback for offline demo.
- **Visual quality.** The biggest risk to the demo. Mitigation: design tokens +
  primitives get built before components; the renderer is the only place that
  touches layout, so we can iterate on it independently.
- **Scope creep.** Guardrail: stop at the components listed in §4 for the first
  slice. Adding components after the runtime works.
- **Token drift.** Mitigation: validator rejects any reference to a token that
  doesn't exist in `tokens.css`.

## 11. Non-goals (for this slice)

- Real backend / auth / multi-tenant.
- Saving dashboards to a database. (Spec lives in React state.)
- Code-execution by the LLM. The model emits JSON only.
- Per-user learning or fine-tuning.

## 12. Out of scope but planned

- AI UX critic (second validation pass after deterministic rules).
- Capability / API tool-calling (the LLM proposes a `data` ref; the runtime
  resolves it). Mock layer for now; real tool-calling is a clean extension.
- Save / load named dashboards.
- Theming (light only for v1; dark-ready tokens).
