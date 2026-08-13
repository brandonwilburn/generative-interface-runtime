/**
 * Planner interface.
 *
 * The planner is the only place where intent becomes a `DashboardSpec`.
 * The runtime calls `plan()` and the validator + renderer take over.
 *
 * Two implementations:
 *   - MockPlanner  → deterministic, offline, drives the first-slice demo.
 *   - OpenAIPlanner → calls an OpenAI-compatible chat completions endpoint
 *                     with `response_format: json_schema` (Zod-converted).
 *
 * Swapping planners does not touch anything else.
 */
import type { DashboardSpec } from "@/dsl/schema";
import type { CapabilityDescriptor } from "@/registry/capabilities";
import type { ComponentSummary } from "@/registry/components";

export interface PlannerContext {
  /** Capabilities the planner may reference. */
  capabilities: CapabilityDescriptor[];
  /** Summary of components the planner may use. */
  components: ComponentSummary[];
  /** Short design constitution summary. */
  constitution: string;
  /** Current spec, when this is a "modify" intent. */
  currentSpec?: DashboardSpec;
}

export interface PlannerResult {
  spec: DashboardSpec;
  /** Optional short note for the UI ("I added retention because..."). */
  reasoning?: string;
}

export interface Planner {
  readonly name: string;
  plan(intent: string, ctx: PlannerContext): Promise<PlannerResult>;
}

/* ============================================================
   Constitution (short, planner-facing)
   ============================================================ */

export const DESIGN_CONSTITUTION_SHORT = `
Principles the generated dashboard must follow:
1. Establish a clear information hierarchy. One primary metric. The rest are secondary.
2. Group related items in a section; never place a single leaf at the dashboard root.
3. Use visualizations when they communicate trend, comparison, or distribution.
4. Don't repeat the same label twice in a section.
5. Avoid decorative charts. Every chart must answer a real question.
6. Use semantic tokens only. Never invent colors, spacing, or type values.
7. Keep density reasonable. At most 4 leaves per section; at most ~8 sections per dashboard.
8. Use progressive disclosure. If a section would be dense, split it.
9. For modify intents: preserve the user's existing structure when possible;
   make targeted additions, removals, or rearrangements rather than a rewrite.
`.trim();

/* ============================================================
   Helpers
   ============================================================ */

export async function fetchOpenAICompletion(
  args: {
    baseUrl: string;
    apiKey: string;
    model: string;
    systemPrompt: string;
    userPrompt: string;
    schema: unknown;
    signal?: AbortSignal;
  },
  options: {
    fallbackToJsonObject?: boolean;
    assumeProxyAuth?: boolean;
    skipStrictSchema?: boolean;
  } = {},
): Promise<string> {
  const {
    fallbackToJsonObject = true,
    assumeProxyAuth = true,
    // Skip the strict json_schema tier entirely. Some providers (notably
    // MiniMax M3) reject the format zod-to-json-schema produces
    // (it uses $ref + definitions), wasting a request. Default-on skip
    // for now; set to false to try the strict path first.
    skipStrictSchema = true,
  } = options;
  const url = `${args.baseUrl.replace(/\/+$/, "")}/chat/completions`;

  // If the caller didn't pass a key, the request must be going through a
  // same-origin proxy. The proxy will add Authorization. We pass any
  // placeholder so the build is identical; the proxy overrides.
  const effectiveKey = args.apiKey || (assumeProxyAuth ? "proxy" : "");
  if (!effectiveKey) {
    throw new Error("No API key provided and assumeProxyAuth is false");
  }

  const buildBody = (
    format: "json_schema" | "json_object" | "none",
    systemPrompt: string,
  ) => {
    const body: Record<string, unknown> = {
      model: args.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: args.userPrompt },
      ],
      temperature: 0.2,
    };
    if (format === "json_schema") {
      body.response_format = {
        type: "json_schema",
        json_schema: {
          name: "ui_specification",
          strict: true,
          schema: args.schema,
        },
      };
    } else if (format === "json_object") {
      body.response_format = { type: "json_object" };
    }
    return body;
  };

  const call = async (
    format: "json_schema" | "json_object" | "none",
    systemPrompt: string,
  ) => {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(effectiveKey && effectiveKey !== "proxy"
          ? { Authorization: `Bearer ${effectiveKey}` }
          : {}),
      },
      body: JSON.stringify(buildBody(format, systemPrompt)),
      signal: args.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`LLM ${res.status}: ${text.slice(0, 500)}`) as Error & {
        status?: number;
      };
      err.status = res.status;
      throw err;
    }
    const json = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    const content = json.choices[0]?.message?.content;
    if (!content) throw new Error("LLM returned empty content");
    return content;
  };

  const JSON_ONLY_SUFFIX = `

OUTPUT FORMAT (strict): Your response must be a single JSON object. No prose, no markdown fences, no commentary. The first character of your response must be { and the last must be }.`;

  // Tier 1 — strict schema (skipped by default; set skipStrictSchema:false to try).
  if (!skipStrictSchema) {
    try {
      return await call("json_schema", args.systemPrompt);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const isSchemaRejection =
        status === 400 ||
        status === 422 ||
        (e instanceof Error && /json_schema|response_format|schema/i.test(e.message));
      if (!fallbackToJsonObject || !isSchemaRejection) throw e;
    }
  }

  // Tier 2 — basic JSON mode.
  try {
    return await call("json_object", args.systemPrompt + JSON_ONLY_SUFFIX);
  } catch (e) {
    const status = (e as { status?: number }).status;
    const isFormatRejection =
      status === 400 ||
      status === 422 ||
      (e instanceof Error && /response_format|json_object/i.test(e.message));
    if (!fallbackToJsonObject || !isFormatRejection) throw e;
  }

  // Tier 3 — no response_format at all. Trust the system prompt.
  return call("none", args.systemPrompt + JSON_ONLY_SUFFIX);
}
