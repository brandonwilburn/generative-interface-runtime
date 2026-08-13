# Architecture notes

> A deeper look at the seams in the runtime, the tradeoffs they make, and
> how to grow the system without breaking the central thesis.

## The central thesis, restated

The model decides **what** to show. The application decides **how** to
show it and **whether** to allow it. The model never produces code; it
produces a structured spec. The spec is the only path to a component.

That is the one invariant the whole system protects. Every architectural
choice below is downstream of it.

## The four layers

```
User intent
   │
   ▼
Planner      ← writes specs
   │
   ▼
Validation   ← validates specs
   │
   ▼
Renderer     ← renders specs
   │
   ▼
UI
```

The interfaces between layers are the only places where the data crosses
a trust boundary.

### Layer 1: Planner

- The only writer of `DashboardSpec`.
- May be a MockPlanner (deterministic, offline) or an OpenAIPlanner
  (model-agnostic over an OpenAI-compatible chat API).
- Receives as input: the intent, the current spec (for modify), a
  capability catalog, a component summary, and a constitution excerpt.
- The planner does not validate. The validator does.

### Layer 2: Validation

Two passes, both deterministic:

1. **Zod parse** — the structural shape of the spec.
2. **Custom rules** — composition, density, accessibility, capability
   existence, label uniqueness, primary-metric cardinality, etc.

Each violation is returned as a structured `Violation` with a rule id, a
severity, a message, and a JSON-path pointer. The runtime can route
violations back to the planner for revision.

The AI UX critic (planned, not yet implemented) sits on top of these two
passes. It only catches things that need judgment; the deterministic
rules never give it up.

### Layer 3: Renderer

- The only writer of UI.
- Maps `DashboardSpec` → React tree.
- Resolves capability refs lazily per node — the renderer never holds a
  snapshot of the data, only the spec.
- Uses design tokens, not raw values. The CSS module owns the actual
  visual language.

### Layer 4: UI

- What the user sees.
- Renders hover, focus, motion, responsive behavior.
- Knows nothing about the model.

## Why a separate DSL

If the model emitted React, three bad things would happen:

1. The model would have to know React — bad for portability, bad for
   safety, bad for review.
2. The model could write anything: it could violate accessibility, emit
   inline styles, invent colors, smuggle in `eval`.
3. The renderer would have nothing to validate against; everything would
   be a string.

A structured spec is a contract. The model writes to the contract; the
runtime enforces it. New components = add a Zod schema + a renderer
branch. The validator learns about them automatically.

## Why semantic tokens, not raw values

If the model could write `#3978D4`, two bad things would happen:

1. Visual drift. Every model run picks slightly different blues. The
   system never converges.
2. The model becomes a design system in itself, which is not the
   product's job.

Semantic tokens (`accent.fg`, `chart.1`) flip this: the design system
is the source of truth, and the model picks from it. Changing a token
changes every generated dashboard. The design system is the system.

## Why capability refs, not inline data

If the model could write `value: 48210`, three bad things would happen:

1. The model hallucinates numbers. Hallucinated dashboards are worse
   than no dashboards.
2. There's no way to refresh the data without re-prompting.
3. The model can leak private data, or be tricked into exposing it.

Capability refs flip this: the model proposes what to ask for, the
runtime executes the call. The model never sees raw rows.

## Why model-agnostic

Three reasons:

1. **Lock-in risk** — depending on one provider for a load-bearing
   system is a strategic risk. A change in pricing, an outage, a model
   deprecation — any of these become existential.
2. **Capability matching** — different models have different strengths.
   Some are good at structured output, some at long-form reasoning,
   some at tool calling. The system should be free to route.
3. **Local models** — the architecture works the same if the planner is
   a local LLM, a custom fine-tune, or a deterministic mock. The
   interface is the only thing that matters.

## Security model

The model is **untrusted**. It can propose a spec. It cannot:

- Bypass validation
- Execute code
- Read or write data outside the capability catalog
- Choose tokens that don't exist
- Render components that aren't in the registry

Every one of those is enforced at the type system or validator level,
not at the prompt level. The model is not the trust boundary; the
runtime is.

## The modify flow

When the user submits a modification, the planner receives the current
spec as part of its context. It returns a new spec. The runtime
validates and renders the new spec.

This is intentionally simple. We are NOT:

- Streaming partial updates
- Diffing the spec
- Preserving component identity across runs

For v1, the modify flow re-renders the whole dashboard. The validator
catches anything the new spec breaks. The new spec is the new state.

If we later want incremental updates, the spec already has `id` fields
on every node. That's the seam.

## What's deliberately not here

| Not here | Why |
|---|---|
| Per-user learning | Out of scope; spec is the state |
| Streaming tokens | LLM output must be a complete, parseable JSON spec |
| Code execution | The model emits data, not code; the renderer is the only path to UI |
| Multi-tenant auth | Demo only; the capability resolver is the seam |
| Database | Demo data is in-memory; the resolver is the seam |
| Dark mode | Tokens are dark-ready; the theme is light for v1 |
| Component sub-tree persistence | Not needed; specs are small and re-derive from intent |

## How to grow the system

The system is shaped so each layer can grow independently.

- **New component** → add a Zod schema + a renderer branch + a registry
  entry. The validator learns about it; the planner sees it.
- **New capability** → add a resolver + a registry entry. The renderer
  learns about it; the planner may reference it.
- **New planner** → implement the `Planner` interface. The rest of the
  system does not change.
- **New validation rule** → add a function to `validation.ts`. The
  validator learns about it.
- **New design tokens** → add to `tokens.css`. The whole system can
  reference them.

Each addition is local. The central invariant — the model writes specs,
the app enforces them — never has to be revisited.

## The honest part

This is an exploration, not a finished product. The system is opinionated
on purpose. Some things that are not here:

- Streaming partial renders
- Component sub-tree diffing
- A real UX critic
- Per-tenant data isolation
- A real LLM in the loop for v1 demos

The architecture is shaped so none of these are blockers. The runtime
can grow into them without changing the central thesis.
