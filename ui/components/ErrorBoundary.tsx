import React from "react";
import { log } from "@/lib/log";

/** A render error in a webview app blanks the whole window with no way back —
 * worse than a native crash, because nothing is logged where the user can see
 * it. Show what happened and offer a reload. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Platter render error:", error, info.componentStack);
    // The component stack is the only thing that says *where*, and this screen
    // is the end of the session — the log file is where it has to survive.
    log.error("render.crash", `${error.message}${info.componentStack ?? ""}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-screen flex-col gap-3 overflow-auto bg-background p-8 text-foreground">
        <h1 className="text-lg font-semibold">Platter hit an error</h1>
        <p className="text-sm text-muted-foreground">
          The interface stopped responding. Your iPod was not modified — every
          change is written as it is made.
        </p>
        <pre className="max-h-80 overflow-auto rounded-lg border bg-card p-3 text-xs whitespace-pre-wrap">
          {error.message}
          {"\n\n"}
          {error.stack}
        </pre>
        <button
          className="self-start rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    );
  }
}
