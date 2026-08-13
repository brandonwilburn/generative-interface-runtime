import { useRef, type KeyboardEvent } from "react";
import s from "./app.module.css";

export type Mode = "create" | "modify";

interface Props {
  mode: Mode;
  onModeChange: (m: Mode) => void;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  hasResult: boolean;
  examples: string[];
}

export function IntentPanel({
  mode,
  onModeChange,
  value,
  onChange,
  onSubmit,
  busy,
  hasResult,
  examples,
}: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    if (busy) return;
    onSubmit();
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={s["intent"]}>
      <div className={s["intent__panel"]}>
        <div className={s["intent__label"]}>
          <div className={s["intent__label-left"]}>
            <span>Intent</span>
          </div>
          <div className={s["intent__mode-toggle"]} role="tablist" aria-label="Mode">
            <button
              className={[s["intent__mode-btn"], mode === "create" ? s["intent__mode-btn--active"] : ""].filter(Boolean).join(" ")}
              onClick={() => onModeChange("create")}
              role="tab"
              aria-selected={mode === "create"}
              type="button"
            >
              New dashboard
            </button>
            <button
              className={[s["intent__mode-btn"], mode === "modify" ? s["intent__mode-btn--active"] : ""].filter(Boolean).join(" ")}
              onClick={() => onModeChange("modify")}
              role="tab"
              aria-selected={mode === "modify"}
              type="button"
              disabled={!hasResult}
              title={hasResult ? "Modify the current dashboard" : "Generate a dashboard first"}
            >
              Modify
            </button>
          </div>
        </div>

        <textarea
          ref={ref}
          className={s["intent__textarea"]}
          placeholder={
            mode === "create"
              ? "e.g. Show me how the business performed this month."
              : "e.g. Add customer retention. Show busiest hours. Add top customers. Simplify."
          }
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          rows={2}
          aria-label="Intent"
        />

        <div className={s["intent__footer"]}>
          <div className={s["intent__examples"]}>
            <span className={s["intent__examples-label"]}>Try</span>
            {examples.map((ex) => (
              <button
                key={ex}
                type="button"
                className={s["intent__example-chip"]}
                onClick={() => {
                  onChange(ex);
                  ref.current?.focus();
                }}
              >
                {ex}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={s["intent__submit"]}
            onClick={submit}
            disabled={busy || value.trim().length === 0}
          >
            {busy && <span className={s["intent__submit--spinner"]} aria-hidden />}
            {mode === "create" ? "Generate" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}
