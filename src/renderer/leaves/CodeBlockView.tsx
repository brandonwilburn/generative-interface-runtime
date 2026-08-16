import type { CodeBlock as CodeBlockNode } from "@/dsl/schema";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: CodeBlockNode;
}

export function CodeBlockView({ node }: Props) {
  return (
    <figure className={s["gir-code"]}>
      {(node.title || node.language) && (
        <div className={s["gir-code__header"]}>
          <span className={s["gir-code__title"]}>{node.title ?? "Code"}</span>
          {node.language && <span className={s["gir-code__language"]}>{node.language}</span>}
        </div>
      )}
      <pre className={s["gir-code__pre"]}>
        <code>{node.code}</code>
      </pre>
      {node.caption && <figcaption className={s["gir-code__caption"]}>{node.caption}</figcaption>}
    </figure>
  );
}
