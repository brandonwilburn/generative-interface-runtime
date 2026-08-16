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
      // `chart.xAxis.key`, `chart.series[].key`, etc. Without this it guesses and the cells
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

Available capabilities and uploaded logical sources (use ONLY these names):
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
          "xAxis": { "key": "date", "type": "category", "label": "Date" },
          "yAxes": [{ "id": "primary", "format": "currency", "side": "left" }],
          "series": [
            { "key": "revenue", "label": "Revenue", "type": "area", "color": "chart.1", "yAxisId": "primary", "curve": "monotone", "fillOpacity": 0.22 }
          ],
          "options": { "showGrid": true, "showLegend": true, "showTooltip": true },
          "height": 280,
          "layout": { "columnSpan": 12, "rowSpan": 1 }
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
- For any metricCard number that comes from data, use "valueRef" (NOT "value").
- "value" is only for literal hard-coded numbers (e.g. a static "12 days" callout).
- "valueRef" = { "capability": "<name>", "params": { ... } }. The runtime resolves it.
- For metric cards: built-in valueRef → { capability, params } picks the first numeric field.
  A named dataset uses valueRef:{ dataset, pick } where pick is an output metric alias.
- Charts and tables may use a built-in capability, a named dataset reference { "dataset": "name" },
  or inline JSON rows.
- For uploaded user.* sources, ALWAYS define a named top-level dataset and reference it from leaves.
  Do not ask the browser to load the complete uploaded source.
- Prefer a capability reference for runtime/business data. Inline chart rows are valid when the user
  supplied the data directly or the chart is a self-contained generated artifact.
- NEVER use "value": 0 or "value": 100 as a placeholder — use valueRef.

FIELD NAMES — THIS IS THE SECOND MOST IMPORTANT RULE:
- For tables: columns[].key MUST be the EXACT field name from the capability's "returns" shape.
  Do NOT invent aliases like "product" or "orderShare" — use "name" and "share" if those are
  what the capability returns. A wrong key renders as "—" in the cell.
- For charts: xAxis.key and every series[].key MUST be exact field names from the
  capability's "returns" shape, named dataset output, or inline row objects.
- Always look at the "returns:" line under each capability before writing column keys or chart axes.

DATASET QUERY COMPILER — USE THIS FOR UPLOADED user.* SOURCES:
- dashboard.datasets is an object of reusable named query definitions.
- Each definition is { source, transform }. source is the exact logical user.* capability name.
- The runtime validates the JSON and compiles it into a parameterized, read-only SQLite SELECT.
- The raw imported source is immutable. Rename/project/filter/group through transform only.
- transform fields:
  - select: [{ field, as? }] for non-aggregated projections/renames.
  - filters: [{ field, operator, value? }], combined with AND.
    Operators: equals, notEquals, greaterThan, greaterThanOrEqual, lessThan,
    lessThanOrEqual, contains, in, notIn, isNull, isNotNull.
  - dimensions: [{ field, as?, timeBucket? }]. timeBucket is hour, day, week,
    month, quarter, or year and only applies to date fields.
  - metrics: [{ field?, operation, as }]. Operations: count, countDistinct,
    sum, average, min, max. Only count may omit field.
  - sort: [{ field, direction:"asc"|"desc" }]. Sort by an output field/alias.
  - limit: 1..5000. Prefer the smallest chart-ready result.
- With metrics, use dimensions for GROUP BY fields and do not use select.
- Without metrics, select/dimensions project rows without mutating the source.
- Charts should normally receive <=2000 points, bars <=100 categories, and pies <=10 slices.
- Example:
  "datasets": {
    "monthlyTraffic": {
      "source": "user.website_traffic",
      "transform": {
        "filters": [{ "field": "status_code", "operator": "lessThan", "value": 400 }],
        "dimensions": [{ "field": "timestamp", "as": "month", "timeBucket": "month" }],
        "metrics": [
          { "operation": "count", "as": "pageViews" },
          { "field": "visitor_id", "operation": "countDistinct", "as": "visitors" }
        ],
        "sort": [{ "field": "month", "direction": "asc" }],
        "limit": 24
      }
    }
  }
  A chart/table then uses "data": { "dataset": "monthlyTraffic" } and binds
  xAxis/series/columns to month, pageViews, and visitors—the query OUTPUT names.

CHARTS & FILTERS — THIS IS THE THIRD MOST IMPORTANT RULE:
- Recharts is an implementation detail. Emit only this documented JSON contract; never emit JSX,
  callbacks, formatter functions, arbitrary Recharts props, or executable code.
- Chart kinds: line, area, bar, composed, scatter, pie, donut, radar, radialBar,
  funnel, treemap.
- A chart's series array gives the agent multi-series control. For a composed chart,
  set series[].type independently to line, area, or bar. Use stackId to stack compatible
  bar/area series and yAxisId to bind a series to an entry in yAxes.
- Legacy x/y/yFormat fields remain readable for existing dashboards, but always use
  xAxis/yAxes/series/options when creating a new chart.
- options controls grid, legend, tooltip, and legend position. height controls chart height.
- Every section child is a tile on a bounded grid. layout supports columnSpan, columnStart,
  rowSpan, surface:"none"|"card"|"subtle"|"accent", padding:"none"|"compact"|"comfortable",
  and verticalAlign:"start"|"center"|"end"|"stretch". Use 12-column sections for editorial
  layouts: chart 8 + text 4, two charts 6 + 6, or a full-width narrative tile at 12.
- Array order is semantic reading order. columnStart may position a tile within its row but must
  not be used to create a visual order that conflicts with the array. Never place more than four
  visible tiles in one row; create another row or section instead.
- Employer-facing cartesian charts should label both axes: xAxis.label describes the dimension,
  and yAxes[].label describes each measure. Pie, donut, radar, radialBar, funnel, and treemap do
  not need cartesian axis titles.
- User-uploaded data may contain multiple rows per logical group. Aggregate it in a named dataset
  so every chart receives only the chart-ready rows it needs.
- For "per X, per Y" breakdowns (e.g. "revenue by product for each day"), prefer one grouped
  dataset and a multi-series chart when that remains readable. When separate charts are clearer,
  define one named dataset per X with an equals filter. data.where is only for built-in capabilities,
  not uploaded user.* sources. For example, define a saturdayProductMix dataset with
  filters:[{field:"day",operator:"equals",value:"Sat"}], dimensions:[{field:"product"}],
  metrics:[{field:"revenue",operation:"sum",as:"revenue"}], then bind the pie with
  data:{dataset:"saturdayProductMix"}, xAxis.key:"product", and series[].key:"revenue".
- data.params and data.where are only for built-in capabilities. params are passed to the
  resolver; where applies exact-value client-side filtering to its returned rows.

Component quick reference (all fields shown above; every type has a 'type' literal):
- Every leaf may include layout:{columnSpan?,columnStart?,rowSpan?,surface?,padding?,verticalAlign?}.
  section.children array order is the semantic reading order; max four visible tiles per row.
- metricCard: { type:"metricCard", label, valueRef:{capability,params}|{dataset,pick} OR value:literal, format, emphasis?, delta?, caption? }
- chart:       { type:"chart", kind:"line"|"area"|"bar"|"composed"|"scatter"|"pie"|"donut"|"radar"|"radialBar"|"funnel"|"treemap", title, description?, caption?, data:{dataset}|{capability,params,where?}|rows[], xAxis:{key,label?,type?,format?,hide?}, yAxes?:[{id?,label?,side?,format?,domain?,hide?}], series:[{key,label?,type?,color?,yAxisId?,stackId?,curve?,fillOpacity?,showDots?,showLabels?,format?}], options?:{showGrid?,showLegend?,showTooltip?,legendPosition?}, height?, layout? }
- table:       { type:"table", data:{dataset}|{capability,params,where?}|rows[], columns:[{key,label,format?,align?}], title? }
- text:        { type:"text", title?, content, as?:"p"|"h1"|"h2"|"h3"|"h4"|"blockquote", tone?, layout? }
- codeBlock:   { type:"codeBlock", title?, code, language?, caption?, layout? } (display-only; never executable)
- separator:   { type:"separator", label?, spacing?:"compact"|"comfortable"|"spacious", layout? }
- insight:     { type:"insight", severity, content, title? }
- comparison:  { type:"comparison", title, metric, left:{label,value}, right:{label,value}, format }
- section:     { type:"section", title?, columns, children:[leaves] }
- dashboard:   { type:"dashboard", title, description?, hero?:{eyebrow?,body?,variant?:"minimal"|"banner"|"cover",height?:"compact"|"standard"|"large",alignment?:"left"|"center",foreground?:"auto"|"light"|"dark",background?:{type:"none"}|{type:"tone",tone:"neutral"|"accent"|"dark"}|{type:"gradient",tone:"cool"|"warm"|"forest"}|{type:"image",src,position?,overlay?}}, datasets?:{name:{source,transform}}, children:[sections] }

Hard rules:
- The top-level object MUST be a dashboard.
- hero is optional and presents dashboard.title/description; it is not a body tile grid.
- Use a hero for an executive brief or shared report. Omit it for dense operational dashboards.
- Keep hero copy concise. Metrics, charts, tables, and code belong in body sections.
- Every section MUST have a "children" array of leaves (never empty).
- Compose narrative and data freely: array order controls reading order, so a text/code block
  placed after a chart renders underneath it. Use chart.caption for a note inside the chart card.
- Use separator sparingly between distinct rows or ideas. It should usually span the full section.
- Narrative text should normally use no surface. Reserve surface backgrounds for metrics and
  genuine callouts; do not put ordinary headings or chart explanations in decorative cards.
- Bind uploaded data through named dashboard datasets. Built-ins may use
  { capability, params, where? }. Inline chart rows are allowed
  only when they came from the user or are intentionally part of the generated artifact.
- Use design tokens by name only (do not put raw color/space/type values).
- For modify intents, preserve the user's existing structure where possible.
- Keep the dashboard focused: at most ~8 sections and at most 4 visible tiles in one row.
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
  // Use the non-greedy form so multiple think blocks are all stripped.
  t = t.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return t;
}

/**
 * Returns the first balanced JSON object in `text`. Walks the string
 * tracking nesting depth and skipping over content inside string literals
 * (which can contain unbalanced braces). If the walker never finds a
 * matching close brace, returns the substring from the first `{` to
 * end-of-string so the JSON.parse that follows produces a meaningful
 * error instead of "no JSON at all".
 */
function extractFirstJsonObject(text: string): string {
  const start = text.indexOf("{");
  if (start === -1) return "";
  return walkBalanced(text, start, "{", "}");
}

/**
 * Returns the first balanced JSON array in `text`. Same walker as
 * extractFirstJsonObject but for `[` `]`. Some chat-completions servers
 * (and some model responses) wrap the payload as `[ {...} ]`; we unwrap
 * the array by taking its first element.
 */
function extractFirstJsonArray(text: string): string {
  const start = text.indexOf("[");
  if (start === -1) return "";
  return walkBalanced(text, start, "[", "]");
}

function walkBalanced(text: string, start: number, open: string, close: string): string {
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
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

/**
 * Tries several extraction strategies to pull a parseable JSON value
 * from an LLM response. Returns the parsed value. The order of
 * strategies matters — start with the strictest (the balanced-object
 * walker), fall back to looser heuristics.
 *
 * Throws if nothing parses. The error message includes a preview of
 * the original text so the failure mode is obvious in the UI.
 */
function parseLLMJson(text: string): unknown {
  const candidates: string[] = [];

  // 1. Strict walker — first balanced `{...}` from the cleaned text.
  const obj = extractFirstJsonObject(text);
  if (obj) candidates.push(obj);

  // 2. If the response was an array wrapper like `[ {...} ]`,
  //    extract the array and try its first element.
  const arr = extractFirstJsonArray(text);
  if (arr) {
    try {
      const parsed = JSON.parse(arr);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        candidates.push(JSON.stringify(parsed));
      }
    } catch {
      // ignore — fall through
    }
  }

  // 3. Loose greedy match: longest `{...}` region. Catches models that
  //    emit extra braces in strings or comments that confuse the walker.
  const greedy = text.match(/\{[\s\S]*\}/);
  if (greedy) candidates.push(greedy[0]);

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      // try next
    }
  }

  const preview = text.length > 240 ? text.slice(0, 240) + "..." : text;
  throw new Error(
    `Could not extract a parseable JSON value from the LLM response. ` +
    `First ${Math.min(240, text.length)} chars: ${preview.replace(/\n/g, "\\n")}`,
  );
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

    const extract = (raw: string) => parseLLMJson(stripCodeFence(raw));

    // Attempt 1.
    let content = await callOnce(buildUserPrompt(intent, ctx.currentSpec));

    let parsed = extract(content);
    let result = DashboardSpec.safeParse(parsed);
    if (!result.success) {
      // Attempt 2 — append the Zod error so the model can self-correct.
      const retryPrompt =
        buildUserPrompt(intent, ctx.currentSpec) +
        `\n\nYour previous response failed schema validation:\n${result.error.message}\n\nReturn a corrected JSON object that satisfies the schema.`;
      content = await callOnce(retryPrompt);
      parsed = extract(content);
      result = DashboardSpec.safeParse(parsed);
      if (!result.success) {
        throw new Error("LLM output failed schema validation after retry: " + result.error.message);
      }
    }
    return { spec: result.data };
  }
}
