import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { initTheme } from "./lib/theme";

// Before render, so the first painted frame is already the right appearance —
// the window stays hidden until that frame commits. Defaults to following the
// system, as it always has; Settings can pin light or dark.
initTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
