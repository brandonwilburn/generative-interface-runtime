import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface SourceColumn {
  name: string;
  type: "string" | "number" | "date" | "boolean";
  samples: unknown[];
  nullCount?: number;
  distinctCount?: number;
  min?: string | number;
  max?: string | number;
}

export interface SourceRecord {
  id: string;
  name: string;
  kind: "csv" | "json";
  registeredAt: string;
  rowCount: number;
  schema: { columns: SourceColumn[] };
  capability: string;
}

interface SourcesContextValue {
  sources: SourceRecord[];
  loading: boolean;
  error: string | null;
  registerCsv: (name: string, content: string) => Promise<SourceRecord>;
  registerJson: (name: string, content: string) => Promise<SourceRecord>;
  remove: (id: string) => Promise<void>;
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }
  return body;
}

const SourcesContext = createContext<SourcesContextValue | null>(null);

export function SourcesProvider({ children }: { children: ReactNode }) {
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/sources");
        const body = await responseJson<{ sources: SourceRecord[] }>(response);
        if (!active) return;
        setSources(body.sources);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const register = useCallback(async (
    name: string,
    kind: "csv" | "json",
    content: string,
  ): Promise<SourceRecord> => {
    setError(null);
    try {
      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, kind, content }),
      });
      const source = await responseJson<SourceRecord>(response);
      setSources((current) => [...current, source]);
      return source;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    }
  }, []);

  const registerCsv = useCallback(
    (name: string, content: string) => register(name, "csv", content),
    [register],
  );
  const registerJson = useCallback(
    (name: string, content: string) => register(name, "json", content),
    [register],
  );
  const remove = useCallback(async (id: string): Promise<void> => {
    setError(null);
    try {
      const response = await fetch(`/api/sources/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await responseJson<{ ok: true }>(response);
      setSources((current) => current.filter((source) => source.id !== id));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      throw cause;
    }
  }, []);

  const value = useMemo<SourcesContextValue>(() => ({
    sources,
    loading,
    error,
    registerCsv,
    registerJson,
    remove,
  }), [sources, loading, error, registerCsv, registerJson, remove]);

  return <SourcesContext.Provider value={value}>{children}</SourcesContext.Provider>;
}

export function useSources(): SourcesContextValue {
  const value = useContext(SourcesContext);
  if (!value) throw new Error("useSources must be used inside SourcesProvider");
  return value;
}
