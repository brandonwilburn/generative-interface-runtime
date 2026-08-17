import type { Text as TextNode } from "@/dsl/schema";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: TextNode;
}

export function TextView({ node }: Props) {
  const variant = `gir-text--${node.as}`;
  const tone = node.as === "p" ? `gir-text--${node.tone}` : "";
  const cls = [s["gir-text"], s[variant], tone ? s[tone] : ""]
    .filter(Boolean)
    .join(" ");
  const Tag = node.as as keyof React.JSX.IntrinsicElements;
  const content = <Tag className={cls}>{node.content}</Tag>;
  if (!node.title) return content;
  return (
    <article className={s["gir-text-block"]}>
      <h3 className={s["gir-text-block__title"]}>{node.title}</h3>
      {content}
    </article>
  );
}
