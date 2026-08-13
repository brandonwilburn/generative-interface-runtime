import type { Section as SectionNode } from "@/dsl/schema";
import { NodeRenderer } from "./NodeRenderer";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: SectionNode;
}

export function SectionView({ node }: Props) {
  return (
    <section className={s["gir-section"]} aria-label={node.title ?? undefined}>
      {(node.title || node.description) && (
        <div className={s["gir-section__header"]}>
          {node.title && <h2 className={s["gir-section__title"]}>{node.title}</h2>}
          {node.description && (
            <p className={s["gir-section__description"]}>{node.description}</p>
          )}
        </div>
      )}
      <div
        className={[
          s["gir-section__grid"],
          s[`gir-section__grid--cols-${node.columns}`],
          s[`gir-section__grid--density-${node.density}`],
        ].join(" ")}
      >
        {node.children.map((child, i) => (
          <NodeRenderer key={i} node={child} />
        ))}
      </div>
    </section>
  );
}
