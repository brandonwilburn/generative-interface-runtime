import type { CSSProperties } from "react";
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
        {node.children.map((child, i) => {
          const layout = child.layout;
          const style = layout
            ? ({
                "--gir-column-span": Math.min(layout.columnSpan ?? 1, node.columns),
                ...(layout.columnStart ? { "--gir-column-start": layout.columnStart } : {}),
                "--gir-row-span": layout.rowSpan ?? 1,
              } as CSSProperties)
            : undefined;
          const classes = layout
            ? [
                s["gir-section__item--positioned"],
                layout.columnStart ? s["gir-section__item--explicit"] : "",
                layout.surface ? s[`gir-tile--surface-${layout.surface}`] : "",
                layout.padding ? s[`gir-tile--padding-${layout.padding}`] : "",
                layout.verticalAlign ? s[`gir-tile--align-${layout.verticalAlign}`] : "",
              ].filter(Boolean).join(" ")
            : s["gir-section__item"];
          return (
            <div
              key={child.id ?? i}
              className={classes}
              style={style}
            >
              <NodeRenderer node={child} />
            </div>
          );
        })}
      </div>
    </section>
  );
}
