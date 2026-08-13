import s from "./app.module.css";

interface Props {
  plannerName: string;
  sourceCount: number;
  onOpenDataSources: () => void;
}

export function TopBar({ plannerName, sourceCount, onOpenDataSources }: Props) {
  return (
    <header className={s["app__topbar"]}>
      <div className={s["app__brand"]}>
        <div className={s["app__brand-mark"]} aria-hidden>G</div>
        <div className={s["app__brand-text"]}>
          <div className={s["app__brand-name"]}>Generative Interface Runtime</div>
          <div className={s["app__brand-sub"]}>Constrained UI from APIs and intent</div>
        </div>
      </div>
      <div className={s["app__topbar-right"]}>
        <button
          type="button"
          className={s["app__data-button"]}
          onClick={onOpenDataSources}
          aria-label="Connect data sources"
          title="Upload CSV/JSON to add a data source"
        >
          <span aria-hidden>＋</span>
          {sourceCount === 0
            ? "Connect data"
            : `${sourceCount} source${sourceCount === 1 ? "" : "s"}`}
        </button>
        <span className={s["app__planner-pill"]} title="Active planner">
          <span className={s["app__planner-pill-dot"]} aria-hidden />
          {plannerName}
        </span>
        <a
          className={s["app__topbar-link"]}
          href="https://github.com/brand/generative-interface-runtime"
          target="_blank"
          rel="noreferrer"
        >
          Docs ↗
        </a>
      </div>
    </header>
  );
}
