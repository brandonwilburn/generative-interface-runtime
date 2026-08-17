import type { DashboardSpec } from "@/dsl/schema";
import { DatasetProvider } from "@/data/DatasetContext";
import { NodeRenderer } from "./NodeRenderer";
import { HeroView } from "./HeroView";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: DashboardSpec;
}

export function DashboardView({ node }: Props) {
  return (
    <DatasetProvider datasets={node.datasets ?? {}}>
      <div className={s["gir-dashboard"]}>
        {node.hero ? (
          <HeroView node={node} />
        ) : (
          <header className={s["gir-dashboard__header"]}>
            <h1 className={s["gir-dashboard__title"]}>{node.title}</h1>
            {node.description && (
              <p className={s["gir-dashboard__description"]}>{node.description}</p>
            )}
          </header>
        )}
        {node.children.map((section, i) => (
          <NodeRenderer key={i} node={section} />
        ))}
      </div>
    </DatasetProvider>
  );
}
