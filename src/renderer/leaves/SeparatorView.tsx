import type { Separator as SeparatorNode } from "@/dsl/schema";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: SeparatorNode;
}

export function SeparatorView({ node }: Props) {
  return (
    <div
      className={[
        s["gir-separator"],
        s[`gir-separator--${node.spacing}`],
      ].join(" ")}
      role="separator"
      aria-label={node.label}
    >
      <span className={s["gir-separator__line"]} />
      {node.label && <span className={s["gir-separator__label"]}>{node.label}</span>}
      {node.label && <span className={s["gir-separator__line"]} />}
    </div>
  );
}
