import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { sourcesApi } from "./vite/sourcesApi";
import { keysApi } from "./vite/keysApi";
import { apiProxy } from "./vite/apiProxy";

// Helper: read the latest sources.json from disk so the keys plugin
// can compute `usedBySources` without a circular dependency on the
// sourcesApi's in-memory state.
function readSourcesForKeys(): any[] {
  const p = resolve(process.cwd(), "data", "sources.json");
  if (!existsSync(p)) return [];
  try {
    return (JSON.parse(readFileSync(p, "utf8")) as { sources?: any[] }).sources ?? [];
  } catch {
    return [];
  }
}

export default defineConfig({
  // Order matters:
  //   1. sourcesApi matches /api/sources/* and /api/sources (data + calls)
  //   2. keysApi matches /api/keys/* (separate path, but listed early so
  //      the source list is read once at startup rather than on every key request)
  //   3. apiProxy matches /api/* and forwards to the LLM upstream — last
  //      so the more specific handlers win.
  plugins: [
    react(),
    sourcesApi(),
    keysApi(() => readSourcesForKeys()),
    apiProxy(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
  },
});
