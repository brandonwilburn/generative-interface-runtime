import s from "./app.module.css";

export function LoadingSkeleton() {
  return (
    <div className={s["skeleton"]} aria-hidden>
      <div className={s["skeleton__block"]} style={{ height: 40, width: "40%" }} />
      <div className={s["skeleton__row"]}>
        <div className={s["skeleton__block"]} />
        <div className={s["skeleton__block"]} />
        <div className={s["skeleton__block"]} />
      </div>
      <div className={s["skeleton__block"] + " " + s["skeleton__block--tall"]} />
      <div className={s["skeleton__row"]}>
        <div className={s["skeleton__block"] + " " + s["skeleton__block--tall"]} />
        <div className={s["skeleton__block"] + " " + s["skeleton__block--tall"]} />
      </div>
    </div>
  );
}
