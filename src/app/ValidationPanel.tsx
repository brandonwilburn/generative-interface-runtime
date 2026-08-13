import type { ValidationResult } from "@/registry/validation";
import s from "./app.module.css";

interface Props {
  result: ValidationResult;
}

export function ValidationPanel({ result }: Props) {
  if (result.violations.length === 0) {
    return (
      <div className={s["validation"]}>
        <div className={s["validation__panel"]}>
          <div className={[s["validation__row"]].join(" ")}>
            <span className={[s["validation__rule"]].join(" ")}>OK</span>
            <span>All deterministic rules passed.</span>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={s["validation"]}>
      <div className={s["validation__panel"]}>
        {result.violations.map((v, i) => (
          <div
            key={i}
            className={[
              s["validation__row"],
              v.severity === "error" ? s["validation__row--error"] : "",
              v.severity === "warning" ? s["validation__row--warning"] : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <span
              className={[
                s["validation__rule"],
                v.severity === "error" ? s["validation__rule--error"] : "",
                v.severity === "warning" ? s["validation__rule--warning"] : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {v.rule}
            </span>
            <span>{v.message}</span>
            {v.path && (
              <code style={{ color: "var(--color-fg-muted)", marginLeft: "auto" }}>
                {v.path}
              </code>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
