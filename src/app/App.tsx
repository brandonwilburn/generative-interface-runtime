import { useEffect, useMemo, useState } from "react";
import { TopBar } from "./TopBar";
import { IntentPanel, type Mode } from "./IntentPanel";
import { EmptyState } from "./EmptyState";
import { ValidationPanel } from "./ValidationPanel";
import { SpecViewer } from "./SpecViewer";
import { LoadingSkeleton } from "./LoadingSkeleton";
import { DashboardView } from "@/renderer/DashboardView";
import { createPlanner, DESIGN_CONSTITUTION_SHORT } from "@/planner";
import { CAPABILITY_CATALOG } from "@/registry/capabilities";
import { summarizeForPlanner } from "@/registry/components";
import { validateSpec } from "@/registry/validation";
import { DashboardSpec, type DashboardSpec as DashboardSpecT } from "@/dsl/schema";
import { useSources } from "@/data/sourcesRegistry";
import { capabilitiesFromSources } from "@/data/dynamicCapabilities";
import { setDynamicResolvers } from "@/data/capabilityResolver";
import { DataSourceDialog } from "./DataSourceDialog";
import s from "./app.module.css";

const EXAMPLES = [
  "Show me how the business performed this month",
  "Why was revenue lower last week?",
  "When are we busiest?",
  "Who are our top customers?",
  "Show me category mix",
];

interface ResultState {
  spec: DashboardSpecT;
  reasoning?: string;
}

export function App() {
  const [mode, setMode] = useState<Mode>("create");
  const [intent, setIntent] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ResultState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showSpec, setShowSpec] = useState(false);
  const [showDataSourceDialog, setShowDataSourceDialog] = useState(false);

  const sourcesApi = useSources();
  const planner = useMemo(() => createPlanner(), []);

  // Keep the resolver's dynamic map in sync with the in-memory row cache
  // AND the registered APIs. The capability resolver is module-level, so
  // we have to push from React; this effect does that whenever sources
  // or rows change.
  //
  // - CSV/JSON sources: sync resolver returns the cached rowset.
  // - API sources: async resolver calls the live endpoint via
  //   /api/sources/:id/call, capturing the apiId + endpoint name in
  //   the closure. The renderer awaits these uniformly.
  useEffect(() => {
    const map: Record<
      string,
      (params: Record<string, string | number | boolean>) => unknown
    > = {};
    for (const s of sourcesApi.sources) {
      if (s.kind === "csv" || s.kind === "json") {
        const rows = sourcesApi.rowsById[s.id];
        if (rows) {
          map[s.capability] = () => rows;
        }
      } else if (s.kind === "api") {
        // One resolver per endpoint, capturing the source id.
        for (const ep of s.endpoints) {
          const fullName = `${s.capability}.${ep.name}`;
          map[fullName] = async (params) => {
            const { callApiEndpoint } = await import("@/data/sourcesRegistry");
            return callApiEndpoint(s.id, ep.name, params);
          };
        }
      }
    }
    setDynamicResolvers(map);
  }, [sourcesApi.sources, sourcesApi.rowsById]);

  // Capabilities advertised to the planner = static catalog + dynamic ones.
  const allCapabilities = useMemo(
    () => [...CAPABILITY_CATALOG, ...capabilitiesFromSources(sourcesApi.sources)],
    [sourcesApi.sources],
  );

  const buildPlannerCtx = (currentSpec?: DashboardSpecT) => {
    const components = summarizeForPlanner();
    return {
      capabilities: allCapabilities,
      components,
      constitution: DESIGN_CONSTITUTION_SHORT,
      ...(currentSpec ? { currentSpec } : {}),
    };
  };

  // Dev/headless convenience: `#intent=...&modify=...` auto-submits.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const m = window.location.hash.match(/intent=([^&]+)/);
    if (!m || !m[1]) return;
    const decoded = decodeURIComponent(m[1]);
    const modifyIntent = (() => {
      const mm = window.location.hash.match(/modify=([^&]+)/);
      return mm && mm[1] ? decodeURIComponent(mm[1]) : null;
    })();
    if (window.location.hash.includes("spec=open")) {
      setShowSpec(true);
    }
    const t = window.setTimeout(async () => {
      if (modifyIntent) {
        // Two-step: first create, then modify.
        const ctx = buildPlannerCtx();
        try {
          const first = await planner.plan(decoded, ctx);
          const parsed = DashboardSpec.safeParse(first.spec);
          if (!parsed.success) throw new Error("Create step failed: " + parsed.error.message);
          setResult({ spec: parsed.data });
          setMode("modify");
          setIntent(modifyIntent);
          // Run modify
          const second = await planner.plan(modifyIntent, buildPlannerCtx(parsed.data));
          const parsed2 = DashboardSpec.safeParse(second.spec);
          if (parsed2.success) {
            setResult({ spec: parsed2.data, ...(second.reasoning ? { reasoning: second.reasoning } : {}) });
            setIntent(modifyIntent);
          } else {
            throw new Error("Modify step produced invalid spec: " + parsed2.error.message);
          }
        } catch (e) {
          // Surface the error in the existing error panel so the user gets
          // feedback instead of a silent no-op when the planner rejects a
          // request (e.g. invalid chart kind).
          setError(e instanceof Error ? e.message : String(e));
          setBusy(false);
        }
      } else {
        setIntent(decoded);
        setMode("create");
        void submitFromHash(decoded);
      }
    }, 50);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitFromHash(text: string) {
    setBusy(true);
    setError(null);
    try {
      const out = await planner.plan(text, buildPlannerCtx());
      const parsed = DashboardSpec.safeParse(out.spec);
      if (!parsed.success) throw new Error(parsed.error.message);
      setResult({ spec: parsed.data, ...(out.reasoning ? { reasoning: out.reasoning } : {}) });
      setMode("modify");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // Auto-submit when an example chip is clicked with empty input.
  useEffect(() => {
    if (intent && !result && mode === "create" && !busy) {
      // no auto-submit; just keep state
    }
  }, [intent, result, mode, busy]);

  const submit = async () => {
    if (intent.trim().length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const ctx = buildPlannerCtx(
        mode === "modify" && result ? result.spec : undefined,
      );
      const out = await planner.plan(intent, ctx);
      // Final structural validation via Zod (defense in depth).
      const parsed = DashboardSpec.safeParse(out.spec);
      if (!parsed.success) {
        throw new Error("Planner output did not match schema: " + parsed.error.message);
      }
      setResult({ spec: parsed.data, ...(out.reasoning ? { reasoning: out.reasoning } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const validation = useMemo(
    () => (result ? validateSpec(result.spec) : { valid: true, violations: [] }),
    [result],
  );

  const reset = () => {
    setResult(null);
    setError(null);
    setIntent("");
    setMode("create");
  };

  return (
    <div className={s["app"]}>
      <TopBar
        plannerName={planner.name}
        sourceCount={sourcesApi.sources.length}
        onOpenDataSources={() => setShowDataSourceDialog(true)}
      />

      <IntentPanel
        mode={mode}
        onModeChange={setMode}
        value={intent}
        onChange={setIntent}
        onSubmit={submit}
        busy={busy}
        hasResult={!!result}
        examples={EXAMPLES}
      />

      {error && (
        <div className={s["validation"]}>
          <div className={s["validation__panel"]}>
            <div className={[s["validation__row"], s["validation__row--error"]].join(" ")}>
              <span className={[s["validation__rule"], s["validation__rule--error"]].join(" ")}>
                ERR
              </span>
              <span>{error}</span>
            </div>
          </div>
        </div>
      )}

      {result && !busy && (
        <div className={s["result__meta"]}>
          <div className={s["result__chips"]}>
            <span className={s["result__chip"]}>
              <span aria-hidden>✓</span>
              {validation.valid ? "Valid spec" : `${validation.violations.length} issue(s)`}
            </span>
            <span className={s["result__chip"]}>
              {result.spec.children.length} section{result.spec.children.length === 1 ? "" : "s"}
            </span>
            <span className={s["result__chip"]}>
              {result.spec.children.reduce((acc, s) => acc + s.children.length, 0)} components
            </span>
          </div>
          <div className={s["result__actions"]}>
            <button className={s["result__btn"]} onClick={reset} type="button">
              Reset
            </button>
          </div>
        </div>
      )}

      {result && <ValidationPanel result={validation} />}

      {busy && <LoadingSkeleton />}

      {result && !busy && (
        <>
          <DashboardView node={result.spec} />
          <SpecViewer
            spec={result.spec}
            {...(result.reasoning ? { reasoning: result.reasoning } : {})}
            open={showSpec}
            onToggle={() => setShowSpec((v) => !v)}
          />
        </>
      )}

      {!result && !busy && <EmptyState />}

      {showDataSourceDialog && (
        <DataSourceDialog
          sources={sourcesApi.sources}
          loading={sourcesApi.loading}
          error={sourcesApi.error}
          onClose={() => setShowDataSourceDialog(false)}
          onRegisterCsv={sourcesApi.registerCsv}
          onRegisterJson={sourcesApi.registerJson}
          onRegisterApi={sourcesApi.registerApi}
          onRemove={sourcesApi.remove}
        />
      )}
    </div>
  );
}
