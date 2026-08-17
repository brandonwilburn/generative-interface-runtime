import type { CSSProperties } from "react";
import type { DashboardSpec } from "@/dsl/schema";
import s from "@/renderer/renderer.module.css";

interface Props {
  node: DashboardSpec;
}

function imageStyle(src: string, position: string): CSSProperties {
  const safeSrc = src.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return {
    backgroundImage: `url("${safeSrc}")`,
    backgroundPosition: position,
  };
}

export function HeroView({ node }: Props) {
  const hero = node.hero!;
  const background = hero.background;
  const autoLight =
    background.type === "gradient" ||
    (background.type === "tone" && background.tone === "dark") ||
    (background.type === "image" && background.overlay !== "light");
  const foreground = hero.foreground === "auto"
    ? (autoLight ? "light" : "dark")
    : hero.foreground;
  const classes = [
    s["gir-hero"],
    s[`gir-hero--${hero.variant}`],
    s[`gir-hero--height-${hero.height}`],
    s[`gir-hero--align-${hero.alignment}`],
    s[`gir-hero--foreground-${foreground}`],
    s[`gir-hero--background-${background.type}`],
    background.type === "tone" ? s[`gir-hero--tone-${background.tone}`] : "",
    background.type === "gradient" ? s[`gir-hero--gradient-${background.tone}`] : "",
    background.type === "image" ? s[`gir-hero--overlay-${background.overlay}`] : "",
  ].filter(Boolean).join(" ");
  const style = background.type === "image"
    ? imageStyle(background.src, background.position)
    : undefined;

  return (
    <header className={classes} style={style}>
      <div className={s["gir-hero__content"]}>
        {hero.eyebrow && <div className={s["gir-hero__eyebrow"]}>{hero.eyebrow}</div>}
        <h1 className={s["gir-hero__title"]}>{node.title}</h1>
        {node.description && <p className={s["gir-hero__description"]}>{node.description}</p>}
        {hero.body && <p className={s["gir-hero__body"]}>{hero.body}</p>}
      </div>
    </header>
  );
}
