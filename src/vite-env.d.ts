/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.css";

interface ImportMetaEnv {
  readonly VITE_OPENAI_BASE_URL?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
