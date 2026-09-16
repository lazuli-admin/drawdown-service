import { Component } from "react";

const API = (import.meta.env.DEV ? "/" : import.meta.env.BASE_URL) + "api";

// uncaught errors outside React's render phase (event handlers, promises) -> api log
const report = (error: string, stack?: string) =>
  fetch(`${API}/log`, { method: "POST", body: JSON.stringify({ error, stack }) }).catch(() => {});
window.onerror = (msg, src, line, col, err) => report(`${msg} (${src}:${line}:${col})`, err?.stack);
window.onunhandledrejection = (e) => report(`unhandled rejection: ${e.reason}`, e.reason?.stack);

// Logs browser crashes to the api server (-> .dev.log) and shows a fallback.
export class ErrorBoundary extends Component<{ children: React.ReactNode }, { err?: Error }> {
  state = {};
  static getDerivedStateFromError(err: Error) {
    return { err };
  }
  componentDidCatch(err: Error, info: React.ErrorInfo) {
    // fire-and-forget: never let error reporting crash the error boundary
    report(String(err), info.componentStack ?? undefined);
  }
  render() {
    if (this.state.err) return <p className="neg">something broke: {String(this.state.err)}</p>;
    return this.props.children;
  }
}