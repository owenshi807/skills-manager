import { Component, StrictMode, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import i18n, { i18nReady } from "./i18n";
import { applyDesignSkin } from "./lib/designSystem";
import { logStartupEvent } from "./lib/tauri";
import "./styles/skins/skill-manager.css";
import "./index.css";
import App from "./App.tsx";

applyDesignSkin();

class AppErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Skill Card Manager render failed", error, info.componentStack);
    logStartupEvent(`render_error:${error.message}`, performance.now()).catch(() => {});
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex h-screen items-center justify-center bg-background p-8 text-primary">
        <section className="w-full max-w-2xl rounded-xl border border-red-500/25 bg-surface p-6 shadow-card">
          <h1 className="text-lg font-semibold">{i18n.t("errorBoundary.title")}</h1>
          <p className="mt-2 text-sm text-muted">{i18n.t("errorBoundary.description")}</p>
          <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-bg-secondary p-3 text-xs text-secondary">
            {this.state.error.stack || this.state.error.message}
          </pre>
          <button type="button" className="app-button-primary mt-4" onClick={() => window.location.reload()}>
            {i18n.t("errorBoundary.reload")}
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
