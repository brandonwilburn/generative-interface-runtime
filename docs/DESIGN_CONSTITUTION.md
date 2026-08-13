# Design Constitution

> Principles the AI must follow when constructing interfaces inside this
> runtime. These are enforced by the deterministic validator where possible,
> and by an (eventual) AI critic where judgment is needed.

A generated interface should feel **intentionally designed**, not randomly
assembled. The same set of rules applies to every dashboard this system
emits, regardless of intent.

---

## 1. Information hierarchy

Every dashboard must establish a clear information hierarchy. The user
should understand what matters most within a single glance.

- Exactly one `metricCard` per dashboard may carry `emphasis: "primary"`.
- Other metrics are secondary or subtle. Never two hero metrics.
- The primary metric is typically revenue or another business-defining KPI.

## 2. Visible without interaction

Primary information must be visible without unnecessary interaction. Don't
hide the answer behind a click, a hover, or a tab.

- Use direct metricCards rather than putting numbers inside a chart.
- Use the chart for the trend; use a metricCard for the headline.

## 3. Don't drown the user

Secondary information should not visually compete with primary information.

- Use weight, size, and color, not more pixels, to express hierarchy.
- Limit each section to 1–4 leaves. Don't try to fit everything in one row.

## 4. Use visualizations when they answer a question

Use a chart when it communicates a relationship, a trend, or a comparison
better than text or numbers can.

- Time series → line or area
- Comparing categories → bar
- Two specific values → comparison, not chart
- One number → metricCard, not chart

## 5. No decorative charts

A chart that doesn't answer a real question is a chart that doesn't belong.

- Every chart must have a real axis story (time, category, distribution).
- Every chart should support a comparison or a trend, not just show a value.

## 6. Prefer meaningful comparisons

When a user asks "how are we doing", they usually want to compare
something to something.

- Always include a delta on the primary metric when prior-period data exists.
- Use the `comparison` component when two specific values need to be juxtaposed.
- A trend alone (line going up) is weaker than a trend + comparison (line going
  up vs. last week).

## 7. Avoid dashboard density

If a dashboard has too much, it has nothing.

- At most 8 sections per dashboard.
- At most 4 leaves per section.
- If a section is dense, split it.
- If a dashboard is dense, use progressive disclosure (text + drilldowns).

## 8. Use progressive disclosure

Don't try to answer every question at once. The first viewport should
answer the most important question; the rest should be reachable.

- Headline metrics at the top.
- A single dominant chart next.
- A table or insight for context after that.
- The "everything else" should be off the fold.

## 9. Use semantic labels

The model may not know the user's domain intimately. Use labels that
match how the user thinks, not how the API was named.

- `merchant.getRevenueSeries` → "Daily revenue"
- `tenants.cash_only` → "Cash only"
- Don't expose API names to the user unless they ask.

## 10. Preserve accessibility

Accessibility is a system property, not a feature.

- Every interactive element must have a label.
- Color contrast must be readable. Use semantic tokens, not raw values.
- Charts must have a `title` and a meaningful alt label.
- Tables must have clear column headers.

## 11. Maintain consistency

Every dashboard the runtime emits should feel like it came from the same
product. The design system enforces this; the AI must respect it.

- No raw colors. No raw spacing values. No raw font sizes.
- No component types outside the registry.
- No nesting beyond `dashboard → section → leaf`.

## 12. Use the design system, don't invent visual primitives

The model has design tokens. Use them.

- `chart.1`, not `#3978D4`.
- `space-4`, not `16px`.
- `text-lg`, not `20px`.
- `shadow-1`, not `0 1px 2px rgba(...)`.

The token vocabulary is finite on purpose. If a value you want isn't in
the design system, the value is wrong, not the design system.

## 13. Optimize for the user's task

A dashboard is not a place to show off data. It is a place to answer a
question or support a decision.

- Read the user's intent carefully.
- If they ask "why was revenue lower", answer with a diagnostic, not a
  summary.
- If they ask "show me top products", show products, not a summary that
  happens to mention them.

## 14. Generated ≠ random

Generated interfaces should feel **intentionally designed**, not randomly
assembled. The same intent should produce the same kind of dashboard every
time (modulo reasonable variation).

- Pick a layout and commit to it.
- Don't over-rotate components between intents.
- The structure tells the user what matters; don't confuse them with novelty.

## 15. Be specific in copy

The user's intent is specific; the response should be too.

- Avoid generic copy ("Here's a summary of your data.").
- Say what the data is. Say what changed. Say why.
- Insights must say something — "Revenue dipped 16% on July 30" is better
  than "Revenue was lower than usual this month."

---

## How the constitution is enforced

| Principle | Mechanism |
|---|---|
| 1. Hierarchy | Validator: D-004 (one primary metric) |
| 3. Density | Validator: D-003, D-013 |
| 4. Right chart | Designer: planner context with `useWhen` / `avoidWhen` |
| 6. Comparisons | Designer: planner context, capability availability |
| 9. Semantic labels | Designer: planner prompt + capability descriptions |
| 10. Accessibility | Validator: A-001, A-002 |
| 11. Consistency | Validator: D-001, D-005, D-006 (structural) |
| 12. Tokens | Validator: enforced at the type level (only enum tokens allowed) |
| 14. Consistency | Deterministic: MockPlanner returns the same kind of spec for the same intent class |

Everything else is the (future) AI critic's job — judgment, not rules.
