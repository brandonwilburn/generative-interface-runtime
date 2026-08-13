import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { sourcesApi } from "./vite/sourcesApi";
import { apiProxy } from "./vite/apiProxy";

export default defineConfig({
  // sourcesApi must come before apiProxy: apiProxy matches /api/* and
  // forwards to the LLM upstream, which would 404 on /api/sources.
  // sourcesApi is the more specific handler so it goes first.
  plugins: [react(), sourcesApi(), apiProxy()],
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
