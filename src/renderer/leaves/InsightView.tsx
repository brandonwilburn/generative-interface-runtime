import type { Insight as InsightNode } from "@/dsl/schema";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: InsightNode;
}

const ICON: Record<InsightNode["severity"], string> = {
  positive: "+",
  negative: "!",
  warning: "!",
  info: "i",
};

export function InsightView({ node }: Props) {
  return (
    <div
      className={[s["gir-insight"], s[`gir-insight--${node.severity}`]].join(" ")}
      role="note"
      aria-label={node.title ? `${node.severity}: ${node.title}` : `Note: ${node.content}`}
    >
      {node.title && (
        <div className={s["gir-insight__title"]}>
          <span className={s["gir-insight__icon"]} aria-hidden>
            {ICON[node.severity]}
          </span>
          {node.title}
        </div>
      )}
      <div className={s["gir-insight__content"]}>{node.content}</div>
    </div>
  );
}

