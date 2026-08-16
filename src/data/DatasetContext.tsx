import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CapabilityRef, ChartData } from "@/dsl/schema";
import type { DatasetDefinition } from "./querySchema";
import { resolveRows } from "@/renderer/resolveValue";

type Row = Record<string, unknown>;
type DatasetCatalog = Record<string, DatasetDefinition>;

const DatasetContext = createContext<DatasetCatalog>({});
const queryCache = new Map<string, Promise<Row[]>>();

export function DatasetProvider({
  datasets,
  children,
}: {
  datasets: DatasetCatalog;
  children: ReactNode;
}) {
  return <DatasetContext.Provider value={datasets}>{children}</DatasetContext.Provider>;
}

function isDatasetRef(data: ChartData): data is { dataset: string } {
  return !Array.isArray(data) && "dataset" in data;
}

function isUploadedCapability(ref: CapabilityRef): boolean {
  return ref.capability.startsWith("user.");
}

function queryDefinition(data: ChartData, datasets: DatasetCatalog): DatasetDefinition | null {
  if (isDatasetRef(data)) return datasets[data.dataset] ?? null;
  if (!Array.isArray(data) && isUploadedCapability(data)) {
    return {
      source: data.capability,
      transform: {
        select: [],
        dimensions: [],
        metrics: [],
        sort: [],
        limit: 1000,
        filters: Object.entries(data.where ?? {}).map(([field, value]) => ({
          field,
          operator: "equals" as const,
          value,
        })),
      },
    };
  }
  return null;
}

function fetchQuery(definition: DatasetDefinition): Promise<Row[]> {
  const key = JSON.stringify(definition);
  const cached = queryCache.get(key);
  if (cached) return cached;
  const request = fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(definition),
  }).then(async (response) => {
    const body = await response.json() as { rows?: Row[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? `Query failed with status ${response.status}`);
    return body.rows ?? [];
  }).catch((error) => {
    queryCache.delete(key);
    throw error;
  });
  queryCache.set(key, request);
  return request;
}

export interface ResolvedRows {
  rows: Row[];
  loading: boolean;
  error: string | null;
}

export function useResolvedRows(data: ChartData): ResolvedRows {
  const datasets = useContext(DatasetContext);
  const definition = useMemo(() => queryDefinition(data, datasets), [data, datasets]);
  const synchronousRows = useMemo(
    () => definition ? [] : resolveRows(data),
    [data, definition],
  );
  const [state, setState] = useState<ResolvedRows>({
    rows: synchronousRows,
    loading: Boolean(definition),
    error: isDatasetRef(data) && !definition ? `Unknown dataset "${data.dataset}".` : null,
  });

  useEffect(() => {
    if (!definition) {
      setState({
        rows: synchronousRows,
        loading: false,
        error: isDatasetRef(data) ? `Unknown dataset "${data.dataset}".` : null,
      });
      return;
    }
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    void fetchQuery(definition).then(
      (rows) => { if (active) setState({ rows, loading: false, error: null }); },
      (error: unknown) => {
        if (active) setState({
          rows: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => { active = false; };
  }, [data, definition, synchronousRows]);

  return state;
}
