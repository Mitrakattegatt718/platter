import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./index.css";
import { describeError, installLogFlushOnUnload, isBenignError, log } from "./lib/log";
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
// The console they write to is the webview's, which nobody can open on a
// user's machine; the log file is the half that survives. Both, because the
// console is still the faster read during development.
window.addEventListener("unhandledrejection", (e) => {
  const detail = describeError(e.reason);
  if (isBenignError(detail)) {
    log.warn("js.ignored", detail);
    return;
  }
  console.error("Unhandled rejection:", e.reason);
  log.error("js.unhandledRejection", detail);
  toastError("Something went wrong", String(e.reason));
});
window.addEventListener("error", (e) => {
  if (isBenignError(e.message)) {
    log.warn("js.ignored", e.message);
    return;
  }
  console.error("Uncaught error:", e.error ?? e.message);
  log.error("js.uncaught", `${e.message} (${e.filename}:${e.lineno})`);
  toastError("Something went wrong", e.message);
});

installLogFlushOnUnload();
log.info("app.start", navigator.userAgent);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
