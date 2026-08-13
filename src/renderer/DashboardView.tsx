import type { DashboardSpec } from "@/dsl/schema";
import { NodeRenderer } from "./NodeRenderer";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: DashboardSpec;
}

export function DashboardView({ node }: Props) {
  return (
    <div className={s["gir-dashboard"]}>
      <header className={s["gir-dashboard__header"]}>
        <div className={s["gir-dashboard__eyebrow"]}>Generated interface</div>
        <h1 className={s["gir-dashboard__title"]}>{node.title}</h1>
        {node.description && (
          <p className={s["gir-dashboard__description"]}>{node.description}</p>
        )}
        {node.generatedFor && (
          <div className={s["gir-dashboard__meta"]}>
            <span className={s["gir-dashboard__meta-chip"]}>
              Intent · {node.generatedFor}
            </span>
          </div>
        )}
      </header>
      {node.children.map((section, i) => (
        <NodeRenderer key={i} node={section} />
      ))}
    </div>
  );
}
