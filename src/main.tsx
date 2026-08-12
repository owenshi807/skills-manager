import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { i18nReady } from "./i18n";
import { logStartupEvent } from "./lib/tauri";
import "./index.css";
import App from "./App.tsx";

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Card Master render failed", error, info.componentStack);
    logStartupEvent(`render_error:${error.message}`, performance.now()).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen items-center justify-center bg-background p-8 text-primary">
        <section className="w-full max-w-2xl rounded-xl border border-red-500/25 bg-surface p-6 shadow-card">
          <h1 className="text-lg font-semibold">Card Master 无法显示</h1>
          <p className="mt-2 text-sm text-muted">界面遇到运行错误，Skill 数据没有被修改。</p>
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-secondary p-3 text-xs text-secondary">
            {this.state.error.stack || this.state.error.message}
          </pre>
          <button type="button" className="app-button-primary mt-4" onClick={() => window.location.reload()}>
            重新载入
          </button>
        </section>
      </main>
    );
  }
}

await i18nReady;
logStartupEvent("i18n_ready", performance.now()).catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
logStartupEvent("root_rendered", performance.now()).catch(() => {});
