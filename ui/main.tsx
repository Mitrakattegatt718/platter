import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { initTheme } from "./lib/theme";
import { toastError } from "./lib/toast";

// Before render, so the first painted frame is already the right appearance —
// the window stays hidden until that frame commits. Defaults to following the
// system, as it always has; Settings can pin light or dark.
initTheme();

// Last-resort surfaces. A rejected promise outside App's run() helper — a
// floating click handler, a failed event subscription — used to die in the
// invisible WKWebView console; the user just saw a click do nothing. The
// ErrorBoundary only catches render errors, not these.
window.addEventListener("unhandledrejection", (e) => {
  console.error("Unhandled rejection:", e.reason);
  toastError("Something went wrong", String(e.reason));
});
window.addEventListener("error", (e) => {
  console.error("Uncaught error:", e.error ?? e.message);
  toastError("Something went wrong", e.message);
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
