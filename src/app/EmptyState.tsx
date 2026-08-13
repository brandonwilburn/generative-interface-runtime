import s from "./app.module.css";

const BULLETS = [
  "Express what you want to see in natural language.",
  "The runtime proposes a structured interface, validates it, and renders it.",
  "Modify with follow-up intents — structure is preserved where possible.",
];

export function EmptyState() {
  return (
    <div className={s["empty"]}>
      <div className={s["empty__copy"]}>
        <h1 className={s["empty__title"]}>
          An interface for the question,
          <br />
          not the question for the interface.
        </h1>
        <p className={s["empty__lede"]}>
          The runtime reads your intent, proposes a structured dashboard from
          the available data, validates it against a design system, and renders it.
        </p>
        <ul className={s["empty__bullets"]}>
          {BULLETS.map((b, i) => (
            <li key={i} className={s["empty__bullet"]}>
              <span className={s["empty__bullet-num"]}>{i + 1}</span>
              <span>{b}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className={s["empty__preview"]} aria-hidden>
        <div className={s["empty__preview-row"]}>
          <div className={s["empty__preview-card"]}>
            <span className={s["empty__preview-label"]}>Revenue</span>
            <span className={s["empty__preview-value"]}>$48,210</span>
            <div className={s["empty__preview-bar"]} style={{ ["--w" as never]: "72%" }} />
          </div>
          <div className={s["empty__preview-card"]}>
            <span className={s["empty__preview-label"]}>Orders</span>
            <span className={s["empty__preview-value"]}>2,184</span>
            <div className={s["empty__preview-bar"]} style={{ ["--w" as never]: "54%" }} />
          </div>
          <div className={s["empty__preview-card"]}>
            <span className={s["empty__preview-label"]}>Avg ticket</span>
            <span className={s["empty__preview-value"]}>$22</span>
            <div className={s["empty__preview-bar"]} style={{ ["--w" as never]: "31%" }} />
          </div>
        </div>
        <div className={s["empty__preview-chart"]} />
        <div className={s["empty__preview-row"]}>
          <div className={s["empty__preview-card"]}>
            <span className={s["empty__preview-label"]}>Top product</span>
            <span className={s["empty__preview-value"]}>Brisket</span>
          </div>
          <div className={s["empty__preview-card"]}>
            <span className={s["empty__preview-label"]}>Retention</span>
            <span className={s["empty__preview-value"]}>40.9%</span>
          </div>
          <div className={s["empty__preview-card"]}>
            <span className={s["empty__preview-label"]}>Worst day</span>
            <span className={s["empty__preview-value"]}>Jul 30</span>
          </div>
        </div>
      </div>
    </div>
  );
}
