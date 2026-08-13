/**
 * OpenAIPlanner — calls an OpenAI-compatible chat completions endpoint
 * with `response_format: json_schema` so output is guaranteed parseable
 * against our Zod schema.
 *
 * Env:
 *   VITE_OPENAI_BASE_URL   e.g. https://api.openai.com/v1
 *   VITE_OPENAI_API_KEY
 *   VITE_OPENAI_MODEL      e.g. gpt-4o-2024-08-06
 *
 * If any of these is missing, the planner will throw. The app should
 * fall back to MockPlanner in that case.
 */
import { zodToJsonSchema } from "zod-to-json-schema";
import { DashboardSpec, type DashboardSpec as DashboardSpecT } from "@/dsl/schema";
import { fetchOpenAICompletion, DESIGN_CONSTITUTION_SHORT, type Planner, type PlannerContext, type PlannerResult } from "./planner";

interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

function readConfig(): OpenAIConfig | null {
  // Vite injects these via `import.meta.env`.
  const env = (import.meta as unknown as { env: Record<string, string | undefined> }).env;
  const baseUrl = env.VITE_OPENAI_BASE_URL || "/api";
  const model = env.VITE_OPENAI_MODEL;
  if (!model) return null;
  // The API key is intentionally optional here. When it's blank, the planner
  // routes the call through the Vite dev-server proxy (or the user's
  // production /api/chat endpoint) which adds Authorization server-side.
  const apiKey = env.VITE_OPENAI_API_KEY ?? "";
  return { baseUrl, apiKey, model };
}

function buildSystemPrompt(ctx: PlannerContext): string {
  const capabilities = ctx.capabilities
    .map((c) => {
      const params = c.params
        .map((p) => `${p.name}${p.required ? "" : "?"}${p.enum ? `:${p.enum.join("|")}` : `:${p.type}`}${p.default !== undefined ? `=${String(p.default)}` : ""}`)
        .join(", ");
      // The "returns" line is the part the LLM needs most — it tells it the
      // exact field names it can reference in `table.columns[].key`,
      // `chart.x`, `chart.y`, etc. Without this it guesses and the cells
      // render as "—".
      return `- ${c.name}(${params})  // ${c.description}\n    returns: ${c.returns}\n    use when: ${c.useWhen}`;
    })
    .join("\n\n");

  const components = ctx.components
    .map((c) => `- ${c.type} (${c.category}): ${c.purpose}\n  use when: ${c.useWhen.join("; ")}`)
    .join("\n");

  return `You are a planner for a generative interface runtime. Your only output is a single JSON object that conforms to the schema below.

You choose WHAT to show. The application decides HOW to render it.

Design constitution:
${ctx.constitution}

Available components (use ONLY these):
${components}

Available capabilities (use ONLY these to bind data):
${capabilities}

EXACT SHAPE — a single object with this structure:
{
  "type": "dashboard",
  "title": "Monthly performance",
  "description": "A short human sentence.",
  "children": [
    {
      "type": "section",
      "title": "Headline",
      "columns": 3,
      "children": [
        {
          "type": "metricCard",
          "label": "Revenue (30d)",
          "valueRef": { "capability": "merchant.getRevenue", "params": { "range": "30d" } },
          "format": "currency",
          "emphasis": "primary",
          "delta": { "value": 12.4, "direction": "up", "compare": "vs last month" }
        },
        {
          "type": "metricCard",
          "label": "Orders (30d)",
          "valueRef": { "capability": "merchant.getOrders", "params": { "range": "30d" } },
          "format": "number"
        },
        {
          "type": "metricCard",
          "label": "Average ticket",
          "valueRef": { "capability": "merchant.getAverageTicket", "params": { "range": "30d" } },
          "format": "currency"
        }
      ]
    },
    {
      "type": "section",
      "title": "Trend",
      "columns": 1,
      "children": [
        {
          "type": "chart",
          "kind": "area",
          "title": "Daily revenue",
          "data": { "capability": "merchant.getRevenueSeries", "params": { "range": "30d" } },
          "x": "date",
          "y": "revenue",
          "yFormat": "currency",
          "height": 240
        }
      ]
    },
    {
      "type": "section",
      "title": "Top sellers",
      "columns": 1,
      "children": [
        {
          "type": "table",
          "title": "Top products by revenue",
          "data": { "capability": "merchant.getTopProducts", "params": { "range": "30d", "limit": 5, "by": "revenue" } },
          "columns": [
            { "key": "name",     "label": "Product" },
            { "key": "revenue",  "label": "Revenue", "format": "currency", "align": "right" },
            { "key": "orders",   "label": "Orders",  "format": "number",   "align": "right" }
          ],
          "pageSize": 5
        }
      ]
    }
  ]
}

DATA BINDING — THIS IS THE MOST IMPORTANT RULE:
- For ANY number that comes from data, use "valueRef" (NOT "value").
- "value" is only for literal hard-coded numbers (e.g. a static "12 days" callout).
- "valueRef" = { "capability": "<name>", "params": { ... } }. The runtime resolves it.
- For metric cards: valueRef → { capability, params } picks the first numeric field from the result.
- For charts/tables: data → { capability, params } supplies the rows.
- NEVER use "value": 0 or "value": 100 as a placeholder — use valueRef.

FIELD NAMES — THIS IS THE SECOND MOST IMPORTANT RULE:
- For tables: columns[].key MUST be the EXACT field name from the capability's "returns" shape.
  Do NOT invent aliases like "product" or "orderShare" — use "name" and "share" if those are
  what the capability returns. A wrong key renders as "—" in the cell.
- For charts: x and y MUST be exact field names from the "returns" shape too.
- Always look at the "returns:" line under each capability before writing column keys or chart axes.

AGGREGATION & FILTERS — THIS IS THE THIRD MOST IMPORTANT RULE:
- User-uploaded data often has multiple rows per logical group (e.g. hourly rows
  for a daily total, or 4 products per day per hour). You do NOT need to ask the
  server to pre-aggregate. The chart engine handles it:
  - For bar and pie charts, the engine SUMS y for duplicate x values. So
    x: "product", y: "revenue" over hourly rows gives one bar per product.
  - For line/area charts, each row is one observation — do NOT rely on
    aggregation, the chart will draw every row.
- For "per X, per Y" breakdowns (e.g. "revenue by product for each day"),
  use a separate section per X. In each section, set data.where to filter
  to that X, and x: <Y field>, y: <metric field>. Example shape for
  a per-day-per-product pie:

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

- data.where is { field: exactValue } per field; rows match when every
  field equals the value. Use string equality for day, product,
  category; numeric equality for hour, orders, etc.
- data.params are passed to the capability itself (e.g. range, limit).
  data.where is a client-side filter applied AFTER the resolver runs.
  Use where to scope a single chart/table; use params only when the
  capability description tells you to.

Component quick reference (all fields shown above; every type has a 'type' literal):
- metricCard: { type:"metricCard", label, valueRef:{capability,params} OR value:literal, format, emphasis?, delta?, caption? }
- chart:       { type:"chart", kind:"line"|"bar"|"area"|"pie", title, data:{capability,params,where?}, x, y, yFormat? }
- table:       { type:"table", data:{capability,params,where?}, columns:[{key,label,format?,align?}], title? }
- text:        { type:"text", content, as? }
- insight:     { type:"insight", severity, content, title? }
- comparison:  { type:"comparison", title, metric, left:{label,value}, right:{label,value}, format }
- section:     { type:"section", title?, columns:1|2|3|4, children:[leaves] }
- dashboard:   { type:"dashboard", title, description?, children:[sections] }

Hard rules:
- The top-level object MUST be a dashboard.
- Every section MUST have a "children" array of leaves (never empty).
- Reference data ONLY via { capability, params } (or valueRef). Do not invent numbers.
- Use design tokens by name only (do not put raw color/space/type values).
- For modify intents, preserve the user's existing structure where possible.
- Keep the dashboard focused: at most ~8 sections; at most 4 leaves per section.
- Exactly ONE metricCard in the whole dashboard may have emphasis: "primary".
- Every metricCard needs a non-empty "label".
`.trim();
}

function buildUserPrompt(intent: string, currentSpec?: DashboardSpecT): string {
  if (currentSpec) {
    return `Current dashboard:
${JSON.stringify(currentSpec, null, 2)}

User's modification request: ${intent}

Return a revised dashboard spec that addresses the request. Preserve existing structure where it makes sense.`.trim();
  }
  return `User intent: ${intent}

Return a single dashboard spec that satisfies the user's intent.`.trim();
}

/**
 * Some chat-completions servers wrap JSON in ```json ... ``` fences even
 * with json_object mode, and some reasoning models (notably MiniMax M3)
 * emit `<think>...</think>` blocks before the JSON payload. Strip both
 * so the parser sees clean JSON.
 *
 * The LLM also sometimes appends commentary or a trailing sentence after
 * the JSON object (e.g. `{"type":"dashboard",...}Looks good!`). To avoid
 * `JSON.parse` choking on that, we extract the first complete JSON object
 * via a small brace-matching walker and return just that substring.
 */
function stripCodeFence(text: string): string {
  let t = text.trim();
  const fence = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) t = fence[1]!;
  // Remove <think>...</think> blocks (MiniMax reasoning tokens).
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return extractFirstJson(t);
}

/**
 * Returns the first balanced JSON object in `text`, or `text` unchanged
 * if no `{` is found. Walks the string tracking nesting depth and
 * skipping over content inside string literals (which can contain
 * unbalanced braces). If the walker never finds a matching close brace,
 * it returns the substring from the first `{` to end-of-string as a
 * last-ditch attempt — the JSON.parse that follows will produce a
 * clearer error than "no JSON at all".
 */
function extractFirstJson(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return text;
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

export class OpenAIPlanner implements Planner {
  readonly name = "OpenAIPlanner";
  private config: OpenAIConfig | null;

  constructor(config?: OpenAIConfig) {
    this.config = config ?? readConfig();
  }

  isConfigured(): boolean {
    return this.config !== null;
  }

  async plan(intent: string, ctx: PlannerContext): Promise<PlannerResult> {
    if (!this.config) {
      throw new Error("OpenAIPlanner not configured. Set VITE_OPENAI_MODEL (and optionally VITE_OPENAI_BASE_URL).");
    }
    const schema = zodToJsonSchema(DashboardSpec, "ui_specification");
    // Some servers dislike `$schema` in the inner schema.
    delete (schema as { $schema?: string }).$schema;

    const systemPrompt = buildSystemPrompt({ ...ctx, constitution: DESIGN_CONSTITUTION_SHORT });

    const callOnce = (userPrompt: string) =>
      fetchOpenAICompletion({
        baseUrl: this.config!.baseUrl,
        apiKey: this.config!.apiKey,
        model: this.config!.model,
        systemPrompt,
        userPrompt,
        schema,
      });

    // Attempt 1.
    let content = await callOnce(buildUserPrompt(intent, ctx.currentSpec));

    let parsed = JSON.parse(stripCodeFence(content));
    let result = DashboardSpec.safeParse(parsed);
    if (!result.success) {
      // Attempt 2 — append the Zod error so the model can self-correct.
      const retryPrompt =
        buildUserPrompt(intent, ctx.currentSpec) +
        `\n\nYour previous response failed schema validation:\n${result.error.message}\n\nReturn a corrected JSON object that satisfies the schema.`;
      content = await callOnce(retryPrompt);
      parsed = JSON.parse(stripCodeFence(content));
      result = DashboardSpec.safeParse(parsed);
      if (!result.success) {
        throw new Error("LLM output failed schema validation after retry: " + result.error.message);
      }
    }
    return { spec: result.data };
  }
}
