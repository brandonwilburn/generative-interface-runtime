/**
 * "Connect data" dialog.
 *
 * Lets the user upload a CSV or JSON file, see a preview of the inferred
 * schema, and register it as a runtime capability. Also lists existing
 * sources with delete affordances.
 *
 * For v1 the schema is inferred locally (column types from the first 20
 * rows). When we add API registration, the same component will gain a
 * tab that runs the LLM-driven adaptation call.
 */
import { useEffect, useRef, useState } from "react";
import { type SourceRecord, fetchSourceData } from "@/data/sourcesRegistry";
import { summarizeSource } from "@/data/dynamicCapabilities";
import s from "./app.module.css";

interface Props {
  sources: SourceRecord[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRegisterCsv: (name: string, content: string) => Promise<SourceRecord>;
  onRegisterJson: (name: string, content: string) => Promise<SourceRecord>;
  onRemove: (id: string) => Promise<void>;
}

type Tab = "upload" | "api" | "docs";

interface Preview {
  kind: "csv" | "json";
  filename: string;
  content: string;
  rows: Array<Record<string, unknown>>;
  columns: string[];
}

const MAX_PREVIEW_ROWS = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });
}

function inferPreview(content: string, kind: "csv" | "json", filename: string): Preview {
  if (kind === "csv") {
    // Lightweight client-side preview using a tiny CSV parser. The real
    // parse happens server-side; this is just so the user can see columns
    // and a few rows before submitting.
    const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) throw new Error("CSV is empty");
    const parseLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = "";
      let inQuote = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i]!;
        if (inQuote) {
          if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
          else if (c === '"') inQuote = false;
          else cur += c;
        } else {
          if (c === '"') inQuote = true;
          else if (c === ",") { out.push(cur); cur = ""; }
          else cur += c;
        }
      }
      out.push(cur);
      return out;
    };
    const headers = parseLine(lines[0]!).map((h) => h.trim());
    const rows = lines.slice(1, 1 + MAX_PREVIEW_ROWS).map((l) => {
      const cells = parseLine(l);
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { obj[h] = cells[i] ?? ""; });
      return obj;
    });
    return { kind, filename, content, rows, columns: headers };
  }
  // JSON
  const parsed = JSON.parse(content);
  let arr: Array<Record<string, unknown>>;
  if (Array.isArray(parsed)) {
    arr = parsed as Array<Record<string, unknown>>;
  } else if (typeof parsed === "object" && parsed !== null) {
    const found = Object.values(parsed).find(
      (v) => Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null,
    );
    if (!found) throw new Error("JSON has no array of objects.");
    arr = found as Array<Record<string, unknown>>;
  } else {
    throw new Error("JSON must be an array of objects.");
  }
  const columns = arr.length > 0 ? Object.keys(arr[0]!) : [];
  return {
    kind, filename, content, rows: arr.slice(0, MAX_PREVIEW_ROWS), columns,
  };
}

export function DataSourceDialog(props: Props) {
  const [tab, setTab] = useState<Tab>("upload");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);

  const reset = () => {
    setPreview(null);
    setName("");
    setLocalError(null);
    if (fileInput.current) fileInput.current.value = "";
  };

  const handleFile = async (file: File) => {
    setLocalError(null);
    if (file.size > MAX_FILE_BYTES) {
      setLocalError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Limit is 5 MB.`);
      return;
    }
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const isJson = file.name.toLowerCase().endsWith(".json");
    if (!isCsv && !isJson) {
      setLocalError("Only .csv and .json are supported.");
      return;
    }
    try {
      const content = await readFileAsText(file);
      const p = inferPreview(content, isCsv ? "csv" : "json", file.name);
      setPreview(p);
      if (!name) setName(file.name.replace(/\.(csv|json)$/i, ""));
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };

  const submit = async () => {
    if (!preview) return;
    const finalName = name.trim() || preview.filename;
    setBusy(true);
    setLocalError(null);
    try {
      if (preview.kind === "csv") {
        await props.onRegisterCsv(finalName, preview.content);
      } else {
        await props.onRegisterJson(finalName, preview.content);
      }
      reset();
    } catch (e) {
      setLocalError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s["dsd__overlay"]} onClick={props.onClose}>
      <div
        className={s["dsd__modal"]}
        role="dialog"
        aria-label="Connect data sources"
        onClick={(e) => e.stopPropagation()}
      >
        <header className={s["dsd__header"]}>
          <h2 className={s["dsd__title"]}>Connect data</h2>
          <button
            className={s["dsd__close"]}
            onClick={props.onClose}
            type="button"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className={s["dsd__tabs"]} role="tablist">
          <button
            className={[s["dsd__tab"], tab === "upload" ? s["dsd__tab--active"] : ""].join(" ")}
            onClick={() => setTab("upload")}
            type="button"
            role="tab"
            aria-selected={tab === "upload"}
          >
            Upload file
          </button>
          <button
            className={[s["dsd__tab"], tab === "api" ? s["dsd__tab--active"] : ""].join(" ")}
            onClick={() => setTab("api")}
            type="button"
            role="tab"
            aria-selected={tab === "api"}
            disabled
            title="Coming soon"
          >
            API
          </button>
          <button
            className={[s["dsd__tab"], tab === "docs" ? s["dsd__tab--active"] : ""].join(" ")}
            onClick={() => setTab("docs")}
            type="button"
            role="tab"
            aria-selected={tab === "docs"}
            disabled
            title="Coming soon"
          >
            Docs link
          </button>
        </div>

        {tab === "upload" && (
          <div className={s["dsd__body"]}>
            <div className={s["dsd__layout"]}>
              <section className={s["dsd__pane"]}>
                <h3 className={s["dsd__pane-title"]}>New source</h3>
                {!preview ? (
                  <div
                    className={[
                      s["dsd__dropzone"],
                      dragging ? s["dsd__dropzone--dragging"] : "",
                    ].join(" ")}
                    onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      const file = e.dataTransfer.files[0];
                      if (file) void handleFile(file);
                    }}
                    onClick={() => fileInput.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInput.current?.click();
                      }
                    }}
                  >
                    <div className={s["dsd__dropzone-icon"]} aria-hidden>↥</div>
                    <div className={s["dsd__dropzone-text"]}>
                      Drop a <code>.csv</code> or <code>.json</code> file here
                    </div>
                    <div className={s["dsd__dropzone-sub"]}>
                      or click to choose · up to 5 MB
                    </div>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".csv,.json,application/json,text/csv"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void handleFile(file);
                      }}
                    />
                  </div>
                ) : (
                  <div className={s["dsd__form"]}>
                    <label className={s["dsd__field"]}>
                      <span className={s["dsd__field-label"]}>Source name</span>
                      <input
                        type="text"
                        className={s["dsd__input"]}
                        value={name}
                        placeholder={preview.filename}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <div className={s["dsd__field"]}>
                      <span className={s["dsd__field-label"]}>
                        Preview · {preview.rows.length} of {preview.kind.toUpperCase()} rows
                      </span>
                      <div className={s["dsd__preview"]}>
                        <table className={s["dsd__preview-table"]}>
                          <thead>
                            <tr>
                              {preview.columns.map((c) => (
                                <th key={c}>{c}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.map((r, i) => (
                              <tr key={i}>
                                {preview.columns.map((c) => (
                                  <td key={c}>{String(r[c] ?? "")}</td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {localError && (
                      <div className={s["dsd__error"]}>{localError}</div>
                    )}
                    <div className={s["dsd__actions"]}>
                      <button
                        className={s["dsd__btn"]}
                        onClick={reset}
                        type="button"
                        disabled={busy}
                      >
                        Cancel
                      </button>
                      <button
                        className={[s["dsd__btn"], s["dsd__btn--primary"]].join(" ")}
                        onClick={submit}
                        type="button"
                        disabled={busy}
                      >
                        {busy ? "Saving…" : "Save source"}
                      </button>
                    </div>
                  </div>
                )}
              </section>

              <section className={s["dsd__pane"]}>
                <h3 className={s["dsd__pane-title"]}>
                  Registered sources
                  <span className={s["dsd__count"]}>
                    {props.sources.length}
                  </span>
                </h3>
                {props.loading && (
                  <div className={s["dsd__empty"]}>Loading…</div>
                )}
                {!props.loading && props.sources.length === 0 && (
                  <div className={s["dsd__empty"]}>
                    No sources yet. Upload a file to get started.
                  </div>
                )}
                {!props.loading && props.sources.length > 0 && (
                  <ul className={s["dsd__list"]}>
                    {props.sources.map((src) => (
                      <li key={src.id} className={s["dsd__list-item"]}>
                        <div className={s["dsd__list-head"]}>
                          <div className={s["dsd__list-name"]}>{src.name}</div>
                          <button
                            className={s["dsd__list-remove"]}
                            onClick={() => { void props.onRemove(src.id); }}
                            type="button"
                            aria-label={`Remove ${src.name}`}
                            title="Remove source"
                          >
                            ×
                          </button>
                        </div>
                        <div className={s["dsd__list-meta"]}>
                          <code>{src.capability}</code>
                        </div>
                        <div className={s["dsd__list-summary"]}>
                          {summarizeSource(src)}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
                {props.error && (
                  <div className={s["dsd__error"]}>{props.error}</div>
                )}
              </section>
            </div>
          </div>
        )}

        {tab === "api" && (
          <div className={s["dsd__body"]}>
            <div className={s["dsd__coming-soon"]}>
              API registration ships in the next pass — paste a curl, a sample
              response, and the planner will figure out the rest.
            </div>
          </div>
        )}

        {tab === "docs" && (
          <div className={s["dsd__body"]}>
            <div className={s["dsd__coming-soon"]}>
              Docs-link scraping is on the roadmap.
            </div>
          </div>
        )}

        {/* Suppress unused warnings for the helpers used by future tabs. */}
        {false && <>{fetchSourceData}</>}
      </div>
    </div>
  );
}
