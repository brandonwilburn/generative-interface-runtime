/**
 * "Connect data" dialog.
 *
 * Lets the user either:
 *   1. Upload a CSV or JSON file — schema is inferred locally and
 *      registered as a `user.<name>` capability.
 *   2. Register a JSON-based API — name + base URL + (optional)
 *      docs link / docs file / sample request-response pairs. The
 *      backend calls the LLM extractor to derive endpoints, the
 *      user reviews, and we save.
 *   3. Manage named API keys in the server-side vault. Keys are
 *      referenced by name from any number of registered APIs.
 *
 * Also lists existing sources with delete affordances.
 */
import { useEffect, useRef, useState } from "react";
import {
  type SourceRecord,
  type ApiSourceRecord,
  type ApiRegistrationInput,
  type ApiSamplePair,
  type ApiKeyPublic,
  fetchSourceData,
  listApiKeys,
  createApiKey,
  deleteApiKey,
} from "@/data/sourcesRegistry";
import { summarizeSource } from "@/data/dynamicCapabilities";
import s from "./app.module.css";

interface Props {
  sources: SourceRecord[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
  onRegisterCsv: (name: string, content: string) => Promise<SourceRecord>;
  onRegisterJson: (name: string, content: string) => Promise<SourceRecord>;
  onRegisterApi: (input: ApiRegistrationInput) => Promise<ApiSourceRecord>;
  onRemove: (id: string) => Promise<void>;
}

type Tab = "upload" | "api" | "keys";

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

  const submitApi = async (input: ApiRegistrationInput) => {
    setBusy(true);
    setLocalError(null);
    try {
      await props.onRegisterApi(input);
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
          >
            API
          </button>
          <button
            className={[s["dsd__tab"], tab === "keys" ? s["dsd__tab--active"] : ""].join(" ")}
            onClick={() => setTab("keys")}
            type="button"
            role="tab"
            aria-selected={tab === "keys"}
          >
            API keys
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
          <ApiRegistrationForm
            busy={busy}
            localError={localError}
            onSubmit={submitApi}
          />
        )}

        {tab === "keys" && (
          <KeysManager
            localError={localError}
            onError={setLocalError}
            onSuccess={reset}
          />
        )}

        {/* Suppress unused warnings for the helpers used by future tabs. */}
        {false && <>{fetchSourceData}</>}
      </div>
    </div>
  );
}

/**
 * API registration form. Captures the inputs the user wants to feed
 * the LLM extractor with (base URL + docs link + docs file + sample
 * pairs) and the auth header (stored server-side only).
 *
 * The backend does the actual LLM call, so the user just clicks
 * "Register" and waits. The first call is slow (~3-10s); subsequent
 * uses of the resulting capability are fast (cached responses).
 */
function ApiRegistrationForm({
  busy,
  localError,
  onSubmit,
}: {
  busy: boolean;
  localError: string | null;
  onSubmit: (input: ApiRegistrationInput) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [authMode, setAuthMode] = useState<"key" | "inline" | "none">("none");
  const [keyName, setKeyName] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [docsLink, setDocsLink] = useState("");
  const [docsFile, setDocsFile] = useState<{ filename: string; content: string } | null>(null);
  const [sampleText, setSampleText] = useState("");
  const [sampleMethod, setSampleMethod] = useState<"GET" | "POST">("GET");
  const [samplePath, setSamplePath] = useState("");
  const [samples, setSamples] = useState<ApiSamplePair[]>([]);
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  // Fetch the available keys so the user can pick one. Re-fetched
  // when the tab becomes active (handled in parent via key prop) so
  // newly added keys show up immediately.
  useEffect(() => {
    listApiKeys()
      .then(setKeys)
      .catch(() => setKeys([]));
  }, []);

  const addSample = () => {
    if (!sampleText.trim()) return;
    setSamples((s) => [
      ...s,
      {
        label: samplePath || `Sample ${s.length + 1}`,
        method: sampleMethod,
        path: samplePath || "/",
        responseBody: sampleText,
      },
    ]);
    setSampleText("");
    setSamplePath("");
  };

  const removeSample = (i: number) => {
    setSamples((s) => s.filter((_, idx) => idx !== i));
  };

  const handleDocsFile = async (file: File) => {
    if (file.size > 1024 * 1024) {
      alert("Docs file too large (1 MB max).");
      return;
    }
    const text = await file.text();
    setDocsFile({ filename: file.name, content: text });
  };

  const submit = async () => {
    if (!name.trim() || !baseUrl.trim()) return;
    const input: ApiRegistrationInput = {
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      ...(authMode === "key" && keyName.trim() ? { keyName: keyName.trim() } : {}),
      ...(authMode === "inline" && authHeader.trim() ? { authHeader: authHeader.trim() } : {}),
      ...(docsLink.trim() ? { docsLink: docsLink.trim() } : {}),
      ...(docsFile ? { docsFile } : {}),
      ...(samples.length > 0 ? { samplePairs: samples } : {}),
    };
    await onSubmit(input);
    // Clear the form on success — the parent will reset busy state.
    setName("");
    setBaseUrl("");
    setAuthMode("none");
    setKeyName("");
    setAuthHeader("");
    setDocsLink("");
    setDocsFile(null);
    setSamples([]);
  };

  const canSubmit = name.trim().length > 0 && baseUrl.trim().length > 0 && !busy;

  return (
    <div className={s["dsd__body"]}>
      <div className={s["dsd__form"]}>
        <p className={s["dsd__api-intro"]}>
          Register a JSON-based API. The runtime will call the LLM to read your
          docs/samples and figure out the endpoints, then expose each one as a
          planner capability. The first registration is slow; subsequent
          dashboard renders that use the API are fast.
        </p>

        <div className={s["dsd__field-row"]}>
          <label className={s["dsd__field"]}>
            <span className={s["dsd__field-label"]}>API name</span>
            <input
              type="text"
              className={s["dsd__input"]}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="weather"
              autoFocus
            />
            <span className={s["dsd__field-hint"]}>
              Capability prefix: <code>user.{name.trim() || "..."}</code>
            </span>
          </label>

          <label className={s["dsd__field"]}>
            <span className={s["dsd__field-label"]}>Base URL</span>
            <input
              type="url"
              className={s["dsd__input"]}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.weather.com"
            />
          </label>
        </div>

        <div className={s["dsd__field"]}>
          <span className={s["dsd__field-label"]}>Authentication</span>
          <div className={s["dsd__auth-modes"]} role="radiogroup">
            <label className={s["dsd__auth-mode"]}>
              <input
                type="radio"
                name="authMode"
                checked={authMode === "none"}
                onChange={() => setAuthMode("none")}
              />
              <span>No auth</span>
            </label>
            <label className={s["dsd__auth-mode"]}>
              <input
                type="radio"
                name="authMode"
                checked={authMode === "key"}
                onChange={() => setAuthMode("key")}
                disabled={keys.length === 0}
              />
              <span>
                Use a saved key
                {keys.length === 0 && (
                  <em className={s["dsd__auth-mode-note"]}> (none — add one in the API keys tab)</em>
                )}
              </span>
            </label>
            <label className={s["dsd__auth-mode"]}>
              <input
                type="radio"
                name="authMode"
                checked={authMode === "inline"}
                onChange={() => setAuthMode("inline")}
              />
              <span>Inline header</span>
            </label>
          </div>
          {authMode === "key" && keys.length > 0 && (
            <select
              className={s["dsd__input"]}
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            >
              <option value="">— pick a key —</option>
              {keys.map((k) => (
                <option key={k.id} value={k.name}>
                  {k.name}
                  {k.usedBySources > 0 ? ` (used by ${k.usedBySources})` : ""}
                </option>
              ))}
            </select>
          )}
          {authMode === "inline" && (
            <>
              <input
                type="text"
                className={s["dsd__input"]}
                value={authHeader}
                onChange={(e) => setAuthHeader(e.target.value)}
                placeholder="Bearer sk-…"
              />
              <span className={s["dsd__field-hint"]}>
                Stored server-side only — never sent to the browser bundle. Sent
                as the <code>Authorization</code> header on every call.
              </span>
            </>
          )}
          {authMode === "key" && (
            <span className={s["dsd__field-hint"]}>
              The actual key value stays in the server-side vault. The browser
              only ever sees the name.
            </span>
          )}
        </div>

        <details className={s["dsd__api-section"]}>
          <summary>Documentation (helps the extractor a lot)</summary>

          <label className={s["dsd__field"]}>
            <span className={s["dsd__field-label"]}>Docs link</span>
            <input
              type="url"
              className={s["dsd__input"]}
              value={docsLink}
              onChange={(e) => setDocsLink(e.target.value)}
              placeholder="https://…/openapi.json or .md"
            />
            <span className={s["dsd__field-hint"]}>
              Plain text or JSON up to 64 KB. HTML is rendered as text.
            </span>
          </label>

          <div className={s["dsd__field"]}>
            <span className={s["dsd__field-label"]}>Docs file</span>
            <div
              className={s["dsd__file-row"]}
              onClick={() => fileRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
            >
              <span className={s["dsd__file-text"]}>
                {docsFile ? `📄 ${docsFile.filename}` : "Choose .md / .txt / .json / .yaml"}
              </span>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.txt,.json,.yaml,.yml,text/plain,application/json"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleDocsFile(f);
                }}
              />
            </div>
          </div>
        </details>

        <details className={s["dsd__api-section"]}>
          <summary>Sample request/response ({samples.length})</summary>
          <p className={s["dsd__api-help"]}>
            Paste a sample response you got from the API. The extractor will
            infer the endpoint URL pattern, method, and parameters.
          </p>

          <div className={s["dsd__field-row"]}>
            <label className={s["dsd__field"]}>
              <span className={s["dsd__field-label"]}>Method</span>
              <select
                className={s["dsd__input"]}
                value={sampleMethod}
                onChange={(e) => setSampleMethod(e.target.value as "GET" | "POST")}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </label>
            <label className={s["dsd__field"]}>
              <span className={s["dsd__field-label"]}>Path (exact)</span>
              <input
                type="text"
                className={s["dsd__input"]}
                value={samplePath}
                onChange={(e) => setSamplePath(e.target.value)}
                placeholder="/v1/weather/London"
              />
            </label>
          </div>

          <label className={s["dsd__field"]}>
            <span className={s["dsd__field-label"]}>Response body (JSON)</span>
            <textarea
              className={s["dsd__textarea"]}
              value={sampleText}
              onChange={(e) => setSampleText(e.target.value)}
              placeholder='{ "temp": 18, "conditions": "cloudy" }'
              rows={5}
            />
          </label>

          <button
            className={s["dsd__btn"]}
            type="button"
            onClick={addSample}
            disabled={!sampleText.trim()}
          >
            Add sample
          </button>

          {samples.length > 0 && (
            <ul className={s["dsd__sample-list"]}>
              {samples.map((sp, i) => (
                <li key={i} className={s["dsd__sample-item"]}>
                  <code>{sp.method} {sp.path}</code>
                  <button
                    className={s["dsd__sample-remove"]}
                    onClick={() => removeSample(i)}
                    type="button"
                    aria-label="Remove sample"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </details>

        {localError && (
          <div className={s["dsd__error"]}>{localError}</div>
        )}

        <div className={s["dsd__actions"]}>
          <button
            className={[s["dsd__btn"], s["dsd__btn--primary"]].join(" ")}
            onClick={submit}
            type="button"
            disabled={!canSubmit}
            title={canSubmit ? "Register" : "Enter a name and a base URL first"}
          >
            {busy ? "Extracting endpoints…" : "Register API"}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * API Keys vault manager.
 *
 * Lets the user add named API keys that live in the server-side
 * `data/keys.json`. Each key can be referenced by name from any
 * number of registered API sources. The key VALUE is never sent to
 * the browser — only the name + metadata.
 *
 * Keys are listed with:
 *   - name
 *   - when they were added
 *   - when they were last used
 *   - how many API sources reference them
 *
 * Adding a key requires a name and a value. Names are sanitized
 * server-side (lowercase, no spaces). PATCH updates the value or
 * notes; rename goes through too. Delete removes the key entirely;
 * any API source still referencing it will fail its next call with a
 * clear "key not found" error.
 */
function KeysManager({
  localError,
  onError,
  onSuccess,
}: {
  localError: string | null;
  onError: (msg: string | null) => void;
  onSuccess: () => void;
}) {
  const [keys, setKeys] = useState<ApiKeyPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      setKeys(await listApiKeys());
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const add = async () => {
    if (!newName.trim() || !newValue.trim()) return;
    setBusy(true);
    onError(null);
    try {
      await createApiKey({
        name: newName.trim(),
        value: newValue,
        ...(newNotes.trim() ? { notes: newNotes.trim() } : {}),
      });
      setNewName("");
      setNewValue("");
      setNewNotes("");
      setShowAdd(false);
      onSuccess();
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete key "${name}"? Any API source using it will fail its next call.`)) return;
    setBusy(true);
    onError(null);
    try {
      await deleteApiKey(id);
      await refresh();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={s["dsd__body"]}>
      <div className={s["dsd__layout"]}>
        <section className={s["dsd__pane"]}>
          <h3 className={s["dsd__pane-title"]}>
            Add a key
            <button
              className={s["dsd__btn"]}
              type="button"
              onClick={() => setShowAdd(!showAdd)}
              disabled={busy}
              style={{ marginLeft: "auto" }}
            >
              {showAdd ? "Cancel" : "+ New key"}
            </button>
          </h3>
          <p className={s["dsd__api-intro"]}>
            Keys live in a server-side vault (<code>data/keys.json</code>,
            gitignored). The actual value never reaches the browser bundle —
            registered APIs reference keys by name, the middleware resolves
            the value at call time.
          </p>

          {showAdd && (
            <div className={s["dsd__form"]}>
              <label className={s["dsd__field"]}>
                <span className={s["dsd__field-label"]}>Key name</span>
                <input
                  type="text"
                  className={s["dsd__input"]}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="stripe-prod"
                  autoFocus
                />
                <span className={s["dsd__field-hint"]}>
                  Lowercase letters, digits, '-', '_'. Used in the API
                  registration form to pick this key.
                </span>
              </label>
              <label className={s["dsd__field"]}>
                <span className={s["dsd__field-label"]}>Value</span>
                <input
                  type="text"
                  className={s["dsd__input"]}
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="Bearer sk-… or sk-… or whatever the API expects"
                />
                <span className={s["dsd__field-hint"]}>
                  Sent verbatim as the <code>Authorization</code> header.
                </span>
              </label>
              <label className={s["dsd__field"]}>
                <span className={s["dsd__field-label"]}>Notes (optional)</span>
                <input
                  type="text"
                  className={s["dsd__input"]}
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Production Stripe key, example.com account"
                />
              </label>
              {localError && <div className={s["dsd__error"]}>{localError}</div>}
              <div className={s["dsd__actions"]}>
                <button
                  className={[s["dsd__btn"], s["dsd__btn--primary"]].join(" ")}
                  type="button"
                  disabled={!newName.trim() || !newValue.trim() || busy}
                  onClick={add}
                >
                  {busy ? "Saving…" : "Save key"}
                </button>
              </div>
            </div>
          )}
        </section>

        <section className={s["dsd__pane"]}>
          <h3 className={s["dsd__pane-title"]}>
            Saved keys
            <span className={s["dsd__count"]}>{keys.length}</span>
          </h3>
          {loading && <div className={s["dsd__empty"]}>Loading…</div>}
          {!loading && keys.length === 0 && (
            <div className={s["dsd__empty"]}>
              No keys yet. Add one to the left to reference it from any API.
            </div>
          )}
          {!loading && keys.length > 0 && (
            <ul className={s["dsd__list"]}>
              {keys.map((k) => (
                <li key={k.id} className={s["dsd__list-item"]}>
                  <div className={s["dsd__list-head"]}>
                    <div className={s["dsd__list-name"]}>
                      <code>{k.name}</code>
                    </div>
                    <button
                      className={s["dsd__list-remove"]}
                      onClick={() => void remove(k.id, k.name)}
                      type="button"
                      aria-label={`Delete key ${k.name}`}
                      title="Delete key"
                      disabled={busy}
                    >
                      ×
                    </button>
                  </div>
                  <div className={s["dsd__list-meta"]}>
                    <span>
                      Added {new Date(k.createdAt).toLocaleDateString()}
                    </span>
                    {k.lastUsedAt && (
                      <span>
                        {" · last used "}
                        {new Date(k.lastUsedAt).toLocaleString()}
                      </span>
                    )}
                    <span>
                      {" · "}
                      {k.usedBySources === 0
                        ? "no APIs use this"
                        : `used by ${k.usedBySources} API${k.usedBySources === 1 ? "" : "s"}`}
                    </span>
                  </div>
                  {k.notes && (
                    <div className={s["dsd__list-summary"]}>{k.notes}</div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
