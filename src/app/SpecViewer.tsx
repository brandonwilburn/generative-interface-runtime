import { useState } from "react";
import s from "./app.module.css";
import type { DashboardSpec } from "@/dsl/schema";

interface Props {
  spec: DashboardSpec;
  reasoning?: string;
  open: boolean;
  onToggle: () => void;
}

export function SpecViewer({ spec, reasoning, open, onToggle }: Props) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  };

  return (
    <div className={s["spec-viewer"]}>
      <div className={s["result__chips"]} style={{ marginBottom: 12 }}>
        <button
          className={[s["result__btn"], open ? s["result__btn--active"] : ""].filter(Boolean).join(" ")}
          onClick={onToggle}
          type="button"
        >
          {open ? "Hide" : "View"} spec JSON
        </button>
        <button className={s["result__btn"]} onClick={copy} type="button">
          {copied ? "Copied" : "Copy spec"}
        </button>
        {reasoning && (
          <span className={s["result__chip"]}>
            <span aria-hidden>→</span>
            {reasoning}
          </span>
        )}
      </div>
      {open && (
        <div className={s["spec-viewer__panel"]}>
          <pre>{JSON.stringify(spec, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
