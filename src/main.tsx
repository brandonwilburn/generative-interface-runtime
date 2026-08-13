import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { SourcesProvider } from "./data/sourcesRegistry";
import "./design/global.css";

const root = document.getElementById("root");
if (!root) throw new Error("No #root element found");

createRoot(root).render(
  <StrictMode>
    <SourcesProvider>
      <App />
    </SourcesProvider>
  </StrictMode>,
);
